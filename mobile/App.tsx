import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { colors } from './colors';
import { styles } from './styles';
import { useAppContext } from './context/AppContext';
import { HomeScreen } from './screens/HomeScreen';
import { MechanicsScreen } from './screens/MechanicsScreen';
import { MapScreen } from './screens/MapScreen';
import { RequestsScreen } from './screens/RequestsScreen';
import { AccountScreen } from './screens/AccountScreen';
import { ActionsScreen } from './screens/ActionsScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { VehiclesScreen } from './screens/VehiclesScreen';
import { IncomingRequestOverlay } from './components/IncomingRequestOverlay';
import { LoginScreen } from './screens/LoginScreen';
import { BottomNavButton, Toast } from './components/ui';
import * as Haptics from 'expo-haptics';
import {
  normalizeSpecialties,
  formatError,
  normalizeServerTextError,
  getMechanicPublicStatus,
  getServiceRequestStatusLabel,
  formatCalendarDate,
} from './utils';
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
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
} from 'react-native';

type Role = 'customer' | 'mechanic' | 'admin';
type AuthMode = 'login' | 'customer' | 'mechanic';
type MechanicStatus = 'pending_verification' | 'active' | 'suspended';
type AppScreen = 'home' | 'requests' | 'mechanics' | 'map' | 'actions' | 'account' | 'vehicles';
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
};

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
};

type IdentityVerificationStatus = 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected';

type IdentityVerificationState = {
  status: IdentityVerificationStatus | null;
};

type DisputeCategory = 'incomplete_work' | 'incorrect_charge' | 'vehicle_damage' | 'other';
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
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || defaultApiBaseUrl;
const AUTH_TOKEN_KEY = 'mecanifique.auth.token';
const AUTH_USER_KEY = 'mecanifique.auth.user';
const ONBOARDING_KEY = 'mecanifique.onboarding.seen';
const API_REQUEST_TIMEOUT_MS = 15_000;
const STATUS_REFRESH_INTERVAL_MS = 10_000;
const APP_LOGO_IMAGE = require('./assets/logo.png');
const ONBOARDING_MECHANIC_IMAGE = require('./assets/onboarding-mechanic.png');

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
    icon: 'search-outline' as const,
  },
  {
    title: 'Solicita un servicio',
    body: 'Pide ayuda directo a un mecánico, reserva turnos y sigue el flujo del servicio.',
    icon: 'car-sport-outline' as const,
    image: ONBOARDING_MECHANIC_IMAGE,
  },
  {
    title: 'Mecánicos se conectan y reciben pedidos',
    body: 'El mecánico entra online, recibe solicitudes y gestiona agenda, updates y estado.',
    icon: 'notifications-outline' as const,
  },
] as const;

