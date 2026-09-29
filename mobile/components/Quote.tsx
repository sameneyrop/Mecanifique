import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { styles } from '../styles';
import { useAppContext, type ServiceQuote } from '../context/AppContext';
import { Card, Field, InfoRow, Input, PrimaryButton, SecondaryButton, Segmented } from './ui';
import { formatError, formatPesos } from '../utils';
import type { ApiCall } from '../App';

// Cotización obligatoria antes de reparar (servidor: src/quotes.ts). El
// mecánico la manda después del diagnóstico; el cliente la acepta o no. Las
// refacciones van en dos: las que ya trae (precio fijo) y las que va a comprar
// (estimado; se cobran a precio de ticket, ver components/PartsReceipts.tsx).

const pesos = formatPesos;

/** Las refacciones a comprar son un estimado: el total final depende del ticket. */
function hasPartsEstimate(quote: ServiceQuote): boolean {
  return Boolean(quote.partsAreEstimate) && quote.partsAmount > 0;
}

/** "Garantía de la mano de obra: 30 días" (null en cotizaciones de antes). */
export function warrantyText(days: number | null | undefined): string | null {
  if (days == null) return null;
  return days > 0 ? `Garantía de la mano de obra: ${days} días` : 'Sin garantía en la mano de obra';
}

const WARRANTY_OPTIONS = [
  { key: '0', label: 'Sin garantía' },
  { key: '30', label: '30 días' },
  { key: '60', label: '60 días' },
  { key: '90', label: '90 días' },
];

function QuoteBreakdown({ quote }: { quote: ServiceQuote }) {
  const onHand = quote.partsOnHandAmount ?? 0;
  return (
    <View style={styles.stack}>
      <Text style={styles.itemText}>{quote.description}</Text>
      {quote.laborAmount > 0 && <InfoRow icon="construct-outline" text={`Mano de obra: ${pesos(quote.laborAmount)}`} />}
      {onHand > 0 && <InfoRow icon="cube-outline" text={`Refacciones que trae: ${pesos(onHand)}`} />}
      {quote.partsAmount > 0 &&
        (quote.partsAreEstimate ? (
          <InfoRow icon="receipt-outline" text={`Refacciones a comprar (estimado): ${pesos(quote.partsAmount)}`} />
        ) : (
          <InfoRow icon="cube-outline" text={`Refacciones: ${pesos(quote.partsAmount)}`} />
        ))}
      {warrantyText(quote.warrantyDays) && <InfoRow icon="shield-checkmark-outline" text={warrantyText(quote.warrantyDays) as string} />}
      <Text style={styles.itemTitle}>
        {hasPartsEstimate(quote) ? 'Total estimado' : 'Total'}: {pesos(quote.total)}
      </Text>
      {hasPartsEstimate(quote) && (
        <Text style={styles.smallText}>Las refacciones que compre se cobran a precio de ticket: verás la foto en la app.</Text>
      )}
    </View>
  );
}

const REPAIR_STATUSES = new Set(['repairing', 'awaiting_parts']);

