import { z } from "zod";
import { get, run } from "./db";

/**
 * Dónde da servicio cada mecánico.
 *
 * - `city` y `zone`: dónde está su taller (o donde está más seguido). Es lo
 *   que se muestra en su perfil ("Sur, Aguascalientes").
 * - `service_areas`: municipios del estado donde también atiende (JSON). Su
 *   ciudad siempre cuenta aunque no esté en la lista. Sirve para la búsqueda
 *   por ciudad de la pestaña Mecánicos ("Agendar fecha").
 * - `service_radius_km`: hasta dónde va por un servicio de "Ahora mismo". Las
 *   solicitudes se reparten por GPS al mecánico conectado más cercano, pero
 *   solo si el auto está dentro de su radio (findAvailableMechanic).
 *
 * Los textos se comparan sin acentos, sin mayúsculas y sin "Zona", "Col."…
 * (placeKey): "Zona Sur" y "sur" son lo mismo, y "Ags" es Aguascalientes.
 */

export const AGUASCALIENTES_MUNICIPALITIES = [
  "Aguascalientes",
  "Asientos",
  "Calvillo",
  "Cosío",
  "El Llano",
  "Jesús María",
  "Pabellón de Arteaga",
  "Rincón de Romos",
  "San Francisco de los Romo",
  "San José de Gracia",
  "Tepezalá"
] as const;

/** 100 km = todo el estado desde cualquier punto de Aguascalientes. */
export const SERVICE_RADIUS_OPTIONS = [10, 25, 50, 100] as const;
export const DEFAULT_SERVICE_RADIUS_KM = 25;

const PLACE_PREFIXES = [
  "zona",
  "col",
  "colonia",
  "fracc",
  "fraccionamiento",
  "barrio",
  "municipio de",
  "municipio",
  "ciudad de",
  "cd"
];

/** "Zona Sur" → "sur"; "Col. Centro" → "centro"; "Jesús María" → "jesus maria". */
export function placeKey(value: string | null | undefined): string {
  let key = (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,;:()"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const prefix of PLACE_PREFIXES) {
    if (key.startsWith(`${prefix} `)) {
      key = key.slice(prefix.length + 1).trim();
      break;
    }
  }
  return key;
}

const MUNICIPALITY_ALIASES: Record<string, string> = {
  ags: "Aguascalientes",
  "aguascalientes ags": "Aguascalientes",
  "aguascalientes aguascalientes": "Aguascalientes",
  pabellon: "Pabellón de Arteaga",
  rincon: "Rincón de Romos",
  "san francisco": "San Francisco de los Romo",
  "san pancho": "San Francisco de los Romo",
  llano: "El Llano",
  "san jose": "San José de Gracia",
  cosio: "Cosío",
  tepezala: "Tepezalá"
};

const MUNICIPALITY_BY_KEY = new Map<string, string>(
  AGUASCALIENTES_MUNICIPALITIES.map((name) => [placeKey(name), name])
);

/** El municipio del catálogo que nombra un texto ("jesus maria", "Ags"…), o null. */
export function resolveMunicipality(value: string | null | undefined): string | null {
  const key = placeKey(value);
  if (!key) return null;
  const exact = MUNICIPALITY_BY_KEY.get(key) ?? MUNICIPALITY_ALIASES[key];
  if (exact) return exact;
  // "Pabellón de A." o "Rincón de R" → el único municipio que empieza así.
  if (key.length >= 4) {
    const matches = [...MUNICIPALITY_BY_KEY.entries()].filter(([name]) => name.startsWith(key));
    if (matches.length === 1) return matches[0][1];
  }
  return null;
}

/** Guarda la ciudad con su nombre oficial si es un municipio del estado ("ags" → "Aguascalientes"). */
export function canonicalCity(value: string): string {
  return resolveMunicipality(value) ?? value.trim().replace(/\s+/g, " ");
}

