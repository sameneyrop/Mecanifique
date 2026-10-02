import crypto from "crypto";
import { z } from "zod";
import { all, get, run } from "./db";
import { createStoreReceipt } from "./partsReceipts";
import { communityAuthorName } from "./routes/community";

/**
 * Mostrador: el mecánico pregunta por una pieza y las refaccionarias cercanas
 * contestan desde su computadora con precio y existencia; el mecánico aparta
 * una respuesta y, al entregarla, el ticket de la tienda entra solo al
 * servicio (src/partsReceipts.ts → createStoreReceipt). El dinero de la pieza
 * nunca pasa por Mecanifique: el mecánico paga en la tienda.
 *
 * - Las tiendas son las del directorio (parts_stores). Entran al Mostrador
 *   solo por invitación del admin; su gente entra con una cuenta normal de
 *   Mecanifique ligada a la tienda (store_members).
 * - A una solicitud le llegan las tiendas con Mostrador, "Recibiendo", que
 *   surten esa categoría y que tienen el auto dentro de su distancia.
 * - Las tiendas tienen 5 minutos para contestar; la solicitud sigue abierta
 *   una hora para que el mecánico aparte; el apartado dura 30 minutos.
 * - Ninguna tienda ve las respuestas de las otras.
 */

export const RESPOND_MINUTES = 5;
export const REQUEST_OPEN_MINUTES = 60;
export const HOLD_MINUTES = 30;
export const INVITATION_DAYS = 14;
const MAX_OPEN_REQUESTS = 5;
const MAX_DAILY_REQUESTS = 25;
// Día de México para "hoy" (UTC-6, sin horario de verano).
const MX_DAY = "date(%s, '-6 hours') = date('now', '-6 hours')";

export const PART_CATEGORIES = [
  "Frenos",
  "Suspensión",
  "Encendido",
  "Enfriamiento",
  "Clutch",
  "Eléctrico",
  "Combustible",
  "Motor",
  "Transmisión",
  "Carrocería",
  "Diésel",
  "Importados"
] as const;

export const DECLINE_REASONS = ["No la manejo", "Se me acabó", "No es para ese auto"] as const;
export const PAYMENT_METHODS = ["Efectivo", "Transferencia", "Tarjeta"] as const;

const KIND_TEXT: Record<string, string> = { original: "Original", generic: "Genérica", remanufactured: "Remanufacturada" };
const STOCK_TEXT: Record<string, string> = { counter: "En mostrador", today: "Llega hoy", tomorrow: "Llega mañana" };

export class MostradorError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

function sqliteDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function minutesFromNow(minutes: number): string {
  return sqliteDate(new Date(Date.now() + minutes * 60_000));
}

