import crypto from "node:crypto";
import { all, get, run } from "./db";
import { UNPAID_DEBT_SQL } from "./servicePayment";

/**
 * Cuentas nuevas para no pagar. El bloqueo por un servicio sin pagar
 * (unpaidServiceForCustomer) es por cuenta: con otro correo, o borrando la
 * cuenta y volviéndola a abrir, se empezaba limpio. Aquí:
 *
 * - Cuando el mecánico reporta que no le pagaron, se guarda una huella de esa
 *   cuenta: teléfono, correo y celulares (HMAC, no el valor) y la ubicación del
 *   servicio. También justo antes de eliminar una cuenta con una deuda.
 * - Una cuenta distinta con la misma huella (teléfono, correo o celular) no
 *   puede pedir servicio mientras esa deuda siga.
 * - Una solicitud a menos de 100 m de un servicio sin pagar de otra cuenta le
 *   sale al mecánico con un aviso (no se bloquea: puede ser un vecino).
 *
 * Las huellas no se borran: dejan de contar solas cuando el servicio se paga
 * (UNPAID_DEBT_SQL deja de cumplirse).
 */

type Kind = "phone" | "email" | "device";

const SECRET = process.env.FINGERPRINT_SECRET?.trim() || "mecanifique-huellas-v1";
export const NEARBY_UNPAID_METERS = 100;

export function fingerprint(value: string): string {
  return crypto.createHmac("sha256", SECRET).update(value).digest("hex");
}

/** Últimos 10 dígitos de un teléfono real; null si es de relleno ("sin-telefono-…"). */
function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone || !/^[0-9+()\-\s]+$/.test(phone)) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

function normalizeEmail(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase();
  return value && value.includes("@") && !value.endsWith("@mecanifique.invalid") ? value : null;
}

/** Recuerda desde qué celular se usa la cuenta (solo la huella). */
export async function rememberDevice(userId: number, deviceId: string | undefined): Promise<void> {
  if (!deviceId) return;
  await run(
    `INSERT INTO user_devices (user_id, device_hash) VALUES (?, ?)
     ON CONFLICT(user_id, device_hash) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP`,
    [userId, fingerprint(`device:${deviceId}`)]
  );
}

/** Huellas de una cuenta: las de sus teléfonos, su correo y sus celulares. */
async function accountFingerprints(customerId: number, extraDeviceId?: string): Promise<Array<{ kind: Kind; hash: string }>> {
  const customer = await get<{ phone: string | null }>("SELECT phone FROM customers WHERE id = ?", [customerId]);
  const user = await get<{ id: number; login: string | null; verifiedPhone: string | null }>(
    "SELECT id, login, verified_phone AS verifiedPhone FROM users WHERE customer_id = ?",
    [customerId]
  );
  const result: Array<{ kind: Kind; hash: string }> = [];
  for (const phone of new Set([normalizePhone(customer?.phone), normalizePhone(user?.verifiedPhone)])) {
    if (phone) result.push({ kind: "phone", hash: fingerprint(`phone:${phone}`) });
  }
  const email = normalizeEmail(user?.login);
  if (email) result.push({ kind: "email", hash: fingerprint(`email:${email}`) });
  if (user) {
    const devices = await all<{ deviceHash: string }>("SELECT device_hash AS deviceHash FROM user_devices WHERE user_id = ?", [
      user.id
    ]);
    for (const device of devices) result.push({ kind: "device", hash: device.deviceHash });
  }
  if (extraDeviceId) result.push({ kind: "device", hash: fingerprint(`device:${extraDeviceId}`) });
  return result;
}

/**
 * Guarda la huella de quien debe el servicio. Se puede llamar varias veces
 * (p. ej. si cambió de teléfono): solo agrega lo nuevo.
 */
