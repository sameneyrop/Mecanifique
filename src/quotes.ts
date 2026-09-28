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
 * Mecanifique no cobra este monto: queda como registro de lo que se acordó.
 */

export type QuoteStatus = "pending" | "accepted" | "rejected" | "replaced";

export type ServiceQuote = {
  id: number;
  serviceRequestId: number;
  laborAmount: number;
  partsAmount: number;
  total: number;
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
  labor_amount + parts_amount AS total, description, status, created_at AS createdAt, responded_at AS respondedAt
`;

export async function getQuotesForRequest(requestId: number): Promise<ServiceQuote[]> {
  return all<ServiceQuote>(
    `SELECT ${QUOTE_COLUMNS} FROM service_quotes WHERE service_request_id = ? ORDER BY id DESC`,
    [requestId]
  );
}

export async function hasAcceptedQuote(requestId: number): Promise<boolean> {
  return Boolean(
    await get<{ id: number }>("SELECT id FROM service_quotes WHERE service_request_id = ? AND status = 'accepted' LIMIT 1", [
      requestId
    ])
  );
}

/** Lo acordado en total: la suma de las cotizaciones aceptadas. */
export async function acceptedQuotesTotal(requestId: number): Promise<number | null> {
  const row = await get<{ total: number | null }>(
    "SELECT SUM(labor_amount + parts_amount) AS total FROM service_quotes WHERE service_request_id = ? AND status = 'accepted'",
    [requestId]
  );
  return row?.total ?? null;
}

export async function createQuote(input: {
  requestId: number;
  mechanicId: number;
  laborAmount: number;
  partsAmount: number;
  description: string;
}): Promise<ServiceQuote> {
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
  // Una cotización nueva reemplaza a la que el cliente todavía no contesta.
  await run("UPDATE service_quotes SET status = 'replaced' WHERE service_request_id = ? AND status = 'pending'", [
    input.requestId
  ]);
  const result = await run(
    `INSERT INTO service_quotes (service_request_id, mechanic_id, labor_amount, parts_amount, description)
     VALUES (?, ?, ?, ?, ?)`,
    [input.requestId, input.mechanicId, input.laborAmount, input.partsAmount, input.description]
  );
  const quote = await get<ServiceQuote>(`SELECT ${QUOTE_COLUMNS} FROM service_quotes WHERE id = ?`, [result.lastID]);
  return quote!;
}

export async function respondToQuote(input: {
  requestId: number;
  quoteId: number;
  customerId: number | null | undefined;
  accept: boolean;
}): Promise<ServiceQuote> {
  const row = await get<{ customerId: number; status: string; requestId: number }>(
    `SELECT sr.customer_id AS customerId, q.status, q.service_request_id AS requestId
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
  await run("UPDATE service_quotes SET status = ?, responded_at = CURRENT_TIMESTAMP WHERE id = ?", [
    input.accept ? "accepted" : "rejected",
    input.quoteId
  ]);
  const quote = await get<ServiceQuote>(`SELECT ${QUOTE_COLUMNS} FROM service_quotes WHERE id = ?`, [input.quoteId]);
  return quote!;
}