/** Mecánico: mandar la cotización, ver si la aceptaron y cotizar algo adicional. */
export function MechanicQuotePanel({
  api,
  requestId,
  status,
  quotes,
  onChanged,
  adjusting = false,
  onAdjustingChange,
}: {
  api: ApiCall;
  requestId: number;
  status: string;
  quotes: ServiceQuote[];
  onChanged: () => void;
  /** Abre el ajuste desde fuera (al terminar sin haber hecho todo). */
  adjusting?: boolean;
  onAdjustingChange?: (adjusting: boolean) => void;
}) {
  const { busy, setBusy, setMessage } = useAppContext();
  const latest = quotes[0];
  const accepted = quotes.filter((quote) => quote.status === 'accepted');
  const agreedTotal = accepted.reduce((sum, quote) => sum + quote.total, 0);
  const repairing = REPAIR_STATUSES.has(status);
  const [editing, setEditing] = useState(false);
  // 'adjustment': bajar lo acordado porque no se hizo todo (src/quotes.ts).
  const [mode, setMode] = useState<'quote' | 'adjustment'>('quote');
  // warranty: días de garantía de la mano de obra; se elige a propósito (puede ser sin garantía).
  const [form, setForm] = useState({ labor: '', onHand: '', toBuy: '', description: '', warranty: '' });
  const isAdjustment = mode === 'adjustment';

  useEffect(() => {
    if (adjusting) {
      setMode('adjustment');
      setEditing(true);
    }
  }, [adjusting]);

  function openForm(nextMode: 'quote' | 'adjustment') {
    setMode(nextMode);
    setEditing(true);
  }

  function closeForm() {
    setEditing(false);
    setMode('quote');
    onAdjustingChange?.(false);
  }

  async function send() {
    const laborAmount = Number(form.labor) || 0;
    const partsOnHandAmount = Number(form.onHand) || 0;
    const partsAmount = isAdjustment ? 0 : Number(form.toBuy) || 0;
    const total = laborAmount + partsOnHandAmount + partsAmount;
    if (total <= 0 && !isAdjustment) {
      setMessage('Escribe cuánto cobrarás de mano de obra o de refacciones');
      return;
    }
    if (isAdjustment && total >= agreedTotal) {
      setMessage(`Un ajuste es para cobrar menos de lo acordado (${pesos(agreedTotal)}).`);
      return;
    }
    if (form.description.trim().length < 5) {
      setMessage(isAdjustment ? 'Explica en pocas palabras qué sí hiciste' : 'Explica en pocas palabras qué vas a hacer');
      return;
    }
    if (!isAdjustment && !form.warranty) {
      setMessage('Elige la garantía de tu mano de obra (puede ser sin garantía).');
      return;
    }
    setBusy(true);
    try {
      await api(`/api/service-requests/${requestId}/quotes`, {
        method: 'POST',
        body: {
          laborAmount,
          partsAmount,
          partsOnHandAmount,
          description: form.description.trim(),
          kind: mode,
          ...(isAdjustment ? {} : { warrantyDays: Number(form.warranty) }),
        },
      });
      closeForm();
      setForm({ labor: '', onHand: '', toBuy: '', description: '', warranty: '' });
      setMessage(
        isAdjustment ? 'Ajuste enviado. Espera a que el cliente lo apruebe.' : 'Cotización enviada. Te avisamos cuando el cliente conteste.',
      );
      onChanged();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  const quoteForm = (
    <View style={styles.stack}>
      {isAdjustment && (
        <Text style={styles.itemText}>
          Cobra solo lo que sí hiciste. Lo acordado era {pesos(agreedTotal)} y el cliente aprueba el ajuste. Las refacciones con
          ticket ya aceptado se cobran igual.
        </Text>
      )}
      <Field label={isAdjustment ? 'Mano de obra que sí hiciste (pesos)' : 'Mano de obra (pesos)'}>
        <Input
          value={form.labor}
          keyboardType="numeric"
          placeholder="Ej. 600"
          onChangeText={(value) => setForm({ ...form, labor: value.replace(/[^0-9.]/g, '') })}
        />
      </Field>
      <Field label={isAdjustment ? 'Refacciones tuyas que sí usaste (pesos, opcional)' : 'Refacciones que ya traes (pesos, opcional)'}>
        <Input
          value={form.onHand}
          keyboardType="numeric"
          placeholder="Ej. 150"
          onChangeText={(value) => setForm({ ...form, onHand: value.replace(/[^0-9.]/g, '') })}
        />
      </Field>
      {!isAdjustment && (
        <>
          <Field label="Refacciones que vas a comprar, estimado (pesos, opcional)">
            <Input
              value={form.toBuy}
              keyboardType="numeric"
              placeholder="Ej. 1200"
              onChangeText={(value) => setForm({ ...form, toBuy: value.replace(/[^0-9.]/g, '') })}
            />
          </Field>
          <Text style={styles.smallText}>
            Las que compres se cobran a precio de ticket: al pagarlas le tomas foto en la app. Si cuestan más de lo estimado, el
            cliente aprueba la diferencia.
          </Text>
        </>
      )}
      <Field label={isAdjustment ? '¿Qué sí hiciste?' : '¿Qué vas a hacer?'}>
        <Input
          value={form.description}
          multiline
          placeholder={
            isAdjustment ? 'Ej. Hice el diagnóstico; la batería no estaba disponible' : 'Ej. Cambiar la batería y revisar el alternador'
          }
          onChangeText={(value) => setForm({ ...form, description: value })}
        />
      </Field>
      {!isAdjustment && (
        <Field label="Garantía de tu mano de obra">
          <Segmented value={form.warranty} options={WARRANTY_OPTIONS} onChange={(value) => setForm({ ...form, warranty: value })} />
          <Text style={styles.smallText}>
            El cliente la ve antes de aceptar y queda por escrito en su servicio. Cubre tu trabajo, no las refacciones.
          </Text>
        </Field>
      )}
      <PrimaryButton title={isAdjustment ? 'Mandar ajuste' : 'Mandar cotización'} busy={busy} onPress={send} />
      {editing && <SecondaryButton title="Cancelar" onPress={closeForm} />}
    </View>
  );

  // Ya reparando: lo acordado y, si hace falta, algo adicional.
  if (repairing) {
    return (
      <View style={styles.stack}>
        <InfoRow icon="checkmark-circle-outline" text={`Acordado con el cliente: ${pesos(agreedTotal)}`} />
        {latest?.status === 'pending' ? (
          <InfoRow
            icon="time-outline"
            text={
              latest.kind === 'adjustment'
                ? `Esperando que el cliente apruebe el ajuste: ${pesos(latest.total)}`
                : `Esperando que el cliente acepte lo adicional: ${pesos(latest.total)}`
            }
          />
        ) : editing ? (
          quoteForm
        ) : (
          <>
            <SecondaryButton title="Cotizar algo adicional" onPress={() => openForm('quote')} />
            <SecondaryButton title="Cobrar menos: no se hizo todo" onPress={() => openForm('adjustment')} />
          </>
        )}
      </View>
    );
  }

  if (latest?.status === 'accepted') {
    return <InfoRow icon="checkmark-circle-outline" text={`El cliente aceptó ${pesos(latest.total)}. Ya puedes empezar.`} />;
  }

  if (latest?.status === 'pending' && !editing) {
    return (
      <View style={styles.stack}>
        <Text style={styles.itemTitle}>Esperando que el cliente acepte</Text>
        <QuoteBreakdown quote={latest} />
        <SecondaryButton title="Cambiar cotización" onPress={() => setEditing(true)} />
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      {latest?.status === 'rejected' ? (
        <Text style={styles.itemText}>
          El cliente no aceptó tu cotización de {pesos(latest.total)}. Puedes mandarle otra o terminar el servicio aquí.
        </Text>
      ) : (
        <Text style={styles.itemText}>
          Cuando termines el diagnóstico, dile al cliente cuánto costará. Podrás reparar en cuanto la acepte.
        </Text>
      )}
      {quoteForm}
    </View>
  );
}

/** La garantía de lo aceptado: la de la cotización principal (no la de un ajuste). */
export function acceptedWarranty(accepted: ServiceQuote[]): number | null {
  const withWarranty = accepted.filter((quote) => quote.kind !== 'adjustment' && quote.warrantyDays != null);
  return withWarranty.length > 0 ? Math.max(...withWarranty.map((quote) => quote.warrantyDays as number)) : null;
}

/** Cliente: revisar y aceptar (o no) la cotización del mecánico. */
export function CustomerQuoteCard({
  api,
  requestId,
  quotes,
  mechanicName,
  onChanged,
}: {
  api: ApiCall;
  requestId: number;
  quotes: ServiceQuote[];
  mechanicName?: string | null;
  onChanged: () => void;
}) {
  const { busy, setBusy, setMessage } = useAppContext();
  const pending = quotes.find((quote) => quote.status === 'pending');
  const accepted = quotes.filter((quote) => quote.status === 'accepted');
  const lastRejected = quotes[0]?.status === 'rejected' ? quotes[0] : null;
  const name = mechanicName || 'Tu mecánico';

  if (quotes.length === 0) {
    return null;
  }

  // Un ajuste baja lo acordado porque no se hizo todo (src/quotes.ts).
  const adjustment = pending?.kind === 'adjustment';
  const agreedTotal = accepted.reduce((sum, quote) => sum + quote.total, 0);

  async function respond(quote: ServiceQuote, accept: boolean) {
    setBusy(true);
    try {
      await api(`/api/service-requests/${requestId}/quotes/${quote.id}/respond`, { method: 'POST', body: { accept } });
      setMessage(
        quote.kind === 'adjustment'
          ? accept
            ? 'Aprobaste el ajuste.'
            : 'Le avisamos a tu mecánico que no aprobaste el ajuste.'
          : accept
            ? 'Aceptaste la cotización. Tu mecánico ya puede empezar.'
            : 'Le avisamos a tu mecánico que no la aceptaste.',
      );
      onChanged();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={pending ? (adjustment ? `${name} ajustó lo acordado` : `${name} te mandó una cotización`) : 'Cotización'}
      subtitle={
        pending
          ? adjustment
            ? `Te cobra menos porque no se hizo todo. Si no lo apruebas, sigue lo acordado antes (${pesos(agreedTotal)}).`
            : 'Revísala: no empezará a reparar hasta que la aceptes.'
          : undefined
      }
    >
      <View style={styles.stack}>
        {pending && (
          <>
            <QuoteBreakdown quote={pending} />
            <PrimaryButton
              title={
                adjustment
                  ? `Aprobar ajuste (${pesos(pending.total)})`
                  : hasPartsEstimate(pending)
                    ? `Aceptar (estimado ${pesos(pending.total)})`
                    : `Aceptar ${pesos(pending.total)}`
              }
              busy={busy}
              onPress={() => void respond(pending, true)}
            />
            <SecondaryButton title={adjustment ? 'No aprobar' : 'No aceptar'} busy={busy} onPress={() => void respond(pending, false)} />
            <Text style={styles.smallText}>El pago es directo con tu mecánico; Mecanifique no cobra este monto.</Text>
          </>
        )}
        {accepted.length > 0 && (
          <InfoRow
            icon="checkmark-circle-outline"
            text={`Aceptaste ${pesos(agreedTotal)}${accepted.length > 1 ? ' en total' : ''}.`}
          />
        )}
        {accepted.length > 0 && warrantyText(acceptedWarranty(accepted)) && (
          <InfoRow icon="shield-checkmark-outline" text={warrantyText(acceptedWarranty(accepted)) as string} />
        )}
        {!pending && lastRejected && (
          <Text style={styles.itemText}>No aceptaste la cotización. Tu mecánico puede mandarte otra.</Text>
        )}
      </View>
    </Card>
  );
}
