import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import {
  Avatar,
  Card,
  ChoiceTile,
  Field,
  Illustration,
  InfoRow,
  Input,
  PrimaryButton,
  SecondaryButton,
  StatusPulseDot,
} from '../components/ui';
import { ILLUSTRATIONS } from '../illustrations';
import {
  ACTIVE_REQUEST_STATUSES,
  ContactRow,
  EmergencyButton,
  mechanicTrustLine,
  RequestChat,
  SearchingStatus,
  ServiceProgress,
} from '../components/ActiveService';
import { MechanicTracker } from '../components/MechanicTracker';
import { CustomerQuoteCard, MechanicQuotePanel } from '../components/Quote';
import { MechanicPartsPanel, ReceiptsCard } from '../components/PartsReceipts';
import { ReturnVisitPanel, UpcomingVisitsCard, isUpcoming } from '../components/ReturnVisit';
import { CustomerAbsentAction, WithdrawButton } from '../components/CancellationActions';
import { CommissionHomeCard } from '../components/Commissions';
import { TourTarget } from '../components/AppTour';
import { CustomerReviewCard } from '../components/CustomerReview';
import { ProfileChecklist } from '../components/ProfileChecklist';
import { RateSuggestion } from '../components/MarketInsights';
import { RequestPhotos } from '../components/RequestPlace';
import {
  CustomerPaymentCard,
  MechanicCollectCard,
  NextStepGuide,
  customerNeedsClosure,
  mechanicNeedsClosure,
} from '../components/ServiceGuide';
import type { ApiCall } from '../App';
import { openServiceNavigation, serviceFeeStatusText } from '../utils';

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
  carPhotoUrl: string;
  spotPhotoUrl: string;
  carLocation: string;
};

/** Perfil propio del mecánico (GET /api/mechanics/me), en cualquier estado. */
export type MechanicProfile = {
  id: number;
  status: string;
  isOnline: boolean;
  isAvailable: boolean;
  laborRate: number | null;
  bio: string | null;
  coverPhotoUrl: string | null;
  profilePhotoUrl: string | null;
  gallery: string[];
  city: string;
  zone: string;
};

