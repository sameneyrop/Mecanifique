import Constants from 'expo-constants';
import { Image, Text, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';

import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, PrimaryButton, SecondaryButton } from '../components/ui';

const ILLUST_FIRST_REQUEST = require('../assets/illust-first-request.png');
const ILLUST_NEW_REQUEST = require('../assets/illust-new-request.png');

const GOOGLE_MAPS_API_KEY = Constants.expoConfig?.android?.config?.googleMaps?.apiKey;
const isMapConfigured = Boolean(GOOGLE_MAPS_API_KEY);

const DEFAULT_REGION: Region = {
  latitude: 21.8818,
  longitude: -102.2916,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};

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

  function getMapRegion(): Region {
    if (
      incomingRequest?.latitude !== null &&
      incomingRequest?.latitude !== undefined &&
      incomingRequest.longitude !== null &&
      incomingRequest.longitude !== undefined
    ) {
      return {
        latitude: incomingRequest.latitude,
        longitude: incomingRequest.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
    }

    if (currentLocation) {
      return {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      };
    }

    if (
      selectedRequest?.latitude !== null &&
      selectedRequest?.latitude !== undefined &&
      selectedRequest.longitude !== null &&
      selectedRequest.longitude !== undefined
    ) {
      return {
        latitude: selectedRequest.latitude,
        longitude: selectedRequest.longitude,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      };
    }

    return DEFAULT_REGION;
  }

  return (
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
            <View style={styles.row}>
              <PrimaryButton title="Aceptar" onPress={() => onRespondToIncoming('accept')} />
              <SecondaryButton title="Rechazar" busy={busy} onPress={() => onRespondToIncoming('reject')} />
            </View>
          </View>
        )}
        {user.role === 'mechanic' && mechanicConnection === 'online' && !incomingRequest && (
          <View style={styles.emptyStateWrap}>
            <Image source={ILLUST_NEW_REQUEST} resizeMode="cover" style={styles.cardIllustration} />
            <Text style={styles.itemText}>Estás en línea. Te avisamos en cuanto llegue una solicitud.</Text>
          </View>
        )}
        <Text style={styles.smallText}>
          {currentLocation ? 'La ubicación ya está lista.' : 'Pulsa el botón para obtener tu ubicación y ver cercanos.'}
        </Text>
        <Text style={styles.smallText}>
          Refresco automático cada 10 segundos.
        </Text>
        <View style={[styles.mapContainer, user.role === 'mechanic' && incomingRequest ? styles.mapContainerCompact : null]}>
          {isMapConfigured ? (
            <MapView
              style={[styles.map, user.role === 'mechanic' && incomingRequest ? styles.mapCompact : null]}
              initialRegion={getMapRegion()}
              region={getMapRegion()}
            >
              {currentLocation && (
                <Marker
                  coordinate={currentLocation}
                  title="Tú"
                  description="Tu ubicación actual"
                  pinColor="#2563eb"
                />
              )}
              {user.role === 'mechanic' &&
                incomingRequest?.latitude !== null &&
                incomingRequest?.latitude !== undefined &&
                incomingRequest.longitude !== null &&
                incomingRequest.longitude !== undefined && (
                  <Marker
                    coordinate={{
                      latitude: incomingRequest.latitude,
                      longitude: incomingRequest.longitude,
                    }}
                    title={`Entrante #${incomingRequest.id}`}
                    description={incomingRequest.issueDescription}
                    pinColor="#f59e0b"
                  />
                )}
              {selectedRequest?.latitude !== null &&
                selectedRequest?.latitude !== undefined &&
                selectedRequest.longitude !== null &&
                selectedRequest.longitude !== undefined && (
                  <Marker
                    coordinate={{
                      latitude: selectedRequest.latitude,
                      longitude: selectedRequest.longitude,
                    }}
                    title={`Solicitud #${selectedRequest.id}`}
                    description={selectedRequest.issueDescription}
                    pinColor="#f97316"
                  />
                )}
              {user.role !== 'mechanic' &&
                nearbyMechanics
                  .filter(
                    (mechanic) =>
                      mechanic.latitude !== null &&
                      mechanic.latitude !== undefined &&
                      mechanic.longitude !== null &&
                      mechanic.longitude !== undefined
                  )
                  .map((mechanic) => (
                    <Marker
                      key={`nearby-${mechanic.id}`}
                      coordinate={{
                        latitude: mechanic.latitude as number,
                        longitude: mechanic.longitude as number,
                      }}
                      title={mechanic.fullName}
                      description={`${mechanic.distanceKm?.toFixed(1) || '?'} km · ${mechanic.zone}`}
                    />
                  ))}
            </MapView>
          ) : (
            <View style={styles.mapUnavailable}>
              <Text style={styles.itemText}>Mapa no configurado todavía.</Text>
              <Text style={styles.smallText}>Puedes usar la ubicación y las solicitudes mientras se configura Google Maps.</Text>
            </View>
          )}
        </View>
        {user.role !== 'mechanic' && (
          nearbyMechanics.length === 0 ? (
            <Text style={styles.itemText}>Aún no hay resultados cercanos.</Text>
          ) : (
            <Text style={styles.smallText}>Mostrando {nearbyMechanics.length} mecánicos cercanos en el mapa.</Text>
          )
        )}
      </View>
    </Card>
  );
}
