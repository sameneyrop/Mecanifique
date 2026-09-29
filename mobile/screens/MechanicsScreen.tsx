import { type Dispatch, type SetStateAction, useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Avatar, Card, EmptyState, Field, InfoRow, Input, PrimaryButton, SecondaryButton } from '../components/ui';
import { MechanicRadar } from '../components/MechanicRadar';
import { ILLUSTRATIONS } from '../illustrations';
import { PromotionItem, type Promotion } from './PromotionsScreen';
import type { ApiCall } from '../App';
import { formatError, formatPesos, getMechanicPublicStatus, formatCalendarDate } from '../utils';

type ScheduleSlot = {
  id: number;
  mechanicId: number;
  slotDate: string;
  startTime: string;
  endTime: string;
  status: string;
  serviceRequestId?: number | null;
  note?: string | null;
};

type MechanicReview = {
  id: number;
  customerUserId: number;
  customerName: string;
  rating: number;
  comment: string;
  createdAt: string;
};

type RequestFormShape = {
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: string;
  issueDescription: string;
  preferredTime: string;
  city: string;
  zone: string;
  serviceAddress: string;
  customerId: string;
  requestedMechanicId: string;
  scheduleSlotId: string;
  latitude: string;
  longitude: string;
};


// Cuántos resultados se muestran antes de "Ver más".
const PAGE_SIZE = 8;

