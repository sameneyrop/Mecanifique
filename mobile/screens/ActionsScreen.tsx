import { type Dispatch, type SetStateAction, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import {
  Card,
  Field,
  InfoRow,
  Input,
  CharCounter,
  Segmented,
  PrimaryButton,
  SecondaryButton,
  IdentityVerificationCard,
  RequestCard,
  Illustration,
} from '../components/ui';
import { ILLUSTRATIONS } from '../illustrations';
import { formatCalendarDate, openExternalNavigation, openPrivacyNotice } from '../utils';
import { MechanicPromotions } from '../components/MechanicPromotions';
import { DeleteAccountSection } from '../components/DeleteAccountSection';
import type { ApiCall } from '../App';

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

const DISPUTE_STATUS_LABELS: Record<string, string> = {
  reported: 'Reportada',
  under_review: 'En revisión',
  resolved: 'Resuelta',
};

const DISPUTE_CATEGORY_LABELS: Record<string, string> = {
  incomplete_work: 'Trabajo incompleto',
  incorrect_charge: 'Cobro incorrecto',
  vehicle_damage: 'Daño al vehículo',
  other: 'Otro',
};

const ROLE_LABELS = { customer: 'Cliente', mechanic: 'Mecánico', admin: 'Administrador' } as const;

// Mismo máximo que valida el servidor (galleryUrls.max(6)).
const MAX_GALLERY_PHOTOS = 6;

function ScheduleCalendar({
  scheduleDates,
  selectedScheduleDate,
  setSelectedScheduleDate,
  filteredScheduleSlots,
}: {
  scheduleDates: string[];
  selectedScheduleDate: string;
  setSelectedScheduleDate: (value: string) => void;
  filteredScheduleSlots: ScheduleSlot[];
}) {
  if (scheduleDates.length === 0) {
    return <Text style={styles.smallText}>Todavía no hay turnos publicados.</Text>;
  }
  return (
    <View style={styles.stack}>
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
        <Text style={styles.smallText}>No hay turnos para esta fecha.</Text>
      ) : (
        filteredScheduleSlots.map((slot) => (
          <View key={slot.id} style={styles.slotCard}>
            <Text style={styles.itemTitle}>
              {slot.startTime} - {slot.endTime}
            </Text>
            <Text style={styles.smallText}>{slot.status === 'available' ? 'Disponible' : 'Apartado'}</Text>
            {slot.note ? <Text style={styles.smallText}>{slot.note}</Text> : null}
          </View>
        ))
      )}
    </View>
  );
}

