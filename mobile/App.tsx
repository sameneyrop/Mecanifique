import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';
import { colors } from './colors';
import { styles } from './styles';
import { useAppContext, type AmountDue, type PartsReceipt } from './context/AppContext';
import { HomeScreen, type MechanicProfile } from './screens/HomeScreen';
import { MechanicsScreen } from './screens/MechanicsScreen';
import { MapScreen } from './screens/MapScreen';
import { RequestsScreen } from './screens/RequestsScreen';
import { AccountScreen } from './screens/AccountScreen';
import { ActionsScreen } from './screens/ActionsScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { VehiclesScreen } from './screens/VehiclesScreen';
import { IncomingRequestOverlay } from './components/IncomingRequestOverlay';
import { LoginScreen } from './screens/LoginScreen';
import { CommunityScreen, type CommunityView } from './screens/CommunityScreen';
import { PromotionsScreen } from './screens/PromotionsScreen';
import { NotificationsScreen, notificationTarget } from './screens/NotificationsScreen';
import { PhoneVerificationScreen, type PhoneVerificationStatus } from './screens/PhoneVerificationScreen';
import { BottomNavButton, ServerWakingBanner, Toast } from './components/ui';
import * as Haptics from 'expo-haptics';
import {
  normalizeSpecialties,
  formatError,
  normalizeServerTextError,
  getMechanicPublicStatus,
  getServiceRequestStatusLabel,
  formatCalendarDate,
  validateRequestForm,
  isWithinBookingWindow,
  formatPesos,
  openServiceNavigation,
} from './utils';
import { serviceAmounts } from './components/ServiceGuide';
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as Location from 'expo-location';
import { ILLUSTRATIONS } from './illustrations';
import { setLiveTrackingSender, startLiveTracking, stopLiveTracking, type TrackingReason } from './liveTracking';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  AppState,
} from 'react-native';

type Role = 'customer' | 'mechanic' | 'admin';
type AuthMode = 'login' | 'customer' | 'mechanic';
type MechanicStatus = 'pending_verification' | 'active' | 'suspended';
type AppScreen =
  | 'home'
  | 'requests'
  | 'mechanics'
  | 'map'
  | 'actions'
  | 'account'
  | 'vehicles'
  | 'community'
  | 'promotions'
  | 'notifications';
type RequestsView = 'list' | 'create' | 'detail';
type ActionsView = 'assign' | 'status' | 'requestStatus' | 'availability' | 'update' | 'schedule';
type MechanicSignupStep = 'account' | 'work';
type RequestCreateStep = 'vehicle' | 'details';
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

type AuthUser = {
  id: number;
  role: Role;
  login: string;
  fullName: string;
  customerId: number | null;
  mechanicId: number | null;
};

type AuthResponse = {
  user: AuthUser;
  accessToken: string;
  refreshToken?: string | null;
};

/** apiRequest con la sesión ya puesta, para que las pantallas llamen al servidor. */
export type ApiCall = <T>(
  path: string,
  options?: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown },
) => Promise<T>;

export type FavoriteMechanic = {
  id: number;
  fullName: string;
  city: string;
  zone: string;
  rating: number;
  jobsCompleted: number;
  isOnline: boolean;
  isAvailable: boolean;
};

type RenewedSession = {
  accessToken: string;
  refreshToken: string;
};

// Error de API con el código HTTP, para distinguir "el servidor rechazó la
// sesión" (401) de "no hubo conexión" sin depender del texto del mensaje.
class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type RegistrationResponse = {
  userId: string | null;
  customerId?: number;
  mechanicId?: number;
  email: string;
  message: string;
  requiresEmailConfirmation?: boolean;
};

type Mechanic = {
  id: number;
  fullName: string;
  phone: string;
  city: string;
  zone: string;
  yearsExperience: number;
  specialties: string[];
  status: string;
  isAvailable: boolean;
  isOnline?: boolean;
  rating: number;
  jobsCompleted: number;
  latitude?: number | null;
  longitude?: number | null;
  distanceKm?: number;
  bio?: string | null;
  coverPhotoUrl?: string | null;
  gallery?: string[];
  reviewCount?: number;
  laborRate?: number | null;
};

type RequestUpdate = {
  id: number;
  source: string;
  message: string;
  createdAt: string;
};

type RequestMessage = {
  id: number;
  senderUserId: number;
  senderRole: Role;
  senderName: string;
  message: string;
  createdAt: string;
};

type MechanicReview = {
  id: number;
  customerUserId: number;
  customerName: string;
  rating: number;
  comment: string;
  createdAt: string;
};

type MechanicReviewResponse = {
  stats: {
    averageRating: number | null;
    reviewCount: number;
  };
  reviews: MechanicReview[];
};

type VehicleProfile = {
  id: number;
  nickname?: string | null;
  make: string;
  model: string;
  year: number;
  engineType?: string | null;
  transmissionType?: string | null;
  licensePlate?: string | null;
  color?: string | null;
  mileage?: number | null;
  isPrimary?: boolean;
  photoUrls?: string[];
};

type AppNotification = {
  id: number;
  title: string;
  body: string;
  dataJson?: string | null;
  readAt: string | null;
  createdAt: string;
};

export type ServiceQuote = {
  id: number;
  serviceRequestId: number;
  laborAmount: number;
  // Refacciones a comprar (estimado; se cobran a precio de ticket). En
  // cotizaciones viejas (partsAreEstimate false) era un precio fijo.
  partsAmount: number;
  // Refacciones que ya trae el mecánico, a precio fijo.
  partsOnHandAmount?: number;
  partsAreEstimate?: boolean;
  total: number;
  // 'adjustment': baja lo acordado; al aceptarla reemplaza a las aceptadas.
  kind?: 'quote' | 'adjustment';
  description: string;
  status: 'pending' | 'accepted' | 'rejected' | 'replaced';
  createdAt: string;
  respondedAt: string | null;
};

type ServiceRequest = {
  id: number;
  customerId: number;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: number;
  issueDescription: string;
  preferredTime: string;
  city: string;
  zone: string;
  serviceAddress?: string | null;
  status: string;
  mechanicId: number | null;
  mechanicName?: string | null;
  mechanicPhone?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  diagnosisNotes?: string | null;
  repairNotes?: string | null;
  estimatedPrice?: number | null;
  finalPrice?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  holdExpiresAt?: string | null;
  scheduleSlotId?: number | null;
  assignmentMode?: 'auto' | 'direct' | null;
  updates?: RequestUpdate[];
  serviceFee?: { amount: number; status: 'pending' | 'authorized' | 'captured' | 'released' | 'failed' } | null;
  // Cotizaciones del mecánico, la más reciente primero (ver src/quotes.ts).
  quotes?: ServiceQuote[];
  // Cobro al terminar (src/servicePayment.ts): visita fijada al aceptar y
  // quién dijo qué del pago.
  visitFee?: number | null;
  paidAt?: string | null;
  customerPaidAt?: string | null;
  paymentMethod?: 'cash' | 'transfer' | null;
  unpaidReportedAt?: string | null;
  reviewed?: boolean;
  // Lo que se cobra, calculado por el servidor (src/servicePayment.ts).
  amountDue?: AmountDue;
  // Tickets de refacciones (src/partsReceipts.ts).
  receipts?: PartsReceipt[];
  // Salió por refacciones y todavía no sube el ticket.
  partsTripOpen?: boolean;
};

type RequestSummary = {
  id: number;
  customerId: number;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: number;
  issueDescription: string;
  preferredTime: string;
  city: string;
  zone: string;
  serviceAddress?: string | null;
  status: string;
  mechanicId: number | null;
  mechanicName?: string | null;
  createdAt: string;
  updatedAt: string;
  latitude?: number | null;
  longitude?: number | null;
  holdExpiresAt?: string | null;
  scheduleSlotId?: number | null;
  customerName?: string | null;
  customerPhone?: string | null;
  paidAt?: string | null;
  customerPaidAt?: string | null;
  unpaidReportedAt?: string | null;
  reviewed?: boolean;
};

type IdentityVerificationStatus = 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected';

type IdentityVerificationState = {
  status: IdentityVerificationStatus | null;
};

// unpaid y payment_disagreement las abre el cobro (src/servicePayment.ts), no el cliente.
type DisputeCategory = 'incomplete_work' | 'incorrect_charge' | 'vehicle_damage' | 'other' | 'unpaid' | 'payment_disagreement';
type DisputeStatus = 'reported' | 'under_review' | 'resolved';

type AdminDispute = {
  id: number;
  serviceRequestId: number;
  category: DisputeCategory;
  description: string;
  status: DisputeStatus;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  customerName: string;
  mechanicName?: string | null;
  openedBy?: 'customer' | 'mechanic' | 'system';
};

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

const expoHost = Constants.expoConfig?.hostUri?.split(':')[0];
const defaultApiBaseUrl =
  Platform.OS === 'web'
    ? 'http://localhost:4000'
    : expoHost
      ? `http://${expoHost}:4000`
      : 'http://10.0.2.2:4000';
// Fuera de desarrollo siempre es el servidor de Render: una actualización
// por EAS Update no trae las variables del build, y sin esto apuntaría a la
// computadora de desarrollo.
const PRODUCTION_API_BASE_URL = 'https://mecanifique.onrender.com';
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || (__DEV__ ? defaultApiBaseUrl : PRODUCTION_API_BASE_URL);
const AUTH_TOKEN_KEY = 'mecanifique.auth.token';
const AUTH_USER_KEY = 'mecanifique.auth.user';
const AUTH_REFRESH_KEY = 'mecanifique.auth.refresh';
// Identificador de este teléfono para la verificación por SMS (lo crea el
// servidor al confirmar el primer código). No se borra al cerrar sesión.
const DEVICE_ID_KEY = 'mecanifique.device.id';
const SESSION_EXPIRED_MESSAGE = 'Tu sesión expiró. Vuelve a iniciar sesión.';
const ONBOARDING_KEY = 'mecanifique.onboarding.seen';
// El servidor (Render gratis) se duerme tras 15 min sin uso y tarda de 30 a
// 60 s en despertar: la petición no se corta antes de eso. Si tarda más de
// SLOW_REQUEST_NOTICE_MS, se avisa arriba que se está conectando.
const API_REQUEST_TIMEOUT_MS = 70_000;
const SLOW_REQUEST_NOTICE_MS = 5_000;
const STATUS_REFRESH_INTERVAL_MS = 10_000;
const APP_LOGO_IMAGE = require('./assets/logo.png');

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});
WebBrowser.maybeCompleteAuthSession();

const ONBOARDING_STEPS = [
  {
    title: 'Encuentra mecánicos cerca de ti',
    body: 'Busca por zona o GPS y ve perfiles públicos con calificaciones, estado y contacto.',
    image: ILLUSTRATIONS.search,
  },
  {
    title: 'Solicita un servicio',
    body: 'Pide ayuda directo a un mecánico, reserva turnos y sigue el flujo del servicio.',
    image: ILLUSTRATIONS.profileReview,
  },
  {
    title: 'Mecánicos se conectan y reciben solicitudes',
    body: 'El mecánico se conecta, recibe solicitudes y avisa cada paso del servicio.',
    image: ILLUSTRATIONS.firstRequest,
  },
] as const;

// Valores de relleno del formulario de solicitud; el GPS los reemplaza
// apenas hay ubicación (pero nunca pisa lo que el usuario escribió).
const DEFAULT_REQUEST_CITY = 'Aguascalientes';
const DEFAULT_REQUEST_ZONE = 'Norte';

// Primer nombre para el saludo. Si la cuenta todavía no tiene nombre, el
// servidor pone el correo en fullName: en ese caso no se muestra nada (el
// nombre se agrega en Cuenta → Información personal).
function getFirstName(fullName: string | undefined): string {
  const name = (fullName || '').trim();
  if (!name || name.includes('@')) {
    return '';
  }
  return name.split(/\s+/)[0];
}

