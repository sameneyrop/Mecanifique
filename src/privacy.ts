/**
 * Qué se muestra de una persona a otras.
 *
 * - Ubicación de un mecánico para el radar de cercanos (GET /mechanics) y las
 *   promociones: aproximada a unos 1 km (2 decimales). En el radar, solo la
 *   de quien está conectado: la última conocida de alguien desconectado puede
 *   ser su casa. Toda distancia que se muestra sale de la aproximada; si
 *   saliera de la exacta, midiendo desde varios puntos se le podría ubicar.
 *   La exacta solo la usan el reparto de solicitudes y el seguimiento de un
 *   servicio en curso (src/tracking.ts).
 * - Teléfonos: el del cliente y el del mecánico solo se ven cuando el
 *   mecánico ya aceptó la solicitud (no mientras se la ofrecen), y el del
 *   mecánico nunca en el listado público.
 * - Quien escribió una reseña: primer nombre e inicial (communityAuthorName).
 */

export const APPROXIMATE_LOCATION_DECIMALS = 2;

export function approximateLocation(
  latitude: number | null | undefined,
  longitude: number | null | undefined
): { latitude: number; longitude: number } | null {
  if (latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  const factor = 10 ** APPROXIMATE_LOCATION_DECIMALS;
  // + 0 evita -0 en el JSON.
  return {
    latitude: Math.round(latitude * factor) / factor + 0,
    longitude: Math.round(longitude * factor) / factor + 0
  };
}

/**
 * SQL del teléfono de la otra persona en una solicitud: solo si el mecánico
 * ya la aceptó. accepted_at se borra si el mecánico se retira; las
 * solicitudes de antes de que existiera esa columna cuentan como aceptadas
 * cuando ya no están pendientes ni canceladas.
 */
export function contactPhoneSql(requestAlias: string, phoneColumn: string): string {
  return `CASE WHEN ${requestAlias}.accepted_at IS NOT NULL OR ${requestAlias}.status NOT IN ('pending', 'cancelled') THEN ${phoneColumn} END`;
}
