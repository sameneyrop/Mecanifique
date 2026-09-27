import { useEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { styles } from '../styles';
import type { ApiCall } from '../App';
import { Card, SecondaryButton } from './ui';
import { MechanicRadar } from './MechanicRadar';

// Seguimiento del mecánico para el cliente: mientras va en camino o fue por
// refacciones, su posición en el radar (con el auto al centro), a qué
// distancia está y hace cuánto llegó el último punto. El servidor solo la
// comparte en esos dos estados (src/tracking.ts).

type MechanicLocation = {
  tracking: boolean;
  status: string;
  mechanic: { latitude: number; longitude: number; secondsAgo: number | null } | null;
  service?: { latitude: number; longitude: number } | null;
  distanceKm?: number | null;
};

const TRACKING_STATUSES = new Set(['en_route', 'awaiting_parts']);
const REFRESH_MS = 10_000;

function formatSecondsAgo(seconds: number | null): string {
  if (seconds == null || seconds < 60) return 'hace unos segundos';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes === 1 ? 'hace 1 minuto' : `hace ${minutes} minutos`;
  return 'hace más de una hora';
}

function formatDistance(distanceKm: number): string {
  if (distanceKm < 1) return `${Math.max(50, Math.round(distanceKm * 20) * 50)} m`;
  return `${distanceKm.toFixed(1)} km`;
}

// Escala del radar: la más chica que deja al mecánico dentro. Múltiplos de 3
// para que los tres anillos queden en kilómetros enteros.
function radarScaleKm(distanceKm: number): number {
  return [3, 6, 15, 30, 60].find((km) => distanceKm <= km * 0.9) ?? Math.ceil(distanceKm / 3) * 3 + 3;
}

export function MechanicTracker({
  api,
  requestId,
  status,
  mechanicName,
}: {
  api: ApiCall;
  requestId: number;
  status: string;
  mechanicName?: string | null;
}) {
  const [location, setLocation] = useState<MechanicLocation | null>(null);
  const tracking = TRACKING_STATUSES.has(status);
  // api cambia en cada render de App; el sondeo no debe reiniciarse por eso.
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    if (!tracking) {
      setLocation(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      apiRef.current<MechanicLocation>(`/api/service-requests/${requestId}/mechanic-location`)
        .then((data) => {
          if (!cancelled) setLocation(data);
        })
        .catch(() => undefined);
    };
    load();
    const intervalId = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [requestId, tracking]);

  if (!tracking) {
    return null;
  }

  const name = mechanicName || 'Tu mecánico';
  const mechanic = location?.mechanic ?? null;
  const distanceKm = location?.distanceKm ?? null;
  const title = status === 'en_route' ? `${name} va en camino` : `${name} fue por refacciones`;
  const subtitle = !location
    ? 'Buscando su ubicación…'
    : !mechanic
      ? 'Todavía no recibimos su ubicación. Aparecerá aquí en cuanto la comparta.'
      : `${distanceKm != null ? `A ${formatDistance(distanceKm)} de tu auto · ` : ''}Actualizado ${formatSecondsAgo(mechanic.secondsAgo)}`;

  return (
    <Card title={title} subtitle={subtitle}>
      <View style={styles.stack}>
        {mechanic && location?.service && distanceKm != null ? (
          <>
            <MechanicRadar
              userLocation={location.service}
              mechanics={[
                { id: requestId, fullName: name, latitude: mechanic.latitude, longitude: mechanic.longitude, distanceKm },
              ]}
              maxDistanceKm={radarScaleKm(distanceKm)}
            />
            <Text style={styles.smallText}>El punto oscuro es tu auto; el azul, tu mecánico. Se actualiza solo.</Text>
          </>
        ) : null}
        {mechanic ? (
          <SecondaryButton
            title="Ver en Google Maps"
            onPress={() =>
              void Linking.openURL(
                `https://www.google.com/maps/search/?api=1&query=${mechanic.latitude},${mechanic.longitude}`,
              )
            }
          />
        ) : null}
      </View>
    </Card>
  );
}
