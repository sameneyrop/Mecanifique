import { type Dispatch, type SetStateAction } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import {
  Card,
  Field,
  Input,
  CharCounter,
  Segmented,
  PrimaryButton,
  SecondaryButton,
  IdentityVerificationCard,
} from '../components/ui';
import { getServiceRequestStatusLabel, formatCalendarDate } from '../utils';

const ILLUST_MECHANIC_DASHBOARD = require('../assets/illust-mechanic-dashboard.png');
const ILLUST_SETTINGS = require('../assets/illust-settings.png');

type ScheduleSlot = {
  id: number;
  slotDate: string;
  startTime: string;
  endTime: string;
  status: string;
  note?: string | null;
};

type AdminDispute = {
  id: number;
  serviceRequestId: number;
  category: string;
  description: string;
  status: string;
  resolutionNote: string | null;
  customerName: string;
};

type ActionsViewKey = 'assign' | 'status' | 'requestStatus' | 'availability' | 'update' | 'schedule';
type MechanicStatus = 'pending_verification' | 'active' | 'suspended';
type ServiceRequestStatus =
  | 'pending'
  | 'assigned'
  | 'in_progress'
  | 'en_route'
  | 'on_site'
  | 'diagnosing'
  | 'repairing'
  | 'awaiting_parts'
  | 'completed'
  | 'cancelled';

