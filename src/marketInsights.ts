import { all, get } from "./db";

/**
 * Datos del mercado para el mecánico, siempre agregados (nunca el precio de
 * un mecánico en particular ni datos de un cliente):
 *
 * - Precio sugerido de visita y diagnóstico: primero lo que los clientes de su
 *   ciudad sí pagaron en servicios terminados; si todavía son pocos, los
 *   precios que los mecánicos tienen en su perfil. Con menos datos que el
 *   mínimo no se muestra nada (sería exhibir a uno o dos competidores).
 * - Tendencias de solicitudes en su ciudad: ahora mismo, por hora del día y
 *   por zona (últimos 30 días).
 */

const MIN_PAID_SAMPLES = 5;
const MIN_PROFILE_SAMPLES = 3;
// Hora de México (Aguascalientes, sin horario de verano desde 2022).
const MX_OFFSET = "-6 hours";

/** "Aguascalientes " y "aguascalientes" son la misma ciudad; "Querétaro" y "Queretaro" también. */
export function normalizePlace(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function percentile(sorted: number[], p: number): number {
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

const roundTo10 = (value: number) => Math.round(value / 10) * 10;

export type RateSuggestion = {
  /** De dónde salen: lo que se pagó en servicios o los precios de los perfiles. */
  source: "services" | "profiles";
  /** La ciudad del mecánico, o null si no alcanzaron los datos y se usó toda la app. */
  city: string | null;
  count: number;
  low: number;
  median: number;
  high: number;
};

function summarize(values: number[], source: RateSuggestion["source"], city: string | null): RateSuggestion {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    source,
    city,
    count: sorted.length,
    low: roundTo10(percentile(sorted, 0.25)),
    median: roundTo10(percentile(sorted, 0.5)),
    high: roundTo10(percentile(sorted, 0.75))
  };
}

export async function visitRateSuggestion(mechanicId: number): Promise<RateSuggestion | null> {
  const me = await get<{ city: string }>("SELECT city FROM mechanics WHERE id = ?", [mechanicId]);
  const city = normalizePlace(me?.city);

  // Lo que sí se pagó: la visita que quedó fija al aceptar, en servicios
  // terminados de los últimos 4 meses (de otros mecánicos).
  const paid = await all<{ city: string; fee: number }>(
    `SELECT sr.city, sr.visit_fee AS fee FROM service_requests sr
     WHERE sr.status = 'completed' AND sr.visit_fee > 0 AND sr.mechanic_id <> ?
       AND sr.created_at >= datetime('now', '-120 days')`,
    [mechanicId]
  );
  const paidHere = paid.filter((row) => city && normalizePlace(row.city) === city).map((row) => row.fee);
  if (paidHere.length >= MIN_PAID_SAMPLES) {
    return summarize(paidHere, "services", me?.city?.trim() ?? null);
  }

  const profiles = await all<{ city: string; rate: number }>(
    "SELECT city, labor_rate AS rate FROM mechanics WHERE status = 'active' AND labor_rate > 0 AND id <> ?",
    [mechanicId]
  );
  const profilesHere = profiles.filter((row) => city && normalizePlace(row.city) === city).map((row) => row.rate);
  if (profilesHere.length >= MIN_PROFILE_SAMPLES) {
    return summarize(profilesHere, "profiles", me?.city?.trim() ?? null);
  }
  // Todavía pocos en su ciudad: la referencia de toda la app, dicha como tal.
  if (profiles.length >= MIN_PROFILE_SAMPLES) {
    return summarize(profiles.map((row) => row.rate), "profiles", null);
  }
  return null;
}

export type RequestTrends = {
  city: string | null;
  /** Solicitudes creadas en la última hora. */
  lastHour: number;
  /** Solicitudes buscando mecánico ahora mismo. */
  waiting: number;
  /** Últimos 30 días. */
  total: number;
  /** 24 conteos, uno por hora del día (hora de México). */
  byHour: number[];
  /** Zonas con más solicitudes (máx. 6); las de una sola solicitud van en "Otras zonas". */
  byZone: Array<{ zone: string; count: number }>;
};

export async function requestTrends(mechanicId: number): Promise<RequestTrends> {
  const me = await get<{ city: string }>("SELECT city FROM mechanics WHERE id = ?", [mechanicId]);
  const city = normalizePlace(me?.city);
  const rows = await all<{
    city: string;
    zone: string | null;
    hour: string;
    status: string;
    lastHour: number;
    recent: number;
  }>(
    `SELECT city, zone, strftime('%H', created_at, '${MX_OFFSET}') AS hour, status,
            created_at >= datetime('now', '-1 hour') AS lastHour,
            created_at >= datetime('now', '-3 hours') AS recent
     FROM service_requests
     WHERE created_at >= datetime('now', '-30 days')
     ORDER BY created_at DESC
     LIMIT 5000`
  );
  const here = rows.filter((row) => city && normalizePlace(row.city) === city);

  const byHour = Array.from({ length: 24 }, () => 0);
  const zones = new Map<string, { zone: string; count: number }>();
  for (const row of here) {
    byHour[Number(row.hour)] += 1;
    const key = normalizePlace(row.zone);
    if (!key) continue;
    const entry = zones.get(key) ?? { zone: (row.zone ?? "").trim(), count: 0 };
    entry.count += 1;
    zones.set(key, entry);
  }
  const sorted = [...zones.values()].sort((a, b) => b.count - a.count);
  const named = sorted.filter((entry) => entry.count >= 2).slice(0, 6);
  const others = sorted.filter((entry) => !named.includes(entry)).reduce((sum, entry) => sum + entry.count, 0);

  return {
    city: me?.city?.trim() || null,
    lastHour: here.filter((row) => row.lastHour).length,
    // Pendientes recientes (una vieja que quedó pendiente ya no es "ahora").
    waiting: here.filter((row) => row.status === "pending" && row.recent).length,
    total: here.length,
    byHour,
    byZone: others > 0 ? [...named, { zone: "Otras zonas", count: others }] : named
  };
}
