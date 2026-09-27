import { get } from "./db";

/**
 * Seguimiento del mecánico: el cliente de una solicitud ve dónde va su
 * mecánico solo mientras va en camino o fue por refacciones. En cualquier
 * otro estado la ubicación no se expone.
 *
 * El teléfono del mecánico manda su posición con PATCH
 * /api/mechanics/:id/location (en segundo plano durante estos estados, con un
 * aviso fijo visible); el cliente la consulta con GET
 * /api/service-requests/:id/mechanic-location.
 */
export const TRACKING_STATUSES = ["en_route", "awaiting_parts"];
const TRACKING_STATUSES_SQL = `(${TRACKING_STATUSES.map((status) => `'${status}'`).join(", ")})`;

export class TrackingError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type MechanicLocationView = {
  tracking: boolean;
  status: string;
  mechanic: { latitude: number; longitude: number; secondsAgo: number | null } | null;
  service?: { latitude: number; longitude: number } | null;
  distanceKm?: number | null;
};

type DistanceKm = (latA: number, lngA: number, latB: number, lngB: number) => number;

/** Si algún cliente sigue ahora mismo a este mecánico. */
export async function isMechanicBeingTracked(mechanicId: number): Promise<boolean> {
  const row = await get<{ id: number }>(
    `SELECT id FROM service_requests WHERE mechanic_id = ? AND status IN ${TRACKING_STATUSES_SQL} LIMIT 1`,
    [mechanicId]
  );
  return Boolean(row);
}

export async function getMechanicLocationForRequest(
  requestId: number,
  viewer: { role: string; customerId?: number | null },
  calculateDistanceKm: DistanceKm
): Promise<MechanicLocationView> {
  const row = await get<{
    customerId: number;
    status: string;
    latitude: number | null;
    longitude: number | null;
    mechanicLatitude: number | null;
    mechanicLongitude: number | null;
    secondsAgo: number | null;
  }>(
    `
    SELECT sr.customer_id AS customerId, sr.status, sr.latitude, sr.longitude,
           m.latitude AS mechanicLatitude, m.longitude AS mechanicLongitude,
           CAST((julianday('now') - julianday(m.location_updated_at)) * 86400 AS INTEGER) AS secondsAgo
    FROM service_requests sr
    LEFT JOIN mechanics m ON m.id = sr.mechanic_id
    WHERE sr.id = ?
    `,
    [requestId]
  );

  if (!row) {
    throw new TrackingError(404, "Solicitud no encontrada");
  }
  if (viewer.role !== "admin" && (viewer.role !== "customer" || viewer.customerId !== row.customerId)) {
    throw new TrackingError(403, "Solo puedes seguir al mecánico de tus propias solicitudes");
  }

  const tracking = TRACKING_STATUSES.includes(row.status);
  if (!tracking || row.mechanicLatitude == null || row.mechanicLongitude == null) {
    return { tracking, status: row.status, mechanic: null };
  }

  const service =
    row.latitude != null && row.longitude != null ? { latitude: row.latitude, longitude: row.longitude } : null;
  return {
    tracking,
    status: row.status,
    mechanic: { latitude: row.mechanicLatitude, longitude: row.mechanicLongitude, secondsAgo: row.secondsAgo },
    service,
    distanceKm: service
      ? Math.round(
        calculateDistanceKm(service.latitude, service.longitude, row.mechanicLatitude, row.mechanicLongitude) * 10
      ) / 10
      : null
  };
}
