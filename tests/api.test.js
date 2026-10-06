process.env.MECANIFIQUE_AUTO_START = "false";
// Las pruebas de comisión cuentan los días gratis desde que se creó cada
// mecánico; la del lanzamiento cambia esta fecha dentro de la prueba.
process.env.COMMISSION_LAUNCH_DATE = "2020-01-01T00:00:00Z";

const {
  startServer,
  sweepExpiredHolds,
  applyMechanicConnection,
  activateMechanicIfIdentityApproved,
  lastBookableSlotDate,
  sweepStaleMechanics,
  sweepArrivalReminders
} = require("../src/server.ts");
const { ensureLocalUser } = require("../src/supabaseAuth.ts");
const { all, get, run } = require("../src/db.ts");
const { calculateDepositAmount, getCommissionRate, calculateCommissionAmount } = require("../src/payments.ts");
const { decodePhoto, PhotoUploadError, savePhoto } = require("../src/uploads.ts");
const { communityAuthorName } = require("../src/routes/community.ts");
const { anonymizeAccount, hasActiveServiceBlockingDeletion } = require("../src/accountDeletion.ts");
const {
  ServiceFeeError,
  claimServiceFee,
  createServiceFeeCheckout,
  linkServiceFee,
  releaseOrphanServiceFees,
  settleServiceFee
} = require("../src/serviceFees.ts");
const { setStripeGatewayForTests } = require("../src/stripe.ts");
const { TrackingError, getMechanicLocationForRequest, isMechanicBeingTracked } = require("../src/tracking.ts");
const { TipError, getTipInfoForRequest, isValidClabe, saveMechanicTipInfo } = require("../src/tips.ts");
const {
  QuoteError,
  createQuote,
  getQuotesForRequest,
  hasAcceptedQuote,
  hasPendingAdjustment,
  respondToQuote
} = require("../src/quotes.ts");
const {
  ServicePaymentError,
  amountDueForRequest,
  customerConfirmsPayment,
  lockVisitFee,
  mechanicConfirmsPayment,
  mechanicReportsUnpaid,
  unpaidServiceForCustomer
} = require("../src/servicePayment.ts");
const {
  ReceiptError,
  createReceipt,
  customerForPartsTrip,
  declareNoPurchase,
  hasPendingReceipt,
  isPartsTripOpen,
  respondToReceipt,
  startPartsTrip
} = require("../src/partsReceipts.ts");
const { ReturnVisitError, createReturnVisit, getReturnVisit } = require("../src/returnVisits.ts");
const {
  commissionFor,
  generateWeeklyStatements,
  markStatementPaid,
  mechanicCommissionSummary,
  recordCommission
} = require("../src/commissions.ts");
const {
  CancellationError,
  cancellationQuote,
  markCustomerAbsent,
  mechanicWithdraws,
  recentWithdrawals
} = require("../src/cancellations.ts");
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const baseUrl = process.env.API_BASE_URL || "http://localhost:4000";

async function ensureServer() {
  if (!global.__mecanifiqueServerStarted) {
    global.__mecanifiqueServerStarted = true;
    global.__mecanifiqueServer = await startServer();
  }
  return global.__mecanifiqueServer;
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const body = await response.json();
  return { response, body };
}

test.before(async () => {
  await ensureServer();
});

const createdRows = { mechanics: [], customers: [], requests: [] };

async function cleanupCreatedRows() {
  for (const requestId of createdRows.requests) {
    await run("DELETE FROM service_quotes WHERE service_request_id = ?", [requestId]);
    await run("DELETE FROM disputes WHERE service_request_id = ?", [requestId]);
    await run("DELETE FROM parts_receipts WHERE service_request_id = ?", [requestId]);
    await run("DELETE FROM mechanic_withdrawals WHERE service_request_id = ?", [requestId]);
    await run("DELETE FROM unpaid_fingerprints WHERE service_request_id = ?", [requestId]);
    await run("DELETE FROM service_photos WHERE service_request_id = ?", [requestId]);
    await run("DELETE FROM customer_reviews WHERE service_request_id = ?", [requestId]);
    await run("DELETE FROM commission_charges WHERE service_request_id = ?", [requestId]);
    await run("DELETE FROM service_fees WHERE service_request_id = ?", [requestId]);
    await run("DELETE FROM service_request_declines WHERE service_request_id = ?", [requestId]);
    await run("DELETE FROM service_request_updates WHERE service_request_id = ?", [requestId]);
    await run("DELETE FROM service_requests WHERE id = ?", [requestId]);
  }
  for (const customerId of createdRows.customers) {
    await run("DELETE FROM customers WHERE id = ?", [customerId]);
  }
  for (const mechanicId of createdRows.mechanics) {
    await run("DELETE FROM commission_charges WHERE mechanic_id = ?", [mechanicId]);
    await run("DELETE FROM commission_statements WHERE mechanic_id = ?", [mechanicId]);
    await run("DELETE FROM mechanics WHERE id = ?", [mechanicId]);
  }
}

test.after(async () => {
  await cleanupCreatedRows();
  if (!global.__mecanifiqueServer) {
    return;
  }
  await new Promise((resolve, reject) => {
    global.__mecanifiqueServer.close((error) => (error ? reject(error) : resolve()));
  });
});

test("health responde correctamente", async () => {
  const { response, body } = await request("/health");

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  // Sin TURSO_DATABASE_URL (tests locales) se usa el archivo local.
  assert.equal(body.database, "local-file");
});

test("la raíz del servidor redirige al sitio web", async () => {
  const response = await fetch(`${baseUrl}/`, { redirect: "manual" });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://mecanifique.vercel.app/");
});

test("ruta inexistente devuelve 404 JSON", async () => {
  const { response, body } = await request("/ruta-inexistente");

  assert.equal(response.status, 404);
  assert.equal(body.error, "Ruta no encontrada");
});

test("JSON inválido devuelve 400", async () => {
  const response = await fetch(`${baseUrl}/api/service-requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: "{"
  });

  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, "JSON inválido");
});

test("crear solicitud sin token devuelve 401", async () => {
  const { response } = await request("/api/service-requests", {
    method: "POST",
    body: JSON.stringify({
      vehicleMake: "Nissan",
      vehicleModel: "Versa",
      vehicleYear: 2020,
      issueDescription: "No enciende el motor",
      city: "CDMX",
      zone: "Centro"
    })
  });

  assert.equal(response.status, 401);
});

test("reportar disputa sin token devuelve 401", async () => {
  const { response } = await request("/api/disputes", {
    method: "POST",
    body: JSON.stringify({ serviceRequestId: 1, category: "other", description: "Prueba de autenticación" })
  });

  assert.equal(response.status, 401);
});

test("listar disputas de admin sin token devuelve 401", async () => {
  const { response } = await request("/api/admin/disputes");

  assert.equal(response.status, 401);
});

test("botón de pánico sin token devuelve 401", async () => {
  const { response } = await request("/api/alerts/panic", {
    method: "POST",
    body: JSON.stringify({})
  });

  assert.equal(response.status, 401);
});

test("cambiar disponibilidad de mecánico sin token devuelve 401", async () => {
  const { response } = await request("/api/mechanics/1/availability", {
    method: "PATCH",
    body: JSON.stringify({ isAvailable: true })
  });

  assert.equal(response.status, 401);
});

test("token inválido/no reconocido devuelve 401 en ruta protegida", async () => {
  const { response } = await request("/api/disputes/mine", {
    headers: { Authorization: "Bearer token-invalido-de-prueba" }
  });

  assert.equal(response.status, 401);
});

test("renovar sesión con refresh token inválido devuelve 401 con mensaje para volver a entrar", async () => {
  const { response, body } = await request("/auth/v2/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken: "refresh-token-invalido-de-prueba" })
  });

  assert.equal(response.status, 401);
  assert.match(body.error, /sesión expiró/);
});

test("renovar sesión sin refresh token devuelve 400", async () => {
  const { response } = await request("/auth/v2/refresh", {
    method: "POST",
    body: JSON.stringify({})
  });

  assert.equal(response.status, 400);
});

test("subir foto sin token devuelve 401", async () => {
  const { response } = await request("/api/uploads/photo", {
    method: "POST",
    body: JSON.stringify({ imageBase64: "x".repeat(200) })
  });

  assert.equal(response.status, 401);
});

test("decodePhoto: acepta JPG y PNG reconociéndolos por sus primeros bytes", () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);

  assert.equal(decodePhoto(jpeg.toString("base64")).extension, "jpg");
  assert.equal(decodePhoto(`data:image/png;base64,${png.toString("base64")}`).extension, "png");
});

test("decodePhoto: rechaza lo que no es JPG/PNG aunque diga ser imagen, y lo demasiado grande", () => {
  const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(100)]);
  const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024)]);

  assert.throws(() => decodePhoto(`data:image/jpeg;base64,${gif.toString("base64")}`), PhotoUploadError);
  assert.throws(() => decodePhoto(huge.toString("base64")), /demasiado grande/);
});

test("una foto guardada se sirve en /uploads con su tipo, y un nombre inválido da 404", async () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(64)]);
  const fileName = await savePhoto(decodePhoto(jpeg.toString("base64")), null);
  const id = fileName.split(".")[0];

  try {
    const response = await fetch(`${baseUrl}/uploads/${fileName}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);

    const wrongExtension = await fetch(`${baseUrl}/uploads/${id}.png`);
    assert.equal(wrongExtension.status, 404);
    const traversal = await fetch(`${baseUrl}/uploads/..%2Fmecanifique.db`);
    assert.equal(traversal.status, 404);
  } finally {
    await run("DELETE FROM uploaded_photos WHERE id = ?", [id]);
  }
});

