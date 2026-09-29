import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext, type AmountDue, type PartsReceipt, type ServiceQuote } from '../context/AppContext';
import { Card, InfoRow, PrimaryButton, SecondaryButton } from './ui';
import { formatClabe, formatError, formatPesos, parseServerTimestamp } from '../utils';
import type { ApiCall } from '../App';

/**
 * Qué le toca hacer a cada quien en cada paso del servicio, y cuánto se paga,
 * para que nadie tenga que adivinar (como Uber: "págale $X a tu conductor").
 * El cobro sigue las reglas del servidor (src/servicePayment.ts): el cliente
 * le paga directo al mecánico la visita más lo cotizado, y los dos confirman.
 */

type IconName = keyof typeof Ionicons.glyphMap;
type Role = 'customer' | 'mechanic';

type GuideRequest = {
  id: number;
  status: string;
  preferredTime?: string;
  scheduleSlotId?: number | null;
  parentRequestId?: number | null;
  mechanicName?: string | null;
  customerName?: string | null;
  visitFee?: number | null;
  quotes?: ServiceQuote[];
  paidAt?: string | null;
  customerPaidAt?: string | null;
  paymentMethod?: 'cash' | 'transfer' | null;
  unpaidReportedAt?: string | null;
  reviewed?: boolean;
  serviceFee?: { amount: number; status: string } | null;
  cancelReason?: string | null;
  cancellationFee?: number | null;
  amountDue?: AmountDue;
  receipts?: PartsReceipt[];
  partsTripOpen?: boolean;
};

type RequestListItem = {
  status: string;
  cancellationFee?: number | null;
  mechanicId: number | null;
  updatedAt: string;
  paidAt?: string | null;
  customerPaidAt?: string | null;
  unpaidReportedAt?: string | null;
  reviewed?: boolean;
};

const METHOD_TEXT = { cash: 'en efectivo', transfer: 'por transferencia' } as const;

function firstName(name: string | null | undefined, fallback: string): string {
  return name?.trim().split(/\s+/)[0] || fallback;
}

/**
 * Lo que se le paga al mecánico, calculado por el servidor: visita + mano de
 * obra + refacciones que ya traía + compradas a precio de ticket. Si el
 * detalle no lo trae (servidor anterior), visita + cotizaciones aceptadas.
 */
export function serviceAmounts(request: GuideRequest): AmountDue {
  if (request.amountDue) {
    return request.amountDue;
  }
  const visitFee = request.visitFee ?? 0;
  const repairTotal = (request.quotes ?? [])
    .filter((quote) => quote.status === 'accepted')
    .reduce((sum, quote) => sum + quote.total, 0);
  return { visitFee, labor: repairTotal, partsOnHand: 0, partsToBuyEstimate: 0, partsBought: 0, repairTotal, total: visitFee + repairTotal };
}

/** "$1,500", o "$1,500 más las refacciones que compre, a precio de ticket (estimó $900)". */
function agreedText(amounts: AmountDue, buyer: 'él' | 'tú'): string {
  if (amounts.partsToBuyEstimate > 0 && amounts.partsBought === 0) {
    const verb = buyer === 'tú' ? 'compres' : 'compre';
    const estimated = buyer === 'tú' ? 'estimaste' : 'estimó';
    return `${formatPesos(amounts.total)} más las refacciones que ${verb}, a precio de ticket (${estimated} ${formatPesos(amounts.partsToBuyEstimate)})`;
  }
  return formatPesos(amounts.total);
}

const hasPendingReceipt = (request: GuideRequest) => (request.receipts ?? []).some((receipt) => receipt.status === 'pending');
const hasPendingAdjustment = (request: GuideRequest) =>
  (request.quotes ?? []).some((quote) => quote.status === 'pending' && quote.kind === 'adjustment');

function daysSince(timestamp: string | null | undefined): number {
  const time = parseServerTimestamp(timestamp);
  return time === null ? Infinity : (Date.now() - time) / 86_400_000;
}

/**
 * Servicio terminado que el cliente todavía tiene que atender en Inicio:
 * pagar, calificar, o responder a un reporte de que no pagó (ese se queda
 * hasta resolverse: sin eso no puede pedir otro servicio).
 */
export function customerNeedsClosure(request: RequestListItem): boolean {
  if (!isPayable(request) || !request.mechanicId) return false;
  if (request.unpaidReportedAt && !request.paidAt) {
    return !request.customerPaidAt || daysSince(request.updatedAt) < 7;
  }
  const paid = Boolean(request.paidAt || request.customerPaidAt);
  // Una cancelación con cargo no se califica: solo falta pagarla.
  return daysSince(request.updatedAt) < 3 && (!paid || (request.status === 'completed' && !request.reviewed));
}

