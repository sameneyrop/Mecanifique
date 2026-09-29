import { all, get, run } from "./db";
import { getReceiptsForRequest } from "./partsReceipts";

/**
 * Lo que el cliente le paga al mecánico al terminar, directo a él (efectivo o
 * transferencia; Mecanifique no cobra ni pasa este dinero, ver README.md →
 * "Modelo de pagos"): la visita y diagnóstico, fijada cuando el mecánico
 * acepta, más las cotizaciones aceptadas. La app le muestra el mismo número a
 * los dos ("Págale $X" / "Cobra $X").
 *
 * Como el dinero no pasa por la app, nadie decide solo si se pagó:
 * - el cliente dice "ya le pagué" (y cómo) y el mecánico "ya me pagó";
 * - si el mecánico reporta que no le pagaron, el cliente no puede pedir otro
 *   servicio hasta que pague o diga, dejando constancia, que ya pagó;
 * - si los dos dicen cosas distintas, se abre una disputa de pago para que un
 *   admin la revise con la evidencia (cotización aceptada, confirmaciones con
 *   fecha, chat, comprobante de transferencia).
 * Así un cliente no puede irse sin pagar sin consecuencias, y un mecánico no
 * puede bloquear a un cliente que sí le pagó.
 */

export type AmountDue = {
  visitFee: number;
  labor: number;
  /** Refacciones que ya traía (precio de la cotización). */
  partsOnHand: number;
  /** Lo estimado de las refacciones a comprar: el tope sin aprobación. */
  partsToBuyEstimate: number;
  /** Refacciones compradas, a precio de ticket (src/partsReceipts.ts). */
  partsBought: number;
  repairTotal: number;
  /** Cargo por cancelación (src/cancellations.ts); si hay, es todo lo que se paga. */
  cancellationFee: number;
  total: number;
};
export type PaymentMethod = "cash" | "transfer";

export class ServicePaymentError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Las solicitudes aceptadas antes de que existiera visit_fee usan la tarifa
// actual del mecánico. Requiere los alias sr (service_requests) y m (mechanics).
export const VISIT_FEE_SQL = "COALESCE(sr.visit_fee, m.labor_rate)";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "en efectivo",
  transfer: "por transferencia"
};

/**
 * Visita + mano de obra + refacciones que ya traía + refacciones compradas a
 * precio de ticket. En las cotizaciones anteriores a los tickets
 * (parts_on_hand_amount NULL), parts_amount se cobra fijo, como antes.
 */
export async function amountDueForRequest(requestId: number): Promise<AmountDue> {
  const cancelled = await get<{ fee: number | null }>(
    "SELECT cancellation_fee AS fee FROM service_requests WHERE id = ? AND status = 'cancelled'",
    [requestId]
  );
  if (cancelled) {
    const fee = cancelled.fee ?? 0;
    return { visitFee: 0, labor: 0, partsOnHand: 0, partsToBuyEstimate: 0, partsBought: 0, repairTotal: 0, cancellationFee: fee, total: fee };
  }
  const row = await get<{ visitFee: number | null; labor: number | null; partsOnHand: number | null }>(
    `SELECT ${VISIT_FEE_SQL} AS visitFee,
            (SELECT SUM(q.labor_amount) FROM service_quotes q
             WHERE q.service_request_id = sr.id AND q.status = 'accepted') AS labor,
            (SELECT SUM(COALESCE(q.parts_on_hand_amount, q.parts_amount)) FROM service_quotes q
             WHERE q.service_request_id = sr.id AND q.status = 'accepted') AS partsOnHand
     FROM service_requests sr
     LEFT JOIN mechanics m ON m.id = sr.mechanic_id
     WHERE sr.id = ?`,
    [requestId]
  );
  const { estimate, chargedTotal } = await getReceiptsForRequest(requestId);
  const visitFee = row?.visitFee ?? 0;
  const labor = row?.labor ?? 0;
  const partsOnHand = row?.partsOnHand ?? 0;
  const repairTotal = labor + partsOnHand + chargedTotal;
  return {
    visitFee,
    labor,
    partsOnHand,
    partsToBuyEstimate: estimate,
    partsBought: chargedTotal,
    repairTotal,
    cancellationFee: 0,
    total: visitFee + repairTotal
  };
}

/** Fija el precio de la visita con la tarifa que tiene el mecánico al aceptar. */
export async function lockVisitFee(requestId: number, mechanicId: number): Promise<void> {
  await run("UPDATE service_requests SET visit_fee = (SELECT labor_rate FROM mechanics WHERE id = ?) WHERE id = ?", [
    mechanicId,
    requestId
  ]);
}