function parseCategories(json: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(json || "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function offerText(offer: { kind: string | null; brand: string | null; stock: string | null }): string {
  return [KIND_TEXT[offer.kind ?? ""] ?? "", offer.brand ?? "", STOCK_TEXT[offer.stock ?? ""] ?? ""].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------
// Gente de la tienda e invitaciones
// ---------------------------------------------------------------------------

export type Membership = { storeId: number; role: "owner" | "staff"; storeName: string };

export async function membershipsForUser(userId: number): Promise<Membership[]> {
  return all<Membership>(
    `SELECT m.store_id AS storeId, m.role, s.name AS storeName
     FROM store_members m JOIN parts_stores s ON s.id = m.store_id
     WHERE m.user_id = ? AND s.status = 'active'
     ORDER BY m.id`,
    [userId]
  );
}

/** La tienda de esta persona (la primera, o la que pidió si es de varias). */
export async function requireMembership(userId: number, storeId?: number | null): Promise<Membership> {
  const memberships = await membershipsForUser(userId);
  const found = storeId ? memberships.find((m) => m.storeId === storeId) : memberships[0];
  if (!found) {
    throw new MostradorError(403, "Tu cuenta no está ligada a ninguna refaccionaria de Mostrador.");
  }
  return found;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createInvitation(input: {
  storeId: number;
  email: string;
  role?: "owner" | "staff";
  createdByUserId: number;
}): Promise<{ id: number; token: string; expiresAt: string }> {
  const store = await get<{ id: number; status: string }>("SELECT id, status FROM parts_stores WHERE id = ?", [input.storeId]);
  if (!store || store.status !== "active") {
    throw new MostradorError(404, "Refaccionaria no encontrada");
  }
  const email = input.email.trim().toLowerCase();
  if (!z.string().email().safeParse(email).success) {
    throw new MostradorError(400, "Escribe un correo válido.");
  }
  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = sqliteDate(new Date(Date.now() + INVITATION_DAYS * 86_400_000));
  const result = await run(
    `INSERT INTO store_invitations (store_id, email, token_hash, role, created_by_user_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [input.storeId, email, hashToken(token), input.role ?? "owner", input.createdByUserId, expiresAt]
  );
  return { id: result.lastID, token, expiresAt };
}

export type InvitationState = "valid" | "expired" | "used" | "revoked";

export async function invitationByToken(token: string): Promise<{
  id: number;
  storeId: number;
  storeName: string;
  email: string;
  role: "owner" | "staff";
  state: InvitationState;
} | null> {
  if (!token || token.length < 20) return null;
  const row = await get<{
    id: number;
    storeId: number;
    storeName: string;
    email: string;
    role: "owner" | "staff";
    acceptedAt: string | null;
    revokedAt: string | null;
    expired: number;
  }>(
    `SELECT i.id, i.store_id AS storeId, s.name AS storeName, i.email, i.role, i.accepted_at AS acceptedAt,
            i.revoked_at AS revokedAt, i.expires_at <= CURRENT_TIMESTAMP AS expired
     FROM store_invitations i JOIN parts_stores s ON s.id = i.store_id
     WHERE i.token_hash = ?`,
    [hashToken(token)]
  );
  if (!row) return null;
  const state: InvitationState = row.revokedAt ? "revoked" : row.acceptedAt ? "used" : row.expired ? "expired" : "valid";
  return { id: row.id, storeId: row.storeId, storeName: row.storeName, email: row.email, role: row.role, state };
}

const INVITATION_STATE_TEXT: Record<Exclude<InvitationState, "valid">, string> = {
  expired: "Esta invitación ya venció. Pídele a Mecanifique una nueva.",
  used: "Esta invitación ya se usó. Entra con tu correo y contraseña.",
  revoked: "Esta invitación se canceló. Pídele a Mecanifique una nueva."
};

/** La invitación de ese enlace, si todavía se puede usar (si no, el porqué). */
export async function validInvitation(token: string) {
  const invitation = await invitationByToken(token);
  if (!invitation) {
    throw new MostradorError(404, "Invitación no encontrada. Revisa el enlace.");
  }
  if (invitation.state !== "valid") {
    throw new MostradorError(409, INVITATION_STATE_TEXT[invitation.state]);
  }
  return invitation;
}

/** Liga la cuenta a la tienda de la invitación. Una invitación se usa una sola vez. */
export async function acceptInvitation(token: string, userId: number): Promise<Membership> {
  const invitation = await validInvitation(token);
  const claimed = await run(
    `UPDATE store_invitations SET accepted_at = CURRENT_TIMESTAMP, accepted_user_id = ?
     WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    [userId, invitation.id]
  );
  if (claimed.changes === 0) {
    throw new MostradorError(409, INVITATION_STATE_TEXT.used);
  }
  await run("INSERT OR IGNORE INTO store_members (store_id, user_id, role) VALUES (?, ?, ?)", [
    invitation.storeId,
    userId,
    invitation.role
  ]);
  await run("UPDATE parts_stores SET mostrador_enabled = 1 WHERE id = ?", [invitation.storeId]);
  return { storeId: invitation.storeId, role: invitation.role, storeName: invitation.storeName };
}

export async function revokeInvitation(invitationId: number): Promise<void> {
  const result = await run(
    "UPDATE store_invitations SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL",
    [invitationId]
  );
  if (result.changes === 0) {
    throw new MostradorError(404, "Invitación no encontrada o ya usada");
  }
}

/** Admin: buscar en el directorio la refaccionaria a invitar. */
export async function searchDirectory(query: string): Promise<Array<{ id: number; name: string; zone: string | null; address: string | null; enabled: boolean }>> {
  const like = `%${query.trim().replace(/[%_]/g, "")}%`;
  const rows = await all<{ id: number; name: string; zone: string | null; address: string | null; enabled: number }>(
    `SELECT id, name, zone, address, mostrador_enabled AS enabled FROM parts_stores
     WHERE status = 'active' AND (name LIKE ? OR COALESCE(zone, '') LIKE ? OR COALESCE(address, '') LIKE ?)
     ORDER BY mostrador_enabled DESC, name LIMIT 20`,
    [like, like, like]
  );
  return rows.map((row) => ({ ...row, enabled: Boolean(row.enabled) }));
}

const newStoreSchema = z.object({
  name: z.string().trim().min(3).max(120),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(200).optional(),
  zone: z.string().trim().max(80).optional()
});

/** Admin: dar de alta una refaccionaria que no estaba en el directorio, para invitarla. */
export async function createStoreForAdmin(input: unknown): Promise<{ id: number; name: string }> {
  const parsed = newStoreSchema.safeParse(input);
  if (!parsed.success) throw new MostradorError(400, "Escribe al menos el nombre de la refaccionaria.");
  const phone = (parsed.data.phone ?? "").replace(/\D/g, "");
  if (phone.length >= 7) {
    const existing = await get<{ id: number; name: string }>("SELECT id, name FROM parts_stores WHERE phone = ? LIMIT 1", [phone]);
    if (existing) throw new MostradorError(409, `Ese teléfono ya es de «${existing.name}». Búscala en el directorio.`);
  }
  const created = await run(
    "INSERT INTO parts_stores (name, phone, whatsapp, address, zone, status) VALUES (?, ?, ?, ?, ?, 'active')",
    [parsed.data.name, phone.length >= 7 ? phone : null, phone.length >= 7 ? phone : null, parsed.data.address || null, parsed.data.zone || null]
  );
  return { id: created.lastID, name: parsed.data.name };
}

/** Admin: refaccionarias del Mostrador (o con invitaciones), con su gente y sus invitaciones pendientes. */
export async function mostradorStoresForAdmin(): Promise<
  Array<{
    id: number;
    name: string;
    zone: string | null;
    enabled: boolean;
    members: Array<{ name: string; role: string }>;
    invitations: Array<{ id: number; email: string; expiresAt: string }>;
  }>
> {
  const stores = await all<{ id: number; name: string; zone: string | null; enabled: number }>(
    `SELECT s.id, s.name, s.zone, s.mostrador_enabled AS enabled FROM parts_stores s
     WHERE s.mostrador_enabled = 1 OR EXISTS (SELECT 1 FROM store_invitations i WHERE i.store_id = s.id)
     ORDER BY s.name`
  );
  const result = [];
  for (const store of stores) {
    const members = await all<{ name: string; role: string }>(
      `SELECT u.full_name AS name, m.role FROM store_members m JOIN users u ON u.id = m.user_id WHERE m.store_id = ? ORDER BY m.id`,
      [store.id]
    );
    const invitations = await all<{ id: number; email: string; expiresAt: string }>(
      `SELECT id, email, expires_at AS expiresAt FROM store_invitations
       WHERE store_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP
       ORDER BY id DESC`,
      [store.id]
    );
    result.push({ ...store, enabled: Boolean(store.enabled), members, invitations });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Ajustes de la tienda
// ---------------------------------------------------------------------------

export type StoreSettings = {
  storeId: number;
  name: string;
  zone: string | null;
  address: string | null;
  hours: string | null;
  receiving: boolean;
  categories: string[];
  radiusKm: number;
  delivery: boolean;
  latitude: number | null;
  longitude: number | null;
};

export const STORE_RADIUS_OPTIONS = [3, 5, 10, 20] as const;

export async function getStoreSettings(storeId: number): Promise<StoreSettings> {
  const row = await get<{
    name: string;
    zone: string | null;
    address: string | null;
    hours: string | null;
    receiving: number;
    categories: string;
    radiusKm: number;
    delivery: number;
    latitude: number | null;
    longitude: number | null;
  }>(
    `SELECT name, zone, address, hours, receiving, categories, radius_km AS radiusKm, delivery, latitude, longitude
     FROM parts_stores WHERE id = ?`,
    [storeId]
  );
  if (!row) throw new MostradorError(404, "Refaccionaria no encontrada");
  return {
    storeId,
    ...row,
    receiving: Boolean(row.receiving),
    categories: parseCategories(row.categories),
    delivery: Boolean(row.delivery)
  };
}

const settingsSchema = z.object({
  receiving: z.boolean().optional(),
  categories: z.array(z.enum(PART_CATEGORIES)).max(PART_CATEGORIES.length).optional(),
  radiusKm: z.number().int().optional(),
  delivery: z.boolean().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  hours: z.string().trim().max(120).optional()
});

export async function updateStoreSettings(storeId: number, input: unknown): Promise<StoreSettings> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) throw new MostradorError(400, "Revisa los datos de tu tienda.");
  const data = parsed.data;
  if (data.radiusKm !== undefined && !(STORE_RADIUS_OPTIONS as readonly number[]).includes(data.radiusKm)) {
    throw new MostradorError(400, "Elige 3, 5, 10 o 20 km.");
  }
  if ((data.latitude === undefined) !== (data.longitude === undefined)) {
    throw new MostradorError(400, "Falta la latitud o la longitud.");
  }
  const sets: string[] = [];
  const params: Array<string | number> = [];
  if (data.receiving !== undefined) { sets.push("receiving = ?"); params.push(data.receiving ? 1 : 0); }
  if (data.categories !== undefined) { sets.push("categories = ?"); params.push(JSON.stringify(data.categories)); }
  if (data.radiusKm !== undefined) { sets.push("radius_km = ?"); params.push(data.radiusKm); }
  if (data.delivery !== undefined) { sets.push("delivery = ?"); params.push(data.delivery ? 1 : 0); }
  if (data.latitude !== undefined && data.longitude !== undefined) {
    sets.push("latitude = ?", "longitude = ?");
    params.push(data.latitude, data.longitude);
  }
  if (data.hours !== undefined) { sets.push("hours = ?"); params.push(data.hours); }
  if (sets.length) {
    await run(`UPDATE parts_stores SET ${sets.join(", ")} WHERE id = ?`, [...params, storeId]);
  }
  return getStoreSettings(storeId);
}

// ---------------------------------------------------------------------------
// Solicitudes del mecánico
// ---------------------------------------------------------------------------

type DistanceFn = (latA: number, lngA: number, latB: number, lngB: number) => number;

const partRequestSchema = z.object({
  serviceRequestId: z.number().int().positive().optional(),
  part: z.string().trim().min(3).max(120),
  category: z.enum(PART_CATEGORIES).optional(),
  note: z.string().trim().max(300).optional(),
  vehicle: z.string().trim().max(120).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional()
});

export async function createPartRequest(
  mechanicId: number,
  input: unknown,
  distanceKm: DistanceFn
): Promise<{ id: number; storeIds: number[] }> {
  const parsed = partRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new MostradorError(400, "Escribe qué pieza buscas (al menos 3 letras).");
  }
  const data = parsed.data;

  const counts = await get<{ open: number; today: number }>(
    `SELECT
       SUM(CASE WHEN status IN ('open', 'held') AND closes_at > CURRENT_TIMESTAMP THEN 1 ELSE 0 END) AS open,
       SUM(CASE WHEN ${MX_DAY.replace("%s", "created_at")} THEN 1 ELSE 0 END) AS today
     FROM part_requests WHERE mechanic_id = ?`,
    [mechanicId]
  );
  if (Number(counts?.open ?? 0) >= MAX_OPEN_REQUESTS) {
    throw new MostradorError(429, `Ya tienes ${MAX_OPEN_REQUESTS} piezas preguntadas. Aparta o cancela alguna antes de preguntar otra.`);
  }
  if (Number(counts?.today ?? 0) >= MAX_DAILY_REQUESTS) {
    throw new MostradorError(429, "Llegaste al máximo de piezas por preguntar hoy.");
  }

  let vehicle = data.vehicle ?? null;
  let latitude = data.latitude ?? null;
  let longitude = data.longitude ?? null;
  if (data.serviceRequestId) {
    const service = await get<{
      mechanicId: number | null;
      status: string;
      make: string;
      model: string;
      year: number;
      latitude: number | null;
      longitude: number | null;
    }>(
      `SELECT mechanic_id AS mechanicId, status, vehicle_make AS make, vehicle_model AS model, vehicle_year AS year, latitude, longitude
       FROM service_requests WHERE id = ?`,
      [data.serviceRequestId]
    );
    if (!service || service.mechanicId !== mechanicId) {
      throw new MostradorError(403, "Solo el mecánico del servicio puede preguntar por piezas para él.");
    }
    if (service.status === "completed" || service.status === "cancelled") {
      throw new MostradorError(409, "Ese servicio ya terminó.");
    }
    vehicle = `${service.make} ${service.model} ${service.year}`;
    // Cerca del auto: es donde se necesita la pieza.
    if (service.latitude != null && service.longitude != null) {
      latitude = service.latitude;
      longitude = service.longitude;
    }
  }
  if (latitude == null || longitude == null) {
    throw new MostradorError(400, "Necesitamos tu ubicación para preguntarle a las refaccionarias cercanas.");
  }

  const stores = await all<{ id: number; latitude: number; longitude: number; radiusKm: number; categories: string }>(
    `SELECT s.id, s.latitude, s.longitude, s.radius_km AS radiusKm, s.categories
     FROM parts_stores s
     WHERE s.mostrador_enabled = 1 AND s.status = 'active' AND s.receiving = 1
       AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
       AND EXISTS (SELECT 1 FROM store_members m WHERE m.store_id = s.id)`
  );
  // Las que surten esa categoría (sin categorías elegidas, surten todo) y
  // tienen el auto dentro de su distancia.
  const targets = stores
    .filter((store) => {
      const categories = parseCategories(store.categories);
      return !data.category || categories.length === 0 || categories.includes(data.category);
    })
    .map((store) => ({
      id: store.id,
      radiusKm: store.radiusKm,
      km: distanceKm(latitude as number, longitude as number, store.latitude, store.longitude)
    }))
    .filter((store) => store.km <= store.radiusKm);
  if (!targets.length) {
    throw new MostradorError(
      404,
      "Todavía no hay refaccionarias de Mostrador cerca que surtan eso. Usa la lista de refaccionarias para llamarles."
    );
  }

  const created = await run(
    `INSERT INTO part_requests (mechanic_id, service_request_id, part, category, note, vehicle, latitude, longitude, respond_until, closes_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      mechanicId,
      data.serviceRequestId ?? null,
      data.part,
      data.category ?? null,
      data.note || null,
      vehicle,
      latitude,
      longitude,
      minutesFromNow(RESPOND_MINUTES),
      minutesFromNow(REQUEST_OPEN_MINUTES)
    ]
  );
  for (const target of targets) {
    await run("INSERT OR IGNORE INTO part_request_targets (part_request_id, store_id, distance_km) VALUES (?, ?, ?)", [
      created.lastID,
      target.id,
      Math.round(target.km * 10) / 10
    ]);
  }
  return { id: created.lastID, storeIds: targets.map((target) => target.id) };
}

type OfferRow = {
  id: number;
  storeId: number;
  available: "yes" | "order" | "no";
  kind: string | null;
  brand: string | null;
  price: number | null;
  stock: string | null;
  warranty: string | null;
  declineReason: string | null;
};

export type MechanicPartRequest = {
  id: number;
  serviceRequestId: number | null;
  part: string;
  category: string | null;
  note: string | null;
  vehicle: string | null;
  status: "open" | "held" | "closed" | "cancelled";
  createdAt: string;
  respondUntil: string;
  closesAt: string;
  storesNotified: number;
  stores: Array<{
    storeId: number;
    name: string;
    distanceKm: number | null;
    delivery: boolean;
    recentHits: number;
    responded: boolean;
    declined: string | null;
    options: Array<{ offerId: number; available: "yes" | "order"; kind: string | null; brand: string | null; price: number; stock: string | null; warranty: string | null; text: string }>;
  }>;
  hold: null | {
    id: number;
    offerId: number;
    storeId: number;
    storeName: string;
    method: "pickup" | "delivery";
    status: "held" | "dispatched" | "delivered" | "cancelled" | "expired";
    price: number;
    expiresAt: string;
    ticketCode: string | null;
    /** Si la tienda lo canceló, por qué (el mecánico puede apartar otra). */
    cancelledBy: "mechanic" | "store" | null;
    cancelReason: string | null;
    address: string | null;
    city: string;
    storePhone: string | null;
    latitude: number | null;
    longitude: number | null;
  };
};

/** Las piezas que preguntó el mecánico (las de un servicio, o las de las últimas 24 h), con las respuestas. */
export async function mechanicPartRequests(mechanicId: number, serviceRequestId?: number | null): Promise<MechanicPartRequest[]> {
  const requests = await all<Omit<MechanicPartRequest, "stores" | "hold" | "storesNotified">>(
    `SELECT id, service_request_id AS serviceRequestId, part, category, note, vehicle, status,
            created_at AS createdAt, respond_until AS respondUntil, closes_at AS closesAt
     FROM part_requests
     WHERE mechanic_id = ? AND ${serviceRequestId ? "service_request_id = ?" : "created_at > datetime('now', '-1 day')"}
     ORDER BY id DESC LIMIT 20`,
    serviceRequestId ? [mechanicId, serviceRequestId] : [mechanicId]
  );
  const result: MechanicPartRequest[] = [];
  for (const request of requests) {
    const targets = await all<{ storeId: number; name: string; distanceKm: number | null; delivery: number; respondedAt: string | null; recentHits: number }>(
      `SELECT t.store_id AS storeId, s.name, t.distance_km AS distanceKm, s.delivery, t.responded_at AS respondedAt,
              (SELECT COUNT(*) FROM parts_store_hits h WHERE h.store_id = s.id AND h.created_at >= datetime('now', '-90 days')) AS recentHits
       FROM part_request_targets t JOIN parts_stores s ON s.id = t.store_id
       WHERE t.part_request_id = ?`,
      [request.id]
    );
    const offers = await all<OfferRow>(
      `SELECT id, store_id AS storeId, available, kind, brand, price, stock, warranty, decline_reason AS declineReason
       FROM part_offers WHERE part_request_id = ? ORDER BY id`,
      [request.id]
    );
    // Una tienda que canceló un apartado de esta pieza ya no la puede surtir.
    const storeCancelled = await all<{ storeId: number; reason: string | null }>(
      "SELECT store_id AS storeId, cancel_reason AS reason FROM part_holds WHERE part_request_id = ? AND cancelled_by = 'store'",
      [request.id]
    );
    const stores = targets
      .filter((target) => target.respondedAt)
      .map((target) => {
        const cancelled = storeCancelled.find((row) => row.storeId === target.storeId);
        const mine = cancelled ? [] : offers.filter((offer) => offer.storeId === target.storeId);
        const decline = cancelled
          ? { declineReason: cancelled.reason || "Ya no la tiene" }
          : mine.find((offer) => offer.available === "no");
        return {
          storeId: target.storeId,
          name: target.name,
          distanceKm: target.distanceKm,
          delivery: Boolean(target.delivery),
          recentHits: Number(target.recentHits ?? 0),
          responded: true,
          declined: decline ? decline.declineReason : null,
          options: mine
            .filter((offer) => offer.available !== "no" && offer.price != null)
            .map((offer) => ({
              offerId: offer.id,
              available: offer.available as "yes" | "order",
              kind: offer.kind,
              brand: offer.brand,
              price: offer.price as number,
              stock: offer.stock,
              warranty: offer.warranty,
              text: offerText(offer)
            }))
        };
      })
      // Primero las que la tienen, la más barata arriba.
      .sort((a, b) => {
        const priceA = a.options.length ? Math.min(...a.options.map((o) => o.price)) : Infinity;
        const priceB = b.options.length ? Math.min(...b.options.map((o) => o.price)) : Infinity;
        return priceA - priceB;
      });
    const hold = await get<NonNullable<MechanicPartRequest["hold"]>>(
      `SELECT h.id, h.offer_id AS offerId, h.store_id AS storeId, s.name AS storeName, h.method, h.status, h.price,
              h.expires_at AS expiresAt, h.ticket_code AS ticketCode, h.cancelled_by AS cancelledBy, h.cancel_reason AS cancelReason,
              s.address, s.city, s.phone AS storePhone, s.latitude, s.longitude
       FROM part_holds h JOIN parts_stores s ON s.id = h.store_id
       WHERE h.part_request_id = ?
       ORDER BY h.id DESC LIMIT 1`,
      [request.id]
    );
    result.push({ ...request, storesNotified: targets.length, stores, hold: hold ?? null });
  }
  return result;
}

const holdSchema = z.object({ offerId: z.number().int().positive(), method: z.enum(["pickup", "delivery"]) });

export async function holdOffer(
  mechanicId: number,
  partRequestId: number,
  input: unknown
): Promise<{ holdId: number; storeId: number; part: string; price: number; method: "pickup" | "delivery" }> {
  const parsed = holdSchema.safeParse(input);
  if (!parsed.success) throw new MostradorError(400, "Elige una respuesta y si pasas por ella o te la mandan.");
  const { offerId, method } = parsed.data;
  const request = await get<{ mechanicId: number; status: string; part: string; open: number }>(
    `SELECT mechanic_id AS mechanicId, status, part, closes_at > CURRENT_TIMESTAMP AS open FROM part_requests WHERE id = ?`,
    [partRequestId]
  );
  if (!request || request.mechanicId !== mechanicId) throw new MostradorError(404, "Solicitud no encontrada");
  if (request.status === "held") throw new MostradorError(409, "Ya apartaste una respuesta de esta pieza.");
  if (request.status !== "open" || !request.open) throw new MostradorError(409, "Esta solicitud ya se cerró. Pregunta de nuevo.");
  const offer = await get<{ storeId: number; available: string; price: number | null; delivery: number }>(
    `SELECT o.store_id AS storeId, o.available, o.price, s.delivery
     FROM part_offers o JOIN parts_stores s ON s.id = o.store_id
     WHERE o.id = ? AND o.part_request_id = ?`,
    [offerId, partRequestId]
  );
  if (!offer || offer.available === "no" || offer.price == null) throw new MostradorError(404, "Respuesta no encontrada");
  const storeCancelled = await get<{ id: number }>(
    "SELECT id FROM part_holds WHERE part_request_id = ? AND store_id = ? AND cancelled_by = 'store' LIMIT 1",
    [partRequestId, offer.storeId]
  );
  if (storeCancelled) throw new MostradorError(409, "Esa tienda ya no la tiene. Aparta en otra.");
  if (method === "delivery" && !offer.delivery) throw new MostradorError(409, "Esa tienda no tiene repartidor: pasa por ella.");

  const claimed = await run("UPDATE part_requests SET status = 'held' WHERE id = ? AND status = 'open'", [partRequestId]);
  if (claimed.changes === 0) throw new MostradorError(409, "Ya apartaste una respuesta de esta pieza.");
  const created = await run(
    `INSERT INTO part_holds (part_request_id, offer_id, store_id, mechanic_id, method, price, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [partRequestId, offerId, offer.storeId, mechanicId, method, offer.price, minutesFromNow(HOLD_MINUTES)]
  );
  return { holdId: created.lastID, storeId: offer.storeId, part: request.part, price: offer.price, method };
}

/** El mecánico ya no la necesita: cancela la solicitud y, si había apartado, lo suelta. */
export async function cancelPartRequest(mechanicId: number, partRequestId: number): Promise<{ storeIds: number[]; releasedStoreId: number | null }> {
  const request = await get<{ mechanicId: number; status: string }>(
    "SELECT mechanic_id AS mechanicId, status FROM part_requests WHERE id = ?",
    [partRequestId]
  );
  if (!request || request.mechanicId !== mechanicId) throw new MostradorError(404, "Solicitud no encontrada");
  if (request.status === "closed" || request.status === "cancelled") throw new MostradorError(409, "Esta solicitud ya se cerró.");
  const hold = await get<{ id: number; storeId: number; status: string }>(
    "SELECT id, store_id AS storeId, status FROM part_holds WHERE part_request_id = ? AND status IN ('held', 'dispatched')",
    [partRequestId]
  );
  if (hold?.status === "dispatched") {
    throw new MostradorError(409, "El repartidor ya va en camino con tu pieza. Llámale a la tienda.");
  }
  if (hold) {
    await run("UPDATE part_holds SET status = 'cancelled', cancelled_by = 'mechanic' WHERE id = ?", [hold.id]);
  }
  await run("UPDATE part_requests SET status = 'cancelled' WHERE id = ?", [partRequestId]);
  const targets = await all<{ storeId: number }>("SELECT store_id AS storeId FROM part_request_targets WHERE part_request_id = ?", [partRequestId]);
  return { storeIds: targets.map((t) => t.storeId), releasedStoreId: hold?.storeId ?? null };
}

// ---------------------------------------------------------------------------
// Lo que ve y hace la tienda
// ---------------------------------------------------------------------------

const optionSchema = z.object({
  kind: z.enum(["original", "generic", "remanufactured"]),
  brand: z.string().trim().max(60).optional(),
  price: z.number().positive().max(1_000_000),
  stock: z.enum(["counter", "today", "tomorrow"]),
  warranty: z.string().trim().max(40).optional()
});
const respondSchema = z.discriminatedUnion("available", [
  z.object({ available: z.literal("yes"), options: z.array(optionSchema).min(1).max(2) }),
  z.object({ available: z.literal("order"), options: z.array(optionSchema).min(1).max(2) }),
  z.object({ available: z.literal("no"), reason: z.enum(DECLINE_REASONS) })
]);

export async function respondToPartRequest(input: {
  storeId: number;
  userId: number;
  partRequestId: number;
  body: unknown;
}): Promise<{
  mechanicId: number;
  serviceRequestId: number | null;
  part: string;
  storeName: string;
  available: "yes" | "order" | "no";
  cheapest: number | null;
}> {
  const parsed = respondSchema.safeParse(input.body);
  if (!parsed.success) throw new MostradorError(400, "Escribe el precio, el tipo de pieza y si la tienes.");
  const target = await get<{
    respondedAt: string | null;
    status: string;
    canRespond: number;
    mechanicId: number;
    serviceRequestId: number | null;
    part: string;
    storeName: string;
  }>(
    `SELECT t.responded_at AS respondedAt, r.status, r.respond_until > CURRENT_TIMESTAMP AS canRespond, r.mechanic_id AS mechanicId,
            r.service_request_id AS serviceRequestId, r.part, s.name AS storeName
     FROM part_request_targets t JOIN part_requests r ON r.id = t.part_request_id JOIN parts_stores s ON s.id = t.store_id
     WHERE t.part_request_id = ? AND t.store_id = ?`,
    [input.partRequestId, input.storeId]
  );
  if (!target) throw new MostradorError(404, "Solicitud no encontrada");
  if (target.respondedAt) throw new MostradorError(409, "Ya contestaste esta solicitud.");
  if (target.status !== "open") throw new MostradorError(409, "El mecánico ya eligió otra tienda o canceló.");
  if (!target.canRespond) throw new MostradorError(409, "Se venció el tiempo para contestar esta solicitud.");

  const claimed = await run(
    "UPDATE part_request_targets SET responded_at = CURRENT_TIMESTAMP WHERE part_request_id = ? AND store_id = ? AND responded_at IS NULL",
    [input.partRequestId, input.storeId]
  );
  if (claimed.changes === 0) throw new MostradorError(409, "Ya contestaste esta solicitud.");
  const data = parsed.data;
  if (data.available === "no") {
    await run(
      `INSERT INTO part_offers (part_request_id, store_id, responder_user_id, available, decline_reason) VALUES (?, ?, ?, 'no', ?)`,
      [input.partRequestId, input.storeId, input.userId, data.reason]
    );
    return {
      mechanicId: target.mechanicId,
      serviceRequestId: target.serviceRequestId,
      part: target.part,
      storeName: target.storeName,
      available: "no",
      cheapest: null
    };
  }
  for (const option of data.options) {
    await run(
      `INSERT INTO part_offers (part_request_id, store_id, responder_user_id, available, kind, brand, price, stock, warranty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.partRequestId,
        input.storeId,
        input.userId,
        data.available,
        option.kind,
        option.brand || null,
        Math.round(option.price * 100) / 100,
        option.stock,
        option.warranty || null
      ]
    );
  }
  return {
    mechanicId: target.mechanicId,
    serviceRequestId: target.serviceRequestId,
    part: target.part,
    storeName: target.storeName,
    available: data.available,
    cheapest: Math.min(...data.options.map((option) => option.price))
  };
}

type HoldContext = {
  id: number;
  status: string;
  method: "pickup" | "delivery";
  price: number;
  storeId: number;
  storeName: string;
  mechanicId: number;
  partRequestId: number;
  serviceRequestId: number | null;
  part: string;
  vehicle: string | null;
};

async function holdForStore(storeId: number, holdId: number): Promise<HoldContext> {
  const hold = await get<HoldContext>(
    `SELECT h.id, h.status, h.method, h.price, h.store_id AS storeId, s.name AS storeName, h.mechanic_id AS mechanicId,
            h.part_request_id AS partRequestId, r.service_request_id AS serviceRequestId, r.part, r.vehicle
     FROM part_holds h JOIN part_requests r ON r.id = h.part_request_id JOIN parts_stores s ON s.id = h.store_id
     WHERE h.id = ?`,
    [holdId]
  );
  if (!hold || hold.storeId !== storeId) throw new MostradorError(404, "Apartado no encontrado");
  return hold;
}

export async function dispatchHold(storeId: number, holdId: number): Promise<HoldContext> {
  const hold = await holdForStore(storeId, holdId);
  if (hold.method !== "delivery") throw new MostradorError(409, "Este apartado es para recoger en la tienda.");
  const updated = await run("UPDATE part_holds SET status = 'dispatched', dispatched_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'held'", [holdId]);
  if (updated.changes === 0) throw new MostradorError(409, "Este apartado ya no está esperando.");
  return hold;
}

const deliverSchema = z.object({ paymentMethod: z.enum(PAYMENT_METHODS) });

/**
 * La tienda entregó la pieza y cobró. Le asigna su número de ticket y, si la
 * pieza era para un servicio, el ticket entra solo al servicio del cliente.
 */
export async function deliverHold(
  storeId: number,
  holdId: number,
  input: unknown
): Promise<HoldContext & { ticketCode: string; receiptId: number | null; customerId: number | null; overEstimate: boolean }> {
  const parsed = deliverSchema.safeParse(input);
  if (!parsed.success) throw new MostradorError(400, "Elige cómo pagó: efectivo, transferencia o tarjeta.");
  const hold = await holdForStore(storeId, holdId);
  if (hold.status !== "held" && hold.status !== "dispatched") throw new MostradorError(409, "Este apartado ya no está activo.");

  const counter = await get<{ next: number }>("SELECT next_ticket AS next FROM parts_stores WHERE id = ?", [storeId]);
  const number = counter?.next ?? 1;
  await run("UPDATE parts_stores SET next_ticket = next_ticket + 1 WHERE id = ?", [storeId]);
  const ticketCode = `T-${String(number).padStart(4, "0")}`;

  const updated = await run(
    `UPDATE part_holds SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP, payment_method = ?, ticket_code = ?
     WHERE id = ? AND status IN ('held', 'dispatched')`,
    [parsed.data.paymentMethod, ticketCode, holdId]
  );
  if (updated.changes === 0) throw new MostradorError(409, "Este apartado ya no está activo.");
  await run("UPDATE part_requests SET status = 'closed' WHERE id = ?", [hold.partRequestId]);
  // Cuenta como "sí tenían la pieza" en el directorio.
  await run("INSERT INTO parts_store_hits (store_id, mechanic_id, service_request_id, part, vehicle) VALUES (?, ?, ?, ?, ?)", [
    storeId,
    hold.mechanicId,
    hold.serviceRequestId,
    hold.part,
    hold.vehicle
  ]);

  let receiptId: number | null = null;
  let customerId: number | null = null;
  let overEstimate = false;
  if (hold.serviceRequestId) {
    const receipt = await createStoreReceipt({
      requestId: hold.serviceRequestId,
      amount: hold.price,
      storeId,
      storeNote: `${hold.storeName} · ${hold.part} · Ticket ${ticketCode}`
    });
    if (receipt) {
      receiptId = receipt.receipt.id;
      customerId = receipt.customerId;
      overEstimate = receipt.overEstimate;
      await run("UPDATE part_holds SET receipt_id = ? WHERE id = ?", [receiptId, holdId]);
    }
  }
  return { ...hold, ticketCode, receiptId, customerId, overEstimate };
}

const storeCancelSchema = z.object({ reason: z.string().trim().min(3).max(120) });

/** La tienda ya no puede surtir el apartado (p. ej. se vendió en mostrador): el mecánico puede apartar otra. */
export async function cancelHoldByStore(storeId: number, holdId: number, input: unknown): Promise<HoldContext> {
  const parsed = storeCancelSchema.safeParse(input);
  if (!parsed.success) throw new MostradorError(400, "Escribe por qué no puedes entregarla.");
  const hold = await holdForStore(storeId, holdId);
  const updated = await run(
    "UPDATE part_holds SET status = 'cancelled', cancelled_by = 'store', cancel_reason = ? WHERE id = ? AND status IN ('held', 'dispatched')",
    [parsed.data.reason, holdId]
  );
  if (updated.changes === 0) throw new MostradorError(409, "Este apartado ya no está activo.");
  await run("UPDATE part_requests SET status = 'open' WHERE id = ? AND status = 'held' AND closes_at > CURRENT_TIMESTAMP", [hold.partRequestId]);
  await run("UPDATE part_requests SET status = 'closed' WHERE id = ? AND status = 'held'", [hold.partRequestId]);
  return hold;
}

/** Apartados que nadie recogió y solicitudes que ya cerraron. Para avisarle a cada quien. */
export async function sweepMostrador(): Promise<Array<{ holdId: number; storeId: number; mechanicId: number; part: string }>> {
  const expired = await all<{ holdId: number; storeId: number; mechanicId: number; part: string; partRequestId: number }>(
    `SELECT h.id AS holdId, h.store_id AS storeId, h.mechanic_id AS mechanicId, r.part, h.part_request_id AS partRequestId
     FROM part_holds h JOIN part_requests r ON r.id = h.part_request_id
     WHERE h.status = 'held' AND h.expires_at <= CURRENT_TIMESTAMP`
  );
  for (const hold of expired) {
    const updated = await run("UPDATE part_holds SET status = 'expired' WHERE id = ? AND status = 'held'", [hold.holdId]);
    if (updated.changes) await run("UPDATE part_requests SET status = 'closed' WHERE id = ?", [hold.partRequestId]);
  }
  await run("UPDATE part_requests SET status = 'closed' WHERE status = 'open' AND closes_at <= CURRENT_TIMESTAMP");
  return expired.map(({ holdId, storeId, mechanicId, part }) => ({ holdId, storeId, mechanicId, part }));
}

export type StoreFeed = {
  requests: Array<{
    id: number;
    part: string;
    category: string | null;
    note: string | null;
    vehicle: string | null;
    mechanicName: string;
    mechanicRating: number | null;
    mechanicJobs: number;
    distanceKm: number | null;
    otherStores: number;
    createdAt: string;
    respondUntil: string;
    state: "new" | "answered" | "won" | "lost" | "expired" | "cancelled";
    response: null | { available: "yes" | "order" | "no"; reason: string | null; options: Array<{ text: string; price: number; warranty: string | null }> };
  }>;
  holds: Array<{
    id: number;
    part: string;
    vehicle: string | null;
    mechanicName: string;
    method: "pickup" | "delivery";
    status: "held" | "dispatched";
    price: number;
    text: string;
    warranty: string | null;
    distanceKm: number | null;
    expiresAt: string;
    /** Solo de quien ya apartó con esta tienda, para ponerse de acuerdo. */
    mechanicPhone: string | null;
    /** A dónde llevarla (solo si se la mandan): el auto o donde estaba el mecánico. */
    destination: { latitude: number; longitude: number } | null;
  }>;
  sales: Array<{ id: number; deliveredAt: string; part: string; vehicle: string | null; mechanicName: string; price: number; paymentMethod: string | null; ticketCode: string | null }>;
  stats: {
    received: number;
    answered: number;
    avgResponseSeconds: number;
    won: number;
    salesTotal: number;
    hourly: Record<number, number>;
    categories: Array<{ category: string; count: number }>;
    missing: Array<{ part: string; count: number }>;
  };
};

/** Todo lo del Mostrador de una tienda: solicitudes de las últimas 3 horas, apartados, ventas y números de hoy. */
export async function storeFeed(storeId: number): Promise<StoreFeed> {
  const requestRows = await all<{
    id: number;
    part: string;
    category: string | null;
    note: string | null;
    vehicle: string | null;
    mechanicName: string;
    mechanicRating: number | null;
    mechanicJobs: number;
    distanceKm: number | null;
    createdAt: string;
    respondUntil: string;
    status: string;
    canRespond: number;
    respondedAt: string | null;
    otherStores: number;
    wonByMe: number;
  }>(
    `SELECT r.id, r.part, r.category, r.note, r.vehicle, m.full_name AS mechanicName, m.rating AS mechanicRating,
            m.jobs_completed AS mechanicJobs, t.distance_km AS distanceKm, r.created_at AS createdAt, r.respond_until AS respondUntil,
            r.status, r.respond_until > CURRENT_TIMESTAMP AS canRespond, t.responded_at AS respondedAt,
            (SELECT COUNT(*) - 1 FROM part_request_targets x WHERE x.part_request_id = r.id) AS otherStores,
            EXISTS (SELECT 1 FROM part_holds h WHERE h.part_request_id = r.id AND h.store_id = t.store_id
                    AND h.status IN ('held', 'dispatched', 'delivered')) AS wonByMe
     FROM part_request_targets t JOIN part_requests r ON r.id = t.part_request_id JOIN mechanics m ON m.id = r.mechanic_id
     WHERE t.store_id = ? AND r.created_at > datetime('now', '-3 hours')
     ORDER BY r.id DESC LIMIT 40`,
    [storeId]
  );
  const offers = requestRows.length
    ? await all<OfferRow & { partRequestId: number }>(
        `SELECT id, part_request_id AS partRequestId, store_id AS storeId, available, kind, brand, price, stock, warranty, decline_reason AS declineReason
         FROM part_offers WHERE store_id = ? AND part_request_id IN (${requestRows.map(() => "?").join(",")})`,
        [storeId, ...requestRows.map((row) => row.id)]
      )
    : [];
  const requests: StoreFeed["requests"] = requestRows.map((row) => {
    const mine = offers.filter((offer) => offer.partRequestId === row.id);
    let state: StoreFeed["requests"][number]["state"];
    if (row.wonByMe) state = "won";
    else if (row.respondedAt) state = row.status === "held" || row.status === "closed" ? "lost" : "answered";
    else if (row.status === "cancelled") state = "cancelled";
    else if (row.status !== "open" || !row.canRespond) state = row.status === "open" ? "expired" : "lost";
    else state = "new";
    if (row.status === "cancelled" && state === "answered") state = "cancelled";
    return {
      id: row.id,
      part: row.part,
      category: row.category,
      note: row.note,
      vehicle: row.vehicle,
      mechanicName: communityAuthorName(row.mechanicName),
      mechanicRating: row.mechanicRating,
      mechanicJobs: Number(row.mechanicJobs ?? 0),
      distanceKm: row.distanceKm,
      otherStores: Math.max(0, Number(row.otherStores ?? 0)),
      createdAt: row.createdAt,
      respondUntil: row.respondUntil,
      state,
      response: mine.length
        ? {
            available: mine[0].available,
            reason: mine[0].declineReason,
            options: mine
              .filter((offer) => offer.price != null)
              .map((offer) => ({ text: offerText(offer), price: offer.price as number, warranty: offer.warranty }))
          }
        : null
    };
  });

  const holdRows = await all<{
    id: number;
    part: string;
    vehicle: string | null;
    mechanicName: string;
    method: "pickup" | "delivery";
    status: "held" | "dispatched";
    price: number;
    kind: string | null;
    brand: string | null;
    stock: string | null;
    warranty: string | null;
    distanceKm: number | null;
    expiresAt: string;
    mechanicPhone: string | null;
    latitude: number | null;
    longitude: number | null;
  }>(
    `SELECT h.id, r.part, r.vehicle, m.full_name AS mechanicName, h.method, h.status, h.price, o.kind, o.brand, o.stock, o.warranty,
            t.distance_km AS distanceKm, h.expires_at AS expiresAt, m.phone AS mechanicPhone, r.latitude, r.longitude
     FROM part_holds h
     JOIN part_requests r ON r.id = h.part_request_id
     JOIN part_offers o ON o.id = h.offer_id
     JOIN mechanics m ON m.id = h.mechanic_id
     LEFT JOIN part_request_targets t ON t.part_request_id = h.part_request_id AND t.store_id = h.store_id
     WHERE h.store_id = ? AND h.status IN ('held', 'dispatched')
     ORDER BY h.expires_at`,
    [storeId]
  );
  const holds = holdRows.map((row) => ({
    id: row.id,
    part: row.part,
    vehicle: row.vehicle,
    mechanicName: communityAuthorName(row.mechanicName),
    method: row.method,
    status: row.status,
    price: row.price,
    text: offerText(row),
    warranty: row.warranty,
    distanceKm: row.distanceKm,
    expiresAt: row.expiresAt,
    mechanicPhone: row.mechanicPhone,
    destination:
      row.method === "delivery" && row.latitude != null && row.longitude != null
        ? { latitude: row.latitude, longitude: row.longitude }
        : null
  }));

  const salesRows = await all<{
    id: number;
    deliveredAt: string;
    part: string;
    vehicle: string | null;
    mechanicName: string;
    price: number;
    paymentMethod: string | null;
    ticketCode: string | null;
  }>(
    `SELECT h.id, h.delivered_at AS deliveredAt, r.part, r.vehicle, m.full_name AS mechanicName, h.price,
            h.payment_method AS paymentMethod, h.ticket_code AS ticketCode
     FROM part_holds h JOIN part_requests r ON r.id = h.part_request_id JOIN mechanics m ON m.id = h.mechanic_id
     WHERE h.store_id = ? AND h.status = 'delivered' AND ${MX_DAY.replace("%s", "h.delivered_at")}
     ORDER BY h.delivered_at DESC`,
    [storeId]
  );
  const sales = salesRows.map((row) => ({ ...row, mechanicName: communityAuthorName(row.mechanicName) }));

  const today = await get<{ received: number; answered: number; avgSeconds: number | null }>(
    `SELECT COUNT(*) AS received, SUM(t.responded_at IS NOT NULL) AS answered,
            AVG(CASE WHEN t.responded_at IS NOT NULL THEN (julianday(t.responded_at) - julianday(r.created_at)) * 86400 END) AS avgSeconds
     FROM part_request_targets t JOIN part_requests r ON r.id = t.part_request_id
     WHERE t.store_id = ? AND ${MX_DAY.replace("%s", "r.created_at")}`,
    [storeId]
  );
  const won = await get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM part_holds WHERE store_id = ? AND ${MX_DAY.replace("%s", "created_at")}`,
    [storeId]
  );
  const hourlyRows = await all<{ hour: string; count: number }>(
    `SELECT strftime('%H', r.created_at, '-6 hours') AS hour, COUNT(*) AS count
     FROM part_request_targets t JOIN part_requests r ON r.id = t.part_request_id
     WHERE t.store_id = ? AND ${MX_DAY.replace("%s", "r.created_at")}
     GROUP BY hour`,
    [storeId]
  );
  const categories = await all<{ category: string; count: number }>(
    `SELECT COALESCE(r.category, 'Sin categoría') AS category, COUNT(*) AS count
     FROM part_request_targets t JOIN part_requests r ON r.id = t.part_request_id
     WHERE t.store_id = ? AND r.created_at > datetime('now', '-30 days')
     GROUP BY category ORDER BY count DESC LIMIT 8`,
    [storeId]
  );
  const missing = await all<{ part: string; count: number }>(
    `SELECT r.part || COALESCE(' · ' || r.vehicle, '') AS part, COUNT(*) AS count
     FROM part_offers o JOIN part_requests r ON r.id = o.part_request_id
     WHERE o.store_id = ? AND o.available = 'no' AND o.decline_reason <> 'No es para ese auto'
       AND o.created_at > datetime('now', '-30 days')
     GROUP BY part ORDER BY count DESC LIMIT 10`,
    [storeId]
  );
  const hourly: Record<number, number> = {};
  for (const row of hourlyRows) hourly[Number(row.hour)] = Number(row.count);

  return {
    requests,
    holds,
    sales,
    stats: {
      received: Number(today?.received ?? 0),
      answered: Number(today?.answered ?? 0),
      avgResponseSeconds: Math.round(Number(today?.avgSeconds ?? 0)),
      won: Number(won?.count ?? 0),
      salesTotal: sales.reduce((sum, sale) => sum + sale.price, 0),
      hourly,
      categories: categories.map((row) => ({ category: row.category, count: Number(row.count) })),
      missing: missing.map((row) => ({ part: row.part, count: Number(row.count) }))
    }
  };
}