test("rutas de cuenta, favoritos y soporte sin token devuelven 401", async () => {
  const cases = [
    ["GET", "/api/account/profile"],
    ["PATCH", "/api/account/profile", { fullName: "Sergio Prueba" }],
    ["POST", "/api/account/password", { newPassword: "una-clave-nueva" }],
    ["GET", "/api/favorites"],
    ["PUT", "/api/favorites/1"],
    ["DELETE", "/api/favorites/1"],
    ["POST", "/api/support", { kind: "help", message: "Necesito ayuda con la app" }],
    ["DELETE", "/api/account"]
  ];
  for (const [method, path, body] of cases) {
    const { response } = await request(path, { method, body: body ? JSON.stringify(body) : undefined });
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});

test("comunidad y promociones sin token devuelven 401", async () => {
  const cases = [
    ["GET", "/api/community/questions"],
    ["POST", "/api/community/questions", { title: "Frenos que chillan", body: "Suena el freno delantero", category: "frenos" }],
    ["GET", "/api/community/questions/1"],
    ["POST", "/api/community/questions/1/answers", { body: "Revisa las pastillas y el disco" }],
    ["POST", "/api/community/questions/1/follow"],
    ["POST", "/api/community/answers/1/helpful"],
    ["DELETE", "/api/community/questions/1"],
    ["GET", "/api/promotions"],
    ["GET", "/api/promotions/mine"],
    ["POST", "/api/promotions", { title: "Revisión gratis", description: "Al contratar mi servicio" }],
    ["PATCH", "/api/promotions/1", { isActive: false }],
    ["DELETE", "/api/promotions/1"]
  ];
  for (const [method, path, body] of cases) {
    const { response } = await request(path, { method, body: body ? JSON.stringify(body) : undefined });
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});

test("communityAuthorName: primer nombre + inicial, y nunca el correo", () => {
  assert.equal(communityAuthorName("Emilio López Pérez"), "Emilio L.");
  assert.equal(communityAuthorName("Cristóbal"), "Cristóbal");
  assert.equal(communityAuthorName("sgapo123@gmail.com"), "Usuario");
  assert.equal(communityAuthorName(""), "Usuario");
});

test("creación concurrente de usuario local no duplica la fila ni pierde el rol (regresión)", async () => {
  // Regresión del bug confirmado en producción el 2026-09-05 (commit
  // 366a6d1): dos peticiones concurrentes que resuelven el mismo usuario de
  // Supabase por primera vez podían insertar dos filas en `users`, y la que
  // "ganaba la carrera" a veces quedaba con el rol por defecto (customer)
  // en vez del rol real (mechanic). Este test llama directamente a
  // ensureLocalUser (sin red, sin depender de Supabase) para validar que el
  // patrón INSERT OR IGNORE + relectura sigue funcionando.
  const supabaseUserId = `test-${crypto.randomUUID()}`;
  const phoneDigits = crypto
    .createHash("sha1")
    .update(supabaseUserId)
    .digest("hex")
    .replace(/[^0-9]/g, "0")
    .slice(0, 7)
    .padEnd(7, "0");
  const fakeSupabaseUser = {
    id: supabaseUserId,
    email: `${supabaseUserId}@example.test`,
    user_metadata: {
      role: "mechanic",
      full_name: "Mecánico De Prueba",
      phone: `555${phoneDigits}`,
      city: "CDMX",
      zone: "Centro",
      years_experience: 2,
      specialties: ["frenos"]
    }
  };

  const [userA, userB] = await Promise.all([
    ensureLocalUser(fakeSupabaseUser),
    ensureLocalUser(fakeSupabaseUser)
  ]);

  assert.equal(userA.id, userB.id, "ambas llamadas concurrentes deben resolver al mismo usuario");
  assert.equal(userA.role, "mechanic", "el rol no debe degradarse a customer por la condición de carrera");
  assert.equal(userB.role, "mechanic");
  assert.ok(userA.mechanicId, "debe tener un mechanicId asignado");

  const rows = await all(
    "SELECT id FROM users WHERE supabase_user_id = ?",
    [supabaseUserId]
  );
  assert.equal(rows.length, 1, "no debe haber filas duplicadas para el mismo supabase_user_id");
});

test("entrar por primera vez con un teléfono que ya es de otra cuenta: entra con teléfono de relleno, sin tocar el perfil ajeno", async () => {
  // Pasó en producción: el registro se cortó a la mitad por el teléfono
  // repetido y la cuenta quedaba sin poder entrar ("No se pudo crear el perfil local").
  const takenPhone = uniquePhone();
  const other = await ensureLocalUser({
    id: `test-${crypto.randomUUID()}`,
    email: `${crypto.randomUUID()}@example.test`,
    user_metadata: { role: "mechanic", full_name: "Mecánico Original", phone: takenPhone }
  });
  const supabaseUserId = `test-${crypto.randomUUID()}`;
  const newcomer = await ensureLocalUser({
    id: supabaseUserId,
    email: `${supabaseUserId}@example.test`,
    user_metadata: { role: "mechanic", full_name: "Mecánico Nuevo", phone: takenPhone }
  });
  try {
    assert.equal(newcomer.role, "mechanic");
    assert.ok(newcomer.mechanicId);
    assert.notEqual(newcomer.mechanicId, other.mechanicId, "no se liga al perfil de otra persona");
    const phone = (await get("SELECT phone FROM mechanics WHERE id = ?", [newcomer.mechanicId])).phone;
    assert.equal(phone, `supabase-${supabaseUserId}`);
  } finally {
    for (const user of [newcomer, other]) {
      await run("DELETE FROM users WHERE id = ?", [user.id]);
      await run("DELETE FROM mechanics WHERE id = ?", [user.mechanicId]);
    }
  }
});

test("registrarse diciendo 'admin' en los metadatos de Supabase crea un cliente, nunca un admin", async () => {
  const supabaseUserId = `test-${crypto.randomUUID()}`;
  const user = await ensureLocalUser({
    id: supabaseUserId,
    email: `${supabaseUserId}@example.test`,
    user_metadata: { role: "admin", full_name: "Intento De Admin", phone: uniquePhone() }
  });
  try {
    assert.equal(user.role, "customer");
    assert.ok(user.customerId, "queda como cliente normal");
  } finally {
    await run("DELETE FROM users WHERE id = ?", [user.id]);
    if (user.customerId) {
      await run("DELETE FROM customers WHERE id = ?", [user.customerId]);
    }
  }
});

test("calculateDepositAmount: 40% de la tarifa de mano de obra", () => {
  assert.equal(calculateDepositAmount(500), 200);
  assert.equal(calculateDepositAmount(333), 133.2);
});

test("calculateDepositAmount: null si el mecánico no tiene tarifa configurada", () => {
  assert.equal(calculateDepositAmount(null), null);
  assert.equal(calculateDepositAmount(undefined), null);
  assert.equal(calculateDepositAmount(0), null);
  assert.equal(calculateDepositAmount(-10), null);
});

test("getCommissionRate: baja escalonadamente con el volumen del mecánico", () => {
  assert.equal(getCommissionRate(0), 0.15);
  assert.equal(getCommissionRate(19), 0.15);
  assert.equal(getCommissionRate(20), 0.12);
  assert.equal(getCommissionRate(49), 0.12);
  assert.equal(getCommissionRate(50), 0.1);
  assert.equal(getCommissionRate(99), 0.1);
  assert.equal(getCommissionRate(100), 0.08);
  assert.equal(getCommissionRate(1000), 0.08);
});

test("calculateCommissionAmount: aplica la tasa del volumen sobre el monto final", () => {
  assert.equal(calculateCommissionAmount(1000, 0), 150);
  assert.equal(calculateCommissionAmount(1000, 100), 80);
});

// --- Emparejamiento: qué pasa cuando un mecánico no responde a tiempo ---
// Cada test usa una ciudad única para no chocar con otros datos de la base.

function uniquePhone() {
  return `55${crypto.randomInt(10_000_000, 99_999_999)}`;
}

async function createOnlineMechanic(city, zone, coords = null) {
  const result = await run(
    `INSERT INTO mechanics (full_name, phone, city, zone, years_experience, specialties, status, is_available, is_online, latitude, longitude, last_seen_at, profile_photo_url)
     VALUES (?, ?, ?, ?, 3, '["Motor"]', 'active', 1, 1, ?, ?, CURRENT_TIMESTAMP, 'https://example.test/uploads/cara.jpg')`,
    [`Mecánico ${crypto.randomUUID().slice(0, 6)}`, uniquePhone(), city, zone, coords?.latitude ?? null, coords?.longitude ?? null]
  );
  createdRows.mechanics.push(result.lastID);
  return result.lastID;
}

async function createPendingRequestWithExpiredHold(city, zone, mechanicId, assignmentMode, coords = null) {
  const customer = await run("INSERT INTO customers (full_name, phone) VALUES (?, ?)", ["Cliente Prueba", uniquePhone()]);
  const request = await run(
    `INSERT INTO service_requests
       (customer_id, vehicle_make, vehicle_model, vehicle_year, issue_description, preferred_time, city, zone,
        status, mechanic_id, hold_expires_at, assignment_mode, latitude, longitude)
     VALUES (?, 'Nissan', 'Versa', 2020, 'No enciende', 'Ahora', ?, ?, 'pending', ?, datetime('now', '-5 minutes'), ?, ?, ?)`,
    [customer.lastID, city, zone, mechanicId, assignmentMode, coords?.latitude ?? null, coords?.longitude ?? null]
  );
  createdRows.customers.push(customer.lastID);
  createdRows.requests.push(request.lastID);
  return request.lastID;
}

test("hold vencido en solicitud automática: se ofrece al siguiente mecánico disponible", async () => {
  const city = `Ciudad-${crypto.randomUUID()}`;
  const firstMechanic = await createOnlineMechanic(city, "Centro");
  const secondMechanic = await createOnlineMechanic(city, "Centro");
  const requestId = await createPendingRequestWithExpiredHold(city, "Centro", firstMechanic, "auto");

  await sweepExpiredHolds();

  const request = await get(
    "SELECT mechanic_id AS mechanicId, hold_expires_at > CURRENT_TIMESTAMP AS holdActive FROM service_requests WHERE id = ?",
    [requestId]
  );
  assert.equal(request.mechanicId, secondMechanic, "debe pasar al segundo mecánico");
  assert.equal(request.holdActive, 1, "el nuevo mecánico debe tener su propio hold vigente");

  const declines = await all(
    "SELECT mechanic_id AS mechanicId, reason FROM service_request_declines WHERE service_request_id = ?",
    [requestId]
  );
  assert.deepEqual(declines, [{ mechanicId: firstMechanic, reason: "expired" }]);
});

test("hold vencido en solicitud dirigida: no se reasigna a otro mecánico", async () => {
  const city = `Ciudad-${crypto.randomUUID()}`;
  const chosenMechanic = await createOnlineMechanic(city, "Centro");
  await createOnlineMechanic(city, "Centro");
  const requestId = await createPendingRequestWithExpiredHold(city, "Centro", chosenMechanic, "direct");

  await sweepExpiredHolds();

  const request = await get("SELECT mechanic_id AS mechanicId, status FROM service_requests WHERE id = ?", [requestId]);
  assert.equal(request.mechanicId, null, "el cliente eligió a ese mecánico: no se cambia por otro sin preguntarle");
  assert.equal(request.status, "pending");
});

test("hold vencido sin otro mecánico disponible: la solicitud queda sin mecánico y no se vuelve a ofrecer al mismo", async () => {
  const city = `Ciudad-${crypto.randomUUID()}`;
  const onlyMechanic = await createOnlineMechanic(city, "Centro");
  const requestId = await createPendingRequestWithExpiredHold(city, "Centro", onlyMechanic, "auto");

  await sweepExpiredHolds();

  const request = await get("SELECT mechanic_id AS mechanicId FROM service_requests WHERE id = ?", [requestId]);
  assert.equal(request.mechanicId, null, "no debe volver a ofrecérsela al mismo mecánico que no respondió");
});

// Puntos en medio del Pacífico Sur: la búsqueda por distancia no se limita
// a la ciudad del test, así que se usa un lugar donde no puede haber
// mecánicos reales en la base. Cada test usa su propia longitud (cientos de
// km de separación) para que los mecánicos de un test no queden "cerca" del
// cliente de otro.
function pointsAround(longitude) {
  return {
    cliente: { latitude: -45.0, longitude },
    a1Km: { latitude: -44.991, longitude },
    a100Km: { latitude: -44.1, longitude }
  };
}

test("con coordenadas: elige al mecánico más cercano aunque su zona esté escrita distinto", async () => {
  const { cliente, a1Km, a100Km } = pointsAround(-140);
  const city = `Ciudad-${crypto.randomUUID()}`;
  const firstMechanic = await createOnlineMechanic(city, "Centro", cliente);
  const farSameText = await createOnlineMechanic(city, "Centro", a100Km);
  const nearDifferentText = await createOnlineMechanic(city, "Zona Centro", a1Km);
  const requestId = await createPendingRequestWithExpiredHold(city, "Centro", firstMechanic, "auto", cliente);

  await sweepExpiredHolds();

  const request = await get("SELECT mechanic_id AS mechanicId FROM service_requests WHERE id = ?", [requestId]);
  assert.equal(request.mechanicId, nearDifferentText, "debe elegir al que está a 1 km, no al de 100 km con el mismo texto");
  assert.notEqual(request.mechanicId, farSameText);
});

test("con coordenadas: un mecánico lejano no se elige solo porque su ciudad/zona coincide", async () => {
  const { cliente, a100Km } = pointsAround(-125);
  const city = `Ciudad-${crypto.randomUUID()}`;
  const firstMechanic = await createOnlineMechanic(city, "Centro", cliente);
  await createOnlineMechanic(city, "Centro", a100Km);
  const requestId = await createPendingRequestWithExpiredHold(city, "Centro", firstMechanic, "auto", cliente);

  await sweepExpiredHolds();

  const request = await get("SELECT mechanic_id AS mechanicId FROM service_requests WHERE id = ?", [requestId]);
  assert.equal(request.mechanicId, null, "a 100 km no es un mecánico cercano, aunque el texto de la zona coincida");
});

test("verificación por teléfono: confirmar el número, confiar en el teléfono y volver a pedirlo en uno nuevo", async () => {
  const {
    confirmVerificationCode,
    getVerificationStatus,
    normalizeMexicanPhone,
    sendVerificationCode,
    setVerifyGatewayForTests
  } = require("../src/phoneVerification.ts");

  assert.equal(normalizeMexicanPhone("449 123 4567"), "+524491234567");
  assert.equal(normalizeMexicanPhone("+52 1 449 123 4567"), "+524491234567");
  assert.equal(normalizeMexicanPhone("sin-telefono-3"), null);

  const sent = [];
  setVerifyGatewayForTests({
    async send(to) { sent.push(to); },
    async check(_to, code) { return code === "123456"; }
  });
  const localPhone = uniquePhone();
  const customer = await run("INSERT INTO customers (full_name, phone) VALUES (?, ?)", ["Cliente Teléfono", localPhone]);
  createdRows.customers.push(customer.lastID);
  const supabaseUserId = crypto.randomUUID();
  const created = await run(
    `INSERT INTO users (role, login, supabase_user_id, full_name, password_salt, password_hash, customer_id)
     VALUES ('customer', ?, ?, 'Cliente Teléfono', 'x', 'x', ?)`,
    [`${supabaseUserId}@example.test`, supabaseUserId, customer.lastID]
  );
  const viewer = { id: created.lastID, customerId: customer.lastID, mechanicId: null };
  try {
    const first = await getVerificationStatus(viewer, "telefono-a");
    assert.equal(first.required, true);
    assert.equal(first.reason, "phone");

    await sendVerificationCode(viewer);
    assert.deepEqual(sent, [`+52${localPhone}`]);
    await assert.rejects(confirmVerificationCode(viewer, "telefono-a", "000000"), (error) => error.status === 400);
    await confirmVerificationCode(viewer, "telefono-a", "123456");
    assert.equal((await getVerificationStatus(viewer, "telefono-a")).required, false);

    // Otro teléfono: pide código otra vez, ya no por el número.
    const otherDevice = await getVerificationStatus(viewer, "telefono-b");
    assert.equal(otherDevice.reason, "device");

    // Cambió su número: hay que confirmarlo de nuevo, aun en el teléfono de confianza.
    await sendVerificationCode(viewer, `449${crypto.randomInt(1_000_000, 9_999_999)}`);
    assert.equal((await getVerificationStatus(viewer, "telefono-a")).reason, "phone");
  } finally {
    setVerifyGatewayForTests(undefined);
    await run("DELETE FROM trusted_devices WHERE user_id = ?", [created.lastID]);
    await run("DELETE FROM users WHERE id = ?", [created.lastID]);
  }
});

test("registro: una contraseña sin números se rechaza con un mensaje claro, sin llamar a Supabase", async () => {
  const { response, body } = await request("/auth/v2/register/customer", {
    method: "POST",
    body: JSON.stringify({ fullName: "Prueba Contraseña", email: "prueba@example.test", phone: "5512345678", password: "solamenteletras" })
  });
  assert.equal(response.status, 400);
  assert.equal(body.error, "La contraseña necesita al menos un número");
});

test("confirmación de correo: la página de regreso abre y reenviar pide un correo válido", async () => {
  const page = await fetch(`${baseUrl}/auth/callback`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /confirmaste tu correo/);

  const badEmail = await request("/auth/v2/resend-confirmation", { method: "POST", body: JSON.stringify({ email: "sin-arroba" }) });
  assert.equal(badEmail.response.status, 400);
});

test("nueva contraseña: la página abre y los datos inválidos se rechazan sin llamar a Supabase", async () => {
  const page = await fetch(`${baseUrl}/restablecer-contrasena`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Crea una nueva contraseña/);

  const badEmail = await request("/auth/v2/forgot-password", { method: "POST", body: JSON.stringify({ email: "no-es-correo" }) });
  assert.equal(badEmail.response.status, 400);

  const shortPassword = await request("/auth/v2/reset-password", {
    method: "POST",
    body: JSON.stringify({ accessToken: "x".repeat(40), password: "corta" })
  });
  assert.equal(shortPassword.response.status, 400);
});

test("Facebook: solo se regresa a la app, nunca a otro sitio", async () => {
  const evil = await request(`/auth/v2/oauth/facebook?redirectTo=${encodeURIComponent("https://otro-sitio.com/robar")}`);
  assert.notEqual(evil.response.status, 200);
  assert.equal(evil.body.url, undefined);

  const ok = await request(`/auth/v2/oauth/facebook?redirectTo=${encodeURIComponent("mecanifique://auth/callback")}`);
  // Sin SUPABASE_URL en el entorno la ruta responde 503; con él, la dirección de Supabase.
  if (ok.response.status === 200) {
    const url = new URL(ok.body.url);
    assert.match(url.pathname, /\/auth\/v1\/authorize$/);
    assert.equal(url.searchParams.get("provider"), "facebook");
    assert.equal(url.searchParams.get("redirect_to"), "mecanifique://auth/callback");
  } else {
    assert.equal(ok.response.status, 503);
  }
});

test("lista de espera (admin): sin sesión no se ve, no se marca ni se borra", async () => {
  const list = await request("/api/admin/waitlist");
  assert.equal(list.response.status, 401);
  const contacted = await request("/api/admin/waitlist/1/contacted", { method: "POST", body: JSON.stringify({ contacted: true }) });
  assert.equal(contacted.response.status, 401);
  const removed = await request("/api/admin/waitlist/1", { method: "DELETE" });
  assert.equal(removed.response.status, 401);

  const columns = await all("PRAGMA table_info(waitlist_signups)");
  assert.ok(columns.some((column) => column.name === "contacted_at"));
});

test("notificaciones: marcar todas como leídas exige sesión", async () => {
  const { response } = await request("/api/notifications/read-all", { method: "POST" });
  assert.equal(response.status, 401);
});

test("seguimiento: sin sesión no se puede ver dónde va un mecánico", async () => {
  const { response } = await request("/api/service-requests/1/mechanic-location");
  assert.equal(response.status, 401);
});

test("seguimiento: el cliente ve a su mecánico solo en camino o por refacciones", async () => {
  const { cliente, a1Km } = pointsAround(-95);
  const mechanicId = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro", a1Km);
  await run("UPDATE mechanics SET location_updated_at = datetime('now', '-30 seconds') WHERE id = ?", [mechanicId]);
  const customer = await run("INSERT INTO customers (full_name, phone) VALUES (?, ?)", ["Cliente Seguimiento", uniquePhone()]);
  createdRows.customers.push(customer.lastID);
  const created = await run(
    `INSERT INTO service_requests (customer_id, vehicle_make, vehicle_model, vehicle_year, issue_description, preferred_time,
       city, zone, status, mechanic_id, latitude, longitude)
     VALUES (?, 'Nissan', 'Versa', 2018, 'No enciende', '', 'Ciudad-Seguimiento', 'Centro', 'en_route', ?, ?, ?)`,
    [customer.lastID, mechanicId, cliente.latitude, cliente.longitude]
  );
  createdRows.requests.push(created.lastID);
  const requestId = created.lastID;
  const owner = { role: "customer", customerId: customer.lastID };
  const distanceKm = (latA, lngA, latB, lngB) => Math.hypot(latA - latB, lngA - lngB) * 111;

  // En camino: ve la posición, hace cuánto llegó y a qué distancia está del auto.
  const enRoute = await getMechanicLocationForRequest(requestId, owner, distanceKm);
  assert.equal(enRoute.tracking, true);
  assert.deepEqual([enRoute.mechanic.latitude, enRoute.mechanic.longitude], [a1Km.latitude, a1Km.longitude]);
  assert.ok(enRoute.mechanic.secondsAgo >= 29 && enRoute.mechanic.secondsAgo < 90);
  assert.equal(enRoute.distanceKm, 1);
  assert.equal(await isMechanicBeingTracked(mechanicId), true);

  // Nadie más puede verlo: ni otro cliente ni un mecánico.
  for (const stranger of [{ role: "customer", customerId: customer.lastID + 100000 }, { role: "mechanic", customerId: null }]) {
    await assert.rejects(
      getMechanicLocationForRequest(requestId, stranger, distanceKm),
      (error) => error instanceof TrackingError && error.status === 403
    );
  }

  // Ya llegó: la ubicación deja de exponerse y el teléfono sabe que puede apagar el seguimiento.
  await run("UPDATE service_requests SET status = 'on_site' WHERE id = ?", [requestId]);
  assert.deepEqual(await getMechanicLocationForRequest(requestId, owner, distanceKm), { tracking: false, status: "on_site", mechanic: null });
  assert.equal(await isMechanicBeingTracked(mechanicId), false);

  // Salió por refacciones: se vuelve a ver.
  await run("UPDATE service_requests SET status = 'awaiting_parts' WHERE id = ?", [requestId]);
  assert.equal((await getMechanicLocationForRequest(requestId, owner, distanceKm)).tracking, true);
});

test("turnos: solo se apartan dentro de los próximos 7 días, con la fecha de México", () => {
  // 27 sep 2026, 23:30 en México = 28 sep 05:30 UTC: el "hoy" de los turnos es el 27.
  assert.equal(lastBookableSlotDate(new Date("2026-09-28T05:30:00Z")), "2026-10-03");
  assert.equal(lastBookableSlotDate(new Date("2026-09-27T18:00:00Z")), "2026-10-03");
});

test("conexión: un mecánico cuyo teléfono dejó de dar señal se desconecta y recibe un aviso", async () => {
  const city = `Ciudad-${crypto.randomUUID()}`;
  const silent = await createOnlineMechanic(city, "Centro");
  const active = await createOnlineMechanic(city, "Centro");
  await run("UPDATE mechanics SET last_seen_at = datetime('now', '-10 minutes') WHERE id = ?", [silent]);
  const supabaseUserId = crypto.randomUUID();
  const user = await run(
    `INSERT INTO users (role, login, supabase_user_id, full_name, password_salt, password_hash, mechanic_id)
     VALUES ('mechanic', ?, ?, 'Mecánico Silencioso', 'x', 'x', ?)`,
    [`${supabaseUserId}@example.test`, supabaseUserId, silent]
  );
  try {
    await sweepStaleMechanics();
    const rows = await all("SELECT id, is_online AS isOnline FROM mechanics WHERE id IN (?, ?)", [silent, active]);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row.isOnline]));
    assert.equal(byId[silent], 0, "sin señal en 10 minutos: desconectado");
    assert.equal(byId[active], 1, "con señal reciente: sigue conectado");
    const notice = await get("SELECT title FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1", [user.lastID]);
    assert.equal(notice?.title, "Te desconectamos");

    // Con un servicio en curso: sigue conectado y se le recuerda una sola vez.
    await run("UPDATE mechanics SET is_online = 1, last_seen_at = datetime('now', '-10 minutes') WHERE id = ?", [silent]);
    const customer = await run("INSERT INTO customers (full_name, phone) VALUES (?, ?)", ["Cliente Servicio", uniquePhone()]);
    createdRows.customers.push(customer.lastID);
    const job = await run(
      `INSERT INTO service_requests (customer_id, vehicle_make, vehicle_model, vehicle_year, issue_description, preferred_time,
         city, zone, status, mechanic_id)
       VALUES (?, 'Nissan', 'Versa', 2018, 'No enciende', '', ?, 'Centro', 'en_route', ?)`,
      [customer.lastID, city, silent]
    );
    createdRows.requests.push(job.lastID);
    await sweepStaleMechanics();
    await sweepStaleMechanics();
    assert.equal((await get("SELECT is_online AS isOnline FROM mechanics WHERE id = ?", [silent])).isOnline, 1);
    const reminders = await all("SELECT id FROM notifications WHERE user_id = ? AND title = 'Tienes un servicio en curso'", [user.lastID]);
    assert.equal(reminders.length, 1, "un solo recordatorio aunque el barrido corra varias veces");
  } finally {
    await run("DELETE FROM notifications WHERE user_id = ?", [user.lastID]);
    await run("DELETE FROM users WHERE id = ?", [user.lastID]);
  }
});

test("cotización: el mecánico cotiza, el cliente acepta o no, y solo con una aceptada se repara", async () => {
  const mechanicId = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro");
  const customer = await run("INSERT INTO customers (full_name, phone) VALUES (?, ?)", ["Cliente Cotización", uniquePhone()]);
  createdRows.customers.push(customer.lastID);
  const created = await run(
    `INSERT INTO service_requests (customer_id, vehicle_make, vehicle_model, vehicle_year, issue_description, preferred_time,
       city, zone, status, mechanic_id)
     VALUES (?, 'Nissan', 'Versa', 2018, 'No enciende', '', 'Ciudad-Cotización', 'Centro', 'en_route', ?)`,
    [customer.lastID, mechanicId]
  );
  createdRows.requests.push(created.lastID);
  const requestId = created.lastID;
  const quote = (laborAmount, partsAmount = 0) =>
    createQuote({ requestId, mechanicId, laborAmount, partsAmount, description: "Cambio de batería y revisión del alternador" });

  // Todavía en camino: no puede cotizar sin ver el auto.
  await assert.rejects(quote(500), (error) => error instanceof QuoteError && error.status === 409);
  await run("UPDATE service_requests SET status = 'diagnosing' WHERE id = ?", [requestId]);

  // Otro mecánico no puede cotizar esta solicitud.
  await assert.rejects(
    createQuote({ requestId, mechanicId: mechanicId + 100000, laborAmount: 1, partsAmount: 0, description: "Otra cosa" }),
    (error) => error.status === 403
  );

  const first = await quote(500, 1200);
  assert.equal(first.total, 1700);
  assert.equal(await hasAcceptedQuote(requestId), false);

  // Una nueva reemplaza a la que no se ha contestado.
  const second = await quote(450, 1200);
  const statuses = Object.fromEntries((await getQuotesForRequest(requestId)).map((row) => [row.id, row.status]));
  assert.equal(statuses[first.id], "replaced");
  assert.equal(statuses[second.id], "pending");
  await assert.rejects(
    respondToQuote({ requestId, quoteId: first.id, customerId: customer.lastID, accept: true }),
    (error) => error.status === 409,
    "la reemplazada ya no se puede aceptar"
  );

  // Solo el cliente de la solicitud contesta.
  await assert.rejects(
    respondToQuote({ requestId, quoteId: second.id, customerId: customer.lastID + 100000, accept: true }),
    (error) => error.status === 403
  );

  const rejected = await respondToQuote({ requestId, quoteId: second.id, customerId: customer.lastID, accept: false });
  assert.equal(rejected.status, "rejected");
  assert.equal(await hasAcceptedQuote(requestId), false);

  const third = await quote(400, 1000);
  await respondToQuote({ requestId, quoteId: third.id, customerId: customer.lastID, accept: true });
  assert.equal(await hasAcceptedQuote(requestId), true);

  // Algo adicional ya reparando: se suma a lo acordado si lo acepta.
  await run("UPDATE service_requests SET status = 'repairing' WHERE id = ?", [requestId]);
  const extra = await quote(0, 300);
  await respondToQuote({ requestId, quoteId: extra.id, customerId: customer.lastID, accept: true });
  const due = await amountDueForRequest(requestId);
  assert.equal(due.labor, 400);
  assert.equal(due.partsToBuyEstimate, 1300, "las refacciones a comprar quedan como estimado");
  assert.equal(due.repairTotal, 400, "sin ticket no se cobran refacciones compradas");
});

