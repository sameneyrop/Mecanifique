process.env.MECANIFIQUE_AUTO_START = "false";

const {
  startServer,
  sweepExpiredHolds,
  applyMechanicConnection,
  activateMechanicIfIdentityApproved
} = require("../src/server.ts");
const { ensureLocalUser } = require("../src/supabaseAuth.ts");
const { all, get, run } = require("../src/db.ts");
const { calculateDepositAmount, getCommissionRate, calculateCommissionAmount } = require("../src/payments.ts");
const { decodePhoto, PhotoUploadError } = require("../src/uploads.ts");
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
    `INSERT INTO mechanics (full_name, phone, city, zone, years_experience, specialties, status, is_available, is_online, latitude, longitude)
     VALUES (?, ?, ?, ?, 3, '["Motor"]', 'active', 1, 1, ?, ?)`,
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