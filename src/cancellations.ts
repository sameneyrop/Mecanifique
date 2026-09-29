import { get, run } from "./db";
import { getReceiptsForRequest } from "./partsReceipts";

/**
 * Cancelaciones (decididas por el negocio; ver README.md → "Cancelaciones"):
 *
 * Cliente cancela:
 * - Gratis si el mecánico no ha salido, hasta 5 min después de salir, o si va
 *   tarde (más de 60 min sin llegar desde que salió, o sin salir desde que
 *   aceptó una solicitud para ahora).
 * - Mitad de la visita si ya va en camino.
 * - Visita completa si ya llegó, más las refacciones que ya compró con ticket
 *   aceptado (son del cliente).
 * - Ya reparando no se cancela desde la app: el mecánico cobra solo lo que
 *   hizo (ajuste) y termina, para no perder el trabajo hecho.
 *
 * Cliente ausente: a los 10 min de "Ya llegué" se le avisa; a los 15 el
 * mecánico puede marcar "El cliente no está" con foto del lugar, cerca de la
 * dirección. Se cobra la visita; el cliente puede decir que sí estaba.
 *
 * Mecánico: "Ya no puedo ir" antes de llegar. El cliente no paga nada; si era
 * automática se busca a otro. Queda en su historial (mechanic_withdrawals).
 *
 * El cargo se le paga directo al mecánico con el mismo cobro de doble
 * confirmación (src/servicePayment.ts).
 */

export const FREE_CANCEL_MINUTES = 5;
export const MECHANIC_LATE_MINUTES = 60;
export const ABSENCE_REMINDER_MINUTES = 10;
export const ABSENCE_WAIT_MINUTES = 15;
export const ABSENCE_MAX_DISTANCE_KM = 0.3;

export class CancellationError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type CancellationQuote = {
  allowed: boolean;
  fee: number;
  reason:
    | "free_not_departed"
    | "free_grace"
    | "free_mechanic_late"
    | "half_visit"
    | "full_visit"
    | "work_started"
    | "closed";
  message: string;
};

type TimelineRow = {
  status: string;
  mechanicId: number | null;
  customerId: number;
  mechanicName: string | null;
  visitFee: number | null;
  acceptedAt: string | null;
  enRouteAt: string | null;
  arrivedAt: string | null;
  scheduleSlotId: number | null;
  parentRequestId: number | null;
  latitude: number | null;
  longitude: number | null;
};

async function timeline(requestId: number): Promise<TimelineRow> {
  const row = await get<TimelineRow>(
    `SELECT sr.status, sr.mechanic_id AS mechanicId, sr.customer_id AS customerId, m.full_name AS mechanicName,
            COALESCE(sr.visit_fee, m.labor_rate) AS visitFee, sr.accepted_at AS acceptedAt, sr.en_route_at AS enRouteAt,
            sr.arrived_at AS arrivedAt, sr.schedule_slot_id AS scheduleSlotId, sr.parent_request_id AS parentRequestId,
            sr.latitude, sr.longitude
     FROM service_requests sr
     LEFT JOIN mechanics m ON m.id = sr.mechanic_id
     WHERE sr.id = ?`,
    [requestId]
  );
  if (!row) {
    throw new CancellationError(404, "Solicitud no encontrada");
  }
  return row;
}

/** Minutos desde una fecha de SQLite ("YYYY-MM-DD HH:MM:SS", UTC). */
export function minutesSince(timestamp: string | null, now = new Date()): number | null {
  if (!timestamp) return null;
  const time = Date.parse(timestamp.includes("T") ? timestamp : `${timestamp.replace(" ", "T")}Z`);
  return Number.isNaN(time) ? null : (now.getTime() - time) / 60_000;
}

function pesos(amount: number): string {
  return `$${Math.round(amount).toLocaleString("es-MX")}`;
}