export function ActionsScreen({
  selectedActionRequest,
  actionsView,
  setActionsView,
  assignForm,
  setAssignForm,
  statusForm,
  setStatusForm,
  serviceStatusForm,
  setServiceStatusForm,
  updateForm,
  setUpdateForm,
  publicProfileForm,
  setPublicProfileForm,
  scheduleDates,
  selectedScheduleDate,
  setSelectedScheduleDate,
  filteredScheduleSlots,
  slotForm,
  setSlotForm,
  availabilityForm,
  setAvailabilityForm,
  adminDisputes,
  disputeResolutionNotes,
  setDisputeResolutionNotes,
  disputeRefundAmounts,
  setDisputeRefundAmounts,
  onStartIdentityVerification,
  onAssignRequest,
  onChangeMechanicStatus,
  onChangeServiceRequestStatus,
  onAddUpdate,
  onToggleAvailability,
  onSavePublicProfile,
  onCreateScheduleSlot,
  onResolveDispute,
  onClearSession,
}: {
  selectedActionRequest: any;
  actionsView: ActionsViewKey;
  setActionsView: Dispatch<SetStateAction<ActionsViewKey>>;
  assignForm: { requestId: string; mechanicId: string };
  setAssignForm: (value: { requestId: string; mechanicId: string }) => void;
  statusForm: { mechanicId: string; status: MechanicStatus };
  setStatusForm: Dispatch<SetStateAction<{ mechanicId: string; status: MechanicStatus }>>;
  serviceStatusForm: { requestId: string; status: ServiceRequestStatus };
  setServiceStatusForm: Dispatch<SetStateAction<{ requestId: string; status: ServiceRequestStatus }>>;
  updateForm: { requestId: string; message: string };
  setUpdateForm: (value: { requestId: string; message: string }) => void;
  publicProfileForm: { bio: string; coverPhotoUrl: string; galleryUrls: string; laborRate: string };
  setPublicProfileForm: (value: { bio: string; coverPhotoUrl: string; galleryUrls: string; laborRate: string }) => void;
  scheduleDates: string[];
  selectedScheduleDate: string;
  setSelectedScheduleDate: (value: string) => void;
  filteredScheduleSlots: ScheduleSlot[];
  slotForm: { mechanicId: string; slotDate: string; startTime: string; endTime: string; note: string };
  setSlotForm: (value: { mechanicId: string; slotDate: string; startTime: string; endTime: string; note: string }) => void;
  availabilityForm: { mechanicId: string; isAvailable: string };
  setAvailabilityForm: (value: { mechanicId: string; isAvailable: string }) => void;
  adminDisputes: AdminDispute[];
  disputeResolutionNotes: Record<number, string>;
  setDisputeResolutionNotes: (value: Record<number, string>) => void;
  disputeRefundAmounts: Record<number, string>;
  setDisputeRefundAmounts: (value: Record<number, string>) => void;
  onStartIdentityVerification: () => void;
  onAssignRequest: () => void;
  onChangeMechanicStatus: () => void;
  onChangeServiceRequestStatus: () => void;
  onAddUpdate: () => void;
  onToggleAvailability: (isAvailable: boolean) => void;
  onSavePublicProfile: () => void;
  onCreateScheduleSlot: () => void;
  onResolveDispute: (disputeId: number, status: 'under_review' | 'resolved') => void;
  onClearSession: () => Promise<void>;
}) {
  const { user, busy, identityState, identityBusy, setMessage } = useAppContext();

  if (!user || (user.role !== 'admin' && user.role !== 'mechanic')) {
    return null;
  }

  const selectedMechanicId = user.mechanicId?.toString() || '';

  const actionOptions: Array<{ key: string; label: string }> =
    user.role === 'admin'
      ? [
          { key: 'assign', label: 'Asignar' },
          { key: 'status', label: 'Estado' },
          { key: 'requestStatus', label: 'Solicitud' },
          { key: 'availability', label: 'Disponib.' },
          { key: 'schedule', label: 'Agenda' },
        ]
      : [
          { key: 'update', label: 'Updates' },
          { key: 'requestStatus', label: 'Solicitud' },
          { key: 'schedule', label: 'Agenda' },
        ];

  return (
    <>
      <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
      {user.role === 'mechanic' && (
        <Image source={ILLUST_MECHANIC_DASHBOARD} resizeMode="cover" style={styles.cardIllustration} />
      )}
      {user.role === 'mechanic' && (
        <IdentityVerificationCard
          identityState={identityState}
          identityBusy={identityBusy}
          onStart={onStartIdentityVerification}
        />
      )}
      </Animated.View>
      {user.role === 'admin' && (
        <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
        <Card
          title="Disputas"
          subtitle={adminDisputes.length > 0 ? `${adminDisputes.length} en total` : 'Sin disputas reportadas'}
        >
          <View style={styles.stack}>
            {adminDisputes.map((dispute) => (
              <View key={dispute.id} style={styles.publicProfileBox}>
                <Text style={styles.itemTitle}>
                  #{dispute.id} · {dispute.customerName} · {dispute.status}
                </Text>
                <Text style={styles.smallText}>Solicitud #{dispute.serviceRequestId} · {dispute.category}</Text>
                <Text style={styles.smallText}>{dispute.description}</Text>
                {dispute.status !== 'resolved' && (
                  <>
                    <Input
                      placeholder="Nota de resolución"
                      value={disputeResolutionNotes[dispute.id] || ''}
                      onChangeText={(value) =>
                        setDisputeResolutionNotes({ ...disputeResolutionNotes, [dispute.id]: value })
                      }
                    />
                    <Input
                      placeholder="Monto a reembolsar (opcional)"
                      keyboardType="numeric"
                      value={disputeRefundAmounts[dispute.id] || ''}
                      onChangeText={(value) =>
                        setDisputeRefundAmounts({ ...disputeRefundAmounts, [dispute.id]: value })
                      }
                    />
                    <Text style={styles.smallText}>
                      Esto solo deja un registro contable de la disputa; el reembolso real al cliente
                      debe hacerse manualmente hasta que exista un procesador de pagos integrado.
                    </Text>
                    <View style={styles.row}>
                      {dispute.status === 'reported' && (
                        <SecondaryButton
                          title="Poner en revisión"
                          compact
                          onPress={() => onResolveDispute(dispute.id, 'under_review')}
                        />
                      )}
                      <PrimaryButton
                        title="Resolver"
                        busy={busy}
                        onPress={() => onResolveDispute(dispute.id, 'resolved')}
                      />
                    </View>
                  </>
                )}
                {dispute.resolutionNote && (
                  <Text style={styles.smallText}>Resolución: {dispute.resolutionNote}</Text>
                )}
              </View>
            ))}
          </View>
        </Card>
        </Animated.View>
      )}
      <Animated.View entering={FadeInDown.delay(90).duration(300)} needsOffscreenAlphaCompositing>
      <Card title="Acciones">
        <View style={styles.stack}>
          {selectedActionRequest && (
            <View style={styles.publicProfileBox}>
              <Text style={styles.publicProfileTitle}>Solicitud seleccionada #{selectedActionRequest.id}</Text>
              <Text style={styles.smallText}>
                {selectedActionRequest.vehicleMake} {selectedActionRequest.vehicleModel} {selectedActionRequest.vehicleYear} · {getServiceRequestStatusLabel(selectedActionRequest.status)}
              </Text>
              <Text numberOfLines={2} style={styles.smallText}>{selectedActionRequest.issueDescription}</Text>
              {selectedActionRequest.serviceAddress ? (
                <Text numberOfLines={2} style={styles.smallText}>Destino: {selectedActionRequest.serviceAddress}</Text>
              ) : null}
            </View>
          )}
          <Segmented
            value={actionsView}
            options={actionOptions}
            onChange={(value) => setActionsView(value as ActionsViewKey)}
          />
          {user.role === 'admin' && actionsView === 'assign' && (
            <View style={styles.stack}>
              <Field label="Solicitud ID">
                <Input value={assignForm.requestId} keyboardType="numeric" onChangeText={(value) => setAssignForm({ ...assignForm, requestId: value })} />
              </Field>
              <Field label="Mecánico ID opcional">
                <Input value={assignForm.mechanicId} keyboardType="numeric" onChangeText={(value) => setAssignForm({ ...assignForm, mechanicId: value })} />
              </Field>
              <PrimaryButton title="Asignar mecánico" onPress={onAssignRequest} />
            </View>
          )}
          {user.role === 'admin' && actionsView === 'status' && (
            <View style={styles.stack}>
              <Field label="Actualizar estado mecánico">
                <Input
                  value={statusForm.mechanicId}
                  keyboardType="numeric"
                  onChangeText={(value) => setStatusForm({ ...statusForm, mechanicId: value })}
                />
              </Field>
              <Field label="Estado (active, pending_verification, suspended)">
                <Segmented
                  value={statusForm.status}
                  options={[
                    { key: 'active', label: 'active' },
                    { key: 'pending_verification', label: 'pending_verification' },
                    { key: 'suspended', label: 'suspended' },
                  ]}
                  onChange={(value) =>
                    setStatusForm({
                      ...statusForm,
                      status: value as MechanicStatus,
                    })
                  }
                />
              </Field>
              <PrimaryButton title="Cambiar estado" onPress={onChangeMechanicStatus} />
            </View>
          )}

          {actionsView === 'requestStatus' && (user.role === 'admin' || user.role === 'mechanic') && (
            <View style={styles.stack}>
              <Field label="Solicitud ID">
                <Input
                  value={serviceStatusForm.requestId}
                  keyboardType="numeric"
                  onChangeText={(value) => setServiceStatusForm({ ...serviceStatusForm, requestId: value })}
                />
              </Field>
              <Field label="Estado de la solicitud">
                <Segmented
                  value={serviceStatusForm.status}
                  options={[
                    { key: 'assigned', label: 'Asignada' },
                    { key: 'en_route', label: 'En camino' },
                    { key: 'on_site', label: 'En sitio' },
                    { key: 'diagnosing', label: 'Diagnosticando' },
                    { key: 'repairing', label: 'Reparando' },
                    { key: 'awaiting_parts', label: 'Refacciones' },
                    { key: 'completed', label: 'Terminada' },
                  ]}
                  onChange={(value) =>
                    setServiceStatusForm({
                      ...serviceStatusForm,
                      status: value as ServiceRequestStatus,
                    })
                  }
                />
              </Field>
              <PrimaryButton title="Actualizar estado" onPress={onChangeServiceRequestStatus} />
            </View>
          )}

          {user.role === 'mechanic' && actionsView === 'update' && (
            <View style={styles.stack}>
              <Text style={styles.itemText}>Tu mechanicId: {selectedMechanicId || 'no disponible'}</Text>
              <Field label="requestId para update">
                <Input value={updateForm.requestId} keyboardType="numeric" onChangeText={(value) => setUpdateForm({ ...updateForm, requestId: value })} />
              </Field>
              <Field label="Mensaje de avance">
                <Input value={updateForm.message} multiline maxLength={500} onChangeText={(value) => setUpdateForm({ ...updateForm, message: value })} />
                <CharCounter value={updateForm.message} max={500} />
              </Field>
              <PrimaryButton title="Publicar update" onPress={onAddUpdate} />
              <SecondaryButton title="Estoy disponible" onPress={() => onToggleAvailability(true)} />
              <SecondaryButton title="No disponible" onPress={() => onToggleAvailability(false)} />
              <View style={styles.publicProfileBox}>
                <Image source={ILLUST_SETTINGS} resizeMode="cover" style={styles.cardIllustration} />
                <Text style={styles.publicProfileTitle}>Perfil público</Text>
                <Field label="Bio">
                  <Input
                    value={publicProfileForm.bio}
                    multiline
                    maxLength={500}
                    onChangeText={(value) => setPublicProfileForm({ ...publicProfileForm, bio: value })}
                  />
                  <CharCounter value={publicProfileForm.bio} max={500} />
                </Field>
                <Field label="Foto principal (URL)">
                  <Input
                    value={publicProfileForm.coverPhotoUrl}
                    onChangeText={(value) => setPublicProfileForm({ ...publicProfileForm, coverPhotoUrl: value })}
                  />
                </Field>
                <Field label="Tarifa de mano de obra (MXN)">
                  <Input
                    value={publicProfileForm.laborRate}
                    keyboardType="numeric"
                    placeholder="Ej. 400"
                    onChangeText={(value) => setPublicProfileForm({ ...publicProfileForm, laborRate: value.replace(/[^0-9.]/g, '') })}
                  />
                  <Text style={styles.smallText}>
                    También funciona como tu apartado mínimo de referencia. Nota: el cobro real dentro de
                    la app todavía no está implementado — por ahora este monto es solo informativo.
                  </Text>
                </Field>
                <Field label="Galería (URLs separadas por coma)">
                  <Input
                    value={publicProfileForm.galleryUrls}
                    multiline
                    onChangeText={(value) => setPublicProfileForm({ ...publicProfileForm, galleryUrls: value })}
                  />
                </Field>
                <PrimaryButton title="Guardar perfil" onPress={onSavePublicProfile} />
              </View>
            </View>
          )}

          {(user.role === 'mechanic' || user.role === 'admin') && actionsView === 'schedule' && (
            <View style={styles.stack}>
              <Text style={styles.itemText}>Calendario para {selectedMechanicId || 'el mecánico activo'}</Text>
              <View style={styles.calendarStrip}>
                {scheduleDates.length === 0 ? (
                  <Text style={styles.smallText}>Aún no hay turnos.</Text>
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
                  <Text style={styles.smallText}>No hay turnos para esta fecha.</Text>
                ) : (
                  filteredScheduleSlots.map((slot) => (
                    <View key={slot.id} style={styles.slotRow}>
                      <Text style={styles.smallText}>
                        {slot.startTime} - {slot.endTime} · {slot.status}
                      </Text>
                      {slot.note ? <Text style={styles.smallText}>{slot.note}</Text> : null}
                    </View>
                  ))
                )}
              </View>
              <View style={styles.row}>
                <Field label="mechanicId opcional" style={styles.flex}>
                  <Input
                    value={slotForm.mechanicId}
                    keyboardType="numeric"
                    onChangeText={(value) => setSlotForm({ ...slotForm, mechanicId: value })}
                  />
                </Field>
                <Field label="Fecha (YYYY-MM-DD)" style={styles.flex}>
                  <Input
                    value={slotForm.slotDate}
                    onChangeText={(value) => setSlotForm({ ...slotForm, slotDate: value })}
                  />
                </Field>
              </View>
              <View style={styles.row}>
                <Field label="Inicio" style={styles.flex}>
                  <Input
                    value={slotForm.startTime}
                    onChangeText={(value) => setSlotForm({ ...slotForm, startTime: value })}
                    placeholder="09:00"
                  />
                </Field>
                <Field label="Fin" style={styles.flex}>
                  <Input
                    value={slotForm.endTime}
                    onChangeText={(value) => setSlotForm({ ...slotForm, endTime: value })}
                    placeholder="10:00"
                  />
                </Field>
              </View>
              <Field label="Nota">
                <Input
                  value={slotForm.note}
                  maxLength={500}
                  onChangeText={(value) => setSlotForm({ ...slotForm, note: value })}
                />
              </Field>
              <PrimaryButton title="Crear turno" onPress={onCreateScheduleSlot} />
            </View>
          )}

          {user.role === 'admin' && actionsView === 'availability' && (
            <View style={styles.stack}>
              <Field label="Mecánico ID para disponibilidad">
                <Input
                  value={availabilityForm.mechanicId}
                  keyboardType="numeric"
                  onChangeText={(value) => setAvailabilityForm({ ...availabilityForm, mechanicId: value })}
                />
              </Field>
              <Segmented
                value={availabilityForm.isAvailable}
                options={[
                  { key: 'true', label: 'Disponible' },
                  { key: 'false', label: 'No disponible' },
                ]}
                onChange={(value) => setAvailabilityForm({ ...availabilityForm, isAvailable: value })}
              />
              <SecondaryButton
                title="Actualizar disponibilidad"
                onPress={() => onToggleAvailability(availabilityForm.isAvailable === 'true')}
              />
            </View>
          )}
        </View>
      </Card>
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(180).duration(300)} needsOffscreenAlphaCompositing>
      <Card title={user.fullName} subtitle={user.role}>
        <SecondaryButton
          title="Cerrar sesión"
          onPress={async () => {
            await onClearSession();
            setMessage('Sesión cerrada');
          }}
        />
      </Card>
      </Animated.View>
    </>
  );
}