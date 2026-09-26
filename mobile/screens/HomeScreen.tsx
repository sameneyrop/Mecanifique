import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, Field, Input, PrimaryButton, SecondaryButton } from '../components/ui';
import {
  ACTIVE_REQUEST_STATUSES,
  ContactRow,
  EmergencyButton,
  RequestChat,
  SearchingStatus,
  ServiceProgress,
} from '../components/ActiveService';
import { openExternalNavigation } from '../utils';

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

type HomeScreenProps = {
  requestForm: RequestFormShape;
  setRequestForm: Dispatch<SetStateAction<RequestFormShape>>;
  onToggleMechanicConnection: (next: 'online' | 'offline') => void;
  onLoadRequestById: (requestId: number) => Promise<void>;
  onRefreshRequests: () => Promise<void>;
  onCancelRequest: (requestId: number) => void;
  onSearchAgain: (requestId: number) => void;
  onEmergencyCall: () => void;
  onSendMessage: () => void;
  onAdvanceJob: (requestId: number, status: string) => void;
  onUseMyLocation: () => void;
};

const TRUST_BADGES: Array<{ icon: keyof typeof Ionicons.glyphMap; label: string }> = [
  { icon: 'shield-checkmark-outline', label: 'Mecánicos verificados' },
  { icon: 'star-outline', label: 'Experiencia comprobada' },
  { icon: 'location-outline', label: 'Llegada rápida' },
  { icon: 'ribbon-outline', label: 'Garantía real' },
];

// Un solo botón grande por paso: el mecánico no tiene que elegir el estado
// de una lista (con guantes o en la calle eso son demasiados toques).
const NEXT_JOB_STEP: Record<string, { status: string; label: string }> = {
  assigned: { status: 'en_route', label: 'Voy en camino' },
  en_route: { status: 'on_site', label: 'Ya llegué' },
  in_progress: { status: 'on_site', label: 'Ya llegué' },
  on_site: { status: 'diagnosing', label: 'Empezar diagnóstico' },
  diagnosing: { status: 'repairing', label: 'Empezar reparación' },
  awaiting_parts: { status: 'repairing', label: 'Retomar reparación' },
  repairing: { status: 'completed', label: 'Terminar servicio' },
};

/**
 * Solicitud en curso del usuario (la más reciente no terminada). Para el
 * mecánico no cuentan las 'pending': esas son ofertas que todavía no aceptó.
 * Carga su detalle como selectedRequest, que App refresca cada 10 s.
 */
function useActiveRequest(onLoadRequestById: HomeScreenProps['onLoadRequestById'], onRefreshRequests: HomeScreenProps['onRefreshRequests']) {
  const { user, myRequests, selectedRequest } = useAppContext();

  // Para admin, /mine devuelve TODAS las solicitudes del sistema: no hay un
  // "servicio propio" que mostrar.
  const activeId =
    user?.role === 'admin'
      ? null
      : (myRequests.find(
          (request) => ACTIVE_REQUEST_STATUSES.has(request.status) && (user?.role !== 'mechanic' || request.status !== 'pending'),
        )?.id ?? null);

  useEffect(() => {
    if (activeId !== null && selectedRequest?.id !== activeId) {
      onLoadRequestById(activeId).catch(() => undefined);
    }
  }, [activeId, selectedRequest?.id]);

  const detail = activeId !== null && selectedRequest?.id === activeId ? selectedRequest : null;

  // Si el servicio terminó o se canceló (lo detecta el refresco del detalle),
  // se actualiza la lista para que Inicio vuelva a su estado normal.
  useEffect(() => {
    if (detail && !ACTIVE_REQUEST_STATUSES.has(detail.status)) {
      onRefreshRequests().catch(() => undefined);
    }
  }, [detail?.status]);

  return { activeId, detail };
}

function LoadingServiceCard() {
  return (
    <Card title="Cargando tu servicio…">
      <ActivityIndicator color={colors.primary} />
    </Card>
  );
}

function TrustBadge({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.trustBadge}>
      <Ionicons name={icon} size={20} color={colors.primary} />
      <Text style={styles.trustBadgeText}>{label}</Text>
    </View>
  );
}

