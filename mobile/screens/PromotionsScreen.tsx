import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, EmptyState, InfoRow, SecondaryButton } from '../components/ui';
import { formatDateOnly, formatError } from '../utils';
import type { ApiCall } from '../App';

export type Promotion = {
  id: number;
  title: string;
  description: string;
  validUntil: string | null;
  mechanicId: number;
  mechanicName: string;
  city: string;
  zone: string;
  rating: number;
  distanceKm: number | null;
};

/** Una promoción, tal como la ve un cliente. */
export function PromotionItem({
  promotion,
  onOpenMechanic,
}: {
  promotion: Promotion;
  onOpenMechanic?: (mechanicId: number) => void;
}) {
  return (
    <View style={styles.item}>
      <View style={styles.itemHeader}>
        <View style={styles.itemIcon}>
          <Ionicons name="pricetag-outline" size={20} color={colors.primary} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.itemTitle}>{promotion.title}</Text>
          <Text style={styles.smallText}>
            {promotion.mechanicName} ·{' '}
            {promotion.distanceKm != null ? `a ${promotion.distanceKm.toFixed(1)} km` : `${promotion.zone}, ${promotion.city}`}
          </Text>
        </View>
      </View>
      <Text style={styles.itemText}>{promotion.description}</Text>
      <InfoRow
        icon="calendar-outline"
        text={promotion.validUntil ? `Válida hasta el ${formatDateOnly(promotion.validUntil)}` : 'Sin fecha límite'}
      />
      {onOpenMechanic && (
        <SecondaryButton title="Ver al mecánico" compact onPress={() => onOpenMechanic(promotion.mechanicId)} />
      )}
    </View>
  );
}

export function PromotionsScreen({ api, onOpenMechanic }: { api: ApiCall; onOpenMechanic: (mechanicId: number) => void }) {
  const { currentLocation, setMessage } = useAppContext();
  const [promotions, setPromotions] = useState<Promotion[] | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (currentLocation) {
      params.set('latitude', String(currentLocation.latitude));
      params.set('longitude', String(currentLocation.longitude));
    }
    api<{ promotions: Promotion[] }>(`/api/promotions${params.toString() ? `?${params.toString()}` : ''}`)
      .then((data) => setPromotions(data.promotions))
      .catch((error) => setMessage(formatError(error)));
  }, [currentLocation?.latitude, currentLocation?.longitude]);

  return (
    <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
      <Card
        title="Promociones de mecánicos"
        subtitle={currentLocation ? undefined : 'Activa tu ubicación para verlas por cercanía.'}
      >
        {promotions === null ? (
          <ActivityIndicator color={colors.primary} />
        ) : promotions.length === 0 ? (
          <EmptyState
            icon="pricetag-outline"
            title="Sin promociones por ahora"
            text="Cuando los mecánicos publiquen ofertas, las verás aquí."
          />
        ) : (
          <View style={styles.list}>
            {promotions.map((promotion) => (
              <PromotionItem key={promotion.id} promotion={promotion} onOpenMechanic={onOpenMechanic} />
            ))}
          </View>
        )}
      </Card>
    </Animated.View>
  );
}
