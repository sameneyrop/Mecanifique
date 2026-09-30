/**
 * Lista oficial de refaccionarias (la compila Mecanifique y la verifica por
 * teléfono). Se carga al arrancar el servidor (seedPartsStores en
 * src/partsStores.ts): se agregan las nuevas y se actualizan las que cambian,
 * identificadas por `key`. Para quitar una, dejarla con `active: false`.
 *
 * Solo datos públicos del negocio: nombre, teléfono, dirección, horario. No
 * copiar de Google Maps (sus términos no lo permiten): de su sitio, su
 * letrero, o llamando.
 */

export type SeedPartsStore = {
  /** Identificador estable, en minúsculas y sin espacios (p. ej. "rolcar-centro"). */
  key: string;
  name: string;
  phone?: string;
  whatsapp?: string;
  address?: string;
  zone?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  hours?: string;
  /** Qué surten: "Eléctrico, Suspensión, Importados"… */
  specialties?: string;
  active?: boolean;
};

export const PARTS_STORES_SEED: SeedPartsStore[] = [];
