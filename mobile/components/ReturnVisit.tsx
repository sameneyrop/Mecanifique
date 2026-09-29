import { type ReactNode, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, Field, InfoRow, Input, PrimaryButton, SecondaryButton } from './ui';
import { formatError } from '../utils';
import type { ApiCall } from '../App';

/**
 * Visita de regreso (servidor: src/returnVisits.ts): la pieza hay que pedirla
 * o falta terminar otro día. Queda ligada al servicio, con el mismo mecánico y
 * sin cobro de visita. Mientras no sale hacia ella es "próxima": no le impide
 * al mecánico recibir trabajo ni al cliente pedir otro servicio.
 */

type UpcomingItem = {
  id: number;
  status: string;
  scheduleSlotId?: number | null;
  parentRequestId?: number | null;
  preferredTime: string;
  vehicleMake: string;
  vehicleModel: string;
  mechanicName?: string | null;
  customerName?: string | null;
};

/** Cita de la agenda o visita de regreso que todavía no empieza. */
export function isUpcoming(request: { status: string; scheduleSlotId?: number | null; parentRequestId?: number | null }): boolean {
  return request.status === 'assigned' && Boolean(request.scheduleSlotId || request.parentRequestId);
}

/** Mecánico: programar el regreso desde el servicio de hoy. */
export function ReturnVisitPanel({
  api,
  request,
  onChanged,
}: {
  api: ApiCall;
  request: { id: number; status: string; returnVisit?: { id: number; preferredTime: string } | null };
  onChanged: () => void;
}) {
  const { busy, setBusy, setMessage } = useAppContext();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ when: '', pendingWork: '' });

  if (request.returnVisit) {
    return <InfoRow icon="calendar-outline" text={`Visita de regreso: ${request.returnVisit.preferredTime}. Sin cobro de visita.`} />;
  }
  if (!open) {
    return <SecondaryButton title="La pieza llega otro día: programar regreso" onPress={() => setOpen(true)} />;
  }

  async function schedule() {
    if (form.when.trim().length < 3) {
      setMessage('Escribe cuándo regresas (día y hora)');
      return;
    }
    if (form.pendingWork.trim().length < 5) {
      setMessage('Escribe qué falta hacer');
      return;
    }
    setBusy(true);
    try {
      await api(`/api/service-requests/${request.id}/return-visit`, {
        method: 'POST',
        body: { when: form.when.trim(), pendingWork: form.pendingWork.trim() },
      });
      setOpen(false);
      setMessage('Regreso programado. Cobra hoy solo lo que hiciste: usa «Cobrar menos».');
      onChanged();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.stack}>
      <Text style={styles.itemText}>
        Vuelves otro día a terminar, sin cobrar otra visita. Si pides la pieza, sube el ticket del pedido como «Pedida»: el cliente la
        paga hoy.
      </Text>
      <Field label="¿Cuándo regresas?">
        <Input value={form.when} maxLength={80} placeholder="Ej. Jueves 3 de octubre, 10:00" onChangeText={(value) => setForm({ ...form, when: value })} />
      </Field>
      <Field label="¿Qué falta hacer?">
        <Input
          value={form.pendingWork}
          multiline
          maxLength={500}
          placeholder="Ej. Instalar la bomba de gasolina pedida"
          onChangeText={(value) => setForm({ ...form, pendingWork: value })}
        />
      </Field>
      <PrimaryButton title="Programar regreso" busy={busy} onPress={() => void schedule()} />
      <SecondaryButton title="Cancelar" onPress={() => setOpen(false)} />
    </View>
  );
}

/**
 * Próximas citas y visitas de regreso. El mecánico sale hacia ellas desde
 * aquí; el cliente ve cuándo y abre el detalle.
 */
export function UpcomingVisitsCard({
  items,
  role,
  onOpen,
  onStart,
  renderActions,
  busy,
}: {
  items: UpcomingItem[];
  role: 'customer' | 'mechanic';
  onOpen: (requestId: number) => void;
  onStart?: (requestId: number) => void;
  /** Acciones extra por visita (p. ej. "Ya no puedo ir" del mecánico). */
  renderActions?: (item: UpcomingItem) => ReactNode;
  busy: boolean;
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <Card title={items.length === 1 ? 'Próxima visita' : 'Próximas visitas'}>
      <View style={styles.list}>
        {items.map((item) => {
          const kind = item.parentRequestId ? 'Visita de regreso' : 'Cita';
          const other = role === 'mechanic' ? item.customerName : item.mechanicName;
          return (
            <View key={item.id} style={styles.stack}>
              <Pressable
                style={({ pressed }) => [styles.contactRow, pressed && styles.buttonPressed]}
                onPress={() => onOpen(item.id)}
                accessibilityRole="button"
                accessibilityLabel={`${kind}: ${item.preferredTime}`}
              >
                <Ionicons name="calendar-outline" size={28} color={colors.primary} />
                <View style={styles.flex}>
                  <Text style={styles.itemTitle}>{item.preferredTime}</Text>
                  <Text style={styles.smallText}>
                    {kind}
                    {other ? ` · ${other}` : ''} · {item.vehicleMake} {item.vehicleModel}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </Pressable>
              {role === 'mechanic' && onStart && (
                <PrimaryButton title="Salir hacia esta visita" busy={busy} onPress={() => onStart(item.id)} />
              )}
              {renderActions?.(item)}
            </View>
          );
        })}
      </View>
    </Card>
  );
}
