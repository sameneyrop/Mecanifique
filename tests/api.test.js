process.env.MECANIFIQUE_AUTO_START = "false";

const { startServer } = require("../src/server.ts");
const { ensureLocalUser } = require("../src/supabaseAuth.ts");
const { all } = require("../src/db.ts");
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

test.after(async () => {
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