import { type Dispatch, type SetStateAction, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import {
  Card,
  CharCounter,
  ChoiceTile,
  EmptyState,
  Field,
  Illustration,
  InfoRow,
  Input,
  PrimaryButton,
  RequestCard,
  SecondaryButton,
  Segmented,
} from '../components/ui';
import { ILLUSTRATIONS } from '../illustrations';
import {
  ACTIVE_REQUEST_STATUSES,
  EmergencyButton,
  RequestChat,
  SearchingStatus,
  ServiceProgress,
} from '../components/ActiveService';
import { MechanicTracker } from '../components/MechanicTracker';
import { TipCard } from '../components/TipCard';
import type { ApiCall } from '../App';
import { formatError, formatCalendarDate, serviceFeeStatusText } from '../utils';

type ScheduleSlot = {
  id: number;
  slotDate: string;
  startTime: string;
  endTime: string;
  status: string;
  note?: string | null;
};

type VehicleProfile = {
  id: number;
  nickname?: string | null;
  make: string;
  model: string;
  year: number;
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

type DisputeFormShape = {
  category: 'incomplete_work' | 'incorrect_charge' | 'vehicle_damage' | 'other';
  description: string;
};

// Cuántas solicitudes se muestran antes de "Ver más".
const PAGE_SIZE = 8;

export function RequestsScreen({
  api,
  serviceFee,
  requestForm,
  setRequestForm,
  requestMechanicIdNumber,
  requestMechanicSlots,
  requestMechanicSlotsDates,
  selectedRequestScheduleDate,
  setSelectedRequestScheduleDate,
  requestFilteredSlots,
  requestLookupId,
  setRequestLookupId,
  reviewForm,
  setReviewForm,
  showDisputeForm,
  setShowDisputeForm,
  disputeForm,
  setDisputeForm,
  onLoadMyRequests,
  onLoadRequestById,
  onOpenRequestActions,
  onCancelRequest,
  onSearchAgain,
  onUseMyLocation,
  onSaveCurrentVehicle,
  onCreateRequest,
  onLoadRequestLookup,
  onEmergencyCall,
  onSubmitReview,
  onSubmitDispute,
  onSendMessage,
}: {
  api: ApiCall;
  serviceFee: { enabled: boolean; amount: number };
  requestForm: RequestFormShape;
  setRequestForm: Dispatch<SetStateAction<RequestFormShape>>;
  requestMechanicIdNumber: number | null;
  requestMechanicSlots: ScheduleSlot[];
  requestMechanicSlotsDates: string[];
  selectedRequestScheduleDate: string;
  setSelectedRequestScheduleDate: (value: string) => void;
  requestFilteredSlots: ScheduleSlot[];
  requestLookupId: string;
  setRequestLookupId: (value: string) => void;
  reviewForm: { rating: string; comment: string };
  setReviewForm: (value: { rating: string; comment: string }) => void;
  showDisputeForm: boolean;
  setShowDisputeForm: (value: boolean) => void;
  disputeForm: DisputeFormShape;
  setDisputeForm: Dispatch<SetStateAction<DisputeFormShape>>;
  onLoadMyRequests: () => Promise<void>;
  onLoadRequestById: (id: number) => Promise<void>;
  onOpenRequestActions: (request: any) => void;
  onCancelRequest: (id: number) => void;
  onSearchAgain: (id: number) => void;
  onUseMyLocation: () => void;
  onSaveCurrentVehicle: () => void;
  onCreateRequest: () => void;
  onLoadRequestLookup: () => void;
  onEmergencyCall: () => void;
  onSubmitReview: () => void;
  onSubmitDispute: () => void;
  onSendMessage: () => void;
}) {
  const {
    user,
    requestsView,
    setRequestsView,
    requestCreateStep,
    setRequestCreateStep,
    myRequests,
    busy,
    setMessage,
    vehicles,
    selectedRequest,
    mechanics,
    setCurrentScreen,
  } = useAppContext();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  if (!user) {
    return null;
  }

  // Un mecánico no crea solicitudes: solo ve las que le ofrecen o le asignan.
  const canCreate = user.role !== 'mechanic';
  const view = requestsView === 'create' && !canCreate ? 'list' : requestsView;

  const chosenMechanicName = requestForm.requestedMechanicId
    ? mechanics.find((mechanic) => String(mechanic.id) === requestForm.requestedMechanicId)?.fullName ?? 'Mecánico elegido'
    : null;
  const hasVehicle = Boolean(requestForm.vehicleMake.trim());
  const hasGpsLocation = Boolean(requestForm.latitude && requestForm.longitude);

  function clearChosenMechanic() {
    setRequestForm((current) => ({
      ...current,
      requestedMechanicId: '',
      scheduleSlotId: '',
      // Si el horario venía del turno de ese mecánico, ya no aplica.
      preferredTime: current.scheduleSlotId ? '' : current.preferredTime,
    }));
  }

  function startNewRequest() {
    setRequestCreateStep('vehicle');
    setRequestsView('create');
  }

  async function openDetail(requestId: number) {
    try {
      await onLoadRequestById(requestId);
      setRequestsView('detail');
    } catch (error) {
      setMessage(formatError(error));
    }
  }

  async function refreshList() {
    try {
      await onLoadMyRequests();
      setMessage('Solicitudes actualizadas');
    } catch (error) {
      setMessage(formatError(error));
    }
  }

  const chosenMechanicRow = chosenMechanicName ? (
    <View style={styles.selectionRow}>
      <View style={styles.flex}>
        <Text style={styles.smallText}>Mecánico elegido</Text>
        <Text style={styles.itemTitle}>{chosenMechanicName}</Text>
        {requestForm.scheduleSlotId ? <Text style={styles.smallText}>Turno: {requestForm.preferredTime}</Text> : null}
      </View>
      <SecondaryButton title="Quitar" compact onPress={clearChosenMechanic} />
    </View>
  ) : null;

  const viewOptions = [
    { key: 'list', label: 'Mis solicitudes', icon: 'list-outline' as const },
    ...(canCreate ? [{ key: 'create', label: 'Nueva', icon: 'add-circle-outline' as const }] : []),
    { key: 'detail', label: 'Detalle', icon: 'document-text-outline' as const },
  ];

  const detailIsActive = selectedRequest ? ACTIVE_REQUEST_STATUSES.has(selectedRequest.status) : false;
  const feeApplies = serviceFee.enabled && user.role === 'customer';
  const detailFeeText = selectedRequest ? serviceFeeStatusText(selectedRequest.serviceFee) : null;

  return (
    <>
      <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
        <Segmented
          value={view}
          options={viewOptions}
          onBackground
          onChange={(value) => {
            if (value === 'create') {
              startNewRequest();
              return;
            }
            setRequestsView(value as 'list' | 'detail');
          }}
        />
      </Animated.View>

      {view === 'list' && (
        <Animated.View entering={FadeInDown.delay(90).duration(300)} needsOffscreenAlphaCompositing>
          <Card
            title="Tus solicitudes"
            subtitle={
              user.role === 'mechanic'
                ? 'Trabajos que te ofrecieron o te asignaron.'
                : 'Toca una solicitud para ver su avance.'
            }
          >
            {myRequests.length === 0 ? (
              <EmptyState
                icon="document-text-outline"
                image={ILLUSTRATIONS.newRequest}
                title="Todavía no tienes solicitudes"
                text={
                  user.role === 'mechanic'
                    ? 'Cuando aceptes un trabajo, aquí verás su historial.'
                    : 'Cuando pidas un mecánico, aquí verás su avance.'
                }
              >
                {canCreate && <PrimaryButton title="Pedir un mecánico" onPress={startNewRequest} />}
              </EmptyState>
            ) : (
              <View style={styles.list}>
                {myRequests.slice(0, visibleCount).map((request) => (
                  <RequestCard
                    key={request.id}
                    request={request}
                    viewerRole={user.role}
                    onPress={() => openDetail(request.id)}
                  />
                ))}
                {myRequests.length > visibleCount && (
                  <SecondaryButton title="Ver más" onPress={() => setVisibleCount((count) => count + PAGE_SIZE)} />
                )}
                <SecondaryButton title="Actualizar" compact onPress={refreshList} />
              </View>
            )}
          </Card>
        </Animated.View>
      )}

      {view === 'create' && (
        <Animated.View entering={FadeInDown.delay(90).duration(300)} needsOffscreenAlphaCompositing>
          <Card
            title="Nueva solicitud"
            subtitle={
              requestCreateStep === 'vehicle'
                ? 'Paso 1 de 2 · ¿Qué auto necesita ayuda?'
                : 'Paso 2 de 2 · Cuéntanos qué le pasa y dónde está.'
            }
          >
            <View style={styles.stack}>
              <Segmented
                value={requestCreateStep}
                options={[
                  { key: 'vehicle', label: 'Vehículo', icon: 'car-sport-outline' },
                  { key: 'details', label: 'Falla y lugar', icon: 'construct-outline' },
                ]}
                onChange={(value) => setRequestCreateStep(value as 'vehicle' | 'details')}
              />
              {requestCreateStep === 'vehicle' ? (
                <View style={styles.stack}>
                  {user.role === 'customer' && vehicles.length > 0 && (
                    <View style={styles.row}>
                      {vehicles.map((vehicle: VehicleProfile) => {
                        const selected =
                          requestForm.vehicleMake === vehicle.make &&
                          requestForm.vehicleModel === vehicle.model &&
                          requestForm.vehicleYear === String(vehicle.year);
                        return (
                          <ChoiceTile
                            key={vehicle.id}
                            icon="car-sport-outline"
                            title={vehicle.nickname || `${vehicle.make} ${vehicle.model}`}
                            description={vehicle.nickname ? `${vehicle.make} ${vehicle.model} ${vehicle.year}` : String(vehicle.year)}
                            active={selected}
                            style={styles.choiceHalf}
                            onPress={() =>
                              setRequestForm({
                                ...requestForm,
                                vehicleMake: vehicle.make,
                                vehicleModel: vehicle.model,
                                vehicleYear: String(vehicle.year),
                              })
                            }
                          />
                        );
                      })}
                    </View>
                  )}
                  {user.role === 'admin' && (
                    <Field label="ID del cliente">
                      <Input
                        value={requestForm.customerId}
                        keyboardType="numeric"
                        onChangeText={(value) => setRequestForm({ ...requestForm, customerId: value })}
                      />
                    </Field>
                  )}
                  {user.role === 'admin' ? (
                    <Field label="Mecánico solicitado (ID, opcional)">
                      <Input
                        value={requestForm.requestedMechanicId}
                        keyboardType="numeric"
                        onChangeText={(value) => setRequestForm({ ...requestForm, requestedMechanicId: value })}
                      />
                    </Field>
                  ) : (
                    chosenMechanicRow
                  )}
                  {user.role === 'customer' && vehicles.length > 0 && (
                    <Text style={styles.smallText}>¿Es otro auto? Escríbelo aquí:</Text>
                  )}
                  <View style={styles.row}>
                    <Field label="Marca" style={styles.flex}>
                      <Input value={requestForm.vehicleMake} onChangeText={(value) => setRequestForm({ ...requestForm, vehicleMake: value })} />
                    </Field>
                    <Field label="Modelo" style={styles.flex}>
                      <Input value={requestForm.vehicleModel} onChangeText={(value) => setRequestForm({ ...requestForm, vehicleModel: value })} />
                    </Field>
                  </View>
                  <Field label="Año">
                    <Input
                      value={requestForm.vehicleYear}
                      keyboardType="numeric"
                      onChangeText={(value) => setRequestForm({ ...requestForm, vehicleYear: value })}
                    />
                  </Field>
                  {user.role === 'customer' && (
                    <SecondaryButton title="Guardar vehículo para después" onPress={onSaveCurrentVehicle} busy={busy} />
                  )}
                  <PrimaryButton title="Continuar" onPress={() => setRequestCreateStep('details')} />
                </View>
              ) : (
                <View style={styles.stack}>
                  {hasVehicle && (
                    <View style={styles.selectionRow}>
                      <View style={styles.flex}>
                        <Text style={styles.smallText}>Vehículo</Text>
                        <Text style={styles.itemTitle}>
                          {requestForm.vehicleMake} {requestForm.vehicleModel} {requestForm.vehicleYear}
                        </Text>
                      </View>
                      <SecondaryButton title="Cambiar" compact onPress={() => setRequestCreateStep('vehicle')} />
                    </View>
                  )}
                  {user.role !== 'admin' && chosenMechanicRow}
                  <Field label="Descripción de la falla">
                    <Input
                      value={requestForm.issueDescription}
                      onChangeText={(value) => setRequestForm({ ...requestForm, issueDescription: value })}
                      multiline
                      maxLength={1000}
                      placeholder="Ej. No enciende, hace un ruido al frenar…"
                    />
                    <CharCounter value={requestForm.issueDescription} max={1000} />
                  </Field>
                  {!requestForm.requestedMechanicId && (
                    <Text style={styles.smallText}>
                      ¿Quieres un mecánico o turno específico? Búscalo en la pestaña Mecánicos.
                    </Text>
                  )}
                  {requestMechanicIdNumber && requestMechanicSlots.length > 0 && (
                    <View style={styles.publicProfileBox}>
                      <Text style={styles.publicProfileTitle}>Turnos de {chosenMechanicName ?? 'este mecánico'}</Text>
                      <View style={styles.calendarStrip}>
                        {requestMechanicSlotsDates.map((date) => {
                          const label = formatCalendarDate(date);
                          const active = selectedRequestScheduleDate === date;
                          return (
                            <Pressable
                              key={date}
                              style={[styles.calendarChip, active && styles.calendarChipActive]}
                              onPress={() => setSelectedRequestScheduleDate(date)}
                            >
                              <Text style={[styles.calendarChipText, active && styles.calendarChipTextActive]}>{label.weekday}</Text>
                              <Text style={[styles.calendarChipText, active && styles.calendarChipTextActive]}>{label.day}</Text>
                              <Text style={[styles.calendarChipText, active && styles.calendarChipTextActive]}>{label.month}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <View style={styles.list}>
                        {requestFilteredSlots.length === 0 ? (
                          <Text style={styles.smallText}>No hay turnos para la fecha elegida.</Text>
                        ) : (
                          requestFilteredSlots.map((slot) => {
                            const active = requestForm.scheduleSlotId === String(slot.id);
                            return (
                              <Pressable
                                key={slot.id}
                                style={[styles.slotCard, active && styles.slotCardActive]}
                                onPress={() => setRequestForm({ ...requestForm, scheduleSlotId: String(slot.id) })}
                              >
                                <Text style={styles.itemTitle}>
                                  {slot.startTime} - {slot.endTime}
                                </Text>
                                <Text style={styles.smallText}>{slot.status === 'available' ? 'Disponible' : 'No disponible'}</Text>
                                {slot.note ? <Text style={styles.smallText}>{slot.note}</Text> : null}
                              </Pressable>
                            );
                          })
                        )}
                      </View>
                    </View>
                  )}
                  {!requestForm.scheduleSlotId && (
                    <Field label="¿Para cuándo? (opcional)">
                      <Input
                        value={requestForm.preferredTime}
                        onChangeText={(value) => setRequestForm({ ...requestForm, preferredTime: value })}
                        placeholder="Déjalo vacío para pedirlo ahora"
                      />
                    </Field>
                  )}
                  <View style={styles.publicProfileBox}>
                    <Text style={styles.publicProfileTitle}>¿Dónde está tu auto?</Text>
                    <Text style={styles.smallText}>
                      {hasGpsLocation
                        ? 'Usamos tu ubicación actual para encontrarte al mecánico más cercano.'
                        : 'Sin ubicación GPS: buscaremos por ciudad y zona.'}
                    </Text>
                    <Field label="Dirección">
                      <Input
                        value={requestForm.serviceAddress}
                        onChangeText={(value) => setRequestForm({ ...requestForm, serviceAddress: value })}
                        placeholder="Calle, número, colonia y referencias"
                      />
                    </Field>
                    <View style={styles.row}>
                      <Field label="Ciudad" style={styles.flex}>
                        <Input value={requestForm.city} onChangeText={(value) => setRequestForm({ ...requestForm, city: value })} />
                      </Field>
                      <Field label="Zona" style={styles.flex}>
                        <Input value={requestForm.zone} onChangeText={(value) => setRequestForm({ ...requestForm, zone: value })} />
                      </Field>
                    </View>
                    <SecondaryButton title="Usar mi ubicación actual" compact busy={busy} onPress={onUseMyLocation} />
                  </View>
                  {feeApplies && (
                    <View style={styles.publicProfileBox}>
                      <Text style={styles.publicProfileTitle}>Cuota de servicio: ${serviceFee.amount}</Text>
                      <InfoRow icon="shield-checkmark-outline" text="Solo se cobra cuando el mecánico llega. Si cancelas antes o no llega nadie, no se te cobra." />
                      <InfoRow icon="cash-outline" text="El trabajo del mecánico se lo pagas directamente a él." />
                    </View>
                  )}
                  <SecondaryButton title="Volver" onPress={() => setRequestCreateStep('vehicle')} />
                  <PrimaryButton
                    title={
                      feeApplies
                        ? `Pagar $${serviceFee.amount} y ${requestForm.preferredTime.trim() ? 'programar' : 'solicitar'}`
                        : requestForm.preferredTime.trim()
                          ? 'Programar solicitud'
                          : 'Solicitar mecánico ahora'
                    }
                    onPress={onCreateRequest}
                    busy={busy}
                  />
                </View>
              )}
            </View>
          </Card>
        </Animated.View>
      )}

      {view === 'detail' && (
        <Animated.View entering={FadeInDown.delay(90).duration(300)} style={styles.screenStack}>
          {user.role === 'admin' && (
            <Card title="Buscar por número" subtitle="Abre cualquier solicitud con su número.">
              <View style={styles.stack}>
                <Field label="Número de solicitud">
                  <Input value={requestLookupId} keyboardType="numeric" onChangeText={setRequestLookupId} />
                </Field>
                <PrimaryButton title="Abrir solicitud" onPress={onLoadRequestLookup} />
              </View>
            </Card>
          )}

          {!selectedRequest && user.role !== 'admin' && (
            <Card title="Detalle">
              <EmptyState
                icon="document-text-outline"
                title="Elige una solicitud"
                text="Toca una solicitud de tu lista para ver aquí su avance."
              >
                <SecondaryButton title="Ver mis solicitudes" onPress={() => setRequestsView('list')} />
              </EmptyState>
            </Card>
          )}

          {selectedRequest && (
            <>
              <Card title="Detalle de la solicitud">
                <View style={styles.stack}>
                  <RequestCard request={selectedRequest} viewerRole={user.role} />
                  {detailFeeText && user.role !== 'mechanic' && <InfoRow icon="card-outline" text={detailFeeText} />}
                  {detailIsActive && <ServiceProgress status={selectedRequest.status} />}
                </View>
              </Card>
              {user.role === 'customer' && (
                <MechanicTracker
                  api={api}
                  requestId={selectedRequest.id}
                  status={selectedRequest.status}
                  mechanicName={selectedRequest.mechanicName}
                />
              )}
              {user.role === 'customer' && selectedRequest.status === 'pending' && (
                <SearchingStatus request={selectedRequest} busy={busy} onSearchAgain={onSearchAgain} />
              )}
              {detailIsActive && (
                <>
                  <Illustration source={ILLUSTRATIONS.emergency} compact />
                  <EmergencyButton onPress={onEmergencyCall} />
                </>
              )}
              {user.role === 'mechanic' && detailIsActive && selectedRequest.status !== 'pending' && (
                <PrimaryButton title="Ir a mi trabajo en curso" onPress={() => setCurrentScreen('home')} />
              )}
              {selectedRequest.status === 'completed' && user.role === 'customer' && selectedRequest.mechanicId && (
                <Card title="Califica el servicio" subtitle="Tu opinión ayuda a otros clientes a elegir.">
                  <View style={styles.stack}>
                    <Illustration source={ILLUSTRATIONS.completed} compact />
                    <Field label="Calificación">
                      <Segmented
                        value={reviewForm.rating}
                        options={['5', '4', '3', '2', '1'].map((rating) => ({ key: rating, label: rating, icon: 'star' as const }))}
                        onChange={(value) => setReviewForm({ ...reviewForm, rating: value })}
                      />
                    </Field>
                    <Field label="Comentario">
                      <Input
                        value={reviewForm.comment}
                        multiline
                        placeholder="Cuéntanos cómo fue el servicio"
                        onChangeText={(value) => setReviewForm({ ...reviewForm, comment: value })}
                      />
                    </Field>
                    <PrimaryButton title="Enviar reseña" onPress={onSubmitReview} />
                  </View>
                </Card>
              )}
              {selectedRequest.status === 'completed' && user.role === 'customer' && selectedRequest.mechanicId && (
                <TipCard api={api} requestId={selectedRequest.id} />
              )}
              {selectedRequest.status === 'completed' && user.role === 'customer' && (
                <Card title="¿Algo salió mal?" subtitle="Reporta un problema con este servicio.">
                  {!showDisputeForm ? (
                    <SecondaryButton title="Reportar un problema" onPress={() => setShowDisputeForm(true)} />
                  ) : (
                    <View style={styles.stack}>
                      <Field label="Motivo">
                        <Segmented
                          value={disputeForm.category}
                          options={[
                            { key: 'incomplete_work', label: 'Trabajo incompleto' },
                            { key: 'incorrect_charge', label: 'Cobro incorrecto' },
                            { key: 'vehicle_damage', label: 'Daño al vehículo' },
                            { key: 'other', label: 'Otro' },
                          ]}
                          onChange={(value) =>
                            setDisputeForm({ ...disputeForm, category: value as DisputeFormShape['category'] })
                          }
                        />
                      </Field>
                      <Field label="Describe el problema">
                        <Input
                          value={disputeForm.description}
                          multiline
                          maxLength={1000}
                          placeholder="Cuéntanos qué pasó, con el mayor detalle posible"
                          onChangeText={(value) => setDisputeForm({ ...disputeForm, description: value })}
                        />
                        <CharCounter value={disputeForm.description} max={1000} />
                      </Field>
                      <SecondaryButton title="Cancelar" onPress={() => setShowDisputeForm(false)} />
                      <PrimaryButton title="Enviar reporte" busy={busy} onPress={onSubmitDispute} />
                    </View>
                  )}
                </Card>
              )}
              {selectedRequest.mechanicId != null && selectedRequest.status !== 'pending' && (
                <RequestChat onSendMessage={onSendMessage} />
              )}
              {user.role === 'admin' && (
                <PrimaryButton title="Gestionar esta solicitud" onPress={() => onOpenRequestActions(selectedRequest)} />
              )}
              {(user.role === 'customer' || user.role === 'admin') && detailIsActive && (
                <SecondaryButton
                  title="Cancelar solicitud"
                  busy={busy}
                  onPress={() => onCancelRequest(selectedRequest.id)}
                />
              )}
            </>
          )}
        </Animated.View>
      )}
    </>
  );
}
