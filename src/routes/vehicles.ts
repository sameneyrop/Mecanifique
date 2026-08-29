import { Router } from "express";
import { z } from "zod";
import { all, get, run } from "../db";
import { handleAsync, requireAnyAuth } from "../middleware";

const vehicleFieldsSchema = z.object({
  nickname: z.string().trim().min(1).max(50).optional(),
  make: z.string().trim().min(2).max(50),
  model: z.string().trim().min(1).max(50),
  year: z.number().int().gte(1886).lte(new Date().getFullYear() + 1),
  licensePlate: z.string().trim().min(2).max(12).regex(/^[A-Za-z0-9 -]+$/).optional(),
  color: z.string().trim().min(1).max(30).optional(),
  mileage: z.number().int().nonnegative().max(2_000_000).optional(),
  photoUrls: z.array(z.string().url().refine((url) => /^https?:\/\//i.test(url), "La foto debe ser una URL HTTP(S)")).max(10).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});
const vehicleCreateSchema = vehicleFieldsSchema;
const vehicleUpdateSchema = vehicleFieldsSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "Debes enviar al menos un campo para actualizar"
);

function maskLicensePlate(plate: string | null): string | null {
  if (!plate) return null;
  const compact = plate.replace(/\s+/g, "");
  if (compact.length <= 3) return "*".repeat(compact.length);
  return `${compact.slice(0, Math.min(2, compact.length - 2))}${"*".repeat(Math.max(1, compact.length - 4))}${compact.slice(-2)}`;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function vehicleResponse(row: {
  id: number; customerId: number; nickname: string | null; make: string; model: string;
  year: number; licensePlate: string | null; color: string | null; mileage: number | null;
  photoUrlsJson: string; metadataJson: string; createdAt: string; updatedAt: string;
}) {
  return {
    id: row.id, customerId: row.customerId, nickname: row.nickname, make: row.make,
    model: row.model, year: row.year, licensePlate: maskLicensePlate(row.licensePlate),
    color: row.color, mileage: row.mileage,
    photoUrls: parseJson<string[]>(row.photoUrlsJson, []),
    metadata: parseJson<Record<string, unknown>>(row.metadataJson, {}),
    createdAt: row.createdAt, updatedAt: row.updatedAt
  };
}

function customerIdForVehicle(req: Parameters<typeof requireAnyAuth>[0], res: Parameters<typeof requireAnyAuth>[1]): number | null {
  const customerId = req.auth?.user.customerId ?? req.supabaseAuth?.user.customerId ?? null;
  if (!customerId || (req.auth?.user.role !== "customer" && req.supabaseAuth?.user.role !== "customer")) {
    res.status(403).json({ error: "Solo los clientes pueden administrar sus vehículos" });
    return null;
  }
  return customerId;
}

const vehicleSelect = `
  SELECT id, customer_id AS customerId, nickname, make, model, year,
         license_plate AS licensePlate, color, mileage,
         photo_urls_json AS photoUrlsJson, metadata_json AS metadataJson,
         created_at AS createdAt, updated_at AS updatedAt
  FROM vehicle_profiles
`;

export const vehiclesRouter = Router();

// Se registran ambos prefijos ("/vehicles" y "/customer/vehicles") tal como
// vivían en server.ts, para no romper clientes existentes que ya usan
// cualquiera de las dos rutas.
vehiclesRouter.get(["/vehicles", "/customer/vehicles"], requireAnyAuth, handleAsync(async (req, res) => {
  const customerId = customerIdForVehicle(req, res);
  if (!customerId) return;
  const rows = await all<any>(`${vehicleSelect} WHERE customer_id = ? ORDER BY id DESC`, [customerId]);
  res.json({ vehicles: rows.map(vehicleResponse) });
}));

vehiclesRouter.post(["/vehicles", "/customer/vehicles"], requireAnyAuth, handleAsync(async (req, res) => {
  const customerId = customerIdForVehicle(req, res);
  if (!customerId) return;
  const payload = vehicleCreateSchema.parse(req.body);
  const result = await run(
    `INSERT INTO vehicle_profiles
      (customer_id, nickname, make, model, year, license_plate, color, mileage, photo_urls_json, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [customerId, payload.nickname ?? null, payload.make, payload.model, payload.year,
      payload.licensePlate?.toUpperCase() ?? null, payload.color ?? null, payload.mileage ?? null,
      JSON.stringify(payload.photoUrls ?? []), JSON.stringify(payload.metadata ?? {})]
  );
  const row = await get<any>(`${vehicleSelect} WHERE id = ? AND customer_id = ?`, [result.lastID, customerId]);
  res.status(201).json(vehicleResponse(row));
}));

vehiclesRouter.get(["/vehicles/:id", "/customer/vehicles/:id"], requireAnyAuth, handleAsync(async (req, res) => {
  const customerId = customerIdForVehicle(req, res);
  if (!customerId) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "vehicleId inválido" });
    return;
  }
  const row = await get<any>(`${vehicleSelect} WHERE id = ? AND customer_id = ?`, [id, customerId]);
  if (!row) {
    res.status(404).json({ error: "Vehículo no encontrado" });
    return;
  }
  res.json(vehicleResponse(row));
}));

vehiclesRouter.patch(["/vehicles/:id", "/customer/vehicles/:id"], requireAnyAuth, handleAsync(async (req, res) => {
  const customerId = customerIdForVehicle(req, res);
  if (!customerId) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "vehicleId inválido" });
    return;
  }
  const payload = vehicleUpdateSchema.parse(req.body);
  const current = await get<any>(`SELECT * FROM vehicle_profiles WHERE id = ? AND customer_id = ?`, [id, customerId]);
  if (!current) {
    res.status(404).json({ error: "Vehículo no encontrado" });
    return;
  }
  const values: unknown[] = [];
  const sets: string[] = [];
  const add = (column: string, value: unknown) => { sets.push(`${column} = ?`); values.push(value); };
  if (payload.nickname !== undefined) add("nickname", payload.nickname);
  if (payload.make !== undefined) add("make", payload.make);
  if (payload.model !== undefined) add("model", payload.model);
  if (payload.year !== undefined) add("year", payload.year);
  if (payload.licensePlate !== undefined) add("license_plate", payload.licensePlate.toUpperCase());
  if (payload.color !== undefined) add("color", payload.color);
  if (payload.mileage !== undefined) add("mileage", payload.mileage);
  if (payload.photoUrls !== undefined) add("photo_urls_json", JSON.stringify(payload.photoUrls));
  if (payload.metadata !== undefined) add("metadata_json", JSON.stringify(payload.metadata));
  sets.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id, customerId);
  await run(`UPDATE vehicle_profiles SET ${sets.join(", ")} WHERE id = ? AND customer_id = ?`, values as any[]);
  const row = await get<any>(`${vehicleSelect} WHERE id = ? AND customer_id = ?`, [id, customerId]);
  res.json(vehicleResponse(row));
}));

vehiclesRouter.delete(["/vehicles/:id", "/customer/vehicles/:id"], requireAnyAuth, handleAsync(async (req, res) => {
  const customerId = customerIdForVehicle(req, res);
  if (!customerId) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "vehicleId inválido" });
    return;
  }
  const result = await run("DELETE FROM vehicle_profiles WHERE id = ? AND customer_id = ?", [id, customerId]);
  if (result.changes === 0) {
    res.status(404).json({ error: "Vehículo no encontrado" });
    return;
  }
  res.status(204).send();
}));
