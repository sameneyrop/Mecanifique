import { all, get, run } from "./db";
import { amountDueForRequest } from "./servicePayment";
import { getStripeGateway } from "./stripe";

/**
 * Comisión de Mecanifique (modelo vigente; ver README.md → "Modelo de pagos").
 *
 * El cliente le paga directo al mecánico y no le paga nada a Mecanifique. El
 * mecánico paga una comisión del 10 % de la visita y la mano de obra de cada
 * servicio terminado, sin las refacciones (esas siguen a precio de ticket),
 * con mínimo de $30 (nunca más de lo que cobró) y tope de $300.
 *
 * - Sus primeros 30 días son gratis (COMMISSION_FREE_DAYS), contados desde su
 *   primer servicio terminado, no desde que abrió su cuenta (y nunca antes del
 *   lanzamiento, COMMISSION_LAUNCH_DATE): el servicio queda registrado con
 *   comisión $0.
 * - Nunca paga comisión de un servicio que no le pagaron: entra al corte
 *   cuando él confirma el pago, o 48 h después de terminar si nadie reportó
 *   que no le pagaron.
 * - Cada lunes (hora de México) se arma su corte semanal; tiene 7 días para
 *   pagarlo (tarjeta u OXXO en Stripe, o transferencia que marca un admin).
 *   Con un corte vencido no puede conectarse.
 *
 * Como el dinero del trabajo nunca pasa por Mecanifique, no cobra por cuenta
 * de terceros: la comisión es ingreso propio de Mecanifique.
 */

export const COMMISSION_RATE = 0.1;
export const COMMISSION_MIN = 30;
export const COMMISSION_CAP = 300;
export const STATEMENT_DUE_DAYS = 7;
export const BILLABLE_AFTER_HOURS = 48;

export function commissionFreeDays(): number {
  const days = Number(process.env.COMMISSION_FREE_DAYS ?? 30);
  return Number.isFinite(days) && days >= 0 ? days : 30;
}

/**
 * Cuándo empezó a cobrarse la comisión: quien ya era mecánico cuenta sus días
 * gratis desde aquí, no desde que creó su cuenta. Por defecto el 29 de
 * septiembre de 2026 a medianoche de México (UTC-6); COMMISSION_LAUNCH_DATE
 * (fecha ISO) lo cambia.
 */
function commissionLaunchMs(): number {
  const launch = Date.parse(process.env.COMMISSION_LAUNCH_DATE?.trim() || "2026-09-29T06:00:00Z");
  return Number.isNaN(launch) ? 0 : launch;
}

/**
 * Cuándo empezaron sus días gratis: con su primer servicio terminado (no al
 * abrir la cuenta: si no hay clientes todavía, no se le gastan esperando), y
 * nunca antes del lanzamiento. `firstServiceMs` es el de ahora si todavía no
 * había terminado ninguno; null si no ha terminado ninguno.
 */
async function freeStartMs(mechanicId: number, firstServiceMs: number | null = null): Promise<number | null> {
  const first = await get<{ firstAt: string | null }>(
    "SELECT MIN(created_at) AS firstAt FROM commission_charges WHERE mechanic_id = ?",
    [mechanicId]
  );
  const startMs = first?.firstAt ? parseSqliteDate(first.firstAt) : firstServiceMs;
  return startMs === null ? null : Math.max(startMs, commissionLaunchMs());
}

export class CommissionError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** 10 % de la base, entre $30 y $300, y nunca más de lo que cobró. */
export function commissionFor(base: number): number {
  if (!(base > 0)) return 0;
  const rate = Math.max(COMMISSION_MIN, Math.min(COMMISSION_CAP, base * COMMISSION_RATE));
  return Math.round(Math.min(rate, base) * 100) / 100;
}