/** Se cobra: servicio terminado, o cancelado con cargo (cancelación tardía o cliente ausente). */
export function isPayable(request: { status: string; cancellationFee?: number | null }): boolean {
  return request.status === 'completed' || (request.status === 'cancelled' && (request.cancellationFee ?? 0) > 0);
}

/** Servicio terminado que el mecánico todavía no confirma que le pagaron. */
export function mechanicNeedsClosure(request: RequestListItem): boolean {
  if (!isPayable(request) || request.paidAt) return false;
  return daysSince(request.updatedAt) < (request.unpaidReportedAt ? 7 : 3);
}

type Guide = { icon: IconName; title: string; text: string };

function customerGuide(request: GuideRequest): Guide | null {
  const name = firstName(request.mechanicName, 'Tu mecánico');
  const amounts = serviceAmounts(request);
  const { visitFee } = amounts;
  const quotes = request.quotes ?? [];
  const pendingQuote = quotes.some((quote) => quote.status === 'pending');
  const accepted = quotes.some((quote) => quote.status === 'accepted');
  const visitText = visitFee > 0 ? `la visita (${formatPesos(visitFee)})` : 'la visita';

  switch (request.status) {
    case 'assigned':
      if (request.parentRequestId) {
        return {
          icon: 'calendar-outline',
          title: `${name} regresa${request.preferredTime ? `: ${request.preferredTime}` : ''}`,
          text: 'Viene a terminar el trabajo. No se cobra otra visita: solo lo que falta, con su cotización.',
        };
      }
      return {
        icon: request.scheduleSlotId ? 'calendar-outline' : 'person-outline',
        title: request.scheduleSlotId ? `${name} confirmó tu cita` : `${name} aceptó tu solicitud`,
        text: [
          request.scheduleSlotId && request.preferredTime ? `Cita: ${request.preferredTime}.` : 'Te avisamos cuando salga hacia ti.',
          visitFee > 0 ? `La visita y diagnóstico cuesta ${formatPesos(visitFee)} y se la pagas a él al final.` : '',
        ]
          .filter(Boolean)
          .join(' '),
      };
    case 'en_route':
      return { icon: 'car-outline', title: `${name} va en camino`, text: 'Síguelo en el mapa de abajo. Ten a la mano tu auto y las llaves.' };
    case 'on_site':
    case 'in_progress':
      return {
        icon: 'hand-left-outline',
        title: `${name} llegó`,
        text: 'Recíbelo (tienes 15 minutos) y cuéntale qué le pasa a tu auto. Primero lo revisa y después te dice cuánto costaría repararlo.',
      };
    case 'diagnosing':
      if (pendingQuote) {
        return { icon: 'document-text-outline', title: 'Revisa la cotización', text: `Acéptala solo si estás de acuerdo. Si no, solo pagas ${visitText}.` };
      }
      if (accepted) {
        return { icon: 'checkmark-circle-outline', title: 'Aceptaste la cotización', text: `${name} ya puede empezar. Le pagarás ${agreedText(amounts, 'él')} al terminar.` };
      }
      if (quotes[0]?.status === 'rejected') {
        return { icon: 'close-circle-outline', title: 'No aceptaste la cotización', text: `${name} puede mandarte otra. Si terminan aquí, solo pagas ${visitText}.` };
      }
      return { icon: 'search-outline', title: `${name} está revisando tu auto`, text: 'Cuando termine te mandará aquí una cotización. No repara nada sin que la aceptes.' };
    case 'repairing':
    case 'awaiting_parts':
      if (hasPendingReceipt(request)) {
        return {
          icon: 'receipt-outline',
          title: 'Revisa el ticket de las refacciones',
          text: 'Míralo abajo y apruébalo si estás de acuerdo. Si no, se cobra solo hasta lo que estimó.',
        };
      }
      if (hasPendingAdjustment(request)) {
        return {
          icon: 'document-text-outline',
          title: 'Revisa el ajuste',
          text: `${name} te cobra menos porque no se hizo todo. Apruébalo si estás de acuerdo.`,
        };
      }
      if (pendingQuote) {
        return { icon: 'document-text-outline', title: 'Revisa lo adicional', text: 'Te cotizó algo extra. Acéptalo solo si estás de acuerdo; lo ya acordado sigue igual.' };
      }
      if (request.status === 'awaiting_parts') {
        return {
          icon: 'cube-outline',
          title: `${name} fue por refacciones`,
          text: 'Puedes seguirlo en el mapa. Cuando pague, verás aquí la foto del ticket: las refacciones se cobran a precio de ticket.',
        };
      }
      return {
        icon: 'construct-outline',
        title: `${name} está reparando tu auto`,
        text: `Lo acordado: ${agreedText(amounts, 'él')}. Se lo pagas a él al terminar.`,
      };
    default:
      return null;
  }
}