/** Cuánto cuesta que el cliente cancele ahora, y por qué. */
export async function cancellationQuote(requestId: number, now = new Date()): Promise<CancellationQuote> {
  const row = await timeline(requestId);
  const name = row.mechanicName?.trim().split(/\s+/)[0] || "El mecánico";
  const visit = row.visitFee ?? 0;
  const free = (reason: CancellationQuote["reason"], message: string): CancellationQuote => ({ allowed: true, fee: 0, reason, message });

  switch (row.status) {
    case "completed":
    case "cancelled":
      return { allowed: false, fee: 0, reason: "closed", message: "La solicitud ya está cerrada." };
    case "repairing":
    case "awaiting_parts":
      return {
        allowed: false,
        fee: 0,
        reason: "work_started",
        message: `${name} ya empezó a reparar. Si quieres parar aquí, pídele que cobre solo lo que hizo («Cobrar menos») y termine el servicio.`
      };
    case "pending":
      return free("free_not_departed", "Cancelar es gratis: todavía no hay un mecánico en camino.");
    case "assigned": {
      const sinceAccepted = minutesSince(row.acceptedAt, now);
      const upcoming = Boolean(row.scheduleSlotId || row.parentRequestId);
      if (!upcoming && sinceAccepted !== null && sinceAccepted > MECHANIC_LATE_MINUTES) {
        return free("free_mechanic_late", `Cancelar es gratis: ${name} no ha salido hacia ti en más de una hora.`);
      }
      return free("free_not_departed", `Cancelar es gratis: ${name} todavía no sale hacia ti.`);
    }
    case "en_route": {
      const sinceDeparture = minutesSince(row.enRouteAt, now) ?? 0;
      if (sinceDeparture > MECHANIC_LATE_MINUTES) {
        return free("free_mechanic_late", `Cancelar es gratis: ${name} salió hace más de una hora y no ha llegado.`);
      }
      if (sinceDeparture <= FREE_CANCEL_MINUTES) {
        return free("free_grace", `Cancelar es gratis: ${name} salió hace menos de ${FREE_CANCEL_MINUTES} minutos.`);
      }
      const fee = Math.round(visit / 2);
      return {
        allowed: true,
        fee,
        reason: "half_visit",
        message: fee > 0 ? `${name} ya va en camino: si cancelas le pagas la mitad de la visita, ${pesos(fee)}.` : "Puedes cancelar."
      };
    }
    default: {
      // Ya llegó (on_site, in_progress, diagnosing).
      const { receipts } = await getReceiptsForRequest(requestId);
      const bought = receipts.filter((receipt) => receipt.status === "accepted").reduce((sum, receipt) => sum + receipt.amount, 0);
      const fee = visit + bought;
      return {
        allowed: true,
        fee,
        reason: "full_visit",
        message:
          fee > 0
            ? `${name} ya llegó: si cancelas le pagas la visita${bought > 0 ? " y las refacciones que ya compró" : ""}, ${pesos(fee)}.`
            : "Puedes cancelar."
      };
    }
  }
}

/** Distancia en km entre dos coordenadas. */
function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * El mecánico marca que el cliente no está: 15 min después de llegar, cerca
 * de la dirección y con foto del lugar. Se cobra la visita.
 */
