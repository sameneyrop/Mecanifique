import { type Dispatch, type SetStateAction } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, Field, Input, CharCounter, Segmented, PrimaryButton, SecondaryButton, RequestCard } from '../components/ui';
import { EmergencyButton, RequestChat, SearchingStatus, ServiceProgress } from '../components/ActiveService';
import { formatError, getServiceRequestStatusLabel, formatCalendarDate } from '../utils';

const ILLUST_ERROR = require('../assets/illust-error.png');
const ILLUST_EMERGENCY = require('../assets/illust-emergency.png');
const ILLUST_COMPLETED = require('../assets/illust-completed.png');

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

export function RequestsScreen({
  requestCursor,
  setRequestCursor,
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
  onSaveCurrentVehicle,
  onCreateRequest,
  onLoadRequestLookup,
  onEmergencyCall,
  onSubmitReview,
  onSubmitDispute,
  onSendMessage,
}: {
  requestCursor: number;
  setRequestCursor: (updater: (prev: number) => number) => void;
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
  } = useAppContext();

  if (!user) {
    return null;
  }

  return (
    <>
      <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
      <Card title="Solicitudes" subtitle="Elige la vista">
        <Segmented
          value={requestsView}
          options={[
            { key: 'list', label: 'Listado' },
            { key: 'create', label: 'Crear' },
            { key: 'detail', label: 'Detalle' },
          ]}
          onChange={(value) => setRequestsView(value as any)}
        />
      </Card>
      </Animated.View>

      {requestsView === 'list' && (
        <Animated.View entering={FadeInDown.delay(90).duration(300)} needsOffscreenAlphaCompositing>
        <Card title="Mis solicitudes" subtitle="Vista rápida de tu actividad reciente">
          <View style={styles.stack}>
            <SecondaryButton
              title="Actualizar lista"
              onPress={async () => {
                try {
                  await onLoadMyRequests();
                  setMessage('Solicitudes actualizadas');
                } catch (error) {
                  setMessage(formatError(error));
                }
              }}
            />
            <View style={styles.list}>
              {myRequests.length === 0 ? (
                <View style={styles.emptyStateWrap}>
                  <Image source={ILLUST_ERROR} resizeMode="cover" style={styles.cardIllustration} />
                  <Text style={styles.itemText}>Todavía no hay solicitudes para mostrar.</Text>
                </View>
              ) : (
                myRequests.slice(requestCursor, requestCursor + 1).map((request) => (
                  <View key={request.id} style={styles.item}>
                    <Text style={styles.itemTitle}>Solicitud #{request.id}</Text>
                    <Text style={styles.itemText}>
                      {request.vehicleMake} {request.vehicleModel} {request.vehicleYear}
                    </Text>
                    <Text style={styles.itemText}>
                      {request.city} · {request.zone}
                    </Text>
                    <Text style={styles.itemText}>Estado: {getServiceRequestStatusLabel(request.status)}</Text>
                    <Text style={styles.itemText}>Mecánico: {request.mechanicName || 'sin asignar'}</Text>
                    <Text style={styles.smallText}>Actualizada: {request.updatedAt}</Text>
                    {request.scheduleSlotId && <Text style={styles.smallText}>Turno #{request.scheduleSlotId}</Text>}
                    {request.status === 'pending' && (
                      <Text style={styles.smallText}>
                        {request.holdExpiresAt ? 'Esperando respuesta del mecánico' : 'Sin mecánico asignado todavía'}
                      </Text>
                    )}
                    <SecondaryButton
                      title="Ver detalle"
                      onPress={async () => {
                        try {
                          await onLoadRequestById(request.id);
                          setMessage(`Solicitud #${request.id} cargada`);
                        } catch (error) {
                          setMessage(formatError(error));
                        }
                      }}
                    />
                    {(user.role === 'mechanic' || user.role === 'admin') && (
                      <PrimaryButton
                        title="Gestionar esta solicitud"
                        onPress={() => onOpenRequestActions(request)}
                      />
                    )}
                    {(user.role === 'customer' || user.role === 'admin') && request.status !== 'completed' && request.status !== 'cancelled' && (
                      <SecondaryButton title="Cancelar solicitud" busy={busy} onPress={() => onCancelRequest(request.id)} />
                    )}
                  </View>
                ))
              )}
              {myRequests.length > 1 && (
                <View style={styles.row}>
                  <SecondaryButton title="Anterior" onPress={() => setRequestCursor((value) => Math.max(0, value - 1))} />
                  <SecondaryButton
                    title="Siguiente"
                    onPress={() => setRequestCursor((value) => Math.min(myRequests.length - 1, value + 1))}
                  />
                </View>
              )}
            </View>
          </View>
        </Card>
        </Animated.View>
      )}

      {requestsView === 'create' && (
        <Animated.View entering={FadeInDown.delay(90).duration(300)} needsOffscreenAlphaCompositing>
        <Card title="Crear solicitud">
          <View style={styles.stack}>
            <Segmented
              value={requestCreateStep}
              options={[
                { key: 'vehicle', label: 'Vehículo' },
                { key: 'details', label: 'Detalle' },
              ]}
              onChange={(value) => setRequestCreateStep(value as any)}
            />
            {requestCreateStep === 'vehicle' ? (
              <View style={styles.stack}>
                {user.role === 'customer' && vehicles.length > 0 && (
                  <View style={styles.publicProfileBox}>
                    <Text style={styles.publicProfileTitle}>Mis vehículos</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      {vehicles.map((vehicle: VehicleProfile) => (
                        <Pressable
                          key={vehicle.id}
                          style={styles.calendarChip}
                          onPress={() =>
                            setRequestForm({
                              ...requestForm,
                              vehicleMake: vehicle.make,
                              vehicleModel: vehicle.model,
                              vehicleYear: String(vehicle.year),
                            })
                          }
                        >
                          <Text style={styles.calendarChipText}>
                            {vehicle.nickname || `${vehicle.make} ${vehicle.model}`}
                          </Text>
                          <Text style={styles.smallText}>{vehicle.year}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                )}
                {user.role === 'admin' && (
                  <Field label="customerId">
                    <Input
                      value={requestForm.customerId}
                      keyboardType="numeric"
                      onChangeText={(value) => setRequestForm({ ...requestForm, customerId: value })}
                    />
                  </Field>
                )}
                <Field label="Mecánico solicitado (opcional)">
                  <Input
                    value={requestForm.requestedMechanicId}
                    keyboardType="numeric"
                    onChangeText={(value) => setRequestForm({ ...requestForm, requestedMechanicId: value })}
                  />
                </Field>
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
                <SecondaryButton title="Continuar" onPress={() => setRequestCreateStep('details')} />
              </View>
            ) : (
              <View style={styles.stack}>
                <Field label="Descripción de la falla">
                  <Input
                    value={requestForm.issueDescription}
                    onChangeText={(value) => setRequestForm({ ...requestForm, issueDescription: value })}
                    multiline
                    maxLength={1000}
                  />
                  <CharCounter value={requestForm.issueDescription} max={1000} />
                </Field>
                <Text style={styles.smallText}>
                  {requestForm.requestedMechanicId
                    ? `Agenda del mecánico #${requestForm.requestedMechanicId}`
                    : 'Si quieres elegir un turno, primero escribe un mecánico solicitado arriba.'}
                </Text>
                {requestMechanicIdNumber && requestMechanicSlots.length > 0 && (
                  <View style={styles.publicProfileBox}>
                    <Text style={styles.publicProfileTitle}>Agenda del mecánico #{requestMechanicIdNumber}</Text>
                    <View style={styles.calendarStrip}>
                      {requestMechanicSlotsDates.map((date) => {
                        const label = formatCalendarDate(date);
                        return (
                          <Pressable
                            key={date}
                            style={[
                              styles.calendarChip,
                              selectedRequestScheduleDate === date && styles.calendarChipActive,
                            ]}
                            onPress={() => setSelectedRequestScheduleDate(date)}
                          >
                            <Text
                              style={[
                                styles.calendarChipText,
                                selectedRequestScheduleDate === date && styles.calendarChipTextActive,
                              ]}
                            >
                              {label.weekday}
                            </Text>
                            <Text
                              style={[
                                styles.calendarChipText,
                                selectedRequestScheduleDate === date && styles.calendarChipTextActive,
                              ]}
                            >
                              {label.day}
                            </Text>
                            <Text
                              style={[
                                styles.calendarChipText,
                                selectedRequestScheduleDate === date && styles.calendarChipTextActive,
                              ]}
                            >
                              {label.month}
                            </Text>
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
                              <Text style={styles.smallText}>Estado: {slot.status}</Text>
                              {slot.note ? <Text style={styles.smallText}>{slot.note}</Text> : null}
                            </Pressable>
                          );
                        })
                      )}
                    </View>
                  </View>
                )}
                <Text style={styles.smallText}>
                  {requestForm.scheduleSlotId
                    ? `Turno seleccionado #${requestForm.scheduleSlotId}`
                    : 'Puedes enviar la solicitud sin turno o elegir uno disponible.'}
                </Text>
                <Field label="Programar visita (opcional)">
                  <Input
                    value={requestForm.preferredTime}
                    onChangeText={(value) => setRequestForm({ ...requestForm, preferredTime: value })}
                    placeholder="Déjalo vacío para solicitar ahora"
                  />
                </Field>
                <Field label="Dirección del servicio">
                  <Input
                    value={requestForm.serviceAddress}
                    onChangeText={(value) => setRequestForm({ ...requestForm, serviceAddress: value })}
                    placeholder="Calle, número, colonia y referencias"
                  />
                </Field>
                <Text style={styles.smallText}>El mecánico verá esta dirección como destino del servicio.</Text>
                <Text style={styles.smallText}>Zona por defecto: {requestForm.city} · {requestForm.zone}</Text>
                <PrimaryButton
                  title={requestForm.preferredTime.trim() ? 'Programar solicitud' : 'Solicitar mecánico ahora'}
                  onPress={onCreateRequest}
                  busy={busy}
                />
                <SecondaryButton title="Volver" onPress={() => setRequestCreateStep('vehicle')} />
              </View>
            )}
          </View>
        </Card>
        </Animated.View>
      )}

      {requestsView === 'detail' && (
        <Animated.View entering={FadeInDown.delay(90).duration(300)} needsOffscreenAlphaCompositing>
        <Card title="Solicitud por ID">
          <View style={styles.stack}>
            <Field label="ID">
              <Input value={requestLookupId} keyboardType="numeric" onChangeText={setRequestLookupId} />
            </Field>
            <PrimaryButton title="Cargar solicitud" onPress={onLoadRequestLookup} />
          </View>

          {selectedRequest && (
            <View style={styles.stack}>
              <RequestCard request={selectedRequest} />
              {selectedRequest.status !== 'cancelled' && selectedRequest.status !== 'completed' && (
                <ServiceProgress status={selectedRequest.status} />
              )}
              {user.role === 'customer' && selectedRequest.status === 'pending' && (
                <SearchingStatus request={selectedRequest} busy={busy} onSearchAgain={onSearchAgain} />
              )}
              {selectedRequest.status !== 'completed' && selectedRequest.status !== 'cancelled' && (
                <>
                  <Image source={ILLUST_EMERGENCY} resizeMode="cover" style={styles.cardIllustration} />
                  <EmergencyButton onPress={onEmergencyCall} />
                </>
              )}
              {(user.role === 'customer' || user.role === 'admin') &&
                selectedRequest.status !== 'completed' &&
                selectedRequest.status !== 'cancelled' && (
                  <SecondaryButton
                    title="Cancelar solicitud"
                    busy={busy}
                    onPress={() => onCancelRequest(selectedRequest.id)}
                  />
                )}
              {selectedRequest.status === 'completed' && user.role === 'customer' && selectedRequest.mechanicId && (
                <Card title="Reseña" subtitle="Califica el trabajo finalizado">
                  <Image source={ILLUST_COMPLETED} resizeMode="cover" style={styles.cardIllustration} />
                  <View style={styles.stack}>
                    <Field label="Calificación">
                      <Segmented
                        value={reviewForm.rating}
                        options={[
                          { key: '5', label: '5' },
                          { key: '4', label: '4' },
                          { key: '3', label: '3' },
                          { key: '2', label: '2' },
                          { key: '1', label: '1' },
                        ]}
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
              {selectedRequest.status === 'completed' && user.role === 'customer' && (
                <Card title="¿Algo salió mal?" subtitle="Reporta un problema con este servicio">
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
                      <PrimaryButton title="Enviar reporte" busy={busy} onPress={onSubmitDispute} />
                      <SecondaryButton title="Cancelar" onPress={() => setShowDisputeForm(false)} />
                    </View>
                  )}
                </Card>
              )}
              <RequestChat onSendMessage={onSendMessage} />
            </View>
          )}
        </Card>
        </Animated.View>
      )}
    </>
  );
}