function getScreenTitle(screen: AppScreen, role: Role | undefined): string {
  switch (screen) {
    case 'home':
      return role === 'mechanic' ? 'Panel de servicio' : 'Inicio';
    case 'mechanics':
      return 'Encuentra tu mecánico';
    case 'requests':
      return 'Tus solicitudes';
    case 'map':
      return role === 'mechanic' ? 'Solicitud entrante' : 'Mecánicos cerca de ti';
    case 'actions':
      return 'Acciones';
    case 'account':
      return 'Tu cuenta';
    case 'vehicles':
      return 'Mis vehículos';
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
    city: 'Aguascalientes',
    zone: 'Norte',
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
  const [updateForm, setUpdateForm] = useState({
    requestId: '',
    message: '',
  });
  const [slotForm, setSlotForm] = useState({
    mechanicId: '',
    slotDate: '',
    startTime: '',
    endTime: '',
    note: '',
  });
  const [publicProfileForm, setPublicProfileForm] = useState({
    bio: '',
    coverPhotoUrl: '',
    galleryUrls: '',
    laborRate: '',
  });
  const [reviewForm, setReviewForm] = useState({
    rating: '5',
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
  const [requestCursor, setRequestCursor] = useState(0);
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
  const requestMechanicSlotsDates = useMemo(() => {
    return Array.from(new Set(requestMechanicSlots.map((slot) => slot.slotDate))).slice(0, 7);
  }, [requestMechanicSlots]);
  const requestFilteredSlots = useMemo(() => {
    if (!selectedRequestScheduleDate) {
      return requestMechanicSlots;
    }
    return requestMechanicSlots.filter((slot) => slot.slotDate === selectedRequestScheduleDate);
  }, [requestMechanicSlots, selectedRequestScheduleDate]);
  const liveLocationRequest = useMemo(
    () =>
      user?.role === 'mechanic'
        ? myRequests.find((request) => request.status !== 'completed' && request.status !== 'cancelled')
        : undefined,
    [myRequests, user?.role],
  );

  useEffect(() => {
    async function restoreSession() {
      try {
        let [storedToken, storedUser] = await Promise.all([
          SecureStore.getItemAsync(AUTH_TOKEN_KEY),
          SecureStore.getItemAsync(AUTH_USER_KEY),
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
          setToken(storedToken);
          setUser(parsedUser);

          const me = await apiRequest<{ user: Partial<AuthUser> }>('/auth/v2/me', {
            token: storedToken,
          });

          const restoredUser = {
            ...parsedUser,
            ...me.user,
            fullName: me.user.fullName || parsedUser.fullName || me.user.login || '',
          } as AuthUser;
          setUser(restoredUser);
          await persistSession(storedToken, restoredUser);
        }

        setOnboardingSeen(storedToken && storedUser ? true : storedOnboarding === '1');
        if (!storedToken || !storedUser) {
          return;
        }
      } catch {
        await clearSession();
        setOnboardingSeen(false);
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

    loadNotifications().catch((error) => setMessage(formatError(error)));
    registerPushToken(token).catch(() => undefined);
  }, [user, token]);

  useEffect(() => {
    if (myRequests.length === 0) {
      setRequestCursor(0);
      return;
    }

    if (requestCursor >= myRequests.length) {
      setRequestCursor(myRequests.length - 1);
    }
  }, [myRequests, requestCursor]);

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
  }, [user, onboardingSeen, onboardingStep, authMode, mechanicSignupStep, currentScreen, requestsView, requestCreateStep]);

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
    if (currentScreen !== 'home') {
      setCurrentScreen('home');
      return true;
    }
    return false;
  }

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
    if (myRequests.length === 0) {
      setRequestCursor(0);
      return;
    }
    if (requestCursor >= myRequests.length) {
      setRequestCursor(myRequests.length - 1);
    }
  }, [myRequests, requestCursor]);

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

  useEffect(() => {
    if (
      user?.role !== 'mechanic' ||
      !user.mechanicId ||
      mechanicConnection !== 'online' ||
      !liveLocationRequest ||
      !token
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
  }, [liveLocationRequest, mechanicConnection, token, user?.mechanicId, user?.role]);

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

      if (!selectedRequest?.id) {
        if (user?.role === 'mechanic' && mechanicConnection === 'online') {
          loadIncomingRequest().catch((error) => setMessage(formatError(error)));
        }
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

  async function persistSession(nextToken: string, nextUser: AuthUser | null) {
    if (!nextUser) {
      await clearSession();
      return;
    }

    await Promise.all([
      SecureStore.setItemAsync(AUTH_TOKEN_KEY, nextToken),
      SecureStore.setItemAsync(AUTH_USER_KEY, JSON.stringify(nextUser)),
    ]);
  }

  async function clearSession() {
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
    await Promise.all([
      SecureStore.deleteItemAsync(AUTH_TOKEN_KEY),
      SecureStore.deleteItemAsync(AUTH_USER_KEY),
      AsyncStorage.removeItem(AUTH_TOKEN_KEY),
      AsyncStorage.removeItem(AUTH_USER_KEY),
    ]);
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
      method?: 'GET' | 'POST' | 'PATCH';
      body?: unknown;
      token?: string;
    } = {},
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
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
        throw new Error(`El servidor no respondió en ${API_REQUEST_TIMEOUT_MS / 1000} segundos. Revisa la URL del backend.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();

    if (!response.ok) {
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

      throw new Error(errorMessage);
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

  async function handleSavePublicProfile() {
    if (!user?.mechanicId) {
      setMessage('No se encontró tu mechanicId');
      return;
    }

    setBusy(true);
    try {
      const galleryUrls = publicProfileForm.galleryUrls
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      await apiRequest(`/api/mechanics/${user.mechanicId}/public-profile`, {
        method: 'PATCH',
        token,
        body: {
          bio: publicProfileForm.bio || undefined,
          coverPhotoUrl: publicProfileForm.coverPhotoUrl || '',
          galleryUrls,
          laborRate: publicProfileForm.laborRate ? Number(publicProfileForm.laborRate) : undefined,
        },
      });
      await loadMechanics();
      setMessage('Perfil público actualizado');
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitReview() {
    if (!selectedRequest || !selectedRequest.mechanicId) {
      setMessage('No hay solicitud mecánica seleccionada');
      return;
    }

    if (!reviewForm.comment.trim()) {
      setMessage('Escribe un comentario');
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
      setReviewForm({ rating: '5', comment: '' });
      await loadMechanicReviews(selectedRequest.mechanicId);
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

  async function loadMyRequests(nextToken = token) {
    const data = await apiRequest<RequestSummary[]>('/api/service-requests/mine', {
      token: nextToken,
    });
    setMyRequests(data);
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

  async function handleMarkNotificationRead(notificationId: number) {
    if (!token) {
      return;
    }

    setBusy(true);
    try {
      await apiRequest(`/api/notifications/${notificationId}/read`, {
        method: 'POST',
        token,
      });
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
      
      console.log('🔵 API_BASE_URL:', API_BASE_URL);
      console.log('🔵 Auth mode:', authMode);

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
      await persistSession(response.accessToken, response.user);
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

  async function handleGoogleLogin() {
    setBusy(true);
    setMessage('Abriendo Google...');
    try {
      const redirectUri = Linking.createURL('auth/callback');
      const { url: authUrl } = await apiRequest<{ url: string }>(
        `/auth/v2/google?redirectTo=${encodeURIComponent(redirectUri)}`,
      );
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);
      if (result.type !== 'success' || !result.url) {
        setMessage('Inicio con Google cancelado');
        return;
      }

      const hash = result.url.split('#')[1] || '';
      const params = new URLSearchParams(hash);
      const accessToken = params.get('access_token');
      if (!accessToken) {
        throw new Error('Google no devolvió una sesión válida');
      }

      const me = await apiRequest<{ user: AuthUser }>('/auth/v2/me', { token: accessToken });
      setToken(accessToken);
      setUser(me.user);
      setLocationAutoRequested(false);
      setCurrentScreen('home');
      await persistSession(accessToken, me.user);
      await loadMyRequests(accessToken);
      setMessage(`Sesión iniciada como ${me.user.role}`);
    } catch (error) {
      setMessage(formatError(error));
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

  async function handleCreateRequest() {
    if (!user) return;

    setBusy(true);
    setMessage('Creando solicitud...');

    try {
      const latitude = requestForm.latitude ? Number(requestForm.latitude) : undefined;
      const longitude = requestForm.longitude ? Number(requestForm.longitude) : undefined;
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
      };

      const request = await apiRequest<ServiceRequest>('/api/service-requests', {
        method: 'POST',
        body: payload,
        token,
      });

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
    setUpdateForm((current) => ({ ...current, requestId: String(request.id) }));
    setCurrentScreen('actions');
    setActionsView('requestStatus');
  }

  async function loadVehicles() {
    const data = await apiRequest<{ vehicles: VehicleProfile[] }>('/api/vehicles', { token });
    setVehicles(data.vehicles);
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
      await persistSession(token, response.user);
      setCurrentScreen(response.user.role === 'mechanic' ? 'home' : 'mechanics');
      setMessage(response.user.role === 'mechanic' ? 'Ahora estás en modo profesional' : 'Ahora estás en modo cliente');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (error) {
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
      if (next === 'online') {
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
        setUpdateForm((current) => ({ ...current, requestId: String(fullRequest.id) }));
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
    if (status === 'completed') {
      Alert.alert('¿Terminar el servicio?', 'Confírmalo solo cuando el trabajo esté listo. El cliente podrá calificarte.', [
        { text: 'Todavía no', style: 'cancel' },
        { text: 'Sí, terminar', onPress: () => void advanceJob(requestId, status) },
      ]);
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
      await loadRequestDetailById(requestId);
      await loadMyRequests();
      setMessage(status === 'completed' ? 'Servicio terminado. ¡Buen trabajo!' : `Estado: ${getServiceRequestStatusLabel(status)}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
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

  async function loadRequestDetailById(requestId: number) {
    const fullRequest = await apiRequest<ServiceRequest>(`/service-requests/${requestId}`, { token });
    setSelectedRequest(fullRequest);
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

  async function handleAddUpdate() {
    if (!updateForm.requestId) return;

    setBusy(true);
    try {
      await apiRequest(`/api/service-requests/${updateForm.requestId}/updates`, {
        method: 'POST',
        token,
        body: {
          source: 'mechanic',
          message: updateForm.message,
        },
      });
      await loadMyRequests();
      setMessage('Update publicado');
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleChangeServiceRequestStatus() {
    if (!serviceStatusForm.requestId) {
      setMessage('Falta requestId');
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
      setMessage('Falta mechanicId para crear el turno');
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
          <ActivityIndicator size="large" />
          <Text style={styles.subtitle}>Cargando sesión...</Text>
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
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                alwaysBounceVertical
                keyboardShouldPersistTaps="handled"
              >
                <LinearGradient colors={[colors.white, colors.primaryLighter]} style={styles.shell}>
                  <Image source={APP_LOGO_IMAGE} resizeMode="contain" style={styles.logoWordmark} accessibilityLabel="Mecanifique" />
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
                </LinearGradient>
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
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              alwaysBounceVertical
              keyboardShouldPersistTaps="handled"
            >
            <LinearGradient colors={[colors.white, colors.primaryLighter]} style={styles.shell}>
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
                onGoogleLogin={handleGoogleLogin}
                onShowOnboarding={showOnboardingAgain}
              />
            </LinearGradient>
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
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          alwaysBounceVertical
        >
        <View style={styles.appShell}>
          <Image source={APP_LOGO_IMAGE} resizeMode="contain" style={styles.logoWordmark} accessibilityLabel="Mecanifique" />
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
            <Text style={[styles.title, styles.flex]}>{getScreenTitle(currentScreen, currentUser?.role)}</Text>
            <View style={styles.backButtonSpacer} />
          </View>
          {currentScreen === 'home' && (
            <View>
              <HomeScreen
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
              />
            </View>
          )}

          {currentScreen === 'home' && unreadNotifications > 0 && (
            <Pressable style={styles.notificationBanner} onPress={() => setCurrentScreen('account')}>
              <Ionicons name="notifications-outline" size={18} color={colors.textDark} />
              <Text style={styles.sessionText}>
                {unreadNotifications} notificaciones sin leer — ver en Cuenta
              </Text>
            </Pressable>
          )}

          {currentScreen === 'account' && (
            <View>
              <AccountScreen
                onStartIdentityVerification={handleStartIdentityVerification}
                onLoadNotifications={loadNotifications}
                onMarkNotificationRead={handleMarkNotificationRead}
                onClearSession={clearSession}
                onSwitchRole={handleSwitchRole}
              />
            </View>
          )}

          {currentScreen === 'vehicles' && currentUser?.role === 'customer' && (
            <View>
              <VehiclesScreen onAddVehicle={handleAddVehicle} onSetPrimaryVehicle={handleSetPrimaryVehicle} />
            </View>
          )}

          {currentScreen === 'requests' && (
            <View>
            <RequestsScreen
              requestCursor={requestCursor}
              setRequestCursor={setRequestCursor}
              requestForm={requestForm}
              setRequestForm={setRequestForm}
              requestMechanicIdNumber={requestMechanicIdNumber}
              requestMechanicSlots={requestMechanicSlots}
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
            <View>
            <MechanicsScreen
              mechanicsFilter={mechanicsFilter}
              setMechanicsFilter={setMechanicsFilter}
              requestForm={requestForm}
              setRequestForm={setRequestForm}
              mechanicCursor={mechanicCursor}
              setMechanicCursor={setMechanicCursor}
              selectedMechanicReviews={selectedMechanicReviews}
              selectedMechanicReviewStats={selectedMechanicReviewStats}
              scheduleDates={scheduleDates}
              selectedScheduleDate={selectedScheduleDate}
              setSelectedScheduleDate={setSelectedScheduleDate}
              filteredScheduleSlots={filteredScheduleSlots}
              onLoadMechanics={loadMechanics}
              onRequestCurrentLocation={requestCurrentLocation}
              onLoadNearbyMechanics={loadNearbyMechanics}
            />
            </View>
          )}

          {currentScreen === 'map' && currentUser && (
            <View>
              <MapScreen onRespondToIncoming={handleIncomingResponse} />
            </View>
          )}

          {currentScreen === 'actions' && currentUser && (currentUser.role === 'admin' || currentUser.role === 'mechanic') && (
            <View>
            <ActionsScreen
              selectedActionRequest={selectedActionRequest}
              actionsView={actionsView}
              setActionsView={setActionsView}
              assignForm={assignForm}
              setAssignForm={setAssignForm}
              statusForm={statusForm}
              setStatusForm={setStatusForm}
              serviceStatusForm={serviceStatusForm}
              setServiceStatusForm={setServiceStatusForm}
              updateForm={updateForm}
              setUpdateForm={setUpdateForm}
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
              onAddUpdate={handleAddUpdate}
              onToggleAvailability={handleToggleAvailability}
              onSavePublicProfile={handleSavePublicProfile}
              onCreateScheduleSlot={handleCreateScheduleSlot}
              onResolveDispute={handleResolveDispute}
              onClearSession={clearSession}
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
          <BottomNavButton
            active={currentScreen === 'map'}
            onPress={() => setCurrentScreen('map')}
            iconName="map-outline"
            label="Mapa"
            accessibilityLabel="Mapa"
          />
          {currentUser?.role === 'customer' && (
            <BottomNavButton
              active={currentScreen === 'vehicles'}
              onPress={() => setCurrentScreen('vehicles')}
              iconName="car-sport-outline"
              label="Vehículo"
              accessibilityLabel="Mis vehículos"
            />
          )}
          <BottomNavButton
            active={currentScreen === 'actions' || currentScreen === 'account'}
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