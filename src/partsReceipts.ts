import { all, get, run } from "./db";

/**
 * Tickets de las refacciones que compra el mecánico. Evita que infle el
 * precio de las piezas (un litro de aceite de $200 cobrado a $500):
 *
 * - La cotización separa las refacciones que ya trae (precio fijo) de las que
 *   va a comprar (estimado). Las compradas se cobran a precio de ticket.
 * - Al salir por refacciones (awaiting_parts) no puede retomar la reparación
 *   ni terminar sin subir la foto del ticket, tomada con la cámara de la app,
 *   o decir que no compró nada (sin ticket no se cobra nada comprado).
 * - Con ticket y dentro de lo estimado se acepta solo: el cliente ve la foto
 *   y paga lo del ticket (menos, si salió más barato).
 * - Si pasa de lo estimado, o la tienda no dio ticket (foto de la nota o de
 *   las piezas), el cliente lo aprueba. Si no lo aprueba, se cobra hasta lo
 *   estimado: lo que ya había aceptado.
 * - No se puede terminar el servicio con un ticket esperando respuesta.
 */

export type ReceiptStatus = "accepted" | "pending" | "rejected";

export type PartsReceipt = {
  id: number;
  serviceRequestId: number;
  amount: number;
  /** Lo que se le cobra al cliente por este ticket (ver chargeReceipts). */
  chargedAmount: number;
  hasTicket: boolean;
  /** Pieza pedida que llega otro día: se paga hoy y se instala en la visita de regreso. */
  ordered: boolean;
  /** Vacía si el ticket lo emitió la tienda desde su Mostrador (fromStore). */
  photoUrl: string;
  storeNote: string | null;
  /** Lo emitió una refaccionaria de Mostrador: es el precio real de la tienda. */
  fromStore: boolean;
  status: ReceiptStatus;
  createdAt: string;
  respondedAt: string | null;
};

export class ReceiptError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type ReceiptRow = Omit<PartsReceipt, "chargedAmount" | "hasTicket" | "ordered" | "fromStore"> & {
  hasTicket: number;
  ordered: number;
  storeId: number | null;
};

// En qué pasos se pueden subir tickets.
const RECEIPT_STATUSES = new Set(["awaiting_parts", "repairing"]);

/**
 * Lo que se cobra de cada ticket, en el orden en que se subieron, contra lo
 * estimado de las refacciones a comprar: uno aceptado se cobra completo; uno
 * pendiente o rechazado, solo lo que todavía cabe en lo estimado.
 */
export function chargeReceipts(
  estimate: number,
  receipts: Array<{ id: number; amount: number; status: ReceiptStatus }>
): { charges: Map<number, number>; total: number } {
  let remaining = Math.max(0, estimate);
  const charges = new Map<number, number>();
  let total = 0;
  for (const receipt of receipts) {
    const charged = receipt.status === "accepted" ? receipt.amount : Math.min(receipt.amount, remaining);
    remaining = Math.max(0, remaining - receipt.amount);
    charges.set(receipt.id, charged);
    total += charged;
  }
  return { charges, total };
}

/** Lo estimado de las refacciones a comprar en las cotizaciones aceptadas. */
export async function partsToBuyEstimate(requestId: number): Promise<number> {
  const row = await get<{ total: number | null }>(
    `SELECT SUM(parts_amount) AS total FROM service_quotes
     WHERE service_request_id = ? AND status = 'accepted' AND parts_on_hand_amount IS NOT NULL`,
    [requestId]
  );
  return row?.total ?? 0;
}

async function receiptRows(requestId: number): Promise<ReceiptRow[]> {
  return all<ReceiptRow>(
    `SELECT id, service_request_id AS serviceRequestId, amount, has_ticket AS hasTicket, ordered, photo_url AS photoUrl,
            store_note AS storeNote, status, created_at AS createdAt, responded_at AS respondedAt, store_id AS storeId
     FROM parts_receipts WHERE service_request_id = ? ORDER BY id ASC`,
    [requestId]
  );
}