test("cobro: el precio de la visita queda fijo al aceptar y se suma a lo cotizado", async () => {
  const mechanicId = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro");
  await run("UPDATE mechanics SET labor_rate = 400 WHERE id = ?", [mechanicId]);
  const { requestId } = await createCompletedRequest(mechanicId);
  await run("UPDATE service_requests SET status = 'assigned' WHERE id = ?", [requestId]);
  await lockVisitFee(requestId, mechanicId);

  // Si el mecánico sube su tarifa después de aceptar, este servicio no cambia.
  await run("UPDATE mechanics SET labor_rate = 900 WHERE id = ?", [mechanicId]);
  // Cotización anterior a los tickets (sin parts_on_hand_amount): sus
  // refacciones se cobran fijas, como antes.
  await run(
    "INSERT INTO service_quotes (service_request_id, mechanic_id, labor_amount, parts_amount, description, status) VALUES (?, ?, 600, 1200, 'Cambio de batería', 'accepted')",
    [requestId, mechanicId]
  );
  const due = await amountDueForRequest(requestId);
  assert.equal(due.visitFee, 400);
  assert.equal(due.repairTotal, 1800);
  assert.equal(due.total, 2200);
});

async function createRequestInStatus(mechanicId, status) {
  const { requestId, customerId } = await createCompletedRequest(mechanicId);
  await run("UPDATE service_requests SET status = ? WHERE id = ?", [status, requestId]);
  return { requestId, customerId };
}

const fakePhoto = async () => "https://example.test/ticket.jpg";

test("ticket: las refacciones compradas se cobran a precio de ticket, con tope en lo estimado salvo que el cliente apruebe", async () => {
  const mechanicId = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro");
  const { requestId, customerId } = await createRequestInStatus(mechanicId, "diagnosing");
  const quote = await createQuote({
    requestId,
    mechanicId,
    laborAmount: 600,
    partsAmount: 1200,
    partsOnHandAmount: 150,
    description: "Cambio de batería y terminales"
  });
  assert.equal(quote.total, 1950);
  assert.equal(quote.partsAreEstimate, true);
  await respondToQuote({ requestId, quoteId: quote.id, customerId, accept: true });
  await run("UPDATE service_requests SET status = 'awaiting_parts' WHERE id = ?", [requestId]);
  await startPartsTrip(requestId);
  assert.equal(await isPartsTripOpen(requestId), true);

  // Con ticket y dentro de lo estimado: se acepta solo y cierra la salida.
  const first = await createReceipt({ requestId, mechanicId, amount: 950, hasTicket: true, savePhoto: fakePhoto });
  assert.equal(first.receipt.status, "accepted");
  assert.equal(first.receipt.chargedAmount, 950);
  assert.equal(await isPartsTripOpen(requestId), false);
  let due = await amountDueForRequest(requestId);
  assert.deepEqual([due.labor, due.partsOnHand, due.partsBought, due.total], [600, 150, 950, 1700]);

  // Otro que pasa de lo estimado: espera al cliente y cuenta solo lo que cabe.
  const second = await createReceipt({ requestId, mechanicId, amount: 400, hasTicket: true, savePhoto: fakePhoto });
  assert.equal(second.receipt.status, "pending");
  assert.equal(second.overEstimate, true);
  assert.equal(second.receipt.chargedAmount, 250);
  assert.equal(await hasPendingReceipt(requestId), true);

  // Solo el cliente del servicio contesta, y una sola vez.
  await assert.rejects(
    respondToReceipt({ requestId, receiptId: second.receipt.id, customerId: customerId + 100000, accept: true }),
    (error) => error instanceof ReceiptError && error.status === 403
  );
  const rejected = await respondToReceipt({ requestId, receiptId: second.receipt.id, customerId, accept: false });
  assert.equal(rejected.receipt.chargedAmount, 250, "si no lo aprueba, se cobra hasta lo estimado");
  await assert.rejects(
    respondToReceipt({ requestId, receiptId: second.receipt.id, customerId, accept: true }),
    (error) => error.status === 409
  );
  assert.equal((await amountDueForRequest(requestId)).partsBought, 1200);

  // Sin ticket siempre lo aprueba el cliente; aprobado, se cobra completo.
  const noTicket = await createReceipt({ requestId, mechanicId, amount: 100, hasTicket: false, savePhoto: fakePhoto });
  assert.equal(noTicket.receipt.status, "pending");
  assert.equal(noTicket.receipt.chargedAmount, 0);
  await respondToReceipt({ requestId, receiptId: noTicket.receipt.id, customerId, accept: true });
  due = await amountDueForRequest(requestId);
  assert.equal(due.partsBought, 1300);
  assert.equal(await hasPendingReceipt(requestId), false);
});

test("ticket: solo lo sube el mecánico del servicio, en refacciones o reparación, y 'no compré nada' cierra la salida", async () => {
  const mechanicId = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro");
  const { requestId } = await createRequestInStatus(mechanicId, "diagnosing");
  let photoSaved = false;
  const trackPhoto = async () => {
    photoSaved = true;
    return "https://example.test/ticket.jpg";
  };

  await assert.rejects(
    createReceipt({ requestId, mechanicId, amount: 100, hasTicket: true, savePhoto: trackPhoto }),
    (error) => error instanceof ReceiptError && error.status === 409
  );
  await run("UPDATE service_requests SET status = 'awaiting_parts' WHERE id = ?", [requestId]);
  await assert.rejects(
    createReceipt({ requestId, mechanicId: mechanicId + 100000, amount: 100, hasTicket: true, savePhoto: trackPhoto }),
    (error) => error.status === 403
  );
  assert.equal(photoSaved, false, "la foto no se guarda si no pasa la validación");

  await startPartsTrip(requestId);
  await declareNoPurchase(requestId, mechanicId);
  assert.equal(await isPartsTripOpen(requestId), false);
  await run("UPDATE service_requests SET status = 'repairing' WHERE id = ?", [requestId]);
  await assert.rejects(declareNoPurchase(requestId, mechanicId), (error) => error.status === 409);
});

test("ajuste: solo baja lo acordado; aceptado reemplaza lo anterior y rechazado lo deja igual", async () => {
  const mechanicId = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro");
  const { requestId, customerId } = await createRequestInStatus(mechanicId, "diagnosing");
  const adjust = (laborAmount) =>
    createQuote({ requestId, mechanicId, laborAmount, partsAmount: 0, description: "Solo diagnóstico: la pieza no estaba", kind: "adjustment" });

  // Sin nada acordado no hay qué ajustar.
  await assert.rejects(adjust(100), (error) => error instanceof QuoteError && error.status === 409);

  const original = await createQuote({ requestId, mechanicId, laborAmount: 600, partsAmount: 1200, partsOnHandAmount: 150, description: "Cambio de batería" });
  await respondToQuote({ requestId, quoteId: original.id, customerId, accept: true });
  await run("UPDATE service_requests SET status = 'repairing' WHERE id = ?", [requestId]);

  // Un ajuste que no baja lo acordado se rechaza: para subir está "adicional".
  await assert.rejects(adjust(1950), (error) => error.status === 409);

  const rejected = await adjust(300);
  assert.equal(rejected.kind, "adjustment");
  assert.equal(await hasPendingAdjustment(requestId), true);
  await respondToQuote({ requestId, quoteId: rejected.id, customerId, accept: false });
  assert.equal((await amountDueForRequest(requestId)).labor, 600, "si no lo aprueba, sigue lo de antes");

  const accepted = await adjust(300);
  await respondToQuote({ requestId, quoteId: accepted.id, customerId, accept: true });
  const statuses = Object.fromEntries((await getQuotesForRequest(requestId)).map((row) => [row.id, row.status]));
  assert.equal(statuses[original.id], "replaced");
  assert.equal(statuses[accepted.id], "accepted");
  const due = await amountDueForRequest(requestId);
  assert.deepEqual([due.labor, due.partsOnHand, due.partsToBuyEstimate], [300, 0, 0]);
  assert.equal(await hasPendingAdjustment(requestId), false);
});

test("ticket: 'voy a otra tienda' solo mientras va por refacciones", async () => {
  const mechanicId = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro");
  const { requestId, customerId } = await createRequestInStatus(mechanicId, "repairing");
  await assert.rejects(customerForPartsTrip(requestId, mechanicId), (error) => error.status === 409);
  await run("UPDATE service_requests SET status = 'awaiting_parts' WHERE id = ?", [requestId]);
  await assert.rejects(customerForPartsTrip(requestId, mechanicId + 100000), (error) => error.status === 403);
  assert.equal(await customerForPartsTrip(requestId, mechanicId), customerId);
});

test("visita de regreso: queda ligada, asignada al mismo mecánico y sin cobro de visita", async () => {
  const mechanicId = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro");
  await run("UPDATE mechanics SET labor_rate = 400 WHERE id = ?", [mechanicId]);
  const { requestId, customerId } = await createRequestInStatus(mechanicId, "en_route");
  const schedule = (id = mechanicId) =>
    createReturnVisit({ requestId, mechanicId: id, when: "Jueves 10:00", pendingWork: "Instalar la bomba de gasolina pedida" });

  // Todavía no ve el auto; y solo el mecánico del servicio.
  await assert.rejects(schedule(), (error) => error instanceof ReturnVisitError && error.status === 409);
  await run("UPDATE service_requests SET status = 'repairing' WHERE id = ?", [requestId]);
  await assert.rejects(schedule(mechanicId + 100000), (error) => error.status === 403);

  const { returnRequestId } = await schedule();
  createdRows.requests.push(returnRequestId);
  const created = await get(
    "SELECT customer_id, mechanic_id, status, visit_fee, parent_request_id, preferred_time, assignment_mode FROM service_requests WHERE id = ?",
    [returnRequestId]
  );
  assert.deepEqual(
    [created.customer_id, created.mechanic_id, created.status, created.visit_fee, created.parent_request_id, created.preferred_time, created.assignment_mode],
    [customerId, mechanicId, "assigned", 0, requestId, "Jueves 10:00", "direct"]
  );
  assert.equal((await amountDueForRequest(returnRequestId)).visitFee, 0, "no se cobra otra visita");
  assert.equal((await getReturnVisit(requestId))?.id, returnRequestId);
  await assert.rejects(schedule(), (error) => error.status === 409, "una sola visita de regreso abierta");
});

test("ticket: la pieza pedida queda marcada y se cobra como cualquier ticket", async () => {
  const mechanicId = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro");
  const { requestId, customerId } = await createRequestInStatus(mechanicId, "diagnosing");
  const quote = await createQuote({ requestId, mechanicId, laborAmount: 300, partsAmount: 2000, description: "Cambio de bomba de gasolina" });
  await respondToQuote({ requestId, quoteId: quote.id, customerId, accept: true });
  await run("UPDATE service_requests SET status = 'repairing' WHERE id = ?", [requestId]);
  const ordered = await createReceipt({ requestId, mechanicId, amount: 1800, hasTicket: true, ordered: true, savePhoto: fakePhoto });
  assert.equal(ordered.receipt.ordered, true);
  assert.equal(ordered.receipt.status, "accepted");
  assert.equal((await amountDueForRequest(requestId)).partsBought, 1800);
});

test("cancelar: gratis antes de salir y en los primeros 5 min; mitad en camino; visita completa si ya llegó", async () => {
  const mechanicId = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro");
  await run("UPDATE mechanics SET labor_rate = 400 WHERE id = ?", [mechanicId]);
  const { requestId } = await createRequestInStatus(mechanicId, "assigned");
  const at = (status, column, minutesAgo) =>
    run(`UPDATE service_requests SET status = ?, ${column} = datetime('now', ?) WHERE id = ?`, [status, `-${minutesAgo} minutes`, requestId]);
  const quote = () => cancellationQuote(requestId);

  await at("assigned", "accepted_at", 10);
  assert.deepEqual([(await quote()).fee, (await quote()).reason], [0, "free_not_departed"]);
  await at("assigned", "accepted_at", 61);
  assert.equal((await quote()).reason, "free_mechanic_late", "aceptó hace más de una hora y no ha salido");

  await at("en_route", "en_route_at", 3);
  assert.deepEqual([(await quote()).fee, (await quote()).reason], [0, "free_grace"]);
  await at("en_route", "en_route_at", 10);
  assert.deepEqual([(await quote()).fee, (await quote()).reason], [200, "half_visit"]);
  await at("en_route", "en_route_at", 70);
  assert.equal((await quote()).reason, "free_mechanic_late", "salió hace más de una hora y no llega");

  await at("on_site", "arrived_at", 1);
  assert.deepEqual([(await quote()).fee, (await quote()).reason], [400, "full_visit"]);

  await run("UPDATE service_requests SET status = 'repairing' WHERE id = ?", [requestId]);
  const blocked = await quote();
  assert.equal(blocked.allowed, false, "ya reparando no se cancela desde la app");
  assert.equal(blocked.reason, "work_started");
});

test("cliente ausente: a los 15 min, cerca de la dirección y con foto; se cobra la visita con el cobro normal", async () => {
  const mechanicId = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro");
  await run("UPDATE mechanics SET labor_rate = 400 WHERE id = ?", [mechanicId]);
  const { requestId, customerId } = await createRequestInStatus(mechanicId, "on_site");
  await run("UPDATE service_requests SET latitude = 21.8818, longitude = -102.2916, arrived_at = datetime('now', '-5 minutes') WHERE id = ?", [
    requestId
  ]);
  const mark = (coords) => markCustomerAbsent({ requestId, mechanicId, ...coords, savePhoto: fakePhoto });

  await assert.rejects(mark({ latitude: 21.8818, longitude: -102.2916 }), (error) => error instanceof CancellationError && error.status === 409);
  await run("UPDATE service_requests SET arrived_at = datetime('now', '-16 minutes') WHERE id = ?", [requestId]);
  await assert.rejects(mark({ latitude: 21.95, longitude: -102.2916 }), (error) => /No estás en la dirección/.test(error.message));
  await assert.rejects(mark({}), (error) => /Activa tu ubicación/.test(error.message));

  const result = await mark({ latitude: 21.8819, longitude: -102.2915 });
  assert.equal(result.fee, 400);
  const row = await get("SELECT status, cancel_reason, cancellation_fee, absence_photo_url FROM service_requests WHERE id = ?", [requestId]);
  assert.deepEqual([row.status, row.cancel_reason, row.cancellation_fee, row.absence_photo_url], ["cancelled", "customer_absent", 400, "https://example.test/ticket.jpg"]);
  assert.equal((await amountDueForRequest(requestId)).total, 400);
  // Se paga con la misma doble confirmación que un servicio terminado.
  await customerConfirmsPayment(requestId, customerId, "cash");
  await mechanicConfirmsPayment(requestId, mechanicId);
});

test("cliente ausente: el aviso de los 10 min sale una sola vez", async () => {
  const mechanicId = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro");
  const { requestId } = await createRequestInStatus(mechanicId, "on_site");
  await run("UPDATE service_requests SET arrived_at = datetime('now', '-11 minutes') WHERE id = ?", [requestId]);
  await sweepArrivalReminders();
  const first = await get("SELECT absence_reminder_at FROM service_requests WHERE id = ?", [requestId]);
  assert.ok(first.absence_reminder_at);
  await sweepArrivalReminders();
  const second = await get("SELECT absence_reminder_at FROM service_requests WHERE id = ?", [requestId]);
  assert.equal(second.absence_reminder_at, first.absence_reminder_at);
});

test("ya no puedo ir: antes de llegar la solicitud vuelve a buscar mecánico y queda en su historial", async () => {
  const mechanicId = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro");
  const { requestId } = await createRequestInStatus(mechanicId, "en_route");
  await mechanicWithdraws({ requestId, mechanicId, reason: "Se me ponchó una llanta" });
  const row = await get("SELECT status, mechanic_id, visit_fee FROM service_requests WHERE id = ?", [requestId]);
  assert.deepEqual([row.status, row.mechanic_id], ["pending", null]);
  assert.equal(await recentWithdrawals(mechanicId), 1);
  await run("DELETE FROM mechanic_withdrawals WHERE service_request_id = ?", [requestId]);

  // Ya llegó: no se suelta así; y una visita de regreso tampoco.
  const arrived = await createRequestInStatus(mechanicId, "on_site");
  await assert.rejects(mechanicWithdraws({ requestId: arrived.requestId, mechanicId }), (error) => error.status === 409);
  await run("UPDATE service_requests SET status = 'assigned', parent_request_id = ? WHERE id = ?", [requestId, arrived.requestId]);
  await assert.rejects(mechanicWithdraws({ requestId: arrived.requestId, mechanicId }), (error) => /visita de regreso/.test(error.message));
});

test("comisión: 10 % de visita y mano de obra, entre $30 y $300, y nunca más de lo que cobró", () => {
  assert.equal(commissionFor(0), 0);
  assert.equal(commissionFor(25), 25, "no puede deber más de lo que cobró");
  assert.equal(commissionFor(200), 30, "mínimo $30");
  assert.equal(commissionFor(1500), 150);
  assert.equal(commissionFor(5000), 300, "tope $300");
});

async function completedWithAmounts(mechanicId, visit = 400, labor = 600) {
  const { requestId, customerId } = await createCompletedRequest(mechanicId);
  await run("UPDATE service_requests SET visit_fee = ? WHERE id = ?", [visit, requestId]);
  // Refacciones de $900: no cuentan para la comisión.
  await run(
    "INSERT INTO service_quotes (service_request_id, mechanic_id, labor_amount, parts_amount, parts_on_hand_amount, description, status) VALUES (?, ?, ?, 900, 0, 'Trabajo', 'accepted')",
    [requestId, mechanicId, labor]
  );
  return { requestId, customerId };
}

test("comisión: se registra al terminar, sin refacciones, y es gratis 30 días desde su primer servicio", async () => {
  const mechanicId = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro");
  // Cuenta vieja sin servicios: sus días gratis no se gastaron esperando.
  await run("UPDATE mechanics SET created_at = datetime('now', '-90 days') WHERE id = ?", [mechanicId]);
  const before = await mechanicCommissionSummary(mechanicId);
  assert.equal(before.freeNotStarted, true);
  assert.equal(before.freeUntil, null);

  const first = await completedWithAmounts(mechanicId);
  assert.deepEqual(await recordCommission(first.requestId), { commission: 100, waived: true });
  assert.deepEqual(await recordCommission(first.requestId), { commission: 100, waived: true }, "una sola por servicio");
  const after = await mechanicCommissionSummary(mechanicId);
  assert.equal(after.freeNotStarted, false);
  assert.ok(after.freeUntil, "sus 30 días empezaron con este servicio");

  // 40 días después de su primer servicio ya paga.
  await run("UPDATE commission_charges SET created_at = datetime('now', '-40 days') WHERE service_request_id = ?", [first.requestId]);
  const second = await completedWithAmounts(mechanicId);
  assert.deepEqual(await recordCommission(second.requestId), { commission: 100, waived: false });
});

