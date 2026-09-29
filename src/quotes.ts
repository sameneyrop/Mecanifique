import { all, get, run } from "./db";

/**
 * Cotización obligatoria antes de reparar: después del diagnóstico, el
 * mecánico manda cuánto cobrará de mano de obra y refacciones y qué hará; el
 * cliente la acepta o no. Sin una cotización aceptada no se puede pasar a
 * "reparando" ni a "esperando refacciones". Si el cliente no acepta, el
 * mecánico puede mandar otra o terminar el servicio (solo diagnóstico).
 *
 * También puede cotizar algo adicional ya reparando (una pieza extra): el
 * cliente la acepta o no, sin detener la reparación ya acordada.
 *
 * Mecanifique no cobra este monto: queda como registro de lo que se acordó
 * y se suma a la visita en lo que el cliente paga (src/servicePayment.ts).
 *
 * Las refacciones van en dos partes: las que el mecánico ya trae (precio
 * fijo) y las que va a comprar (estimado; se cobran a precio de ticket, ver
 * src/partsReceipts.ts).
 *
 * Un **ajuste** (kind 'adjustment') solo sirve para bajar lo acordado: por
 * ejemplo, la pieza no estaba y no se hizo toda la reparación. Si el cliente
 * lo acepta, reemplaza a las cotizaciones aceptadas; si no, sigue lo de antes.
 * Para subir lo acordado está "cotizar algo adicional".
 */

export type QuoteStatus = "pending" | "accepted" | "rejected" | "replaced";
export type QuoteKind = "quote" | "adjustment";

export type ServiceQuote = {
  id: number;
  serviceRequestId: number;
  laborAmount: number;
  /** Refacciones a comprar (estimado). En cotizaciones viejas, precio fijo. */
  partsAmount: number;
  /** Refacciones que ya trae el mecánico, a precio fijo. */
  partsOnHandAmount: number;
  /** false en cotizaciones anteriores a los tickets: partsAmount era fijo. */
  partsAreEstimate: boolean;
  total: number;
  kind: QuoteKind;
  description: string;
  status: QuoteStatus;
  createdAt: string;
  respondedAt: string | null;
};

export class QuoteError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// En qué pasos del servicio el mecánico puede mandar una cotización.
const QUOTABLE_STATUSES = new Set(["in_progress", "on_site", "diagnosing", "repairing", "awaiting_parts"]);
// Pasos a los que solo se llega con una cotización aceptada.
export const STATUSES_REQUIRING_QUOTE = new Set(["repairing", "awaiting_parts"]);

const QUOTE_COLUMNS = `
  id, service_request_id AS serviceRequestId, labor_amount AS laborAmount, parts_amount AS partsAmount,
  COALESCE(parts_on_hand_amount, 0) AS partsOnHandAmount, parts_on_hand_amount IS NOT NULL AS partsAreEstimate,
  labor_amount + parts_amount + COALESCE(parts_on_hand_amount, 0) AS total, kind,
  description, status, created_at AS createdAt, responded_at AS respondedAt
`;

type QuoteRow = Omit<ServiceQuote, "partsAreEstimate"> & { partsAreEstimate: number };

function toQuote(row: QuoteRow): ServiceQuote {
  return { ...row, partsAreEstimate: Boolean(row.partsAreEstimate) };
}

async function getQuote(quoteId: number): Promise<ServiceQuote> {
  const row = await get<QuoteRow>(`SELECT ${QUOTE_COLUMNS} FROM service_quotes WHERE id = ?`, [quoteId]);
  return toQuote(row!);
}

export async function getQuotesForRequest(requestId: number): Promise<ServiceQuote[]> {
  const rows = await all<QuoteRow>(
    `SELECT ${QUOTE_COLUMNS} FROM service_quotes WHERE service_request_id = ? ORDER BY id DESC`,
    [requestId]
  );
  return rows.map(toQuote);
}

export async function hasAcceptedQuote(requestId: number): Promise<boolean> {
  return Boolean(
    await get<{ id: number }>("SELECT id FROM service_quotes WHERE service_request_id = ? AND status = 'accepted' LIMIT 1", [
      requestId
    ])
  );
}