export async function getReceiptsForRequest(
  requestId: number
): Promise<{ receipts: PartsReceipt[]; estimate: number; chargedTotal: number }> {
  const [rows, estimate] = await Promise.all([receiptRows(requestId), partsToBuyEstimate(requestId)]);
  const { charges, total } = chargeReceipts(estimate, rows);
  return {
    receipts: rows.map(({ storeId, ...row }) => ({
      ...row,
      hasTicket: Boolean(row.hasTicket),
      ordered: Boolean(row.ordered),
      fromStore: storeId != null,
      chargedAmount: charges.get(row.id) ?? 0
    })),
    estimate,
    chargedTotal: total
  };
}

async function requestForMechanic(requestId: number, mechanicId: number | null | undefined) {
  const request = await get<{ mechanicId: number | null; customerId: number; status: string; partsTripStartedAt: string | null }>(
    `SELECT mechanic_id AS mechanicId, customer_id AS customerId, status, parts_trip_started_at AS partsTripStartedAt
     FROM service_requests WHERE id = ?`,
    [requestId]
  );
  if (!request) {
    throw new ReceiptError(404, "Solicitud no encontrada");
  }
  if (!mechanicId || request.mechanicId !== mechanicId) {
    throw new ReceiptError(403, "Solo el mecánico del servicio puede subir tickets");
  }
  return request;
}