test("comisión: el corte semanal junta lo pagado (o sin reporte en 48 h), una vez por semana; vencido bloquea conectarse", async () => {
  const mechanicId = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro");
  await run("UPDATE mechanics SET created_at = datetime('now', '-60 days') WHERE id = ?", [mechanicId]);
  const now = new Date();
  const daysAgo = (days) => new Date(now.getTime() - days * 86_400_000);
  // Su primer servicio fue hace 60 días: ya pasaron sus días gratis.
  const oldest = await completedWithAmounts(mechanicId);
  await recordCommission(oldest.requestId, daysAgo(60));

  const paid = await completedWithAmounts(mechanicId);
  await recordCommission(paid.requestId, daysAgo(1));
  await run("UPDATE service_requests SET paid_at = CURRENT_TIMESTAMP WHERE id = ?", [paid.requestId]);
  const unpaid = await completedWithAmounts(mechanicId);
  await recordCommission(unpaid.requestId, daysAgo(3));
  await run("UPDATE service_requests SET unpaid_reported_at = CURRENT_TIMESTAMP WHERE id = ?", [unpaid.requestId]);
  const quiet = await completedWithAmounts(mechanicId, 400, 1100);
  await recordCommission(quiet.requestId, daysAgo(3));
  const fresh = await completedWithAmounts(mechanicId);
  await recordCommission(fresh.requestId, now);

  const created = (await generateWeeklyStatements(now)).filter((statement) => statement.mechanicId === mechanicId);
  assert.equal(created.length, 1);
  assert.equal(created[0].services, 2, "el pagado y el que lleva 48 h sin reporte; no el reportado ni el recién terminado");
  assert.equal(created[0].total, 100 + 150);
  assert.equal((await generateWeeklyStatements(now)).filter((statement) => statement.mechanicId === mechanicId).length, 0, "una vez por semana");

  // Vencido: no se puede conectar hasta pagarlo.
  await run("UPDATE commission_statements SET due_at = datetime('now', '-1 day') WHERE id = ?", [created[0].id]);
  const blocked = await applyMechanicConnection(mechanicId, true, true);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /corte de comisiones vencido/);
  await markStatementPaid(created[0].id, "manual");
  assert.equal((await applyMechanicConnection(mechanicId, true, true)).ok, true);

  const summary = await mechanicCommissionSummary(mechanicId);
  assert.equal(summary.statements[0].status, "paid");
  const states = Object.fromEntries(summary.charges.map((charge) => [charge.requestId, charge.state]));
  assert.equal(states[unpaid.requestId], "on_hold", "no paga comisión de lo que no le pagaron");
  assert.equal(states[fresh.requestId], "next");
});

test("comisión: un servicio de antes del lanzamiento no gasta los días gratis (cuentan desde el lanzamiento)", async () => {
  const mechanicId = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro");
  await run("UPDATE mechanics SET created_at = datetime('now', '-90 days') WHERE id = ?", [mechanicId]);
  const previous = process.env.COMMISSION_LAUNCH_DATE;
  process.env.COMMISSION_LAUNCH_DATE = new Date(Date.now() - 5 * 86_400_000).toISOString();
  try {
    // Un servicio de hace 20 días (antes del lanzamiento, hace 5): sus 30 días
    // cuentan desde el lanzamiento, así que le quedan unos 25.
    const beforeLaunch = await completedWithAmounts(mechanicId);
    await recordCommission(beforeLaunch.requestId, new Date(Date.now() - 20 * 86_400_000));
    const { requestId } = await completedWithAmounts(mechanicId);
    assert.deepEqual(await recordCommission(requestId), { commission: 100, waived: true });
    assert.ok((await mechanicCommissionSummary(mechanicId)).freeUntil, "le quedan días gratis");
  } finally {
    process.env.COMMISSION_LAUNCH_DATE = previous;
  }
});

test("comisiones: las rutas piden sesión", async () => {
  assert.equal((await request("/api/mechanics/me/commissions")).response.status, 401);
  const { response } = await request("/api/mechanics/me/commission-statements/1/checkout", { method: "POST", body: "{}" });
  assert.equal(response.status, 401);
});

test("cancelaciones: las rutas piden sesión", async () => {
  const { response: quoteResponse } = await request("/api/service-requests/1/cancellation-quote");
  assert.equal(quoteResponse.status, 401);
  for (const path of ["customer-absent", "withdraw"]) {
    const { response } = await request(`/api/service-requests/1/${path}`, { method: "POST", body: "{}" });
    assert.equal(response.status, 401, path);
  }
});

test("ticket: las rutas piden sesión", async () => {
  for (const path of ["parts-receipts", "parts-receipts/1/respond", "parts-trip/none", "parts-trip/next-store"]) {
    const { response } = await request(`/api/service-requests/1/${path}`, { method: "POST", body: "{}" });
    assert.equal(response.status, 401, path);
  }
});

async function createCompletedRequest(mechanicId) {
  const customer = await run("INSERT INTO customers (full_name, phone) VALUES (?, ?)", ["Cliente Pago", uniquePhone()]);
  createdRows.customers.push(customer.lastID);
  const created = await run(
    `INSERT INTO service_requests (customer_id, vehicle_make, vehicle_model, vehicle_year, issue_description, preferred_time,
       city, zone, status, mechanic_id)
     VALUES (?, 'Nissan', 'Versa', 2018, 'No enciende', '', 'Ciudad-Pago', 'Centro', 'completed', ?)`,
    [customer.lastID, mechanicId]
  );
  createdRows.requests.push(created.lastID);
  return { requestId: created.lastID, customerId: customer.lastID };
}

const openPaymentDisputes = (requestId) =>
  all(
    "SELECT category, opened_by AS openedBy, status FROM disputes WHERE service_request_id = ? AND category IN ('unpaid', 'payment_disagreement')",
    [requestId]
  );

test("cobro: si los dos confirman, queda saldado sin disputa", async () => {
  const mechanicId = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro");
  const { requestId, customerId } = await createCompletedRequest(mechanicId);

  // Solo los del servicio pueden confirmar.
  await assert.rejects(customerConfirmsPayment(requestId, customerId + 100000, "cash"), (error) => error.status === 403);
  await assert.rejects(mechanicConfirmsPayment(requestId, mechanicId + 100000), (error) => error.status === 403);

  const byCustomer = await customerConfirmsPayment(requestId, customerId, "transfer");
  assert.equal(byCustomer.disagreement, false);
  assert.equal((await customerConfirmsPayment(requestId, customerId, "cash")).unchanged, true, "confirmar dos veces no hace nada");
  await mechanicConfirmsPayment(requestId, mechanicId);

  const row = await get("SELECT paid_at, customer_paid_at, payment_method FROM service_requests WHERE id = ?", [requestId]);
  assert.ok(row.paid_at && row.customer_paid_at);
  assert.equal(row.payment_method, "transfer");
  assert.deepEqual(await openPaymentDisputes(requestId), []);
  await assert.rejects(mechanicReportsUnpaid(requestId, mechanicId), (error) => error instanceof ServicePaymentError && error.status === 409);
});

test("cobro: si el mecánico reporta que no le pagaron, el cliente no puede pedir otro hasta pagar o decir que ya pagó", async () => {
  const mechanicId = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro");
  const { requestId, customerId } = await createCompletedRequest(mechanicId);

  await mechanicReportsUnpaid(requestId, mechanicId);
  assert.equal((await unpaidServiceForCustomer(customerId))?.requestId, requestId);
  assert.deepEqual(await openPaymentDisputes(requestId), [{ category: "unpaid", openedBy: "mechanic", status: "reported" }]);

  // El cliente dice que sí pagó: ya no se le bloquea (queda su versión) y
  // pasa a desacuerdo para que lo revise un admin.
  const change = await customerConfirmsPayment(requestId, customerId, "cash");
  assert.equal(change.disagreement, true);
  assert.equal(await unpaidServiceForCustomer(customerId), null);
  assert.deepEqual(await openPaymentDisputes(requestId), [{ category: "payment_disagreement", openedBy: "system", status: "reported" }]);

  // Si luego el mecánico encuentra el pago, lo confirma y la disputa se cierra.
  await mechanicConfirmsPayment(requestId, mechanicId);
  assert.deepEqual(await openPaymentDisputes(requestId), [{ category: "payment_disagreement", openedBy: "system", status: "resolved" }]);
});

test("cobro: si el cliente dice que pagó y el mecánico que no, se abre un desacuerdo sin bloquear al cliente", async () => {
  const mechanicId = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro");
  const { requestId, customerId } = await createCompletedRequest(mechanicId);

  await customerConfirmsPayment(requestId, customerId, "transfer");
  const change = await mechanicReportsUnpaid(requestId, mechanicId);
  assert.equal(change.disagreement, true);
  assert.equal(await unpaidServiceForCustomer(customerId), null);
  assert.deepEqual(await openPaymentDisputes(requestId), [{ category: "payment_disagreement", openedBy: "system", status: "reported" }]);
});

test("cobro: el pago solo se confirma en un servicio terminado", async () => {
  const mechanicId = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro");
  const { requestId, customerId } = await createCompletedRequest(mechanicId);
  await run("UPDATE service_requests SET status = 'repairing' WHERE id = ?", [requestId]);
  await assert.rejects(customerConfirmsPayment(requestId, customerId, "cash"), (error) => error.status === 409);
  await assert.rejects(mechanicReportsUnpaid(requestId, mechanicId), (error) => error.status === 409);
});

test("cobro: las rutas de pago piden sesión", async () => {
  for (const path of ["customer-confirm", "received", "unpaid"]) {
    const { response } = await request(`/api/service-requests/1/payment/${path}`, { method: "POST", body: "{}" });
    assert.equal(response.status, 401, path);
  }
});

test("propina: la CLABE se valida con su dígito de control", () => {
  assert.equal(isValidClabe("032180000118359719"), true);
  assert.equal(isValidClabe("032180000118359718"), false, "dígito de control equivocado");
  assert.equal(isValidClabe("03218000011835971"), false, "17 dígitos");
  assert.equal(isValidClabe("0321800001183597a9"), false);
});

test("propina: sin sesión no se ven los datos para dejar propina", async () => {
  const { response } = await request("/api/service-requests/1/tip-info");
  assert.equal(response.status, 401);
});

test("propina: solo el cliente de un servicio terminado ve la CLABE del mecánico", async () => {
  const mechanicId = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro");
  await assert.rejects(
    saveMechanicTipInfo(mechanicId, "032180000118359718", "Juan Pérez"),
    (error) => error instanceof TipError && error.status === 400
  );
  await saveMechanicTipInfo(mechanicId, "032180000118359719", "Juan Pérez");

  const customer = await run("INSERT INTO customers (full_name, phone) VALUES (?, ?)", ["Cliente Propina", uniquePhone()]);
  createdRows.customers.push(customer.lastID);
  const created = await run(
    `INSERT INTO service_requests (customer_id, vehicle_make, vehicle_model, vehicle_year, issue_description, preferred_time,
       city, zone, status, mechanic_id)
     VALUES (?, 'Nissan', 'Versa', 2018, 'No enciende', '', 'Ciudad-Propina', 'Centro', 'on_site', ?)`,
    [customer.lastID, mechanicId]
  );
  createdRows.requests.push(created.lastID);
  const owner = { role: "customer", customerId: customer.lastID };

  await assert.rejects(getTipInfoForRequest(created.lastID, owner), (error) => error.status === 409, "todavía no termina");

  await run("UPDATE service_requests SET status = 'completed' WHERE id = ?", [created.lastID]);
  const info = await getTipInfoForRequest(created.lastID, owner);
  assert.equal(info.clabe, "032180000118359719");
  assert.equal(info.holderName, "Juan Pérez");

  for (const stranger of [{ role: "customer", customerId: customer.lastID + 100000 }, { role: "mechanic", customerId: null }]) {
    await assert.rejects(getTipInfoForRequest(created.lastID, stranger), (error) => error instanceof TipError && error.status === 403);
  }

  // La CLABE nunca sale en el listado público de mecánicos.
  const { body } = await request(`/mechanics?city=${encodeURIComponent("x")}`);
  assert.ok(!JSON.stringify(body).includes("032180000118359719"));
});

// --- Conexión del mecánico ---

async function createRegisteredMechanic(status, profilePhotoUrl = "https://example.test/uploads/cara.jpg") {
  // Igual que un registro real: is_available = 0, is_online = 0.
  const result = await run(
    `INSERT INTO mechanics (full_name, phone, city, zone, years_experience, specialties, status, is_available, is_online, profile_photo_url)
     VALUES ('Mecánico Nuevo', ?, ?, 'Centro', 1, '["Motor"]', ?, 0, 0, ?)`,
    [uniquePhone(), `Ciudad-${crypto.randomUUID()}`, status, profilePhotoUrl]
  );
  createdRows.mechanics.push(result.lastID);
  return result.lastID;
}

test("comunidad y promociones: flujo completo con sesión simulada", async () => {
  // Las rutas reales con la base real; solo la sesión se simula (en los tests
  // no hay tokens de Supabase).
  const express = require("express");
  const { ZodError } = require("zod");
  const { createCommunityRouter } = require("../src/routes/community.ts");

  const tag = crypto.randomUUID().slice(0, 8);
  const mechanicId = await createOnlineMechanic(`Ciudad-${tag}`, "Centro", { latitude: -40, longitude: -150 });
  async function createUser(role, fullName, linkedMechanicId = null) {
    const supabaseUserId = crypto.randomUUID();
    const login = `${supabaseUserId}@example.test`;
    const result = await run(
      `INSERT INTO users (role, login, supabase_user_id, full_name, password_salt, password_hash, mechanic_id)
       VALUES (?, ?, ?, ?, 'x', 'x', ?)`,
      [role, login, supabaseUserId, fullName, linkedMechanicId]
    );
    return { id: result.lastID, role, login, fullName, customerId: null, mechanicId: linkedMechanicId };
  }
  const users = {
    customer: await createUser("customer", `Emilio López ${tag}`),
    follower: await createUser("customer", "Ana Ruiz"),
    mechanic: await createUser("mechanic", "Ricardo López", mechanicId)
  };

  const notifications = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const who = req.header("x-test-user");
    if (who) req.auth = { user: users[who], token: "test" };
    next();
  });
  app.use("/api", createCommunityRouter({
    createNotification: async (userId, title) => { notifications.push({ userId, title }); },
    calculateDistanceKm: (latA, lngA, latB, lngB) => Math.hypot(latA - latB, lngA - lngB) * 111,
    applyRateLimit: () => false
  }));
  app.use((error, _req, res, _next) => {
    res.status(error instanceof ZodError ? 400 : 500).json({ error: String(error?.message ?? error) });
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  const base = `http://localhost:${server.address().port}/api`;
  async function call(who, method, path, body) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "x-test-user": who },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, body: await response.json() };
  }

  let questionId = null;
  try {
    const created = await call("customer", "POST", "/community/questions", {
      title: `Frenos que chillan ${tag}`,
      body: "Suena solo el freno delantero izquierdo al frenar.",
      category: "frenos",
      vehicleLabel: "Toyota 4Runner 2004"
    });
    assert.equal(created.status, 201);
    questionId = created.body.id;

    const found = await call("mechanic", "GET", `/community/questions?q=${encodeURIComponent(tag)}&category=frenos`);
    assert.equal(found.body.questions.length, 1);
    assert.equal(found.body.questions[0].authorName, "Emilio L.");
    assert.equal(found.body.questions[0].isMine, false);

    // Otra persona sigue la pregunta; el autor no puede seguir la suya.
    assert.deepEqual((await call("follower", "POST", `/community/questions/${questionId}/follow`)).body, { active: true, count: 1 });
    assert.equal((await call("customer", "POST", `/community/questions/${questionId}/follow`)).status, 400);

    const answer = await call("mechanic", "POST", `/community/questions/${questionId}/answers`, {
      body: "Cambia las pastillas de ambos lados del eje y revisa el disco."
    });
    assert.equal(answer.status, 201);
    // Avisa al autor y a quien la sigue.
    assert.deepEqual(notifications.map((notification) => notification.userId), [users.customer.id, users.follower.id]);

    const customerAnswer = await call("customer", "POST", `/community/questions/${questionId}/answers`, {
      body: "No soy mecánico pero quiero responder"
    });
    assert.equal(customerAnswer.status, 403);

    assert.deepEqual((await call("customer", "POST", `/community/answers/${answer.body.id}/helpful`)).body, { active: true, count: 1 });

    const detail = await call("customer", "GET", `/community/questions/${questionId}`);
    assert.equal(detail.body.question.answerCount, 1);
    assert.equal(detail.body.question.followerCount, 1);
    assert.equal(detail.body.answers[0].mechanicVerified, true);
    assert.equal(detail.body.answers[0].helpfulByMe, true);

    const mine = await call("customer", "GET", "/community/questions?scope=mine");
    assert.ok(mine.body.questions.some((question) => question.id === questionId));

    const promotion = await call("mechanic", "POST", "/promotions", {
      title: "Revisión de frenos gratis",
      description: "Al contratar cualquier servicio conmigo."
    });
    assert.equal(promotion.status, 201);
    const nearby = await call("customer", "GET", `/promotions?latitude=-40.01&longitude=-150&mechanicId=${mechanicId}`);
    assert.equal(nearby.body.promotions.length, 1);
    assert.ok(nearby.body.promotions[0].distanceKm < 5);
    const expired = await call("mechanic", "POST", "/promotions", {
      title: "Promoción vieja",
      description: "Esta fecha ya pasó hace mucho.",
      validUntil: "2020-01-01"
    });
    assert.equal(expired.status, 400);
    assert.equal((await call("mechanic", "PATCH", `/promotions/${promotion.body.id}`, { isActive: false })).status, 200);
    assert.equal((await call("customer", "GET", `/promotions?mechanicId=${mechanicId}`)).body.promotions.length, 0);
    assert.equal((await call("mechanic", "GET", "/promotions/mine")).body.promotions[0].isActive, false);

    assert.equal((await call("customer", "DELETE", `/community/questions/${questionId}`)).status, 200);
    assert.equal((await call("customer", "GET", `/community/questions/${questionId}`)).status, 404);
    questionId = null;
  } finally {
    server.close();
    if (questionId) {
      await run("DELETE FROM community_reactions WHERE user_id IN (?, ?, ?)", [users.customer.id, users.follower.id, users.mechanic.id]);
      await run("DELETE FROM community_answers WHERE question_id = ?", [questionId]);
      await run("DELETE FROM community_questions WHERE id = ?", [questionId]);
    }
    await run("DELETE FROM mechanic_promotions WHERE mechanic_id = ?", [mechanicId]);
    await run("DELETE FROM users WHERE id IN (?, ?, ?)", [users.customer.id, users.follower.id, users.mechanic.id]);
  }
});

