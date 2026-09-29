import { type ReactNode, useState } from 'react';
import { Alert, Image, Modal, Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext, type AmountDue, type PartsReceipt } from '../context/AppContext';
import { Card, Field, Input, PrimaryButton, Segmented, SecondaryButton } from './ui';
import { formatError, formatPesos } from '../utils';
import { takeEvidencePhoto } from '../photos';
import type { ApiCall } from '../App';

/**
 * Tickets de las refacciones que compra el mecánico (servidor:
 * src/partsReceipts.ts). Las compradas se cobran a precio de ticket; el
 * cliente ve la foto en cuanto se sube y aprueba lo que pasa de lo estimado
 * o no tiene ticket.
 */

type ReceiptRequest = {
  id: number;
  status: string;
  mechanicName?: string | null;
  receipts?: PartsReceipt[];
  partsTripOpen?: boolean;
  amountDue?: AmountDue;
};

const STATUS_TEXT: Record<PartsReceipt['status'], string> = {
  accepted: 'Aceptado',
  pending: 'Esperando al cliente',
  rejected: 'No aprobado',
};

function firstName(name: string | null | undefined, fallback: string): string {
  return name?.trim().split(/\s+/)[0] || fallback;
}

/** Miniatura del ticket; al tocarla se ve completa. */
function ReceiptPhoto({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="imagebutton" accessibilityLabel="Ver foto del ticket">
        <Image source={{ uri: url }} style={styles.receiptThumb} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.photoViewer} onPress={() => setOpen(false)} accessibilityLabel="Cerrar foto">
          <Image source={{ uri: url }} style={styles.photoViewerImage} resizeMode="contain" />
          <View style={styles.photoViewerClose}>
            <Ionicons name="close" size={22} color={colors.white} />
            <Text style={styles.photoViewerCloseText}>Cerrar</Text>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function ReceiptRow({ receipt, children }: { receipt: PartsReceipt; children?: ReactNode }) {
  const charged =
    receipt.status !== 'accepted' && receipt.chargedAmount < receipt.amount
      ? ` · se cobra ${formatPesos(receipt.chargedAmount)}`
      : '';
  return (
    <View style={styles.receiptRow}>
      <ReceiptPhoto url={receipt.photoUrl} />
      <View style={[styles.flex, styles.stack]}>
        <Text style={styles.itemTitle}>{formatPesos(receipt.amount)}</Text>
        <Text style={styles.smallText}>
          {receipt.ordered ? 'Pedida: se instala en la visita de regreso' : receipt.hasTicket ? 'Con ticket' : 'Sin ticket'}
          {receipt.storeNote ? ` · ${receipt.storeNote}` : ''}
        </Text>
        <Text style={[styles.smallText, receipt.status === 'pending' && styles.receiptPendingText]}>
          {STATUS_TEXT[receipt.status]}
          {charged}
        </Text>
        {children}
      </View>
    </View>
  );
}

/** Cliente: ve los tickets y aprueba los que lo necesitan. Solo lectura para mecánico y admin. */
export function ReceiptsCard({
  api,
  request,
  onChanged,
  canRespond,
}: {
  api: ApiCall;
  request: ReceiptRequest;
  onChanged: () => void;
  canRespond: boolean;
}) {
  const { busy, setBusy, setMessage } = useAppContext();
  const receipts = request.receipts ?? [];
  if (receipts.length === 0) {
    return null;
  }
  const name = firstName(request.mechanicName, 'Tu mecánico');

  async function respond(receipt: PartsReceipt, accept: boolean) {
    setBusy(true);
    try {
      await api(`/api/service-requests/${request.id}/parts-receipts/${receipt.id}/respond`, { method: 'POST', body: { accept } });
      setMessage(accept ? `Aprobado. Le avisamos a ${name}.` : `Le avisamos a ${name} que no lo aprobaste.`);
      onChanged();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  function confirmReject(receipt: PartsReceipt) {
    Alert.alert(
      '¿No aprobar este ticket?',
      receipt.chargedAmount > 0
        ? `Se cobrará solo lo que cabía en lo estimado: ${formatPesos(receipt.chargedAmount)}.`
        : 'Este ticket no se cobrará.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'No aprobar', style: 'destructive', onPress: () => void respond(receipt, false) },
      ],
    );
  }

  return (
    <Card
      title="Refacciones compradas"
      subtitle={canRespond ? 'Se cobran a precio de ticket. Toca la foto para verla completa.' : 'Tickets de las refacciones de este servicio.'}
    >
      <View style={styles.list}>
        {receipts.map((receipt) => (
          <ReceiptRow key={receipt.id} receipt={receipt}>
            {canRespond && receipt.status === 'pending' && (
              <View style={styles.stack}>
                <Text style={styles.itemText}>
                  {receipt.hasTicket
                    ? 'Costó más de lo que estimó. Apruébalo si estás de acuerdo.'
                    : 'La tienda no dio ticket: revisa la foto de la nota o de las piezas.'}
                </Text>
                <PrimaryButton title={`Aprobar ${formatPesos(receipt.amount)}`} busy={busy} onPress={() => void respond(receipt, true)} />
                <SecondaryButton title="No aprobar" busy={busy} onPress={() => confirmReject(receipt)} />
              </View>
            )}
          </ReceiptRow>
        ))}
      </View>
    </Card>
  );
}

/**
 * Mecánico: subir el ticket al comprar refacciones. Al salir por refacciones
 * es obligatorio para retomar la reparación (o decir que no compró nada).
 */
export function MechanicPartsPanel({ api, request, onChanged }: { api: ApiCall; request: ReceiptRequest; onChanged: () => void }) {
  const { busy, setBusy, setMessage } = useAppContext();
  const receipts = request.receipts ?? [];
  const tripOpen = request.status === 'awaiting_parts' && Boolean(request.partsTripOpen);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: '', store: '', withTicket: 'yes' });
  const showForm = tripOpen || open;
  const estimate = request.amountDue?.partsToBuyEstimate ?? 0;

  if (request.status !== 'awaiting_parts' && request.status !== 'repairing') {
    return null;
  }
  if (!tripOpen && receipts.length === 0 && estimate <= 0 && !open) {
    return null;
  }

  async function upload() {
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage('Escribe cuánto pagaste en la tienda');
      return;
    }
    let imageBase64: string | null;
    try {
      imageBase64 = await takeEvidencePhoto();
    } catch (error) {
      setMessage(formatError(error));
      return;
    }
    if (!imageBase64) {
      return;
    }
    setBusy(true);
    try {
      const receipt = await api<PartsReceipt>(`/api/service-requests/${request.id}/parts-receipts`, {
        method: 'POST',
        body: {
          imageBase64,
          amount,
          hasTicket: form.withTicket !== 'no',
          ordered: form.withTicket === 'ordered',
          storeNote: form.store.trim() || undefined,
        },
      });
      setForm({ amount: '', store: '', withTicket: 'yes' });
      setOpen(false);
      setMessage(
        receipt.status === 'accepted'
          ? 'Ticket subido. El cliente ya lo puede ver.'
          : 'Ticket subido. Espera a que el cliente lo apruebe.',
      );
      onChanged();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function nextStore() {
    setBusy(true);
    try {
      await api(`/api/service-requests/${request.id}/parts-trip/next-store`, { method: 'POST' });
      setMessage('Le avisamos al cliente que vas a otra tienda.');
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  function confirmNoPurchase() {
    Alert.alert('¿Regresaste sin comprar nada?', 'Le avisaremos al cliente. Sin ticket no se cobra ninguna refacción comprada.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sí, no compré nada',
        onPress: async () => {
          setBusy(true);
          try {
            await api(`/api/service-requests/${request.id}/parts-trip/none`, { method: 'POST' });
            setMessage('Listo. Ya puedes retomar la reparación.');
            onChanged();
          } catch (error) {
            setMessage(formatError(error));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  return (
    <Card
      title={tripOpen ? 'Sube el ticket de las refacciones' : 'Refacciones compradas'}
      subtitle={
        tripOpen
          ? 'Tómale foto al ticket en cuanto pagues. Sin ticket no se cobran las refacciones compradas y no puedes retomar la reparación.'
          : estimate > 0
            ? `Se cobran a precio de ticket. Estimaste ${formatPesos(estimate)}.`
            : 'Se cobran a precio de ticket.'
      }
    >
      <View style={styles.stack}>
        {receipts.map((receipt) => (
          <ReceiptRow key={receipt.id} receipt={receipt} />
        ))}
        {showForm ? (
          <View style={styles.stack}>
            <Segmented
              value={form.withTicket}
              options={[
                { key: 'yes', label: 'Con ticket', icon: 'receipt-outline' },
                { key: 'no', label: 'Sin ticket', icon: 'document-outline' },
                { key: 'ordered', label: 'Pedida', icon: 'time-outline' },
              ]}
              onChange={(value) => setForm({ ...form, withTicket: value })}
            />
            <Field label="¿Cuánto pagaste? (pesos)">
              <Input
                value={form.amount}
                keyboardType="numeric"
                placeholder="Ej. 950"
                onChangeText={(value) => setForm({ ...form, amount: value.replace(/[^0-9.]/g, '') })}
              />
            </Field>
            <Field label="Tienda (opcional)">
              <Input value={form.store} maxLength={120} placeholder="Ej. Refaccionaria del Centro" onChangeText={(value) => setForm({ ...form, store: value })} />
            </Field>
            {form.withTicket === 'no' && (
              <Text style={styles.smallText}>Tómale foto a la nota o a las piezas con su precio. El cliente tendrá que aprobarlo.</Text>
            )}
            {form.withTicket === 'ordered' && (
              <Text style={styles.smallText}>
                La pieza llega otro día: tómale foto al ticket del pedido. El cliente la paga hoy y la instalas en la visita de regreso
                (prográmala en «Avance»).
              </Text>
            )}
            <PrimaryButton
              title={
                form.withTicket === 'yes'
                  ? 'Tomar foto del ticket'
                  : form.withTicket === 'ordered'
                    ? 'Tomar foto del ticket del pedido'
                    : 'Tomar foto de la nota o las piezas'
              }
              busy={busy}
              onPress={() => void upload()}
            />
            {tripOpen ? (
              <>
                {/* Puede recorrer varias tiendas: el ticket se pide al regresar. */}
                <SecondaryButton title="No la encontré, voy a otra tienda" busy={busy} onPress={() => void nextStore()} />
                <SecondaryButton title="No compré nada" busy={busy} onPress={confirmNoPurchase} />
              </>
            ) : (
              <SecondaryButton title="Cancelar" onPress={() => setOpen(false)} />
            )}
          </View>
        ) : (
          <SecondaryButton title="Subir otro ticket" onPress={() => setOpen(true)} />
        )}
      </View>
    </Card>
  );
}
