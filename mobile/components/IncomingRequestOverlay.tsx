import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, Vibration, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, SecondaryButton } from './ui';
import { distanceKm, formatPesos, parseServerTimestamp } from '../utils';

const HOLD_TOTAL_SECONDS_FALLBACK = 120;

/** " · Cliente nuevo" o " · 5 servicios terminados", junto al nombre del cliente. */
export function customerHistoryText(completed: number | undefined): string {
  if (completed === undefined) return '';
  return completed > 0 ? ` · ${completed} servicio${completed === 1 ? '' : 's'} terminado${completed === 1 ? '' : 's'}` : ' · Cliente nuevo';
}

/**
 * En esa ubicación (a menos de 100 m) otra cuenta dejó un servicio sin pagar
 * (servidor: src/unpaidFingerprints.ts). No se bloquea: puede ser un vecino.
 */
export function UnpaidNearbyWarning({ show }: { show?: boolean }) {
  if (!show) return null;
  return (
    <View style={[styles.guideCard, styles.guideCardWarning]}>
      <Ionicons name="warning-outline" size={20} color={colors.textDark} />
      <Text style={[styles.itemText, styles.flex]}>
        Aviso: en esta ubicación quedó un servicio sin pagar de otra cuenta. Tú decides si la aceptas.
      </Text>
    </View>
  );
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * La solicitud entrante es lo más urgente del día del mecánico: antes solo
 * la veía si estaba parado en la pestaña Mapa. Esto la muestra a pantalla
 * completa esté donde esté, mientras esté conectado.
 */
export function IncomingRequestOverlay({ onRespond }: { onRespond: (action: 'accept' | 'reject') => void }) {
  const { user, mechanicConnection, incomingRequest, currentLocation, busy, setMessage } = useAppContext();
  const [minimizedRequestId, setMinimizedRequestId] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const alertedRequestId = useRef<number | null>(null);
  const holdTotalSeconds = useRef(HOLD_TOTAL_SECONDS_FALLBACK);

  const visible =
    user?.role === 'mechanic' &&
    mechanicConnection === 'online' &&
    incomingRequest != null &&
    incomingRequest.id !== minimizedRequestId;

  const expiresAt = parseServerTimestamp(incomingRequest?.holdExpiresAt);
  const secondsLeft = expiresAt !== null ? Math.max(0, Math.round((expiresAt - now) / 1000)) : null;

  useEffect(() => {
    if (!visible) {
      return;
    }
    const intervalId = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, [visible]);

  // Cuando la oferta desaparece (aceptada, rechazada o vencida), se olvida:
  // "Buscar de nuevo" puede volver a ofrecer la misma solicitud (mismo id)
  // más tarde, y tiene que volver a aparecer y vibrar.
  useEffect(() => {
    if (!incomingRequest) {
      setMinimizedRequestId(null);
      alertedRequestId.current = null;
    }
  }, [incomingRequest]);

  // Una vibración fuerte por cada solicitud nueva, no en cada refresco.
  useEffect(() => {
    if (!visible || !incomingRequest || alertedRequestId.current === incomingRequest.id) {
      return;
    }
    alertedRequestId.current = incomingRequest.id;
    holdTotalSeconds.current =
      expiresAt !== null ? Math.max(1, Math.round((expiresAt - Date.now()) / 1000)) : HOLD_TOTAL_SECONDS_FALLBACK;
    Vibration.vibrate([0, 500, 250, 500]);
  }, [visible, incomingRequest?.id]);

  // Si se acaba el tiempo, se cierra sola: el servidor ya se la ofrece a otro.
  useEffect(() => {
    if (visible && incomingRequest && secondsLeft === 0) {
      setMinimizedRequestId(incomingRequest.id);
      setMessage('Se venció el tiempo para responder esa solicitud.');
    }
  }, [visible, secondsLeft]);

  if (!incomingRequest) {
    return null;
  }

  const address = incomingRequest.serviceAddress || `${incomingRequest.city}, ${incomingRequest.zone}`;
  const distance =
    currentLocation && incomingRequest.latitude != null && incomingRequest.longitude != null
      ? distanceKm(currentLocation, { latitude: incomingRequest.latitude, longitude: incomingRequest.longitude })
      : null;
  const progress = secondsLeft !== null ? Math.min(1, secondsLeft / holdTotalSeconds.current) : 1;
  const minimize = () => setMinimizedRequestId(incomingRequest.id);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={minimize} statusBarTranslucent>
      <SafeAreaProvider>
        <SafeAreaView style={styles.incomingScreen}>
          <View style={styles.stack}>
            <View style={styles.incomingHeader}>
              <Ionicons name="notifications" size={28} color={colors.primary} />
              <Text style={styles.incomingTitle}>Nueva solicitud</Text>
            </View>
            {secondsLeft !== null && (
              <View style={styles.stack}>
                <Text style={styles.incomingCountdown}>Responde en {formatCountdown(secondsLeft)}</Text>
                <View style={styles.incomingTimerTrack}>
                  <View style={[styles.incomingTimerFill, { width: `${Math.round(progress * 100)}%` }]} />
                </View>
              </View>
            )}
          </View>

          <Card
            title={`${incomingRequest.vehicleMake} ${incomingRequest.vehicleModel} ${incomingRequest.vehicleYear}`}
            subtitle={incomingRequest.issueDescription}
          >
            <View style={styles.stack}>
              <View style={styles.incomingInfoRow}>
                <Ionicons name="location-outline" size={20} color={colors.primary} />
                <Text style={[styles.itemText, styles.flex]}>
                  {address}
                  {distance !== null ? ` · a ${distance.toFixed(1)} km de ti` : ''}
                </Text>
              </View>
              <View style={styles.incomingInfoRow}>
                <Ionicons name="time-outline" size={20} color={colors.primary} />
                <Text style={[styles.itemText, styles.flex]}>Para: {incomingRequest.preferredTime || 'Ahora'}</Text>
              </View>
              {incomingRequest.customerName ? (
                <View style={styles.incomingInfoRow}>
                  <Ionicons name="person-outline" size={20} color={colors.primary} />
                  <Text style={[styles.itemText, styles.flex]}>
                    {incomingRequest.customerName}
                    {customerHistoryText(incomingRequest.customerCompletedServices)}
                  </Text>
                </View>
              ) : null}
              <UnpaidNearbyWarning show={incomingRequest.unpaidNearby} />
              {/* Lo que cobra antes de decidir: el precio queda fijo al aceptar. */}
              {incomingRequest.visitFee ? (
                <View style={styles.incomingInfoRow}>
                  <Ionicons name="cash-outline" size={20} color={colors.primary} />
                  <Text style={[styles.itemText, styles.flex]}>
                    Cobras tu visita y diagnóstico: {formatPesos(incomingRequest.visitFee)}. La reparación la cotizas después.
                  </Text>
                </View>
              ) : null}
            </View>
          </Card>

          <View style={styles.stack}>
            <Pressable
              style={({ pressed }) => [styles.acceptButton, (pressed || busy) && styles.buttonPressed]}
              onPress={() => onRespond('accept')}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ busy, disabled: busy }}
            >
              {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.nextStepButtonText}>Aceptar</Text>}
            </Pressable>
            <SecondaryButton title="Rechazar" busy={busy} onPress={() => onRespond('reject')} />
            <Pressable onPress={minimize} style={styles.incomingLaterLink} accessibilityRole="button">
              <Text style={styles.incomingLaterText}>Ver después (sigue en Mapa hasta que venza)</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
