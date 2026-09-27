import { get, run } from "./db";

/**
 * Propina directa: Mecanifique no cobra ni pasa dinero de propinas (cobrar
 * por cuenta del mecánico obligaría a retenerle ISR/IVA y darlo de alta en
 * Stripe). El mecánico puede poner, si quiere, su CLABE; solo la ve el
 * cliente de un servicio que ya le terminó, para transferirle directo.
 */

export class TipError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** CLABE interbancaria: 18 dígitos y el último es el dígito de control. */
export function isValidClabe(clabe: string): boolean {
  if (!/^\d{18}$/.test(clabe)) {
    return false;
  }
  const weights = [3, 7, 1];
  const sum = clabe
    .slice(0, 17)
    .split("")
    .reduce((total, digit, index) => total + ((Number(digit) * weights[index % 3]) % 10), 0);
  return (10 - (sum % 10)) % 10 === Number(clabe[17]);
}

export async function saveMechanicTipInfo(mechanicId: number, clabe: string, holderName: string): Promise<void> {
  if (!isValidClabe(clabe)) {
    throw new TipError(400, "Revisa tu CLABE: son 18 dígitos y alguno no coincide.");
  }
  await run("UPDATE mechanics SET tip_clabe = ?, tip_holder_name = ? WHERE id = ?", [clabe, holderName, mechanicId]);
}

export async function clearMechanicTipInfo(mechanicId: number): Promise<void> {
  await run("UPDATE mechanics SET tip_clabe = NULL, tip_holder_name = NULL WHERE id = ?", [mechanicId]);
}

export async function getMechanicTipInfo(mechanicId: number): Promise<{ clabe: string | null; holderName: string | null }> {
  const row = await get<{ clabe: string | null; holderName: string | null }>(
    "SELECT tip_clabe AS clabe, tip_holder_name AS holderName FROM mechanics WHERE id = ?",
    [mechanicId]
  );
  return { clabe: row?.clabe ?? null, holderName: row?.holderName ?? null };
}

export type TipInfoView = {
  mechanicName: string | null;
  clabe: string | null;
  holderName: string | null;
};

/** Lo que ve el cliente para dejar propina en una solicitud terminada. */
export async function getTipInfoForRequest(
  requestId: number,
  viewer: { role: string; customerId?: number | null }
): Promise<TipInfoView> {
  const row = await get<{
    customerId: number;
    status: string;
    mechanicId: number | null;
    mechanicName: string | null;
    clabe: string | null;
    holderName: string | null;
  }>(
    `
    SELECT sr.customer_id AS customerId, sr.status, sr.mechanic_id AS mechanicId,
           m.full_name AS mechanicName, m.tip_clabe AS clabe, m.tip_holder_name AS holderName
    FROM service_requests sr
    LEFT JOIN mechanics m ON m.id = sr.mechanic_id
    WHERE sr.id = ?
    `,
    [requestId]
  );
  if (!row) {
    throw new TipError(404, "Solicitud no encontrada");
  }
  if (viewer.role !== "customer" || viewer.customerId !== row.customerId) {
    throw new TipError(403, "Solo el cliente de la solicitud puede dejar propina");
  }
  if (row.status !== "completed" || !row.mechanicId) {
    throw new TipError(409, "La propina se deja cuando el servicio ya terminó");
  }
  return { mechanicName: row.mechanicName, clabe: row.clabe, holderName: row.holderName };
}
