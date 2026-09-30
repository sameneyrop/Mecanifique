import { all, get, run } from "./db";
import { PARTS_STORES_SEED } from "./partsStoresSeed";

/**
 * Refaccionarias: directorio para que el mecánico encuentre una pieza cerca
 * del auto (fase 1). Lista oficial (src/partsStoresSeed.ts) + las que sugieren
 * los mecánicos, que un admin aprueba. El mecánico puede marcar "sí tenían la
 * pieza": con eso se ve qué tiendas surten (y más adelante, qué piezas).
 */

export class PartsStoreError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export type PartsStore = {
  id: number;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  zone: string | null;
  city: string;
  latitude: number | null;
  longitude: number | null;
  hours: string | null;
  specialties: string | null;
  status: "active" | "pending" | "rejected";
  /** Veces que un mecánico dijo "sí tenían la pieza" (últimos 90 días). */
  recentHits: number;
  distanceKm: number | null;
};

const STORE_COLUMNS = `s.id, s.name, s.phone, s.whatsapp, s.address, s.zone, s.city, s.latitude, s.longitude,
  s.hours, s.specialties, s.status,
  (SELECT COUNT(*) FROM parts_store_hits h WHERE h.store_id = s.id AND h.created_at >= datetime('now', '-90 days')) AS recentHits`;

/** Solo dígitos; un número de 10 dígitos es de México. */
export function normalizeStorePhone(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits;
}

