/**
 * Reglas del modelo de pagos "apartado + ajuste" (ver README.md → "Modelo
 * de pagos y apartado"). Funciones puras, sin llamadas a Stripe ni a la
 * base de datos, para poder testearlas sin mocks.
 */

/** El apartado es un porcentaje de la tarifa de mano de obra del mecánico. */
export const DEPOSIT_PERCENTAGE = 0.4;

/**
 * Calcula el apartado a partir de la tarifa de mano de obra del mecánico.
 * Si el mecánico todavía no configuró su tarifa, no hay apartado que cobrar
 * (la solicitud se crea igual; el apartado se agrega cuando la tenga).
 */
export function calculateDepositAmount(laborRate: number | null | undefined): number | null {
  if (laborRate == null || !Number.isFinite(laborRate) || laborRate <= 0) {
    return null;
  }
  return Math.round(laborRate * DEPOSIT_PERCENTAGE * 100) / 100;
}

/**
 * Comisión de Mecanifique como porcentaje del monto final del servicio,
 * escalonada por antigüedad/volumen (servicios completados históricos del
 * mecánico). Menos comisión conforme el mecánico genera más volumen en la
 * plataforma — mitigación a la fuga a trato directo documentada en el README.
 */
export const COMMISSION_TIERS = [
  { minJobsCompleted: 100, rate: 0.08 },
  { minJobsCompleted: 50, rate: 0.1 },
  { minJobsCompleted: 20, rate: 0.12 },
  { minJobsCompleted: 0, rate: 0.15 },
] as const;

export function getCommissionRate(jobsCompleted: number): number {
  const tier = COMMISSION_TIERS.find((candidate) => jobsCompleted >= candidate.minJobsCompleted);
  return tier ? tier.rate : COMMISSION_TIERS[COMMISSION_TIERS.length - 1].rate;
}

/** Comisión en moneda sobre el monto final cobrado por el servicio. */
export function calculateCommissionAmount(finalAmount: number, jobsCompleted: number): number {
  const rate = getCommissionRate(jobsCompleted);
  return Math.round(finalAmount * rate * 100) / 100;
}
