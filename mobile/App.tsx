import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from './colors';
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import MapView, { Marker, type Region } from 'react-native-maps';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type Role = 'customer' | 'mechanic' | 'admin';
type AuthMode = 'login' | 'customer' | 'mechanic';
type MechanicStatus = 'pending_verification' | 'active' | 'suspended';
type AppScreen = 'home' | 'requests' | 'mechanics' | 'map' | 'actions' | 'account';
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
  licensePlate?: string | null;
  color?: string | null;
  mileage?: number | null;
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

const DEFAULT_REGION: Region = {
  latitude: 21.8818,
  longitude: -102.2916,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
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
const APP_BACKGROUND_IMAGE = require('./assets/blue-bg.png');
const APP_LOGO_IMAGE = require('./assets/logo.png');
const GOOGLE_MAPS_API_KEY = Constants.expoConfig?.android?.config?.googleMaps?.apiKey;
const isMapConfigured = Boolean(GOOGLE_MAPS_API_KEY);

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
  },
  {
    title: 'Mecánicos se conectan y reciben pedidos',
    body: 'El mecánico entra online, recibe solicitudes y gestiona agenda, updates y estado.',
    icon: 'notifications-outline' as const,
  },
] as const;

function normalizeSpecialties(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Ocurrió un error inesperado';
}

function normalizeServerTextError(payloadText: string): string {
  const preMatch = payloadText.match(/<pre>([\s\S]*?)<\/pre>/i);
  const rawMessage = preMatch ? preMatch[1] : payloadText;
  const cleanMessage = rawMessage.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  if (cleanMessage.includes('Cannot PATCH /api/mechanics/') && cleanMessage.includes('/online')) {
    return 'No se pudo conectar. Verifica que el backend esté corriendo.';
  }

  return cleanMessage || 'Error inesperado';
}

function getMechanicPublicStatus(mechanic: Mechanic): string {
  if (!mechanic.isOnline) {
    return 'Fuera de línea';
  }

  if (mechanic.isAvailable) {
    return 'Disponible para solicitudes';
  }

  return 'Conectado pero ocupado';
}

function getServiceRequestStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: 'Pendiente',
    assigned: 'Asignada',
    in_progress: 'En progreso',
    en_route: 'En camino',
    on_site: 'En sitio',
    diagnosing: 'Diagnosticando',
    repairing: 'Reparando',
    awaiting_parts: 'Esperando refacciones',
    completed: 'Terminada',
    cancelled: 'Cancelada',
  };

  return labels[status] || status;
}

function formatCalendarDate(date: string): { weekday: string; day: string; month: string } {
  const parsed = new Date(`${date}T00:00:00`);
  const weekdays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  if (Number.isNaN(parsed.getTime())) {
    return { weekday: 'Día', day: date, month: '' };
  }

  return {
    weekday: weekdays[parsed.getDay()],
    day: String(parsed.getDate()).padStart(2, '0'),
    month: months[parsed.getMonth()],
  };
}