function distanceKm(latA: number, lngA: number, latB: number, lngB: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const a = Math.sin(toRad(latB - latA) / 2) ** 2 + Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(toRad(lngB - lngA) / 2) ** 2;
  return 2 * 6371 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Carga la lista oficial: agrega las nuevas y actualiza las que cambiaron. */
export async function seedPartsStores(seed = PARTS_STORES_SEED): Promise<void> {
  for (const store of seed) {
    await run(
      `INSERT INTO parts_stores (seed_key, name, phone, whatsapp, address, zone, city, latitude, longitude, hours, specialties, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(seed_key) DO UPDATE SET
         name = excluded.name, phone = excluded.phone, whatsapp = excluded.whatsapp, address = excluded.address,
         zone = excluded.zone, city = excluded.city, latitude = excluded.latitude, longitude = excluded.longitude,
         hours = excluded.hours, specialties = excluded.specialties, status = excluded.status`,
      [
        store.key,
        store.name.trim(),
        normalizeStorePhone(store.phone),
        normalizeStorePhone(store.whatsapp),
        store.address?.trim() || null,
        store.zone?.trim() || null,
        store.city?.trim() || "Aguascalientes",
        store.latitude ?? null,
        store.longitude ?? null,
        store.hours?.trim() || null,
        store.specialties?.trim() || null,
        store.active === false ? "rejected" : "active"
      ]
    );
  }
}

/**
 * Refaccionarias activas, las más cercanas primero (a las coordenadas del auto
 * o del mecánico). Las que no tienen ubicación van al final.
 */
export async function listPartsStores(near?: { latitude: number; longitude: number } | null): Promise<PartsStore[]> {
  const rows = await all<Omit<PartsStore, "distanceKm">>(
    `SELECT ${STORE_COLUMNS} FROM parts_stores s WHERE s.status = 'active' ORDER BY s.name LIMIT 300`
  );
  const withDistance = rows.map((row) => ({
    ...row,
    recentHits: Number(row.recentHits ?? 0),
    distanceKm:
      near && row.latitude != null && row.longitude != null
        ? Math.round(distanceKm(near.latitude, near.longitude, row.latitude, row.longitude) * 10) / 10
        : null
  }));
  return withDistance.sort((a, b) => {
    if (a.distanceKm === null && b.distanceKm === null) return b.recentHits - a.recentHits || a.name.localeCompare(b.name);
    if (a.distanceKm === null) return 1;
    if (b.distanceKm === null) return -1;
    return a.distanceKm - b.distanceKm;
  });
}

/** El mecánico sugiere una refaccionaria; queda pendiente hasta que un admin la apruebe. */
export async function suggestPartsStore(input: {
  userId: number;
  name: string;
  phone?: string;
  address?: string;
  zone?: string;
  latitude?: number;
  longitude?: number;
}): Promise<{ id: number }> {
  const phone = normalizeStorePhone(input.phone);
  if (phone) {
    const existing = await get<{ id: number; status: string }>("SELECT id, status FROM parts_stores WHERE phone = ? LIMIT 1", [phone]);
    if (existing) {
      throw new PartsStoreError(
        409,
        existing.status === "active" ? "Esa refaccionaria ya está en la lista." : "Esa refaccionaria ya la sugirió alguien; la estamos revisando."
      );
    }
  }
  const pendingByUser = await get<{ total: number }>(
    "SELECT COUNT(*) AS total FROM parts_stores WHERE suggested_by_user_id = ? AND status = 'pending'",
    [input.userId]
  );
  if (Number(pendingByUser?.total ?? 0) >= 10) {
    throw new PartsStoreError(429, "Ya tienes varias sugerencias en revisión. Espera a que las revisemos.");
  }
  const result = await run(
    `INSERT INTO parts_stores (name, phone, whatsapp, address, zone, latitude, longitude, status, suggested_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      input.name.trim(),
      phone,
      phone,
      input.address?.trim() || null,
      input.zone?.trim() || null,
      input.latitude ?? null,
      input.longitude ?? null,
      input.userId
    ]
  );
  return { id: result.lastID };
}

/** "Sí tenían la pieza". Una por tienda y servicio (si no hay servicio, una al día). */
export async function markStoreHadPart(input: {
  storeId: number;
  mechanicId: number;
  requestId?: number | null;
  part?: string;
  vehicle?: string;
}): Promise<void> {
  const store = await get<{ id: number }>("SELECT id FROM parts_stores WHERE id = ? AND status = 'active'", [input.storeId]);
  if (!store) {
    throw new PartsStoreError(404, "Refaccionaria no encontrada");
  }
  const duplicate = await get<{ id: number }>(
    input.requestId
      ? "SELECT id FROM parts_store_hits WHERE store_id = ? AND mechanic_id = ? AND service_request_id = ?"
      : "SELECT id FROM parts_store_hits WHERE store_id = ? AND mechanic_id = ? AND service_request_id IS NULL AND created_at >= datetime('now', '-1 day')",
    input.requestId ? [input.storeId, input.mechanicId, input.requestId] : [input.storeId, input.mechanicId]
  );
  if (duplicate) {
    return;
  }
  await run(
    "INSERT INTO parts_store_hits (store_id, mechanic_id, service_request_id, part, vehicle) VALUES (?, ?, ?, ?, ?)",
    [input.storeId, input.mechanicId, input.requestId ?? null, input.part?.trim() || null, input.vehicle?.trim() || null]
  );
}

/** Admin: sugerencias por revisar. */
export async function pendingPartsStores(): Promise<Array<PartsStore & { suggestedBy: string | null; createdAt: string }>> {
  const rows = await all<Omit<PartsStore, "distanceKm"> & { suggestedBy: string | null; createdAt: string }>(
    `SELECT ${STORE_COLUMNS}, u.full_name AS suggestedBy, s.created_at AS createdAt
     FROM parts_stores s LEFT JOIN users u ON u.id = s.suggested_by_user_id
     WHERE s.status = 'pending' ORDER BY s.created_at`
  );
  return rows.map((row) => ({ ...row, recentHits: Number(row.recentHits ?? 0), distanceKm: null }));
}

export async function reviewPartsStore(storeId: number, approve: boolean): Promise<void> {
  const result = await run("UPDATE parts_stores SET status = ? WHERE id = ? AND status = 'pending'", [
    approve ? "active" : "rejected",
    storeId
  ]);
  if (result.changes === 0) {
    throw new PartsStoreError(404, "Sugerencia no encontrada");
  }
}