/** Fecha SQLite ("YYYY-MM-DD HH:MM:SS", UTC) de un Date. */
function sqliteDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function parseSqliteDate(value: string): number {
  return Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

/**
 * Registra la comisión de un servicio que acaba de terminar. Idempotente (una
 * por servicio). Devuelve lo registrado, o null si no aplica.
 */
export async function recordCommission(
  requestId: number,
  now = new Date()
): Promise<{ commission: number; waived: boolean } | null> {
  const row = await get<{ mechanicId: number | null; status: string }>(
    "SELECT mechanic_id AS mechanicId, status FROM service_requests WHERE id = ?",
    [requestId]
  );
  if (!row || row.status !== "completed" || !row.mechanicId) {
    return null;
  }
  const { visitFee, labor } = await amountDueForRequest(requestId);
  const base = visitFee + labor;
  const commission = commissionFor(base);
  const freeStart = (await freeStartMs(row.mechanicId, now.getTime())) as number;
  const waived = commission > 0 && now.getTime() < freeStart + commissionFreeDays() * 86_400_000;
  await run(
    `INSERT OR IGNORE INTO commission_charges (mechanic_id, service_request_id, base_amount, commission, waived_reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [row.mechanicId, requestId, base, commission, waived ? "free_period" : null, sqliteDate(now)]
  );
  return { commission, waived };
}

// Entra al corte: no está en otro, se cobra, y el mecánico ya confirmó que le
// pagaron o pasaron 48 h sin que reportara que no.
function billableSql(nowSql: string): string {
  return `c.statement_id IS NULL AND c.waived_reason IS NULL AND c.commission > 0
    AND (sr.paid_at IS NOT NULL
         OR (sr.unpaid_reported_at IS NULL AND c.created_at <= datetime('${nowSql}', '-${BILLABLE_AFTER_HOURS} hours')))`;
}

/** El lunes de esta semana en México ("YYYY-MM-DD"): la clave del corte. */
export function statementPeriodKey(now = new Date()): string {
  const mexicoDate = now.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
  const day = new Date(`${mexicoDate}T12:00:00Z`);
  const weekday = day.getUTCDay(); // 0 domingo … 1 lunes
  day.setUTCDate(day.getUTCDate() - ((weekday + 6) % 7));
  return day.toISOString().slice(0, 10);
}

export type CreatedStatement = { id: number; mechanicId: number; total: number; services: number; dueAt: string };

/**
 * Arma el corte de la semana de cada mecánico que tenga comisiones por
 * cobrar. Se puede llamar seguido: una vez por mecánico y semana.
 */
export async function generateWeeklyStatements(now = new Date()): Promise<CreatedStatement[]> {
  const periodKey = statementPeriodKey(now);
  const nowSql = sqliteDate(now);
  const pending = await all<{ mechanicId: number; total: number; services: number }>(
    `SELECT c.mechanic_id AS mechanicId, SUM(c.commission) AS total, COUNT(*) AS services
     FROM commission_charges c JOIN service_requests sr ON sr.id = c.service_request_id
     WHERE ${billableSql(nowSql)}
       AND NOT EXISTS (SELECT 1 FROM commission_statements s WHERE s.mechanic_id = c.mechanic_id AND s.period_key = ?)
     GROUP BY c.mechanic_id`,
    [periodKey]
  );
  const created: CreatedStatement[] = [];
  const dueAt = sqliteDate(new Date(now.getTime() + STATEMENT_DUE_DAYS * 86_400_000));
  for (const row of pending) {
    const inserted = await run(
      `INSERT OR IGNORE INTO commission_statements (mechanic_id, period_key, total, services, due_at, created_at)
       VALUES (?, ?, 0, 0, ?, ?)`,
      [row.mechanicId, periodKey, dueAt, nowSql]
    );
    if (inserted.changes === 0) continue;
    const statementId = inserted.lastID;
    await run(
      `UPDATE commission_charges SET statement_id = ?
       WHERE id IN (
         SELECT c.id FROM commission_charges c JOIN service_requests sr ON sr.id = c.service_request_id
         WHERE c.mechanic_id = ? AND ${billableSql(nowSql)}
       )`,
      [statementId, row.mechanicId]
    );
    const totals = await get<{ total: number; services: number }>(
      "SELECT COALESCE(SUM(commission), 0) AS total, COUNT(*) AS services FROM commission_charges WHERE statement_id = ?",
      [statementId]
    );
    const total = Math.round((totals?.total ?? 0) * 100) / 100;
    await run("UPDATE commission_statements SET total = ?, services = ? WHERE id = ?", [total, totals?.services ?? 0, statementId]);
    created.push({ id: statementId, mechanicId: row.mechanicId, total, services: totals?.services ?? 0, dueAt });
  }
  return created;
}

type StatementRow = {
  id: number;
  mechanicId: number;
  periodKey: string;
  total: number;
  services: number;
  status: "open" | "paid";
  dueAt: string;
  paidAt: string | null;
  paidVia: string | null;
  checkoutSessionId: string | null;
  createdAt: string;
};

const STATEMENT_COLUMNS = `id, mechanic_id AS mechanicId, period_key AS periodKey, total, services, status, due_at AS dueAt,
  paid_at AS paidAt, paid_via AS paidVia, checkout_session_id AS checkoutSessionId, created_at AS createdAt`;

/** Corte vencido y sin pagar: mientras exista, el mecánico no puede conectarse. */
export async function overdueStatement(mechanicId: number, now = new Date()): Promise<StatementRow | null> {
  return (
    (await get<StatementRow>(
      `SELECT ${STATEMENT_COLUMNS} FROM commission_statements
       WHERE mechanic_id = ? AND status = 'open' AND due_at < ? ORDER BY due_at LIMIT 1`,
      [mechanicId, sqliteDate(now)]
    )) ?? null
  );
}

export async function markStatementPaid(statementId: number, via: "stripe" | "manual"): Promise<boolean> {
  const updated = await run(
    "UPDATE commission_statements SET status = 'paid', paid_at = CURRENT_TIMESTAMP, paid_via = ? WHERE id = ? AND status = 'open'",
    [via, statementId]
  );
  return updated.changes > 0;
}

/** Datos para pagar por transferencia (variables de entorno de Render). */
export function transferDetails(): { clabe: string; holder: string } | null {
  const clabe = process.env.MECANIFIQUE_PAYMENT_CLABE?.trim();
  if (!clabe) return null;
  return { clabe, holder: process.env.MECANIFIQUE_PAYMENT_HOLDER?.trim() || "Mecanifique" };
}

/** Todo lo que el mecánico ve de sus comisiones. */
export async function mechanicCommissionSummary(mechanicId: number, now = new Date()) {
  const freeStart = await freeStartMs(mechanicId);
  const freeUntil = freeStart === null ? null : freeStart + commissionFreeDays() * 86_400_000;
  const statements = await all<StatementRow>(
    `SELECT ${STATEMENT_COLUMNS} FROM commission_statements WHERE mechanic_id = ? ORDER BY id DESC LIMIT 12`,
    [mechanicId]
  );
  const charges = await all<{
    id: number;
    requestId: number;
    baseAmount: number;
    commission: number;
    waivedReason: string | null;
    statementId: number | null;
    createdAt: string;
    vehicle: string;
    paidAt: string | null;
    unpaidReportedAt: string | null;
  }>(
    `SELECT c.id, c.service_request_id AS requestId, c.base_amount AS baseAmount, c.commission, c.waived_reason AS waivedReason,
            c.statement_id AS statementId, c.created_at AS createdAt, sr.vehicle_make || ' ' || sr.vehicle_model AS vehicle,
            sr.paid_at AS paidAt, sr.unpaid_reported_at AS unpaidReportedAt
     FROM commission_charges c JOIN service_requests sr ON sr.id = c.service_request_id
     WHERE c.mechanic_id = ? ORDER BY c.id DESC LIMIT 30`,
    [mechanicId]
  );
  const nowSql = sqliteDate(now);
  const nextStatement = charges
    .filter((charge) => !charge.statementId && !charge.waivedReason && charge.commission > 0)
    .reduce((sum, charge) => sum + charge.commission, 0);
  return {
    rate: COMMISSION_RATE,
    min: COMMISSION_MIN,
    cap: COMMISSION_CAP,
    freeUntil: freeUntil !== null && freeUntil > now.getTime() ? new Date(freeUntil).toISOString() : null,
    // Todavía no termina ningún servicio: sus días gratis no han empezado.
    freeNotStarted: freeStart === null,
    freeDays: commissionFreeDays(),
    // Lo que irá en su próximo corte (estimado).
    nextStatementEstimate: Math.round(nextStatement * 100) / 100,
    statements: statements.map((statement) => ({ ...statement, overdue: statement.status === "open" && statement.dueAt < nowSql })),
    charges: charges.map((charge) => ({
      ...charge,
      // Estado para la app: gratis, en un corte, esperando el pago del cliente, o para el próximo corte.
      state: charge.waivedReason
        ? "free"
        : charge.statementId
          ? "billed"
          : charge.unpaidReportedAt && !charge.paidAt
            ? "on_hold"
            : "next"
    })),
    payment: { card: getStripeGateway() !== null, transfer: transferDetails() }
  };
}

export async function statementForMechanic(statementId: number, mechanicId: number): Promise<StatementRow> {
  const statement = await get<StatementRow>(`SELECT ${STATEMENT_COLUMNS} FROM commission_statements WHERE id = ?`, [statementId]);
  if (!statement || statement.mechanicId !== mechanicId) {
    throw new CommissionError(404, "Corte no encontrado");
  }
  return statement;
}

/** Abre el pago del corte en Stripe (tarjeta u OXXO). */
export async function createStatementCheckout(input: {
  statementId: number;
  mechanicId: number;
  successUrl: string;
  cancelUrl: string;
  email?: string;
}): Promise<{ checkoutUrl: string }> {
  const gateway = getStripeGateway();
  if (!gateway) {
    throw new CommissionError(503, "El pago con tarjeta todavía no está activo. Paga por transferencia.");
  }
  const statement = await statementForMechanic(input.statementId, input.mechanicId);
  if (statement.status !== "open") {
    throw new CommissionError(409, "Este corte ya está pagado.");
  }
  const session = await gateway.createPaymentCheckout({
    amountCents: Math.round(statement.total * 100),
    name: `Comisión Mecanifique · semana del ${statement.periodKey}`,
    description: `${statement.services} servicio(s): 10 % de visita y mano de obra.`,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    customerEmail: input.email,
    reference: `statement:${statement.id}`
  });
  await run("UPDATE commission_statements SET checkout_session_id = ? WHERE id = ?", [session.id, statement.id]);
  return { checkoutUrl: session.url };
}

/** Revisa en Stripe si ya se pagó (con OXXO puede tardar días). */
export async function refreshStatementPayment(statementId: number): Promise<boolean> {
  const gateway = getStripeGateway();
  const statement = await get<StatementRow>(`SELECT ${STATEMENT_COLUMNS} FROM commission_statements WHERE id = ?`, [statementId]);
  if (!gateway || !statement || statement.status !== "open" || !statement.checkoutSessionId) {
    return false;
  }
  const checkout = await gateway.retrieveCheckout(statement.checkoutSessionId);
  if (checkout.paymentIntentStatus === "succeeded") {
    return markStatementPaid(statement.id, "stripe");
  }
  return false;
}

/** Cortes abiertos con un pago en Stripe en curso (para revisarlos periódicamente). */
export async function openStatementsWithCheckout(): Promise<number[]> {
  const rows = await all<{ id: number }>(
    "SELECT id FROM commission_statements WHERE status = 'open' AND checkout_session_id IS NOT NULL"
  );
  return rows.map((row) => row.id);
}

/** Para el panel de admin: cortes sin pagar, los vencidos primero. */
export async function openStatementsForAdmin(now = new Date()) {
  const rows = await all<StatementRow & { mechanicName: string }>(
    `SELECT s.id, s.mechanic_id AS mechanicId, s.period_key AS periodKey, s.total, s.services, s.status, s.due_at AS dueAt,
            s.paid_at AS paidAt, s.paid_via AS paidVia, s.checkout_session_id AS checkoutSessionId, s.created_at AS createdAt,
            m.full_name AS mechanicName
     FROM commission_statements s JOIN mechanics m ON m.id = s.mechanic_id
     WHERE s.status = 'open' ORDER BY s.due_at`
  );
  const nowSql = sqliteDate(now);
  return rows.map((row) => ({ ...row, overdue: row.dueAt < nowSql }));
}