test("eliminar cuenta de cliente: borra lo personal y anonimiza el historial compartido", async () => {
  const tag = crypto.randomUUID().slice(0, 8);
  const customer = await run("INSERT INTO customers (full_name, phone) VALUES (?, ?)", [`Cliente ${tag}`, uniquePhone()]);
  createdRows.customers.push(customer.lastID);
  const mechanicId = await createOnlineMechanic(`Ciudad-${tag}`, "Centro");
  const supabaseUserId = crypto.randomUUID();
  const user = await run(
    `INSERT INTO users (role, login, supabase_user_id, full_name, password_salt, password_hash, customer_id)
     VALUES ('customer', ?, ?, ?, 'x', 'x', ?)`,
    [`${supabaseUserId}@example.test`, supabaseUserId, `Cliente ${tag}`, customer.lastID]
  );
  const account = { id: user.lastID, customerId: customer.lastID, mechanicId: null };
  const request = await run(
    `INSERT INTO service_requests
       (customer_id, vehicle_make, vehicle_model, vehicle_year, issue_description, preferred_time, city, zone,
        status, mechanic_id, service_address, latitude, longitude)
     VALUES (?, 'Nissan', 'Versa', 2018, 'No enciende', '', ?, 'Centro', 'completed', ?, 'Calle Falsa 123', -40, -150)`,
    [customer.lastID, `Ciudad-${tag}`, mechanicId]
  );
  createdRows.requests.push(request.lastID);
  await run(
    "INSERT INTO vehicle_profiles (customer_id, make, model, year, photo_urls_json, metadata_json) VALUES (?, 'Nissan', 'Versa', 2018, '[]', '{}')",
    [customer.lastID]
  );
  await run("INSERT INTO favorite_mechanics (user_id, mechanic_id) VALUES (?, ?)", [account.id, mechanicId]);
  await run("INSERT INTO notifications (user_id, title, body) VALUES (?, 'Hola', 'Aviso de prueba')", [account.id]);
  await run("INSERT INTO push_tokens (user_id, push_token) VALUES (?, ?)", [account.id, `ExponentPushToken[${tag}]`]);
  await run(
    "INSERT INTO community_questions (author_user_id, title, body, category) VALUES (?, 'Pregunta de prueba', 'Descripción de prueba', 'otro')",
    [account.id]
  );
  await run(
    "INSERT INTO service_request_messages (service_request_id, sender_user_id, sender_role, message) VALUES (?, ?, 'customer', 'Estoy en la esquina')",
    [request.lastID, account.id]
  );
  await run(
    "INSERT INTO mechanic_reviews (mechanic_id, service_request_id, customer_user_id, rating, comment) VALUES (?, ?, ?, 4, 'Muy bien')",
    [mechanicId, request.lastID, account.id]
  );

  const count = async (sql, params) => (await get(sql, params)).total;
  try {
    assert.equal(await hasActiveServiceBlockingDeletion(account), false);
    await run("UPDATE service_requests SET status = 'pending' WHERE id = ?", [request.lastID]);
    assert.equal(await hasActiveServiceBlockingDeletion(account), true, "una solicitud buscando mecánico bloquea");
    await run("UPDATE service_requests SET status = 'completed' WHERE id = ?", [request.lastID]);

    await anonymizeAccount(account);

    const userRow = await get(
      "SELECT full_name AS fullName, login, supabase_user_id AS supabaseUserId, deleted_at AS deletedAt FROM users WHERE id = ?",
      [account.id]
    );
    assert.equal(userRow.fullName, "Cuenta eliminada");
    assert.equal(userRow.supabaseUserId, null);
    assert.ok(userRow.deletedAt);
    assert.ok(!userRow.login.includes("example.test"));
    const customerRow = await get("SELECT full_name AS fullName, phone FROM customers WHERE id = ?", [customer.lastID]);
    assert.equal(customerRow.fullName, "Cliente eliminado");
    assert.match(customerRow.phone, /^eliminado-c/);

    assert.equal(await count("SELECT COUNT(*) AS total FROM vehicle_profiles WHERE customer_id = ?", [customer.lastID]), 0);
    assert.equal(await count("SELECT COUNT(*) AS total FROM favorite_mechanics WHERE user_id = ?", [account.id]), 0);
    assert.equal(await count("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?", [account.id]), 0);
    assert.equal(await count("SELECT COUNT(*) AS total FROM push_tokens WHERE user_id = ?", [account.id]), 0);
    assert.equal(await count("SELECT COUNT(*) AS total FROM community_questions WHERE author_user_id = ?", [account.id]), 0);

    const requestRow = await get(
      "SELECT service_address AS serviceAddress, latitude, vehicle_make AS vehicleMake FROM service_requests WHERE id = ?",
      [request.lastID]
    );
    assert.equal(requestRow.serviceAddress, null);
    assert.equal(requestRow.latitude, null);
    assert.equal(requestRow.vehicleMake, "Nissan", "el servicio sigue en el historial del mecánico");
    assert.equal((await get("SELECT message FROM service_request_messages WHERE service_request_id = ?", [request.lastID])).message, "Mensaje eliminado");
    const review = await get("SELECT rating, comment FROM mechanic_reviews WHERE service_request_id = ?", [request.lastID]);
    assert.equal(review.rating, 4, "la calificación del mecánico no cambia");
    assert.equal(review.comment, "");
  } finally {
    await run("DELETE FROM mechanic_reviews WHERE service_request_id = ?", [request.lastID]);
    await run("DELETE FROM service_request_messages WHERE service_request_id = ?", [request.lastID]);
    await run("DELETE FROM favorite_mechanics WHERE user_id = ? OR mechanic_id = ?", [account.id, mechanicId]);
    await run("DELETE FROM vehicle_profiles WHERE customer_id = ?", [customer.lastID]);
    await run("DELETE FROM notifications WHERE user_id = ?", [account.id]);
    await run("DELETE FROM push_tokens WHERE user_id = ?", [account.id]);
    await run("DELETE FROM community_questions WHERE author_user_id = ?", [account.id]);
    await run("DELETE FROM users WHERE id = ?", [account.id]);
  }
});

test("eliminar cuenta de mecánico: deja de aparecer y se borran sus promociones y turnos libres", async () => {
  const tag = crypto.randomUUID().slice(0, 8);
  const mechanicId = await createOnlineMechanic(`Ciudad-${tag}`, "Centro", { latitude: -41, longitude: -151 });
  const supabaseUserId = crypto.randomUUID();
  const user = await run(
    `INSERT INTO users (role, login, supabase_user_id, full_name, password_salt, password_hash, mechanic_id)
     VALUES ('mechanic', ?, ?, 'Mecánico Borrable', 'x', 'x', ?)`,
    [`${supabaseUserId}@example.test`, supabaseUserId, mechanicId]
  );
  const account = { id: user.lastID, customerId: null, mechanicId };
  await run(
    "INSERT INTO mechanic_promotions (mechanic_id, title, description) VALUES (?, 'Revisión gratis', 'Al contratar mi servicio')",
    [mechanicId]
  );
  await run(
    "INSERT INTO mechanic_schedule_slots (mechanic_id, slot_date, start_time, end_time, status) VALUES (?, '2099-01-01', '09:00', '10:00', 'available')",
    [mechanicId]
  );
  const customer = await run("INSERT INTO customers (full_name, phone) VALUES (?, ?)", ["Cliente Prueba", uniquePhone()]);
  createdRows.customers.push(customer.lastID);
  const job = await run(
    `INSERT INTO service_requests
       (customer_id, vehicle_make, vehicle_model, vehicle_year, issue_description, preferred_time, city, zone, status, mechanic_id)
     VALUES (?, 'Ford', 'Fiesta', 2007, 'Frenos', '', ?, 'Centro', 'en_route', ?)`,
    [customer.lastID, `Ciudad-${tag}`, mechanicId]
  );
  createdRows.requests.push(job.lastID);

  try {
    assert.equal(await hasActiveServiceBlockingDeletion(account), true, "un trabajo en camino bloquea");
    await run("UPDATE service_requests SET status = 'completed' WHERE id = ?", [job.lastID]);
    assert.equal(await hasActiveServiceBlockingDeletion(account), false);

    await anonymizeAccount(account);

    const mechanic = await get(
      "SELECT full_name AS fullName, status, is_online AS isOnline, latitude FROM mechanics WHERE id = ?",
      [mechanicId]
    );
    assert.equal(mechanic.fullName, "Mecánico eliminado");
    assert.equal(mechanic.status, "suspended");
    assert.equal(mechanic.isOnline, 0);
    assert.equal(mechanic.latitude, null);
    assert.equal((await get("SELECT COUNT(*) AS total FROM mechanic_promotions WHERE mechanic_id = ?", [mechanicId])).total, 0);
    assert.equal(
      (await get("SELECT COUNT(*) AS total FROM mechanic_schedule_slots WHERE mechanic_id = ? AND status = 'available'", [mechanicId])).total,
      0
    );
  } finally {
    await run("DELETE FROM mechanic_promotions WHERE mechanic_id = ?", [mechanicId]);
    await run("DELETE FROM mechanic_schedule_slots WHERE mechanic_id = ?", [mechanicId]);
    await run("DELETE FROM users WHERE id = ?", [account.id]);
  }
});

test("pagos: la configuración y el pago de la cuota exigen sesión", async () => {
  assert.equal((await request("/api/payments/config")).response.status, 401);
  const { response } = await request("/api/payments/service-fee", {
    method: "POST",
    body: JSON.stringify({ returnUrl: "mecanifique://pago" })
  });
  assert.equal(response.status, 401);
});

test("/pagos/regreso vuelve a la app con el resultado y nunca manda a otro sitio", async () => {
  const back = (query) => fetch(`${baseUrl}/pagos/regreso?${query}`, { redirect: "manual" });
  const ok = await back(`estado=listo&session_id=cs_test_123&destino=${encodeURIComponent("exp://192.168.1.5:8081/--/pago")}`);
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get("location"), "exp://192.168.1.5:8081/--/pago?estado=listo&session_id=cs_test_123");

  const cancelled = await back(`estado=cancelado&destino=${encodeURIComponent("mecanifique://pago")}`);
  assert.equal(cancelled.headers.get("location"), "mecanifique://pago?estado=cancelado");

  const evil = await back(`estado=listo&destino=${encodeURIComponent("https://sitio-malicioso.example/robar")}`);
  assert.equal(evil.headers.get("location"), "https://mecanifique.vercel.app/");
});

test("cuota de servicio: se aparta, se reclama una vez, se cobra al llegar el mecánico y se libera al cancelar", async () => {
  // Stripe simulado: registra lo que la app le pide.
  const sessions = new Map();
  const calls = [];
  let counter = 0;
  setStripeGatewayForTests({
    async createCheckout(input) {
      counter += 1;
      const id = `cs_test_${crypto.randomUUID().replace(/-/g, "")}`;
      sessions.set(id, { status: "open", paymentIntentId: null, paymentIntentStatus: null, amountTotalCents: input.amountCents, input });
      return { id, url: `https://checkout.stripe.test/${counter}` };
    },
    async retrieveCheckout(sessionId) {
      const session = sessions.get(sessionId);
      return { status: session.status, paymentIntentId: session.paymentIntentId, paymentIntentStatus: session.paymentIntentStatus, amountTotalCents: session.amountTotalCents };
    },
    async capture(paymentIntentId, key) { calls.push(["capture", paymentIntentId, key]); },
    async cancel(paymentIntentId, key) { calls.push(["cancel", paymentIntentId, key]); }
  });
  const payAt = (sessionId) => {
    const session = sessions.get(sessionId);
    session.status = "complete";
    session.paymentIntentId = `pi_${sessionId.slice(-8)}`;
    session.paymentIntentStatus = "requires_capture";
  };

  const supabaseUserId = crypto.randomUUID();
  const user = await run(
    `INSERT INTO users (role, login, supabase_user_id, full_name, password_salt, password_hash)
     VALUES ('customer', ?, ?, 'Cliente Cuota', 'x', 'x')`,
    [`${supabaseUserId}@example.test`, supabaseUserId]
  );
  const customer = await run("INSERT INTO customers (full_name, phone) VALUES (?, ?)", ["Cliente Cuota", uniquePhone()]);
  createdRows.customers.push(customer.lastID);
  const newRequest = async () => {
    const created = await run(
      `INSERT INTO service_requests (customer_id, vehicle_make, vehicle_model, vehicle_year, issue_description, preferred_time, city, zone, status)
       VALUES (?, 'Nissan', 'Versa', 2018, 'No enciende', '', 'Ciudad-Cuota', 'Centro', 'pending')`,
      [customer.lastID]
    );
    createdRows.requests.push(created.lastID);
    return created.lastID;
  };
  const feeStatus = async (requestId) => (await get("SELECT status FROM service_fees WHERE service_request_id = ?", [requestId]))?.status;

  try {
    await assert.rejects(
      createServiceFeeCheckout({ userId: user.lastID, appReturnUrl: "https://otro-sitio.example", publicBaseUrl: "https://api.test" }),
      (error) => error instanceof ServiceFeeError && error.status === 400
    );

    // 1. Pago que sí llega: se aparta, se reclama y se cobra una sola vez al llegar.
    const checkout = await createServiceFeeCheckout({
      userId: user.lastID,
      email: "cliente@example.test",
      appReturnUrl: "mecanifique://pago",
      publicBaseUrl: "https://api.test"
    });
    assert.equal(checkout.amount, 49);
    const sent = sessions.get(checkout.sessionId).input;
    assert.equal(sent.amountCents, 4900);
    assert.match(sent.successUrl, /^https:\/\/api\.test\/pagos\/regreso\?estado=listo&session_id=\{CHECKOUT_SESSION_ID\}&destino=mecanifique%3A%2F%2Fpago$/);

    await assert.rejects(claimServiceFee(user.lastID, checkout.sessionId), (error) => error.status === 402, "sin pagar no se reclama");
    payAt(checkout.sessionId);
    const feeId = await claimServiceFee(user.lastID, checkout.sessionId);
    await assert.rejects(claimServiceFee(user.lastID, checkout.sessionId), (error) => error.status === 409, "una cuota, una solicitud");

    const arrivedRequest = await newRequest();
    await linkServiceFee(feeId, arrivedRequest);
    await settleServiceFee(arrivedRequest, "en_route");
    assert.equal(await feeStatus(arrivedRequest), "authorized", "en camino todavía no se cobra");
    await settleServiceFee(arrivedRequest, "on_site");
    await settleServiceFee(arrivedRequest, "completed");
    assert.equal(await feeStatus(arrivedRequest), "captured");
    assert.equal(calls.filter(([kind]) => kind === "capture").length, 1, "se cobra una sola vez");

    // 2. Cancelada antes de que llegue el mecánico: se libera.
    const second = await createServiceFeeCheckout({ userId: user.lastID, appReturnUrl: "mecanifique://pago", publicBaseUrl: "https://api.test" });
    payAt(second.sessionId);
    const secondFee = await claimServiceFee(user.lastID, second.sessionId);
    const cancelledRequest = await newRequest();
    await linkServiceFee(secondFee, cancelledRequest);
    await settleServiceFee(cancelledRequest, "cancelled");
    assert.equal(await feeStatus(cancelledRequest), "released");

    // 3. Pagada pero sin solicitud (la app se cerró): el barrido la libera.
    const orphan = await createServiceFeeCheckout({ userId: user.lastID, appReturnUrl: "mecanifique://pago", publicBaseUrl: "https://api.test" });
    payAt(orphan.sessionId);
    await run("UPDATE service_fees SET created_at = datetime('now', '-3 hours') WHERE checkout_session_id = ?", [orphan.sessionId]);
    assert.ok((await releaseOrphanServiceFees()) >= 1);
    assert.equal((await get("SELECT status FROM service_fees WHERE checkout_session_id = ?", [orphan.sessionId])).status, "released");
    assert.ok(calls.some(([kind, paymentIntentId]) => kind === "cancel" && paymentIntentId === sessions.get(orphan.sessionId).paymentIntentId));
  } finally {
    setStripeGatewayForTests(undefined);
    await run("DELETE FROM service_fees WHERE user_id = ?", [user.lastID]);
    await run("DELETE FROM users WHERE id = ?", [user.lastID]);
  }
});

test("lista de espera: guarda una vez, regresa al sitio y descarta bots y datos inválidos", async () => {
  const post = (fields) => fetch(`${baseUrl}/lista-de-espera`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual"
  });
  const phone = `449 ${crypto.randomInt(100, 999)} ${crypto.randomInt(1000, 9999)}`;
  const contactKey = phone.replace(/\D/g, "");

  try {
    const first = await post({ role: "cliente", name: "Ana", contact: phone, city: "Aguascalientes" });
    assert.equal(first.status, 303);
    assert.match(first.headers.get("location"), /^https:\/\/mecanifique\.vercel\.app\/\?registro=ok#lista$/);
    // La misma persona otra vez: no se duplica, pero igual ve "listo".
    assert.match((await post({ role: "cliente", contact: phone })).headers.get("location"), /registro=ok/);
    assert.equal((await get("SELECT COUNT(*) AS total FROM waitlist_signups WHERE contact_key = ?", [contactKey])).total, 1);

    assert.match((await post({ role: "cliente", contact: "hola" })).headers.get("location"), /registro=error/);
    assert.match((await post({ role: "dueño", contact: phone })).headers.get("location"), /registro=error/);

    const botEmail = `bot-${crypto.randomUUID()}@example.test`;
    assert.match((await post({ role: "cliente", contact: botEmail, website: "http://spam" })).headers.get("location"), /registro=ok/);
    assert.equal(await get("SELECT id FROM waitlist_signups WHERE contact_key = ?", [botEmail]), undefined);
  } finally {
    await run("DELETE FROM waitlist_signups WHERE contact_key = ?", [contactKey]);
  }
});

test("página /eliminar-cuenta: se ve sin la app y guarda la solicitud", async () => {
  const page = await fetch(`${baseUrl}/eliminar-cuenta`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /html/);
  assert.match(await page.text(), /Eliminar tu cuenta/);

  const form = (fields) => fetch(`${baseUrl}/eliminar-cuenta`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString()
  });
  assert.equal((await form({ email: "no-es-un-correo" })).status, 400);

  const email = `borrar-${crypto.randomUUID()}@example.test`;
  const accepted = await form({ email, message: "Ya no la uso" });
  assert.equal(accepted.status, 200);
  assert.match(await accepted.text(), /Recibimos tu solicitud/);
  assert.ok(await get("SELECT id FROM account_deletion_requests WHERE email = ?", [email]));
  await run("DELETE FROM account_deletion_requests WHERE email = ?", [email]);
});

test("mecánico nuevo y activo: al conectarse queda disponible para recibir solicitudes", async () => {
  const mechanicId = await createRegisteredMechanic("active");

  const result = await applyMechanicConnection(mechanicId, true, true);

  assert.deepEqual(result, { ok: true, isAvailable: true });
  const row = await get("SELECT is_online AS isOnline, is_available AS isAvailable FROM mechanics WHERE id = ?", [mechanicId]);
  assert.deepEqual(row, { isOnline: 1, isAvailable: 1 }, "antes quedaba con is_available = 0 y nunca recibía nada");
});

