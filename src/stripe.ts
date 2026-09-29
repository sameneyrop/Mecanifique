/**
 * Conexión con Stripe: el corte semanal de comisiones que paga el mecánico
 * (src/commissions.ts) y la cuota de servicio al cliente, que ya no se usa
 * (src/serviceFees.ts, apagada salvo SERVICE_FEE_ENABLED=true).
 *
 * Todo pasa por esta interfaz pequeña para que los tests puedan usar un
 * Stripe simulado. Sin STRIPE_SECRET_KEY no hay pasarela y la cuota queda
 * desactivada: la app funciona como antes, sin cobrar nada.
 */
import Stripe from "stripe";

export type CheckoutSummary = {
  status: string | null; // 'open' | 'complete' | 'expired'
  paymentIntentId: string | null;
  paymentIntentStatus: string | null; // 'requires_capture' cuando la tarjeta ya quedó apartada
  amountTotalCents: number | null;
};

export type StripeGateway = {
  createCheckout(input: {
    amountCents: number;
    successUrl: string;
    cancelUrl: string;
    customerEmail?: string;
    userId: number;
  }): Promise<{ id: string; url: string }>;
  /** Pago normal (se cobra al momento), con tarjeta u OXXO: el corte de comisiones. */
  createPaymentCheckout(input: {
    amountCents: number;
    name: string;
    description: string;
    successUrl: string;
    cancelUrl: string;
    customerEmail?: string;
    reference: string;
  }): Promise<{ id: string; url: string }>;
  retrieveCheckout(sessionId: string): Promise<CheckoutSummary>;
  capture(paymentIntentId: string, idempotencyKey: string): Promise<void>;
  cancel(paymentIntentId: string, idempotencyKey: string): Promise<void>;
};

function createStripeGateway(secretKey: string): StripeGateway {
  const stripe = new Stripe(secretKey);
  return {
    async createCheckout({ amountCents, successUrl, cancelUrl, customerEmail, userId }) {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        locale: "es-419",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "mxn",
              unit_amount: amountCents,
              product_data: {
                name: "Cuota de servicio Mecanifique",
                description: "Solo se cobra cuando el mecánico llega. Si cancelas antes o no llega nadie, no se te cobra."
              }
            }
          }
        ],
        // "Apartar" en la tarjeta en vez de cobrar: se cobra (capture) cuando
        // el mecánico llega, o se libera (cancel) si nunca llega.
        payment_intent_data: {
          capture_method: "manual",
          description: "Cuota de servicio Mecanifique",
          metadata: { userId: String(userId) }
        },
        client_reference_id: String(userId),
        customer_email: customerEmail,
        success_url: successUrl,
        cancel_url: cancelUrl,
        // Stripe exige entre 30 minutos y 24 horas.
        expires_at: Math.floor(Date.now() / 1000) + 35 * 60
      });
      if (!session.url) {
        throw new Error("Stripe no devolvió la dirección de pago");
      }
      return { id: session.id, url: session.url };
    },

    async createPaymentCheckout({ amountCents, name, description, successUrl, cancelUrl, customerEmail, reference }) {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        // OXXO: el mecánico paga en efectivo en tienda; se confirma en 1 a 3 días.
        payment_method_types: ["card", "oxxo"],
        payment_method_options: { oxxo: { expires_after_days: 3 } },
        locale: "es-419",
        line_items: [
          {
            quantity: 1,
            price_data: { currency: "mxn", unit_amount: amountCents, product_data: { name, description } }
          }
        ],
        payment_intent_data: { description: name, metadata: { reference } },
        client_reference_id: reference,
        customer_email: customerEmail,
        success_url: successUrl,
        cancel_url: cancelUrl
      });
      if (!session.url) {
        throw new Error("Stripe no devolvió la dirección de pago");
      }
      return { id: session.id, url: session.url };
    },

    async retrieveCheckout(sessionId) {
      const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
      const paymentIntent = session.payment_intent;
      const intent = paymentIntent && typeof paymentIntent === "object" ? paymentIntent : null;
      return {
        status: session.status ?? null,
        paymentIntentId: intent?.id ?? (typeof paymentIntent === "string" ? paymentIntent : null),
        paymentIntentStatus: intent?.status ?? null,
        amountTotalCents: session.amount_total ?? null
      };
    },

    async capture(paymentIntentId, idempotencyKey) {
      await stripe.paymentIntents.capture(paymentIntentId, {}, { idempotencyKey });
    },

    async cancel(paymentIntentId, idempotencyKey) {
      await stripe.paymentIntents.cancel(paymentIntentId, {}, { idempotencyKey });
    }
  };
}

let cachedGateway: StripeGateway | null = null;
let gatewayOverride: StripeGateway | null | undefined;

/** Pasarela de Stripe, o null si no hay STRIPE_SECRET_KEY (cuota desactivada). */
export function getStripeGateway(): StripeGateway | null {
  if (gatewayOverride !== undefined) {
    return gatewayOverride;
  }
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    return null;
  }
  if (!cachedGateway) {
    cachedGateway = createStripeGateway(secretKey);
  }
  return cachedGateway;
}

/** Solo para tests: usa un Stripe simulado (undefined vuelve al real). */
export function setStripeGatewayForTests(gateway: StripeGateway | null | undefined): void {
  gatewayOverride = gateway;
}
