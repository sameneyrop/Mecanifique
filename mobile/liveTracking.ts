import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

// Seguimiento del mecánico en segundo plano: mientras va en camino o fue por
// refacciones, el teléfono sigue mandando su ubicación aunque esté usando
// Waze o Google Maps. Android exige un aviso fijo visible mientras dura, y
// solo se puede iniciar con la app en pantalla (al tocar el botón del paso).
// Con eso basta el permiso de ubicación normal: no se pide "permitir
// siempre".

export const LIVE_TRACKING_TASK = 'mecanifique-seguimiento';

export type TrackingReason = 'en_route' | 'awaiting_parts';

type LocationSender = (coords: { latitude: number; longitude: number }) => Promise<{ tracking?: boolean }>;

// La app registra aquí cómo mandar la ubicación (con su sesión y la
// renovación del token). Si el sistema reinició la tarea sin la app abierta
// no hay sesión a mano: el seguimiento se apaga y se reanuda al abrirla.
let sendLocation: LocationSender | null = null;
// Motivo con el que está corriendo, para no reiniciarlo si ya va igual.
let activeReason: TrackingReason | null = null;

export function setLiveTrackingSender(sender: LocationSender | null) {
  sendLocation = sender;
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LIVE_TRACKING_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) {
    return;
  }
  if (!sendLocation) {
    await stopLiveTracking();
    return;
  }
  const latest = data.locations[data.locations.length - 1];
  try {
    const result = await sendLocation({ latitude: latest.coords.latitude, longitude: latest.coords.longitude });
    // El servidor avisa cuando ya nadie lo sigue (llegó, el cliente canceló).
    if (result.tracking === false) {
      await stopLiveTracking();
    }
  } catch (sendError) {
    console.warn('No se pudo mandar la ubicación del seguimiento:', sendError);
  }
});

const NOTIFICATION_BODY: Record<TrackingReason, string> = {
  en_route: 'Tu cliente ve que vas en camino. Se apaga al marcar «Ya llegué».',
  awaiting_parts: 'Tu cliente ve que fuiste por refacciones. Se apaga al retomar la reparación.',
};

export async function startLiveTracking(reason: TrackingReason) {
  if (activeReason === reason && (await Location.hasStartedLocationUpdatesAsync(LIVE_TRACKING_TASK))) {
    return;
  }
  const permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted) {
    const requested = await Location.requestForegroundPermissionsAsync();
    if (!requested.granted) {
      throw new Error('Sin permiso de ubicación');
    }
  }
  await Location.startLocationUpdatesAsync(LIVE_TRACKING_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 15_000,
    distanceInterval: 30,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'Compartiendo tu ubicación',
      notificationBody: NOTIFICATION_BODY[reason],
      // Mismo azul que los avisos push (app.json).
      notificationColor: '#0072B2',
    },
  });
  activeReason = reason;
}

export async function stopLiveTracking() {
  activeReason = null;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LIVE_TRACKING_TASK)) {
      await Location.stopLocationUpdatesAsync(LIVE_TRACKING_TASK);
    }
  } catch {
    // En Expo Go la tarea puede no existir: no hay nada que apagar.
  }
}