test("mecánico pendiente de verificación: no puede conectarse y recibe una explicación", async () => {
  const mechanicId = await createRegisteredMechanic("pending_verification");

  const result = await applyMechanicConnection(mechanicId, true, true);

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.error, /verifica tu identidad/i);
  const row = await get("SELECT is_online AS isOnline FROM mechanics WHERE id = ?", [mechanicId]);
  assert.equal(row.isOnline, 0);
});

test("foto de perfil: sin foto de su cara el mecánico activo no se puede conectar", async () => {
  const mechanicId = await createRegisteredMechanic("active", null);

  const blocked = await applyMechanicConnection(mechanicId, true, true);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 409);
  assert.match(blocked.error, /foto de perfil/);
  assert.equal((await get("SELECT is_online AS isOnline FROM mechanics WHERE id = ?", [mechanicId])).isOnline, 0);

  // Desconectarse siempre se puede, y un pendiente ve primero lo de la identidad.
  assert.equal((await applyMechanicConnection(mechanicId, false, true)).ok, true);
  const pending = await createRegisteredMechanic("pending_verification", null);
  assert.match((await applyMechanicConnection(pending, true, true)).error, /verifica tu identidad/i);

  await run("UPDATE mechanics SET profile_photo_url = 'https://example.test/uploads/cara.jpg' WHERE id = ?", [mechanicId]);
  assert.deepEqual(await applyMechanicConnection(mechanicId, true, true), { ok: true, isAvailable: true });

  const upload = await request("/api/mechanics/me/profile-photo", { method: "PUT", body: JSON.stringify({ imageBase64: "x".repeat(200) }) });
  assert.equal(upload.response.status, 401);
});

test("foto reemplazada: se borra la anterior, solo si la subió la misma cuenta", async () => {
  const { deletePhotoByUrl } = require("../src/uploads.ts");
  const createUser = async () => {
    const supabaseUserId = crypto.randomUUID();
    return (await run(
      "INSERT INTO users (role, login, supabase_user_id, full_name, password_salt, password_hash) VALUES ('customer', ?, ?, 'Foto', 'x', 'x')",
      [`${supabaseUserId}@example.test`, supabaseUserId]
    )).lastID;
  };
  const owner = await createUser();
  const other = await createUser();
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const fileName = await savePhoto({ buffer: png, extension: "png" }, owner);
  const url = `https://mecanifique.onrender.com/uploads/${fileName}`;
  const id = fileName.split(".")[0];

  try {
    await deletePhotoByUrl(url, other);
    assert.ok(await get("SELECT id FROM uploaded_photos WHERE id = ?", [id]), "otra cuenta no la borra");
    await deletePhotoByUrl("https://example.test/uploads/no-es-un-nombre.png", owner);
    await deletePhotoByUrl(null, owner);
    await deletePhotoByUrl(url, owner);
    assert.equal(await get("SELECT id FROM uploaded_photos WHERE id = ?", [id]), undefined);
  } finally {
    await run("DELETE FROM uploaded_photos WHERE id = ?", [id]);
    await run("DELETE FROM users WHERE id IN (?, ?)", [owner, other]);
  }
});

test("cuenta nueva para no pagar: la huella (teléfono, correo, celular, ubicación) sobrevive a eliminar la cuenta", async () => {
  const {
    customerCompletedServices,
    linkedUnpaidService,
    recordUnpaidFingerprints,
    rememberDevice,
    unpaidServiceNearby
  } = require("../src/unpaidFingerprints.ts");
  const tag = crypto.randomUUID().slice(0, 8);
  const users = [];
  async function createAccount(phone, email) {
    const customer = await run("INSERT INTO customers (full_name, phone) VALUES ('Cliente', ?)", [phone]);
    createdRows.customers.push(customer.lastID);
    const user = await run(
      "INSERT INTO users (role, login, supabase_user_id, full_name, password_salt, password_hash, customer_id) VALUES ('customer', ?, ?, 'Cliente', 'x', 'x', ?)",
      [email, crypto.randomUUID(), customer.lastID]
    );
    users.push(user.lastID);
    return { customerId: customer.lastID, userId: user.lastID };
  }

  const phone = uniquePhone();
  const debtor = await createAccount(phone, `deudor-${tag}@example.test`);
  await rememberDevice(debtor.userId, `celular-${tag}`);
  const mechanicId = await createOnlineMechanic(`Ciudad-${tag}`, "Centro");
  const request = await run(
    `INSERT INTO service_requests
       (customer_id, vehicle_make, vehicle_model, vehicle_year, issue_description, preferred_time, city, zone, status, mechanic_id,
        latitude, longitude, unpaid_reported_at)
     VALUES (?, 'Nissan', 'Versa', 2020, 'No enciende', 'Ahora', 'X', 'Centro', 'completed', ?, -42.5, -160.5, CURRENT_TIMESTAMP)`,
    [debtor.customerId, mechanicId]
  );
  createdRows.requests.push(request.lastID);
  await recordUnpaidFingerprints(request.lastID);

  try {
    // Elimina su cuenta: su teléfono y su correo quedan libres…
    await anonymizeAccount({ id: debtor.userId, customerId: debtor.customerId, mechanicId: null });
    // …y abre otra con el mismo teléfono, o con el mismo correo.
    const samePhone = await createAccount(phone, `nuevo-${tag}@example.test`);
    assert.deepEqual(await linkedUnpaidService(samePhone.customerId), { requestId: request.lastID });
    const sameEmail = await createAccount(uniquePhone(), `deudor-${tag}@example.test`);
    assert.ok(await linkedUnpaidService(sameEmail.customerId));

    // Otra persona: nada, salvo que use el mismo celular.
    const other = await createAccount(uniquePhone(), `otra-${tag}@example.test`);
    assert.equal(await linkedUnpaidService(other.customerId), null);
    assert.ok(await linkedUnpaidService(other.customerId, `celular-${tag}`));

    // Ubicación: a ~30 m avisa, a ~1 km no.
    assert.equal(await unpaidServiceNearby(-42.5003, -160.5, other.customerId), true);
    assert.equal(await unpaidServiceNearby(-42.51, -160.5, other.customerId), false);
    assert.equal(await unpaidServiceNearby(null, null, other.customerId), false);

    // Pagado: todo deja de contar solo.
    await run("UPDATE service_requests SET paid_at = CURRENT_TIMESTAMP WHERE id = ?", [request.lastID]);
    assert.equal(await linkedUnpaidService(samePhone.customerId), null);
    assert.equal(await linkedUnpaidService(other.customerId, `celular-${tag}`), null);
    assert.equal(await unpaidServiceNearby(-42.5003, -160.5, other.customerId), false);
    assert.equal(await customerCompletedServices(debtor.customerId), 1);
    assert.equal(await customerCompletedServices(other.customerId), 0);
  } finally {
    await run(`DELETE FROM user_devices WHERE user_id IN (${users.map(() => "?").join(", ")})`, users);
    await run(`DELETE FROM users WHERE id IN (${users.map(() => "?").join(", ")})`, users);
  }
});

test("calificación del cliente: solo el mecánico del servicio, al terminar y una vez", async () => {
  const { CustomerReviewError, customerRating, hasCustomerReview, reviewCustomer } = require("../src/customerReviews.ts");
  const tag = crypto.randomUUID().slice(0, 8);
  const mechanicId = await createOnlineMechanic(`Ciudad-${tag}`, "Centro");
  const otherMechanic = await createOnlineMechanic(`Ciudad-${tag}`, "Centro");
  const customer = await run("INSERT INTO customers (full_name, phone) VALUES ('Cliente', ?)", [uniquePhone()]);
  createdRows.customers.push(customer.lastID);
  async function requestIn(status, cancellationFee = null) {
    const request = await run(
      `INSERT INTO service_requests
         (customer_id, vehicle_make, vehicle_model, vehicle_year, issue_description, preferred_time, city, zone, status, mechanic_id, cancellation_fee)
       VALUES (?, 'Nissan', 'Versa', 2020, 'No enciende', 'Ahora', 'X', 'Centro', ?, ?, ?)`,
      [customer.lastID, status, mechanicId, cancellationFee]
    );
    createdRows.requests.push(request.lastID);
    return request.lastID;
  }

  assert.deepEqual(await customerRating(customer.lastID), { average: null, count: 0 });
  const active = await requestIn("repairing");
  await assert.rejects(reviewCustomer({ requestId: active, mechanicId, rating: 5 }), (error) => error.status === 409);

  const done = await requestIn("completed");
  await assert.rejects(reviewCustomer({ requestId: done, mechanicId: otherMechanic, rating: 1 }), (error) => error.status === 403);
  await reviewCustomer({ requestId: done, mechanicId, rating: 5, comment: "Muy amable" });
  assert.equal(await hasCustomerReview(done), true);
  await assert.rejects(reviewCustomer({ requestId: done, mechanicId, rating: 1 }), (error) => error instanceof CustomerReviewError && error.status === 409);

  // No estaba cuando llegó el mecánico: se canceló con cargo y también se califica.
  const absent = await requestIn("cancelled", 300);
  await reviewCustomer({ requestId: absent, mechanicId, rating: 2 });
  assert.deepEqual(await customerRating(customer.lastID), { average: 3.5, count: 2 });
});

test("completa tu perfil: marca lo que ya tiene el cliente y el mecánico", async () => {
  const { profileChecklist } = require("../src/profileChecklist.ts");
  const done = (items) => Object.fromEntries(items.map((item) => [item.key, item.done]));

  const customer = await run("INSERT INTO customers (full_name, phone) VALUES ('Cliente', ?)", [`sin-telefono-${crypto.randomUUID()}`]);
  createdRows.customers.push(customer.lastID);
  const viewer = { id: 987654, role: "customer", fullName: "correo@example.test", customerId: customer.lastID, mechanicId: null };
  assert.deepEqual(done(await profileChecklist(viewer)), { name: false, photo: false, phone: false, vehicle: false, favorite: false });
  await run("UPDATE customers SET phone = ? WHERE id = ?", [uniquePhone(), customer.lastID]);
  const vehicle = await run(
    "INSERT INTO vehicle_profiles (customer_id, make, model, year, photo_urls_json, metadata_json) VALUES (?, 'Nissan', 'Versa', 2018, '[]', '{}')",
    [customer.lastID]
  );
  try {
    assert.deepEqual(done(await profileChecklist({ ...viewer, fullName: "Ana Ruiz" })), {
      name: true,
      photo: false,
      phone: true,
      vehicle: true,
      favorite: false
    });
  } finally {
    await run("DELETE FROM vehicle_profiles WHERE id = ?", [vehicle.lastID]);
  }

  const mechanicId = await createRegisteredMechanic("active");
  const mechanicViewer = { id: 987655, role: "mechanic", fullName: "Mecánico", customerId: null, mechanicId };
  assert.ok((await profileChecklist(mechanicViewer)).every((item) => !item.done));
  await run(
    "UPDATE mechanics SET bio = 'Quince años reparando motores y frenos', gallery_json = '[\"https://example.test/a.jpg\"]' WHERE id = ?",
    [mechanicId]
  );
  const items = done(await profileChecklist(mechanicViewer));
  assert.equal(items.bio, true);
  assert.equal(items.gallery, true);
  assert.equal(items.cover, false);
  assert.equal(items.schedule, false);
});

test("mercado: precio sugerido agregado (mínimo de datos) y tendencias por hora y zona", async () => {
  const { requestTrends, visitRateSuggestion, normalizePlace } = require("../src/marketInsights.ts");
  const tag = crypto.randomUUID().slice(0, 8);
  const city = `Ciudad Ñandú ${tag}`;
  assert.equal(normalizePlace(`  ciudad ñandú ${tag.toUpperCase()} `), normalizePlace(city));

  const me = await createOnlineMechanic(city, "Centro");
  // Con uno o dos mecánicos en la ciudad no se muestra su precio (se usaría toda la app).
  const others = [];
  for (const rate of [300, 400, 500]) {
    const id = await createOnlineMechanic(city.toUpperCase(), "Centro");
    await run("UPDATE mechanics SET labor_rate = ? WHERE id = ?", [rate, id]);
    others.push(id);
  }
  const fromProfiles = await visitRateSuggestion(me);
  assert.equal(fromProfiles.source, "profiles");
  assert.equal(fromProfiles.city, city);
  assert.deepEqual([fromProfiles.low, fromProfiles.median, fromProfiles.high], [350, 400, 450]);

  // Con 5 servicios pagados en la ciudad, manda lo que sí se pagó.
  const customer = await run("INSERT INTO customers (full_name, phone) VALUES ('Cliente', ?)", [uniquePhone()]);
  createdRows.customers.push(customer.lastID);
  for (const [index, fee] of [250, 300, 300, 350, 600].entries()) {
    const request = await run(
      `INSERT INTO service_requests
         (customer_id, vehicle_make, vehicle_model, vehicle_year, issue_description, preferred_time, city, zone, status, mechanic_id, visit_fee, created_at)
       VALUES (?, 'Nissan', 'Versa', 2020, 'No enciende', 'Ahora', ?, ?, 'completed', ?, ?, datetime('now', ?))`,
      [customer.lastID, city, index < 3 ? "Canteras" : "Centro", others[0], fee, `-${index} hours`]
    );
    createdRows.requests.push(request.lastID);
  }
  const fromServices = await visitRateSuggestion(me);
  assert.equal(fromServices.source, "services");
  assert.equal(fromServices.count, 5);
  assert.equal(fromServices.median, 300);

  const pending = await run(
    `INSERT INTO service_requests
       (customer_id, vehicle_make, vehicle_model, vehicle_year, issue_description, preferred_time, city, zone, status)
     VALUES (?, 'Nissan', 'Versa', 2020, 'No enciende', 'Ahora', ?, 'Solitaria', 'pending')`,
    [customer.lastID, city]
  );
  createdRows.requests.push(pending.lastID);
  const trends = await requestTrends(me);
  assert.equal(trends.total, 6);
  assert.equal(trends.waiting, 1);
  assert.ok(trends.lastHour >= 2);
  assert.equal(trends.byHour.reduce((sum, count) => sum + count, 0), 6);
  assert.deepEqual(trends.byZone, [
    { zone: "Canteras", count: 3 },
    { zone: "Centro", count: 2 },
    { zone: "Otras zonas", count: 1 }
  ]);
});

test("evidencia: fotos de antes y después solo del mecánico del servicio y con el auto; piezas; garantía", async () => {
  const { ServiceEvidenceError, addServicePhoto, getOldPartsStatus, getServicePhotos, hasServicePhoto, setOldPartsStatus } =
    require("../src/serviceEvidence.ts");
  const tag = crypto.randomUUID().slice(0, 8);
  const mechanicId = await createOnlineMechanic(`Ciudad-${tag}`, "Centro");
  const otherMechanic = await createOnlineMechanic(`Ciudad-${tag}`, "Centro");
  const customer = await run("INSERT INTO customers (full_name, phone) VALUES ('Cliente', ?)", [uniquePhone()]);
  createdRows.customers.push(customer.lastID);
  const request = await run(
    `INSERT INTO service_requests
       (customer_id, vehicle_make, vehicle_model, vehicle_year, issue_description, preferred_time, city, zone, status, mechanic_id)
     VALUES (?, 'Nissan', 'Versa', 2020, 'No enciende', 'Ahora', 'X', 'Centro', 'assigned', ?)`,
    [customer.lastID, mechanicId]
  );
  createdRows.requests.push(request.lastID);
  const requestId = request.lastID;
  let saved = 0;
  const savePhoto = async () => {
    saved += 1;
    return `https://example.test/uploads/${crypto.randomUUID()}.jpg`;
  };

  try {
    // Todavía no llega: no hay fotos que tomar.
    await assert.rejects(addServicePhoto({ requestId, mechanicId, kind: "before", savePhoto }), (error) => error.status === 409);
    await run("UPDATE service_requests SET status = 'diagnosing' WHERE id = ?", [requestId]);
    await assert.rejects(
      addServicePhoto({ requestId, mechanicId: otherMechanic, kind: "before", savePhoto }),
      (error) => error instanceof ServiceEvidenceError && error.status === 403
    );
    assert.equal(saved, 0, "no se guarda la foto si no pasa las reglas");
    assert.equal(await hasServicePhoto(requestId, "before"), false);
    await addServicePhoto({ requestId, mechanicId, kind: "before", savePhoto });
    assert.equal(await hasServicePhoto(requestId, "before"), true);
    assert.equal(await hasServicePhoto(requestId, "after"), false);
    await addServicePhoto({ requestId, mechanicId, kind: "after", savePhoto });
    assert.deepEqual((await getServicePhotos(requestId)).map((photo) => photo.kind), ["before", "after"]);

    assert.equal(await getOldPartsStatus(requestId), null);
    await setOldPartsStatus({ requestId, mechanicId, status: "delivered" });
    assert.equal(await getOldPartsStatus(requestId), "delivered");

    const quote = await createQuote({ requestId, mechanicId, laborAmount: 800, partsAmount: 0, description: "Cambio de balatas", warrantyDays: 30 });
    assert.equal(quote.warrantyDays, 30);
  } finally {
    await run("DELETE FROM service_photos WHERE service_request_id = ?", [requestId]);
  }
});

test("visita de regreso: la reprograman el mecánico o el cliente, nadie más, y no si ya empezó", async () => {
  const { rescheduleReturnVisit } = require("../src/returnVisits.ts");
  const tag = crypto.randomUUID().slice(0, 8);
  const mechanicId = await createOnlineMechanic(`Ciudad-${tag}`, "Centro");
  const customer = await run("INSERT INTO customers (full_name, phone) VALUES ('Cliente', ?)", [uniquePhone()]);
  createdRows.customers.push(customer.lastID);
  const insert = async (status, parentId = null) => {
    const row = await run(
      `INSERT INTO service_requests
         (customer_id, vehicle_make, vehicle_model, vehicle_year, issue_description, preferred_time, city, zone, status, mechanic_id, parent_request_id)
       VALUES (?, 'Nissan', 'Versa', 2020, 'Regreso', 'Jueves 10:00', 'X', 'Centro', ?, ?, ?)`,
      [customer.lastID, status, mechanicId, parentId]
    );
    createdRows.requests.push(row.lastID);
    return row.lastID;
  };
  const original = await insert("completed");
  const visit = await insert("assigned", original);

  const byCustomer = await rescheduleReturnVisit({ visitId: visit, mechanicId: null, customerId: customer.lastID, when: "Viernes 12:00" });
  assert.equal(byCustomer.byMechanic, false);
  assert.equal(byCustomer.previous, "Jueves 10:00");
  const byMechanic = await rescheduleReturnVisit({ visitId: visit, mechanicId, customerId: null, when: "Sábado 9:00" });
  assert.equal(byMechanic.byMechanic, true);
  assert.equal((await get("SELECT preferred_time AS t FROM service_requests WHERE id = ?", [visit])).t, "Sábado 9:00");

  await assert.rejects(rescheduleReturnVisit({ visitId: visit, mechanicId: 999999, customerId: null, when: "Lunes" }), (error) => error.status === 403);
  await assert.rejects(rescheduleReturnVisit({ visitId: original, mechanicId, customerId: null, when: "Lunes" }), (error) => error.status === 404);
  await run("UPDATE service_requests SET status = 'en_route' WHERE id = ?", [visit]);
  await assert.rejects(rescheduleReturnVisit({ visitId: visit, mechanicId, customerId: null, when: "Lunes" }), (error) => error.status === 409);
});