/** Al terminar, deja fijo el precio de la visita de las solicitudes viejas. */
export async function freezeVisitFee(requestId: number): Promise<void> {
  await run(
    `UPDATE service_requests
     SET visit_fee = COALESCE(visit_fee, (SELECT labor_rate FROM mechanics WHERE id = service_requests.mechanic_id))
     WHERE id = ?`,
    [requestId]
  );
}

// Se cobra al terminar, o al cancelar con cargo (cancelación tardía o cliente ausente).
const PAYABLE_SQL = "(sr.status = 'completed' OR (sr.status = 'cancelled' AND COALESCE(sr.cancellation_fee, 0) > 0))";

/** Deuda vigente (alias sr): el mecánico dice que no le pagaron y el cliente no ha dicho que sí. */
export const UNPAID_DEBT_SQL = `${PAYABLE_SQL}
  AND sr.unpaid_reported_at IS NOT NULL AND sr.paid_at IS NULL AND sr.customer_paid_at IS NULL`;

type PaymentRow = {
  customerId: number;
  mechanicId: number | null;
  mechanicName: string | null;
  customerName: string;
  status: string;
  payable: number;
  paidAt: string | null;
  customerPaidAt: string | null;
  paymentMethod: PaymentMethod | null;
  unpaidReportedAt: string | null;
};

async function getPaymentRow(requestId: number): Promise<PaymentRow> {
  const row = await get<PaymentRow>(
    `SELECT sr.customer_id AS customerId, sr.mechanic_id AS mechanicId, m.full_name AS mechanicName,
            c.full_name AS customerName, sr.status, ${PAYABLE_SQL} AS payable, sr.paid_at AS paidAt, sr.customer_paid_at AS customerPaidAt,
            sr.payment_method AS paymentMethod, sr.unpaid_reported_at AS unpaidReportedAt
     FROM service_requests sr
     JOIN customers c ON c.id = sr.customer_id
     LEFT JOIN mechanics m ON m.id = sr.mechanic_id
     WHERE sr.id = ?`,
    [requestId]
  );
  if (!row) {
    throw new ServicePaymentError(404, "Solicitud no encontrada");
  }
  if (!row.payable) {
    throw new ServicePaymentError(409, "El pago se confirma cuando el servicio ya terminó.");
  }
  return row;
}

