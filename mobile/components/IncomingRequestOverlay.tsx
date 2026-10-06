import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, Vibration, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Avatar, Card, SecondaryButton } from './ui';
import { distanceKm, formatPesos, parseServerTimestamp, vehicleText } from '../utils';
import { RequestPhotos } from './RequestPlace';
import { CountdownRing, RingingBell } from './CountdownRing';

const HOLD_TOTAL_SECONDS_FALLBACK = 120;

/**
 * Junto al nombre del cliente, antes de aceptar: " · ★ 4.8 (12) · 5 servicios
 * terminados", o " · Cliente nuevo".
 */
export function customerHistoryText(request: {
  customerCompletedServices?: number;
  customerRating?: { average: number | null; count: number };
}): string {
  const completed = request.customerCompletedServices;
  const rating = request.customerRating;
  const parts: string[] = [];
  if (rating && rating.count > 0 && rating.average != null) {
    parts.push(`★ ${rating.average.toFixed(1)} (${rating.count})`);
  }
  if (completed !== undefined && completed > 0) {
    parts.push(`${completed} servicio${completed === 1 ? '' : 's'} terminado${completed === 1 ? '' : 's'}`);
  }
  if (parts.length === 0 && completed !== undefined) {
    parts.push('Cliente nuevo');
  }
  return parts.map((part) => ` · ${part}`).join('');
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
  const minimize = () => setMinimizedRequestId(incomingRequest.id);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={minimize} statusBarTranslucent>
      <SafeAreaProvider>
        <SafeAreaView style={styles.incomingScreen}>
          <View style={styles.incomingHeader}>
            <View style={[styles.flex, styles.stack]}>
              <RingingBell>
                <Ionicons name="notifications" size={30} color={colors.primary} />
              </RingingBell>
              <Text style={styles.incomingTitle}>Nueva solicitud</Text>
            </View>
            {secondsLeft !== null && expiresAt !== null && (
              <CountdownRing expiresAt={expiresAt} totalSeconds={holdTotalSeconds.current} secondsLeft={secondsLeft} />
            )}
          </View>

          <Card
            title={vehicleText(incomingRequest)}
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
                  {incomingRequest.customerPhotoUrl ? (
                    <Avatar uri={incomingRequest.customerPhotoUrl} name={incomingRequest.customerName} size={28} />
                  ) : (
                    <Ionicons name="person-outline" size={20} color={colors.primary} />
                  )}
                  <Text style={[styles.itemText, styles.flex]}>
                    {incomingRequest.customerName}
                    {customerHistoryText(incomingRequest)}
                  </Text>
                </View>
              ) : null}
              <UnpaidNearbyWarning show={incomingRequest.unpaidNearby} />
              <RequestPhotos
                carPhotoUrl={incomingRequest.carPhotoUrl}
                spotPhotoUrl={incomingRequest.spotPhotoUrl}
                locationSource={incomingRequest.locationSource}
              />
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