function mechanicGuide(request: GuideRequest): Guide | null {
  const client = firstName(request.customerName, 'el cliente');
  const amounts = serviceAmounts(request);
  const { visitFee } = amounts;
  const quotes = request.quotes ?? [];
  const latest = quotes[0];
  const accepted = quotes.some((quote) => quote.status === 'accepted');
  const visitText = visitFee > 0 ? `solo la visita: ${formatPesos(visitFee)}` : 'solo la visita';

  switch (request.status) {
    case 'assigned':
      if (request.parentRequestId) {
        return {
          icon: 'calendar-outline',
          title: 'Visita de regreso',
          text: `Con ${client}${request.preferredTime ? `: ${request.preferredTime}` : ''}. No se cobra visita: cotiza solo lo que falta. Sal desde «Próxima visita» en Inicio.`,
        };
      }
      return request.scheduleSlotId
        ? {
            icon: 'calendar-outline',
            title: 'Cita confirmada',
            text: `Con ${client}${request.preferredTime ? `: ${request.preferredTime}` : ''}. Toca «Voy en camino» cuando salgas.`,
          }
        : { icon: 'navigate-outline', title: 'Sal hacia el cliente', text: `Toca «Voy en camino» al salir: se abre la ruta y ${client} podrá seguirte.` };
    case 'en_route':
      return { icon: 'navigate-outline', title: `Ve con ${client}`, text: 'Si cerraste la ruta, toca «Cómo llegar». Al llegar, toca «Ya llegué».' };
    case 'on_site':
    case 'in_progress':
      return {
        icon: 'search-outline',
        title: 'Revisa el auto',
        text: `Saluda a ${client} y toca «Empezar diagnóstico».${visitFee > 0 ? ` Por la visita cobras ${formatPesos(visitFee)}.` : ''} Si no aparece en 15 minutos, podrás marcar que no está.`,
      };
    case 'diagnosing':
      if (accepted) {
        return { icon: 'checkmark-circle-outline', title: `${client} aceptó`, text: `Toca «Empezar reparación». Al terminar cobrarás ${agreedText(amounts, 'tú')}.` };
      }
      if (latest?.status === 'pending') {
        return { icon: 'time-outline', title: `Esperando a ${client}`, text: 'Te avisamos cuando conteste la cotización. No empieces a reparar antes.' };
      }
      if (latest?.status === 'rejected') {
        return { icon: 'close-circle-outline', title: `${client} no aceptó`, text: `Mándale otra cotización o toca «Terminar sin reparar» y cobra ${visitText}.` };
      }
      return {
        icon: 'document-text-outline',
        title: 'Manda la cotización',
        text: `Cuando sepas qué tiene, dile aquí cuánto cuesta repararlo. Si no se repara, cobras ${visitText}.`,
      };
    case 'repairing':
    case 'awaiting_parts':
      if (hasPendingReceipt(request)) {
        return {
          icon: 'time-outline',
          title: `Esperando a que ${client} apruebe el ticket`,
          text: 'Te avisamos cuando conteste. Mientras tanto no puedes terminar el servicio.',
        };
      }
      if (hasPendingAdjustment(request)) {
        return {
          icon: 'time-outline',
          title: `Esperando a que ${client} apruebe el ajuste`,
          text: 'Te avisamos cuando conteste. Mientras tanto no puedes terminar el servicio.',
        };
      }
      if (request.status === 'awaiting_parts') {
        return request.partsTripOpen
          ? {
              icon: 'receipt-outline',
              title: 'Ve por las refacciones',
              text: `Al pagar, sube aquí la foto del ticket: sin ticket no se cobran y no puedes retomar la reparación. ${client} puede ver tu ubicación.`,
            }
          : { icon: 'checkmark-circle-outline', title: 'Ticket subido', text: 'Toca «Retomar reparación» para seguir.' };
      }
      return {
        icon: 'construct-outline',
        title: 'Repara lo acordado',
        text: `Si hace falta algo más, cotízalo antes de hacerlo. Al terminar cobrarás ${agreedText(amounts, 'tú')}.`,
      };
    default:
      return null;
  }
}