async function openPaymentDispute(
  requestId: number,
  customerId: number,
  category: "unpaid" | "payment_disagreement",
  openedBy: "mechanic" | "system",
  description: string
): Promise<void> {
  // Una sola disputa de pago abierta por servicio: si ya había un reporte de
  // "no me pagó" y luego el cliente dice que sí pagó, se convierte en desacuerdo.
  const open = await get<{ id: number }>(
    `SELECT id FROM disputes
     WHERE service_request_id = ? AND category IN ('unpaid', 'payment_disagreement') AND status != 'resolved'
     LIMIT 1`,
    [requestId]
  );
  if (open) {
    await run(
      `UPDATE disputes SET category = ?, opened_by = ?, description = description || char(10) || ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [category, openedBy, description, open.id]
    );
    return;
  }
  await run(
    "INSERT INTO disputes (service_request_id, customer_id, category, description, opened_by) VALUES (?, ?, ?, ?, ?)",
    [requestId, customerId, category, description, openedBy]
  );
}

export type PaymentChange = {
  customerId: number;
  mechanicId: number | null;
  customerName: string;
  mechanicName: string;
  amount: number;
  method: PaymentMethod | null;
  /** Ya estaba así: no hay que volver a avisar a nadie. */
  unchanged: boolean;
  /** Los dos dicen cosas distintas: quedó una disputa de pago abierta. */
  disagreement: boolean;
};

async function changeFor(row: PaymentRow, requestId: number, patch: Partial<PaymentChange>): Promise<PaymentChange> {
  return {
    customerId: row.customerId,
    mechanicId: row.mechanicId,
    customerName: row.customerName,
    mechanicName: row.mechanicName ?? "Tu mecánico",
    amount: (await amountDueForRequest(requestId)).total,
    method: row.paymentMethod,
    unchanged: false,
    disagreement: false,
    ...patch
  };
}

/** El cliente dice que ya pagó y cómo. No se puede deshacer. */
export async function customerConfirmsPayment(
  requestId: number,
  customerId: number | null | undefined,
  method: PaymentMethod
): Promise<PaymentChange> {
  const row = await getPaymentRow(requestId);
  if (!customerId || row.customerId !== customerId) {
    throw new ServicePaymentError(403, "Solo el cliente del servicio puede confirmar su pago");
  }
  if (row.customerPaidAt || row.paidAt) {
    return changeFor(row, requestId, { unchanged: true });
  }
  await run("UPDATE service_requests SET customer_paid_at = CURRENT_TIMESTAMP, payment_method = ? WHERE id = ?", [
    method,
    requestId
  ]);
  const disagreement = Boolean(row.unpaidReportedAt);
  if (disagreement) {
    await openPaymentDispute(
      requestId,
      row.customerId,
      "payment_disagreement",
      "system",
      `El cliente dice que ya pagó ${PAYMENT_METHOD_LABELS[method]}; el mecánico había reportado que no le pagaron.`
    );
  }
  return changeFor(row, requestId, { method, disagreement });
}

/** El mecánico confirma que ya le pagaron. Cierra cualquier disputa de pago del servicio. */
export async function mechanicConfirmsPayment(requestId: number, mechanicId: number | null | undefined): Promise<PaymentChange> {
  const row = await getPaymentRow(requestId);
  if (!mechanicId || row.mechanicId !== mechanicId) {
    throw new ServicePaymentError(403, "Solo el mecánico del servicio puede confirmar el pago");
  }
  if (row.paidAt) {
    return changeFor(row, requestId, { unchanged: true });
  }
  await run("UPDATE service_requests SET paid_at = CURRENT_TIMESTAMP, unpaid_reported_at = NULL WHERE id = ?", [requestId]);
  await run(
    `UPDATE disputes
     SET status = 'resolved', resolution_note = 'El mecánico confirmó que recibió el pago.', resolved_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE service_request_id = ? AND category IN ('unpaid', 'payment_disagreement') AND status != 'resolved'`,
    [requestId]
  );
  return changeFor(row, requestId, {});
}

/**
 * El mecánico reporta que no le pagaron. Si el cliente ya había dicho que sí,
 * es un desacuerdo para revisar; si no, el cliente queda sin poder pedir otro
 * servicio hasta pagar o decir que ya pagó.
 */
export async function mechanicReportsUnpaid(requestId: number, mechanicId: number | null | undefined): Promise<PaymentChange> {
  const row = await getPaymentRow(requestId);
  if (!mechanicId || row.mechanicId !== mechanicId) {
    throw new ServicePaymentError(403, "Solo el mecánico del servicio puede reportar el pago");
  }
  if (row.paidAt) {
    throw new ServicePaymentError(409, "Ya confirmaste que te pagaron este servicio.");
  }
  if (row.unpaidReportedAt) {
    return changeFor(row, requestId, { unchanged: true, disagreement: Boolean(row.customerPaidAt) });
  }
  await run("UPDATE service_requests SET unpaid_reported_at = CURRENT_TIMESTAMP WHERE id = ?", [requestId]);
  const disagreement = Boolean(row.customerPaidAt);
  const amount = Math.round((await amountDueForRequest(requestId)).total);
  const customerSays = row.paymentMethod ? `que pagó ${PAYMENT_METHOD_LABELS[row.paymentMethod]}` : "que ya pagó";
  await openPaymentDispute(
    requestId,
    row.customerId,
    disagreement ? "payment_disagreement" : "unpaid",
    disagreement ? "system" : "mechanic",
    disagreement
      ? `El mecánico dice que no ha recibido el pago de $${amount}; el cliente dice ${customerSays}.`
      : `El mecánico reporta que el cliente no le ha pagado $${amount}.`
  );
  return changeFor(row, requestId, { disagreement });
}

/**
 * Servicio que el cliente debe según el mecánico y sobre el que el cliente no
 * ha dicho nada: mientras exista, no puede pedir otro.
 */
export async function unpaidServiceForCustomer(
  customerId: number
): Promise<{ requestId: number; mechanicName: string; amount: number } | null> {
  const rows = await all<{ id: number; mechanicName: string | null }>(
    `SELECT sr.id, m.full_name AS mechanicName
     FROM service_requests sr
     LEFT JOIN mechanics m ON m.id = sr.mechanic_id
     WHERE sr.customer_id = ? AND ${UNPAID_DEBT_SQL}
     ORDER BY sr.id DESC
     LIMIT 1`,
    [customerId]
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return { requestId: row.id, mechanicName: row.mechanicName ?? "tu mecánico", amount: (await amountDueForRequest(row.id)).total };
}
