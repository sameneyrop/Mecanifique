import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, InfoRow, PrimaryButton, SecondaryButton } from './ui';
import { formatClabe, formatError, formatPesos, parseServerTimestamp } from '../utils';
import type { ApiCall } from '../App';

/**
 * Comisión de Mecanifique para el mecánico (servidor: src/commissions.ts):
 * 10 % de la visita y la mano de obra de cada servicio terminado, sin
 * refacciones, con mínimo $30 y tope $300. Sus primeros 30 días son gratis.
 * Cada lunes se arma su corte y tiene 7 días para pagarlo; vencido, no puede
 * conectarse.
 */

type Statement = {
  id: number;
  periodKey: string;
  total: number;
  services: number;
  status: 'open' | 'paid';
  dueAt: string;
  paidAt: string | null;
  overdue: boolean;
};

type Charge = {
  id: number;
  requestId: number;
  baseAmount: number;
  commission: number;
  createdAt: string;
  vehicle: string;
  state: 'free' | 'billed' | 'on_hold' | 'next';
};

export type CommissionSummary = {
  rate: number;
  min: number;
  cap: number;
  freeUntil: string | null;
  nextStatementEstimate: number;
  statements: Statement[];
  charges: Charge[];
  payment: { card: boolean; transfer: { clabe: string; holder: string } | null };
};

function longDate(value: string | null): string {
  const time = parseServerTimestamp(value);
  if (time === null) return '';
  return new Date(time).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
}