function CustomerSearch({
  requestForm,
  setRequestForm,
  onUseMyLocation,
}: {
  requestForm: RequestFormShape;
  setRequestForm: Dispatch<SetStateAction<RequestFormShape>>;
  onUseMyLocation: () => void;
}) {
  const { user, busy, setCurrentScreen, setRequestsView, setRequestCreateStep, setMessage } = useAppContext();
  const [when, setWhen] = useState<'now' | 'schedule'>('now');
  const hasGpsLocation = Boolean(requestForm.latitude && requestForm.longitude);

  function handleSearch() {
    // Los turnos reales viven en la agenda de cada mecánico (pestaña
    // Mecánicos): una solicitud automática se le ofrece a alguien ahora mismo.
    if (when === 'schedule') {
      setCurrentScreen('mechanics');
      setMessage('Elige un mecánico y uno de sus turnos disponibles.');
      return;
    }
    setRequestCreateStep('vehicle');
    setRequestsView('create');
    setCurrentScreen('requests');
  }

  return (
    <View style={styles.stack}>
      <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
        {/* PLACEHOLDER: reemplazar por ilustración de marca final (mascota) */}
        <View style={styles.heroPlaceholder}>
          <Ionicons name="car-sport-outline" size={40} color={colors.primary} />
        </View>
        <Text style={styles.title}>Tu auto, en buenas manos</Text>
        <Text style={styles.subtitle}>
          Encuentra mecánicos verificados, cerca de ti o agenda para cuando lo necesites.
        </Text>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(90).duration(300)} needsOffscreenAlphaCompositing>
        <View style={styles.trustRow}>
          {TRUST_BADGES.map((badge) => (
            <TrustBadge key={badge.label} icon={badge.icon} label={badge.label} />
          ))}
        </View>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(180).duration(300)} needsOffscreenAlphaCompositing>
        <Card
          title="Busca un mecánico"
          subtitle={
            hasGpsLocation
              ? 'Usamos tu ubicación actual para encontrarte al mecánico más cercano.'
              : 'Permite tu ubicación o escribe tu ciudad y zona.'
          }
        >
          <View style={styles.stack}>
            <View style={styles.row}>
              <Field label="Ciudad" style={styles.flex}>
                <Input value={requestForm.city} onChangeText={(value) => setRequestForm((current) => ({ ...current, city: value }))} />
              </Field>
              <Field label="Zona" style={styles.flex}>
                <Input value={requestForm.zone} onChangeText={(value) => setRequestForm((current) => ({ ...current, zone: value }))} />
              </Field>
            </View>
            <SecondaryButton title="Usar mi ubicación actual" compact busy={busy} onPress={onUseMyLocation} />
            <View style={styles.row}>
              <Pressable
                style={[styles.whenOption, when === 'now' && styles.whenOptionActive, styles.flex]}
                onPress={() => setWhen('now')}
              >
                <Ionicons name="flash-outline" size={18} color={when === 'now' ? colors.primary : colors.textSecondary} />
                <Text style={[styles.whenOptionTitle, when === 'now' && styles.whenOptionTitleActive]}>Ahora mismo</Text>
                <Text style={styles.smallText}>Un mecánico cerca de ti, listo para ayudarte.</Text>
              </Pressable>
              <Pressable
                style={[styles.whenOption, when === 'schedule' && styles.whenOptionActive, styles.flex]}
                onPress={() => setWhen('schedule')}
              >
                <Ionicons name="calendar-outline" size={18} color={when === 'schedule' ? colors.primary : colors.textSecondary} />
                <Text style={[styles.whenOptionTitle, when === 'schedule' && styles.whenOptionTitleActive]}>Agendar fecha</Text>
                <Text style={styles.smallText}>Elige un mecánico y uno de sus turnos.</Text>
              </Pressable>
            </View>
            <PrimaryButton title="Buscar" onPress={handleSearch} />
          </View>
        </Card>
      </Animated.View>

      {!user?.mechanicId && (
        <Animated.View entering={FadeInDown.delay(240).duration(300)} needsOffscreenAlphaCompositing>
          <Pressable style={styles.mechanicBanner} onPress={() => setCurrentScreen('account')}>
            <Ionicons name="construct-outline" size={22} color={colors.white} />
            <View style={styles.flex}>
              <Text style={styles.mechanicBannerTitle}>¿Eres mecánico?</Text>
              <Text style={styles.mechanicBannerText}>Únete a nuestra red y recibe solicitudes de clientes en tu zona.</Text>
            </View>
            <Ionicons name="arrow-forward" size={18} color={colors.white} />
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

function CustomerHome(props: HomeScreenProps) {
  const { busy, setCurrentScreen, setRequestsView } = useAppContext();
  const { activeId, detail } = useActiveRequest(props.onLoadRequestById, props.onRefreshRequests);

  if (activeId === null) {
    return (
      <CustomerSearch
        requestForm={props.requestForm}
        setRequestForm={props.setRequestForm}
        onUseMyLocation={props.onUseMyLocation}
      />
    );
  }
  if (!detail) {
    return <LoadingServiceCard />;
  }

  const hasMechanic = detail.status !== 'pending' && Boolean(detail.mechanicName);

  return (
    <Animated.View entering={FadeInDown.duration(300)} style={styles.stack}>
      <Card
        title="Tu servicio"
        subtitle={`${detail.vehicleMake} ${detail.vehicleModel} ${detail.vehicleYear} · ${detail.issueDescription}`}
      >
        <ServiceProgress status={detail.status} />
      </Card>
      {detail.status === 'pending' && (
        <SearchingStatus request={detail} busy={busy} onSearchAgain={props.onSearchAgain} />
      )}
      {hasMechanic && (
        <Card title="Tu mecánico">
          <ContactRow label="Mecánico asignado" name={detail.mechanicName as string} phone={detail.mechanicPhone} />
        </Card>
      )}
      <EmergencyButton onPress={props.onEmergencyCall} />
      {hasMechanic && <RequestChat onSendMessage={props.onSendMessage} />}
      <SecondaryButton
        title="Ver detalle completo"
        onPress={() => {
          setRequestsView('detail');
          setCurrentScreen('requests');
        }}
      />
      <SecondaryButton title="Cancelar solicitud" busy={busy} onPress={() => props.onCancelRequest(detail.id)} />
    </Animated.View>
  );
}

function MechanicHome(props: HomeScreenProps) {
  const { busy, myRequests, mechanicConnection } = useAppContext();
  const { activeId, detail } = useActiveRequest(props.onLoadRequestById, props.onRefreshRequests);

  const liveLocationRequest = useMemo(
    () => myRequests.find((request) => request.status !== 'completed' && request.status !== 'cancelled'),
    [myRequests],
  );

  const nextStep = detail ? NEXT_JOB_STEP[detail.status] : undefined;
  const canWaitForParts = detail?.status === 'diagnosing' || detail?.status === 'repairing';
  const address = detail ? detail.serviceAddress || `${detail.city}, ${detail.zone}` : '';

  return (
    <View style={styles.stack}>
      {activeId !== null && !detail && <LoadingServiceCard />}
      {detail && (
        <Animated.View entering={FadeInDown.duration(300)} style={styles.stack}>
          <Card
            title="Trabajo en curso"
            subtitle={`${detail.vehicleMake} ${detail.vehicleModel} ${detail.vehicleYear} · ${detail.issueDescription}`}
          >
            <View style={styles.stack}>
              <ContactRow label="Cliente" name={detail.customerName || 'Cliente'} phone={detail.customerPhone} />
              <Text style={styles.itemText}>{address}</Text>
              {detail.latitude != null && detail.longitude != null && (
                <SecondaryButton
                  title="Cómo llegar"
                  onPress={() => openExternalNavigation(detail.latitude as number, detail.longitude as number, address)}
                />
              )}
            </View>
          </Card>
          <Card title="Avance">
            <View style={styles.stack}>
              <ServiceProgress status={detail.status} />
              {nextStep && (
                <Pressable
                  style={({ pressed }) => [styles.nextStepButton, (pressed || busy) && styles.buttonPressed]}
                  onPress={() => props.onAdvanceJob(detail.id, nextStep.status)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityState={{ busy, disabled: busy }}
                >
                  {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.nextStepButtonText}>{nextStep.label}</Text>}
                </Pressable>
              )}
              {canWaitForParts && (
                <SecondaryButton
                  title="Esperando refacciones"
                  busy={busy}
                  onPress={() => props.onAdvanceJob(detail.id, 'awaiting_parts')}
                />
              )}
            </View>
          </Card>
          <EmergencyButton onPress={props.onEmergencyCall} />
          <RequestChat onSendMessage={props.onSendMessage} />
        </Animated.View>
      )}

      <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
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
            onPress={() => props.onToggleMechanicConnection(mechanicConnection === 'online' ? 'offline' : 'online')}
          >
            <Text style={styles.connectionButtonText}>
              {mechanicConnection === 'online' ? 'DESCONECTARME' : 'CONECTARME'}
            </Text>
          </Pressable>
        </Card>
      </Animated.View>
    </View>
  );
}

export function HomeScreen(props: HomeScreenProps) {
  const { user } = useAppContext();

  if (!user) {
    return null;
  }

  return user.role === 'mechanic' ? <MechanicHome {...props} /> : <CustomerHome {...props} />;
}
