import { get, run } from "./db";

/**
 * Calificación del cliente: la pone el mecánico del servicio, una vez, al
 * terminar (o si se canceló con cargo, p. ej. el cliente no estaba). Los
 * mecánicos ven el promedio antes de aceptar una solicitud; el cliente ve su
 * propio promedio en Cuenta. El comentario no se le muestra a nadie más que a
 * Mecanifique (sirve para revisar disputas), para que nadie lo use para
 * exhibir o desquitarse.
 */

export class CustomerReviewError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export type CustomerRating = { average: number | null; count: number };

export async function customerRating(customerId: number): Promise<CustomerRating> {
  const row = await get<{ average: number | null; count: number }>(
    "SELECT AVG(rating) AS average, COUNT(*) AS count FROM customer_reviews WHERE customer_id = ?",
    [customerId]
  );
  const count = Number(row?.count ?? 0);
  return { average: count > 0 && row?.average != null ? Math.round(row.average * 10) / 10 : null, count };
}

export async function hasCustomerReview(requestId: number): Promise<boolean> {
  return Boolean(await get<{ id: number }>("SELECT id FROM customer_reviews WHERE service_request_id = ?", [requestId]));
}

export async function reviewCustomer(input: {
  requestId: number;
  mechanicId: number | null | undefined;
  rating: number;
  comment?: string;
}): Promise<void> {
  const request = await get<{ customerId: number; mechanicId: number | null; status: string; cancellationFee: number | null }>(
    `SELECT customer_id AS customerId, mechanic_id AS mechanicId, status, cancellation_fee AS cancellationFee
     FROM service_requests WHERE id = ?`,
    [input.requestId]
  );
  if (!request) {
    throw new CustomerReviewError(404, "Solicitud no encontrada");
  }
  if (!input.mechanicId || request.mechanicId !== input.mechanicId) {
    throw new CustomerReviewError(403, "Solo el mecánico del servicio puede calificar al cliente");
  }
  const finished = request.status === "completed" || (request.status === "cancelled" && (request.cancellationFee ?? 0) > 0);
  if (!finished) {
    throw new CustomerReviewError(409, "Podrás calificar al cliente cuando termine el servicio");
  }
  const result = await run(
    `INSERT OR IGNORE INTO customer_reviews (service_request_id, customer_id, mechanic_id, rating, comment)
     VALUES (?, ?, ?, ?, ?)`,
    [input.requestId, request.customerId, input.mechanicId, input.rating, input.comment?.trim() || null]
  );
  if (result.changes === 0) {
    throw new CustomerReviewError(409, "Ya calificaste a este cliente");
  }
}