test("refaccionarias: lista oficial, las más cercanas primero, sugerencias y 'sí tenían la pieza'", async () => {
  const {
    PartsStoreError,
    listPartsStores,
    markStoreHadPart,
    pendingPartsStores,
    reviewPartsStore,
    seedPartsStores,
    suggestPartsStore
  } = require("../src/partsStores.ts");
  const tag = crypto.randomUUID().slice(0, 8);
  const near = { latitude: -43.5, longitude: -170.5 };
  const keys = [`prueba-cerca-${tag}`, `prueba-lejos-${tag}`, `prueba-sin-ubicacion-${tag}`];
  await seedPartsStores([
    { key: keys[1], name: `Lejos ${tag}`, phone: "449 111 2222", latitude: -43.6, longitude: -170.5 },
    { key: keys[0], name: `Cerca ${tag}`, phone: "(449) 333-4444", latitude: -43.501, longitude: -170.5 },
    { key: keys[2], name: `Sin ubicación ${tag}`, phone: "4495556666" }
  ]);
  const mechanicId = await createOnlineMechanic(`Ciudad-${tag}`, "Centro");
  const user = await run(
    "INSERT INTO users (role, login, supabase_user_id, full_name, password_salt, password_hash, mechanic_id) VALUES ('mechanic', ?, ?, 'Mecánico', 'x', 'x', ?)",
    [`${tag}@example.test`, crypto.randomUUID(), mechanicId]
  );

  try {
    const mine = (await listPartsStores(near)).filter((store) => store.name.endsWith(tag));
    assert.deepEqual(mine.map((store) => store.name), [`Cerca ${tag}`, `Lejos ${tag}`, `Sin ubicación ${tag}`]);
    assert.equal(mine[0].phone, "4493334444", "teléfono solo con dígitos");
    assert.equal(mine[2].distanceKm, null);

    // Volver a cargar la lista actualiza, no duplica.
    await seedPartsStores([{ key: keys[0], name: `Cerca ${tag}`, phone: "4493334444", hours: "9 a 19", latitude: -43.501, longitude: -170.5 }]);
    const updated = (await listPartsStores(near)).filter((store) => store.name === `Cerca ${tag}`);
    assert.equal(updated.length, 1);
    assert.equal(updated[0].hours, "9 a 19");

    // "Sí tenían la pieza": cuenta una vez por servicio.
    await markStoreHadPart({ storeId: updated[0].id, mechanicId, part: "Bomba de gasolina", vehicle: "Tsuru 2010" });
    await markStoreHadPart({ storeId: updated[0].id, mechanicId, part: "Bomba de gasolina", vehicle: "Tsuru 2010" });
    assert.equal((await listPartsStores(near)).find((store) => store.id === updated[0].id).recentHits, 1);

    // Sugerencia: pendiente hasta que un admin la aprueba; no se repite un teléfono.
    await assert.rejects(
      suggestPartsStore({ userId: user.lastID, name: "Repetida", phone: "449-333-4444" }),
      (error) => error instanceof PartsStoreError && error.status === 409
    );
    const suggested = await suggestPartsStore({ userId: user.lastID, name: `Sugerida ${tag}`, phone: "4497778888" });
    assert.ok((await pendingPartsStores()).some((store) => store.id === suggested.id));
    assert.equal((await listPartsStores(near)).some((store) => store.id === suggested.id), false, "no sale hasta aprobarla");
    await reviewPartsStore(suggested.id, true);
    assert.equal((await listPartsStores(near)).some((store) => store.id === suggested.id), true);
  } finally {
    await run(
      `DELETE FROM parts_store_hits WHERE store_id IN (SELECT id FROM parts_stores WHERE name LIKE ?)`,
      [`%${tag}`]
    );
    await run("DELETE FROM parts_stores WHERE name LIKE ?", [`%${tag}`]);
    await run("DELETE FROM users WHERE id = ?", [user.lastID]);
  }
});

test("mecánico con un trabajo en curso: al reconectarse sigue ocupado", async () => {
  const mechanicId = await createRegisteredMechanic("active");
  const customer = await run("INSERT INTO customers (full_name, phone) VALUES (?, ?)", ["Cliente Prueba", uniquePhone()]);
  const request = await run(
    `INSERT INTO service_requests
       (customer_id, vehicle_make, vehicle_model, vehicle_year, issue_description, preferred_time, city, zone, status, mechanic_id)
     VALUES (?, 'Nissan', 'Versa', 2020, 'No enciende', 'Ahora', 'X', 'Centro', 'repairing', ?)`,
    [customer.lastID, mechanicId]
  );
  createdRows.customers.push(customer.lastID);
  createdRows.requests.push(request.lastID);

  const result = await applyMechanicConnection(mechanicId, true, true);

  assert.deepEqual(result, { ok: true, isAvailable: false }, "no debe recibir otra solicitud mientras repara");
});

test("mecánico pendiente con identidad ya aprobada (se verificó como cliente): se activa", async () => {
  const mechanicId = await createRegisteredMechanic("pending_verification");
  const supabaseUserId = crypto.randomUUID();
  const user = await run(
    `INSERT INTO users (role, login, supabase_user_id, full_name, password_salt, password_hash, mechanic_id)
     VALUES ('mechanic', ?, ?, 'Mecánico Nuevo', 'x', 'x', ?)`,
    [`${supabaseUserId}@example.test`, supabaseUserId, mechanicId]
  );
  await run(
    "INSERT INTO identity_verifications (user_id, role, status, consent_at) VALUES (?, 'customer', 'approved', CURRENT_TIMESTAMP)",
    [user.lastID]
  );

  try {
    const activated = await activateMechanicIfIdentityApproved(mechanicId, user.lastID);

    assert.equal(activated, true);
    const row = await get("SELECT status FROM mechanics WHERE id = ?", [mechanicId]);
    assert.equal(row.status, "active", "antes quedaba pendiente para siempre, sin forma de volver a verificarse");
  } finally {
    await run("DELETE FROM identity_verifications WHERE user_id = ?", [user.lastID]);
    await run("DELETE FROM users WHERE id = ?", [user.lastID]);
  }
});

test("con coordenadas: si nadie tiene ubicación, se usa la ciudad/zona escrita como respaldo", async () => {
  const { cliente } = pointsAround(-110);
  const city = `Ciudad-${crypto.randomUUID()}`;
  const firstMechanic = await createOnlineMechanic(city, "Centro");
  const noLocationSameZone = await createOnlineMechanic(city, "Centro");
  const requestId = await createPendingRequestWithExpiredHold(city, "Centro", firstMechanic, "auto", cliente);

  await sweepExpiredHolds();

  const request = await get("SELECT mechanic_id AS mechanicId FROM service_requests WHERE id = ?", [requestId]);
  assert.equal(request.mechanicId, noLocationSameZone);
});
test("privacidad: el listado público no trae teléfonos ni la ubicación exacta; reseñas con primer nombre; teléfonos solo al aceptar", async () => {
  const { approximateLocation, contactPhoneSql } = require("../src/privacy.ts");
  assert.deepEqual(approximateLocation(21.884563, -102.291634), { latitude: 21.88, longitude: -102.29 });
  assert.equal(approximateLocation(null, -102.29), null);

  const city = `Ciudad-${crypto.randomUUID()}`;
  const online = await createOnlineMechanic(city, "Sur", { latitude: 21.884563, longitude: -102.291634 });
  const offline = await createOnlineMechanic(city, "Sur", { latitude: 21.851234, longitude: -102.287654 });
  await run("UPDATE mechanics SET is_online = 0, is_available = 0 WHERE id = ?", [offline]);
  const phones = (await all("SELECT phone FROM mechanics WHERE id IN (?, ?)", [online, offline])).map((row) => row.phone);

  // Listado público: sin teléfonos; ubicación aproximada y solo de quien está conectado.
  const { body: list } = await request(`/mechanics?city=${encodeURIComponent(city)}`);
  assert.equal(list.length, 2);
  for (const phone of phones) assert.ok(!JSON.stringify(list).includes(phone));
  assert.ok(list.every((mechanic) => !("phone" in mechanic)));
  const onlineRow = list.find((mechanic) => mechanic.id === online);
  assert.deepEqual([onlineRow.latitude, onlineRow.longitude], [21.88, -102.29]);
  const offlineRow = list.find((mechanic) => mechanic.id === offline);
  assert.deepEqual([offlineRow.latitude, offlineRow.longitude], [null, null], "la última ubicación de un desconectado puede ser su casa");

  // Cercanos: la distancia sale de la ubicación aproximada, no de la exacta.
  const { body: nearby } = await request(
    `/mechanics?city=${encodeURIComponent(city)}&latitude=21.88&longitude=-102.29&radiusKm=25`
  );
  assert.deepEqual(nearby.map((mechanic) => mechanic.id), [online]);
  assert.equal(nearby[0].distanceKm, 0);

  // Reseñas públicas: primer nombre e inicial, sin el id del cliente.
  const { requestId: reviewedRequest } = await createRequestInStatus(online, "completed");
  const reviewer = await run(
    `INSERT INTO users (role, login, supabase_user_id, full_name, password_salt, password_hash)
     VALUES ('customer', ?, ?, 'María Fernanda López', 'x', 'x')`,
    [`${crypto.randomUUID()}@example.test`, crypto.randomUUID()]
  );
  try {
    await run(
      "INSERT INTO mechanic_reviews (mechanic_id, service_request_id, customer_user_id, rating, comment) VALUES (?, ?, ?, 5, 'Muy bien')",
      [online, reviewedRequest, reviewer.lastID]
    );
    const { body: reviews } = await request(`/mechanics/${online}/reviews`);
    assert.equal(reviews.reviews[0].customerName, "María F.");
    assert.ok(!("customerUserId" in reviews.reviews[0]));
  } finally {
    await run("DELETE FROM mechanic_reviews WHERE service_request_id = ?", [reviewedRequest]);
    await run("DELETE FROM users WHERE id = ?", [reviewer.lastID]);
  }

  // Teléfonos de cliente y mecánico: solo cuando el mecánico ya aceptó.
  const customer = await run("INSERT INTO customers (full_name, phone) VALUES (?, ?)", ["Cliente Privado", uniquePhone()]);
  createdRows.customers.push(customer.lastID);
  const offered = await run(
    `INSERT INTO service_requests
       (customer_id, vehicle_make, vehicle_model, vehicle_year, issue_description, preferred_time, city, zone,
        status, mechanic_id, hold_expires_at)
     VALUES (?, 'Nissan', 'Versa', 2020, 'No enciende', 'Ahora', ?, 'Sur', 'pending', ?, datetime('now', '+2 minutes'))`,
    [customer.lastID, city, online]
  );
  createdRows.requests.push(offered.lastID);
  const phonesNow = () =>
    get(
      `SELECT ${contactPhoneSql("sr", "c.phone")} AS customerPhone, ${contactPhoneSql("sr", "m.phone")} AS mechanicPhone
       FROM service_requests sr JOIN customers c ON c.id = sr.customer_id LEFT JOIN mechanics m ON m.id = sr.mechanic_id
       WHERE sr.id = ?`,
      [offered.lastID]
    );
  assert.deepEqual({ ...(await phonesNow()) }, { customerPhone: null, mechanicPhone: null }, "ofrecida, sin aceptar");
  await run("UPDATE service_requests SET status = 'cancelled' WHERE id = ?", [offered.lastID]);
  assert.deepEqual({ ...(await phonesNow()) }, { customerPhone: null, mechanicPhone: null }, "cancelada sin que la aceptaran");
  await run("UPDATE service_requests SET status = 'assigned', accepted_at = CURRENT_TIMESTAMP WHERE id = ?", [offered.lastID]);
  const accepted = await phonesNow();
  assert.ok(accepted.customerPhone && accepted.mechanicPhone, "aceptada: ya se pueden llamar");
  await run("UPDATE service_requests SET status = 'cancelled' WHERE id = ?", [offered.lastID]);
  assert.ok((await phonesNow()).customerPhone, "aceptada y luego cancelada: se siguen viendo por si hay cargo que aclarar");
});

test("zonas: municipios sin acentos ni prefijos, 'Ags' es Aguascalientes, y la zona 'Zona Sur' es 'sur'", () => {
  const { placeKey, resolveMunicipality, canonicalCity, coversCity, zoneMatches, coverageText, AGUASCALIENTES_MUNICIPALITIES } =
    require("../src/serviceAreas.ts");
  assert.equal(placeKey("Zona Sur"), "sur");
  assert.equal(placeKey("Col. Centro"), "centro");
  assert.equal(resolveMunicipality("ags"), "Aguascalientes");
  assert.equal(resolveMunicipality("JESUS MARIA"), "Jesús María");
  assert.equal(resolveMunicipality("Pabellón"), "Pabellón de Arteaga");
  assert.equal(resolveMunicipality("Rincón de R."), "Rincón de Romos");
  assert.equal(resolveMunicipality("Zacatecas"), null);
  assert.equal(resolveMunicipality("San"), null, "ambiguo: varios municipios empiezan así");
  assert.equal(canonicalCity("  aguascalientes "), "Aguascalientes");
  assert.equal(canonicalCity("León"), "León");

  const mechanic = { city: "Aguascalientes", serviceAreas: ["Jesús María"] };
  assert.equal(coversCity(mechanic, "Ags"), true);
  assert.equal(coversCity(mechanic, "jesus maria"), true);
  assert.equal(coversCity(mechanic, "Calvillo"), false);

  assert.equal(zoneMatches("Zona Sur", "sur"), true);
  assert.equal(zoneMatches("Centro", "Centro Histórico"), true);
  assert.equal(zoneMatches("Sur", "Norte"), false);
  assert.equal(zoneMatches("Sur", ""), false);

  assert.equal(coverageText(mechanic), "Aguascalientes y Jesús María");
  assert.equal(coverageText({ city: "Calvillo", serviceAreas: [] }), "Calvillo");
  assert.equal(coverageText({ city: "Calvillo", serviceAreas: [...AGUASCALIENTES_MUNICIPALITIES] }), "Todo el estado de Aguascalientes");
});

test("zonas: guardar dónde da servicio valida municipios y distancia, y deja la ciudad con su nombre oficial", async () => {
  const { saveServiceArea, getServiceArea, ServiceAreaError } = require("../src/serviceAreas.ts");
  const mechanicId = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro");

  const saved = await saveServiceArea(mechanicId, {
    city: "ags",
    zone: "  Sur  ",
    serviceAreas: ["calvillo", "Jesús María", "jesus maria"],
    serviceRadiusKm: 50
  });
  assert.deepEqual(saved, { city: "Aguascalientes", zone: "Sur", serviceAreas: ["Calvillo", "Jesús María"], serviceRadiusKm: 50, worksOn: "auto" });
  assert.deepEqual(await getServiceArea(mechanicId), saved);

  for (const bad of [
    { city: "Aguascalientes", zone: "Sur", serviceAreas: ["Zacatecas"], serviceRadiusKm: 25 },
    { city: "Aguascalientes", zone: "Sur", serviceAreas: [], serviceRadiusKm: 30 },
    { city: "A", zone: "Sur", serviceAreas: [], serviceRadiusKm: 25 }
  ]) {
    await assert.rejects(saveServiceArea(mechanicId, bad), (error) => error instanceof ServiceAreaError && error.status === 400);
  }
  assert.deepEqual(await getServiceArea(mechanicId), saved, "lo inválido no cambia nada");

  for (const method of ["GET", "PUT"]) {
    const { response } = await request("/api/mechanics/me/service-area", { method, body: method === "PUT" ? "{}" : undefined });
    assert.equal(response.status, 401);
  }
});

test("zonas: la búsqueda por ciudad incluye a quien atiende ahí desde otro municipio y la zona solo ordena", async () => {
  const { saveServiceArea } = require("../src/serviceAreas.ts");
  // Calificación alta, para que el orden normal (por calificación) los ponga antes que otros.
  const fromCapital = await createOnlineMechanic("Aguascalientes", "Sur");
  await saveServiceArea(fromCapital, { city: "Aguascalientes", zone: "Sur", serviceAreas: ["Jesús María"], serviceRadiusKm: 25 });
  const local = await createOnlineMechanic("Jesús María", "Centro");
  const elsewhere = await createOnlineMechanic("Calvillo", "Centro");
  await run("UPDATE mechanics SET rating = 4.9 WHERE id = ?", [fromCapital]);
  await run("UPDATE mechanics SET rating = 4.1 WHERE id = ?", [local]);
  const mine = [fromCapital, local, elsewhere];
  const ids = (list) => list.map((mechanic) => mechanic.id).filter((id) => mine.includes(id));

  const { body: jesusMaria } = await request(`/mechanics?city=${encodeURIComponent("jesus maria")}&zone=${encodeURIComponent("zona centro")}`);
  assert.deepEqual(ids(jesusMaria), [local, fromCapital], "los de la zona primero, aunque tengan menos calificación");
  assert.deepEqual(jesusMaria.find((mechanic) => mechanic.id === fromCapital).serviceAreas, ["Jesús María"]);

  const { body: capital } = await request(`/mechanics?city=Ags&zone=${encodeURIComponent("Canteras")}`);
  assert.deepEqual(ids(capital), [fromCapital], "una colonia que no coincide con ninguna zona no deja la lista vacía");
});

test("zonas: 'Ahora mismo' llega a quien tiene el auto dentro de su radio, no a 25 km fijos", async () => {
  const { saveServiceArea } = require("../src/serviceAreas.ts");
  const at40Km = (longitude) => ({ latitude: -45.0 + 0.36, longitude });

  // A 40 km con radio de 25: no le llega.
  const holderA = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro", { latitude: -45.0, longitude: -125 });
  const shortRadius = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro", at40Km(-125));
  const requestA = await createPendingRequestWithExpiredHold(`Ciudad-${crypto.randomUUID()}`, "Centro", holderA, "auto", {
    latitude: -45.0,
    longitude: -125
  });

  // A 40 km con radio de 50: sí le llega.
  const holderB = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro", { latitude: -45.0, longitude: -126 });
  const longRadius = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro", at40Km(-126));
  await saveServiceArea(longRadius, { city: "Aguascalientes", zone: "Centro", serviceAreas: [], serviceRadiusKm: 50 });
  // saveServiceArea cambió su ciudad: que no coincida con la de la solicitud por texto.
  const requestB = await createPendingRequestWithExpiredHold(`Ciudad-${crypto.randomUUID()}`, "Centro", holderB, "auto", {
    latitude: -45.0,
    longitude: -126
  });

  await sweepExpiredHolds();

  const offeredA = await get("SELECT mechanic_id AS mechanicId FROM service_requests WHERE id = ?", [requestA]);
  assert.notEqual(offeredA.mechanicId, shortRadius);
  const offeredB = await get("SELECT mechanic_id AS mechanicId FROM service_requests WHERE id = ?", [requestB]);
  assert.equal(offeredB.mechanicId, longRadius);
});

