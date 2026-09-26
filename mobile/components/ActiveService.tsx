import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, CharCounter, Field, Input, PrimaryButton } from './ui';

export const ACTIVE_REQUEST_STATUSES = new Set([
  'pending',
  'assigned',
  'in_progress',
  'en_route',
  'on_site',
  'diagnosing',
  'repairing',
  'awaiting_parts',
]);

const PROGRESS_STEPS = [
  { key: 'pending', label: 'Buscando mecánico' },
  { key: 'assigned', label: 'Mecánico asignado' },
  { key: 'en_route', label: 'En camino' },
  { key: 'on_site', label: 'En el lugar' },
  { key: 'diagnosing', label: 'Diagnóstico' },
  { key: 'repairing', label: 'Reparación' },
  { key: 'completed', label: 'Terminado' },
] as const;

function progressIndex(status: string): number {
  // in_progress es un estado viejo equivalente a "ya está trabajando en el lugar".
  if (status === 'in_progress') return 3;
  if (status === 'awaiting_parts') return 5;
  return PROGRESS_STEPS.findIndex((step) => step.key === status);
}

export function ServiceProgress({ status }: { status: string }) {
  const current = progressIndex(status);
  return (
    <View style={styles.progressList}>
      {PROGRESS_STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        const label = active && status === 'awaiting_parts' ? 'Esperando refacciones' : step.label;
        return (
          <View key={step.key} style={styles.progressRow}>
            <View style={[styles.progressDot, (done || active) && styles.progressDotDone, active && styles.progressDotActive]}>
              {done && <Ionicons name="checkmark" size={12} color={colors.white} />}
            </View>
            <Text style={[styles.progressLabel, done && styles.progressLabelDone, active && styles.progressLabelActive]}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

type SearchableRequest = {
  id: number;
  mechanicId: number | null;
  mechanicName?: string | null;
  assignmentMode?: 'auto' | 'direct' | null;
};

/** Estado de una solicitud pendiente: esperando respuesta, o sin mecánico. */
export function SearchingStatus({
  request,
  busy,
  onSearchAgain,
}: {
  request: SearchableRequest;
  busy: boolean;
  onSearchAgain: (requestId: number) => void;
}) {
  const direct = request.assignmentMode === 'direct';

  if (request.mechanicId) {
    return (
      <View style={styles.searchingCard}>
        <ActivityIndicator color={colors.primary} />
        <View style={styles.flex}>
          <Text style={styles.itemTitle}>Esperando respuesta</Text>
          <Text style={styles.smallText}>
            {request.mechanicName || 'Un mecánico'} está revisando tu solicitud.
            {direct ? '' : ' Si no puede tomarla, buscamos a otro automáticamente.'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.searchingCard}>
      <Ionicons name="search-outline" size={22} color={colors.primary} />
      <View style={[styles.flex, styles.stack]}>
        <Text style={styles.itemTitle}>
          {direct ? 'El mecánico no pudo tomar tu solicitud' : 'No hay mecánicos disponibles ahora'}
        </Text>
        <Text style={styles.smallText}>
          {direct ? 'Podemos buscarte otro mecánico disponible en tu zona.' : 'Puedes intentar de nuevo en unos minutos.'}
        </Text>
        <PrimaryButton
          title={direct ? 'Buscar otro mecánico' : 'Buscar de nuevo'}
          busy={busy}
          onPress={() => onSearchAgain(request.id)}
        />
      </View>
    </View>
  );
}

/** Persona del otro lado del servicio, con botón para llamarla. */
export function ContactRow({ label, name, phone }: { label: string; name: string; phone?: string | null }) {
  return (
    <View style={styles.contactRow}>
      <Ionicons name="person-circle-outline" size={40} color={colors.primary} />
      <View style={styles.flex}>
        <Text style={styles.smallText}>{label}</Text>
        <Text style={styles.itemTitle}>{name}</Text>
      </View>
      {phone ? (
        <Pressable
          style={({ pressed }) => [styles.callButton, pressed && styles.buttonPressed]}
          onPress={() => void Linking.openURL(`tel:${phone}`)}
          accessibilityRole="button"
          accessibilityLabel={`Llamar a ${name}`}
        >
          <Ionicons name="call" size={18} color={colors.white} />
          <Text style={styles.callButtonText}>Llamar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmergencyButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={styles.emergencyButton} onPress={onPress} accessibilityRole="button">
      <Ionicons name="warning" size={20} color={colors.white} />
      <Text style={styles.emergencyButtonText}>Emergencia — Llamar al 911</Text>
    </Pressable>
  );
}

const SENDER_ROLE_LABELS: Record<string, string> = {
  customer: 'Cliente',
  mechanic: 'Mecánico',
  admin: 'Soporte',
};

/** Chat de la solicitud seleccionada (requestMessages del contexto). */
export function RequestChat({ onSendMessage }: { onSendMessage: () => void }) {
  const { user, requestMessages, messageDraft, setMessageDraft, busy } = useAppContext();

  return (
    <Card title="Chat" subtitle="Habla con el cliente o mecánico asignado">
      <View style={styles.stack}>
        {requestMessages.length === 0 ? (
          <Text style={styles.itemText}>Todavía no hay mensajes.</Text>
        ) : (
          requestMessages.map((chatMessage) => (
            <View
              key={chatMessage.id}
              style={[
                styles.chatBubble,
                chatMessage.senderRole === 'mechanic'
                  ? styles.chatBubbleMechanic
                  : chatMessage.senderRole === 'admin'
                    ? styles.chatBubbleAdmin
                    : styles.chatBubbleCustomer,
              ]}
            >
              <Text style={styles.chatSender}>
                {chatMessage.senderUserId === user?.id
                  ? 'Tú'
                  : `${chatMessage.senderName} · ${SENDER_ROLE_LABELS[chatMessage.senderRole] ?? chatMessage.senderRole}`}
              </Text>
              <Text style={styles.itemText}>{chatMessage.message}</Text>
              <Text style={styles.smallText}>{chatMessage.createdAt}</Text>
            </View>
          ))
        )}
        <Field label="Nuevo mensaje">
          <Input
            value={messageDraft}
            multiline
            maxLength={1000}
            placeholder="Escribe un mensaje"
            onChangeText={setMessageDraft}
          />
          <CharCounter value={messageDraft} max={1000} />
        </Field>
        <PrimaryButton title="Enviar mensaje" busy={busy} onPress={onSendMessage} />
      </View>
    </Card>
  );
}
