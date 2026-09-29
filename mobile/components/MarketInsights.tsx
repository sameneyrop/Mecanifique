import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { styles } from '../styles';
import { Card, SecondaryButton } from './ui';
import { formatPesos } from '../utils';
import type { ApiCall } from '../App';

/**
 * Datos del mercado para el mecánico (servidor: src/marketInsights.ts),
 * siempre agregados: el precio de visita que se paga en su ciudad y las
 * tendencias de solicitudes.
 */

type RateSuggestionData = {
  source: 'services' | 'profiles';
  city: string | null;
  count: number;
  low: number;
  median: number;
  high: number;
};

type Trends = {
  city: string | null;
  lastHour: number;
  waiting: number;
  total: number;
  byHour: number[];
  byZone: Array<{ zone: string; count: number }>;
};

/** Menos de esto en 30 días no alcanza para hablar de "tendencia". */
const MIN_TREND_REQUESTS = 5;

/** App crea `api` en cada render: se guarda en un ref para no volver a pedir datos. */
function useStableApi(api: ApiCall) {
  const ref = useRef(api);
  ref.current = api;
  return ref;
}

/** Junto al campo del precio de visita: qué se cobra en su ciudad, con "Usar $X". */
export function RateSuggestion({ api, onUse }: { api: ApiCall; onUse?: (value: string) => void }) {
  const apiRef = useStableApi(api);
  const [suggestion, setSuggestion] = useState<RateSuggestionData | null>(null);

  useEffect(() => {
    apiRef.current<{ suggestion: RateSuggestionData | null }>('/api/mechanics/me/rate-suggestion')
      .then((data) => setSuggestion(data.suggestion))
      .catch(() => undefined);
  }, [apiRef]);

  if (!suggestion) {
    return null;
  }

  const place = suggestion.city ? `En ${suggestion.city}` : 'En Mecanifique';
  const range = `entre ${formatPesos(suggestion.low)} y ${formatPesos(suggestion.high)}`;
  const text =
    suggestion.source === 'services'
      ? `${place}, la mayoría de las visitas se han pagado ${range}; el precio medio es ${formatPesos(suggestion.median)} (según ${suggestion.count} servicios terminados).`
      : `${place}, la mayoría de los mecánicos cobra ${range} por la visita; el precio medio es ${formatPesos(suggestion.median)} (${suggestion.count} mecánicos).`;

  return (
    <View style={styles.publicProfileBox}>
      <Text style={styles.itemText}>{text}</Text>
      {!suggestion.city && (
        <Text style={styles.smallText}>Todavía hay pocos datos de tu ciudad; esto es de toda la app.</Text>
      )}
      <Text style={styles.smallText}>Es solo una referencia: tú decides tu precio.</Text>
      {onUse && (
        <SecondaryButton title={`Usar ${formatPesos(suggestion.median)}`} compact onPress={() => onUse(String(suggestion.median))} />
      )}
    </View>
  );
}

function hourLabel(hour: number): string {
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'a. m.' : 'p. m.'}`;
}

/** Mapa del mecánico: solicitudes ahora, por hora del día y por zona, en su ciudad. */
export function TrendsCard({ api }: { api: ApiCall }) {
  const apiRef = useStableApi(api);
  const [trends, setTrends] = useState<Trends | null>(null);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiRef.current<{ trends: Trends }>('/api/mechanics/me/trends')
        .then((data) => {
          if (!cancelled) setTrends(data.trends);
        })
        .catch(() => undefined);
    void load();
    // "En tiempo real": se refresca cada minuto mientras está en pantalla.
    const intervalId = setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [apiRef]);

  if (!trends) {
    return null;
  }

  const nowHour = new Date().getHours();
  const maxHour = Math.max(1, ...trends.byHour);
  const peakHour = trends.byHour.indexOf(Math.max(...trends.byHour));
  const maxZone = Math.max(1, ...trends.byZone.map((zone) => zone.count));
  const enough = trends.total >= MIN_TREND_REQUESTS;
  const shownHour = selectedHour ?? peakHour;

  return (
    <Card
      title={`Tendencias${trends.city ? ` en ${trends.city}` : ''}`}
      subtitle="Cuándo y dónde piden más mecánicos. Se actualiza cada minuto."
    >
      <View style={styles.stack}>
        <View style={styles.trendTiles}>
          <View style={styles.trendTile}>
            <Text style={styles.trendValue}>{trends.lastHour}</Text>
            <Text style={styles.trendLabel}>solicitudes en la última hora</Text>
          </View>
          <View style={styles.trendTile}>
            <Text style={styles.trendValue}>{trends.waiting}</Text>
            <Text style={styles.trendLabel}>buscando mecánico ahora</Text>
          </View>
        </View>

        {!enough ? (
          <Text style={styles.smallText}>
            Todavía hay pocas solicitudes en tu ciudad para ver tendencias. Conforme lleguen más, aquí verás a qué hora y
            en qué zonas piden más.
          </Text>
        ) : (
          <>
            <Text style={styles.itemTitle}>¿A qué hora piden más?</Text>
            <Text style={styles.smallText}>
              {selectedHour === null ? 'La hora con más solicitudes: ' : ''}
              {hourLabel(shownHour)} a {hourLabel((shownHour + 1) % 24)}: {trends.byHour[shownHour]} solicitud
              {trends.byHour[shownHour] === 1 ? '' : 'es'} en 30 días
            </Text>
            <View style={styles.trendChart} accessibilityLabel="Solicitudes por hora del día">
              {trends.byHour.map((count, hour) => (
                <Pressable
                  key={hour}
                  style={styles.trendBarSlot}
                  onPress={() => setSelectedHour(hour === selectedHour ? null : hour)}
                  accessibilityRole="button"
                  accessibilityLabel={`${hourLabel(hour)}: ${count} solicitudes`}
                  hitSlop={{ top: 8, bottom: 8 }}
                >
                  {hour === nowHour && <Text style={styles.trendNowLabel}>Ahora</Text>}
                  <View
                    style={[
                      styles.trendBar,
                      hour === nowHour && styles.trendBarNow,
                      hour === selectedHour && styles.trendBarSelected,
                      { height: count === 0 ? 2 : Math.max(4, (count / maxHour) * 96) },
                    ]}
                  />
                </Pressable>
              ))}
            </View>
            <View style={styles.trendAxis}>
              {[0, 6, 12, 18].map((hour) => (
                <Text key={hour} style={styles.trendAxisLabel}>
                  {hourLabel(hour)}
                </Text>
              ))}
            </View>

            {trends.byZone.length > 0 && (
              <>
                <Text style={styles.itemTitle}>¿En qué zonas piden más?</Text>
                {trends.byZone.map((zone) => (
                  <View key={zone.zone} style={styles.trendZoneRow}>
                    <View style={styles.trendZoneHeader}>
                      <Text style={[styles.itemText, styles.flex]} numberOfLines={1}>
                        {zone.zone}
                      </Text>
                      <Text style={styles.smallText}>{zone.count}</Text>
                    </View>
                    <View style={styles.trendZoneTrack}>
                      <View style={[styles.trendZoneFill, { width: `${(zone.count / maxZone) * 100}%` }]} />
                    </View>
                  </View>
                ))}
              </>
            )}
            <Text style={styles.smallText}>Últimos 30 días, {trends.total} solicitudes en total.</Text>
          </>
        )}
      </View>
    </Card>
  );
}