function GuideBox({ icon, title, text, warning, label }: Guide & { warning?: boolean; label?: string }) {
  return (
    <View style={[styles.guideCard, warning && styles.guideCardWarning]} accessibilityRole="summary">
      <View style={[styles.guideIcon, warning && styles.guideIconWarning]}>
        <Ionicons name={icon} size={20} color={colors.white} />
      </View>
      <View style={[styles.flex, styles.stack]}>
        {label ? <Text style={styles.guideLabel}>{label}</Text> : null}
        <Text style={styles.itemTitle}>{title}</Text>
        <Text style={styles.itemText}>{text}</Text>
      </View>
    </View>
  );
}

/** "¿Qué sigue?": una instrucción clara arriba del servicio en curso. */
export function NextStepGuide({ request, role }: { request: GuideRequest; role: Role }) {
  const guide = role === 'mechanic' ? mechanicGuide(request) : customerGuide(request);
  return guide ? <GuideBox {...guide} label="¿Qué sigue?" /> : null;
}

function AmountBreakdown({ request }: { request: GuideRequest }) {
  const amounts = serviceAmounts(request);
  const rows: Array<[string, number]> = [
    ['Visita y diagnóstico', amounts.visitFee],
    ['Mano de obra', amounts.labor],
    ['Refacciones que traía', amounts.partsOnHand],
    ['Refacciones compradas (ticket)', amounts.partsBought],
    ['Cargo por cancelación', amounts.cancellationFee ?? 0],
  ];
  return (
    <View style={styles.stack}>
      <Text style={styles.amountValue}>{formatPesos(amounts.total)}</Text>
      {rows
        .filter(([, value]) => value > 0)
        .map(([label, value]) => (
          <View key={label} style={styles.breakdownRow}>
            <Text style={styles.smallText}>{label}</Text>
            <Text style={styles.smallText}>{formatPesos(value)}</Text>
          </View>
        ))}
    </View>
  );
}