export function ActionsScreen({
  onDeleteAccount,
  api,
  onOpenCommunity,
  mechanicAccountActive,
  selectedActionRequest,
  actionsView,
  setActionsView,
  assignForm,
  setAssignForm,
  statusForm,
  setStatusForm,
  serviceStatusForm,
  setServiceStatusForm,
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
  onToggleAvailability,
  onSavePublicProfile,
  onAddProfilePhoto,
  onRemoveProfilePhoto,
  onCreateScheduleSlot,
  onResolveDispute,
  onClearSession,
  onSwitchRole,
}: {
  onDeleteAccount: () => Promise<void>;
  api: ApiCall;
  onOpenCommunity: () => void;
  mechanicAccountActive: boolean;
  selectedActionRequest: any;
  actionsView: ActionsViewKey;
  setActionsView: Dispatch<SetStateAction<ActionsViewKey>>;
  assignForm: { requestId: string; mechanicId: string };
  setAssignForm: (value: { requestId: string; mechanicId: string }) => void;
  statusForm: { mechanicId: string; status: MechanicStatus };
  setStatusForm: Dispatch<SetStateAction<{ mechanicId: string; status: MechanicStatus }>>;
  serviceStatusForm: { requestId: string; status: ServiceRequestStatus };
  setServiceStatusForm: Dispatch<SetStateAction<{ requestId: string; status: ServiceRequestStatus }>>;
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
  onToggleAvailability: (isAvailable: boolean) => void;
  onSavePublicProfile: () => void;
  onAddProfilePhoto: (kind: 'cover' | 'gallery') => void;
  onRemoveProfilePhoto: (kind: 'cover' | 'gallery', url: string) => void;
  onCreateScheduleSlot: () => void;
  onResolveDispute: (disputeId: number, status: 'under_review' | 'resolved') => void;
  onClearSession: () => Promise<void>;
  onSwitchRole: (payload: { targetRole: 'customer' | 'mechanic' }) => Promise<void>;
}) {
  const { user, busy, identityState, identityBusy, setMessage } = useAppContext();
  // El avance de un trabajo se maneja desde Inicio (botón de siguiente paso);
  // aquí el mecánico solo administra lo que ven los clientes: perfil y agenda.
  const [mechanicView, setMechanicView] = useState<'profile' | 'schedule' | 'promotions'>('profile');

  if (!user || (user.role !== 'admin' && user.role !== 'mechanic')) {
    return null;
  }

  const coverPhotoUrl = publicProfileForm.coverPhotoUrl.trim();
  const galleryUrls = publicProfileForm.galleryUrls
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const calendar = (
    <ScheduleCalendar
      scheduleDates={scheduleDates}
      selectedScheduleDate={selectedScheduleDate}
      setSelectedScheduleDate={setSelectedScheduleDate}
      filteredScheduleSlots={filteredScheduleSlots}
    />
  );

  const slotFields = (
    <>
      <Field label="Fecha (AAAA-MM-DD)">
        <Input
          value={slotForm.slotDate}
          placeholder="2026-10-01"
          onChangeText={(value) => setSlotForm({ ...slotForm, slotDate: value })}
        />
      </Field>
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
      <Field label="Nota (opcional)">
        <Input
          value={slotForm.note}
          maxLength={500}
          placeholder="Ej. Solo servicio a domicilio"
          onChangeText={(value) => setSlotForm({ ...slotForm, note: value })}
        />
      </Field>
    </>
  );

  return (
    <>
      {user.role === 'mechanic' && (
        <>
          <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
            <Segmented
              value={mechanicView}
              onBackground
              options={[
                { key: 'profile', label: 'Mi perfil', icon: 'person-outline' },
                { key: 'schedule', label: 'Mi agenda', icon: 'calendar-outline' },
                { key: 'promotions', label: 'Promociones', icon: 'pricetag-outline' },
              ]}
              onChange={(value) => setMechanicView(value as 'profile' | 'schedule' | 'promotions')}
            />
          </Animated.View>

          {mechanicView === 'profile' && (
            <Animated.View entering={FadeInDown.delay(60).duration(300)} style={styles.screenStack}>
              <Card title="Tu perfil público" subtitle="Esto es lo que ven los clientes cuando te buscan.">
                <View style={styles.stack}>
                  <Illustration source={ILLUSTRATIONS.mechanicDashboard} compact />
                  <Text style={styles.label}>Foto principal</Text>
                  {coverPhotoUrl ? (
                    <View style={styles.stack}>
                      <Image source={{ uri: coverPhotoUrl }} style={styles.coverPhoto} />
                      <View style={styles.row}>
                        <SecondaryButton title="Cambiar foto" compact busy={busy} onPress={() => onAddProfilePhoto('cover')} />
                        <SecondaryButton title="Quitar" compact onPress={() => onRemoveProfilePhoto('cover', coverPhotoUrl)} />
                      </View>
                    </View>
                  ) : (
                    <Pressable
                      style={({ pressed }) => [styles.heroPlaceholder, styles.photoAddTile, pressed && styles.buttonPressed]}
                      onPress={() => onAddProfilePhoto('cover')}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel="Agregar foto principal"
                    >
                      {busy ? (
                        <ActivityIndicator color={colors.primary} />
                      ) : (
                        <Ionicons name="camera-outline" size={36} color={colors.primary} />
                      )}
                      <Text style={styles.photoAddText}>
                        {busy ? 'Subiendo foto…' : 'Toca aquí para agregar una foto tuya o de tu taller'}
                      </Text>
                    </Pressable>
                  )}

                  <Text style={styles.label}>Fotos de tus trabajos</Text>
                  <Text style={styles.smallText}>
                    Hasta {MAX_GALLERY_PHOTOS}. Así los clientes ven la calidad de lo que haces.
                  </Text>
                  <View style={styles.galleryRow}>
                    {galleryUrls.map((url) => (
                      <View key={url}>
                        <Image source={{ uri: url }} style={styles.galleryPhoto} />
                        <Pressable
                          style={styles.photoRemoveButton}
                          onPress={() => onRemoveProfilePhoto('gallery', url)}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel="Quitar foto"
                        >
                          <Ionicons name="close" size={16} color={colors.white} />
                        </Pressable>
                      </View>
                    ))}
                    {galleryUrls.length < MAX_GALLERY_PHOTOS && (
                      <Pressable
                        style={({ pressed }) => [styles.galleryAddTile, pressed && styles.buttonPressed]}
                        onPress={() => onAddProfilePhoto('gallery')}
                        disabled={busy}
                        accessibilityRole="button"
                        accessibilityLabel="Agregar foto de un trabajo"
                      >
                        <Ionicons name="add" size={28} color={colors.primary} />
                        <Text style={styles.galleryAddText}>Agregar</Text>
                      </Pressable>
                    )}
                  </View>
                  <Text style={styles.smallText}>Las fotos se guardan en cuanto las agregas.</Text>

                  <Field label="Cuéntales sobre ti">
                    <Input
                      value={publicProfileForm.bio}
                      multiline
                      maxLength={500}
                      placeholder="Ej. 15 años reparando motores y frenos. Voy a domicilio."
                      onChangeText={(value) => setPublicProfileForm({ ...publicProfileForm, bio: value })}
                    />
                    <CharCounter value={publicProfileForm.bio} max={500} />
                  </Field>
                  <Field label="¿Cuánto cobras de mano de obra? (pesos)">
                    <Input
                      value={publicProfileForm.laborRate}
                      keyboardType="numeric"
                      placeholder="Ej. 400"
                      onChangeText={(value) => setPublicProfileForm({ ...publicProfileForm, laborRate: value.replace(/[^0-9.]/g, '') })}
                    />
                    <Text style={styles.smallText}>Los clientes la ven en tu perfil antes de pedirte un servicio.</Text>
                  </Field>
                  <PrimaryButton title="Guardar cambios" busy={busy} onPress={onSavePublicProfile} />
                </View>
              </Card>
              <IdentityVerificationCard
                identityState={identityState}
                identityBusy={identityBusy}
                onStart={onStartIdentityVerification}
              />
            </Animated.View>
          )}

          {mechanicView === 'promotions' && (
            <Animated.View entering={FadeInDown.delay(60).duration(300)} needsOffscreenAlphaCompositing>
              <MechanicPromotions api={api} accountActive={mechanicAccountActive} />
            </Animated.View>
          )}

          {mechanicView === 'schedule' && (
            <Animated.View entering={FadeInDown.delay(60).duration(300)} needsOffscreenAlphaCompositing>
              <Card title="Tu agenda" subtitle="Publica los horarios en que puedes atender. Los clientes pueden apartarlos.">
                <View style={styles.stack}>
                  <Illustration source={ILLUSTRATIONS.settings} compact />
                  {calendar}
                  <View style={styles.publicProfileBox}>
                    <Text style={styles.publicProfileTitle}>Nuevo turno</Text>
                    {slotFields}
                  </View>
                  <PrimaryButton title="Publicar turno" busy={busy} onPress={onCreateScheduleSlot} />
                </View>
              </Card>
            </Animated.View>
          )}

          <Animated.View entering={FadeInDown.delay(120).duration(300)} needsOffscreenAlphaCompositing>
            <Card title="Comunidad" subtitle="Responde dudas de clientes: es una forma de que te conozcan y te contraten.">
              <PrimaryButton title="Ver preguntas" onPress={onOpenCommunity} />
            </Card>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(150).duration(300)} needsOffscreenAlphaCompositing>
            <Card title="Modo cliente" subtitle="¿Necesitas un mecánico para tu auto? Usa esta misma cuenta.">
              <PrimaryButton title="Cambiar a modo cliente" busy={busy} onPress={() => onSwitchRole({ targetRole: 'customer' })} />
            </Card>
          </Animated.View>
        </>
      )}

      {user.role === 'admin' && (
        <>
          <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
            <Card
              title="Disputas"
              subtitle={adminDisputes.length > 0 ? `${adminDisputes.length} en total` : 'Sin disputas reportadas.'}
            >
              <View style={styles.list}>
                {adminDisputes.map((dispute) => (
                  <View key={dispute.id} style={styles.item}>
                    <Text style={styles.itemTitle}>
                      Disputa #{dispute.id} · {DISPUTE_STATUS_LABELS[dispute.status] ?? dispute.status}
                    </Text>
                    <InfoRow icon="person-outline" text={dispute.customerName} />
                    <InfoRow
                      icon="document-text-outline"
                      text={`Solicitud #${dispute.serviceRequestId} · ${DISPUTE_CATEGORY_LABELS[dispute.category] ?? dispute.category}`}
                    />
                    <Text style={styles.itemText}>{dispute.description}</Text>
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
                        {dispute.status === 'reported' && (
                          <SecondaryButton
                            title="Poner en revisión"
                            onPress={() => onResolveDispute(dispute.id, 'under_review')}
                          />
                        )}
                        <PrimaryButton
                          title="Resolver"
                          busy={busy}
                          onPress={() => onResolveDispute(dispute.id, 'resolved')}
                        />
                      </>
                    )}
                    {dispute.resolutionNote && (
                      <InfoRow icon="checkmark-circle-outline" text={dispute.resolutionNote} />
                    )}
                  </View>
                ))}
              </View>
            </Card>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(90).duration(300)} needsOffscreenAlphaCompositing>
            <Card title="Herramientas de administración">
              <View style={styles.stack}>
                {selectedActionRequest && (
                  <View style={styles.stack}>
                    <RequestCard request={selectedActionRequest} viewerRole="admin" />
                    {selectedActionRequest.latitude != null && selectedActionRequest.longitude != null && (
                      <SecondaryButton
                        title="Cómo llegar"
                        compact
                        onPress={() =>
                          openExternalNavigation(
                            selectedActionRequest.latitude,
                            selectedActionRequest.longitude,
                            selectedActionRequest.serviceAddress || undefined,
                          )
                        }
                      />
                    )}
                  </View>
                )}
                <Segmented
                  value={actionsView}
                  options={[
                    { key: 'assign', label: 'Asignar' },
                    { key: 'status', label: 'Mecánico' },
                    { key: 'requestStatus', label: 'Solicitud' },
                    { key: 'availability', label: 'Disponible' },
                    { key: 'schedule', label: 'Agenda' },
                  ]}
                  onChange={(value) => setActionsView(value as ActionsViewKey)}
                />
                {actionsView === 'assign' && (
                  <View style={styles.stack}>
                    <Field label="Número de solicitud">
                      <Input value={assignForm.requestId} keyboardType="numeric" onChangeText={(value) => setAssignForm({ ...assignForm, requestId: value })} />
                    </Field>
                    <Field label="ID del mecánico (opcional)">
                      <Input value={assignForm.mechanicId} keyboardType="numeric" onChangeText={(value) => setAssignForm({ ...assignForm, mechanicId: value })} />
                    </Field>
                    <PrimaryButton title="Asignar mecánico" onPress={onAssignRequest} />
                  </View>
                )}
                {actionsView === 'status' && (
                  <View style={styles.stack}>
                    <Field label="ID del mecánico">
                      <Input
                        value={statusForm.mechanicId}
                        keyboardType="numeric"
                        onChangeText={(value) => setStatusForm({ ...statusForm, mechanicId: value })}
                      />
                    </Field>
                    <Field label="Estado de la cuenta">
                      <Segmented
                        value={statusForm.status}
                        options={[
                          { key: 'active', label: 'Activa' },
                          { key: 'pending_verification', label: 'Pendiente' },
                          { key: 'suspended', label: 'Suspendida' },
                        ]}
                        onChange={(value) => setStatusForm({ ...statusForm, status: value as MechanicStatus })}
                      />
                    </Field>
                    <PrimaryButton title="Cambiar estado" onPress={onChangeMechanicStatus} />
                  </View>
                )}
                {actionsView === 'requestStatus' && (
                  <View style={styles.stack}>
                    <Field label="Número de solicitud">
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
                          { key: 'diagnosing', label: 'Diagnóstico' },
                          { key: 'repairing', label: 'Reparando' },
                          { key: 'awaiting_parts', label: 'Refacciones' },
                          { key: 'completed', label: 'Terminada' },
                        ]}
                        onChange={(value) =>
                          setServiceStatusForm({ ...serviceStatusForm, status: value as ServiceRequestStatus })
                        }
                      />
                    </Field>
                    <PrimaryButton title="Actualizar estado" onPress={onChangeServiceRequestStatus} />
                  </View>
                )}
                {actionsView === 'availability' && (
                  <View style={styles.stack}>
                    <Field label="ID del mecánico">
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
                    <PrimaryButton
                      title="Actualizar disponibilidad"
                      onPress={() => onToggleAvailability(availabilityForm.isAvailable === 'true')}
                    />
                  </View>
                )}
                {actionsView === 'schedule' && (
                  <View style={styles.stack}>
                    {calendar}
                    <Field label="ID del mecánico (opcional)">
                      <Input
                        value={slotForm.mechanicId}
                        keyboardType="numeric"
                        onChangeText={(value) => setSlotForm({ ...slotForm, mechanicId: value })}
                      />
                    </Field>
                    {slotFields}
                    <PrimaryButton title="Crear turno" onPress={onCreateScheduleSlot} />
                  </View>
                )}
              </View>
            </Card>
          </Animated.View>
        </>
      )}

      <Animated.View entering={FadeInDown.delay(180).duration(300)} needsOffscreenAlphaCompositing>
        <Card title="Sesión" subtitle={`${user.fullName} · ${ROLE_LABELS[user.role]}`}>
          <View style={styles.stack}>
            <SecondaryButton
              title="Cerrar sesión"
              onPress={async () => {
                await onClearSession();
                setMessage('Sesión cerrada');
              }}
            />
            <SecondaryButton title="Aviso de privacidad" compact onPress={() => void openPrivacyNotice()} />
            {user.role === 'mechanic' && <DeleteAccountSection busy={busy} onDeleteAccount={onDeleteAccount} />}
          </View>
        </Card>
      </Animated.View>
    </>
  );
}
