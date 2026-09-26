import { type Dispatch, type SetStateAction } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, Field, Input, PrimaryButton, SecondaryButton } from '../components/ui';
import { formatError, getMechanicPublicStatus, formatCalendarDate } from '../utils';

const ILLUST_SEARCH = require('../assets/illust-search.png');

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

  if (!user || user.role === 'mechanic') {
    return null;
  }

  return (
    <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
    <Card title="Buscar mecánicos">
      <Image source={ILLUST_SEARCH} resizeMode="contain" style={styles.cardIllustration} />
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
        <PrimaryButton
          title="Buscar"
          onPress={async () => {
            try {
              await onLoadMechanics();
              setMessage('Mecánicos cargados');
            } catch (error) {
              setMessage(formatError(error));
            }
          }}
        />
        <SecondaryButton
          title="Buscar cerca de mí"
          busy={busy}
          onPress={async () => {
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
          }}
        />
        {currentLocation && (
          <Text style={styles.smallText}>
            Ubicación actual: {currentLocation.latitude.toFixed(5)}, {currentLocation.longitude.toFixed(5)}
          </Text>
        )}
      </View>

      <View style={styles.list}>
        {mechanics.slice(mechanicCursor, mechanicCursor + 1).map((mechanic) => (
          <View key={mechanic.id} style={styles.item}>
            <Text style={styles.itemTitle}>{mechanic.fullName}</Text>
            <Text style={styles.itemText}>{mechanic.city} · {mechanic.zone}</Text>
            <Text style={styles.itemText}>⭐ {mechanic.rating.toFixed(1)} · {mechanic.jobsCompleted} trabajos</Text>
            <Text style={styles.itemText}>{mechanic.specialties.join(', ')}</Text>
            <Text style={styles.itemText}>
              Estado de conexión: {mechanic.isOnline ? 'Conectado' : 'Desconectado'} · {mechanic.isAvailable ? 'Disponible' : 'Ocupado'}
            </Text>
            {typeof mechanic.distanceKm === 'number' && (
              <Text style={styles.itemText}>A {mechanic.distanceKm.toFixed(1)} km</Text>
            )}
            <View style={styles.publicProfileBox}>
              <Text style={styles.publicProfileTitle}>Perfil público</Text>
              {mechanic.coverPhotoUrl ? (
                <Image source={{ uri: mechanic.coverPhotoUrl }} style={styles.coverPhoto} />
              ) : null}
              <Text style={styles.smallText}>Teléfono: {mechanic.phone}</Text>
              {mechanic.bio ? <Text style={styles.smallText}>{mechanic.bio}</Text> : null}
              <Text style={styles.smallText}>Zona de atención: {mechanic.city} · {mechanic.zone}</Text>
              <Text style={styles.smallText}>Estado actual: {getMechanicPublicStatus(mechanic)}</Text>
              <Text style={styles.smallText}>
                Agenda rápida: {mechanic.isOnline ? (mechanic.isAvailable ? 'Acepta solicitudes ahora' : 'Conectado, esperando turno') : 'Sin turno activo'}
              </Text>
              <Text style={styles.smallText}>
                Reseñas: {selectedMechanicReviewStats.averageRating ? selectedMechanicReviewStats.averageRating.toFixed(1) : 'N/D'} · {selectedMechanicReviewStats.reviewCount}
              </Text>
            </View>
            {mechanic.gallery && mechanic.gallery.length > 0 && (
              <View style={styles.publicProfileBox}>
                <Text style={styles.publicProfileTitle}>Galería</Text>
                <View style={styles.galleryRow}>
                  {mechanic.gallery.slice(0, 3).map((imageUrl, index) => (
                    <Image key={`${mechanic.id}-${index}`} source={{ uri: imageUrl }} style={styles.galleryPhoto} />
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
                      {review.customerName} · {'⭐'.repeat(review.rating)}
                    </Text>
                    <Text style={styles.smallText}>{review.comment}</Text>
                  </View>
                ))
              )}
            </View>
            <View style={styles.publicProfileBox}>
              <Text style={styles.publicProfileTitle}>Calendario de turnos</Text>
              <View style={styles.calendarStrip}>
                {scheduleDates.length === 0 ? (
                  <Text style={styles.smallText}>Sin turnos cargados todavía.</Text>
                ) : (
                  scheduleDates.map((date) => (
                    <Pressable
                      key={date}
                      style={[styles.calendarChip, selectedScheduleDate === date && styles.calendarChipActive]}
                      onPress={() => setSelectedScheduleDate(date)}
                    >
                      {(() => {
                        const label = formatCalendarDate(date);
                        return (
                          <>
                            <Text
                              style={[styles.calendarChipText, selectedScheduleDate === date && styles.calendarChipTextActive]}
                            >
                              {label.weekday}
                            </Text>
                            <Text
                              style={[styles.calendarChipText, selectedScheduleDate === date && styles.calendarChipTextActive]}
                            >
                              {label.day}
                            </Text>
                            <Text
                              style={[styles.calendarChipText, selectedScheduleDate === date && styles.calendarChipTextActive]}
                            >
                              {label.month}
                            </Text>
                          </>
                        );
                      })()}
                    </Pressable>
                  ))
                )}
              </View>
              <View style={styles.publicProfileBox}>
                <Text style={styles.publicProfileTitle}>Turnos del día</Text>
                {filteredScheduleSlots.length === 0 ? (
                  <Text style={styles.smallText}>No hay turnos en esta fecha.</Text>
                ) : (
                  filteredScheduleSlots.map((slot) => (
                    <View key={slot.id} style={styles.slotRow}>
                      <Text style={styles.smallText}>
                        {slot.startTime} - {slot.endTime} · {slot.status}
                      </Text>
                      {slot.note ? <Text style={styles.smallText}>{slot.note}</Text> : null}
                      {(user.role === 'customer' || user.role === 'admin') && slot.status === 'available' && (
                        <SecondaryButton
                          title="Tomar turno"
                          compact
                          onPress={() => {
                            setRequestForm({
                              ...requestForm,
                              requestedMechanicId: String(mechanic.id),
                              scheduleSlotId: String(slot.id),
                              preferredTime: `${slot.slotDate} ${slot.startTime}`,
                            });
                            setCurrentScreen('requests');
                            setRequestsView('create');
                            setRequestCreateStep('vehicle');
                            setMessage(`Turno del ${slot.slotDate} a las ${slot.startTime} con ${mechanic.fullName}`);
                          }}
                        />
                      )}
                    </View>
                  ))
                )}
              </View>
            </View>
            <Text style={styles.badge}>
              #{mechanic.id} · {mechanic.status} · {mechanic.isAvailable ? 'disponible' : 'ocupado'}
            </Text>
            {(user.role === 'customer' || user.role === 'admin') && (
              <PrimaryButton
                title="Solicitar ayuda de este mecánico"
                onPress={() => {
                  setRequestForm({ ...requestForm, requestedMechanicId: String(mechanic.id) });
                  setCurrentScreen('requests');
                  setRequestsView('create');
                  setMessage(`Solicitud preparada para ${mechanic.fullName}`);
                }}
              />
            )}
            <View style={styles.row}>
              <SecondaryButton title="Anterior" onPress={() => setMechanicCursor((value) => Math.max(0, value - 1))} />
              <SecondaryButton
                title="Siguiente"
                onPress={() => setMechanicCursor((value) => Math.min(mechanics.length - 1, value + 1))}
              />
            </View>
          </View>
        ))}
      </View>
    </Card>
    </Animated.View>
  );
}