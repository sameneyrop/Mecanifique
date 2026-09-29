import { get, run } from "./db";

/**
 * Visita de regreso: la pieza no estaba y hay que pedirla, o falta terminar
 * otro día. El mecánico la programa desde el servicio de hoy y queda como una
 * solicitud nueva, ligada a la original (parent_request_id), con el mismo
 * cliente, auto y dirección, asignada a él y **sin cobro de visita**.
 *
 * Hoy se cobra solo lo que hizo (ajuste) más la pieza pedida, que el cliente
 * paga con el ticket del pedido (src/partsReceipts.ts, `ordered`). En la visita
 * de regreso cotiza lo que falta.
 *
 * Mientras no sale hacia ella sigue 'assigned' y cuenta como "próxima"
 * (upcomingSql en el servidor): no le impide recibir trabajo hoy.
 */

export class ReturnVisitError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Desde qué pasos se puede programar: ya vio el auto.
const RETURN_FROM_STATUSES = new Set(["on_site", "in_progress", "diagnosing", "repairing", "awaiting_parts"]);

export async function createReturnVisit(input: {
  requestId: number;
  mechanicId: number | null | undefined;
  when: string;
  pendingWork: string;
}): Promise<{ returnRequestId: number; customerId: number }> {
  const original = await get<{
    mechanicId: number | null;
    customerId: number;
    status: string;
    vehicleMake: string;
    vehicleModel: string;
    vehicleYear: number;
    city: string;
    zone: string;
    serviceAddress: string | null;
    latitude: number | null;
    longitude: number | null;
  }>(
    `SELECT mechanic_id AS mechanicId, customer_id AS customerId, status, vehicle_make AS vehicleMake,
            vehicle_model AS vehicleModel, vehicle_year AS vehicleYear, city, zone, service_address AS serviceAddress,
            latitude, longitude
     FROM service_requests WHERE id = ?`,
    [input.requestId]
  );
  if (!original) {
    throw new ReturnVisitError(404, "Solicitud no encontrada");
  }
  if (!input.mechanicId || original.mechanicId !== input.mechanicId) {
    throw new ReturnVisitError(403, "Solo el mecánico del servicio puede programar el regreso");
  }
  if (!RETURN_FROM_STATUSES.has(original.status)) {
    throw new ReturnVisitError(409, "La visita de regreso se programa cuando ya estás con el auto.");
  }
  const existing = await get<{ id: number }>(
    "SELECT id FROM service_requests WHERE parent_request_id = ? AND status NOT IN ('completed', 'cancelled') LIMIT 1",
    [input.requestId]
  );
  if (existing) {
    throw new ReturnVisitError(409, `Ya programaste la visita de regreso (#${existing.id}).`);
  }

  const created = await run(
    `INSERT INTO service_requests (
       customer_id, vehicle_make, vehicle_model, vehicle_year, issue_description, preferred_time, city, zone,
       service_address, latitude, longitude, mechanic_id, status, assignment_mode, visit_fee, parent_request_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'assigned', 'direct', 0, ?)`,
    [
      original.customerId,
      original.vehicleMake,
      original.vehicleModel,
      original.vehicleYear,
      `Visita de regreso: ${input.pendingWork.trim()}`,
      input.when.trim(),
      original.city,
      original.zone,
      original.serviceAddress,
      original.latitude,
      original.longitude,
      input.mechanicId,
      input.requestId
    ]
  );
  return { returnRequestId: created.lastID, customerId: original.customerId };
}

/** La visita de regreso abierta de un servicio, si la hay. */
export async function getReturnVisit(
  requestId: number
): Promise<{ id: number; preferredTime: string; status: string } | null> {
  return (
    (await get<{ id: number; preferredTime: string; status: string }>(
      `SELECT id, preferred_time AS preferredTime, status FROM service_requests
       WHERE parent_request_id = ? AND status != 'cancelled' ORDER BY id DESC LIMIT 1`,
      [requestId]
    )) ?? null
  );
}