export function parseServiceAreas(json: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(json || "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** Si el mecánico atiende en esa ciudad: la de su taller o una de sus áreas. */
export function coversCity(mechanic: { city: string; serviceAreas: string[] }, city: string): boolean {
  const key = placeKey(city);
  if (!key) return true;
  const municipality = resolveMunicipality(city);
  const wanted = municipality ? placeKey(municipality) : key;
  if (placeKey(canonicalCity(mechanic.city)) === wanted) return true;
  return mechanic.serviceAreas.some((area) => placeKey(area) === wanted);
}

/** Misma zona: "Zona Sur" = "sur"; "Centro" contiene a "Centro Histórico" y al revés. */
export function zoneMatches(mechanicZone: string | null | undefined, zone: string | null | undefined): boolean {
  const a = placeKey(mechanicZone);
  const b = placeKey(zone);
  if (!a || !b) return false;
  if (a === b) return true;
  const words = (text: string) => ` ${text} `;
  return words(a).includes(words(b)) || words(b).includes(words(a));
}

/** "Todo el estado", o la lista de municipios (con el de su taller primero). */
export function coverageText(mechanic: { city: string; serviceAreas: string[] }): string {
  const home = placeKey(canonicalCity(mechanic.city));
  if (AGUASCALIENTES_MUNICIPALITIES.every((name) => mechanic.serviceAreas.includes(name) || placeKey(name) === home)) {
    return "Todo el estado de Aguascalientes";
  }
  const places = [canonicalCity(mechanic.city), ...mechanic.serviceAreas];
  const unique = places.filter((place, index) => places.findIndex((other) => placeKey(other) === placeKey(place)) === index);
  if (unique.length === 1) return unique[0];
  return `${unique.slice(0, -1).join(", ")} y ${unique[unique.length - 1]}`;
}

export class ServiceAreaError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export type ServiceArea = {
  city: string;
  zone: string;
  serviceAreas: string[];
  serviceRadiusKm: number;
};

export const serviceAreaSchema = z.object({
  city: z.string().trim().min(2).max(60),
  zone: z.string().trim().min(2).max(60),
  serviceAreas: z.array(z.string().trim().min(2).max(60)).max(AGUASCALIENTES_MUNICIPALITIES.length * 2),
  serviceRadiusKm: z.number().int()
});

export async function getServiceArea(mechanicId: number): Promise<ServiceArea | null> {
  const row = await get<{ city: string; zone: string; serviceAreas: string | null; serviceRadiusKm: number | null }>(
    `SELECT city, zone, service_areas AS serviceAreas, service_radius_km AS serviceRadiusKm FROM mechanics WHERE id = ?`,
    [mechanicId]
  );
  if (!row) return null;
  return {
    city: row.city,
    zone: row.zone,
    serviceAreas: parseServiceAreas(row.serviceAreas),
    serviceRadiusKm: row.serviceRadiusKm ?? DEFAULT_SERVICE_RADIUS_KM
  };
}

export async function saveServiceArea(mechanicId: number, input: unknown): Promise<ServiceArea> {
  const parsed = serviceAreaSchema.safeParse(input);
  if (!parsed.success) {
    throw new ServiceAreaError(400, "Escribe tu ciudad y tu zona, y elige hasta dónde vas.");
  }
  const { city, zone, serviceAreas, serviceRadiusKm } = parsed.data;
  if (!(SERVICE_RADIUS_OPTIONS as readonly number[]).includes(serviceRadiusKm)) {
    throw new ServiceAreaError(400, "Elige una de las distancias: 10, 25, 50 km o todo el estado.");
  }
  const areas: string[] = [];
  for (const area of serviceAreas) {
    const municipality = resolveMunicipality(area);
    if (!municipality) {
      throw new ServiceAreaError(400, `"${area}" no es un municipio de Aguascalientes.`);
    }
    if (!areas.includes(municipality)) areas.push(municipality);
  }
  const saved: ServiceArea = {
    city: canonicalCity(city),
    zone: zone.replace(/\s+/g, " "),
    // En el orden del catálogo, para que se lean igual en todos lados.
    serviceAreas: AGUASCALIENTES_MUNICIPALITIES.filter((name) => areas.includes(name)),
    serviceRadiusKm
  };
  const result = await run(
    "UPDATE mechanics SET city = ?, zone = ?, service_areas = ?, service_radius_km = ? WHERE id = ?",
    [saved.city, saved.zone, JSON.stringify(saved.serviceAreas), saved.serviceRadiusKm, mechanicId]
  );
  if (result.changes === 0) {
    throw new ServiceAreaError(404, "Mecánico no encontrado");
  }
  return saved;
}
