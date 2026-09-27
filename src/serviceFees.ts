import { all, get, run } from "./db";
import { getStripeGateway } from "./stripe";

/**
 * Cuota de servicio: lo único que cobra Mecanifique. El trabajo del
 * mecánico se le paga a él directamente, fuera de la app, así Mecanifique
 * nunca maneja dinero de terceros.
 *
 * 1. El cliente paga en Stripe Checkout, pero la tarjeta solo queda
 *    "apartada" (captura manual).
 * 2. Al crear la solicitud se verifica ese pago y se reclama (una cuota,
 *    una solicitud).
 * 3. Cuando el mecánico llega (on_site o cualquier paso posterior) se cobra.
 *    Si la solicitud se cancela antes, se libera y no se cobra nada.
 */

export class ServiceFeeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type ServiceFeeRow = {
  id: number;
  userId: number;
  checkoutSessionId: string;
  paymentIntentId: string | null;
  amount: number;
  status: "pending" | "authorized" | "captured" | "released" | "failed";
  serviceRequestId: number | null;
  claimedAt: string | null;
};

const FEE_COLUMNS = `id, user_id AS userId, checkout_session_id AS checkoutSessionId, payment_intent_id AS paymentIntentId,
  amount, status, service_request_id AS serviceRequestId, claimed_at AS claimedAt`;

// Pasos en los que el mecánico ya llegó: a partir de aquí se cobra.
const ARRIVED_STATUSES = new Set(["on_site", "in_progress", "diagnosing", "repairing", "awaiting_parts", "completed"]);

// Solo se regresa a la app (Expo Go en desarrollo, o la app instalada).
const ALLOWED_RETURN_PREFIXES = ["mecanifique://", "exp://", "exps://"];

export function isServiceFeeEnabled(): boolean {
  return getStripeGateway() !== null;
}

/** Monto de la cuota en pesos (SERVICE_FEE_MXN, por defecto 49; Stripe no cobra menos de $10). */
export function serviceFeeAmount(): number {
  const amount = Number(process.env.SERVICE_FEE_MXN ?? 49);
  return Number.isFinite(amount) && amount >= 10 ? Math.round(amount) : 49;
}

export function isAllowedAppReturnUrl(url: string): boolean {
  return ALLOWED_RETURN_PREFIXES.some((prefix) => url.startsWith(prefix)) && url.length <= 300;
}

/** Abre el pago en Stripe. Devuelve la dirección de Checkout y su id. */
export async function createServiceFeeCheckout(input: {
  userId: number;
  email?: string;
  appReturnUrl: string;
  publicBaseUrl: string;
}): Promise<{ checkoutUrl: string; sessionId: string; amount: number }> {
  const gateway = getStripeGateway();
  if (!gateway) {
    throw new ServiceFeeError("Los pagos todavía no están activos", 503);
  }
  if (!isAllowedAppReturnUrl(input.appReturnUrl)) {
    throw new ServiceFeeError("Dirección de regreso inválida", 400);
  }
  const amount = serviceFeeAmount();
  const destino = encodeURIComponent(input.appReturnUrl);
  const back = `${input.publicBaseUrl.replace(/\/$/, "")}/pagos/regreso`;
  const session = await gateway.createCheckout({
    amountCents: amount * 100,
    // {CHECKOUT_SESSION_ID} lo reemplaza Stripe al regresar.
    successUrl: `${back}?estado=listo&session_id={CHECKOUT_SESSION_ID}&destino=${destino}`,
    cancelUrl: `${back}?estado=cancelado&destino=${destino}`,
    customerEmail: input.email && input.email.includes("@") ? input.email : undefined,
    userId: input.userId
  });
  await run(
    "INSERT INTO service_fees (user_id, checkout_session_id, amount) VALUES (?, ?, ?)",
    [input.userId, session.id, amount]
  );
  return { checkoutUrl: session.url, sessionId: session.id, amount };
}

/**
 * Verifica con Stripe que la cuota quedó apartada y la reclama para una
 * solicitud nueva. Una cuota solo sirve una vez. Devuelve el id de la cuota.
 */
