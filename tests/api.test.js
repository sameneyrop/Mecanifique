process.env.MECANIFIQUE_AUTO_START = "false";

const { startServer } = require("../src/server.ts");
const test = require("node:test");
const assert = require("node:assert/strict");

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