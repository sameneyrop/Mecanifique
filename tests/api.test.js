process.env.MECANIFIQUE_AUTO_START = "false";

const { startServer, sweepExpiredHolds } = require("../src/server.ts");
const { ensureLocalUser } = require("../src/supabaseAuth.ts");
const { all, get, run } = require("../src/db.ts");
const { calculateDepositAmount, getCommissionRate, calculateCommissionAmount } = require("../src/payments.ts");
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

async function createOnlineMechanic(city, zone) {
  const result = await run(
    `INSERT INTO mechanics (full_name, phone, city, zone, years_experience, specialties, status, is_available, is_online)
     VALUES (?, ?, ?, ?, 3, '["Motor"]', 'active', 1, 1)`,
    [`Mecánico ${crypto.randomUUID().slice(0, 6)}`, uniquePhone(), city, zone]
  );
  createdRows.mechanics.push(result.lastID);
  return result.lastID;
}

async function createPendingRequestWithExpiredHold(city, zone, mechanicId, assignmentMode) {
  const customer = await run("INSERT INTO customers (full_name, phone) VALUES (?, ?)", ["Cliente Prueba", uniquePhone()]);
  const request = await run(
    `INSERT INTO service_requests
       (customer_id, vehicle_make, vehicle_model, vehicle_year, issue_description, preferred_time, city, zone,
        status, mechanic_id, hold_expires_at, assignment_mode)
     VALUES (?, 'Nissan', 'Versa', 2020, 'No enciende', 'Ahora', ?, ?, 'pending', ?, datetime('now', '-5 minutes'), ?)`,
    [customer.lastID, city, zone, mechanicId, assignmentMode]
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