test("Mostrador: invitación, solicitud a tiendas cercanas, respuestas, apartado y ticket automático al entregar", async () => {
  const mostrador = require("../src/mostrador.ts");
  const { getReceiptsForRequest } = require("../src/partsReceipts.ts");
  const distance = (latA, lngA, latB, lngB) => Math.hypot(latA - latB, lngA - lngB) * 111;
  const tag = crypto.randomUUID().slice(0, 8);
  const storeIds = [];
  const userIds = [];
  const partRequestIds = [];

  async function store(name, lat, lng, extra = {}) {
    const created = await run(
      `INSERT INTO parts_stores (name, latitude, longitude, status, radius_km, delivery, receiving, categories)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`,
      [`${name} ${tag}`, lat, lng, extra.radius ?? 5, extra.delivery ?? 0, extra.receiving ?? 1, JSON.stringify(extra.categories ?? [])]
    );
    storeIds.push(created.lastID);
    return created.lastID;
  }
  async function user(fullName) {
    const created = await run(
      `INSERT INTO users (role, login, supabase_user_id, full_name, password_salt, password_hash) VALUES ('customer', ?, ?, ?, 'x', 'x')`,
      [`${crypto.randomUUID()}@example.test`, crypto.randomUUID(), fullName]
    );
    userIds.push(created.lastID);
    return created.lastID;
  }

  try {
    // Tiendas cerca del auto (lat -60, lng -60): una a ~1 km, otra cerca con repartidor, una lejos, una en pausa y una que no surte frenos.
    const near = await store("Refacciones Cerca", -60.009, -60);
    const second = await store("Autopartes Dos", -60.012, -60, { delivery: 1 });
    const far = await store("Refaccionaria Lejos", -60.3, -60);
    const paused = await store("En Pausa", -60.005, -60, { receiving: 0 });
    const noBrakes = await store("Solo Eléctrico", -60.006, -60, { categories: ["Eléctrico"] });
    const admin = await user("Sergio Admin");

    // Invitación del admin: un solo uso.
    const staff = {};
    for (const id of [near, second, far, paused, noBrakes]) {
      const invitation = await mostrador.createInvitation({ storeId: id, email: `tienda-${id}@example.test`, createdByUserId: admin });
      staff[id] = await user(`Mostrador ${id}`);
      const membership = await mostrador.acceptInvitation(invitation.token, staff[id]);
      assert.equal(membership.storeId, id);
      if (id === near) {
        await assert.rejects(mostrador.acceptInvitation(invitation.token, admin), (error) => error.status === 409 && /ya se usó/.test(error.message));
      }
    }
    const revoked = await mostrador.createInvitation({ storeId: near, email: "otra@example.test", createdByUserId: admin });
    await mostrador.revokeInvitation(revoked.id);
    await assert.rejects(mostrador.acceptInvitation(revoked.token, admin), (error) => error.status === 409 && /canceló/.test(error.message));
    await assert.rejects(mostrador.requireMembership(admin), (error) => error.status === 403);

    // El servicio, reparando, con el auto en -60, -60 y una cotización con $1,000 de refacciones por comprar.
    const mechanicId = await createOnlineMechanic(`Ciudad-${tag}`, "Centro");
    const { requestId } = await createRequestInStatus(mechanicId, "repairing");
    await run("UPDATE service_requests SET latitude = -60, longitude = -60 WHERE id = ?", [requestId]);
    await run(
      `INSERT INTO service_quotes (service_request_id, mechanic_id, labor_amount, parts_amount, parts_on_hand_amount, description, status)
       VALUES (?, ?, 500, 1000, 0, 'Cambio de balatas', 'accepted')`,
      [requestId, mechanicId]
    );

    const created = await mostrador.createPartRequest(mechanicId, { serviceRequestId: requestId, part: "Balatas delanteras", category: "Frenos" }, distance);
    partRequestIds.push(created.id);
    assert.deepEqual([...created.storeIds].sort(), [near, second].sort(), "solo las cercanas, recibiendo y que surten frenos");

    // Otro mecánico no puede preguntar por ese servicio.
    const otherMechanic = await createOnlineMechanic(`Ciudad-${tag}`, "Centro");
    await assert.rejects(
      mostrador.createPartRequest(otherMechanic, { serviceRequestId: requestId, part: "Balatas" }, distance),
      (error) => error.status === 403
    );
    // Sin tiendas cerca: no se crea nada y se le dice qué hacer.
    await assert.rejects(
      mostrador.createPartRequest(otherMechanic, { part: "Bujías", latitude: 10, longitude: 10 }, distance),
      (error) => error.status === 404 && /lista de refaccionarias/.test(error.message)
    );

    // Contestan: una con dos opciones, otra que no la tiene. Una tienda a la que no le llegó no puede contestar.
    await mostrador.respondToPartRequest({
      storeId: near,
      userId: staff[near],
      partRequestId: created.id,
      body: {
        available: "yes",
        options: [
          { kind: "generic", price: 650, stock: "counter", warranty: "3 meses" },
          { kind: "original", brand: "Bosch", price: 980, stock: "today" }
        ]
      }
    });
    await assert.rejects(
      mostrador.respondToPartRequest({ storeId: near, userId: staff[near], partRequestId: created.id, body: { available: "no", reason: "Se me acabó" } }),
      (error) => error.status === 409
    );
    await mostrador.respondToPartRequest({
      storeId: second,
      userId: staff[second],
      partRequestId: created.id,
      body: { available: "no", reason: "Se me acabó" }
    });
    await assert.rejects(
      mostrador.respondToPartRequest({ storeId: far, userId: staff[far], partRequestId: created.id, body: { available: "no", reason: "No la manejo" } }),
      (error) => error.status === 404
    );

    let [mine] = await mostrador.mechanicPartRequests(mechanicId, requestId);
    assert.equal(mine.storesNotified, 2);
    assert.equal(mine.stores[0].storeId, near, "la que la tiene, primero");
    assert.deepEqual(mine.stores[0].options.map((option) => option.price), [650, 980]);
    assert.equal(mine.stores[1].declined, "Se me acabó");

    // Ninguna tienda ve los precios de otra.
    const secondFeed = await mostrador.storeFeed(second);
    assert.ok(!JSON.stringify(secondFeed).includes("650"));
    assert.equal(secondFeed.stats.missing[0].count, 1, "lo que le pidieron y no tenía");

    // Apartar: a domicilio solo si la tienda tiene repartidor; una sola vez.
    const cheapest = mine.stores[0].options[0].offerId;
    await assert.rejects(mostrador.holdOffer(mechanicId, created.id, { offerId: cheapest, method: "delivery" }), (error) => error.status === 409);
    const hold = await mostrador.holdOffer(mechanicId, created.id, { offerId: cheapest, method: "pickup" });
    await assert.rejects(mostrador.holdOffer(mechanicId, created.id, { offerId: cheapest, method: "pickup" }), (error) => error.status === 409);

    let nearFeed = await mostrador.storeFeed(near);
    assert.equal(nearFeed.requests[0].state, "won");
    assert.equal(nearFeed.requests[0].mechanicRating, null, "sin reseñas no se presume el 5.0 inicial");
    assert.equal(nearFeed.requests[0].mechanicReviews, 0);
    assert.equal(nearFeed.holds[0].price, 650);
    assert.equal((await mostrador.storeFeed(second)).requests[0].state, "lost");

    // Entregar: número de ticket de la tienda y ticket automático en el servicio, sin foto.
    await assert.rejects(mostrador.deliverHold(second, hold.holdId, { paymentMethod: "Efectivo" }), (error) => error.status === 404);
    const delivered = await mostrador.deliverHold(near, hold.holdId, { paymentMethod: "Efectivo" });
    assert.equal(delivered.ticketCode, "T-0001");
    const { receipts } = await getReceiptsForRequest(requestId);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].amount, 650);
    assert.equal(receipts[0].fromStore, true);
    assert.equal(receipts[0].photoUrl, "");
    assert.equal(receipts[0].status, "accepted", "dentro de lo cotizado se acepta solo");
    assert.match(receipts[0].storeNote, /T-0001/);
    nearFeed = await mostrador.storeFeed(near);
    assert.equal(nearFeed.sales.length, 1);
    assert.equal(nearFeed.stats.salesTotal, 650);
    [mine] = await mostrador.mechanicPartRequests(mechanicId, requestId);
    assert.equal(mine.status, "closed");
    assert.equal(mine.hold.ticketCode, "T-0001");
    assert.equal((await get("SELECT COUNT(*) AS n FROM parts_store_hits WHERE store_id = ?", [near])).n, 1, "cuenta como 'sí tenían la pieza'");

    // Contestar tarde no se puede; un apartado que nadie recoge se libera solo.
    const late = await mostrador.createPartRequest(mechanicId, { serviceRequestId: requestId, part: "Disco de freno", category: "Frenos" }, distance);
    partRequestIds.push(late.id);
    await run("UPDATE part_requests SET respond_until = datetime('now', '-1 minute') WHERE id = ?", [late.id]);
    await assert.rejects(
      mostrador.respondToPartRequest({ storeId: near, userId: staff[near], partRequestId: late.id, body: { available: "no", reason: "No la manejo" } }),
      (error) => error.status === 409 && /venció/.test(error.message)
    );
    await run("UPDATE part_requests SET respond_until = datetime('now', '+5 minutes') WHERE id = ?", [late.id]);
    await mostrador.respondToPartRequest({
      storeId: second,
      userId: staff[second],
      partRequestId: late.id,
      body: { available: "yes", options: [{ kind: "generic", price: 400, stock: "counter" }] }
    });
    const lateMine = (await mostrador.mechanicPartRequests(mechanicId, requestId)).find((r) => r.id === late.id);
    const lateHold = await mostrador.holdOffer(mechanicId, late.id, { offerId: lateMine.stores[0].options[0].offerId, method: "delivery" });
    // Con el apartado, la tienda ve a dónde mandarla y el teléfono del mecánico; las demás no.
    const deliveryHold = (await mostrador.storeFeed(second)).holds.find((item) => item.id === lateHold.holdId);
    assert.deepEqual(deliveryHold.destination, { latitude: -60, longitude: -60 });
    assert.ok(deliveryHold.mechanicPhone);
    assert.equal((await mostrador.storeFeed(near)).holds.length, 0);
    await run("UPDATE part_holds SET expires_at = datetime('now', '-1 minute') WHERE id = ?", [lateHold.holdId]);
    const swept = await mostrador.sweepMostrador();
    assert.ok(swept.some((item) => item.holdId === lateHold.holdId));
    assert.equal((await get("SELECT status FROM part_holds WHERE id = ?", [lateHold.holdId])).status, "expired");

    // La tienda cancela un apartado: el mecánico ve por qué y ya no le puede apartar a ella, pero sí a otra.
    const pump = await mostrador.createPartRequest(mechanicId, { serviceRequestId: requestId, part: "Bomba de agua" }, distance);
    partRequestIds.push(pump.id);
    for (const [id, price] of [[near, 900], [second, 1100]]) {
      await mostrador.respondToPartRequest({
        storeId: id,
        userId: staff[id],
        partRequestId: pump.id,
        body: { available: "yes", options: [{ kind: "generic", price, stock: "counter" }] }
      });
    }
    let pumpMine = (await mostrador.mechanicPartRequests(mechanicId, requestId)).find((r) => r.id === pump.id);
    const nearOffer = pumpMine.stores.find((item) => item.storeId === near).options[0].offerId;
    const pumpHold = await mostrador.holdOffer(mechanicId, pump.id, { offerId: nearOffer, method: "pickup" });
    await mostrador.cancelHoldByStore(near, pumpHold.holdId, { reason: "Se vendió en mostrador" });
    pumpMine = (await mostrador.mechanicPartRequests(mechanicId, requestId)).find((r) => r.id === pump.id);
    assert.equal(pumpMine.status, "open");
    assert.equal(pumpMine.hold.cancelledBy, "store");
    const nearAfter = pumpMine.stores.find((item) => item.storeId === near);
    assert.equal(nearAfter.options.length, 0);
    assert.equal(nearAfter.declined, "Se vendió en mostrador");
    await assert.rejects(mostrador.holdOffer(mechanicId, pump.id, { offerId: nearOffer, method: "pickup" }), (error) => error.status === 409);
    const secondOffer = pumpMine.stores.find((item) => item.storeId === second).options[0].offerId;
    await mostrador.holdOffer(mechanicId, pump.id, { offerId: secondOffer, method: "pickup" });

    // En la lista de refaccionarias se marcan las que contestan en la app y alcanzan el lugar.
    const { listPartsStores } = require("../src/partsStores.ts");
    const listed = await listPartsStores({ latitude: -60, longitude: -60 });
    const flag = (id) => listed.find((item) => item.id === id).mostrador;
    assert.equal(flag(near), true);
    assert.equal(flag(far), false, "fuera de su distancia");
    assert.equal(flag(paused), false, "en pausa");
  } finally {
    for (const id of partRequestIds) {
      await run("DELETE FROM part_holds WHERE part_request_id = ?", [id]);
      await run("DELETE FROM part_offers WHERE part_request_id = ?", [id]);
      await run("DELETE FROM part_request_targets WHERE part_request_id = ?", [id]);
      await run("DELETE FROM part_requests WHERE id = ?", [id]);
    }
    for (const id of storeIds) {
      await run("DELETE FROM parts_store_hits WHERE store_id = ?", [id]);
      await run("DELETE FROM store_members WHERE store_id = ?", [id]);
      await run("DELETE FROM store_invitations WHERE store_id = ?", [id]);
      await run("UPDATE parts_receipts SET store_id = NULL WHERE store_id = ?", [id]);
      await run("DELETE FROM parts_stores WHERE id = ?", [id]);
    }
    for (const id of userIds) await run("DELETE FROM users WHERE id = ?", [id]);
  }
});

test("Mostrador: las rutas piden sesión y una invitación inexistente no revela nada", async () => {
  for (const [method, path] of [
    ["POST", "/api/part-requests"],
    ["GET", "/api/part-requests/mine"],
    ["GET", "/api/mostrador/feed"],
    ["GET", "/api/mostrador/me"],
    ["POST", "/api/mostrador/requests/1/respond"],
    ["POST", "/api/mostrador/holds/1/deliver"],
    ["GET", "/api/admin/mostrador/stores"],
    ["POST", "/api/admin/mostrador/invitations"]
  ]) {
    const { response } = await request(path, { method, body: method === "POST" ? "{}" : undefined });
    assert.equal(response.status, 401, `${method} ${path}`);
  }
  const { response } = await request("/api/mostrador/invitations/no-existe-este-token-de-invitacion");
  assert.equal(response.status, 404);
});

test("motos: una solicitud de moto solo pasa a quien atiende motos, y una de auto nunca a quien solo atiende motos", async () => {
  const city = `Ciudad-${crypto.randomUUID()}`;
  const first = await createOnlineMechanic(city, "Centro");
  const autoOnly = await createOnlineMechanic(city, "Centro");
  const motoOnly = await createOnlineMechanic(city, "Centro");
  // El de motos tiene mejor calificación: si el filtro no existiera, se llevaría también la de auto.
  await run("UPDATE mechanics SET works_on = 'auto', rating = 4.5 WHERE id = ?", [autoOnly]);
  await run("UPDATE mechanics SET works_on = 'moto', rating = 4.9 WHERE id = ?", [motoOnly]);

  const motoRequest = await createPendingRequestWithExpiredHold(city, "Centro", first, "auto");
  await run("UPDATE service_requests SET vehicle_type = 'moto' WHERE id = ?", [motoRequest]);
  await sweepExpiredHolds();
  let row = await get("SELECT mechanic_id AS mechanicId FROM service_requests WHERE id = ?", [motoRequest]);
  assert.equal(row.mechanicId, motoOnly, "la de moto va al que atiende motos");

  // Se libera al de motos (para que esté disponible) y llega una de auto.
  await run("UPDATE service_requests SET status = 'cancelled', hold_expires_at = NULL WHERE id = ?", [motoRequest]);
  const autoRequest = await createPendingRequestWithExpiredHold(city, "Centro", first, "auto");
  await sweepExpiredHolds();
  row = await get("SELECT mechanic_id AS mechanicId FROM service_requests WHERE id = ?", [autoRequest]);
  assert.equal(row.mechanicId, autoOnly, "la de auto no va al que solo atiende motos aunque tenga mejor calificación");

  // Quien atiende los dos puede recibir cualquiera.
  const { servesVehicle, notServedMessage } = require("../src/vehicleTypes.ts");
  assert.equal(servesVehicle("ambos", "moto"), true);
  assert.equal(servesVehicle("ambos", "auto"), true);
  assert.equal(servesVehicle("auto", "moto"), false);
  assert.equal(servesVehicle(null, "auto"), true, "los mecánicos de antes atienden autos");
  assert.match(notServedMessage("auto", "moto"), /no atiende motos/);
  assert.match(notServedMessage("moto", "auto"), /solo atiende motos/);
});

test("motos: la lista de mecánicos dice qué atiende cada uno y se filtra por motos", async () => {
  const city = `Ciudad-${crypto.randomUUID()}`;
  const autoOnly = await createOnlineMechanic(city, "Sur");
  const motoOnly = await createOnlineMechanic(city, "Sur");
  const both = await createOnlineMechanic(city, "Sur");
  await run("UPDATE mechanics SET works_on = 'moto' WHERE id = ?", [motoOnly]);
  await run("UPDATE mechanics SET works_on = 'ambos' WHERE id = ?", [both]);

  const { body: all } = await request(`/mechanics?city=${encodeURIComponent(city)}`);
  assert.equal(all.length, 3);
  assert.equal(all.find((m) => m.id === autoOnly).worksOn, "auto");
  assert.equal(all.find((m) => m.id === motoOnly).worksOn, "moto");

  const { body: motos } = await request(`/mechanics?city=${encodeURIComponent(city)}&vehicleType=moto`);
  assert.deepEqual(motos.map((m) => m.id).sort(), [motoOnly, both].sort());
  const { body: autos } = await request(`/mechanics?city=${encodeURIComponent(city)}&vehicleType=auto`);
  assert.deepEqual(autos.map((m) => m.id).sort(), [autoOnly, both].sort());
});

test("motos: el mecánico guarda qué atiende en «Dónde das servicio» y la app de antes no lo borra", async () => {
  const { saveServiceArea, getServiceArea } = require("../src/serviceAreas.ts");
  const mechanicId = await createOnlineMechanic(`Ciudad-${crypto.randomUUID()}`, "Centro");
  assert.equal((await getServiceArea(mechanicId)).worksOn, "auto", "los de antes quedan en autos");
  const saved = await saveServiceArea(mechanicId, { city: "Aguascalientes", zone: "Sur", serviceAreas: [], serviceRadiusKm: 25, worksOn: "ambos" });
  assert.equal(saved.worksOn, "ambos");
  // Una versión de la app sin el campo no lo cambia.
  await saveServiceArea(mechanicId, { city: "Aguascalientes", zone: "Sur", serviceAreas: [], serviceRadiusKm: 25 });
  assert.equal((await getServiceArea(mechanicId)).worksOn, "ambos");
});
