/**
 * Integración con Stripe (pagos: apartado + ajuste). Sigue el mismo patrón
 * que didit.ts: getStripeConfig() devuelve null si no hay credenciales, y
 * cada endpoint que dependa de Stripe responde 503 en ese caso en vez de
 * fallar de forma confusa.
 *
 * Nada de esto se usa todavía desde ninguna ruta — es la base para cuando
 * exista una cuenta de Stripe (ver README.md → "Modelo de pagos y apartado"
 * para el checklist de qué falta conectar).
 */
import Stripe from "stripe";

type StripeConfig = {
  secretKey: string;
  webhookSecret: string;
};

export function getStripeConfig(): StripeConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

  if (!secretKey || !webhookSecret) {
    return null;
  }

  return { secretKey, webhookSecret };
}

let cachedClient: Stripe | null = null;

/** Cliente de Stripe reutilizado entre llamadas. Lanza si no hay config. */
export function getStripeClient(): Stripe {
  const config = getStripeConfig();
  if (!config) {
    throw new Error("STRIPE_NOT_CONFIGURED");
  }
  if (!cachedClient) {
    cachedClient = new Stripe(config.secretKey);
  }
  return cachedClient;
}