export default function App() {
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [mechanicSignupStep, setMechanicSignupStep] = useState<MechanicSignupStep>('account');
  const [onboardingSeen, setOnboardingSeen] = useState<boolean | null>(null);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [token, setToken] = useState('');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Listo');
  const [locationAutoRequested, setLocationAutoRequested] = useState(false);
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [mechanicSlots, setMechanicSlots] = useState<ScheduleSlot[]>([]);
  const [selectedMechanicReviews, setSelectedMechanicReviews] = useState<MechanicReview[]>([]);
  const [selectedMechanicReviewStats, setSelectedMechanicReviewStats] = useState<{ averageRating: number | null; reviewCount: number }>({
    averageRating: null,
    reviewCount: 0,
  });
  const [requestMechanicSlots, setRequestMechanicSlots] = useState<ScheduleSlot[]>([]);
  const [nearbyMechanics, setNearbyMechanics] = useState<Mechanic[]>([]);
  const [myRequests, setMyRequests] = useState<RequestSummary[]>([]);
  const [vehicles, setVehicles] = useState<VehicleProfile[]>([]);
  const [identityState, setIdentityState] = useState<IdentityVerificationState>({ status: null });
  const [identityBusy, setIdentityBusy] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [selectedRequest, setSelectedRequest] = useState<ServiceRequest | null>(null);
  const [selectedActionRequest, setSelectedActionRequest] = useState<ServiceRequest | RequestSummary | null>(null);
  const [requestMessages, setRequestMessages] = useState<RequestMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState('');
  const [incomingRequest, setIncomingRequest] = useState<ServiceRequest | null>(null);
  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(null);

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
  const [mechanicConnection, setMechanicConnection] = useState<'online' | 'offline'>('offline');

  const selectedMechanicId = useMemo(() => user?.mechanicId?.toString() || '', [user]);
  const currentUser = user;
  const [currentScreen, setCurrentScreen] = useState<AppScreen>('home');
  const [requestsView, setRequestsView] = useState<RequestsView>('list');
  const [requestCreateStep, setRequestCreateStep] = useState<RequestCreateStep>('vehicle');
  const [actionsView, setActionsView] = useState<ActionsView>('assign');
  const [requestCursor, setRequestCursor] = useState(0);
  const [mechanicCursor, setMechanicCursor] = useState(0);
  const [mechanicReviewsExpanded, setMechanicReviewsExpanded] = useState(false);
  const [selectedScheduleDate, setSelectedScheduleDate] = useState('');
  const [selectedRequestScheduleDate, setSelectedRequestScheduleDate] = useState('');
  const locationLabel = currentLocation
    ? `${currentLocation.latitude.toFixed(4)}, ${currentLocation.longitude.toFixed(4)}`
    : 'Ubicación pendiente';
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
        const [storedToken, storedUser, storedOnboarding] = await Promise.all([
          AsyncStorage.getItem(AUTH_TOKEN_KEY),
          AsyncStorage.getItem(AUTH_USER_KEY),
          AsyncStorage.getItem(ONBOARDING_KEY),
        ]);

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
    if (user?.role !== 'customer' || !token) {
      setVehicles([]);
      return;
    }
    apiRequest<{ vehicles: VehicleProfile[] }>('/api/vehicles', { token })
      .then((data) => setVehicles(data.vehicles))
      .catch((error) => setMessage(formatError(error)));
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
      AsyncStorage.setItem(AUTH_TOKEN_KEY, nextToken),
      AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(nextUser)),
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

  async function loadNearbyMechanics(latitude: number, longitude: number) {
    const params = new URLSearchParams();
    params.set('latitude', String(latitude));
    params.set('longitude', String(longitude));
    params.set('available', 'true');
    params.set('radiusKm', '25');

    const data = await apiRequest<Mechanic[]>(`/mechanics?${params.toString()}`);
    setNearbyMechanics(data);
  }

  function getMapRegion(): Region {
    if (
      incomingRequest?.latitude !== null &&
      incomingRequest?.latitude !== undefined &&
      incomingRequest.longitude !== null &&
      incomingRequest.longitude !== undefined
    ) {
      return {
        latitude: incomingRequest.latitude,
        longitude: incomingRequest.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
    }

    if (currentLocation) {
      return {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      };
    }

    if (selectedRequest?.latitude !== null && selectedRequest?.latitude !== undefined &&
      selectedRequest.longitude !== null && selectedRequest.longitude !== undefined) {
      return {
        latitude: selectedRequest.latitude,
        longitude: selectedRequest.longitude,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      };
    }

    return DEFAULT_REGION;
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
    } catch (error) {
      setMessage(formatError(error));
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
      setRequestsView('detail');
      setMessage(`Solicitud #${request.id} creada. Buscando un mecánico cercano...`);
      void loadMyRequests().catch((error) => setMessage(formatError(error)));
    } catch (error) {
      setMessage(formatError(error));
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

  async function handleIncomingResponse(action: 'accept' | 'reject') {
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
      if (action === 'accept') {
        const fullRequest = await apiRequest<ServiceRequest>(`/service-requests/${incomingRequest.id}`, { token });
        setSelectedRequest(fullRequest);
        setSelectedActionRequest(fullRequest);
        setRequestLookupId(String(fullRequest.id));
        setServiceStatusForm((current) => ({ ...current, requestId: String(fullRequest.id) }));
        setUpdateForm((current) => ({ ...current, requestId: String(fullRequest.id) }));
        setCurrentScreen('actions');
        setActionsView('requestStatus');
      }
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelRequest(requestId: number) {
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
      <ImageBackground source={APP_BACKGROUND_IMAGE} resizeMode="cover" style={styles.safeArea}>
        <SafeAreaView style={styles.centered}>
          <ActivityIndicator size="large" />
          <Text style={styles.subtitle}>Cargando sesión...</Text>
        </SafeAreaView>
      </ImageBackground>
    );
  }

  if (!user) {
    if (onboardingSeen === false) {
      const step = ONBOARDING_STEPS[onboardingStep];
      return (
        <ImageBackground source={APP_BACKGROUND_IMAGE} resizeMode="cover" style={styles.safeArea}>
          <SafeAreaView style={styles.safeAreaInner}>
            <StatusBar style="dark" />
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
                  <View style={styles.onboardingIconWrap}>
                    <Ionicons name={step.icon} size={42} color={colors.primary} />
                  </View>
                  <Text style={styles.title}>{step.title}</Text>
                  <Text style={styles.subtitle}>{step.body}</Text>
                  <View style={styles.onboardingDots}>
                    {ONBOARDING_STEPS.map((_, index) => (
                      <View key={index} style={[styles.onboardingDot, index === onboardingStep && styles.onboardingDotActive]} />
                    ))}
                  </View>
                  <PrimaryButton
                    title={onboardingStep === ONBOARDING_STEPS.length - 1 ? 'Empezar' : 'Siguiente'}
                    onPress={async () => {
                      if (onboardingStep < ONBOARDING_STEPS.length - 1) {
                        setOnboardingStep((value) => value + 1);
                        return;
                      }
                      await completeOnboarding();
                    }}
                  />
                  <SecondaryButton
                    title="Saltar"
                    onPress={async () => {
                      await completeOnboarding();
                    }}
                  />
                </LinearGradient>
              </ScrollView>
            </View>
          </SafeAreaView>
        </ImageBackground>
      );
    }

    return (
      <ImageBackground source={APP_BACKGROUND_IMAGE} resizeMode="cover" style={styles.safeArea}>
        <SafeAreaView style={styles.safeAreaInner}>
          <StatusBar style="dark" />
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
            <Text style={styles.title}>Inicia sesión</Text>
            <Text style={styles.subtitle}>Accede para ver mapa, solicitudes y mecánicos.</Text>
            <Card title="Sesión" subtitle="Inicia sesión o regístrate">
              <Segmented
                value={authMode}
                options={[
                  { key: 'login', label: 'Login' },
                  { key: 'customer', label: 'Cliente' },
                  { key: 'mechanic', label: 'Mecánico' },
                ]}
                onChange={(value) => setAuthMode(value as AuthMode)}
              />
              {authMode === 'login' && (
                <View style={styles.stack}>
                  <Field label="Email">
                    <Input value={loginForm.email} onChangeText={(value) => setLoginForm({ ...loginForm, email: value })} />
                  </Field>
                  <Field label="Contraseña">
                    <Input
                      value={loginForm.password}
                      onChangeText={(value) => setLoginForm({ ...loginForm, password: value })}
                      secureTextEntry
                    />
                  </Field>
                </View>
              )}
              {authMode === 'customer' && (
                <View style={styles.stack}>
                  <Field label="Nombre completo">
                    <Input
                      value={customerForm.fullName}
                      onChangeText={(value) => setCustomerForm({ ...customerForm, fullName: value })}
                    />
                  </Field>
                  <Field label="Email">
                    <Input
                      value={customerForm.email}
                      onChangeText={(value) => setCustomerForm({ ...customerForm, email: value })}
                      placeholder="correo@ejemplo.com"
                    />
                  </Field>
                  <Field label="Teléfono">
                    <Input value={customerForm.phone} onChangeText={(value) => setCustomerForm({ ...customerForm, phone: value })} />
                  </Field>
                  <Field label="Contraseña">
                    <Input
                      value={customerForm.password}
                      onChangeText={(value) => setCustomerForm({ ...customerForm, password: value })}
                      secureTextEntry
                    />
                  </Field>
                </View>
              )}
              {authMode === 'mechanic' && (
                <View style={styles.stack}>
                  <Segmented
                    value={mechanicSignupStep}
                    options={[
                      { key: 'account', label: 'Cuenta' },
                      { key: 'work', label: 'Trabajo' },
                    ]}
                    onChange={(value) => setMechanicSignupStep(value as MechanicSignupStep)}
                  />
                  {mechanicSignupStep === 'account' ? (
                    <View style={styles.stack}>
                      <Field label="Nombre completo">
                        <Input
                          value={mechanicForm.fullName}
                          onChangeText={(value) => setMechanicForm({ ...mechanicForm, fullName: value })}
                        />
                      </Field>
                     <Field label="Email">
                       <Input
                         value={mechanicForm.email}
                         onChangeText={(value) => setMechanicForm({ ...mechanicForm, email: value })}
                         placeholder="correo@ejemplo.com"
                       />
                     </Field>
                     <Field label="Teléfono">
                       <Input value={mechanicForm.phone} onChangeText={(value) => setMechanicForm({ ...mechanicForm, phone: value })} />
                      </Field>
                     <Field label="Contraseña">
                       <Input
                         value={mechanicForm.password}
                         onChangeText={(value) => setMechanicForm({ ...mechanicForm, password: value })}
                         secureTextEntry
                       />
                     </Field>
                     <SecondaryButton title="Continuar" onPress={() => setMechanicSignupStep('work')} />
                   </View>
                  ) : (
                    <View style={styles.stack}>
                      <View style={styles.row}>
                        <Field label="Ciudad" style={styles.flex}>
                          <Input value={mechanicForm.city} onChangeText={(value) => setMechanicForm({ ...mechanicForm, city: value })} />
                        </Field>
                        <Field label="Zona" style={styles.flex}>
                          <Input value={mechanicForm.zone} onChangeText={(value) => setMechanicForm({ ...mechanicForm, zone: value })} />
                        </Field>
                      </View>
                      <Field label="Años de experiencia">
                        <Input
                          value={mechanicForm.yearsExperience}
                          keyboardType="numeric"
                          onChangeText={(value) => setMechanicForm({ ...mechanicForm, yearsExperience: value })}
                        />
                      </Field>
                      <Field label="Especialidades (coma)">
                        <Input
                          value={mechanicForm.specialties}
                          onChangeText={(value) => setMechanicForm({ ...mechanicForm, specialties: value })}
                        />
                      </Field>
                      <Text style={styles.smallText}>
                        La ubicación se obtiene automáticamente al abrir la app.
                      </Text>
                      <SecondaryButton title="Volver" onPress={() => setMechanicSignupStep('account')} />
                    </View>
                  )}
                </View>
              )}
              <PrimaryButton
                title={authMode === 'login' ? 'Entrar' : 'Crear cuenta'}
                onPress={handleAuthSubmit}
                busy={busy}
              />
              {authMode === 'login' && (
                <SecondaryButton
                  title="Continuar con Google"
                  onPress={handleGoogleLogin}
                  busy={busy}
                />
              )}
            </Card>
            <SecondaryButton title="Ver introducción" onPress={showOnboardingAgain} />
            <View style={styles.statusPill}>
            <Text numberOfLines={2} style={styles.statusPillText}>{message}</Text>
            </View>
            </LinearGradient>
            </ScrollView>
          </View>
        </SafeAreaView>
      </ImageBackground>
    );
  }

  return (
    <ImageBackground source={APP_BACKGROUND_IMAGE} resizeMode="cover" style={styles.safeArea}>
      <SafeAreaView style={styles.safeAreaInner}>
      <StatusBar style="dark" />
      <View style={styles.content}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          alwaysBounceVertical
        >
        <LinearGradient colors={[colors.white, colors.primaryLighter]} style={styles.shell}>
          <Image source={APP_LOGO_IMAGE} resizeMode="contain" style={styles.logoWordmark} accessibilityLabel="Mecanifique" />
          <Text style={styles.title}>{currentScreen === 'home' ? 'Encuentra tu mecánico' : 'Panel de servicio'}</Text>
          {currentScreen === 'home' && (
            <>
              <Text style={styles.heroSubtitle}>Mecánicos verificados, cuando quieras y donde quieras.</Text>
              {user.role !== 'mechanic' && (
                <Pressable style={styles.heroButton} onPress={() => setCurrentScreen('mechanics')}>
                  <Text style={styles.heroButtonText}>Buscar mecánicos</Text>
                </Pressable>
              )}
            </>
          )}

          <View style={styles.locationPill}>
            <Text style={styles.locationPin}>📍</Text>
            <Text style={styles.locationText}>{locationLabel}</Text>
          </View>

          <View style={styles.sessionHeader}>
            <Text style={styles.sessionText}>{user.fullName} · {user.role}</Text>
            <SecondaryButton
              title="Cerrar sesión"
              compact
              onPress={async () => {
                await clearSession();
                setMessage('Sesión cerrada');
              }}
            />
          </View>

          <View style={styles.statusPill}>
            <Text numberOfLines={2} style={styles.statusPillText}>{message}</Text>
          </View>

          {currentScreen === 'home' && unreadNotifications > 0 && (
            <Pressable style={styles.notificationBanner} onPress={() => setCurrentScreen('account')}>
              <Ionicons name="notifications-outline" size={18} color={colors.textDark} />
              <Text style={styles.sessionText}>
                {unreadNotifications} notificaciones sin leer — ver en Cuenta
              </Text>
            </Pressable>
          )}

          {currentScreen === 'home' && user.role !== 'mechanic' && mechanics.length > 0 && (
            <Card title="Mecánicos destacados" subtitle="Perfil público, comentarios y disponibilidad">
              {mechanics.slice(mechanicCursor, mechanicCursor + 1).map((mechanic) => (
                <View key={mechanic.id} style={styles.stack}>
                  <View style={styles.locationPill}>
                    <Text style={styles.locationPin}>📍</Text>
                    <Text style={styles.locationText}>{mechanic.city} {mechanic.zone}</Text>
                  </View>
                  <View style={styles.profileCard}>
                    {mechanic.coverPhotoUrl ? (
                      <Image
                        source={{ uri: mechanic.coverPhotoUrl }}
                        style={styles.avatarCircle}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.avatarCircle}>
                        <Ionicons name="person" size={28} color={colors.textSecondary} />
                      </View>
                    )}
                    <View style={styles.profileBody}>
                      <Text style={styles.profileName}>{mechanic.fullName}</Text>
                      <Text style={styles.profileMeta}>{mechanic.specialties.join(', ')}</Text>
                      <View style={styles.starsRow}>
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Ionicons
                            key={star}
                            name={star <= Math.round(mechanic.rating) ? 'star' : 'star-outline'}
                            size={16}
                            color={colors.accent}
                          />
                        ))}
                        <Text style={styles.profileMeta}> {mechanic.reviewCount || 0} reseñas</Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.publicProfileBox}>
                    <Text style={styles.publicProfileTitle}>
                      Comentarios {selectedMechanicReviews.length > 0 ? `(${selectedMechanicReviews.length})` : ''}
                    </Text>
                    {selectedMechanicReviews.length === 0 ? (
                      <Text style={styles.smallText}>Aún no hay comentarios.</Text>
                    ) : (
                      <Pressable onPress={() => setMechanicReviewsExpanded((prev) => !prev)}>
                        {(mechanicReviewsExpanded
                          ? selectedMechanicReviews
                          : selectedMechanicReviews.slice(0, 1)
                        ).map((review) => (
                          <Text
                            key={review.id}
                            numberOfLines={mechanicReviewsExpanded ? undefined : 3}
                            style={styles.smallText}
                          >
                            {review.customerName}: {review.comment}
                          </Text>
                        ))}
                        {selectedMechanicReviews.length > 1 && (
                          <View style={styles.expandRow}>
                            <Text style={styles.expandLabel}>
                              {mechanicReviewsExpanded ? 'Ver menos' : 'Ver más'}
                            </Text>
                            <Ionicons
                              name={mechanicReviewsExpanded ? 'chevron-up' : 'chevron-down'}
                              size={14}
                              color={colors.primary}
                            />
                          </View>
                        )}
                      </Pressable>
                    )}
                  </View>
                </View>
              ))}
            </Card>
          )}

          {currentScreen === 'home' && user.role === 'mechanic' && (
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
                onPress={() => handleToggleMechanicConnection(mechanicConnection === 'online' ? 'offline' : 'online')}
              >
                <Text style={styles.connectionButtonText}>
                  {mechanicConnection === 'online' ? 'DESCONECTARME' : 'CONECTARME'}
                </Text>
              </Pressable>
            </Card>
          )}

          {currentScreen === 'account' && (
            <>
              <IdentityVerificationCard
                identityState={identityState}
                identityBusy={identityBusy}
                onStart={handleStartIdentityVerification}
              />

              <Card title="Notificaciones" subtitle="Últimos avisos de la plataforma">
                <View style={styles.stack}>
                  <SecondaryButton
                    title="Refrescar"
                    compact
                    onPress={async () => {
                      try {
                        await loadNotifications();
                      } catch (error) {
                        setMessage(formatError(error));
                      }
                    }}
                  />
                  {notifications.length === 0 && (
                    <Text style={styles.smallText}>Sin notificaciones por ahora.</Text>
                  )}
                  {notifications.map((notification) => (
                    <View key={notification.id} style={[styles.notificationItem, notification.readAt && styles.notificationItemRead]}>
                      <Text style={styles.itemTitle}>{notification.title}</Text>
                      <Text style={styles.itemText}>{notification.body}</Text>
                      <Text style={styles.smallText}>{notification.createdAt}</Text>
                      {!notification.readAt && (
                        <SecondaryButton title="Marcar leída" compact onPress={() => handleMarkNotificationRead(notification.id)} />
                      )}
                    </View>
                  ))}
                </View>
              </Card>

              <Card title={user.fullName} subtitle={user.role}>
                <SecondaryButton
                  title="Cerrar sesión"
                  onPress={async () => {
                    await clearSession();
                    setMessage('Sesión cerrada');
                  }}
                />
              </Card>
            </>
          )}

          {currentScreen === 'requests' && (
          <Card title="Solicitudes" subtitle="Elige la vista">
            <Segmented
              value={requestsView}
              options={[
                { key: 'list', label: 'Listado' },
                { key: 'create', label: 'Crear' },
                { key: 'detail', label: 'Detalle' },
              ]}
              onChange={(value) => setRequestsView(value as RequestsView)}
            />
          </Card>
          )}

          {currentScreen === 'requests' && requestsView === 'list' && (
          <Card title="Mis solicitudes" subtitle="Vista rápida de tu actividad reciente">
            <View style={styles.stack}>
              <SecondaryButton
                title="Actualizar lista"
                onPress={async () => {
                  try {
                    await loadMyRequests();
                    setMessage('Solicitudes actualizadas');
                  } catch (error) {
                    setMessage(formatError(error));
                  }
                }}
              />
              <View style={styles.list}>
                {myRequests.length === 0 ? (
                  <Text style={styles.itemText}>Todavía no hay solicitudes para mostrar.</Text>
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
                      {request.holdExpiresAt && request.status === 'pending' && (
                        <Text style={styles.smallText}>En hold hasta: {request.holdExpiresAt}</Text>
                      )}
                      <SecondaryButton
                        title="Ver detalle"
                        onPress={async () => {
                          try {
                            const fullRequest = await apiRequest<ServiceRequest>(`/service-requests/${request.id}`, { token });
                            setSelectedRequest(fullRequest);
                            setMessage(`Solicitud #${request.id} cargada`);
                          } catch (error) {
                            setMessage(formatError(error));
                          }
                        }}
                      />
                      {(user.role === 'mechanic' || user.role === 'admin') && (
                        <PrimaryButton
                          title="Gestionar esta solicitud"
                          onPress={() => openRequestActions(request)}
                        />
                      )}
                      {(user.role === 'customer' || user.role === 'admin') && request.status !== 'completed' && request.status !== 'cancelled' && (
                        <SecondaryButton title="Cancelar solicitud" busy={busy} onPress={() => handleCancelRequest(request.id)} />
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
          )}

          {currentScreen === 'requests' && requestsView === 'create' && (
          <Card title="Crear solicitud">
            <View style={styles.stack}>
              <Segmented
                value={requestCreateStep}
                options={[
                  { key: 'vehicle', label: 'Vehículo' },
                  { key: 'details', label: 'Detalle' },
                ]}
                onChange={(value) => setRequestCreateStep(value as RequestCreateStep)}
              />
              {requestCreateStep === 'vehicle' ? (
                <View style={styles.stack}>
                  {user.role === 'customer' && vehicles.length > 0 && (
                    <View style={styles.publicProfileBox}>
                      <Text style={styles.publicProfileTitle}>Mis vehículos</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        {vehicles.map((vehicle) => (
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
                    <SecondaryButton title="Guardar vehículo para después" onPress={saveCurrentVehicle} busy={busy} />
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
                    />
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
                    title={requestForm.preferredTime.trim() ? "Programar solicitud" : "Solicitar mecánico ahora"}
                    onPress={handleCreateRequest}
                    busy={busy}
                  />
                  <SecondaryButton title="Volver" onPress={() => setRequestCreateStep('vehicle')} />
                </View>
              )}
            </View>
          </Card>
        )}

          {currentScreen === 'mechanics' && currentUser && currentUser.role !== 'mechanic' && (
          <Card title="Buscar mecánicos">
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
                  await loadMechanics();
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
                  const coords = currentLocation || (await requestCurrentLocation());
                  await loadNearbyMechanics(coords.latitude, coords.longitude);
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
                                setMessage(`Turno #${slot.id} preparado para solicitud`);
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
                      setMessage(`Solicitud preparada para mecánico #${mechanic.id}`);
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
          )}

          {currentScreen === 'map' && currentUser && (
          <Card
            title={currentUser.role === 'mechanic' ? 'Solicitud entrante' : 'Mecánicos cercanos'}
            subtitle={currentUser.role === 'mechanic' ? 'Vista privada del mecánico' : 'Calculado por GPS'}
          >
          <View style={styles.stack}>
            {currentUser.role === 'mechanic' && mechanicConnection === 'online' && incomingRequest && (
              <View style={styles.item}>
                <Text style={styles.itemTitle}>Solicitud entrante #{incomingRequest.id}</Text>
                <Text style={styles.itemText}>
                  Cliente: {incomingRequest.customerName || 'N/D'} · {incomingRequest.customerPhone || 'N/D'}
                </Text>
                <Text numberOfLines={2} style={styles.smallText}>{incomingRequest.issueDescription}</Text>
                {incomingRequest.holdExpiresAt && (
                  <Text style={styles.smallText}>Hold hasta: {incomingRequest.holdExpiresAt}</Text>
                )}
                <View style={styles.row}>
                  <PrimaryButton title="Aceptar" onPress={() => handleIncomingResponse('accept')} />
                  <SecondaryButton title="Rechazar" busy={busy} onPress={() => handleIncomingResponse('reject')} />
                </View>
              </View>
            )}
            <Text style={styles.smallText}>
              {currentLocation ? 'La ubicación ya está lista.' : 'Pulsa el botón para obtener tu ubicación y ver cercanos.'}
            </Text>
            <Text style={styles.smallText}>
              Refresco automático cada 10 segundos.
            </Text>
            <View style={[styles.mapContainer, currentUser.role === 'mechanic' && incomingRequest ? styles.mapContainerCompact : null]}>
              {isMapConfigured ? (
              <MapView
                style={[styles.map, currentUser.role === 'mechanic' && incomingRequest ? styles.mapCompact : null]}
                initialRegion={getMapRegion()}
                region={getMapRegion()}
              >
                {currentLocation && (
                  <Marker
                    coordinate={currentLocation}
                    title="Tú"
                    description="Tu ubicación actual"
                    pinColor="#2563eb"
                  />
                )}
                {currentUser.role === 'mechanic' &&
                  incomingRequest?.latitude !== null &&
                  incomingRequest?.latitude !== undefined &&
                  incomingRequest.longitude !== null &&
                  incomingRequest.longitude !== undefined && (
                    <Marker
                      coordinate={{
                        latitude: incomingRequest.latitude,
                        longitude: incomingRequest.longitude,
                      }}
                      title={`Entrante #${incomingRequest.id}`}
                      description={incomingRequest.issueDescription}
                      pinColor="#f59e0b"
                    />
                  )}
                {selectedRequest?.latitude !== null &&
                  selectedRequest?.latitude !== undefined &&
                  selectedRequest.longitude !== null &&
                  selectedRequest.longitude !== undefined && (
                    <Marker
                      coordinate={{
                        latitude: selectedRequest.latitude,
                        longitude: selectedRequest.longitude,
                      }}
                      title={`Solicitud #${selectedRequest.id}`}
                      description={selectedRequest.issueDescription}
                      pinColor="#f97316"
                    />
                  )}
                {currentUser.role !== 'mechanic' &&
                  nearbyMechanics
                    .filter(
                      (mechanic) =>
                        mechanic.latitude !== null &&
                        mechanic.latitude !== undefined &&
                        mechanic.longitude !== null &&
                        mechanic.longitude !== undefined
                    )
                    .map((mechanic) => (
                      <Marker
                        key={`nearby-${mechanic.id}`}
                        coordinate={{
                          latitude: mechanic.latitude as number,
                          longitude: mechanic.longitude as number,
                        }}
                        title={mechanic.fullName}
                        description={`${mechanic.distanceKm?.toFixed(1) || '?'} km · ${mechanic.zone}`}
                      />
                    ))}
              </MapView>
              ) : (
                <View style={styles.mapUnavailable}>
                  <Text style={styles.itemText}>Mapa no configurado todavía.</Text>
                  <Text style={styles.smallText}>Puedes usar la ubicación y las solicitudes mientras se configura Google Maps.</Text>
                </View>
              )}
            </View>
            {currentUser.role !== 'mechanic' && (
              nearbyMechanics.length === 0 ? (
                <Text style={styles.itemText}>Aún no hay resultados cercanos.</Text>
              ) : (
                <Text style={styles.smallText}>Mostrando {nearbyMechanics.length} mecánicos cercanos en el mapa.</Text>
              )
            )}
          </View>
          </Card>
          )}

          {currentScreen === 'requests' && requestsView === 'detail' && (
          <Card title="Solicitud por ID">
          <View style={styles.stack}>
            <Field label="ID">
              <Input value={requestLookupId} keyboardType="numeric" onChangeText={setRequestLookupId} />
            </Field>
            <PrimaryButton title="Cargar solicitud" onPress={handleLoadRequest} />
          </View>

          {selectedRequest && (
            <View style={styles.stack}>
              <RequestCard request={selectedRequest} />
              {(user.role === 'customer' || user.role === 'admin') &&
                selectedRequest.status !== 'completed' &&
                selectedRequest.status !== 'cancelled' && (
                  <SecondaryButton
                    title="Cancelar solicitud"
                    busy={busy}
                    onPress={() => handleCancelRequest(selectedRequest.id)}
                  />
                )}
              {selectedRequest.status === 'completed' && user.role === 'customer' && selectedRequest.mechanicId && (
                <Card title="Reseña" subtitle="Califica el trabajo finalizado">
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
                    <PrimaryButton title="Enviar reseña" onPress={handleSubmitReview} />
                  </View>
                </Card>
              )}
              <Card title="Chat" subtitle="Habla con el cliente o mecánico asignado">
                <View style={styles.stack}>
                  {requestMessages.length === 0 ? (
                    <Text style={styles.itemText}>Todavía no hay mensajes.</Text>
                  ) : (
                    requestMessages.map((chatMessage) => (
                      <View
                        key={chatMessage.id}
                        style={[
                          styles.chatBubble,
                          chatMessage.senderRole === 'mechanic'
                            ? styles.chatBubbleMechanic
                            : chatMessage.senderRole === 'admin'
                              ? styles.chatBubbleAdmin
                              : styles.chatBubbleCustomer,
                        ]}
                      >
                        <Text style={styles.chatSender}>
                          {chatMessage.senderName} · {chatMessage.senderRole}
                        </Text>
                        <Text style={styles.itemText}>{chatMessage.message}</Text>
                        <Text style={styles.smallText}>{chatMessage.createdAt}</Text>
                      </View>
                    ))
                  )}
                  <Field label="Nuevo mensaje">
                    <Input
                      value={messageDraft}
                      multiline
                      placeholder="Escribe un mensaje"
                      onChangeText={setMessageDraft}
                    />
                  </Field>
                  <PrimaryButton title="Enviar mensaje" onPress={handleSendMessage} />
                </View>
              </Card>
            </View>
          )}
          </Card>
          )}

          {currentScreen === 'actions' && currentUser && (currentUser.role === 'admin' || currentUser.role === 'mechanic') && (
          <>
            {currentUser.role === 'mechanic' && (
              <IdentityVerificationCard
                identityState={identityState}
                identityBusy={identityBusy}
                onStart={handleStartIdentityVerification}
              />
            )}
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
                onChange={(value) => setActionsView(value as ActionsView)}
              />
              {currentUser.role === 'admin' && actionsView === 'assign' && (
                <View style={styles.stack}>
                  <Field label="Solicitud ID">
                    <Input value={assignForm.requestId} keyboardType="numeric" onChangeText={(value) => setAssignForm({ ...assignForm, requestId: value })} />
                  </Field>
                  <Field label="Mecánico ID opcional">
                    <Input value={assignForm.mechanicId} keyboardType="numeric" onChangeText={(value) => setAssignForm({ ...assignForm, mechanicId: value })} />
                  </Field>
                  <PrimaryButton title="Asignar mecánico" onPress={handleAssignRequest} />
                </View>
              )}
              {currentUser.role === 'admin' && actionsView === 'status' && (
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
                  <PrimaryButton title="Cambiar estado" onPress={handleChangeMechanicStatus} />
                </View>
              )}

              {actionsView === 'requestStatus' && (currentUser.role === 'admin' || currentUser.role === 'mechanic') && (
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
                  <PrimaryButton title="Actualizar estado" onPress={handleChangeServiceRequestStatus} />
                </View>
              )}

              {currentUser.role === 'mechanic' && actionsView === 'update' && (
                <View style={styles.stack}>
                  <Text style={styles.itemText}>Tu mechanicId: {selectedMechanicId || 'no disponible'}</Text>
                  <Field label="requestId para update">
                    <Input value={updateForm.requestId} keyboardType="numeric" onChangeText={(value) => setUpdateForm({ ...updateForm, requestId: value })} />
                  </Field>
                  <Field label="Mensaje de avance">
                    <Input value={updateForm.message} multiline onChangeText={(value) => setUpdateForm({ ...updateForm, message: value })} />
                  </Field>
                  <PrimaryButton title="Publicar update" onPress={handleAddUpdate} />
                  <SecondaryButton title="Estoy disponible" onPress={() => handleToggleAvailability(true)} />
                  <SecondaryButton title="No disponible" onPress={() => handleToggleAvailability(false)} />
                  <View style={styles.publicProfileBox}>
                    <Text style={styles.publicProfileTitle}>Perfil público</Text>
                    <Field label="Bio">
                      <Input
                        value={publicProfileForm.bio}
                        multiline
                        onChangeText={(value) => setPublicProfileForm({ ...publicProfileForm, bio: value })}
                      />
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
                        También es tu apartado mínimo por servicio — el cliente lo paga al solicitarte.
                      </Text>
                    </Field>
                    <Field label="Galería (URLs separadas por coma)">
                      <Input
                        value={publicProfileForm.galleryUrls}
                        multiline
                        onChangeText={(value) => setPublicProfileForm({ ...publicProfileForm, galleryUrls: value })}
                      />
                    </Field>
                    <PrimaryButton title="Guardar perfil" onPress={handleSavePublicProfile} />
                  </View>
                </View>
              )}

              {(currentUser.role === 'mechanic' || currentUser.role === 'admin') && actionsView === 'schedule' && (
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
                      onChangeText={(value) => setSlotForm({ ...slotForm, note: value })}
                    />
                  </Field>
                  <PrimaryButton title="Crear turno" onPress={handleCreateScheduleSlot} />
                </View>
              )}

              {currentUser.role === 'admin' && actionsView === 'availability' && (
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
                    onPress={() => handleToggleAvailability(availabilityForm.isAvailable === 'true')}
                  />
                </View>
              )}
            </View>
          </Card>
          </>
          )}

        </LinearGradient>
        </ScrollView>
      </View>
      <View style={styles.bottomNavDock}>
        <View style={styles.bottomNav}>
          <Pressable
            style={[styles.bottomNavButton, currentScreen === 'requests' && styles.bottomNavButtonActive]}
            onPress={() => {
              setCurrentScreen('requests');
              setRequestsView('list');
            }}
            accessibilityRole="button"
            accessibilityLabel="Solicitudes"
          >
            <Ionicons name="car-outline" size={22} color={colors.white} />
          </Pressable>
          {currentUser && currentUser.role !== 'mechanic' && (
            <Pressable
              style={[styles.bottomNavButton, currentScreen === 'mechanics' && styles.bottomNavButtonActive]}
              onPress={() => setCurrentScreen('mechanics')}
              accessibilityRole="button"
              accessibilityLabel="Mecánicos"
            >
              <Ionicons name="construct-outline" size={22} color={colors.white} />
            </Pressable>
          )}
          <Pressable
            style={[styles.bottomNavButton, currentScreen === 'home' && styles.bottomNavButtonActive]}
            onPress={() => setCurrentScreen('home')}
            accessibilityRole="button"
            accessibilityLabel="Inicio"
          >
            <Ionicons name="home-outline" size={22} color={colors.white} />
          </Pressable>
          <Pressable
            style={[styles.bottomNavButton, currentScreen === 'map' && styles.bottomNavButtonActive]}
            onPress={() => setCurrentScreen('map')}
            accessibilityRole="button"
            accessibilityLabel="Mapa"
          >
            <Ionicons name="map-outline" size={22} color={colors.white} />
          </Pressable>
          <Pressable
            style={[
              styles.bottomNavButton,
              (currentScreen === 'actions' || currentScreen === 'account') && styles.bottomNavButtonActive,
            ]}
            onPress={() => setCurrentScreen(currentUser?.role === 'customer' ? 'account' : 'actions')}
            accessibilityRole="button"
            accessibilityLabel={currentUser?.role === 'customer' ? 'Cuenta' : 'Acciones'}
          >
            <Ionicons
              name={currentUser?.role === 'customer' ? 'person-circle-outline' : 'ellipsis-horizontal'}
              size={22}
              color={colors.white}
            />
          </Pressable>
        </View>
      </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

function IdentityVerificationCard({
  identityState,
  identityBusy,
  onStart,
}: {
  identityState: IdentityVerificationState;
  identityBusy: boolean;
  onStart: () => void;
}) {
  return (
    <Card
      title="Verificación de identidad"
      subtitle={
        identityState.status === 'approved'
          ? 'Tu identidad ya está verificada.'
          : identityState.status === 'draft' || !identityState.status
            ? 'Verifica tu identidad para poder usar la plataforma con confianza.'
            : identityState.status === 'rejected'
              ? 'Tu verificación fue rechazada. Puedes volver a intentarlo.'
              : 'Tu verificación está en revisión.'
      }
    >
      {identityState.status !== 'approved' &&
        identityState.status !== 'submitted' &&
        identityState.status !== 'under_review' && (
          <>
            <Text style={styles.identityHint}>
              Usa la cámara en vivo para tus fotos — no subas imágenes desde tu galería, esa opción puede fallar.
            </Text>
            <Pressable style={styles.primaryButton} disabled={identityBusy} onPress={onStart}>
              {identityBusy ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {identityState.status === 'rejected' ? 'Volver a intentar' : 'Verificar identidad'}
                </Text>
              )}
            </Pressable>
          </>
        )}
    </Card>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {subtitle ? (
        <Text numberOfLines={3} ellipsizeMode="tail" style={styles.cardSubtitle}>
          {subtitle}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

function Field({
  label,
  children,
  style,
}: {
  label: string;
  children: ReactNode;
  style?: object;
}) {
  return (
    <View style={style}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function Input(props: ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor={colors.textSecondary} style={styles.input} {...props} />;
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ key: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            style={({ pressed }) => [styles.segment, active && styles.segmentActive, pressed && styles.buttonPressed]}
            onPress={() => onChange(option.key)}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function PrimaryButton({
  title,
  onPress,
  busy = false,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.primaryButton, busy && styles.primaryButtonBusy, pressed && styles.buttonPressed]}
      hitSlop={8}
      onPress={onPress}
      disabled={busy}
      accessibilityState={{ busy, disabled: busy }}
    >
      {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryButtonText}>{title}</Text>}
    </Pressable>
  );
}

function SecondaryButton({
  title,
  onPress,
  compact = false,
  busy = false,
}: {
  title: string;
  onPress: () => void;
  compact?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.secondaryButton,
        compact && styles.secondaryButtonCompact,
        busy && styles.primaryButtonBusy,
        pressed && styles.buttonPressed,
      ]}
      hitSlop={8}
      onPress={onPress}
      disabled={busy}
      accessibilityState={{ busy, disabled: busy }}
    >
      {busy ? <ActivityIndicator /> : <Text style={[styles.secondaryButtonText, compact && styles.secondaryButtonTextCompact]}>{title}</Text>}
    </Pressable>
  );
}

function RequestCard({ request }: { request: ServiceRequest }) {
  const latestUpdate = request.updates && request.updates.length > 0 ? request.updates[request.updates.length - 1] : null;
  return (
    <View style={styles.item}>
      <Text style={styles.itemTitle}>Solicitud #{request.id}</Text>
      <Text style={styles.itemText}>
        {request.vehicleMake} {request.vehicleModel} {request.vehicleYear}
      </Text>
      <Text style={styles.itemText}>Estado: {getServiceRequestStatusLabel(request.status)}</Text>
      <Text style={styles.itemText}>Mecánico: {request.mechanicName || 'sin asignar'}</Text>
      <Text style={styles.itemText}>Dirección: {request.serviceAddress || `${request.city}, ${request.zone}`}</Text>
      {request.scheduleSlotId && <Text style={styles.smallText}>Turno #{request.scheduleSlotId}</Text>}
      <Text numberOfLines={2} style={styles.smallText}>{request.issueDescription}</Text>
      {latestUpdate && (
        <Text numberOfLines={1} style={styles.smallText}>
          Último update: {latestUpdate.source} · {latestUpdate.message}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  safeAreaInner: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 10,
    gap: 14,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  shell: {
    borderRadius: 30,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.primaryLighter,
    backgroundColor: colors.white,
    width: '100%',
    shadowColor: colors.primaryDark,
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  kicker: {
    color: colors.primary,
    fontWeight: '700',
    textAlign: 'center',
    fontSize: 28,
  },
  logoWordmark: {
    alignSelf: 'center',
    width: 250,
    height: 48,
    marginBottom: 2,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.textDark,
    textAlign: 'center',
  },
  onboardingIconWrap: {
    alignSelf: 'center',
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.primaryLighter,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtitle: {
    color: colors.textSecondary,
    marginTop: 2,
    textAlign: 'center',
    fontSize: 13,
  },
  heroSubtitle: {
    color: colors.textSecondary,
    marginTop: 6,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '500',
    paddingHorizontal: 12,
  },
  heroButton: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 28,
    alignSelf: 'center',
    marginTop: 14,
  },
  heroButtonText: {
    color: colors.white,
    fontWeight: '700',
    fontSize: 16,
  },
  onboardingDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  onboardingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primaryLight,
  },
  onboardingDotActive: {
    backgroundColor: colors.primary,
    width: 22,
  },
  locationPill: {
    backgroundColor: colors.primaryLight,
    borderRadius: 999,
    paddingVertical: 11,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  locationPin: {
    fontSize: 18,
  },
  locationText: {
    color: colors.textDark,
    fontSize: 15,
    fontWeight: '500',
    flexShrink: 1,
  },
  profileCard: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    padding: 12,
    borderRadius: 18,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    shadowColor: colors.textDark,
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  avatarCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarIcon: {
    fontSize: 28,
  },
  profileBody: {
    flex: 1,
    gap: 2,
  },
  profileName: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textDark,
  },
  profileMeta: {
    color: colors.textDark,
    fontSize: 14,
  },
  starsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  expandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  expandLabel: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  connectionButton: {
    borderRadius: 18,
    minHeight: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectionOn: {
    backgroundColor: '#16a34a',
  },
  connectionOff: {
    backgroundColor: '#ef4444',
  },
  connectionButtonText: {
    color: colors.white,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  notificationSummary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  notificationBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.warningBg,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  sessionText: {
    flex: 1,
    color: colors.textDark,
    fontWeight: '700',
    fontSize: 14,
  },
  card: {
    borderRadius: 22,
    padding: 12,
    gap: 8,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    shadowColor: colors.textDark,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textDark,
  },
  cardSubtitle: {
    color: colors.textDark,
    fontSize: 13,
  },
  identityHint: {
    color: colors.primaryDark,
    fontSize: 12,
    marginBottom: 8,
  },
  stack: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  flex: {
    flex: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textDark,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.primaryLight,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.textDark,
    backgroundColor: colors.primaryLighter,
    minHeight: 44,
  },
  segmented: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  segment: {
    flexGrow: 1,
    flexBasis: '30%',
    minHeight: 46,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.primaryLight,
    backgroundColor: colors.primaryLighter,
  },
  segmentActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  segmentText: {
    color: colors.textDark,
    fontWeight: '700',
    textAlign: 'center',
    fontSize: 14,
  },
  segmentTextActive: {
    color: colors.white,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    shadowColor: colors.primaryDark,
    shadowOpacity: 0.2,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  primaryButtonBusy: {
    opacity: 0.7,
  },
  buttonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  primaryButtonText: {
    color: colors.white,
    fontWeight: '800',
  },
  secondaryButton: {
    backgroundColor: colors.primaryLighter,
    borderRadius: 999,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.textDark,
    fontWeight: '700',
  },
  secondaryButtonCompact: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 120,
  },
  secondaryButtonTextCompact: {
    fontSize: 14,
  },
  list: {
    gap: 12,
  },
  mapContainer: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.primaryLight,
  },
  mapContainerCompact: {
    borderRadius: 14,
  },
  map: {
    width: '100%',
    height: 170,
  },
  mapCompact: {
    height: 130,
  },
  mapUnavailable: {
    minHeight: 170,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: colors.primaryLighter,
  },
  item: {
    padding: 10,
    borderRadius: 16,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    gap: 6,
  },
  chatBubble: {
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    gap: 4,
  },
  chatBubbleCustomer: {
    backgroundColor: colors.primaryLighter,
    borderColor: colors.primaryLighter,
  },
  chatBubbleMechanic: {
    backgroundColor: '#d9f3e4',
    borderColor: '#92d6ad',
  },
  chatBubbleAdmin: {
    backgroundColor: colors.warningBg,
    borderColor: colors.accent,
  },
  chatSender: {
    color: colors.textDark,
    fontSize: 12,
    fontWeight: '800',
  },
  notificationItem: {
    padding: 10,
    borderRadius: 14,
    backgroundColor: colors.primaryLighter,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    gap: 6,
  },
  notificationItemRead: {
    opacity: 0.72,
  },
  itemTitle: {
    fontWeight: '800',
    fontSize: 15,
    color: colors.textDark,
  },
  itemText: {
    color: colors.textDark,
  },
  smallText: {
    color: colors.textSecondary,
    fontSize: 11,
  },
  publicProfileBox: {
    gap: 4,
    padding: 10,
    borderRadius: 14,
    backgroundColor: colors.primaryLighter,
    borderWidth: 1,
    borderColor: colors.primaryLighter,
  },
  publicProfileTitle: {
    color: colors.textDark,
    fontWeight: '800',
    fontSize: 13,
  },
  coverPhoto: {
    width: '100%',
    height: 150,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: colors.primaryLighter,
  },
  galleryRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  galleryPhoto: {
    width: 92,
    height: 92,
    borderRadius: 12,
    backgroundColor: colors.primaryLighter,
  },
  reviewCard: {
    padding: 10,
    borderRadius: 12,
    backgroundColor: colors.primaryLighter,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    gap: 4,
  },
  reviewTitle: {
    color: colors.textDark,
    fontSize: 12,
    fontWeight: '800',
  },
  calendarStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  calendarChip: {
    minWidth: 70,
    minHeight: 62,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: colors.primaryLighter,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  calendarChipText: {
    color: colors.textDark,
    fontSize: 10,
    fontWeight: '700',
  },
  calendarChipTextActive: {
    color: colors.white,
  },
  slotRow: {
    gap: 6,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: colors.primaryLight,
  },
  slotCard: {
    padding: 10,
    borderRadius: 14,
    backgroundColor: colors.primaryLighter,
    borderWidth: 1,
    borderColor: colors.primaryLighter,
    gap: 4,
  },
  slotCardActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  statusPill: {
    backgroundColor: colors.primaryLight,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statusPillText: {
    color: colors.textDark,
    fontSize: 12,
    fontWeight: '600',
  },
  badge: {
    color: colors.textDark,
    fontSize: 12,
    fontWeight: '700',
  },
  bottomNavDock: {
    paddingHorizontal: 14,
    paddingBottom: Platform.OS === 'android' ? 6 : 0,
    backgroundColor: 'transparent',
  },
  bottomNav: {
    backgroundColor: colors.primaryLight,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bottomNavItem: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  bottomNavButton: {
    borderRadius: 999,
    minWidth: 54,
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  bottomNavButtonActive: {
    backgroundColor: colors.primary,
  },
});