export async function createReceipt(input: {
  requestId: number;
  mechanicId: number | null | undefined;
  amount: number;
  hasTicket: boolean;
  ordered?: boolean;
  /** Guarda la foto y devuelve su dirección; se llama ya validado, para no dejar fotos sueltas. */
  savePhoto: () => Promise<string>;
  storeNote?: string | null;
}): Promise<{ receipt: PartsReceipt; customerId: number; estimate: number; overEstimate: boolean }> {
  const request = await requestForMechanic(input.requestId, input.mechanicId);
  if (!RECEIPT_STATUSES.has(request.status)) {
    throw new ReceiptError(409, "El ticket se sube cuando sales por refacciones o ya estás reparando.");
  }
  const photoUrl = await input.savePhoto();
  const before = await getReceiptsForRequest(input.requestId);
  const alreadyCovered = before.receipts.reduce((sum, receipt) => sum + receipt.amount, 0);
  const remaining = Math.max(0, before.estimate - alreadyCovered);
  const overEstimate = input.amount > remaining;
  const status: ReceiptStatus = input.hasTicket && !overEstimate ? "accepted" : "pending";

  const inserted = await run(
    `INSERT INTO parts_receipts (service_request_id, mechanic_id, amount, has_ticket, ordered, photo_url, store_note, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.requestId,
      request.mechanicId,
      input.amount,
      input.hasTicket ? 1 : 0,
      input.ordered ? 1 : 0,
      photoUrl,
      input.storeNote?.trim() || null,
      status
    ]
  );
  // Ya hay ticket de esta salida: puede retomar la reparación.
  await run("UPDATE service_requests SET parts_trip_started_at = NULL WHERE id = ?", [input.requestId]);

  const after = await getReceiptsForRequest(input.requestId);
  const receipt = after.receipts.find((row) => row.id === inserted.lastID)!;
  return { receipt, customerId: request.customerId, estimate: before.estimate, overEstimate };
}

/**
 * Ticket emitido por una refaccionaria desde su Mostrador al entregar una
 * pieza apartada (src/mostrador.ts). No lleva foto: lo emitió la tienda, no
 * el mecánico. Se acepta o se pide aprobación con la misma regla que uno con
 * foto (contra lo estimado). Si el servicio ya terminó o se canceló, no se
 * agrega y devuelve null.
 */
export async function createStoreReceipt(input: {
  requestId: number;
  amount: number;
  storeId: number;
  storeNote: string;
}): Promise<{ receipt: PartsReceipt; customerId: number; mechanicId: number; overEstimate: boolean } | null> {
  const request = await get<{ mechanicId: number | null; customerId: number; status: string }>(
    "SELECT mechanic_id AS mechanicId, customer_id AS customerId, status FROM service_requests WHERE id = ?",
    [input.requestId]
  );
  if (!request || !request.mechanicId || request.status === "completed" || request.status === "cancelled") {
    return null;
  }
  const before = await getReceiptsForRequest(input.requestId);
  const alreadyCovered = before.receipts.reduce((sum, receipt) => sum + receipt.amount, 0);
  const overEstimate = input.amount > Math.max(0, before.estimate - alreadyCovered);
  const inserted = await run(
    `INSERT INTO parts_receipts (service_request_id, mechanic_id, amount, has_ticket, ordered, photo_url, store_note, status, store_id)
     VALUES (?, ?, ?, 1, 0, '', ?, ?, ?)`,
    [input.requestId, request.mechanicId, input.amount, input.storeNote, overEstimate ? "pending" : "accepted", input.storeId]
  );
  // Con el ticket de esta compra ya puede retomar la reparación.
  await run("UPDATE service_requests SET parts_trip_started_at = NULL WHERE id = ?", [input.requestId]);
  const after = await getReceiptsForRequest(input.requestId);
  const receipt = after.receipts.find((row) => row.id === inserted.lastID)!;
  return { receipt, customerId: request.customerId, mechanicId: request.mechanicId, overEstimate };
}

export async function respondToReceipt(input: {
  requestId: number;
  receiptId: number;
  customerId: number | null | undefined;
  accept: boolean;
}): Promise<{ receipt: PartsReceipt; mechanicId: number | null }> {
  const row = await get<{ requestId: number; status: ReceiptStatus; customerId: number; mechanicId: number | null }>(
    `SELECT r.service_request_id AS requestId, r.status, sr.customer_id AS customerId, sr.mechanic_id AS mechanicId
     FROM parts_receipts r JOIN service_requests sr ON sr.id = r.service_request_id
     WHERE r.id = ?`,
    [input.receiptId]
  );
  if (!row || row.requestId !== input.requestId) {
    throw new ReceiptError(404, "Ticket no encontrado");
  }
  if (!input.customerId || row.customerId !== input.customerId) {
    throw new ReceiptError(403, "Solo el cliente del servicio puede contestar el ticket");
  }
  if (row.status !== "pending") {
    throw new ReceiptError(409, "Este ticket ya no está esperando respuesta.");
  }
  await run("UPDATE parts_receipts SET status = ?, responded_at = CURRENT_TIMESTAMP WHERE id = ?", [
    input.accept ? "accepted" : "rejected",
    input.receiptId
  ]);
  const { receipts } = await getReceiptsForRequest(input.requestId);
  return { receipt: receipts.find((receipt) => receipt.id === input.receiptId)!, mechanicId: row.mechanicId };
}

/** Regresó sin comprar nada (no encontró la pieza): puede retomar sin ticket. */
export async function declareNoPurchase(requestId: number, mechanicId: number | null | undefined): Promise<{ customerId: number }> {
  const request = await requestForMechanic(requestId, mechanicId);
  if (request.status !== "awaiting_parts") {
    throw new ReceiptError(409, "Esto se usa al regresar de comprar refacciones.");
  }
  await run("UPDATE service_requests SET parts_trip_started_at = NULL WHERE id = ?", [requestId]);
  return { customerId: request.customerId };
}

/**
 * No encontró la pieza en una tienda y va a otra: solo avisa al cliente (que
 * lo ve moverse en el mapa). El ticket se pide al regresar, no en cada tienda.
 */
export async function customerForPartsTrip(requestId: number, mechanicId: number | null | undefined): Promise<number> {
  const request = await requestForMechanic(requestId, mechanicId);
  if (request.status !== "awaiting_parts") {
    throw new ReceiptError(409, "Esto se usa mientras vas por refacciones.");
  }
  return request.customerId;
}

export async function startPartsTrip(requestId: number): Promise<void> {
  await run("UPDATE service_requests SET parts_trip_started_at = CURRENT_TIMESTAMP WHERE id = ?", [requestId]);
}

export async function isPartsTripOpen(requestId: number): Promise<boolean> {
  const row = await get<{ open: number }>(
    "SELECT parts_trip_started_at IS NOT NULL AS open FROM service_requests WHERE id = ?",
    [requestId]
  );
  return Boolean(row?.open);
}

export async function hasPendingReceipt(requestId: number): Promise<boolean> {
  return Boolean(
    await get<{ id: number }>("SELECT id FROM parts_receipts WHERE service_request_id = ? AND status = 'pending' LIMIT 1", [requestId])
  );
}