export async function recordUnpaidFingerprints(requestId: number): Promise<void> {
  const request = await get<{ customerId: number; latitude: number | null; longitude: number | null }>(
    "SELECT customer_id AS customerId, latitude, longitude FROM service_requests WHERE id = ?",
    [requestId]
  );
  if (!request) return;
  for (const { kind, hash } of await accountFingerprints(request.customerId)) {
    await run(
      "INSERT OR IGNORE INTO unpaid_fingerprints (service_request_id, customer_id, kind, value_hash) VALUES (?, ?, ?, ?)",
      [requestId, request.customerId, kind, hash]
    );
  }
  if (request.latitude != null && request.longitude != null) {
    await run(
      `INSERT OR IGNORE INTO unpaid_fingerprints (service_request_id, customer_id, kind, value_hash, latitude, longitude)
       VALUES (?, ?, 'location', 'location', ?, ?)`,
      [requestId, request.customerId, request.latitude, request.longitude]
    );
  }
}

/** Antes de eliminar una cuenta: guarda la huella de cada servicio que todavía debe. */
export async function recordFingerprintsBeforeDeletion(customerId: number | null): Promise<void> {
  if (!customerId) return;
  const debts = await all<{ id: number }>(`SELECT sr.id FROM service_requests sr WHERE sr.customer_id = ? AND ${UNPAID_DEBT_SQL}`, [
    customerId
  ]);
  for (const debt of debts) {
    await recordUnpaidFingerprints(debt.id);
  }
}

/**
 * ¿Esta cuenta comparte teléfono, correo o celular con otra que debe un
 * servicio? Devuelve ese servicio, o null.
 */
export async function linkedUnpaidService(customerId: number, deviceId?: string): Promise<{ requestId: number } | null> {
  const hashes = [...new Set((await accountFingerprints(customerId, deviceId)).map((item) => item.hash))];
  if (hashes.length === 0) return null;
  const row = await get<{ requestId: number }>(
    `SELECT f.service_request_id AS requestId
     FROM unpaid_fingerprints f
     JOIN service_requests sr ON sr.id = f.service_request_id
     WHERE f.kind IN ('phone', 'email', 'device')
       AND f.value_hash IN (${hashes.map(() => "?").join(", ")})
       AND (f.customer_id IS NULL OR f.customer_id <> ?)
       AND ${UNPAID_DEBT_SQL}
     LIMIT 1`,
    [...hashes, customerId]
  );
  return row ?? null;
}

function distanceMeters(latA: number, lngA: number, latB: number, lngB: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const a =
    Math.sin(toRad(latB - latA) / 2) ** 2 + Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(toRad(lngB - lngA) / 2) ** 2;
  return 2 * 6_371_000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** ¿Hay un servicio sin pagar de otra cuenta a menos de 100 m de aquí? */
export async function unpaidServiceNearby(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  customerId: number
): Promise<boolean> {
  if (latitude == null || longitude == null) return false;
  const delta = 0.002; // ~200 m: primero un cuadro barato, luego la distancia real.
  const rows = await all<{ latitude: number; longitude: number }>(
    `SELECT f.latitude, f.longitude
     FROM unpaid_fingerprints f
     JOIN service_requests sr ON sr.id = f.service_request_id
     WHERE f.kind = 'location'
       AND f.latitude BETWEEN ? AND ? AND f.longitude BETWEEN ? AND ?
       AND (f.customer_id IS NULL OR f.customer_id <> ?)
       AND ${UNPAID_DEBT_SQL}`,
    [latitude - delta, latitude + delta, longitude - delta, longitude + delta, customerId]
  );
  return rows.some((row) => distanceMeters(latitude, longitude, row.latitude, row.longitude) <= NEARBY_UNPAID_METERS);
}

/** Servicios que el cliente ha terminado sin que el mecánico reportara falta de pago. */
export async function customerCompletedServices(customerId: number): Promise<number> {
  const row = await get<{ total: number }>(
    `SELECT COUNT(*) AS total FROM service_requests
     WHERE customer_id = ? AND status = 'completed' AND (paid_at IS NOT NULL OR unpaid_reported_at IS NULL)`,
    [customerId]
  );
  return Number(row?.total ?? 0);
}
