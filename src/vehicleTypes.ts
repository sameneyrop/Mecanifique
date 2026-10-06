import { z } from "zod";

/**
 * Autos y motos. Cada solicitud y cada vehículo guardado es de un tipo, y
 * cada mecánico dice qué atiende (`works_on`): solo autos, solo motos o
 * los dos. Una solicitud solo le llega a quien atiende su tipo, tanto en el
 * reparto automático como cuando el cliente escoge al mecánico.
 *
 * Los mecánicos que ya existían quedan en "auto" (el valor por omisión de la
 * columna): así ninguno recibe de golpe solicitudes de moto que no atiende.
 */

export const VEHICLE_TYPES = ["auto", "moto"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const WORKS_ON = ["auto", "moto", "ambos"] as const;
export type WorksOn = (typeof WORKS_ON)[number];

export const vehicleTypeSchema = z.enum(VEHICLE_TYPES);
export const worksOnSchema = z.enum(WORKS_ON);

/** Lo que guarda la base, a un valor válido (lo viejo o vacío es auto). */
export function normalizeVehicleType(value: unknown): VehicleType {
  return value === "moto" ? "moto" : "auto";
}

export function normalizeWorksOn(value: unknown): WorksOn {
  return value === "moto" || value === "ambos" ? value : "auto";
}

export function servesVehicle(worksOn: unknown, vehicleType: unknown): boolean {
  const works = normalizeWorksOn(worksOn);
  return works === "ambos" || works === normalizeVehicleType(vehicleType);
}

/**
 * Condición SQL para filtrar mecánicos que atienden un tipo; usa un
 * parámetro (el tipo de vehículo).
 */
export function servesVehicleSql(column = "works_on"): string {
  return `(COALESCE(${column}, 'auto') = 'ambos' OR COALESCE(${column}, 'auto') = ?)`;
}

/** Por qué no se le puede pedir a ese mecánico (para el cliente). */
export function notServedMessage(worksOn: unknown, vehicleType: unknown): string {
  return normalizeVehicleType(vehicleType) === "moto"
    ? "Este mecánico no atiende motos. Elige otro o pide sin escoger mecánico."
    : normalizeWorksOn(worksOn) === "moto"
      ? "Este mecánico solo atiende motos. Elige otro o pide sin escoger mecánico."
      : "Este mecánico no atiende ese tipo de vehículo.";
}

/** "Moto · " delante del vehículo, para avisos y textos (los autos van sin prefijo). */
export function vehiclePrefix(vehicleType: unknown): string {
  return normalizeVehicleType(vehicleType) === "moto" ? "Moto · " : "";
}
