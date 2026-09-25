import { Image, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, PrimaryButton, SecondaryButton } from '../components/ui';
import { MechanicRadar } from '../components/MechanicRadar';
import { openExternalNavigation } from '../utils';

const ILLUST_FIRST_REQUEST = require('../assets/illust-first-request.png');
const ILLUST_NEW_REQUEST = require('../assets/illust-new-request.png');
const ILLUST_SEARCH = require('../assets/illust-search.png');

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
  } = useAppContext();

  if (!user) {
    return null;
  }

  const activeJobHasLocation =
    selectedRequest?.latitude != null &&
    selectedRequest?.longitude != null &&
    selectedRequest.status !== 'completed' &&
    selectedRequest.status !== 'cancelled';

  return (
    <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
      <Card
        title={user.role === 'mechanic' ? 'Solicitud entrante' : 'Mecánicos cercanos'}
        subtitle={user.role === 'mechanic' ? 'Vista privada del mecánico' : 'Calculado por GPS'}
      >
        <View style={styles.stack}>
          {user.role === 'mechanic' && mechanicConnection === 'online' && incomingRequest && (
            <View style={styles.item}>
              <Image source={ILLUST_FIRST_REQUEST} resizeMode="cover" style={styles.cardIllustration} />
              <Text style={styles.itemTitle}>Solicitud entrante #{incomingRequest.id}</Text>
              <Text style={styles.itemText}>
                Cliente: {incomingRequest.customerName || 'N/D'} · {incomingRequest.customerPhone || 'N/D'}
              </Text>
              <Text numberOfLines={2} style={styles.smallText}>{incomingRequest.issueDescription}</Text>
              {incomingRequest.holdExpiresAt && (
                <Text style={styles.smallText}>Hold hasta: {incomingRequest.holdExpiresAt}</Text>
              )}
              {incomingRequest.latitude != null && incomingRequest.longitude != null && (
                <SecondaryButton
                  title="Cómo llegar"
                  onPress={() =>
                    openExternalNavigation(
                      incomingRequest.latitude as number,
                      incomingRequest.longitude as number,
                      incomingRequest.customerName || undefined,
                    )
                  }
                />
              )}
              <View style={styles.row}>
                <PrimaryButton title="Aceptar" onPress={() => onRespondToIncoming('accept')} />
                <SecondaryButton title="Rechazar" busy={busy} onPress={() => onRespondToIncoming('reject')} />
              </View>
            </View>
          )}
          {user.role === 'mechanic' && mechanicConnection === 'online' && !incomingRequest && !activeJobHasLocation && (
            <View style={styles.emptyStateWrap}>
              <Image source={ILLUST_NEW_REQUEST} resizeMode="cover" style={styles.cardIllustration} />
              <Text style={styles.itemText}>Estás en línea. Te avisamos en cuanto llegue una solicitud.</Text>
            </View>
          )}
          {user.role === 'mechanic' && activeJobHasLocation && (
            <View style={styles.item}>
              <Text style={styles.itemTitle}>Servicio en curso #{selectedRequest!.id}</Text>
              <Text numberOfLines={2} style={styles.smallText}>
                {selectedRequest!.serviceAddress || `${selectedRequest!.city}, ${selectedRequest!.zone}`}
              </Text>
              <SecondaryButton
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
          {user.role === 'mechanic' && mechanicConnection !== 'online' && (
            <Text style={styles.itemText}>Conéctate desde Inicio para recibir solicitudes.</Text>
          )}

          {user.role !== 'mechanic' && (
            <>
              {!currentLocation && (
                <Text style={styles.smallText}>Buscando tu ubicación para mostrar mecánicos cercanos...</Text>
              )}
              {currentLocation && nearbyMechanics.length > 0 && (
                <MechanicRadar userLocation={currentLocation} mechanics={nearbyMechanics} maxDistanceKm={25} />
              )}
              {nearbyMechanics.length === 0 ? (
                <View style={styles.emptyStateWrap}>
                  <Image source={ILLUST_SEARCH} resizeMode="cover" style={styles.cardIllustration} />
                  <Text style={styles.itemText}>Aún no hay resultados cercanos.</Text>
                </View>
              ) : (
                <View style={styles.list}>
                  {nearbyMechanics.map((mechanic) => (
                    <View key={`nearby-${mechanic.id}`} style={styles.item}>
                      <Text style={styles.itemTitle}>{mechanic.fullName}</Text>
                      <Text style={styles.itemText}>
                        {mechanic.distanceKm?.toFixed(1) ?? '?'} km · {mechanic.zone}, {mechanic.city}
                      </Text>
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
            </>
          )}
        </View>
      </Card>
    </Animated.View>
  );
}
