import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card } from '../components/ui';

const ILLUST_HOME_HERO = require('../assets/illust-home-hero.png');
const ILLUST_PROFILE_REVIEW = require('../assets/illust-profile-review.png');

type MechanicReview = {
  id: number;
  customerUserId: number;
  customerName: string;
  rating: number;
  comment: string;
  createdAt: string;
};

export function HomeScreen({
  mechanicCursor,
  selectedMechanicReviews,
  mechanicReviewsExpanded,
  setMechanicReviewsExpanded,
  onToggleMechanicConnection,
}: {
  mechanicCursor: number;
  selectedMechanicReviews: MechanicReview[];
  mechanicReviewsExpanded: boolean;
  setMechanicReviewsExpanded: (updater: (prev: boolean) => boolean) => void;
  onToggleMechanicConnection: (next: 'online' | 'offline') => void;
}) {
  const {
    user,
    setCurrentScreen,
    mechanics,
    myRequests,
    mechanicConnection,
  } = useAppContext();

  const liveLocationRequest = useMemo(
    () =>
      user?.role === 'mechanic'
        ? myRequests.find((request) => request.status !== 'completed' && request.status !== 'cancelled')
        : undefined,
    [myRequests, user?.role],
  );

  if (!user) {
    return null;
  }

  return (
    <>
      <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
        <Text style={styles.heroSubtitle}>Mecánicos verificados, cuando quieras y donde quieras.</Text>
        <Image source={ILLUST_HOME_HERO} resizeMode="cover" style={styles.homeHeroImage} />
        {user.role !== 'mechanic' && (
          <Pressable style={styles.heroButton} onPress={() => setCurrentScreen('mechanics')}>
            <Text style={styles.heroButtonText}>Buscar mecánicos</Text>
          </Pressable>
        )}
      </Animated.View>

      {user.role !== 'mechanic' && mechanics.length > 0 && (
        <Animated.View entering={FadeInDown.delay(90).duration(300)} needsOffscreenAlphaCompositing>
        <Card title="Mecánicos destacados" subtitle="Perfil público, comentarios y disponibilidad">
          <Image source={ILLUST_PROFILE_REVIEW} resizeMode="cover" style={styles.cardIllustration} />
          {mechanics.slice(mechanicCursor, mechanicCursor + 1).map((mechanic) => (
            <View key={mechanic.id} style={styles.stack}>
              <View style={styles.locationPill}>
                <Text style={styles.locationPin}>📍</Text>
                <Text style={styles.locationText}>{mechanic.city} {mechanic.zone}</Text>
              </View>
              <View style={styles.profileCard}>
                {mechanic.coverPhotoUrl ? (
                  <Image
                    source={{ uri: mechanic.coverPhotoUrl }}
                    style={styles.avatarCircle}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.avatarCircle}>
                    <Ionicons name="person" size={28} color={colors.textSecondary} />
                  </View>
                )}
                <View style={styles.profileBody}>
                  <Text style={styles.profileName}>{mechanic.fullName}</Text>
                  <Text style={styles.profileMeta}>{mechanic.specialties.join(', ')}</Text>
                  <View style={styles.starsRow}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Ionicons
                        key={star}
                        name={star <= Math.round(mechanic.rating) ? 'star' : 'star-outline'}
                        size={16}
                        color={colors.accent}
                      />
                    ))}
                    <Text style={styles.profileMeta}> {mechanic.reviewCount || 0} reseñas</Text>
                  </View>
                </View>
              </View>
              <View style={styles.publicProfileBox}>
                <Text style={styles.publicProfileTitle}>
                  Comentarios {selectedMechanicReviews.length > 0 ? `(${selectedMechanicReviews.length})` : ''}
                </Text>
                {selectedMechanicReviews.length === 0 ? (
                  <Text style={styles.smallText}>Aún no hay comentarios.</Text>
                ) : (
                  <Pressable onPress={() => setMechanicReviewsExpanded((prev) => !prev)}>
                    {(mechanicReviewsExpanded
                      ? selectedMechanicReviews
                      : selectedMechanicReviews.slice(0, 1)
                    ).map((review) => (
                      <Text
                        key={review.id}
                        numberOfLines={mechanicReviewsExpanded ? undefined : 3}
                        style={styles.smallText}
                      >
                        {review.customerName}: {review.comment}
                      </Text>
                    ))}
                    {selectedMechanicReviews.length > 1 && (
                      <View style={styles.expandRow}>
                        <Text style={styles.expandLabel}>
                          {mechanicReviewsExpanded ? 'Ver menos' : 'Ver más'}
                        </Text>
                        <Ionicons
                          name={mechanicReviewsExpanded ? 'chevron-up' : 'chevron-down'}
                          size={14}
                          color={colors.primary}
                        />
                      </View>
                    )}
                  </Pressable>
                )}
              </View>
            </View>
          ))}
        </Card>
        </Animated.View>
      )}

      {user.role === 'mechanic' && (
        <Animated.View entering={FadeInDown.delay(90).duration(300)} needsOffscreenAlphaCompositing>
        <Card
          title="Modo conductor mecánico"
          subtitle={
            liveLocationRequest
              ? `Compartiendo ubicación durante la solicitud #${liveLocationRequest.id}.`
              : 'Tu ubicación solo se comparte mientras tienes un servicio activo.'
          }
        >
          <Pressable
            style={[styles.connectionButton, mechanicConnection === 'online' ? styles.connectionOn : styles.connectionOff]}
            onPress={() => onToggleMechanicConnection(mechanicConnection === 'online' ? 'offline' : 'online')}
          >
            <Text style={styles.connectionButtonText}>
              {mechanicConnection === 'online' ? 'DESCONECTARME' : 'CONECTARME'}
            </Text>
          </Pressable>
        </Card>
        </Animated.View>
      )}
    </>
  );
}