export async function markCustomerAbsent(input: {
  requestId: number;
  mechanicId: number | null | undefined;
  latitude?: number | null;
  longitude?: number | null;
  savePhoto: () => Promise<string>;
  now?: Date;
}): Promise<{ customerId: number; fee: number; mechanicName: string }> {
  const row = await timeline(input.requestId);
  if (!input.mechanicId || row.mechanicId !== input.mechanicId) {
    throw new CancellationError(403, "Solo el mecánico del servicio puede marcarlo");
  }
  if (row.status !== "on_site" && row.status !== "in_progress") {
    throw new CancellationError(409, "Esto se usa cuando ya llegaste y el cliente no aparece.");
  }
  const waited = minutesSince(row.arrivedAt, input.now) ?? 0;
  if (waited < ABSENCE_WAIT_MINUTES) {
    const left = Math.max(1, Math.ceil(ABSENCE_WAIT_MINUTES - waited));
    throw new CancellationError(409, `Espera ${left} min más: el cliente tiene ${ABSENCE_WAIT_MINUTES} minutos para recibirte.`);
  }
  if (row.latitude != null && row.longitude != null) {
    if (input.latitude == null || input.longitude == null) {
      throw new CancellationError(409, "Activa tu ubicación: hay que confirmar que estás en la dirección del servicio.");
    }
    const away = distanceKm({ latitude: row.latitude, longitude: row.longitude }, { latitude: input.latitude, longitude: input.longitude });
    if (away > ABSENCE_MAX_DISTANCE_KM) {
      throw new CancellationError(409, `No estás en la dirección del servicio (estás a ${away.toFixed(1)} km).`);
    }
  }
  const photoUrl = await input.savePhoto();
  const fee = row.visitFee ?? 0;
  await run(
    `UPDATE service_requests
     SET status = 'cancelled', cancelled_by = 'mechanic', cancel_reason = 'customer_absent', cancellation_fee = ?,
         final_price = ?, absence_photo_url = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [fee, fee, photoUrl, input.requestId]
  );
  await run("UPDATE mechanics SET is_available = 1 WHERE id = ?", [input.mechanicId]);
  return { customerId: row.customerId, fee, mechanicName: row.mechanicName ?? "Tu mecánico" };
}

/**
 * "Ya no puedo ir": antes de llegar. La solicitud vuelve a buscar mecánico
 * (el llamador registra el rechazo y busca a otro si era automática). Una
 * visita de regreso no: el mecánico tiene la pieza que el cliente ya pagó.
 */
export async function mechanicWithdraws(input: {
  requestId: number;
  mechanicId: number | null | undefined;
  reason?: string | null;
}): Promise<{ customerId: number; scheduleSlotId: number | null; mechanicName: string }> {
  const row = await timeline(input.requestId);
  if (!input.mechanicId || row.mechanicId !== input.mechanicId) {
    throw new CancellationError(403, "Solo el mecánico del servicio puede soltarlo");
  }
  if (row.status !== "assigned" && row.status !== "en_route") {
    throw new CancellationError(409, "Ya llegaste: si no puedes seguir, habla con el cliente o termina con lo que hiciste.");
  }
  if (row.parentRequestId) {
    throw new CancellationError(409, "Es una visita de regreso: habla con el cliente para cambiar la fecha.");
  }
  const released = await run(
    `UPDATE service_requests
     SET mechanic_id = NULL, status = 'pending', hold_expires_at = NULL, schedule_slot_id = NULL, visit_fee = NULL,
         accepted_at = NULL, en_route_at = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND mechanic_id = ? AND status IN ('assigned', 'en_route')`,
    [input.requestId, input.mechanicId]
  );
  if (released.changes === 0) {
    throw new CancellationError(409, "La solicitud cambió; vuelve a intentarlo.");
  }
  await run("INSERT INTO mechanic_withdrawals (service_request_id, mechanic_id, stage, reason) VALUES (?, ?, ?, ?)", [
    input.requestId,
    input.mechanicId,
    row.status,
    input.reason?.trim() || null
  ]);
  await run("UPDATE mechanics SET is_available = 1 WHERE id = ?", [input.mechanicId]);
  return { customerId: row.customerId, scheduleSlotId: row.scheduleSlotId, mechanicName: row.mechanicName ?? "Tu mecánico" };
}

/** Veces que el mecánico soltó un servicio en los últimos 30 días. */
export async function recentWithdrawals(mechanicId: number): Promise<number> {
  const row = await get<{ total: number }>(
    "SELECT COUNT(*) AS total FROM mechanic_withdrawals WHERE mechanic_id = ? AND created_at > datetime('now', '-30 days')",
    [mechanicId]
  );
  return row?.total ?? 0;
}