function shortDate(value: string | null): string {
  const time = parseServerTimestamp(value);
  if (time === null) return '';
  return new Date(time).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

export function useCommissions(api: ApiCall) {
  const [summary, setSummary] = useState<CommissionSummary | null>(null);
  const reload = useCallback(() => {
    api<CommissionSummary>('/api/mechanics/me/commissions')
      .then(setSummary)
      .catch(() => undefined);
  }, [api]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { summary, setSummary, reload };
}

/** Pagar un corte: tarjeta u OXXO en Stripe, o transferencia. */
function PayStatement({
  api,
  statement,
  payment,
  onChanged,
}: {
  api: ApiCall;
  statement: Statement;
  payment: CommissionSummary['payment'];
  onChanged: (summary?: CommissionSummary) => void;
}) {
  const { busy, setBusy, setMessage } = useAppContext();

  async function payWithStripe() {
    setBusy(true);
    try {
      const returnUrl = Linking.createURL('comision');
      const checkout = await api<{ checkoutUrl: string }>(`/api/mechanics/me/commission-statements/${statement.id}/checkout`, {
        method: 'POST',
        body: { returnUrl },
      });
      await WebBrowser.openAuthSessionAsync(checkout.checkoutUrl, returnUrl);
      const refreshed = await api<CommissionSummary>(`/api/mechanics/me/commission-statements/${statement.id}/refresh`, {
        method: 'POST',
      });
      const paid = refreshed.statements.some((item) => item.id === statement.id && item.status === 'paid');
      setMessage(paid ? '¡Listo! Tu corte quedó pagado.' : 'Si pagaste en OXXO, se confirma en 1 a 3 días.');
      onChanged(refreshed);
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function copyClabe() {
    if (!payment.transfer) return;
    await Clipboard.setStringAsync(payment.transfer.clabe);
    setMessage('CLABE copiada. Pégala en la app de tu banco.');
  }

  return (
    <View style={styles.stack}>
      {payment.card && (
        <PrimaryButton title={`Pagar ${formatPesos(statement.total)} con tarjeta u OXXO`} busy={busy} onPress={() => void payWithStripe()} />
      )}
      {payment.transfer ? (
        <View style={styles.publicProfileBox}>
          <Text style={styles.publicProfileTitle}>Por transferencia</Text>
          <InfoRow icon="card-outline" text={formatClabe(payment.transfer.clabe)} />
          <InfoRow icon="person-outline" text={`A nombre de ${payment.transfer.holder}`} />
          <Text style={styles.smallText}>Pon tu nombre en el concepto. Lo marcamos como pagado en cuanto lo recibamos.</Text>
          <SecondaryButton title="Copiar CLABE" compact onPress={() => void copyClabe()} />
        </View>
      ) : (
        !payment.card && <Text style={styles.smallText}>Escríbenos a soporte (en Cuenta) para pagarlo.</Text>
      )}
    </View>
  );
}

/** Inicio: el corte por pagar (o vencido) y, si aplica, hasta cuándo no paga comisión. */
export function CommissionHomeCard({ api }: { api: ApiCall }) {
  const { summary, setSummary, reload } = useCommissions(api);
  if (!summary) return null;
  const open = summary.statements.filter((statement) => statement.status === 'open');
  const overdue = open.find((statement) => statement.overdue);
  const current = overdue ?? open[0];

  if (!current) {
    return summary.freeUntil ? (
      <InfoRow icon="gift-outline" text={`Sin comisión hasta el ${longDate(summary.freeUntil)}: tus primeros 30 días.`} />
    ) : null;
  }

  return (
    <View style={[styles.guideCard, overdue && styles.guideCardWarning]}>
      <View style={[styles.guideIcon, overdue && styles.guideIconWarning]}>
        <Ionicons name={overdue ? 'alert-circle-outline' : 'receipt-outline'} size={20} color={colors.white} />
      </View>
      <View style={[styles.flex, styles.stack]}>
        <Text style={styles.guideLabel}>{overdue ? 'Corte vencido' : 'Corte semanal'}</Text>
        <Text style={styles.itemTitle}>
          {formatPesos(current.total)} de comisión · {current.services} servicio{current.services === 1 ? '' : 's'}
        </Text>
        <Text style={styles.itemText}>
          {overdue
            ? 'Págalo para volver a conectarte y recibir solicitudes.'
            : `Págalo antes del ${longDate(current.dueAt)} para seguir recibiendo solicitudes.`}
        </Text>
        <PayStatement api={api} statement={current} payment={summary.payment} onChanged={(next) => (next ? setSummary(next) : reload())} />
      </View>
    </View>
  );
}

type AdminStatement = Statement & { mechanicName: string };

/** Admin: cortes sin pagar; marcar como pagado uno que llegó por transferencia. */
export function AdminCommissionsCard({ api }: { api: ApiCall }) {
  const { busy, setBusy, setMessage } = useAppContext();
  const [statements, setStatements] = useState<AdminStatement[] | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  const load = useCallback(() => {
    api<{ statements: AdminStatement[] }>('/api/admin/commission-statements')
      .then((data) => setStatements(data.statements))
      .catch(() => setStatements([]));
  }, [api]);
  useEffect(() => {
    load();
  }, [load]);

  async function markPaid(statement: AdminStatement) {
    setBusy(true);
    try {
      await api(`/api/admin/commission-statements/${statement.id}/mark-paid`, { method: 'POST' });
      setMessage(`Corte de ${statement.mechanicName} marcado como pagado.`);
      setConfirming(null);
      load();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Cortes de comisiones" subtitle="Los que siguen sin pagar. Marca como pagado el que te llegue por transferencia.">
      {!statements ? (
        <Text style={styles.smallText}>Cargando…</Text>
      ) : statements.length === 0 ? (
        <Text style={styles.itemText}>No hay cortes pendientes.</Text>
      ) : (
        <View style={styles.list}>
          {statements.map((statement) => (
            <View key={statement.id} style={styles.stack}>
              <Text style={styles.itemTitle}>
                {statement.mechanicName} · {formatPesos(statement.total)}
              </Text>
              <Text style={styles.smallText}>
                {statement.services} servicio{statement.services === 1 ? '' : 's'} ·{' '}
                {statement.overdue ? 'vencido' : `vence el ${longDate(statement.dueAt)}`}
              </Text>
              {confirming === statement.id ? (
                <View style={styles.row}>
                  <PrimaryButton title="Sí, ya lo recibí" busy={busy} onPress={() => void markPaid(statement)} />
                  <SecondaryButton title="Cancelar" compact onPress={() => setConfirming(null)} />
                </View>
              ) : (
                <SecondaryButton title="Marcar como pagado" compact onPress={() => setConfirming(statement.id)} />
              )}
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

const STATE_TEXT: Record<Charge['state'], string> = {
  free: 'Gratis: tus primeros 30 días',
  billed: 'En tu corte',
  on_hold: 'En espera: reportaste que no te pagaron',
  next: 'Para tu próximo corte',
};

/** Acciones → Comisiones: cómo se calcula, cortes y la comisión de cada servicio. */
export function CommissionsPanel({ api }: { api: ApiCall }) {
  const { summary, setSummary, reload } = useCommissions(api);

  return (
    <View style={styles.stack}>
      <Card title="Cómo funciona la comisión" subtitle="El cliente te paga directo a ti. Mecanifique te cobra una comisión por los servicios que terminas.">
        <View style={styles.stack}>
          <InfoRow icon="calculator-outline" text="10 % de la visita y la mano de obra. Las refacciones no cuentan." />
          <InfoRow icon="resize-outline" text="Mínimo $30 por servicio (nunca más de lo que cobraste) y máximo $300." />
          <InfoRow icon="shield-checkmark-outline" text="Si reportas que no te pagaron, ese servicio no te cobra comisión." />
          <InfoRow icon="calendar-outline" text="Cada lunes se arma tu corte y tienes 7 días para pagarlo." />
          {summary?.freeUntil ? (
            <InfoRow icon="gift-outline" text={`Sin comisión hasta el ${longDate(summary.freeUntil)}: tus primeros 30 días.`} />
          ) : null}
        </View>
      </Card>

      {summary && summary.statements.some((statement) => statement.status === 'open') && (
        <Card title="Cortes por pagar">
          <View style={styles.list}>
            {summary.statements
              .filter((statement) => statement.status === 'open')
              .map((statement) => (
                <View key={statement.id} style={styles.stack}>
                  <Text style={styles.itemTitle}>
                    {formatPesos(statement.total)} · {statement.services} servicio{statement.services === 1 ? '' : 's'}
                  </Text>
                  <Text style={styles.smallText}>
                    {statement.overdue ? 'Vencido: no puedes conectarte hasta pagarlo.' : `Vence el ${longDate(statement.dueAt)}.`}
                  </Text>
                  <PayStatement api={api} statement={statement} payment={summary.payment} onChanged={(next) => (next ? setSummary(next) : reload())} />
                </View>
              ))}
          </View>
        </Card>
      )}

      <Card
        title="Tus servicios"
        subtitle={
          summary && summary.nextStatementEstimate > 0
            ? `Tu próximo corte va en ${formatPesos(summary.nextStatementEstimate)} hasta ahora.`
            : 'Aquí aparece la comisión de cada servicio que terminas.'
        }
      >
        {!summary ? (
          <Text style={styles.smallText}>Cargando…</Text>
        ) : summary.charges.length === 0 ? (
          <Text style={styles.itemText}>Todavía no terminas servicios.</Text>
        ) : (
          <View style={styles.list}>
            {summary.charges.map((charge) => (
              <View key={charge.id} style={styles.breakdownRow}>
                <View style={[styles.flex, styles.stack]}>
                  <Text style={styles.itemText}>
                    {shortDate(charge.createdAt)} · {charge.vehicle}
                  </Text>
                  <Text style={styles.smallText}>
                    {STATE_TEXT[charge.state]} · de {formatPesos(charge.baseAmount)}
                  </Text>
                </View>
                <Text style={styles.itemTitle}>{charge.state === 'free' ? '$0' : formatPesos(charge.commission)}</Text>
              </View>
            ))}
          </View>
        )}
      </Card>

      {summary && summary.statements.some((statement) => statement.status === 'paid') && (
        <Card title="Cortes pagados">
          <View style={styles.list}>
            {summary.statements
              .filter((statement) => statement.status === 'paid')
              .map((statement) => (
                <View key={statement.id} style={styles.breakdownRow}>
                  <Text style={styles.itemText}>Semana del {shortDate(`${statement.periodKey} 12:00:00`)}</Text>
                  <Text style={styles.itemTitle}>{formatPesos(statement.total)}</Text>
                </View>
              ))}
          </View>
        </Card>
      )}
    </View>
  );
}
