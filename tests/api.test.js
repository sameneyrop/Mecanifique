process.env.MECANIFIQUE_AUTO_START = "false";

const {
  startServer,
  sweepExpiredHolds,
  applyMechanicConnection,
  activateMechanicIfIdentityApproved,
  lastBookableSlotDate,
  sweepStaleMechanics
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
  acceptedQuotesTotal,
  createQuote,
  getQuotesForRequest,
  hasAcceptedQuote,
  respondToQuote
} = require("../src/quotes.ts");
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
    await run("DELETE FROM service_fees WHERE service_request_id = ?", [requestId]);
    await run("DELETE FROM service_request_declines WHERE service_request_id = ?", [requestId]);
    await run("DELETE FROM service_request_updates WHERE service_request_id = ?", [requestId]);
    await run("DELETE FROM service_requests WHERE id = ?", [requestId]);
  }
  for (const customerId of createdRows.customers) {
    await run("DELETE FROM customers WHERE id = ?", [customerId]);
  }
  for (const mechanicId of createdRows.mechanics) {
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
    `INSERT INTO mechanics (full_name, phone, city, zone, years_experience, specialties, status, is_available, is_online, latitude, longitude, last_seen_at)
     VALUES (?, ?, ?, ?, 3, '["Motor"]', 'active', 1, 1, ?, ?, CURRENT_TIMESTAMP)`,
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
  assert.equal(await acceptedQuotesTotal(requestId), 1700);
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

async function createRegisteredMechanic(status) {
  // Igual que un registro real: is_available = 0, is_online = 0.
  const result = await run(
    `INSERT INTO mechanics (full_name, phone, city, zone, years_experience, specialties, status, is_available, is_online)
     VALUES ('Mecánico Nuevo', ?, ?, 'Centro', 1, '["Motor"]', ?, 0, 0)`,
    [uniquePhone(), `Ciudad-${crypto.randomUUID()}`, status]
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