export function MechanicsScreen({
  api,
  view,
  onOpenMechanic,
  favoriteMechanicIds,
  onToggleFavorite,
  mechanicsFilter,
  setMechanicsFilter,
  requestForm,
  setRequestForm,
  mechanicCursor,
  selectedMechanicReviews,
  selectedMechanicReviewStats,
  scheduleDates,
  selectedScheduleDate,
  setSelectedScheduleDate,
  filteredScheduleSlots,
  onLoadMechanics,
  onRequestCurrentLocation,
  onLoadNearbyMechanics,
}: {
  api: ApiCall;
  // 'profile' muestra solo el perfil del mecánico elegido.
  view: 'list' | 'profile';
  onOpenMechanic: (mechanicId: number) => void;
  favoriteMechanicIds: number[];
  onToggleFavorite: (mechanicId: number) => void;
  mechanicsFilter: { city: string; zone: string };
  setMechanicsFilter: (value: { city: string; zone: string }) => void;
  requestForm: RequestFormShape;
  setRequestForm: Dispatch<SetStateAction<RequestFormShape>>;
  mechanicCursor: number;
  selectedMechanicReviews: MechanicReview[];
  selectedMechanicReviewStats: { averageRating: number | null; reviewCount: number };
  scheduleDates: string[];
  selectedScheduleDate: string;
  setSelectedScheduleDate: (value: string) => void;
  filteredScheduleSlots: ScheduleSlot[];
  onLoadMechanics: () => Promise<void>;
  onRequestCurrentLocation: () => Promise<{ latitude: number; longitude: number }>;
  onLoadNearbyMechanics: (latitude: number, longitude: number) => Promise<void>;
}) {
  const {
    user,
    mechanics,
    nearbyMechanics,
    currentLocation,
    busy,
    setBusy,
    setMessage,
    setCurrentScreen,
    setRequestsView,
    setRequestCreateStep,
  } = useAppContext();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedPromotions, setSelectedPromotions] = useState<Promotion[]>([]);
  const selectedId = mechanics[mechanicCursor]?.id;

  useEffect(() => {
    if (!selectedId) {
      setSelectedPromotions([]);
      return;
    }
    api<{ promotions: Promotion[] }>(`/api/promotions?mechanicId=${selectedId}`)
      .then((data) => setSelectedPromotions(data.promotions))
      .catch(() => setSelectedPromotions([]));
  }, [selectedId]);

  if (!user || user.role === 'mechanic') {
    return null;
  }

  const selected = mechanics[mechanicCursor];
  const canRequest = user.role === 'customer' || user.role === 'admin';
  const showProfile = view === 'profile' && Boolean(selected);
  // La lista general no trae distancia; si el mecánico está en el radar, se
  // usa la de ahí.
  const selectedDistanceKm = selected
    ? (selected.distanceKm ?? nearbyMechanics.find((mechanic) => mechanic.id === selected.id)?.distanceKm)
    : undefined;

  async function searchByZone() {
    try {
      await onLoadMechanics();
      setMessage('Mecánicos cargados');
    } catch (error) {
      setMessage(formatError(error));
    }
  }

  async function searchNearMe() {
    setBusy(true);
    try {
      const coords = currentLocation || (await onRequestCurrentLocation());
      await onLoadNearbyMechanics(coords.latitude, coords.longitude);
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!showProfile && (
        <>
          <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
            <Card
              title="Cerca de ti ahora"
              subtitle={
                !currentLocation
                  ? 'Necesitamos tu ubicación para mostrarte quién está cerca.'
                  : nearbyMechanics.length > 0
                    ? `${nearbyMechanics.length === 1 ? '1 mecánico conectado' : `${nearbyMechanics.length} mecánicos conectados`} a menos de 25 km.`
                    : 'Se actualiza solo cada pocos segundos.'
              }
            >
              <View style={styles.stack}>
                {currentLocation && nearbyMechanics.length > 0 ? (
                  <>
                    <MechanicRadar userLocation={currentLocation} mechanics={nearbyMechanics} maxDistanceKm={25} />
                    <View style={styles.list}>
                      {nearbyMechanics.map((mechanic) => (
                        <Pressable
                          key={`nearby-${mechanic.id}`}
                          style={({ pressed }) => [styles.item, pressed && styles.buttonPressed]}
                          onPress={() => onOpenMechanic(mechanic.id)}
                          accessibilityRole="button"
                          accessibilityLabel={`Ver el perfil de ${mechanic.fullName}`}
                        >
                          <View style={styles.itemHeader}>
                            <Avatar uri={mechanic.profilePhotoUrl} name={mechanic.fullName} size={44} />
                            <View style={styles.flex}>
                              <Text style={styles.itemTitle}>{mechanic.fullName}</Text>
                              <Text style={styles.smallText}>
                                a {mechanic.distanceKm?.toFixed(1) ?? '?'} km · {mechanic.zone}, {mechanic.city}
                              </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  </>
                ) : (
                  <EmptyState
                    icon="map-outline"
                    image={ILLUSTRATIONS.search}
                    title={currentLocation ? 'Nadie conectado cerca todavía' : 'Sin ubicación'}
                    text={
                      currentLocation
                        ? 'Puedes pedir un servicio de todos modos: te avisamos en cuanto un mecánico lo tome.'
                        : 'Toca el botón para permitir tu ubicación.'
                    }
                  >
                    <SecondaryButton
                      title={currentLocation ? 'Buscar de nuevo' : 'Usar mi ubicación'}
                      busy={busy}
                      onPress={searchNearMe}
                    />
                  </EmptyState>
                )}
              </View>
            </Card>
          </Animated.View>
    
          <Animated.View entering={FadeInDown.delay(60).duration(300)} needsOffscreenAlphaCompositing>
            <Card title="Busca por zona" subtitle="Escribe una ciudad y una zona para ver a todos sus mecánicos.">
              <View style={styles.stack}>
                <View style={styles.row}>
                  <Field label="Ciudad" style={styles.flex}>
                    <Input
                      value={mechanicsFilter.city}
                      onChangeText={(value) => setMechanicsFilter({ ...mechanicsFilter, city: value })}
                    />
                  </Field>
                  <Field label="Zona" style={styles.flex}>
                    <Input
                      value={mechanicsFilter.zone}
                      onChangeText={(value) => setMechanicsFilter({ ...mechanicsFilter, zone: value })}
                    />
                  </Field>
                </View>
                <PrimaryButton title="Buscar" onPress={searchByZone} />
              </View>
            </Card>
          </Animated.View>
    
          <Animated.View entering={FadeInDown.delay(90).duration(300)} needsOffscreenAlphaCompositing>
            {mechanics.length === 0 ? (
              <Card title="Resultados">
                <EmptyState
                  icon="people-outline"
                  image={ILLUSTRATIONS.error}
                  title="Sin mecánicos por ahora"
                  text="Prueba con otra ciudad o zona."
                />
              </Card>
            ) : (
              <Card
                title={mechanics.length === 1 ? '1 mecánico' : `${mechanics.length} mecánicos`}
                subtitle="Toca uno para ver su perfil completo."
              >
                <View style={styles.list}>
                  {mechanics.slice(0, visibleCount).map((mechanic, index) => (
                    <Pressable
                      key={mechanic.id}
                      style={({ pressed }) => [styles.item, pressed && styles.buttonPressed]}
                      onPress={() => onOpenMechanic(mechanic.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Ver el perfil de ${mechanic.fullName}`}
                    >
                      <View style={styles.itemHeader}>
                        <Avatar uri={mechanic.profilePhotoUrl} name={mechanic.fullName} size={44} />
                        <View style={styles.flex}>
                          <Text style={styles.itemTitle}>{mechanic.fullName}</Text>
                          <Text style={styles.smallText}>
                            ★ {mechanic.rating.toFixed(1)} · {mechanic.jobsCompleted} trabajos
                            {typeof mechanic.distanceKm === 'number' ? ` · a ${mechanic.distanceKm.toFixed(1)} km` : ''}
                          </Text>
                        </View>
                      </View>
                      <InfoRow icon="radio-button-on-outline" text={getMechanicPublicStatus(mechanic)} />
                    </Pressable>
                  ))}
                  {mechanics.length > visibleCount && (
                    <SecondaryButton title="Ver más" onPress={() => setVisibleCount((count) => count + PAGE_SIZE)} />
                  )}
                </View>
              </Card>
            )}
          </Animated.View>
        </>
      )}

      {showProfile && selected && (
        <Animated.View key={selected.id} entering={FadeInDown.duration(300)} needsOffscreenAlphaCompositing>
          <Card
            title={selected.fullName}
            subtitle={selected.specialties.length > 0 ? selected.specialties.join(', ') : undefined}
          >
            <View style={styles.stack}>
              {selected.profilePhotoUrl ? (
                <View style={styles.profilePhotoPreview}>
                  <Avatar uri={selected.profilePhotoUrl} name={selected.fullName} size={88} />
                  <Text style={[styles.smallText, styles.flex]}>
                    Así se ve {selected.fullName.split(' ')[0]}: es quien llega si te acepta la solicitud.
                  </Text>
                </View>
              ) : null}
              {selected.coverPhotoUrl ? <Image source={{ uri: selected.coverPhotoUrl }} style={styles.coverPhoto} /> : null}
              {user.role === 'customer' && (
                <Pressable
                  style={({ pressed }) => [
                    styles.favoriteButton,
                    favoriteMechanicIds.includes(selected.id) && styles.favoriteButtonActive,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => onToggleFavorite(selected.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: favoriteMechanicIds.includes(selected.id) }}
                >
                  <Ionicons
                    name={favoriteMechanicIds.includes(selected.id) ? 'heart' : 'heart-outline'}
                    size={20}
                    color={colors.primary}
                  />
                  <Text style={styles.favoriteButtonText}>
                    {favoriteMechanicIds.includes(selected.id) ? 'En tus favoritos' : 'Guardar en favoritos'}
                  </Text>
                </Pressable>
              )}
              <InfoRow
                icon="star-outline"
                text={
                  selectedMechanicReviewStats.averageRating
                    ? `${selectedMechanicReviewStats.averageRating.toFixed(1)} de 5 · ${selectedMechanicReviewStats.reviewCount} reseñas · ${selected.jobsCompleted} trabajos`
                    : `Sin reseñas todavía · ${selected.jobsCompleted} trabajos`
                }
              />
              <InfoRow
                icon="location-outline"
                text={`${selected.city} · ${selected.zone}${typeof selectedDistanceKm === 'number' ? ` · a ${selectedDistanceKm.toFixed(1)} km` : ''}`}
              />
              <InfoRow icon="radio-button-on-outline" text={getMechanicPublicStatus(selected)} />
              {selected.laborRate ? (
                <InfoRow icon="cash-outline" text={`Visita y diagnóstico: ${formatPesos(selected.laborRate)}`} />
              ) : null}
              {selected.phone ? <InfoRow icon="call-outline" text={selected.phone} /> : null}
              {selected.bio ? <Text style={styles.itemText}>{selected.bio}</Text> : null}

              {selected.gallery && selected.gallery.length > 0 && (
                <View style={styles.publicProfileBox}>
                  <Text style={styles.publicProfileTitle}>Trabajos anteriores</Text>
                  <View style={styles.galleryRow}>
                    {selected.gallery.slice(0, 3).map((imageUrl, index) => (
                      <Image key={`${selected.id}-${index}`} source={{ uri: imageUrl }} style={styles.galleryPhoto} />
                    ))}
                  </View>
                </View>
              )}

              {selectedPromotions.length > 0 && (
                <View style={styles.publicProfileBox}>
                  <Text style={styles.publicProfileTitle}>Promociones</Text>
                  {selectedPromotions.map((promotion) => (
                    <PromotionItem key={promotion.id} promotion={promotion} />
                  ))}
                </View>
              )}

              <View style={styles.publicProfileBox}>
                <Text style={styles.publicProfileTitle}>Opiniones recientes</Text>
                {selectedMechanicReviews.length === 0 ? (
                  <Text style={styles.smallText}>Todavía no hay reseñas.</Text>
                ) : (
                  selectedMechanicReviews.slice(0, 3).map((review) => (
                    <View key={review.id} style={styles.reviewCard}>
                      <Text style={styles.reviewTitle}>
                        {review.customerName} · <Text style={styles.reviewStars}>{'★'.repeat(review.rating)}</Text>
                      </Text>
                      {review.comment ? <Text style={styles.smallText}>{review.comment}</Text> : null}
                    </View>
                  ))
                )}
              </View>

              <View style={styles.publicProfileBox}>
                <Text style={styles.publicProfileTitle}>Turnos disponibles</Text>
                {scheduleDates.length === 0 ? (
                  <Text style={styles.smallText}>Este mecánico todavía no publica turnos.</Text>
                ) : (
                  <>
                    <View style={styles.calendarStrip}>
                      {scheduleDates.map((date) => {
                        const label = formatCalendarDate(date);
                        const active = selectedScheduleDate === date;
                        return (
                          <Pressable
                            key={date}
                            style={[styles.calendarChip, active && styles.calendarChipActive]}
                            onPress={() => setSelectedScheduleDate(date)}
                          >
                            <Text style={[styles.calendarChipText, active && styles.calendarChipTextActive]}>{label.weekday}</Text>
                            <Text style={[styles.calendarChipText, active && styles.calendarChipTextActive]}>{label.day}</Text>
                            <Text style={[styles.calendarChipText, active && styles.calendarChipTextActive]}>{label.month}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {filteredScheduleSlots.length === 0 ? (
                      <Text style={styles.smallText}>No hay turnos en esta fecha.</Text>
                    ) : (
                      filteredScheduleSlots.map((slot) => (
                        <View key={slot.id} style={styles.slotCard}>
                          <Text style={styles.itemTitle}>
                            {slot.startTime} - {slot.endTime}
                          </Text>
                          <Text style={styles.smallText}>{slot.status === 'available' ? 'Disponible' : 'Ocupado'}</Text>
                          {slot.note ? <Text style={styles.smallText}>{slot.note}</Text> : null}
                          {canRequest && slot.status === 'available' && (
                            <SecondaryButton
                              title="Tomar este turno"
                              compact
                              onPress={() => {
                                setRequestForm({
                                  ...requestForm,
                                  requestedMechanicId: String(selected.id),
                                  scheduleSlotId: String(slot.id),
                                  preferredTime: `${slot.slotDate} ${slot.startTime}`,
                                });
                                setCurrentScreen('requests');
                                setRequestsView('create');
                                setRequestCreateStep('vehicle');
                                setMessage(`Turno del ${slot.slotDate} a las ${slot.startTime} con ${selected.fullName}`);
                              }}
                            />
                          )}
                        </View>
                      ))
                    )}
                  </>
                )}
              </View>

              {canRequest && (
                <PrimaryButton
                  title="Pedir a este mecánico"
                  onPress={() => {
                    setRequestForm({ ...requestForm, requestedMechanicId: String(selected.id) });
                    setCurrentScreen('requests');
                    setRequestsView('create');
                    setRequestCreateStep('vehicle');
                    setMessage(`Solicitud preparada para ${selected.fullName}`);
                  }}
                />
              )}
            </View>
          </Card>
        </Animated.View>
      )}
    </>
  );
}
