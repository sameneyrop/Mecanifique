import { useState } from 'react';
import { Text, View } from 'react-native';

import { styles } from '../styles';
import { useAppContext, type ServiceQuote } from '../context/AppContext';
import { Card, Field, InfoRow, Input, PrimaryButton, SecondaryButton } from './ui';
import { formatError } from '../utils';
import type { ApiCall } from '../App';

// Cotización obligatoria antes de reparar (servidor: src/quotes.ts). El
// mecánico la manda después del diagnóstico; el cliente la acepta o no.

function pesos(amount: number): string {
  return `$${Math.round(amount).toLocaleString('es-MX')}`;
}

function QuoteBreakdown({ quote }: { quote: ServiceQuote }) {
  return (
    <View style={styles.stack}>
      <Text style={styles.itemText}>{quote.description}</Text>
      {quote.laborAmount > 0 && <InfoRow icon="construct-outline" text={`Mano de obra: ${pesos(quote.laborAmount)}`} />}
      {quote.partsAmount > 0 && <InfoRow icon="cube-outline" text={`Refacciones: ${pesos(quote.partsAmount)}`} />}
      <Text style={styles.itemTitle}>Total: {pesos(quote.total)}</Text>
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
}: {
  api: ApiCall;
  requestId: number;
  status: string;
  quotes: ServiceQuote[];
  onChanged: () => void;
}) {
  const { busy, setBusy, setMessage } = useAppContext();
  const latest = quotes[0];
  const accepted = quotes.filter((quote) => quote.status === 'accepted');
  const repairing = REPAIR_STATUSES.has(status);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ labor: '', parts: '', description: '' });

  async function send() {
    const laborAmount = Number(form.labor) || 0;
    const partsAmount = Number(form.parts) || 0;
    if (laborAmount + partsAmount <= 0) {
      setMessage('Escribe cuánto cobrarás de mano de obra o de refacciones');
      return;
    }
    if (form.description.trim().length < 5) {
      setMessage('Explica en pocas palabras qué vas a hacer');
      return;
    }
    setBusy(true);
    try {
      await api(`/api/service-requests/${requestId}/quotes`, {
        method: 'POST',
        body: { laborAmount, partsAmount, description: form.description.trim() },
      });
      setEditing(false);
      setForm({ labor: '', parts: '', description: '' });
      setMessage('Cotización enviada. Te avisamos cuando el cliente conteste.');
      onChanged();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  const quoteForm = (
    <View style={styles.stack}>
      <Field label="Mano de obra (pesos)">
        <Input
          value={form.labor}
          keyboardType="numeric"
          placeholder="Ej. 600"
          onChangeText={(value) => setForm({ ...form, labor: value.replace(/[^0-9.]/g, '') })}
        />
      </Field>
      <Field label="Refacciones estimadas (pesos, opcional)">
        <Input
          value={form.parts}
          keyboardType="numeric"
          placeholder="Ej. 1200"
          onChangeText={(value) => setForm({ ...form, parts: value.replace(/[^0-9.]/g, '') })}
        />
      </Field>
      <Field label="¿Qué vas a hacer?">
        <Input
          value={form.description}
          multiline
          placeholder="Ej. Cambiar la batería y revisar el alternador"
          onChangeText={(value) => setForm({ ...form, description: value })}
        />
      </Field>
      <PrimaryButton title="Mandar cotización" busy={busy} onPress={send} />
      {editing && <SecondaryButton title="Cancelar" onPress={() => setEditing(false)} />}
    </View>
  );

  // Ya reparando: lo acordado y, si hace falta, algo adicional.
  if (repairing) {
    return (
      <View style={styles.stack}>
        <InfoRow icon="checkmark-circle-outline" text={`Acordado con el cliente: ${pesos(accepted.reduce((sum, quote) => sum + quote.total, 0))}`} />
        {latest?.status === 'pending' ? (
          <InfoRow icon="time-outline" text={`Esperando que el cliente acepte lo adicional: ${pesos(latest.total)}`} />
        ) : editing ? (
          quoteForm
        ) : (
          <SecondaryButton title="Cotizar algo adicional" onPress={() => setEditing(true)} />
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

  async function respond(quote: ServiceQuote, accept: boolean) {
    setBusy(true);
    try {
      await api(`/api/service-requests/${requestId}/quotes/${quote.id}/respond`, { method: 'POST', body: { accept } });
      setMessage(accept ? 'Aceptaste la cotización. Tu mecánico ya puede empezar.' : 'Le avisamos a tu mecánico que no la aceptaste.');
      onChanged();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={pending ? `${name} te mandó una cotización` : 'Cotización'}
      subtitle={pending ? 'Revísala: no empezará a reparar hasta que la aceptes.' : undefined}
    >
      <View style={styles.stack}>
        {pending && (
          <>
            <QuoteBreakdown quote={pending} />
            <PrimaryButton title={`Aceptar ${pesos(pending.total)}`} busy={busy} onPress={() => void respond(pending, true)} />
            <SecondaryButton title="No aceptar" busy={busy} onPress={() => void respond(pending, false)} />
            <Text style={styles.smallText}>El pago es directo con tu mecánico; Mecanifique no cobra este monto.</Text>
          </>
        )}
        {accepted.length > 0 && (
          <InfoRow
            icon="checkmark-circle-outline"
            text={`Aceptaste ${pesos(accepted.reduce((sum, quote) => sum + quote.total, 0))}${accepted.length > 1 ? ' en total' : ''}.`}
          />
        )}
        {!pending && lastRejected && (
          <Text style={styles.itemText}>No aceptaste la cotización. Tu mecánico puede mandarte otra.</Text>
        )}
      </View>
    </Card>
  );
}
