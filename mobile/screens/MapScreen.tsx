import { Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, EmptyState, InfoRow, PrimaryButton, SecondaryButton } from '../components/ui';
import { MechanicRadar } from '../components/MechanicRadar';
import { openExternalNavigation, parseServerTimestamp } from '../utils';

export function MapScreen({
  onRespondToIncoming,
}: {
  onRespondToIncoming: (action: 'accept' | 'reject') => void;
}) {
  const {
    user,
    busy,
    mechanicConnection,
    incomingRequest,
    currentLocation,
    selectedRequest,
    nearbyMechanics,
    setCurrentScreen,
  } = useAppContext();

  if (!user) {
    return null;
  }

  const activeJobHasLocation =
    selectedRequest?.latitude != null &&
    selectedRequest?.longitude != null &&
    selectedRequest.status !== 'completed' &&
    selectedRequest.status !== 'cancelled';

  if (user.role === 'mechanic') {
    const holdUntil = parseServerTimestamp(incomingRequest?.holdExpiresAt);
    const holdTime = holdUntil
      ? `${String(new Date(holdUntil).getHours()).padStart(2, '0')}:${String(new Date(holdUntil).getMinutes()).padStart(2, '0')}`
      : null;
    return (
      <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
        <Card title="En este momento" subtitle="Solicitudes que te llegan y el trabajo que tienes en curso.">
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
                <InfoRow icon="person-outline" text={incomingRequest.customerName || 'Cliente'} />
                <InfoRow icon="construct-outline" text={incomingRequest.issueDescription} lines={2} />
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
    );
  }

  return (
    <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
      <Card
        title="Mecánicos cerca de ti"
        subtitle={
          currentLocation
            ? 'Conectados ahora, a menos de 25 km de tu ubicación.'
            : 'Buscando tu ubicación para mostrarte mecánicos cercanos…'
        }
      >
        <View style={styles.stack}>
          {currentLocation && nearbyMechanics.length > 0 && (
            <MechanicRadar userLocation={currentLocation} mechanics={nearbyMechanics} maxDistanceKm={25} />
          )}
          {nearbyMechanics.length === 0 ? (
            <EmptyState
              icon="map-outline"
              title="Nadie conectado cerca todavía"
              text="Puedes pedir un servicio de todos modos: te avisamos en cuanto un mecánico lo tome."
            >
              <PrimaryButton title="Pedir un mecánico" onPress={() => setCurrentScreen('home')} />
            </EmptyState>
          ) : (
            <View style={styles.list}>
              {nearbyMechanics.map((mechanic) => (
                <View key={`nearby-${mechanic.id}`} style={styles.item}>
                  <View style={styles.itemHeader}>
                    <View style={styles.itemIcon}>
                      <Ionicons name="person-outline" size={20} color={colors.primary} />
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.itemTitle}>{mechanic.fullName}</Text>
                      <Text style={styles.smallText}>
                        a {mechanic.distanceKm?.toFixed(1) ?? '?'} km · {mechanic.zone}, {mechanic.city}
                      </Text>
                    </View>
                  </View>
                  {mechanic.latitude != null && mechanic.longitude != null && (
                    <SecondaryButton
                      title="Cómo llegar"
                      compact
                      onPress={() => openExternalNavigation(mechanic.latitude as number, mechanic.longitude as number, mechanic.fullName)}
                    />
                  )}
                </View>
              ))}
            </View>
          )}
        </View>
      </Card>
    </Animated.View>
  );
}