function usePaymentAction(api: ApiCall, requestId: number, onChanged: () => void) {
  const { setBusy, setMessage } = useAppContext();
  return async (path: string, body: object | undefined, success: string) => {
    setBusy(true);
    try {
      await api(`/api/service-requests/${requestId}/payment/${path}`, { method: 'POST', body });
      setMessage(success);
      onChanged();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  };
}

type TipInfo = { clabe: string | null; holderName: string | null };

/** Por qué se cobra una cancelación (src/cancellations.ts). */
function CancellationNote({ request, role }: { request: GuideRequest; role: Role }) {
  const name = firstName(request.mechanicName, 'Tu mecánico');
  const client = firstName(request.customerName, 'el cliente');
  if (request.cancelReason === 'customer_cancelled') {
    return (
      <GuideBox
        icon="close-circle-outline"
        title="Cargo por cancelación"
        text={role === 'customer' ? `Cancelaste cuando ${name} ya iba en camino o había llegado.` : `${client} canceló cuando ya ibas o habías llegado.`}
      />
    );
  }
  if (request.cancelReason === 'customer_absent') {
    return (
      <GuideBox
        icon="home-outline"
        title={role === 'customer' ? `${name} no te encontró` : 'Marcaste que el cliente no estaba'}
        text={
          role === 'customer'
            ? 'Llegó y esperó 15 minutos. Se cobra la visita. Si sí estabas, dilo aquí abajo y lo revisamos.'
            : `Esperaste 15 minutos y ${client} no apareció. Se cobra la visita.`
        }
      />
    );
  }
  return null;
}

/** Cliente: cuánto pagarle al mecánico, cómo, y confirmar que ya le pagó. */
export function CustomerPaymentCard({
  api,
  request,
  onChanged,
  onRate,
}: {
  api: ApiCall;
  request: GuideRequest;
  onChanged: () => void;
  onRate?: () => void;
}) {
  const { busy, setMessage } = useAppContext();
  const [bank, setBank] = useState<TipInfo | null>(null);
  const act = usePaymentAction(api, request.id, onChanged);
  const name = firstName(request.mechanicName, 'tu mecánico');
  const { total } = serviceAmounts(request);
  const customerPaid = Boolean(request.customerPaidAt);
  const reportedUnpaid = Boolean(request.unpaidReportedAt) && !request.paidAt;

  // La misma CLABE que el mecánico registró para propinas sirve para pagarle.
  useEffect(() => {
    if (request.paidAt || customerPaid) return;
    api<TipInfo>(`/api/service-requests/${request.id}/tip-info`)
      .then(setBank)
      .catch(() => setBank(null));
  }, [request.id, request.paidAt, customerPaid]);

  const rateButton =
    onRate && request.status === 'completed' && !request.reviewed ? <PrimaryButton title={`Calificar a ${name}`} onPress={onRate} /> : null;

  // "Yo sí estaba": el cliente niega la ausencia; queda como disputa para revisar.
  function disputeAbsence() {
    Alert.alert('¿Sí estabas en el lugar?', 'Abriremos una revisión con la foto que tomó el mecánico y lo que nos cuentes.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sí estaba',
        onPress: () => {
          api('/api/disputes', {
            method: 'POST',
            body: {
              serviceRequestId: request.id,
              category: 'incorrect_charge',
              description: 'El mecánico marcó que no estaba, pero sí estaba en el lugar.',
            },
          })
            .then(() => setMessage('Lo revisaremos y te contactaremos.'))
            .catch((error) => setMessage(formatError(error)));
        },
      },
    ]);
  }
  const absenceDispute =
    request.cancelReason === 'customer_absent' ? <SecondaryButton title="Yo sí estaba" onPress={disputeAbsence} /> : null;

  if (total <= 0) {
    return rateButton ? <Card title="Tu servicio terminó">{rateButton}</Card> : null;
  }

  if (request.paidAt) {
    return (
      <Card title="Pago confirmado">
        <View style={styles.stack}>
          <InfoRow icon="checkmark-circle-outline" text={`${name} confirmó que recibió ${formatPesos(total)}.`} />
          {rateButton}
        </View>
      </Card>
    );
  }

  if (customerPaid) {
    return (
      <Card title={reportedUnpaid ? 'Estamos revisando el pago' : `Le avisamos a ${name} que ya le pagaste`}>
        <View style={styles.stack}>
          {reportedUnpaid ? (
            <GuideBox
              warning
              icon="alert-circle-outline"
              title={`${name} dice que no ha recibido tu pago`}
              text="Si pagaste por transferencia, guarda tu comprobante. Te contactaremos para resolverlo."
            />
          ) : (
            <Text style={styles.itemText}>
              Dijiste que le pagaste {formatPesos(total)} {request.paymentMethod ? METHOD_TEXT[request.paymentMethod] : ''}. Falta que él lo
              confirme.
            </Text>
          )}
          {rateButton}
        </View>
      </Card>
    );
  }

  function confirmPaid(method: 'cash' | 'transfer') {
    Alert.alert(
      `¿Ya le pagaste ${formatPesos(total)} a ${name} ${METHOD_TEXT[method]}?`,
      'Queda registrado con fecha y hora. Decir que pagaste sin haberlo hecho puede suspender tu cuenta.',
      [
        { text: 'Todavía no', style: 'cancel' },
        {
          text: 'Sí, ya le pagué',
          onPress: () => void act('customer-confirm', { method }, `Listo. Le avisamos a ${name} que ya le pagaste.`),
        },
      ],
    );
  }

  async function copyClabe() {
    if (!bank?.clabe) return;
    await Clipboard.setStringAsync(bank.clabe);
    setMessage('CLABE copiada. Pégala en la app de tu banco.');
  }

  return (
    <Card title={reportedUnpaid ? `${name} reporta que no le has pagado` : `Págale a ${name}`}>
      <View style={styles.stack}>
        <CancellationNote request={request} role="customer" />
        {reportedUnpaid && (
          <GuideBox
            warning
            icon="alert-circle-outline"
            title="Mientras no lo resuelvas, no podrás pedir otro servicio"
            text="Si ya le pagaste, confírmalo aquí abajo. Si no, págale y confírmalo."
          />
        )}
        <AmountBreakdown request={request} />
        <InfoRow icon="cash-outline" text="Directo a él, en efectivo o por transferencia. Mecanifique no cobra este monto." />
        {bank?.clabe ? (
          <View style={styles.publicProfileBox}>
            <Text style={styles.publicProfileTitle}>Para transferirle</Text>
            <InfoRow icon="card-outline" text={formatClabe(bank.clabe)} />
            {bank.holderName ? <InfoRow icon="person-outline" text={`A nombre de ${bank.holderName}`} /> : null}
            <SecondaryButton title="Copiar CLABE" compact onPress={() => void copyClabe()} />
          </View>
        ) : null}
        {request.serviceFee?.status === 'captured' && (
          <Text style={styles.smallText}>
            La cuota de servicio ({formatPesos(request.serviceFee.amount)}) ya se cobró a tu tarjeta: no es parte de este pago.
          </Text>
        )}
        <Text style={styles.smallText}>
          Si pagas en efectivo, pídele que lo confirme en su app antes de irse. Por transferencia te queda comprobante.
        </Text>
        <PrimaryButton title="Ya le pagué en efectivo" busy={busy} onPress={() => confirmPaid('cash')} />
        <SecondaryButton title="Ya le pagué por transferencia" busy={busy} onPress={() => confirmPaid('transfer')} />
        {absenceDispute}
      </View>
    </Card>
  );
}