export async function claimServiceFee(userId: number, sessionId: string): Promise<number> {
  const gateway = getStripeGateway();
  if (!gateway) {
    throw new ServiceFeeError("Los pagos todavía no están activos", 503);
  }
  const fee = await get<ServiceFeeRow>(
    `SELECT ${FEE_COLUMNS} FROM service_fees WHERE checkout_session_id = ? AND user_id = ?`,
    [sessionId, userId]
  );
  if (!fee) {
    throw new ServiceFeeError("No encontramos el pago de tu cuota. Vuelve a intentarlo.", 402);
  }
  if (fee.claimedAt) {
    throw new ServiceFeeError("Esa cuota ya se usó en otra solicitud.", 409);
  }
  const checkout = await gateway.retrieveCheckout(sessionId);
  if (checkout.status !== "complete" || checkout.paymentIntentStatus !== "requires_capture" || !checkout.paymentIntentId) {
    throw new ServiceFeeError("El pago de la cuota no se completó. Vuelve a intentarlo.", 402);
  }
  const claimed = await run(
    `UPDATE service_fees
     SET status = 'authorized', payment_intent_id = ?, claimed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND claimed_at IS NULL`,
    [checkout.paymentIntentId, fee.id]
  );
  if (claimed.changes === 0) {
    throw new ServiceFeeError("Esa cuota ya se usó en otra solicitud.", 409);
  }
  return fee.id;
}

export async function linkServiceFee(feeId: number, serviceRequestId: number): Promise<void> {
  await run(
    "UPDATE service_fees SET service_request_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [serviceRequestId, feeId]
  );
}

/**
 * Tras un cambio de estado: cobra si el mecánico ya llegó, libera si se
 * canceló. Nunca bloquea el cambio de estado: si Stripe falla, queda
 * registrado como 'failed' y en el log.
 */
export async function settleServiceFee(serviceRequestId: number, newStatus: string): Promise<void> {
  const shouldCapture = ARRIVED_STATUSES.has(newStatus);
  const shouldRelease = newStatus === "cancelled";
  if (!shouldCapture && !shouldRelease) {
    return;
  }
  const fee = await get<ServiceFeeRow>(
    `SELECT ${FEE_COLUMNS} FROM service_fees WHERE service_request_id = ? AND status = 'authorized'`,
    [serviceRequestId]
  );
  const gateway = getStripeGateway();
  if (!fee || !fee.paymentIntentId || !gateway) {
    return;
  }
  try {
    if (shouldCapture) {
      // La misma clave hace que dos cambios de estado simultáneos cobren una sola vez.
      await gateway.capture(fee.paymentIntentId, `capture-fee-${fee.id}`);
      await run("UPDATE service_fees SET status = 'captured', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [fee.id]);
    } else {
      await gateway.cancel(fee.paymentIntentId, `release-fee-${fee.id}`);
      await run("UPDATE service_fees SET status = 'released', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [fee.id]);
    }
  } catch (error) {
    console.error(`No se pudo ${shouldCapture ? "cobrar" : "liberar"} la cuota ${fee.id}`, error);
    await run("UPDATE service_fees SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [fee.id]);
  }
}

/**
 * Libera cuotas que se pagaron pero nunca llegaron a una solicitud (la app
 * se cerró a medio camino, por ejemplo). Corre cada pocos minutos.
 */
export async function releaseOrphanServiceFees(olderThanMinutes = 90): Promise<number> {
  const gateway = getStripeGateway();
  if (!gateway) {
    return 0;
  }
  const orphans = await all<ServiceFeeRow>(
    `SELECT ${FEE_COLUMNS} FROM service_fees
     WHERE service_request_id IS NULL AND status IN ('pending', 'authorized')
       AND created_at <= datetime('now', ?)`,
    [`-${olderThanMinutes} minutes`]
  );
  let released = 0;
  for (const fee of orphans) {
    try {
      let paymentIntentId = fee.paymentIntentId;
      let intentStatus: string | null = paymentIntentId ? "requires_capture" : null;
      if (!paymentIntentId) {
        const checkout = await gateway.retrieveCheckout(fee.checkoutSessionId);
        paymentIntentId = checkout.paymentIntentId;
        intentStatus = checkout.paymentIntentStatus;
      }
      if (paymentIntentId && intentStatus === "requires_capture") {
        await gateway.cancel(paymentIntentId, `release-fee-${fee.id}`);
      }
      await run("UPDATE service_fees SET status = 'released', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [fee.id]);
      released += 1;
    } catch (error) {
      console.error(`No se pudo liberar la cuota huérfana ${fee.id}`, error);
    }
  }
  return released;
}

/** Estado de la cuota de una solicitud, para mostrarlo en la app. */
export async function getServiceFeeForRequest(
  serviceRequestId: number
): Promise<{ amount: number; status: ServiceFeeRow["status"] } | null> {
  const fee = await get<{ amount: number; status: ServiceFeeRow["status"] }>(
    "SELECT amount, status FROM service_fees WHERE service_request_id = ?",
    [serviceRequestId]
  );
  return fee ?? null;
}