function splitGalleryUrls(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getScreenTitle(screen: AppScreen, role: Role | undefined): string {
  switch (screen) {
    case 'home':
      return role === 'mechanic' ? 'Panel de servicio' : 'Inicio';
    case 'mechanics':
      return 'Encuentra tu mecánico';
    case 'requests':
      return 'Tus solicitudes';
    case 'map':
      return 'Tu zona de trabajo';
    case 'actions':
      return 'Acciones';
    case 'account':
      return 'Tu cuenta';
    case 'vehicles':
      return 'Mis vehículos';
    case 'community':
      return 'Comunidad';
    case 'promotions':
      return 'Promociones';
    case 'notifications':
      return 'Notificaciones';
    default:
      return 'Mecanifique';
  }
}

export default function App() {
  const {
    token, setToken,
    user, setUser,
    loadingSession, setLoadingSession,
    busy, setBusy,
    message, setMessage,
    currentScreen, setCurrentScreen,
    requestsView, setRequestsView,
    actionsView, setActionsView,
    requestCreateStep, setRequestCreateStep,
    mechanicSignupStep, setMechanicSignupStep,
    mechanics, setMechanics,
    myRequests, setMyRequests,
    nearbyMechanics, setNearbyMechanics,
    vehicles, setVehicles,
    selectedRequest, setSelectedRequest,
    incomingRequest, setIncomingRequest,
    requestMessages, setRequestMessages,
    messageDraft, setMessageDraft,
    currentLocation, setCurrentLocation,
    mechanicConnection, setMechanicConnection,
    notifications, setNotifications,
    unreadNotifications, setUnreadNotifications,
    identityState, setIdentityState,
    identityBusy, setIdentityBusy,
  } = useAppContext();
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [mechanicProfile, setMechanicProfile] = useState<MechanicProfile | null>(null);
  const [onboardingSeen, setOnboardingSeen] = useState<boolean | null>(null);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [locationAutoRequested, setLocationAutoRequested] = useState(false);
  const [mechanicSlots, setMechanicSlots] = useState<ScheduleSlot[]>([]);
  const [selectedMechanicReviews, setSelectedMechanicReviews] = useState<MechanicReview[]>([]);
  const [selectedMechanicReviewStats, setSelectedMechanicReviewStats] = useState<{ averageRating: number | null; reviewCount: number }>({
    averageRating: null,
    reviewCount: 0,
  });
  const [requestMechanicSlots, setRequestMechanicSlots] = useState<ScheduleSlot[]>([]);
  const [selectedActionRequest, setSelectedActionRequest] = useState<ServiceRequest | RequestSummary | null>(null);

  const [loginForm, setLoginForm] = useState({
    email: '',
    password: '',
  });

  const [customerForm, setCustomerForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
  });

  const [mechanicForm, setMechanicForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    city: 'Aguascalientes',
    zone: 'Norte',
    yearsExperience: '0',
    specialties: 'Motor,Electrico',
    latitude: '',
    longitude: '',
  });

  const [requestForm, setRequestForm] = useState({
    vehicleMake: '',
    vehicleModel: '',
    vehicleYear: '2020',
    issueDescription: '',
    preferredTime: '',
    city: DEFAULT_REQUEST_CITY,
    zone: DEFAULT_REQUEST_ZONE,
    serviceAddress: '',
    customerId: '',
    requestedMechanicId: '',
    scheduleSlotId: '',
    latitude: '',
    longitude: '',
  });

  const [mechanicsFilter, setMechanicsFilter] = useState({
    city: '',
    zone: '',
  });

  const [requestLookupId, setRequestLookupId] = useState('');
  const [assignForm, setAssignForm] = useState({
    requestId: '',
    mechanicId: '',
  });
  const [statusForm, setStatusForm] = useState({
    mechanicId: '',
    status: 'active' as MechanicStatus,
  });
  const [serviceStatusForm, setServiceStatusForm] = useState({
    requestId: '',
    status: 'en_route' as ServiceRequestStatus,
  });
  const [availabilityForm, setAvailabilityForm] = useState({
    mechanicId: '',
    isAvailable: 'true',
  });
  const [slotForm, setSlotForm] = useState({
    mechanicId: '',
    slotDate: '',
    startTime: '',
    endTime: '',
    note: '',
  });
  const [favoriteMechanics, setFavoriteMechanics] = useState<FavoriteMechanic[]>([]);
  // Cuota de servicio (Stripe). Si está activa, el cliente la paga antes de
  // enviar su solicitud; paidFeeSession guarda un pago hecho cuya solicitud
  // todavía no se creó (para no cobrarle dos veces si algo falla).
  const [serviceFeeConfig, setServiceFeeConfig] = useState<{ enabled: boolean; amount: number }>({ enabled: false, amount: 49 });
  const paidFeeSession = useRef<string | null>(null);
  // Aviso "Conectando con el servidor…" mientras haya peticiones lentas.
  const [serverWaking, setServerWaking] = useState(false);
  const slowRequestCount = useRef(0);
  const [communityView, setCommunityView] = useState<CommunityView>({ mode: 'list' });
  // En Mecánicos, el perfil de uno se ve solo en pantalla, no debajo de la
  // lista (antes había que bajar a buscarlo).
  const [mechanicsView, setMechanicsView] = useState<'list' | 'profile'>('list');
  // El seguimiento en segundo plano del mecánico está corriendo (en Expo Go
  // no se puede y se usa el de primer plano).
  const [backgroundTracking, setBackgroundTracking] = useState(false);
  const mainScrollRef = useRef<ScrollView>(null);
  // Notificaciones se abre desde cualquier pantalla (campana de arriba);
  // "atrás" regresa a donde estaba.
  const notificationsReturnScreen = useRef<AppScreen>('home');
  // Push que el usuario tocó; se abre en cuanto haya sesión.
  const [pushTarget, setPushTarget] = useState<AppNotification | null>(null);
  // Verificación por teléfono pendiente (ver PhoneVerificationScreen).
  const deviceIdRef = useRef<string | null>(null);
  const [phoneVerification, setPhoneVerification] = useState<PhoneVerificationStatus | null>(null);
  // Actualización descargada por EAS Update, lista para aplicarse.
  const [updateReady, setUpdateReady] = useState(false);
  const [publicProfileForm, setPublicProfileForm] = useState({
    bio: '',
    coverPhotoUrl: '',
    galleryUrls: '',
    laborRate: '',
  });
  // La calificación empieza sin elegir: es obligatoria y debe ser a conciencia.
  const [reviewForm, setReviewForm] = useState({
    rating: '',
    comment: '',
  });
  const [disputeForm, setDisputeForm] = useState({
    category: 'incomplete_work' as 'incomplete_work' | 'incorrect_charge' | 'vehicle_damage' | 'other',
    description: '',
  });
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [adminDisputes, setAdminDisputes] = useState<AdminDispute[]>([]);
  const [disputeResolutionNotes, setDisputeResolutionNotes] = useState<Record<number, string>>({});
  const [disputeRefundAmounts, setDisputeRefundAmounts] = useState<Record<number, string>>({});

  const selectedMechanicId = useMemo(() => user?.mechanicId?.toString() || '', [user]);
  const currentUser = user;
  const [mechanicCursor, setMechanicCursor] = useState(0);
  const [mechanicReviewsExpanded, setMechanicReviewsExpanded] = useState(false);
  const [selectedScheduleDate, setSelectedScheduleDate] = useState('');
  const [selectedRequestScheduleDate, setSelectedRequestScheduleDate] = useState('');
  const actionOptions = useMemo<Array<{ key: ActionsView; label: string }>>(() => {
    if (currentUser?.role === 'admin') {
      return [
        { key: 'assign', label: 'Asignar' },
        { key: 'status', label: 'Estado' },
        { key: 'requestStatus', label: 'Solicitud' },
        { key: 'availability', label: 'Disponib.' },
        { key: 'schedule', label: 'Agenda' },
      ];
    }
    if (currentUser?.role === 'mechanic') {
      return [
        { key: 'update', label: 'Updates' },
        { key: 'requestStatus', label: 'Solicitud' },
        { key: 'schedule', label: 'Agenda' },
      ];
    }
    return [];
  }, [currentUser?.role]);
  const scheduleDates = useMemo(() => {
    return Array.from(new Set(mechanicSlots.map((slot) => slot.slotDate))).slice(0, 7);
  }, [mechanicSlots]);
  const filteredScheduleSlots = useMemo(() => {
    if (!selectedScheduleDate) {
      return mechanicSlots;
    }
    return mechanicSlots.filter((slot) => slot.slotDate === selectedScheduleDate);
  }, [mechanicSlots, selectedScheduleDate]);
  const requestMechanicIdNumber = requestForm.requestedMechanicId ? Number(requestForm.requestedMechanicId) : null;
  // Lo que el cliente puede apartar: turnos de los próximos 7 días (ver
  // BOOKING_WINDOW_DAYS). El mecánico sí ve toda su agenda.
  const bookableMechanicSlots = useMemo(
    () => mechanicSlots.filter((slot) => isWithinBookingWindow(slot.slotDate)),
    [mechanicSlots],
  );
  const bookableScheduleDates = useMemo(
    () => Array.from(new Set(bookableMechanicSlots.map((slot) => slot.slotDate))),
    [bookableMechanicSlots],
  );
  const bookableFilteredSlots = useMemo(
    () =>
      selectedScheduleDate
        ? bookableMechanicSlots.filter((slot) => slot.slotDate === selectedScheduleDate)
        : bookableMechanicSlots,
    [bookableMechanicSlots, selectedScheduleDate],
  );
  const bookableRequestSlots = useMemo(
    () => requestMechanicSlots.filter((slot) => isWithinBookingWindow(slot.slotDate)),
    [requestMechanicSlots],
  );
  const requestMechanicSlotsDates = useMemo(() => {
    return Array.from(new Set(bookableRequestSlots.map((slot) => slot.slotDate)));
  }, [bookableRequestSlots]);
  const requestFilteredSlots = useMemo(() => {
    if (!selectedRequestScheduleDate) {
      return bookableRequestSlots;
    }
    return bookableRequestSlots.filter((slot) => slot.slotDate === selectedRequestScheduleDate);
  }, [bookableRequestSlots, selectedRequestScheduleDate]);
  const liveLocationRequest = useMemo(
    () =>
      user?.role === 'mechanic'
        ? myRequests.find((request) => request.status !== 'completed' && request.status !== 'cancelled')
        : undefined,
    [myRequests, user?.role],
  );
  // Servicio en segundo plano del mecánico (ver liveTracking.ts): en camino o
  // por refacciones, el cliente lo sigue en el radar; conectado y esperando,
  // sigue recibiendo solicitudes aunque cambie de app.
  const backgroundReason: TrackingReason | null =
    liveLocationRequest?.status === 'en_route' || liveLocationRequest?.status === 'awaiting_parts'
      ? liveLocationRequest.status
      : user?.role === 'mechanic' && mechanicConnection === 'online'
        ? 'online'
        : null;

  useEffect(() => {
    async function restoreSession() {
      let hadSession = false;
      deviceIdRef.current = await SecureStore.getItemAsync(DEVICE_ID_KEY).catch(() => null);
      try {
        let [storedToken, storedUser, storedRefreshToken] = await Promise.all([
          SecureStore.getItemAsync(AUTH_TOKEN_KEY),
          SecureStore.getItemAsync(AUTH_USER_KEY),
          SecureStore.getItemAsync(AUTH_REFRESH_KEY),
        ]);

        if (!storedToken || !storedUser) {
          // Migración: versiones anteriores guardaban la sesión sin cifrar en
          // AsyncStorage. Si existe, la movemos a SecureStore y limpiamos el
          // valor viejo, para no forzar un re-login a usuarios existentes.
          const [legacyToken, legacyUser] = await Promise.all([
            AsyncStorage.getItem(AUTH_TOKEN_KEY),
            AsyncStorage.getItem(AUTH_USER_KEY),
          ]);
          if (legacyToken && legacyUser) {
            storedToken = legacyToken;
            storedUser = legacyUser;
            await Promise.all([
              SecureStore.setItemAsync(AUTH_TOKEN_KEY, legacyToken),
              SecureStore.setItemAsync(AUTH_USER_KEY, legacyUser),
              AsyncStorage.removeItem(AUTH_TOKEN_KEY),
              AsyncStorage.removeItem(AUTH_USER_KEY),
            ]);
          }
        }

        const storedOnboarding = await AsyncStorage.getItem(ONBOARDING_KEY);

        if (storedToken && storedUser) {
          const parsedUser = JSON.parse(storedUser) as AuthUser;
          hadSession = true;
          tokenRef.current = storedToken;
          refreshTokenRef.current = storedRefreshToken;
          setToken(storedToken);
          setUser(parsedUser);

          // Si el token guardado ya venció, apiRequest lo renueva solo y
          // deja el token nuevo en tokenRef.
          const me = await apiRequest<{ user: Partial<AuthUser> }>('/auth/v2/me', {
            token: storedToken,
          });

          const restoredUser = {
            ...parsedUser,
            ...me.user,
            fullName: me.user.fullName || parsedUser.fullName || me.user.login || '',
          } as AuthUser;
          setUser(restoredUser);
          await persistSession(tokenRef.current, restoredUser);
        }

        setOnboardingSeen(storedToken && storedUser ? true : storedOnboarding === '1');
        if (!storedToken || !storedUser) {
          return;
        }
      } catch (error) {
        const sessionRejected = error instanceof ApiError && error.status === 401;
        if (hadSession && !sessionRejected) {
          // Sin conexión o servidor dormido: conservamos la sesión guardada.
          // Las siguientes peticiones la renuevan, o la cierran si de verdad
          // ya no es válida.
          setOnboardingSeen(true);
        } else {
          await clearSession();
          setOnboardingSeen(hadSession);
          if (sessionRejected) {
            setMessage(SESSION_EXPIRED_MESSAGE);
          }
        }
      } finally {
        setLoadingSession(false);
      }
    }

    restoreSession();
  }, []);

  useEffect(() => {
    loadMechanics().catch((error) => setMessage(formatError(error)));
  }, []);

  useEffect(() => {
    if (!user || !token) {
      setMyRequests([]);
      return;
    }

    loadMyRequests().catch((error) => setMessage(formatError(error)));
  }, [user, token]);

  useEffect(() => {
    if (user?.role !== 'admin' || !token) {
      setAdminDisputes([]);
      return;
    }
    loadAdminDisputes().catch((error) => setMessage(formatError(error)));
  }, [user, token]);

  useEffect(() => {
    if (user?.role !== 'customer' || !token) {
      setVehicles([]);
      return;
    }
    loadVehicles().catch((error) => setMessage(formatError(error)));
  }, [user, token]);

  useEffect(() => {
    if (!user || !token || user.role === 'admin') {
      setIdentityState({ status: null });
      return;
    }
    apiRequest<{ verification: { status: IdentityVerificationStatus } | null }>(
      '/api/identity-verification',
      { token },
    )
      .then((data) => setIdentityState({ status: data.verification?.status ?? 'draft' }))
      .catch(() => {
        // Silencioso: si falla, la tarjeta simplemente no se muestra con
        // datos; no interrumpimos el resto de la app por esto.
      });
  }, [user, token]);

  useEffect(() => {
    if (user?.role !== 'mechanic' || !token) {
      setMechanicProfile(null);
      return;
    }
    loadMechanicProfile().catch(() => undefined);
  }, [user, token, identityState.status]);

  // La aprobación de identidad llega sola por el servidor (webhook de Didit),
  // en cualquier momento: mientras la cuenta no esté activa se revisa cada
  // 20 s, para que el checklist avance y CONECTARME se habilite sin tener
  // que cerrar y abrir la app.
  useEffect(() => {
    if (user?.role !== 'mechanic' || !token || !mechanicProfile || mechanicProfile.status === 'active') {
      return;
    }
    const intervalId = setInterval(() => {
      loadMechanicProfile().catch(() => undefined);
    }, 20_000);
    return () => clearInterval(intervalId);
  }, [user, token, mechanicProfile?.status]);

  useEffect(() => {
    if (!selectedRequest || !token) {
      setRequestMessages([]);
      return;
    }

    loadRequestMessages(selectedRequest.id).catch((error) => setMessage(formatError(error)));
  }, [selectedRequest?.id, token]);

  useEffect(() => {
    if (!user || !token) {
      setNotifications([]);
      setUnreadNotifications(0);
      return;
    }

    checkPhoneVerification().catch(() => undefined);
    loadNotifications().catch((error) => setMessage(formatError(error)));
    // Sin avisos push la app sigue funcionando; el error queda en el log
    // (adb logcat) para poder diagnosticar por qué un teléfono no se registró.
    registerPushToken(token).catch((error) => console.warn('No se pudo registrar para avisos push:', error));
    loadFavorites().catch(() => undefined);
    loadServiceFeeConfig().catch(() => undefined);
  }, [user?.id, token]);

  useEffect(() => {
    if (actionOptions.length === 0) {
      return;
    }
    if (!actionOptions.some((option) => option.key === actionsView)) {
      setActionsView(actionOptions[0].key);
    }
  }, [actionOptions, actionsView]);

  useEffect(() => {
    if (authMode !== 'mechanic') {
      setMechanicSignupStep('account');
    }
  }, [authMode]);

  useEffect(() => {
    if (requestsView !== 'create') {
      setRequestCreateStep('vehicle');
    }
  }, [requestsView]);

  // Al entrar a crear una solicitud, si el cliente ya tiene vehículos se
  // precarga el principal y se salta directo a los detalles (antes se le
  // preguntaba el vehículo cada vez). Puede cambiarlo desde ahí.
  useEffect(() => {
    if (requestsView !== 'create' || user?.role !== 'customer') {
      return;
    }
    const primaryVehicle = vehicles.find((vehicle) => vehicle.isPrimary) ?? vehicles[0];
    if (primaryVehicle && !requestForm.vehicleMake.trim()) {
      setRequestForm((current) => ({
        ...current,
        vehicleMake: primaryVehicle.make,
        vehicleModel: primaryVehicle.model,
        vehicleYear: String(primaryVehicle.year),
      }));
    }
    if (primaryVehicle || requestForm.vehicleMake.trim()) {
      setRequestCreateStep('details');
    }
  }, [requestsView]);

  // La ubicación del formulario se llena sola con el GPS una vez por sesión
  // (la geocodificación inversa no debe repetirse en cada refresco).
  const requestLocationPrefilled = useRef(false);
  // Últimos tokens de sesión, para leerlos fuera del ciclo de render (el
  // estado `token` puede ir un render atrasado justo después de renovarlo).
  const tokenRef = useRef('');
  const refreshTokenRef = useRef<string | null>(null);
  const renewSessionInFlight = useRef<Promise<string | null> | null>(null);
  useEffect(() => {
    if (user?.role !== 'customer' || !currentLocation || requestLocationPrefilled.current) {
      return;
    }
    requestLocationPrefilled.current = true;
    void fillRequestLocation(currentLocation, false);
  }, [user?.role, currentLocation]);

  useEffect(() => {
    if (!requestMechanicIdNumber || Number.isNaN(requestMechanicIdNumber)) {
      setRequestMechanicSlots([]);
      setSelectedRequestScheduleDate('');
      return;
    }

    loadRequestMechanicSlots(requestMechanicIdNumber).catch((error) => setMessage(formatError(error)));
  }, [requestMechanicIdNumber]);

  useEffect(() => {
    if (currentUser?.role === 'mechanic' && currentScreen === 'mechanics') {
      setCurrentScreen('home');
    }
  }, [currentUser?.role, currentScreen]);

  // Sin esto, el botón "atrás" de Android cerraba la app desde cualquier
  // pantalla: la navegación es por estado (currentScreen), no un stack
  // nativo. Convención de Android para apps con pestañas: atrás retrocede
  // una sub-vista, luego vuelve a Inicio, y desde Inicio sale de la app.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!user) {
        if (onboardingSeen === false && onboardingStep > 0) {
          setOnboardingStep((step) => step - 1);
          return true;
        }
        if (authMode === 'mechanic' && mechanicSignupStep === 'work') {
          setMechanicSignupStep('account');
          return true;
        }
        if (onboardingSeen !== false && authMode !== 'login') {
          setAuthMode('login');
          return true;
        }
        return false;
      }

      return goBackInApp();
    });
    return () => subscription.remove();
  }, [user, onboardingSeen, onboardingStep, authMode, mechanicSignupStep, currentScreen, requestsView, requestCreateStep, communityView, mechanicsView]);

  // EAS Update: al abrir la app y al volver a ella se busca una versión
  // nueva; si hay, se descarga y aparece un aviso para aplicarla (reinicia
  // la app). Si no se toca, se aplica sola la próxima vez que se abra.
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) {
      return;
    }
    const check = () => {
      Updates.checkForUpdateAsync()
        .then(async (result) => {
          if (!result.isAvailable) return;
          await Updates.fetchUpdateAsync();
          setUpdateReady(true);
        })
        .catch(() => undefined);
    };
    check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => subscription.remove();
  }, []);

  const refreshUserRef = useRef(refreshUserFromServer);
  refreshUserRef.current = refreshUserFromServer;
  const wakeServerRef = useRef(() => apiRequest('/health'));
  wakeServerRef.current = () => apiRequest('/health');
  useEffect(() => {
    // Mientras alguien ve Onboarding o escribe su contraseña, el servidor ya
    // se está despertando.
    wakeServerRef.current().catch(() => undefined);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        wakeServerRef.current().catch(() => undefined);
        refreshUserRef.current().catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, []);

  // Compartida por el gesto/botón "atrás" de Android y la flecha visible del
  // encabezado, para que nunca se comporten distinto.
  const canGoBackInApp = currentScreen !== 'home';

  function goBackInApp(): boolean {
    if (currentScreen === 'requests' && requestsView === 'create' && requestCreateStep === 'details') {
      setRequestCreateStep('vehicle');
      return true;
    }
    if (currentScreen === 'requests' && requestsView !== 'list') {
      setRequestsView('list');
      return true;
    }
    if (currentScreen === 'vehicles') {
      setCurrentScreen('account');
      return true;
    }
    if (currentScreen === 'community' && communityView.mode !== 'list') {
      setCommunityView({ mode: 'list' });
      return true;
    }
    if (currentScreen === 'mechanics' && mechanicsView === 'profile') {
      setMechanicsView('list');
      return true;
    }
    if (currentScreen === 'notifications') {
      setCurrentScreen(notificationsReturnScreen.current);
      return true;
    }
    if (currentScreen === 'community' || currentScreen === 'promotions') {
      setCurrentScreen(user?.role === 'customer' ? 'account' : 'actions');
      return true;
    }
    if (currentScreen !== 'home') {
      setCurrentScreen('home');
      return true;
    }
    return false;
  }

  // Al volver a Mecánicos desde otra pantalla se ve la lista, no el último
  // perfil abierto.
  useEffect(() => {
    if (currentScreen !== 'mechanics') {
      setMechanicsView('list');
    }
  }, [currentScreen]);

  // Abrir o cerrar un perfil empieza desde arriba de la pantalla.
  useEffect(() => {
    mainScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [mechanicsView]);

  useEffect(() => {
    if (mechanics.length === 0) {
      setMechanicCursor(0);
      return;
    }

    if (mechanicCursor >= mechanics.length) {
      setMechanicCursor(mechanics.length - 1);
    }
  }, [mechanics, mechanicCursor]);

  useEffect(() => {
    const activeMechanic = mechanics[mechanicCursor];
    if (!activeMechanic) {
      setMechanicSlots([]);
      setSelectedMechanicReviews([]);
      setSelectedMechanicReviewStats({ averageRating: null, reviewCount: 0 });
      setSelectedScheduleDate('');
      return;
    }

    loadMechanicSlots(activeMechanic.id).catch((error) => setMessage(formatError(error)));
    loadMechanicReviews(activeMechanic.id).catch((error) => setMessage(formatError(error)));
  }, [mechanicCursor, mechanics]);

  useEffect(() => {
    if (loadingSession || locationAutoRequested) {
      return;
    }

    setLocationAutoRequested(true);
    requestCurrentLocation().catch((error) => setMessage(`Ubicación no disponible: ${formatError(error)}`));
  }, [loadingSession, locationAutoRequested]);

  useEffect(() => {
    if (mechanicSlots.length === 0) {
      setSelectedScheduleDate('');
      return;
    }

    if (!selectedScheduleDate || !mechanicSlots.some((slot) => slot.slotDate === selectedScheduleDate)) {
      setSelectedScheduleDate(mechanicSlots[0].slotDate);
    }
  }, [mechanicSlots, selectedScheduleDate]);

  useEffect(() => {
    if (user?.role !== 'mechanic' || !user.mechanicId) {
      return;
    }

    const myMechanic = mechanics.find((mechanic) => mechanic.id === user.mechanicId);
    if (myMechanic) {
      setMechanicConnection(myMechanic.isOnline ? 'online' : 'offline');
      setPublicProfileForm({
        bio: myMechanic.bio || '',
        coverPhotoUrl: myMechanic.coverPhotoUrl || '',
        galleryUrls: myMechanic.gallery ? myMechanic.gallery.join(', ') : '',
        laborRate: myMechanic.laborRate != null ? String(myMechanic.laborRate) : '',
      });
    }
  }, [mechanics, user]);

  // Cómo manda la ubicación la tarea de segundo plano: con la sesión actual y
  // la renovación del token de apiRequest.
  useEffect(() => {
    const mechanicId = user?.role === 'mechanic' ? user.mechanicId : null;
    if (!mechanicId || !token) {
      setLiveTrackingSender(null);
      return;
    }
    setLiveTrackingSender((coords) =>
      apiRequest<{ tracking?: boolean }>(`/api/mechanics/${mechanicId}/location`, {
        method: 'PATCH',
        token: tokenRef.current,
        body: coords,
      }),
    );
  }, [user?.role, user?.mechanicId, token]);

  // Servicio en segundo plano mientras está conectado, va en camino o fue
  // por refacciones (ver liveTracking.ts). Se vuelve a intentar al regresar
  // a la app, por si el sistema lo apagó. Si no se puede (Expo Go), queda el
  // de primer plano de abajo.
  const signedIn = Boolean(token);
  const loadMechanicProfileRef = useRef(loadMechanicProfile);
  loadMechanicProfileRef.current = loadMechanicProfile;
  useEffect(() => {
    if (!backgroundReason || !signedIn) {
      setBackgroundTracking(false);
      stopLiveTracking().catch(() => undefined);
      return;
    }
    let cancelled = false;
    const start = () => {
      startLiveTracking(backgroundReason)
        .then(() => {
          if (!cancelled) setBackgroundTracking(true);
        })
        .catch((error) => {
          console.warn('Seguimiento en segundo plano no disponible:', error);
          if (!cancelled) setBackgroundTracking(false);
        });
    };
    start();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        start();
        // Si el servidor lo desconectó mientras la app estaba cerrada, que
        // la pantalla lo diga en cuanto vuelve.
        loadMechanicProfileRef.current().catch(() => undefined);
      }
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [backgroundReason, signedIn]);

  useEffect(() => {
    if (
      user?.role !== 'mechanic' ||
      !user.mechanicId ||
      mechanicConnection !== 'online' ||
      !liveLocationRequest ||
      !token ||
      backgroundTracking
    ) {
      return;
    }

    let subscription: Location.LocationSubscription | undefined;
    let cancelled = false;

    Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 15_000,
        distanceInterval: 50,
      },
      (location) => {
        if (cancelled) {
          return;
        }
        const { latitude, longitude } = location.coords;
        setCurrentLocation({ latitude, longitude });
        apiRequest(`/api/mechanics/${user.mechanicId}/location`, {
          method: 'PATCH',
          token,
          body: { latitude, longitude },
        }).catch((error) => setMessage(`No se pudo actualizar tu ubicación: ${formatError(error)}`));
      },
    )
      .then((nextSubscription) => {
        if (cancelled) {
          nextSubscription.remove();
          return;
        }
        subscription = nextSubscription;
      })
      .catch((error) => setMessage(`No se pudo iniciar ubicación en vivo: ${formatError(error)}`));

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [liveLocationRequest, mechanicConnection, token, user?.mechanicId, user?.role, backgroundTracking]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (user && token) {
        loadNotifications().catch((error) => setMessage(`No se pudo refrescar notificaciones: ${formatError(error)}`));
      }
      if (currentLocation) {
        loadNearbyMechanics(currentLocation.latitude, currentLocation.longitude).catch((error) =>
          setMessage(`No se pudo refrescar cercanos: ${formatError(error)}`)
        );
      }

      // Siempre, aunque tenga una solicitud abierta: así ve las nuevas y el
      // servidor sabe que sigue conectado (sweepStaleMechanics).
      if (user?.role === 'mechanic' && mechanicConnection === 'online') {
        loadIncomingRequest().catch((error) => setMessage(formatError(error)));
      }

      if (!selectedRequest?.id) {
        return;
      }

      apiRequest<ServiceRequest>(`/service-requests/${selectedRequest.id}`, { token })
        .then((request) => setSelectedRequest(request))
        .catch((error) => setMessage(`No se pudo refrescar solicitud: ${formatError(error)}`));
      // Silencioso a propósito: un fallo puntual no debe mostrar un aviso cada 10 s.
      loadRequestMessages(selectedRequest.id).catch(() => undefined);

      if (user?.role === 'mechanic' && mechanicConnection === 'online') {
        loadIncomingRequest().catch((error) => setMessage(formatError(error)));
      }
    }, STATUS_REFRESH_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [currentLocation, selectedRequest?.id, user?.role, mechanicConnection, user, token]);

  // Tocar un push en el teléfono abre lo que avisa (antes solo abría la app
  // donde se había quedado, y había que buscar la solicitud a mano). Sirve
  // también si el push abrió la app estando cerrada.
  useEffect(() => {
    const toNotification = (response: Notifications.NotificationResponse): AppNotification => {
      const content = response.notification.request.content;
      const data = (content.data ?? {}) as Record<string, unknown>;
      return {
        id: Number(data.notificationId) || 0,
        title: content.title ?? '',
        body: content.body ?? '',
        dataJson: JSON.stringify(data),
        readAt: null,
        createdAt: '',
      };
    };
    const receive = (response: Notifications.NotificationResponse) => {
      setPushTarget(toNotification(response));
      try {
        Notifications.clearLastNotificationResponse();
      } catch {
        // Solo evita repetirla la próxima vez que se abra la app.
      }
    };
    try {
      const last = Notifications.getLastNotificationResponse();
      if (last) receive(last);
    } catch {
      // Sin push en este teléfono (emulador sin Google Play, etc.).
    }
    const subscription = Notifications.addNotificationResponseReceivedListener(receive);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!pushTarget || !user || !token) return;
    setPushTarget(null);
    void handleOpenNotification(pushTarget);
  }, [pushTarget, user, token]);

  // nextRefreshToken: string para guardar uno nuevo, null para borrarlo,
  // undefined para dejar el que ya estaba (ej. al cambiar de modo).
  async function persistSession(nextToken: string, nextUser: AuthUser | null, nextRefreshToken?: string | null) {
    if (!nextUser) {
      await clearSession();
      return;
    }

    tokenRef.current = nextToken;
    const writes = [
      SecureStore.setItemAsync(AUTH_TOKEN_KEY, nextToken),
      SecureStore.setItemAsync(AUTH_USER_KEY, JSON.stringify(nextUser)),
    ];
    if (nextRefreshToken !== undefined) {
      refreshTokenRef.current = nextRefreshToken;
      writes.push(
        nextRefreshToken
          ? SecureStore.setItemAsync(AUTH_REFRESH_KEY, nextRefreshToken)
          : SecureStore.deleteItemAsync(AUTH_REFRESH_KEY),
      );
    }
    await Promise.all(writes);
  }

  // El access token de Supabase vence a la hora. Con el refresh token
  // pedimos uno nuevo sin molestar al usuario. Varias peticiones que fallan a
  // la vez comparten una sola renovación (Supabase rota el refresh token en
  // cada uso, así que no deben pedirse dos en paralelo).
  // Devuelve el token nuevo, o null si la sesión ya no se puede renovar.
  function renewSession(): Promise<string | null> {
    if (!renewSessionInFlight.current) {
      renewSessionInFlight.current = (async () => {
        const refreshToken = refreshTokenRef.current;
        if (!refreshToken) {
          return null;
        }
        try {
          const renewed = await apiRequest<RenewedSession>('/auth/v2/refresh', {
            method: 'POST',
            body: { refreshToken },
          });
          refreshTokenRef.current = renewed.refreshToken;
          tokenRef.current = renewed.accessToken;
          setToken(renewed.accessToken);
          await Promise.all([
            SecureStore.setItemAsync(AUTH_TOKEN_KEY, renewed.accessToken),
            SecureStore.setItemAsync(AUTH_REFRESH_KEY, renewed.refreshToken),
          ]);
          return renewed.accessToken;
        } catch (error) {
          if (error instanceof ApiError && (error.status === 401 || error.status === 400)) {
            return null;
          }
          throw error;
        }
      })().finally(() => {
        renewSessionInFlight.current = null;
      });
    }
    return renewSessionInFlight.current;
  }

  // Cerrar sesión desconecta al mecánico: sin sesión no puede recibir
  // solicitudes ni desconectarse después.
  async function handleLogout() {
    if (user?.role === 'mechanic' && user.mechanicId && mechanicConnection === 'online' && token) {
      await apiRequest(`/api/mechanics/${user.mechanicId}/online`, {
        method: 'PATCH',
        token,
        body: { isOnline: false },
      }).catch(() => undefined);
    }
    await stopLiveTracking();
    await clearSession();
  }

  async function clearSession() {
    paidFeeSession.current = null;
    tokenRef.current = '';
    refreshTokenRef.current = null;
    setToken('');
    setUser(null);
    setIncomingRequest(null);
    setSelectedRequest(null);
    setRequestMessages([]);
    setMessageDraft('');
    setSelectedMechanicReviews([]);
    setSelectedMechanicReviewStats({ averageRating: null, reviewCount: 0 });
    setNotifications([]);
    setUnreadNotifications(0);
    setRequestMechanicSlots([]);
    setSelectedRequestScheduleDate('');
    setMechanicConnection('offline');
    setLocationAutoRequested(false);
    requestLocationPrefilled.current = false;
    await Promise.all([
      SecureStore.deleteItemAsync(AUTH_TOKEN_KEY),
      SecureStore.deleteItemAsync(AUTH_USER_KEY),
      SecureStore.deleteItemAsync(AUTH_REFRESH_KEY),
      AsyncStorage.removeItem(AUTH_TOKEN_KEY),
      AsyncStorage.removeItem(AUTH_USER_KEY),
    ]);
  }

  // "¿Olvidaste tu contraseña?": Supabase manda un enlace que abre la página
  // para crear la nueva (servidor: src/passwordReset.ts).
  async function handleForgotPassword(email: string) {
    const trimmed = email.trim();
    if (!trimmed.includes('@')) {
      setMessage('Escribe tu correo arriba y vuelve a tocar «¿Olvidaste tu contraseña?»');
      return;
    }
    setBusy(true);
    try {
      const response = await apiRequest<{ message: string }>('/auth/v2/forgot-password', {
        method: 'POST',
        body: { email: trimmed },
      });
      setMessage(response.message);
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  // "¿No te llegó el correo de confirmación?": Supabase lo manda otra vez.
  async function handleResendConfirmation(email: string) {
    const trimmed = email.trim();
    if (!trimmed.includes('@')) {
      setMessage('Escribe tu correo arriba y vuelve a tocar «¿No te llegó el correo de confirmación?»');
      return;
    }
    setBusy(true);
    try {
      const response = await apiRequest<{ message: string }>('/auth/v2/resend-confirmation', {
        method: 'POST',
        body: { email: trimmed },
      });
      setMessage(response.message);
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function completeOnboarding() {
    await AsyncStorage.setItem(ONBOARDING_KEY, '1');
    setOnboardingSeen(true);
  }

  async function showOnboardingAgain() {
    await AsyncStorage.removeItem(ONBOARDING_KEY);
    setOnboardingStep(0);
    setOnboardingSeen(false);
  }

  async function apiRequest<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
      body?: unknown;
      token?: string;
    } = {},
    isRetry = false,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }
    if (deviceIdRef.current) {
      headers['X-Device-Id'] = deviceIdRef.current;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
    let countedAsSlow = false;
    const slowNotice = setTimeout(() => {
      countedAsSlow = true;
      slowRequestCount.current += 1;
      setServerWaking(true);
    }, SLOW_REQUEST_NOTICE_MS);
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('El servidor no respondió. Revisa tu conexión a internet e intenta de nuevo.');
      }
      if (error instanceof TypeError) {
        // "Network request failed": sin internet o sin señal.
        throw new Error('Sin conexión a internet. Revisa tu conexión e intenta de nuevo.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      clearTimeout(slowNotice);
      if (countedAsSlow) {
        slowRequestCount.current -= 1;
        if (slowRequestCount.current === 0) {
          setServerWaking(false);
        }
      }
    }

    if (response.status === 401 && options.token && !isRetry) {
      const renewedToken = await renewSession();
      if (renewedToken) {
        return apiRequest<T>(path, { ...options, token: renewedToken }, true);
      }
      await clearSession();
      throw new ApiError(SESSION_EXPIRED_MESSAGE, 401);
    }

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();

    if (!response.ok) {
      // Falta confirmar el teléfono: se muestra la pantalla para hacerlo.
      if (response.status === 403 && typeof payload === 'object' && payload?.code === 'PHONE_VERIFICATION_REQUIRED') {
        checkPhoneVerificationRef.current().catch(() => undefined);
      }
      let errorMessage = 'Error inesperado';
      if (typeof payload === 'string') {
        errorMessage = normalizeServerTextError(payload);
      } else if (payload && typeof payload === 'object') {
        const payloadError = 'error' in payload ? String(payload.error || '') : '';
        const payloadDetails =
          'details' in payload && Array.isArray(payload.details)
            ? payload.details
                .map((detail: unknown) => {
                  if (!detail || typeof detail !== 'object') {
                    return '';
                  }

                  const path = 'path' in detail ? String(detail.path || '') : '';
                  const message = 'message' in detail ? String(detail.message || '') : '';
                  return [path, message].filter(Boolean).join(': ');
                })
                .filter(Boolean)
            : [];

        errorMessage = payloadDetails.length > 0 ? `${payloadError} (${payloadDetails.join(' | ')})` : payloadError || errorMessage;
      }

      throw new ApiError(errorMessage, response.status);
    }

    return payload as T;
  }

  async function loadMechanics() {
    const params = new URLSearchParams();
    if (mechanicsFilter.city) params.set('city', mechanicsFilter.city);
    if (mechanicsFilter.zone) params.set('zone', mechanicsFilter.zone);

    const data = await apiRequest<Mechanic[]>(`/mechanics${params.toString() ? `?${params.toString()}` : ''}`);
    setMechanics(data);
    if (user?.role === 'mechanic' && user.mechanicId) {
      const myMechanic = data.find((mechanic) => mechanic.id === user.mechanicId);
      if (myMechanic) {
        setMechanicConnection(myMechanic.isOnline ? 'online' : 'offline');
        await loadMechanicSlots(myMechanic.id);
      }
    }
  }

  async function loadMechanicSlots(mechanicId: number) {
    const slots = await apiRequest<ScheduleSlot[]>(`/mechanics/${mechanicId}/schedule-slots`);
    setMechanicSlots(slots);
  }

  async function loadMechanicReviews(mechanicId: number) {
    const data = await apiRequest<MechanicReviewResponse>(`/mechanics/${mechanicId}/reviews`);
    setSelectedMechanicReviews(data.reviews);
    setSelectedMechanicReviewStats(data.stats);
  }

  async function loadRequestMechanicSlots(mechanicId: number) {
    const slots = await apiRequest<ScheduleSlot[]>(`/mechanics/${mechanicId}/schedule-slots`);
    setRequestMechanicSlots(slots);

    if (slots.length === 0) {
      setSelectedRequestScheduleDate('');
      return;
    }

    if (
      !selectedRequestScheduleDate ||
      !slots.some((slot) => slot.slotDate === selectedRequestScheduleDate)
    ) {
      setSelectedRequestScheduleDate(slots[0].slotDate);
    }
  }

  // PATCH del perfil público con todos sus campos: el endpoint reemplaza bio,
  // foto y galería completos, así que nunca se manda solo una parte.
  async function savePublicProfile(form: typeof publicProfileForm) {
    if (!user?.mechanicId) {
      throw new Error('No encontramos tu perfil de mecánico');
    }
    await apiRequest(`/api/mechanics/${user.mechanicId}/public-profile`, {
      method: 'PATCH',
      token,
      body: {
        bio: form.bio || undefined,
        coverPhotoUrl: form.coverPhotoUrl || '',
        galleryUrls: splitGalleryUrls(form.galleryUrls),
        laborRate: form.laborRate ? Number(form.laborRate) : undefined,
      },
    });
    await loadMechanics();
  }

  async function handleSavePublicProfile() {
    setBusy(true);
    try {
      await savePublicProfile(publicProfileForm);
      setMessage('Perfil guardado');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  function askPhotoSource(): Promise<'camera' | 'library' | null> {
    return new Promise((resolve) => {
      Alert.alert(
        'Agregar foto',
        '¿Quieres tomarla ahora o elegir una que ya tengas?',
        [
          { text: 'Cancelar', style: 'cancel', onPress: () => resolve(null) },
          { text: 'Elegir de mis fotos', onPress: () => resolve('library') },
          { text: 'Tomar foto', onPress: () => resolve('camera') },
        ],
        { cancelable: true, onDismiss: () => resolve(null) },
      );
    });
  }

  // Toma o elige una foto, la reduce en el teléfono (máx. 1280 px de ancho,
  // ~200 KB) y la sube. Devuelve su dirección pública, o null si se canceló.
  async function pickAndUploadPhoto(source: 'camera' | 'library'): Promise<string | null> {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        throw new Error('Necesitamos permiso para usar la cámara. Puedes darlo en los ajustes del teléfono.');
      }
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [4, 3], quality: 1 };
    const picked =
      source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    const asset = picked.canceled ? null : picked.assets[0];
    if (!asset) {
      return null;
    }

    const context = ImageManipulator.manipulate(asset.uri);
    if (asset.width > 1280) {
      context.resize({ width: 1280 });
    }
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ base64: true, compress: 0.7, format: SaveFormat.JPEG });
    if (!saved.base64) {
      throw new Error('No se pudo preparar la foto');
    }

    const uploaded = await apiRequest<{ url: string }>('/api/uploads/photo', {
      method: 'POST',
      token,
      body: { imageBase64: saved.base64 },
    });
    return uploaded.url;
  }

  // Las fotos se guardan en el perfil en cuanto se suben: no depende de que
  // el mecánico se acuerde de tocar "Guardar".
  async function handleAddProfilePhoto(kind: 'cover' | 'gallery') {
    const source = await askPhotoSource();
    if (!source) {
      return;
    }
    setBusy(true);
    try {
      const url = await pickAndUploadPhoto(source);
      if (!url) {
        return;
      }
      const nextForm =
        kind === 'cover'
          ? { ...publicProfileForm, coverPhotoUrl: url }
          : { ...publicProfileForm, galleryUrls: [...splitGalleryUrls(publicProfileForm.galleryUrls), url].join(', ') };
      await savePublicProfile(nextForm);
      setPublicProfileForm(nextForm);
      setMessage(kind === 'cover' ? 'Foto principal guardada' : 'Foto agregada');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  function handleRemoveProfilePhoto(kind: 'cover' | 'gallery', url: string) {
    Alert.alert('¿Quitar esta foto?', 'Los clientes ya no la verán en tu perfil.', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Quitar',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            const nextForm =
              kind === 'cover'
                ? { ...publicProfileForm, coverPhotoUrl: '' }
                : {
                    ...publicProfileForm,
                    galleryUrls: splitGalleryUrls(publicProfileForm.galleryUrls)
                      .filter((item) => item !== url)
                      .join(', '),
                  };
            await savePublicProfile(nextForm);
            setPublicProfileForm(nextForm);
            setMessage('Foto quitada');
          } catch (error) {
            setMessage(formatError(error));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  async function handleSubmitReview() {
    if (!selectedRequest || !selectedRequest.mechanicId) {
      setMessage('No hay solicitud mecánica seleccionada');
      return;
    }

    if (!reviewForm.rating) {
      setMessage('Elige una calificación de 1 a 5 estrellas');
      return;
    }

    setBusy(true);
    try {
      await apiRequest(`/api/mechanics/${selectedRequest.mechanicId}/reviews`, {
        method: 'POST',
        token,
        body: {
          serviceRequestId: selectedRequest.id,
          rating: Number(reviewForm.rating),
          comment: reviewForm.comment.trim(),
        },
      });
      setReviewForm({ rating: '', comment: '' });
      await loadMechanicReviews(selectedRequest.mechanicId);
      // Así se quita la tarjeta de calificar (aquí y en Inicio).
      await loadRequestDetailById(selectedRequest.id);
      await loadMyRequests();
      setMessage('Reseña enviada');
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitDispute() {
    if (!selectedRequest) {
      setMessage('No hay solicitud seleccionada');
      return;
    }
    if (disputeForm.description.trim().length < 10) {
      setMessage('Describe el problema con al menos 10 caracteres');
      return;
    }

    setBusy(true);
    try {
      await apiRequest('/api/disputes', {
        method: 'POST',
        token,
        body: {
          serviceRequestId: selectedRequest.id,
          category: disputeForm.category,
          description: disputeForm.description.trim(),
        },
      });
      setDisputeForm({ category: 'incomplete_work', description: '' });
      setShowDisputeForm(false);
      setMessage('Problema reportado. Un administrador lo revisará.');
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function loadAdminDisputes() {
    try {
      const data = await apiRequest<{ disputes: AdminDispute[] }>('/api/admin/disputes', { token });
      setAdminDisputes(data.disputes);
    } catch (error) {
      setMessage(formatError(error));
    }
  }

  async function handleResolveDispute(disputeId: number, status: 'under_review' | 'resolved') {
    setBusy(true);
    try {
      const refundRaw = disputeRefundAmounts[disputeId];
      const refundAmount = refundRaw ? Number(refundRaw) : undefined;
      await apiRequest(`/api/admin/disputes/${disputeId}`, {
        method: 'PATCH',
        token,
        body: {
          status,
          resolutionNote: disputeResolutionNotes[disputeId] || undefined,
          refundAmount: refundAmount && refundAmount > 0 ? refundAmount : undefined,
        },
      });
      await loadAdminDisputes();
      setMessage(status === 'resolved' ? 'Disputa resuelta' : 'Disputa marcada en revisión');
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function loadNearbyMechanics(latitude: number, longitude: number) {
    const params = new URLSearchParams();
    params.set('latitude', String(latitude));
    params.set('longitude', String(longitude));
    params.set('available', 'true');
    params.set('radiusKm', '25');

    const data = await apiRequest<Mechanic[]>(`/mechanics?${params.toString()}`);
    setNearbyMechanics(data);
  }



  async function requestCurrentLocation() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      throw new Error('Permiso de ubicación denegado');
    }

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    const coords = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    };

    setCurrentLocation(coords);
    return coords;
  }

  /**
   * Ubicación de la solicitud desde el GPS: las coordenadas (con las que el
   * backend busca al mecánico más cercano y el mecánico usa "Cómo llegar")
   * y, por geocodificación inversa, ciudad/zona/dirección como texto
   * editable. Sin `overwrite` no pisa lo que el usuario ya escribió.
   */
  async function fillRequestLocation(coords: { latitude: number; longitude: number }, overwrite: boolean) {
    setRequestForm((current) => ({ ...current, latitude: String(coords.latitude), longitude: String(coords.longitude) }));

    let address: Location.LocationGeocodedAddress | undefined;
    try {
      [address] = await Location.reverseGeocodeAsync(coords);
    } catch {
      // Sin texto de dirección igual quedan las coordenadas, que son las que
      // usa la búsqueda del mecánico.
      return;
    }
    if (!address) {
      return;
    }

    const city = address.city || address.subregion || '';
    const zone = address.district || address.subregion || '';
    const street = [address.street, address.streetNumber].filter(Boolean).join(' ');
    const serviceAddress = [street, address.district].filter(Boolean).join(', ');
    setRequestForm((current) => ({
      ...current,
      city: city && (overwrite || !current.city.trim() || current.city === DEFAULT_REQUEST_CITY) ? city : current.city,
      zone: zone && (overwrite || !current.zone.trim() || current.zone === DEFAULT_REQUEST_ZONE) ? zone : current.zone,
      serviceAddress: serviceAddress && (overwrite || !current.serviceAddress.trim()) ? serviceAddress : current.serviceAddress,
    }));
  }

  async function handleUseMyLocation() {
    setBusy(true);
    try {
      const coords = await requestCurrentLocation();
      await fillRequestLocation(coords, true);
      setMessage('Usando tu ubicación actual');
    } catch (error) {
      setMessage(`No se pudo obtener tu ubicación: ${formatError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Perfil propio del mecánico, en cualquier estado. La lista pública
   * (GET /mechanics) solo trae mecánicos activos, así que uno pendiente de
   * verificación no tenía de dónde saber su estado ni su tarifa.
   */
  async function loadMechanicProfile() {
    if (user?.role !== 'mechanic' || !token) {
      return;
    }
    const profile = await apiRequest<MechanicProfile>('/api/mechanics/me', { token });
    setMechanicProfile(profile);
    setMechanicConnection(profile.isOnline ? 'online' : 'offline');
    setPublicProfileForm({
      bio: profile.bio || '',
      coverPhotoUrl: profile.coverPhotoUrl || '',
      galleryUrls: profile.gallery.join(', '),
      laborRate: profile.laborRate != null ? String(profile.laborRate) : '',
    });
  }

  async function handleSaveLaborRate(rateText: string) {
    const laborRate = Number(rateText);
    if (!mechanicProfile || !Number.isFinite(laborRate) || laborRate <= 0) {
      setMessage('Escribe el precio de tu visita en pesos, por ejemplo 400');
      return;
    }
    setBusy(true);
    try {
      // Este endpoint reemplaza bio, foto y galería con lo que se le mande:
      // se reenvían los valores actuales para no borrarlos al guardar solo
      // la tarifa.
      await apiRequest(`/api/mechanics/${mechanicProfile.id}/public-profile`, {
        method: 'PATCH',
        token,
        body: {
          bio: mechanicProfile.bio || undefined,
          coverPhotoUrl: mechanicProfile.coverPhotoUrl || '',
          galleryUrls: mechanicProfile.gallery,
          laborRate,
        },
      });
      await loadMechanicProfile();
      setMessage('Precio de visita guardado');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  /** Al conectarse, el mecánico manda su ubicación para que lo encuentren por distancia. */
  async function sendMechanicLocation() {
    if (!user?.mechanicId) {
      return;
    }
    const coords = await requestCurrentLocation().catch(() => currentLocation);
    if (!coords) {
      // Sin ubicación se le sigue ofreciendo trabajo por ciudad/zona.
      return;
    }
    await apiRequest(`/api/mechanics/${user.mechanicId}/location`, {
      method: 'PATCH',
      token,
      body: { latitude: coords.latitude, longitude: coords.longitude },
    }).catch(() => undefined);
  }

  async function loadMyRequests(nextToken = token) {
    const data = await apiRequest<RequestSummary[]>('/api/service-requests/mine', {
      token: nextToken,
    });
    setMyRequests(data);
  }

  const api: ApiCall = (path, options = {}) => apiRequest(path, { ...options, token: tokenRef.current || token });

  function openCommunity() {
    setCommunityView({ mode: 'list' });
    setCurrentScreen('community');
  }

  async function loadFavorites() {
    const data = await apiRequest<{ mechanics: FavoriteMechanic[] }>('/api/favorites', { token });
    setFavoriteMechanics(data.mechanics);
  }

  async function handleToggleFavorite(mechanicId: number) {
    const isFavorite = favoriteMechanics.some((mechanic) => mechanic.id === mechanicId);
    try {
      await apiRequest(`/api/favorites/${mechanicId}`, { method: isFavorite ? 'DELETE' : 'PUT', token });
      await loadFavorites();
      setMessage(isFavorite ? 'Quitado de tus favoritos' : 'Guardado en tus favoritos');
      Haptics.selectionAsync().catch(() => undefined);
    } catch (error) {
      setMessage(formatError(error));
    }
  }

  // Abre en Mecánicos el perfil de un mecánico (desde la lista, el radar de
  // cercanos, Favoritos, Comunidad o Promociones). Si la lista actual está
  // filtrada por zona y no lo incluye, se recarga completa.
  async function openMechanicProfile(mechanicId: number) {
    try {
      let list = mechanics;
      if (!list.some((mechanic) => mechanic.id === mechanicId)) {
        list = await apiRequest<Mechanic[]>('/mechanics');
        setMechanicsFilter({ city: '', zone: '' });
        setMechanics(list);
      }
      const index = list.findIndex((mechanic) => mechanic.id === mechanicId);
      if (index < 0) {
        setMessage('Este mecánico ya no está disponible');
        return;
      }
      setMechanicCursor(index);
      setMechanicsView('profile');
      setCurrentScreen('mechanics');
    } catch (error) {
      setMessage(formatError(error));
    }
  }

  async function loadAccountProfile() {
    return apiRequest<{ fullName: string; email: string; phone: string }>('/api/account/profile', { token });
  }

  async function handleUpdateProfile(payload: { fullName: string; phone: string }): Promise<boolean> {
    setBusy(true);
    try {
      const response = await apiRequest<{ user: AuthUser }>('/api/account/profile', {
        method: 'PATCH',
        token,
        body: { fullName: payload.fullName, ...(payload.phone ? { phone: payload.phone } : {}) },
      });
      const nextUser = { ...(user as AuthUser), fullName: response.user.fullName };
      setUser(nextUser);
      await persistSession(tokenRef.current || token, nextUser);
      setMessage('Datos guardados');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      return true;
    } catch (error) {
      setMessage(formatError(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleChangePassword(newPassword: string): Promise<boolean> {
    setBusy(true);
    try {
      await apiRequest('/api/account/password', { method: 'POST', token, body: { newPassword } });
      setMessage('Contraseña cambiada');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      return true;
    } catch (error) {
      setMessage(formatError(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteAccount() {
    setBusy(true);
    try {
      await apiRequest('/api/account', { method: 'DELETE', token });
      await clearSession();
      setMessage('Tu cuenta fue eliminada.');
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleSendSupport(kind: 'problem' | 'help', message: string): Promise<boolean> {
    setBusy(true);
    try {
      await apiRequest('/api/support', { method: 'POST', token, body: { kind, message } });
      setMessage('Recibimos tu mensaje. Te contactaremos a tu correo.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      return true;
    } catch (error) {
      setMessage(formatError(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function loadNotifications(nextToken = token) {
    const data = await apiRequest<{ notifications: AppNotification[]; unreadCount: number }>('/api/notifications', {
      token: nextToken,
    });
    setNotifications(data.notifications);
    setUnreadNotifications(data.unreadCount);
  }

  async function registerPushToken(nextToken = token) {
    if (!nextToken || Platform.OS === 'web') {
      return;
    }

    // En Android 13+ el permiso solo se puede pedir si ya existe un canal.
    // "default" es el canal al que Expo manda los avisos sin channelId.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Avisos de Mecanifique',
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: '#0072B2',
      });
    }

    const currentPermissions = await Notifications.getPermissionsAsync();
    let finalStatus = currentPermissions.status;

    if (finalStatus !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      finalStatus = requested.status;
    }

    if (finalStatus !== 'granted') {
      return;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
    const tokenResponse = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();

    await apiRequest('/api/push-tokens', {
      method: 'POST',
      token: nextToken,
      body: { pushToken: tokenResponse.data },
    });
  }

  async function loadIncomingRequest() {
    const result = await apiRequest<{ request: ServiceRequest | null }>('/api/mechanics/incoming-request', {
      token,
    });
    setIncomingRequest(result.request);
  }

  async function loadRequestMessages(requestId: number) {
    const data = await apiRequest<RequestMessage[]>(`/api/service-requests/${requestId}/messages`, {
      token,
    });
    setRequestMessages(data);
  }

  async function checkPhoneVerification() {
    if (!tokenRef.current) return;
    const status = await apiRequest<PhoneVerificationStatus>('/api/account/verification', { token: tokenRef.current });
    setPhoneVerification(status.required ? status : null);
  }
  const checkPhoneVerificationRef = useRef(checkPhoneVerification);
  checkPhoneVerificationRef.current = checkPhoneVerification;

  // Confirmado el teléfono: se guarda su identificador y se carga lo que
  // falló mientras tanto.
  async function handlePhoneVerified(deviceId: string) {
    deviceIdRef.current = deviceId;
    await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId).catch(() => undefined);
    setPhoneVerification(null);
    const activeToken = tokenRef.current || token;
    loadMyRequests(activeToken).catch(() => undefined);
    loadNotifications(activeToken).catch(() => undefined);
    registerPushToken(activeToken).catch(() => undefined);
    loadFavorites().catch(() => undefined);
    loadServiceFeeConfig().catch(() => undefined);
    loadMechanicProfile().catch(() => undefined);
  }

  function openNotifications() {
    if (currentScreen !== 'notifications') {
      notificationsReturnScreen.current = currentScreen;
    }
    setCurrentScreen('notifications');
    loadNotifications().catch(() => undefined);
  }

  // Tocar un aviso lo marca como leído y lleva a lo que avisa: la solicitud o
  // la pregunta de la Comunidad.
  function markNotificationRead(notification: AppNotification) {
    // id 0: push viejo que no traía su id; no hay qué marcar.
    if (!notification.readAt && notification.id > 0) {
      apiRequest(`/api/notifications/${notification.id}/read`, { method: 'POST', token })
        .then(() => loadNotifications())
        .catch(() => undefined);
    }
  }

  async function handleOpenNotification(notification: AppNotification) {
    markNotificationRead(notification);
    const target = notificationTarget(notification);
    if (!target) {
      return;
    }
    if ('questionId' in target) {
      setCommunityView({ mode: 'detail', questionId: target.questionId });
      setCurrentScreen('community');
      return;
    }
    try {
      await loadRequestDetailById(target.requestId);
      setRequestsView('detail');
      setCurrentScreen('requests');
    } catch (error) {
      setMessage(formatError(error));
    }
  }

  async function handleMarkAllNotificationsRead() {
    setBusy(true);
    try {
      await apiRequest('/api/notifications/read-all', { method: 'POST', token });
      await loadNotifications();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleSendMessage() {
    if (!selectedRequest || !messageDraft.trim()) {
      return;
    }

    setBusy(true);
    try {
      await apiRequest(`/api/service-requests/${selectedRequest.id}/messages`, {
        method: 'POST',
        token,
        body: { message: messageDraft.trim() },
      });
      setMessageDraft('');
      await loadRequestMessages(selectedRequest.id);
      setMessage('Mensaje enviado');
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleAuthSubmit() {
    setBusy(true);
    setMessage('Procesando...');

    try {
      let response: AuthResponse;

      if (authMode === 'login') {
          response = await apiRequest<AuthResponse>('/auth/v2/login', {
          method: 'POST',
          body: loginForm,
        });
      } else if (authMode === 'customer') {
        const registration = await apiRequest<RegistrationResponse>('/auth/v2/register/customer', {
          method: 'POST',
          body: customerForm,
        });
        setLoginForm({ email: customerForm.email, password: customerForm.password });
        setAuthMode('login');
        setMessage(registration.message || 'Cuenta creada. Ahora inicia sesión.');
        return;
      } else {
        const latitude = mechanicForm.latitude ? Number(mechanicForm.latitude) : undefined;
        const longitude = mechanicForm.longitude ? Number(mechanicForm.longitude) : undefined;
        const { latitude: _ignoredLatitude, longitude: _ignoredLongitude, ...mechanicPayload } = mechanicForm;
        const registration = await apiRequest<RegistrationResponse>('/auth/v2/register/mechanic', {
          method: 'POST',
          body: {
            ...mechanicPayload,
            yearsExperience: Number(mechanicForm.yearsExperience),
            specialties: normalizeSpecialties(mechanicForm.specialties),
            ...(latitude !== undefined && Number.isFinite(latitude) ? { latitude } : {}),
            ...(longitude !== undefined && Number.isFinite(longitude) ? { longitude } : {}),
          },
        });
        setLoginForm({ email: mechanicForm.email, password: mechanicForm.password });
        setAuthMode('login');
        setMechanicSignupStep('account');
        setMessage(registration.message || 'Cuenta creada. Ahora inicia sesión.');
        return;
      }

      setToken(response.accessToken);
      setUser(response.user);
      setLocationAutoRequested(false);
      setCurrentScreen('home');
      await persistSession(response.accessToken, response.user, response.refreshToken ?? null);
      await loadMyRequests(response.accessToken);
      setMessage(`Sesión iniciada como ${response.user.role}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (error) {
      setMessage(formatError(error));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    } finally {
      setBusy(false);
    }

  }

  async function handleStartIdentityVerification() {
    if (!token) {
      setMessage('Debes iniciar sesión primero');
      return;
    }

    setIdentityBusy(true);
    setMessage('Preparando verificación...');
    try {
      await apiRequest('/api/identity-verification', {
        method: 'POST',
        token,
        body: { consent: true },
      });

      const callbackUrl = Linking.createURL('identity-callback');
      const session = await apiRequest<{ url: string }>(
        '/api/identity-verification/didit-session',
        {
          method: 'POST',
          token,
          body: { callbackUrl },
        },
      );

      setMessage('Abriendo verificación...');
      const result = await WebBrowser.openAuthSessionAsync(session.url, callbackUrl);

      if (result.type !== 'success') {
        setMessage('Verificación cancelada');
      } else {
        setMessage('Verificación enviada, esperando resultado...');
      }

      // El estado real y definitivo lo confirma el webhook del backend, que
      // puede tardar unos segundos en llegar. Refrescamos aquí para mostrar
      // lo que haya quedado guardado hasta este momento.
      const refreshed = await apiRequest<{ verification: { status: IdentityVerificationStatus } | null }>(
        '/api/identity-verification',
        { token },
      );
      setIdentityState({ status: refreshed.verification?.status ?? 'draft' });
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setIdentityBusy(false);
    }
  }

  async function loadServiceFeeConfig() {
    const data = await apiRequest<{ serviceFee: { enabled: boolean; amount: number } }>('/api/payments/config', { token });
    setServiceFeeConfig(data.serviceFee);
    return data.serviceFee;
  }

  // Abre el pago de la cuota en la página segura de Stripe (dentro de la
  // app) y regresa sola al terminar. Devuelve el id del pago, o null si la
  // persona lo canceló.
  async function payServiceFee(): Promise<string | null> {
    const returnUrl = Linking.createURL('pago');
    const checkout = await apiRequest<{ checkoutUrl: string; sessionId: string }>('/api/payments/service-fee', {
      method: 'POST',
      token,
      body: { returnUrl },
    });
    const result = await WebBrowser.openAuthSessionAsync(checkout.checkoutUrl, returnUrl);
    if (result.type !== 'success' || !result.url) {
      return null;
    }
    const query = result.url.split('?')[1]?.split('#')[0] ?? '';
    return new URLSearchParams(query).get('estado') === 'listo' ? checkout.sessionId : null;
  }

  async function handleCreateRequest() {
    if (!user) return;

    const formProblem = validateRequestForm(requestForm);
    if (formProblem) {
      setMessage(formProblem);
      return;
    }

    setBusy(true);
    setMessage('Creando solicitud...');

    try {
      let serviceFeeSessionId: string | null = null;
      if (user.role === 'customer') {
        // Se consulta al momento: la cuota puede activarse sin reiniciar la app.
        const feeConfig = await loadServiceFeeConfig().catch(() => serviceFeeConfig);
        if (feeConfig.enabled) {
          serviceFeeSessionId = paidFeeSession.current;
          if (!serviceFeeSessionId) {
            setMessage('Abriendo el pago seguro…');
            serviceFeeSessionId = await payServiceFee();
            if (!serviceFeeSessionId) {
              setMessage('Pago cancelado. Tu solicitud no se envió.');
              return;
            }
            paidFeeSession.current = serviceFeeSessionId;
            setMessage('Pago listo. Enviando tu solicitud…');
          }
        }
      }

      // Respaldo: si el formulario todavía no tiene coordenadas, se usa la
      // ubicación actual (sin coordenadas no hay búsqueda por distancia ni
      // "Cómo llegar" para el mecánico).
      const latitude = requestForm.latitude ? Number(requestForm.latitude) : currentLocation?.latitude;
      const longitude = requestForm.longitude ? Number(requestForm.longitude) : currentLocation?.longitude;
      const payload = {
        vehicleMake: requestForm.vehicleMake,
        vehicleModel: requestForm.vehicleModel,
        vehicleYear: Number(requestForm.vehicleYear),
        issueDescription: requestForm.issueDescription,
        preferredTime: requestForm.preferredTime,
        city: requestForm.city,
        zone: requestForm.zone,
        serviceAddress: requestForm.serviceAddress,
        ...(user.role === 'admin' && requestForm.customerId
          ? { customerId: Number(requestForm.customerId) }
          : {}),
        ...(requestForm.requestedMechanicId ? { requestedMechanicId: Number(requestForm.requestedMechanicId) } : {}),
        ...(requestForm.scheduleSlotId ? { scheduleSlotId: Number(requestForm.scheduleSlotId) } : {}),
        ...(latitude !== undefined && Number.isFinite(latitude) ? { latitude } : {}),
        ...(longitude !== undefined && Number.isFinite(longitude) ? { longitude } : {}),
        ...(serviceFeeSessionId ? { serviceFeeSessionId } : {}),
      };

      const request = await apiRequest<ServiceRequest>('/api/service-requests', {
        method: 'POST',
        body: payload,
        token,
      });
      paidFeeSession.current = null;

      setSelectedRequest(request);
      setRequestLookupId(String(request.id));
      setRequestsView('list');
      // Inicio muestra el servicio en curso (progreso, espera, chat).
      setCurrentScreen('home');
      setMessage(
        request.mechanicId
          ? 'Solicitud enviada. Esperando que un mecánico la acepte.'
          : 'Solicitud registrada, pero no hay mecánicos disponibles ahora.',
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      void loadMyRequests().catch((error) => setMessage(formatError(error)));
      void loadRequestDetailById(request.id).catch(() => undefined);
    } catch (error) {
      // 402/409: ese pago ya no sirve (no se completó o ya se usó); el
      // siguiente intento abre un pago nuevo. Otro error: se conserva el pago
      // para reintentar sin cobrar de nuevo.
      if (error instanceof ApiError && (error.status === 402 || error.status === 409)) {
        paidFeeSession.current = null;
      }
      setMessage(formatError(error));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  function openRequestActions(request: ServiceRequest | RequestSummary) {
    setSelectedActionRequest(request);
    setRequestLookupId(String(request.id));
    setServiceStatusForm((current) => ({ ...current, requestId: String(request.id) }));
    setCurrentScreen('actions');
    setActionsView('requestStatus');
  }

  async function loadVehicles() {
    const data = await apiRequest<{ vehicles: VehicleProfile[] }>('/api/vehicles', { token });
    setVehicles(data.vehicles);
  }

  // Vuelve a leer el usuario del servidor. La app guarda una copia local
  // (rol, perfil de mecánico/cliente) que puede quedar vieja si algo cambió
  // del otro lado; el servidor siempre manda.
  async function refreshUserFromServer() {
    const currentToken = tokenRef.current || token;
    if (!currentToken || !user) {
      return null;
    }
    const me = await apiRequest<{ user: Partial<AuthUser> }>('/auth/v2/me', { token: currentToken });
    const refreshed = { ...user, ...me.user, fullName: me.user.fullName || user.fullName } as AuthUser;
    const changed = (['id', 'role', 'login', 'fullName', 'customerId', 'mechanicId'] as const).some(
      (key) => refreshed[key] !== user[key],
    );
    if (changed) {
      setUser(refreshed);
      await persistSession(tokenRef.current || currentToken, refreshed);
    }
    return refreshed;
  }

  async function handleSwitchRole(payload: {
    targetRole: 'customer' | 'mechanic';
    city?: string;
    zone?: string;
    yearsExperience?: number;
    specialties?: string[];
  }) {
    setBusy(true);
    try {
      const response = await apiRequest<{ user: AuthUser }>('/api/account/switch-role', {
        method: 'POST',
        token,
        body: payload,
      });
      setUser(response.user);
      await persistSession(tokenRef.current || token, response.user);
      setCurrentScreen(response.user.role === 'mechanic' ? 'home' : 'mechanics');
      setMessage(response.user.role === 'mechanic' ? 'Ahora estás en modo profesional' : 'Ahora estás en modo cliente');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (error) {
      // "Completa ciudad, zona…" significa que el servidor no tiene perfil de
      // mecánico aunque la app creía que sí: se resincroniza para que Cuenta
      // muestre el formulario en vez de un botón que siempre falla.
      if (error instanceof ApiError && error.status === 400 && payload.targetRole === 'mechanic' && !payload.city) {
        const refreshed = await refreshUserFromServer().catch(() => null);
        if (refreshed && !refreshed.mechanicId) {
          setMessage('Completa tus datos de mecánico para activar el modo profesional.');
          return;
        }
      }
      setMessage(formatError(error));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddVehicle(payload: {
    nickname?: string;
    make: string;
    model: string;
    year: number;
    engineType?: string;
    transmissionType?: string;
    color?: string;
    licensePlate?: string;
  }) {
    setBusy(true);
    try {
      await apiRequest('/api/vehicles', {
        method: 'POST',
        token,
        body: payload,
      });
      await loadVehicles();
      setMessage('Vehículo agregado');
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleSetPrimaryVehicle(vehicleId: number) {
    setBusy(true);
    try {
      await apiRequest(`/api/vehicles/${vehicleId}/primary`, {
        method: 'POST',
        token,
      });
      await loadVehicles();
      setMessage('Vehículo principal actualizado');
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveCurrentVehicle() {
    if (!token || user?.role !== 'customer') return;
    try {
      const vehicle = await apiRequest<VehicleProfile>('/api/vehicles', {
        method: 'POST',
        token,
        body: {
          make: requestForm.vehicleMake,
          model: requestForm.vehicleModel,
          year: Number(requestForm.vehicleYear),
        },
      });
      setVehicles((current) => [vehicle, ...current]);
      setMessage('Vehículo guardado en tu perfil');
    } catch (error) {
      setMessage(formatError(error));
    }
  }

  async function handleToggleMechanicConnection(next: 'online' | 'offline') {
    if (!user?.mechanicId) {
      setMessage('No se encontró tu mechanicId');
      return;
    }

    setBusy(true);
    try {
      await apiRequest(`/api/mechanics/${user.mechanicId}/online`, {
        method: 'PATCH',
        token,
        body: { isOnline: next === 'online' },
      });
      setMechanicConnection(next);
      void loadMechanicProfile().catch(() => undefined);
      if (next === 'online') {
        void sendMechanicLocation();
        await loadIncomingRequest();
      } else {
        setIncomingRequest(null);
      }
      setMessage(next === 'online' ? 'Conectado para recibir solicitudes' : 'Desconectado');
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  function handleIncomingResponse(action: 'accept' | 'reject') {
    if (action === 'accept') {
      void respondToIncomingRequest('accept');
      return;
    }
    Alert.alert('¿Rechazar esta solicitud?', 'No podrás volver a aceptarla después.', [
      { text: 'No', style: 'cancel' },
      { text: 'Sí, rechazar', style: 'destructive', onPress: () => void respondToIncomingRequest('reject') },
    ]);
  }

  async function respondToIncomingRequest(action: 'accept' | 'reject') {
    if (!incomingRequest) {
      return;
    }

    setBusy(true);
    try {
      await apiRequest(`/api/service-requests/${incomingRequest.id}/respond`, {
        method: 'POST',
        token,
        body: { action },
      });
      await loadIncomingRequest();
      await loadMyRequests();
      setMessage(action === 'accept' ? 'Solicitud aceptada' : 'Solicitud rechazada');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      if (action === 'accept') {
        const fullRequest = await apiRequest<ServiceRequest>(`/service-requests/${incomingRequest.id}`, { token });
        setSelectedRequest(fullRequest);
        setSelectedActionRequest(fullRequest);
        setRequestLookupId(String(fullRequest.id));
        setServiceStatusForm((current) => ({ ...current, requestId: String(fullRequest.id) }));
        // El trabajo en curso (dirección, "Cómo llegar", siguiente paso, chat)
        // vive en Inicio.
        setCurrentScreen('home');
      }
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  function handleCancelRequest(requestId: number) {
    Alert.alert('¿Cancelar la solicitud?', 'El mecánico dejará de atenderla y no se puede deshacer.', [
      { text: 'No, mantenerla', style: 'cancel' },
      { text: 'Sí, cancelar', style: 'destructive', onPress: () => void cancelRequest(requestId) },
    ]);
  }

  async function cancelRequest(requestId: number) {
    setBusy(true);
    try {
      await apiRequest(`/api/service-requests/${requestId}/cancel`, {
        method: 'POST',
        token,
      });
      await loadMyRequests();
      if (selectedRequest?.id === requestId) {
        setSelectedRequest(null);
      }
      setMessage('Solicitud cancelada');
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  function handleAdvanceJob(requestId: number, status: string) {
    // La regla del ticket, justo antes de salir a comprar (src/partsReceipts.ts).
    if (status === 'awaiting_parts') {
      Alert.alert(
        '¿Vas por refacciones?',
        'Al pagar, tómale foto al ticket en la app. Las refacciones se cobran a precio de ticket: sin ticket no se cobran y no podrás retomar la reparación.',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Sí, voy', onPress: () => void advanceJob(requestId, status) },
        ],
      );
      return;
    }
    if (status === 'completed') {
      const job = selectedRequest?.id === requestId ? selectedRequest : null;
      const total = job ? serviceAmounts(job).total : 0;
      Alert.alert(
        '¿Terminar el servicio?',
        total > 0
          ? `Confírmalo solo cuando el trabajo esté listo. Le cobrarás ${formatPesos(total)} a ${job?.customerName?.split(' ')[0] || 'el cliente'}.`
          : 'Confírmalo solo cuando el trabajo esté listo. El cliente podrá calificarte.',
        [
          { text: 'Todavía no', style: 'cancel' },
          { text: 'Sí, terminar', onPress: () => void advanceJob(requestId, status) },
        ],
      );
      return;
    }
    void advanceJob(requestId, status);
  }

  async function advanceJob(requestId: number, status: string) {
    setBusy(true);
    try {
      await apiRequest(`/api/service-requests/${requestId}/status`, {
        method: 'PATCH',
        token,
        body: { status },
      });
      const job = await fetchRequestDetail(requestId);
      await loadMyRequests();
      setMessage(status === 'completed' ? 'Servicio terminado. Ahora cóbrale al cliente.' : `Estado: ${getServiceRequestStatusLabel(status)}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      // Al salir hacia el cliente, la ruta se abre sola.
      if (status === 'en_route' && job) {
        openServiceNavigation(job).catch(() => setMessage('No se pudo abrir la navegación. Usa «Cómo llegar».'));
      }
    } catch (error) {
      setMessage(formatError(error));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function handleSearchAgain(requestId: number) {
    setBusy(true);
    try {
      const result = await apiRequest<{ found: boolean }>(`/api/service-requests/${requestId}/search-again`, {
        method: 'POST',
        token,
      });
      await loadRequestDetailById(requestId);
      await loadMyRequests();
      setMessage(
        result.found
          ? 'Encontramos un mecánico. Esperando su respuesta.'
          : 'Todavía no hay mecánicos disponibles. Intenta de nuevo en unos minutos.',
      );
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  function handleEmergencyCall() {
    Alert.alert(
      'Llamar al 911',
      '¿Necesitas ayuda de emergencia ahora mismo?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Llamar al 911',
          style: 'destructive',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
            // La llamada real nunca debe esperar ni depender del backend:
            // se dispara de inmediato y, en paralelo (best-effort), se dejar
            // constancia para que un admin pueda dar seguimiento después.
            Linking.openURL('tel:911').catch(() =>
              setMessage('No se pudo abrir el marcador. Marca 911 manualmente.'),
            );
            if (token) {
              apiRequest('/api/alerts/panic', {
                method: 'POST',
                token,
                body: {
                  serviceRequestId: selectedRequest?.id,
                  latitude: currentLocation?.latitude,
                  longitude: currentLocation?.longitude,
                },
              }).catch(() => {
                // Silencioso a propósito: si falla el registro, no debe
                // interrumpir ni preocupar al usuario en medio de una
                // emergencia real.
              });
            }
          },
        },
      ],
    );
  }

  async function fetchRequestDetail(requestId: number) {
    const fullRequest = await apiRequest<ServiceRequest>(`/service-requests/${requestId}`, { token });
    setSelectedRequest(fullRequest);
    return fullRequest;
  }

  async function loadRequestDetailById(requestId: number) {
    await fetchRequestDetail(requestId);
  }

  async function handleLoadRequest() {
    if (!requestLookupId) return;

    setBusy(true);
    setMessage('Buscando solicitud...');

    try {
      const request = await apiRequest<ServiceRequest>(`/service-requests/${requestLookupId}`, { token });
      setSelectedRequest(request);
      setMessage(`Solicitud #${request.id} cargada`);
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleAssignRequest() {
    if (!assignForm.requestId) return;

    setBusy(true);
    setMessage('Asignando mecánico...');

    try {
      await apiRequest(`/api/service-requests/${assignForm.requestId}/assign`, {
        method: 'POST',
        token,
        body: assignForm.mechanicId ? { mechanicId: Number(assignForm.mechanicId) } : {},
      });
      await loadMyRequests();
      setMessage('Solicitud asignada');
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleAvailability(isAvailable: boolean) {
    const mechanicId = availabilityForm.mechanicId || selectedMechanicId;
    if (!mechanicId) {
      setMessage('Necesitas un mechanicId');
      return;
    }

    setBusy(true);
    try {
      await apiRequest(`/api/mechanics/${mechanicId}/availability`, {
        method: 'PATCH',
        token,
        body: { isAvailable },
      });
      setMessage(isAvailable ? 'Marcado como disponible' : 'Marcado como no disponible');
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleChangeMechanicStatus() {
    if (!statusForm.mechanicId) return;

    setBusy(true);
    try {
      await apiRequest(`/api/mechanics/${statusForm.mechanicId}/status`, {
        method: 'PATCH',
        token,
        body: { status: statusForm.status },
      });
      setMessage('Estado del mecánico actualizado');
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleChangeServiceRequestStatus() {
    if (!serviceStatusForm.requestId) {
      setMessage('Falta el número de solicitud');
      return;
    }

    setBusy(true);
    try {
      await apiRequest(`/api/service-requests/${serviceStatusForm.requestId}/status`, {
        method: 'PATCH',
        token,
        body: { status: serviceStatusForm.status },
      });
      await loadMyRequests();
      if (selectedRequest?.id === Number(serviceStatusForm.requestId)) {
        const updatedRequest = await apiRequest<ServiceRequest>(`/service-requests/${serviceStatusForm.requestId}`, { token });
        setSelectedRequest(updatedRequest);
      }
      setMessage('Estado de la solicitud actualizado');
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateScheduleSlot() {
    const mechanicId = slotForm.mechanicId || selectedMechanicId;
    if (!mechanicId) {
      setMessage('Falta el ID del mecánico para crear el turno');
      return;
    }
    if (!slotForm.slotDate || !slotForm.startTime || !slotForm.endTime) {
      setMessage('Completa fecha, inicio y fin del turno');
      return;
    }

    setBusy(true);
    try {
      await apiRequest(`/api/mechanics/${mechanicId}/schedule-slots`, {
        method: 'POST',
        token,
        body: {
          slotDate: slotForm.slotDate,
          startTime: slotForm.startTime,
          endTime: slotForm.endTime,
          note: slotForm.note || undefined,
        },
      });
      await loadMechanicSlots(Number(mechanicId));
      setMessage('Turno creado');
      setSlotForm({ mechanicId: '', slotDate: '', startTime: '', endTime: '', note: '' });
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  if (loadingSession) {
    return (
      <View style={styles.safeArea}>
        <SafeAreaView style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.subtitle}>
            {serverWaking ? 'Conectando con el servidor… puede tardar hasta un minuto.' : 'Cargando sesión…'}
          </Text>
        </SafeAreaView>
      </View>
    );
  }

  if (!user) {
    if (onboardingSeen === false) {
      return (
        <View style={styles.safeArea}>
          <SafeAreaView style={styles.safeAreaInner}>
            <StatusBar style="dark" />
            <Toast message={message} onDismiss={() => setMessage('')} />
            <View style={styles.content}>
              <Image source={APP_LOGO_IMAGE} resizeMode="contain" style={styles.logoWordmark} accessibilityLabel="Mecanifique" />
              <ServerWakingBanner visible={serverWaking} />
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                alwaysBounceVertical
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.appShell}>
                  <OnboardingScreen
                    steps={ONBOARDING_STEPS}
                    currentStep={onboardingStep}
                    onNext={async () => {
                      if (onboardingStep < ONBOARDING_STEPS.length - 1) {
                        setOnboardingStep((value) => value + 1);
                        return;
                      }
                      await completeOnboarding();
                    }}
                    onSkip={async () => {
                      await completeOnboarding();
                    }}
                  />
                </View>
              </ScrollView>
            </View>
          </SafeAreaView>
        </View>
      );
    }

    return (
      <View style={styles.safeArea}>
        <SafeAreaView style={styles.safeAreaInner}>
          <StatusBar style="dark" />
          <Toast message={message} onDismiss={() => setMessage('')} />
          <View style={styles.content}>
            <Image source={APP_LOGO_IMAGE} resizeMode="contain" style={styles.logoWordmark} accessibilityLabel="Mecanifique" />
            <ServerWakingBanner visible={serverWaking} />
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              alwaysBounceVertical
              keyboardShouldPersistTaps="handled"
            >
            <View style={styles.appShell}>
              <LoginScreen
                authMode={authMode}
                setAuthMode={setAuthMode}
                loginForm={loginForm}
                setLoginForm={setLoginForm}
                customerForm={customerForm}
                setCustomerForm={setCustomerForm}
                mechanicForm={mechanicForm}
                setMechanicForm={setMechanicForm}
                mechanicSignupStep={mechanicSignupStep}
                setMechanicSignupStep={setMechanicSignupStep}
                busy={busy}
                onSubmit={handleAuthSubmit}
                onShowOnboarding={showOnboardingAgain}
                onForgotPassword={handleForgotPassword}
                onResendConfirmation={handleResendConfirmation}
              />
            </View>
            </ScrollView>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (phoneVerification?.required) {
    return (
      <View style={styles.safeArea}>
        <SafeAreaView style={styles.safeAreaInner}>
          <StatusBar style="dark" />
          <Toast message={message} onDismiss={() => setMessage('')} />
          <View style={styles.content}>
            <Image source={APP_LOGO_IMAGE} resizeMode="contain" style={styles.logoWordmark} accessibilityLabel="Mecanifique" />
            <ServerWakingBanner visible={serverWaking} />
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.appShell}>
                <PhoneVerificationScreen
                  api={api}
                  status={phoneVerification}
                  onVerified={(deviceId) => void handlePhoneVerified(deviceId)}
                  onLogout={() => {
                    setPhoneVerification(null);
                    void handleLogout();
                  }}
                />
              </View>
            </ScrollView>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.safeArea}>
      <SafeAreaView style={styles.safeAreaInner}>
      <StatusBar style="dark" />
      <Toast message={message} onDismiss={() => setMessage('')} />
      <View style={styles.content}>
        <View style={styles.topBar}>
          <Image
            source={APP_LOGO_IMAGE}
            resizeMode="contain"
            style={[styles.logoWordmark, styles.topBarLogo]}
            accessibilityLabel="Mecanifique"
          />
          <View style={styles.topBarRight}>
            <Text style={styles.topBarGreeting} numberOfLines={1}>
              Bienvenido
              {getFirstName(currentUser?.fullName) ? (
                <>
                  , <Text style={styles.topBarGreetingName}>{getFirstName(currentUser?.fullName)}</Text>
                </>
              ) : null}
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.bellButton,
                currentScreen === 'notifications' && styles.bellButtonActive,
                pressed && styles.buttonPressed,
              ]}
              onPress={openNotifications}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={
                unreadNotifications > 0 ? `Notificaciones, ${unreadNotifications} sin leer` : 'Notificaciones'
              }
            >
              <Ionicons
                name={unreadNotifications > 0 ? 'notifications' : 'notifications-outline'}
                size={22}
                color={colors.textDark}
              />
              {unreadNotifications > 0 && (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>{unreadNotifications > 9 ? '9+' : unreadNotifications}</Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>
        <ServerWakingBanner visible={serverWaking} />
        {updateReady && (
          <Pressable
            style={({ pressed }) => [styles.updateBanner, pressed && styles.buttonPressed]}
            onPress={() => void Updates.reloadAsync().catch(() => undefined)}
            accessibilityRole="button"
          >
            <Ionicons name="sparkles-outline" size={18} color={colors.white} />
            <Text style={styles.updateBannerText}>Hay una versión nueva de Mecanifique. Toca para actualizar.</Text>
          </Pressable>
        )}
        <ScrollView
          ref={mainScrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          alwaysBounceVertical
        >
        <View style={styles.appShell}>
          <View key={currentScreen}>
          <View style={styles.screenHeader}>
            {canGoBackInApp ? (
              <Pressable
                style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]}
                onPress={goBackInApp}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Volver"
              >
                <Ionicons name="arrow-back" size={22} color={colors.textDark} />
              </Pressable>
            ) : (
              <View style={styles.backButtonSpacer} />
            )}
            <Text style={[styles.title, styles.flex]}>
              {currentScreen === 'mechanics' && mechanicsView === 'profile'
                ? 'Perfil del mecánico'
                : getScreenTitle(currentScreen, currentUser?.role)}
            </Text>
            <View style={styles.backButtonSpacer} />
          </View>
          {currentScreen === 'home' && (
            <View style={styles.screenStack}>
              <HomeScreen
                api={api}
                mechanicProfile={mechanicProfile}
                onStartIdentityVerification={handleStartIdentityVerification}
                onSaveLaborRate={handleSaveLaborRate}
                requestForm={requestForm}
                setRequestForm={setRequestForm}
                onToggleMechanicConnection={handleToggleMechanicConnection}
                onLoadRequestById={loadRequestDetailById}
                onRefreshRequests={loadMyRequests}
                onCancelRequest={handleCancelRequest}
                onSearchAgain={handleSearchAgain}
                onEmergencyCall={handleEmergencyCall}
                onSendMessage={handleSendMessage}
                onAdvanceJob={handleAdvanceJob}
                onUseMyLocation={handleUseMyLocation}
              />
            </View>
          )}

          {currentScreen === 'account' && (
            <View style={styles.screenStack}>
              <AccountScreen
                onDeleteAccount={handleDeleteAccount}
                onOpenCommunity={openCommunity}
                favoriteMechanics={favoriteMechanics}
                onOpenMechanic={openMechanicProfile}
                onLoadAccountProfile={loadAccountProfile}
                onUpdateProfile={handleUpdateProfile}
                onChangePassword={handleChangePassword}
                onSendSupport={handleSendSupport}
                onStartIdentityVerification={handleStartIdentityVerification}
                onClearSession={handleLogout}
                onSwitchRole={handleSwitchRole}
              />
            </View>
          )}

          {currentScreen === 'vehicles' && currentUser?.role === 'customer' && (
            <View style={styles.screenStack}>
              <VehiclesScreen onAddVehicle={handleAddVehicle} onSetPrimaryVehicle={handleSetPrimaryVehicle} />
            </View>
          )}

          {currentScreen === 'requests' && (
            <View style={styles.screenStack}>
            <RequestsScreen
              api={api}
              onReloadRequest={loadRequestDetailById}
              serviceFee={serviceFeeConfig}
              requestForm={requestForm}
              setRequestForm={setRequestForm}
              requestMechanicIdNumber={requestMechanicIdNumber}
              requestMechanicSlots={bookableRequestSlots}
              requestMechanicSlotsDates={requestMechanicSlotsDates}
              selectedRequestScheduleDate={selectedRequestScheduleDate}
              setSelectedRequestScheduleDate={setSelectedRequestScheduleDate}
              requestFilteredSlots={requestFilteredSlots}
              requestLookupId={requestLookupId}
              setRequestLookupId={setRequestLookupId}
              reviewForm={reviewForm}
              setReviewForm={setReviewForm}
              showDisputeForm={showDisputeForm}
              setShowDisputeForm={setShowDisputeForm}
              disputeForm={disputeForm}
              setDisputeForm={setDisputeForm}
              onLoadMyRequests={loadMyRequests}
              onLoadRequestById={loadRequestDetailById}
              onOpenRequestActions={openRequestActions}
              onCancelRequest={handleCancelRequest}
              onSearchAgain={handleSearchAgain}
              onUseMyLocation={handleUseMyLocation}
              onSaveCurrentVehicle={saveCurrentVehicle}
              onCreateRequest={handleCreateRequest}
              onLoadRequestLookup={handleLoadRequest}
              onEmergencyCall={handleEmergencyCall}
              onSubmitReview={handleSubmitReview}
              onSubmitDispute={handleSubmitDispute}
              onSendMessage={handleSendMessage}
            />
            </View>
          )}

          {currentScreen === 'mechanics' && currentUser && currentUser.role !== 'mechanic' && (
            <View style={styles.screenStack}>
            <MechanicsScreen
              api={api}
              view={mechanicsView}
              onOpenMechanic={openMechanicProfile}
              favoriteMechanicIds={favoriteMechanics.map((mechanic) => mechanic.id)}
              onToggleFavorite={handleToggleFavorite}
              mechanicsFilter={mechanicsFilter}
              setMechanicsFilter={setMechanicsFilter}
              requestForm={requestForm}
              setRequestForm={setRequestForm}
              mechanicCursor={mechanicCursor}
              selectedMechanicReviews={selectedMechanicReviews}
              selectedMechanicReviewStats={selectedMechanicReviewStats}
              scheduleDates={bookableScheduleDates}
              selectedScheduleDate={selectedScheduleDate}
              setSelectedScheduleDate={setSelectedScheduleDate}
              filteredScheduleSlots={bookableFilteredSlots}
              onLoadMechanics={loadMechanics}
              onRequestCurrentLocation={requestCurrentLocation}
              onLoadNearbyMechanics={loadNearbyMechanics}
            />
            </View>
          )}

          {currentScreen === 'map' && currentUser?.role === 'mechanic' && (
            <View style={styles.screenStack}>
              <MapScreen onRespondToIncoming={handleIncomingResponse} />
            </View>
          )}

          {currentScreen === 'community' && currentUser && (
            <View style={styles.screenStack}>
              <CommunityScreen
                api={api}
                view={communityView}
                setView={setCommunityView}
                onOpenMechanic={openMechanicProfile}
              />
            </View>
          )}

          {currentScreen === 'notifications' && currentUser && (
            <View style={styles.screenStack}>
              <NotificationsScreen
                onOpenNotification={handleOpenNotification}
                onMarkRead={markNotificationRead}
                onMarkAllRead={handleMarkAllNotificationsRead}
              />
            </View>
          )}

          {currentScreen === 'promotions' && currentUser && (
            <View style={styles.screenStack}>
              <PromotionsScreen api={api} onOpenMechanic={openMechanicProfile} />
            </View>
          )}

          {currentScreen === 'actions' && currentUser && (currentUser.role === 'admin' || currentUser.role === 'mechanic') && (
            <View style={styles.screenStack}>
            <ActionsScreen
              onDeleteAccount={handleDeleteAccount}
              api={api}
              onOpenCommunity={openCommunity}
              mechanicAccountActive={mechanicProfile?.status === 'active'}
              selectedActionRequest={selectedActionRequest}
              actionsView={actionsView}
              setActionsView={setActionsView}
              assignForm={assignForm}
              setAssignForm={setAssignForm}
              statusForm={statusForm}
              setStatusForm={setStatusForm}
              serviceStatusForm={serviceStatusForm}
              setServiceStatusForm={setServiceStatusForm}
              publicProfileForm={publicProfileForm}
              setPublicProfileForm={setPublicProfileForm}
              scheduleDates={scheduleDates}
              selectedScheduleDate={selectedScheduleDate}
              setSelectedScheduleDate={setSelectedScheduleDate}
              filteredScheduleSlots={filteredScheduleSlots}
              slotForm={slotForm}
              setSlotForm={setSlotForm}
              availabilityForm={availabilityForm}
              setAvailabilityForm={setAvailabilityForm}
              adminDisputes={adminDisputes}
              disputeResolutionNotes={disputeResolutionNotes}
              setDisputeResolutionNotes={setDisputeResolutionNotes}
              disputeRefundAmounts={disputeRefundAmounts}
              setDisputeRefundAmounts={setDisputeRefundAmounts}
              onStartIdentityVerification={handleStartIdentityVerification}
              onAssignRequest={handleAssignRequest}
              onChangeMechanicStatus={handleChangeMechanicStatus}
              onChangeServiceRequestStatus={handleChangeServiceRequestStatus}
              onToggleAvailability={handleToggleAvailability}
              onSavePublicProfile={handleSavePublicProfile}
              onAddProfilePhoto={handleAddProfilePhoto}
              onRemoveProfilePhoto={handleRemoveProfilePhoto}
              onCreateScheduleSlot={handleCreateScheduleSlot}
              onResolveDispute={handleResolveDispute}
              onClearSession={handleLogout}
              onSwitchRole={handleSwitchRole}
            />
            </View>
          )}

          </View>
        </View>
        </ScrollView>
      </View>
      <IncomingRequestOverlay onRespond={handleIncomingResponse} />
      <View style={styles.bottomNavDock}>
        <View style={styles.bottomNav}>
          <BottomNavButton
            active={currentScreen === 'home'}
            onPress={() => setCurrentScreen('home')}
            iconName="home-outline"
            label="Inicio"
            accessibilityLabel="Inicio"
          />
          <BottomNavButton
            active={currentScreen === 'requests'}
            onPress={() => {
              setCurrentScreen('requests');
              setRequestsView('list');
            }}
            iconName="car-outline"
            label="Solicitudes"
            accessibilityLabel="Solicitudes"
          />
          {currentUser && currentUser.role !== 'mechanic' && (
            <BottomNavButton
              active={currentScreen === 'mechanics'}
              onPress={() => setCurrentScreen('mechanics')}
              iconName="construct-outline"
              label="Mecánicos"
              accessibilityLabel="Mecánicos"
            />
          )}
          {currentUser?.role === 'mechanic' && (
            <BottomNavButton
              active={currentScreen === 'map'}
              onPress={() => setCurrentScreen('map')}
              iconName="map-outline"
              label="Mapa"
              accessibilityLabel="Mapa"
            />
          )}
          <BottomNavButton
            active={['actions', 'account', 'vehicles', 'community', 'promotions'].includes(currentScreen)}
            onPress={() => setCurrentScreen(currentUser?.role === 'customer' ? 'account' : 'actions')}
            iconName={currentUser?.role === 'customer' ? 'person-circle-outline' : 'ellipsis-horizontal'}
            label={currentUser?.role === 'customer' ? 'Cuenta' : 'Acciones'}
            accessibilityLabel={currentUser?.role === 'customer' ? 'Cuenta' : 'Acciones'}
          />
        </View>
      </View>
      </SafeAreaView>
    </View>
  );
}