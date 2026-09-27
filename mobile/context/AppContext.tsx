import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';

type Role = 'customer' | 'mechanic' | 'admin';
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
type RequestCreateStep = 'vehicle' | 'details';
type MechanicSignupStep = 'account' | 'work';

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
  serviceFee?: { amount: number; status: 'pending' | 'authorized' | 'captured' | 'released' | 'failed' } | null;
  updates?: { id: number; source: string; message: string; createdAt: string }[];
};

type RequestMessage = {
  id: number;
  senderUserId: number;
  senderRole: Role;
  senderName: string;
  message: string;
  createdAt: string;
};

type AppNotification = {
  id: number;
  title: string;
  body: string;
  dataJson?: string | null;
  readAt: string | null;
  createdAt: string;
};

type IdentityVerificationStatus = 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected';

type IdentityVerificationState = {
  status: IdentityVerificationStatus | null;
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

type AuthUser = {
  id: number;
  role: Role;
  login: string;
  fullName: string;
  customerId: number | null;
  mechanicId: number | null;
};

type AppContextValue = {
  // Grupo A: sesión
  token: string;
  setToken: Dispatch<SetStateAction<string>>;
  user: AuthUser | null;
  setUser: Dispatch<SetStateAction<AuthUser | null>>;
  loadingSession: boolean;
  setLoadingSession: Dispatch<SetStateAction<boolean>>;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  message: string;
  setMessage: Dispatch<SetStateAction<string>>;

  // Grupo B: navegación
  currentScreen: AppScreen;
  setCurrentScreen: Dispatch<SetStateAction<AppScreen>>;
  requestsView: RequestsView;
  setRequestsView: Dispatch<SetStateAction<RequestsView>>;
  actionsView: ActionsView;
  setActionsView: Dispatch<SetStateAction<ActionsView>>;
  requestCreateStep: RequestCreateStep;
  setRequestCreateStep: Dispatch<SetStateAction<RequestCreateStep>>;
  mechanicSignupStep: MechanicSignupStep;
  setMechanicSignupStep: Dispatch<SetStateAction<MechanicSignupStep>>;

  // Grupo C1: datos principales (listas)
  mechanics: Mechanic[];
  setMechanics: Dispatch<SetStateAction<Mechanic[]>>;
  myRequests: RequestSummary[];
  setMyRequests: Dispatch<SetStateAction<RequestSummary[]>>;
  nearbyMechanics: Mechanic[];
  setNearbyMechanics: Dispatch<SetStateAction<Mechanic[]>>;
  vehicles: VehicleProfile[];
  setVehicles: Dispatch<SetStateAction<VehicleProfile[]>>;

  // Grupo C2: solicitud activa y chat
  selectedRequest: ServiceRequest | null;
  setSelectedRequest: Dispatch<SetStateAction<ServiceRequest | null>>;
  incomingRequest: ServiceRequest | null;
  setIncomingRequest: Dispatch<SetStateAction<ServiceRequest | null>>;
  requestMessages: RequestMessage[];
  setRequestMessages: Dispatch<SetStateAction<RequestMessage[]>>;
  messageDraft: string;
  setMessageDraft: Dispatch<SetStateAction<string>>;

  // Grupo C3: ubicación, conexión, notificaciones e identidad
  currentLocation: { latitude: number; longitude: number } | null;
  setCurrentLocation: Dispatch<SetStateAction<{ latitude: number; longitude: number } | null>>;
  mechanicConnection: 'online' | 'offline';
  setMechanicConnection: Dispatch<SetStateAction<'online' | 'offline'>>;
  notifications: AppNotification[];
  setNotifications: Dispatch<SetStateAction<AppNotification[]>>;
  unreadNotifications: number;
  setUnreadNotifications: Dispatch<SetStateAction<number>>;
  identityState: IdentityVerificationState;
  setIdentityState: Dispatch<SetStateAction<IdentityVerificationState>>;
  identityBusy: boolean;
  setIdentityBusy: Dispatch<SetStateAction<boolean>>;
};

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  // Grupo A
  const [token, setToken] = useState('');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Listo');

  // Grupo B
  const [currentScreen, setCurrentScreen] = useState<AppScreen>('home');
  const [requestsView, setRequestsView] = useState<RequestsView>('list');
  const [actionsView, setActionsView] = useState<ActionsView>('assign');
  const [requestCreateStep, setRequestCreateStep] = useState<RequestCreateStep>('vehicle');
  const [mechanicSignupStep, setMechanicSignupStep] = useState<MechanicSignupStep>('account');

  // Grupo C1
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [myRequests, setMyRequests] = useState<RequestSummary[]>([]);
  const [nearbyMechanics, setNearbyMechanics] = useState<Mechanic[]>([]);
  const [vehicles, setVehicles] = useState<VehicleProfile[]>([]);

  // Grupo C2
  const [selectedRequest, setSelectedRequest] = useState<ServiceRequest | null>(null);
  const [incomingRequest, setIncomingRequest] = useState<ServiceRequest | null>(null);
  const [requestMessages, setRequestMessages] = useState<RequestMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState('');

  // Grupo C3
  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [mechanicConnection, setMechanicConnection] = useState<'online' | 'offline'>('offline');
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [identityState, setIdentityState] = useState<IdentityVerificationState>({ status: null });
  const [identityBusy, setIdentityBusy] = useState(false);

  const value: AppContextValue = {
    token,
    setToken,
    user,
    setUser,
    loadingSession,
    setLoadingSession,
    busy,
    setBusy,
    message,
    setMessage,
    currentScreen,
    setCurrentScreen,
    requestsView,
    setRequestsView,
    actionsView,
    setActionsView,
    requestCreateStep,
    setRequestCreateStep,
    mechanicSignupStep,
    setMechanicSignupStep,
    mechanics,
    setMechanics,
    myRequests,
    setMyRequests,
    nearbyMechanics,
    setNearbyMechanics,
    vehicles,
    setVehicles,
    selectedRequest,
    setSelectedRequest,
    incomingRequest,
    setIncomingRequest,
    requestMessages,
    setRequestMessages,
    messageDraft,
    setMessageDraft,
    currentLocation,
    setCurrentLocation,
    mechanicConnection,
    setMechanicConnection,
    notifications,
    setNotifications,
    unreadNotifications,
    setUnreadNotifications,
    identityState,
    setIdentityState,
    identityBusy,
    setIdentityBusy,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext debe usarse dentro de <AppProvider>');
  }
  return context;
}