type HomeScreenProps = {
  api: ApiCall;
  mechanicProfile: MechanicProfile | null;
  onStartIdentityVerification: () => void;
  onSaveLaborRate: (rate: string) => void;
  onTakeProfilePhoto: () => void;
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

// Solo lo que la app de verdad hace: prometer algo que no se garantiza
// ("garantía", "llegada rápida") puede contar como publicidad engañosa.
const TRUST_BADGES: Array<{ icon: keyof typeof Ionicons.glyphMap; label: string }> = [
  { icon: 'shield-checkmark-outline', label: 'Mecánicos verificados' },
  { icon: 'star-outline', label: 'Reseñas de clientes reales' },
  { icon: 'document-text-outline', label: 'Cotización antes de reparar' },
  { icon: 'navigate-outline', label: 'Síguelo en camino' },
];

// Desde qué pasos se puede programar una visita de regreso (ya vio el auto).
const RETURN_VISIT_STATUSES = new Set(['on_site', 'in_progress', 'diagnosing', 'repairing', 'awaiting_parts']);

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

type RequestDetail = NonNullable<ReturnType<typeof useAppContext>['selectedRequest']>;

/**
 * Servicio terminado que falta cerrar (pagar, calificar o confirmar el
 * cobro). Carga su propio detalle, aparte de selectedRequest, para poder
 * mostrarse junto a un servicio en curso: un mecánico puede aceptar otro
 * trabajo antes de confirmar que le pagaron el anterior.
 */
function useClosureDetail(api: ApiCall, closureId: number | null) {
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (closureId === null) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    const load = () =>
      api<RequestDetail>(`/service-requests/${closureId}`)
        .then((loaded) => {
          if (!cancelled) setDetail(loaded);
        })
        .catch(() => undefined);
    void load();
    // Así ve sin recargar cuando el otro confirma el pago.
    const intervalId = setInterval(() => void load(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [closureId, version]);

  return {
    closure: detail && detail.id === closureId ? detail : null,
    reloadClosure: () => setVersion((current) => current + 1),
  };
}

/**
 * Solicitud en curso del usuario (la más reciente no terminada). Para el
 * mecánico no cuentan las 'pending': esas son ofertas que todavía no aceptó.
 * Carga su detalle como selectedRequest, que App refresca cada 10 s. Aparte,
 * la terminada que falta cerrar (useClosureDetail).
 */
function useActiveRequest(
  api: ApiCall,
  onLoadRequestById: HomeScreenProps['onLoadRequestById'],
  onRefreshRequests: HomeScreenProps['onRefreshRequests'],
) {
  const { user, myRequests, selectedRequest } = useAppContext();

  // Para admin, /mine devuelve TODAS las solicitudes del sistema: no hay un
  // "servicio propio" que mostrar.
  // Las citas y visitas de regreso que todavía no empiezan van aparte
  // ("Próxima visita"): antes se veían "en curso" días antes.
  const activeId =
    user?.role === 'admin'
      ? null
      : (myRequests.find(
          (request) =>
            ACTIVE_REQUEST_STATUSES.has(request.status) &&
            !isUpcoming(request) &&
            (user?.role !== 'mechanic' || request.status !== 'pending'),
        )?.id ?? null);
  const upcoming = user?.role === 'admin' ? [] : myRequests.filter((request) => isUpcoming(request));
  const needsClosure = user?.role === 'mechanic' ? mechanicNeedsClosure : customerNeedsClosure;
  const closureId = user?.role === 'admin' ? null : (myRequests.find((request) => needsClosure(request))?.id ?? null);
  const { closure, reloadClosure } = useClosureDetail(api, closureId);

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

  // Cuando se confirma el pago o llega la reseña, la lista decide si la
  // tarjeta de cierre ya se puede quitar.
  useEffect(() => {
    if (closure) {
      onRefreshRequests().catch(() => undefined);
    }
  }, [closure?.paidAt, closure?.customerPaidAt, closure?.unpaidReportedAt, closure?.reviewed]);

  return { activeId, detail, closure, reloadClosure, upcoming };
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
        <Illustration source={ILLUSTRATIONS.homeHero} />
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
            <TourTarget id="home-search" style={styles.stack}>
              <View style={styles.row}>
                <ChoiceTile
                  icon="flash-outline"
                  title="Ahora mismo"
                  description="Un mecánico cerca de ti, listo para ayudarte."
                  active={when === 'now'}
                  onPress={() => setWhen('now')}
                  style={styles.flex}
                />
                <ChoiceTile
                  icon="calendar-outline"
                  title="Agendar fecha"
                  description="Elige un mecánico y uno de sus turnos."
                  active={when === 'schedule'}
                  onPress={() => setWhen('schedule')}
                  style={styles.flex}
                />
              </View>
              <PrimaryButton title="Buscar" onPress={handleSearch} />
            </TourTarget>
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
  const { activeId, detail, closure, reloadClosure, upcoming } = useActiveRequest(
    props.api,
    props.onLoadRequestById,
    props.onRefreshRequests,
  );

  const openDetail = (requestId: number) => {
    props
      .onLoadRequestById(requestId)
      .then(() => {
        setRequestsView('detail');
        setCurrentScreen('requests');
      })
      .catch(() => undefined);
  };
  const upcomingCard = <UpcomingVisitsCard items={upcoming} role="customer" onOpen={openDetail} busy={busy} />;

  // Calificar vive en el detalle de la solicitud (pestaña Solicitudes).
  const closureCard = closure && (
    <Animated.View entering={FadeInDown.duration(300)}>
      <CustomerPaymentCard
        api={props.api}
        request={closure}
        onChanged={reloadClosure}
        onRate={() => openDetail(closure.id)}
      />
    </Animated.View>
  );

  if (activeId === null) {
    return (
      <View style={styles.stack}>
        {closureCard}
        {upcomingCard}
        <CustomerSearch
          requestForm={props.requestForm}
          setRequestForm={props.setRequestForm}
          onUseMyLocation={props.onUseMyLocation}
        />
        {/* Sin servicio en curso: qué le falta a su perfil. */}
        <ProfileChecklist api={props.api} />
      </View>
    );
  }
  if (!detail) {
    return <LoadingServiceCard />;
  }

  const hasMechanic = detail.status !== 'pending' && Boolean(detail.mechanicName);
  const feeText = serviceFeeStatusText(detail.serviceFee);

  return (
    <Animated.View entering={FadeInDown.duration(300)} style={styles.stack}>
      <Card
        title="Tu servicio"
        subtitle={`${detail.vehicleMake} ${detail.vehicleModel} ${detail.vehicleYear} · ${detail.issueDescription}`}
      >
        <View style={styles.stack}>
          <NextStepGuide request={detail} role="customer" />
          <ServiceProgress status={detail.status} />
          {feeText && <InfoRow icon="card-outline" text={feeText} />}
          {detail.returnVisit && (
            <InfoRow
              icon="calendar-outline"
              text={`${detail.mechanicName?.split(' ')[0] || 'Tu mecánico'} regresa: ${detail.returnVisit.preferredTime}. No se cobra otra visita.`}
            />
          )}
        </View>
      </Card>
      <MechanicTracker api={props.api} requestId={detail.id} status={detail.status} mechanicName={detail.mechanicName} />
      <CustomerQuoteCard
        api={props.api}
        requestId={detail.id}
        quotes={detail.quotes ?? []}
        mechanicName={detail.mechanicName}
        onChanged={() => void props.onLoadRequestById(detail.id).catch(() => undefined)}
      />
      <ReceiptsCard
        api={props.api}
        request={detail}
        canRespond
        onChanged={() => void props.onLoadRequestById(detail.id).catch(() => undefined)}
      />
      {detail.status === 'pending' && (
        <SearchingStatus request={detail} busy={busy} onSearchAgain={props.onSearchAgain} />
      )}
      {hasMechanic && (
        <Card title="Tu mecánico">
          <ContactRow
            label="Mecánico asignado"
            name={detail.mechanicName as string}
            phone={detail.mechanicPhone}
            photoUrl={detail.mechanicPhotoUrl}
            detail={mechanicTrustLine(detail)}
          />
          <Text style={styles.smallText}>
            Cuando llegue, revisa que sea la persona de la foto. Si no es, no le entregues el auto; si te sientes en
            riesgo, usa el botón de emergencia.
          </Text>
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
      {closureCard}
      {upcomingCard}
    </Animated.View>
  );
}

function ChecklistStep({
  number,
  done,
  title,
  description,
  children,
}: {
  number: number;
  done: boolean;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.checklistStep}>
      <View style={[styles.checklistBadge, done && styles.checklistBadgeDone]}>
        {done ? (
          <Ionicons name="checkmark" size={16} color={colors.white} />
        ) : (
          <Text style={styles.checklistBadgeText}>{number}</Text>
        )}
      </View>
      <View style={[styles.flex, styles.stack]}>
        <Text style={[styles.itemTitle, done && styles.checklistTitleDone]}>{title}</Text>
        <Text style={styles.smallText}>{description}</Text>
        {!done && children}
      </View>
    </View>
  );
}

function identityStepDescription(status: string | null): string {
  switch (status) {
    case 'submitted':
    case 'under_review':
      return 'En revisión. Te avisaremos en cuanto esté lista.';
    case 'rejected':
      return 'No pudimos verificarla. Puedes intentarlo de nuevo.';
    case 'approved':
      return 'Aprobada. Estamos activando tu cuenta…';
    default:
      return 'Te pediremos una identificación oficial y una foto tuya. Tarda unos minutos.';
  }
}

/**
 * Pasos para que un mecánico nuevo empiece a recibir trabajo. Antes quedaba
 * "pendiente de verificación" sin ninguna guía, y podía tocar CONECTARME
 * sin que le llegara nada.
 */
function MechanicOnboarding({
  api,
  profile,
  onStartIdentityVerification,
  onSaveLaborRate,
  onTakeProfilePhoto,
}: {
  api: ApiCall;
  profile: MechanicProfile;
  onStartIdentityVerification: () => void;
  onSaveLaborRate: (rate: string) => void;
  onTakeProfilePhoto: () => void;
}) {
  const { busy, identityState, identityBusy, mechanicConnection } = useAppContext();
  const [rateDraft, setRateDraft] = useState(profile.laborRate ? String(profile.laborRate) : '');

  if (profile.status === 'suspended') {
    return <Card title="Tu cuenta está suspendida" subtitle="Escríbenos a soporte desde Cuenta para revisarla." />;
  }

  const identityDone = profile.status === 'active';
  const photoDone = Boolean(profile.profilePhotoUrl);
  const rateDone = profile.laborRate != null && profile.laborRate > 0;
  if (identityDone && photoDone && rateDone) {
    return null;
  }

  const canRetryIdentity = !identityState.status || identityState.status === 'draft' || identityState.status === 'rejected';
  const doneCount = Number(identityDone) + Number(photoDone) + Number(rateDone);
  const readyToConnect = identityDone && photoDone;

  return (
    <Animated.View entering={FadeInDown.duration(300)}>
      <Card title="Activa tu cuenta" subtitle={`${doneCount} de 4 pasos listos`}>
        <View style={styles.stack}>
          <ChecklistStep
            number={1}
            done={identityDone}
            title="Verifica tu identidad"
            description={identityStepDescription(identityState.status)}
          >
            {canRetryIdentity && (
              <PrimaryButton
                title={identityState.status === 'rejected' ? 'Volver a intentar' : 'Verificar identidad'}
                busy={identityBusy}
                onPress={onStartIdentityVerification}
              />
            )}
          </ChecklistStep>
          <ChecklistStep
            number={2}
            done={photoDone}
            title="Tómate tu foto de perfil"
            description="Una selfie donde se vea bien tu cara, sin lentes oscuros ni gorra. El cliente la ve al aceptar su solicitud, para saber quién va a llegar. Sin foto no puedes conectarte."
          >
            <View style={styles.profilePhotoPreview}>
              <Avatar uri={profile.profilePhotoUrl} size={64} />
              <View style={styles.flex}>
                <PrimaryButton
                  title={photoDone ? 'Cambiar foto' : 'Tomar foto'}
                  busy={busy}
                  onPress={onTakeProfilePhoto}
                />
              </View>
            </View>
          </ChecklistStep>
          <ChecklistStep
            number={3}
            done={rateDone}
            title="Pon el precio de tu visita y diagnóstico"
            description="Lo que cobras por ir y revisar el auto, en pesos. La reparación se cotiza aparte, después del diagnóstico. Mecanifique cobra 10 % de la visita y la mano de obra; en tus primeros 30 días, desde tu primer servicio, nada."
          >
            <Field label="Visita y diagnóstico (pesos)">
              <Input
                value={rateDraft}
                keyboardType="numeric"
                placeholder="Ej. 400"
                onChangeText={(value) => setRateDraft(value.replace(/[^0-9.]/g, ''))}
              />
            </Field>
            <RateSuggestion api={api} onUse={setRateDraft} />
            <PrimaryButton title="Guardar precio" busy={busy} onPress={() => onSaveLaborRate(rateDraft)} />
          </ChecklistStep>
          <ChecklistStep
            number={4}
            done={readyToConnect && mechanicConnection === 'online'}
            title="Conéctate para recibir solicitudes"
            description={
              readyToConnect
                ? 'Toca «Conectarme» aquí abajo.'
                : !identityDone
                  ? 'Se habilita en cuanto aprobemos tu identidad.'
                  : 'Se habilita en cuanto subas tu foto de perfil.'
            }
          />
        </View>
      </Card>
    </Animated.View>
  );
}

/** Datos rápidos del mecánico, con el mismo estilo que las insignias de Inicio del cliente. */
function mechanicBadges(profile: MechanicProfile | null): Array<{ icon: keyof typeof Ionicons.glyphMap; label: string }> {
  const active = profile?.status === 'active';
  return [
    { icon: 'location-outline', label: profile ? `${profile.zone}, ${profile.city}` : 'Tu zona de trabajo' },
    { icon: 'cash-outline', label: profile?.laborRate ? `Visita: $${Math.round(profile.laborRate)}` : 'Sin precio de visita' },
    { icon: active ? 'shield-checkmark-outline' : 'time-outline', label: active ? 'Cuenta verificada' : 'Verificación pendiente' },
    { icon: 'wallet-outline', label: 'El cliente te paga directo' },
  ];
}

function MechanicHome(props: HomeScreenProps) {
  const { busy, myRequests, mechanicConnection, setCurrentScreen, setRequestsView } = useAppContext();
  const { activeId, detail, closure, reloadClosure, upcoming } = useActiveRequest(
    props.api,
    props.onLoadRequestById,
    props.onRefreshRequests,
  );

  const liveLocationRequest = useMemo(
    () =>
      myRequests.find((request) => request.status !== 'completed' && request.status !== 'cancelled' && !isUpcoming(request)),
    [myRequests],
  );
  const openDetail = (requestId: number) => {
    props
      .onLoadRequestById(requestId)
      .then(() => {
        setRequestsView('detail');
        setCurrentScreen('requests');
      })
      .catch(() => undefined);
  };
  const reloadDetail = () => {
    if (detail) void props.onLoadRequestById(detail.id).catch(() => undefined);
  };

  const nextStep = detail ? NEXT_JOB_STEP[detail.status] : undefined;
  // Sin cotización aceptada no se repara ni se va por refacciones (el
  // servidor lo revisa igual).
  const quotes = detail?.quotes ?? [];
  const quoteAccepted = quotes.some((quote) => quote.status === 'accepted');
  const needsQuote = (status: string) => (status === 'repairing' || status === 'awaiting_parts') && !quoteAccepted;
  const showQuotePanel = detail?.status === 'diagnosing' || detail?.status === 'repairing' || detail?.status === 'awaiting_parts';
  const canWaitForParts = (detail?.status === 'diagnosing' || detail?.status === 'repairing') && quoteAccepted;
  // Sin ticket no regresa de refacciones, y no termina con uno esperando al
  // cliente (src/partsReceipts.ts; el servidor lo revisa igual).
  const receiptPending = (detail?.receipts ?? []).some((receipt) => receipt.status === 'pending');
  const adjustmentPending = quotes.some((quote) => quote.status === 'pending' && quote.kind === 'adjustment');
  const blockedByReceipt = (status: string) =>
    (detail?.status === 'awaiting_parts' && Boolean(detail.partsTripOpen)) ||
    (status === 'completed' && (receiptPending || adjustmentPending));
  // Si cotizó refacciones a comprar y no subió ningún ticket, pregunta si
  // hizo todo antes de terminar: si no, cobra menos (ajuste) en vez de la
  // mano de obra completa de algo que no hizo.
  const [adjusting, setAdjusting] = useState(false);
  function advance(requestId: number, status: string) {
    const amounts = detail?.amountDue;
    if (status === 'completed' && amounts && amounts.partsToBuyEstimate > 0 && amounts.partsBought === 0) {
      Alert.alert(
        '¿Hiciste la reparación completa?',
        'Cotizaste refacciones a comprar y no subiste ningún ticket. Si no se hizo todo, cobra solo lo que sí hiciste.',
        [
          { text: 'No, cobrar menos', onPress: () => setAdjusting(true) },
          { text: 'Sí, terminar', onPress: () => props.onAdvanceJob(requestId, status) },
        ],
      );
      return;
    }
    props.onAdvanceJob(requestId, status);
  }
  const address = detail ? detail.serviceAddress || `${detail.city}, ${detail.zone}` : '';
  // Una cuenta pendiente o suspendida no puede conectarse (el servidor lo
  // rechaza igual); desconectarse siempre se permite.
  const online = mechanicConnection === 'online';
  const connectBlocked = props.mechanicProfile !== null && props.mechanicProfile.status !== 'active' && !online;

  return (
    <View style={styles.stack}>
      {props.mechanicProfile && (
        <MechanicOnboarding
          api={props.api}
          profile={props.mechanicProfile}
          onStartIdentityVerification={props.onStartIdentityVerification}
          onSaveLaborRate={props.onSaveLaborRate}
          onTakeProfilePhoto={props.onTakeProfilePhoto}
        />
      )}
      {/* El corte de comisiones por pagar (o vencido: no puede conectarse). */}
      {props.mechanicProfile?.status === 'active' && <CommissionHomeCard api={props.api} />}
      {/* Ya activa y sin trabajo en curso: qué más le falta a su perfil público. */}
      {props.mechanicProfile?.status === 'active' &&
        props.mechanicProfile.profilePhotoUrl &&
        props.mechanicProfile.laborRate != null &&
        activeId === null && <ProfileChecklist api={props.api} />}
      {activeId !== null && !detail && <LoadingServiceCard />}
      {detail && (
        <Animated.View entering={FadeInDown.duration(300)} style={styles.stack}>
          <Card
            title="Trabajo en curso"
            subtitle={`${detail.vehicleMake} ${detail.vehicleModel} ${detail.vehicleYear} · ${detail.issueDescription}`}
          >
            <View style={styles.stack}>
              <ContactRow
                label="Cliente"
                name={detail.customerName || 'Cliente'}
                phone={detail.customerPhone}
                photoUrl={detail.customerPhotoUrl}
              />
              <Text style={styles.itemText}>{address}</Text>
              <RequestPhotos
                carPhotoUrl={detail.carPhotoUrl}
                spotPhotoUrl={detail.spotPhotoUrl}
                locationSource={detail.locationSource}
              />
              <SecondaryButton title="Cómo llegar" onPress={() => void openServiceNavigation(detail)} />
              <WithdrawButton api={props.api} request={detail} onDone={() => void props.onRefreshRequests().catch(() => undefined)} />
            </View>
          </Card>
          <MechanicPartsPanel
            api={props.api}
            request={detail}
            onChanged={() => void props.onLoadRequestById(detail.id).catch(() => undefined)}
          />
          <Card title="Avance">
            <View style={styles.stack}>
              <NextStepGuide request={detail} role="mechanic" />
              <ServiceProgress status={detail.status} />
              {showQuotePanel && (
                <MechanicQuotePanel
                  api={props.api}
                  requestId={detail.id}
                  status={detail.status}
                  quotes={quotes}
                  onChanged={() => void props.onLoadRequestById(detail.id).catch(() => undefined)}
                  adjusting={adjusting}
                  onAdjustingChange={setAdjusting}
                />
              )}
              {nextStep && !needsQuote(nextStep.status) && !blockedByReceipt(nextStep.status) && (
                <Pressable
                  style={({ pressed }) => [styles.nextStepButton, (pressed || busy) && styles.buttonPressed]}
                  onPress={() => advance(detail.id, nextStep.status)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityState={{ busy, disabled: busy }}
                >
                  {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.nextStepButtonText}>{nextStep.label}</Text>}
                </Pressable>
              )}
              {canWaitForParts && (
                <SecondaryButton
                  title="Voy por refacciones"
                  busy={busy}
                  onPress={() => props.onAdvanceJob(detail.id, 'awaiting_parts')}
                />
              )}
              {detail.status === 'diagnosing' && !quoteAccepted && (
                <SecondaryButton
                  title="Terminar sin reparar"
                  busy={busy}
                  onPress={() => props.onAdvanceJob(detail.id, 'completed')}
                />
              )}
              {RETURN_VISIT_STATUSES.has(detail.status) && (
                <ReturnVisitPanel api={props.api} request={detail} onChanged={reloadDetail} />
              )}
              <CustomerAbsentAction
                api={props.api}
                request={detail}
                onDone={() => {
                  reloadDetail();
                  void props.onRefreshRequests().catch(() => undefined);
                }}
              />
            </View>
          </Card>
          <EmergencyButton onPress={props.onEmergencyCall} />
          <RequestChat onSendMessage={props.onSendMessage} />
        </Animated.View>
      )}

      {closure && (
        <Animated.View entering={FadeInDown.duration(300)} style={styles.stack}>
          <MechanicCollectCard api={props.api} request={closure} onChanged={reloadClosure} />
          <CustomerReviewCard api={props.api} request={closure} onDone={reloadClosure} />
        </Animated.View>
      )}

      {/* Sale hacia una próxima visita solo si no tiene otro trabajo en curso. */}
      <UpcomingVisitsCard
        items={upcoming}
        role="mechanic"
        onOpen={openDetail}
        onStart={activeId === null ? (requestId) => props.onAdvanceJob(requestId, 'en_route') : undefined}
        renderActions={(item) => (
          <WithdrawButton api={props.api} request={item} onDone={() => void props.onRefreshRequests().catch(() => undefined)} />
        )}
        busy={busy}
      />

      {activeId === null && (
        <>
          <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
            <Illustration source={online ? ILLUSTRATIONS.newRequest : ILLUSTRATIONS.firstRequest} />
            <Text style={styles.title}>{online ? 'Estás conectado' : '¿Listo para trabajar?'}</Text>
            <Text style={styles.subtitle}>
              {online
                ? 'Te avisamos con una notificación en cuanto un cliente cerca de ti pida un mecánico.'
                : 'Conéctate y empieza a recibir solicitudes de clientes cerca de ti.'}
            </Text>
          </Animated.View>
          <Animated.View entering={FadeInDown.delay(90).duration(300)} needsOffscreenAlphaCompositing>
            <View style={styles.trustRow}>
              {mechanicBadges(props.mechanicProfile).map((badge) => (
                <TrustBadge key={badge.label} icon={badge.icon} label={badge.label} />
              ))}
            </View>
          </Animated.View>
        </>
      )}

      <Animated.View entering={FadeInDown.delay(180).duration(300)} needsOffscreenAlphaCompositing>
        <TourTarget id="mechanic-status">
        <Card
          title="Tu estado"
          subtitle={
            connectBlocked
              ? 'Podrás conectarte en cuanto tu cuenta esté activa.'
              : liveLocationRequest
                ? `Compartiendo tu ubicación durante la solicitud #${liveLocationRequest.id}.`
                : online
                  ? 'Recibes solicitudes de clientes cerca de ti.'
                  : 'Mientras estés desconectado no te llegan solicitudes.'
          }
        >
          <View style={styles.stack}>
            <View style={styles.connectionStatus}>
              <StatusPulseDot active={online} />
              <Text style={styles.connectionStatusText}>{online ? 'Conectado' : 'Desconectado'}</Text>
            </View>
            {online ? (
              <SecondaryButton title="Desconectarme" busy={busy} onPress={() => props.onToggleMechanicConnection('offline')} />
            ) : (
              <PrimaryButton
                title="Conectarme"
                busy={busy}
                disabled={connectBlocked}
                onPress={() => props.onToggleMechanicConnection('online')}
              />
            )}
          </View>
        </Card>
        </TourTarget>
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
