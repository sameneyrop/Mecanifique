import { Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, EmptyState, InfoRow, PrimaryButton, SecondaryButton } from '../components/ui';
import { UnpaidNearbyWarning, customerHistoryText } from '../components/IncomingRequestOverlay';
import { TrendsCard } from '../components/MarketInsights';
import { PartsStoreFinder } from '../components/PartsStoreFinder';
import type { ApiCall } from '../App';
import { ILLUSTRATIONS } from '../illustrations';
import { openExternalNavigation, parseServerTimestamp } from '../utils';

export function MapScreen({
  api,
  onRespondToIncoming,
}: {
  api: ApiCall;
  onRespondToIncoming: (action: 'accept' | 'reject') => void;
}) {
  const {
    user,
    busy,
    mechanicConnection,
    incomingRequest,
    selectedRequest,
    currentLocation,
    setCurrentScreen,
  } = useAppContext();

  // Solo el mecánico tiene Mapa; al cliente el radar de cercanos se le
  // muestra en Mecánicos.
  if (!user || user.role !== 'mechanic') {
    return null;
  }

  const activeJobHasLocation =
    selectedRequest?.latitude != null &&
    selectedRequest?.longitude != null &&
    selectedRequest.status !== 'completed' &&
    selectedRequest.status !== 'cancelled';

  const holdUntil = parseServerTimestamp(incomingRequest?.holdExpiresAt);
  const holdTime = holdUntil
    ? `${String(new Date(holdUntil).getHours()).padStart(2, '0')}:${String(new Date(holdUntil).getMinutes()).padStart(2, '0')}`
    : null;

  return (
    <>
    <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
      <Card title="En este momento">
        <View style={styles.stack}>
          {mechanicConnection === 'online' && incomingRequest && (
            <View style={styles.item}>
              <View style={styles.itemHeader}>
                <View style={styles.itemIcon}>
                  <Ionicons name="notifications-outline" size={20} color={colors.primary} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.itemTitle}>Solicitud nueva</Text>
                  <Text style={styles.smallText}>
                    {holdTime ? `Responde antes de las ${holdTime}` : `Solicitud #${incomingRequest.id}`}
                  </Text>
                </View>
              </View>
              <InfoRow
                icon="person-outline"
                text={`${incomingRequest.customerName || 'Cliente'}${customerHistoryText(incomingRequest)}`}
              />
              <InfoRow icon="construct-outline" text={incomingRequest.issueDescription} lines={2} />
              <UnpaidNearbyWarning show={incomingRequest.unpaidNearby} />
              {incomingRequest.latitude != null && incomingRequest.longitude != null && (
                <SecondaryButton
                  title="Cómo llegar"
                  compact
                  onPress={() =>
                    openExternalNavigation(
                      incomingRequest.latitude as number,
                      incomingRequest.longitude as number,
                      incomingRequest.customerName || undefined,
                    )
                  }
                />
              )}
              <SecondaryButton title="Rechazar" busy={busy} onPress={() => onRespondToIncoming('reject')} />
              <PrimaryButton title="Aceptar" onPress={() => onRespondToIncoming('accept')} />
            </View>
          )}
          {activeJobHasLocation && (
            <View style={styles.item}>
              <View style={styles.itemHeader}>
                <View style={styles.itemIcon}>
                  <Ionicons name="navigate-outline" size={20} color={colors.primary} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.itemTitle}>Trabajo en curso</Text>
                  <Text style={styles.smallText}>Solicitud #{selectedRequest!.id}</Text>
                </View>
              </View>
              <InfoRow
                icon="location-outline"
                text={selectedRequest!.serviceAddress || `${selectedRequest!.city}, ${selectedRequest!.zone}`}
                lines={2}
              />
              <PrimaryButton
                title="Cómo llegar"
                onPress={() =>
                  openExternalNavigation(
                    selectedRequest!.latitude as number,
                    selectedRequest!.longitude as number,
                    selectedRequest!.serviceAddress || undefined,
                  )
                }
              />
            </View>
          )}
          {mechanicConnection === 'online' && !incomingRequest && !activeJobHasLocation && (
            <EmptyState
              icon="radio-outline"
              image={ILLUSTRATIONS.newRequest}
              title="Estás conectado"
              text="Te avisamos en cuanto llegue una solicitud cerca de ti."
            />
          )}
          {mechanicConnection !== 'online' && !activeJobHasLocation && (
            <EmptyState
              icon="power-outline"
              title="Estás desconectado"
              text="Conéctate desde Inicio para empezar a recibir solicitudes."
            >
              <PrimaryButton title="Ir a Inicio" onPress={() => setCurrentScreen('home')} />
            </EmptyState>
          )}
        </View>
      </Card>
    </Animated.View>
    <Animated.View entering={FadeInDown.delay(80).duration(300)} needsOffscreenAlphaCompositing>
      <TrendsCard api={api} />
    </Animated.View>
    <Animated.View entering={FadeInDown.delay(160).duration(300)} needsOffscreenAlphaCompositing>
      <PartsStoreFinder api={api} near={currentLocation} />
    </Animated.View>
    </>
  );
}