export async function createQuote(input: {
  requestId: number;
  mechanicId: number;
  laborAmount: number;
  /** Refacciones a comprar (estimado; se cobran a precio de ticket). */
  partsAmount: number;
  /** Refacciones que ya trae (precio fijo). */
  partsOnHandAmount?: number;
  description: string;
  kind?: QuoteKind;
}): Promise<ServiceQuote> {
  const kind = input.kind ?? "quote";
  const request = await get<{ mechanicId: number | null; status: string }>(
    "SELECT mechanic_id AS mechanicId, status FROM service_requests WHERE id = ?",
    [input.requestId]
  );
  if (!request) {
    throw new QuoteError(404, "Solicitud no encontrada");
  }
  if (request.mechanicId !== input.mechanicId) {
    throw new QuoteError(403, "Solo el mecánico asignado puede cotizar esta solicitud");
  }
  if (!QUOTABLE_STATUSES.has(request.status)) {
    throw new QuoteError(409, "La cotización se manda cuando ya estás con el auto.");
  }
  if (kind === "adjustment") {
    const agreed = await acceptedQuotesTotal(input.requestId);
    if (agreed === null) {
      throw new QuoteError(409, "No hay nada acordado que ajustar todavía.");
    }
    const adjusted = input.laborAmount + input.partsAmount + (input.partsOnHandAmount ?? 0);
    if (adjusted >= agreed) {
      throw new QuoteError(409, "Un ajuste es para cobrar menos de lo acordado. Para agregar algo, cotízalo como adicional.");
    }
  }
  // Una cotización nueva reemplaza a la que el cliente todavía no contesta.
  await run("UPDATE service_quotes SET status = 'replaced' WHERE service_request_id = ? AND status = 'pending'", [
    input.requestId
  ]);
  const result = await run(
    `INSERT INTO service_quotes (service_request_id, mechanic_id, labor_amount, parts_amount, parts_on_hand_amount, description, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [input.requestId, input.mechanicId, input.laborAmount, input.partsAmount, input.partsOnHandAmount ?? 0, input.description, kind]
  );
  return getQuote(result.lastID);
}

/** Lo acordado en las cotizaciones aceptadas (null si no hay ninguna). */
export async function acceptedQuotesTotal(requestId: number): Promise<number | null> {
  const row = await get<{ total: number | null }>(
    `SELECT SUM(labor_amount + parts_amount + COALESCE(parts_on_hand_amount, 0)) AS total
     FROM service_quotes WHERE service_request_id = ? AND status = 'accepted'`,
    [requestId]
  );
  return row?.total ?? null;
}

/** Un ajuste esperando al cliente: mientras tanto no se puede terminar. */
export async function hasPendingAdjustment(requestId: number): Promise<boolean> {
  return Boolean(
    await get<{ id: number }>(
      "SELECT id FROM service_quotes WHERE service_request_id = ? AND status = 'pending' AND kind = 'adjustment' LIMIT 1",
      [requestId]
    )
  );
}

export async function respondToQuote(input: {
  requestId: number;
  quoteId: number;
  customerId: number | null | undefined;
  accept: boolean;
}): Promise<ServiceQuote> {
  const row = await get<{ customerId: number; status: string; requestId: number; kind: QuoteKind }>(
    `SELECT sr.customer_id AS customerId, q.status, q.service_request_id AS requestId, q.kind
     FROM service_quotes q JOIN service_requests sr ON sr.id = q.service_request_id
     WHERE q.id = ?`,
    [input.quoteId]
  );
  if (!row || row.requestId !== input.requestId) {
    throw new QuoteError(404, "Cotización no encontrada");
  }
  if (row.customerId !== input.customerId) {
    throw new QuoteError(403, "Solo el cliente de la solicitud puede contestar la cotización");
  }
  if (row.status !== "pending") {
    throw new QuoteError(409, "Esta cotización ya no está pendiente.");
  }
  // Un ajuste aceptado pasa a ser todo lo acordado.
  if (input.accept && row.kind === "adjustment") {
    await run("UPDATE service_quotes SET status = 'replaced' WHERE service_request_id = ? AND status = 'accepted'", [
      input.requestId
    ]);
  }
  await run("UPDATE service_quotes SET status = ?, responded_at = CURRENT_TIMESTAMP WHERE id = ?", [
    input.accept ? "accepted" : "rejected",
    input.quoteId
  ]);
  return getQuote(input.quoteId);
}
