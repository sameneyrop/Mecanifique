import { type Dispatch, type SetStateAction, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, EmptyState, Field, ImagePlaceholder, InfoRow, Input, PrimaryButton, SecondaryButton } from '../components/ui';
import { formatError, getMechanicPublicStatus, formatCalendarDate } from '../utils';

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
  mechanicsFilter,
  setMechanicsFilter,
  requestForm,
  setRequestForm,
  mechanicCursor,
  setMechanicCursor,
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
  mechanicsFilter: { city: string; zone: string };
  setMechanicsFilter: (value: { city: string; zone: string }) => void;
  requestForm: RequestFormShape;
  setRequestForm: Dispatch<SetStateAction<RequestFormShape>>;
  mechanicCursor: number;
  setMechanicCursor: (updater: (prev: number) => number) => void;
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
    currentLocation,
    busy,
    setBusy,
    setMessage,
    setCurrentScreen,
    setRequestsView,
    setRequestCreateStep,
  } = useAppContext();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  if (!user || user.role === 'mechanic') {
    return null;
  }

  const selected = mechanics[mechanicCursor];
  const canRequest = user.role === 'customer' || user.role === 'admin';

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
      setMessage('Mecánicos cercanos cargados');
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
        <Card
          title="Busca por zona"
          subtitle={
            currentLocation
              ? 'Tenemos tu ubicación: puedes ver primero a los más cercanos.'
              : 'Escribe tu ciudad y zona, o permite tu ubicación.'
          }
        >
          <View style={styles.stack}>
            {/* PLACEHOLDER: ilustración de búsqueda de mecánicos */}
            <ImagePlaceholder icon="search-outline" compact />
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
            <SecondaryButton title="Buscar cerca de mí" compact busy={busy} onPress={searchNearMe} />
            <PrimaryButton title="Buscar" onPress={searchByZone} />
          </View>
        </Card>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(90).duration(300)} needsOffscreenAlphaCompositing>
        {mechanics.length === 0 ? (
          <Card title="Resultados">
            <EmptyState
              icon="people-outline"
              title="Sin mecánicos por ahora"
              text="Prueba con otra zona o busca cerca de ti."
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
                  style={({ pressed }) => [styles.item, index === mechanicCursor && styles.itemActive, pressed && styles.buttonPressed]}
                  onPress={() => setMechanicCursor(() => index)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: index === mechanicCursor }}
                >
                  <View style={styles.itemHeader}>
                    <View style={styles.itemIcon}>
                      <Ionicons name="person-outline" size={20} color={colors.primary} />
                    </View>
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

      {selected && (
        <Animated.View key={selected.id} entering={FadeInDown.delay(120).duration(300)} needsOffscreenAlphaCompositing>
          <Card
            title={selected.fullName}
            subtitle={selected.specialties.length > 0 ? selected.specialties.join(', ') : undefined}
          >
            <View style={styles.stack}>
              {selected.coverPhotoUrl ? <Image source={{ uri: selected.coverPhotoUrl }} style={styles.coverPhoto} /> : null}
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
                text={`${selected.city} · ${selected.zone}${typeof selected.distanceKm === 'number' ? ` · a ${selected.distanceKm.toFixed(1)} km` : ''}`}
              />
              <InfoRow icon="radio-button-on-outline" text={getMechanicPublicStatus(selected)} />
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

              <View style={styles.publicProfileBox}>
                <Text style={styles.publicProfileTitle}>Opiniones recientes</Text>
                {selectedMechanicReviews.length === 0 ? (
                  <Text style={styles.smallText}>Todavía no hay reseñas.</Text>
                ) : (
                  selectedMechanicReviews.slice(0, 3).map((review) => (
                    <View key={review.id} style={styles.reviewCard}>
                      <Text style={styles.reviewTitle}>
                        {review.customerName} · {'★'.repeat(review.rating)}
                      </Text>
                      <Text style={styles.smallText}>{review.comment}</Text>
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