/** Mecánico: cuánto cobrar y confirmar si ya le pagaron (o reportar que no). */
export function MechanicCollectCard({ api, request, onChanged }: { api: ApiCall; request: GuideRequest; onChanged: () => void }) {
  const { busy } = useAppContext();
  const act = usePaymentAction(api, request.id, onChanged);
  const client = firstName(request.customerName, 'el cliente');
  const { total } = serviceAmounts(request);
  const customerSaysPaid = Boolean(request.customerPaidAt);
  const reported = Boolean(request.unpaidReportedAt);

  if (total <= 0) {
    return null;
  }

  if (request.paidAt) {
    return (
      <Card title="Cobrado">
        <InfoRow icon="checkmark-circle-outline" text={`${client} te pagó ${formatPesos(total)}.`} />
      </Card>
    );
  }

  function confirmReceived() {
    Alert.alert(`¿${client} ya te pagó ${formatPesos(total)}?`, 'Le avisaremos que confirmaste su pago.', [
      { text: 'Todavía no', style: 'cancel' },
      { text: 'Sí, ya me pagó', onPress: () => void act('received', undefined, '¡Listo! Pago confirmado.') },
    ]);
  }

  function reportUnpaid() {
    Alert.alert(
      `¿Reportar que ${client} no te ha pagado?`,
      'Le avisaremos y no podrá pedir otro servicio hasta pagarte o decir que ya te pagó. Úsalo solo si de verdad no te pagó: si el cliente demuestra que sí, tu cuenta puede ser suspendida.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Sí, reportar', style: 'destructive', onPress: () => void act('unpaid', undefined, `Le avisamos a ${client}.`) },
      ],
    );
  }

  const receivedButton = <PrimaryButton title="Ya me pagó" busy={busy} onPress={confirmReceived} />;

  if (reported) {
    return (
      <Card title={customerSaysPaid ? 'Estamos revisando el pago' : 'Reportaste que no te han pagado'}>
        <View style={styles.stack}>
          <GuideBox
            warning
            icon="alert-circle-outline"
            title={customerSaysPaid ? `${client} dice que ya te pagó` : `Le avisamos a ${client}`}
            text={
              customerSaysPaid
                ? `Dice que te pagó ${request.paymentMethod ? METHOD_TEXT[request.paymentMethod] : ''} y tú que no. Te contactaremos para resolverlo. Si encuentras el pago, confírmalo aquí.`
                : 'No podrá pedir otro servicio hasta pagarte o decir que ya te pagó. Si te paga, confírmalo aquí.'
            }
          />
          <AmountBreakdown request={request} />
          {receivedButton}
        </View>
      </Card>
    );
  }

  return (
    <Card title={customerSaysPaid ? `${client} dice que ya te pagó` : `Cobra a ${client}`}>
      <View style={styles.stack}>
        <CancellationNote request={request} role="mechanic" />
        <AmountBreakdown request={request} />
        {customerSaysPaid ? (
          <Text style={styles.itemText}>
            Dice que te pagó {request.paymentMethod ? METHOD_TEXT[request.paymentMethod] : ''}. Revisa tu efectivo o tu cuenta y confírmalo.
          </Text>
        ) : (
          <>
            <InfoRow icon="cash-outline" text="En efectivo o por transferencia a tu cuenta. Mecanifique no se queda con nada de este monto." />
            <Text style={styles.smallText}>Confírmalo aquí en cuanto te pague, de preferencia frente al cliente.</Text>
          </>
        )}
        {receivedButton}
        <SecondaryButton title={customerSaysPaid ? 'No me ha llegado' : 'No me ha pagado'} busy={busy} onPress={reportUnpaid} />
      </View>
    </Card>
  );
}
