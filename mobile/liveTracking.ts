import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

// Servicio en segundo plano del mecánico, con un aviso fijo visible (Android
// lo exige). Tres motivos:
// - online: está conectado. Si cambia de app sigue recibiendo solicitudes, y
//   cada minuto su teléfono le dice al servidor que sigue ahí.
// - en_route / awaiting_parts: va con el cliente o fue por refacciones; manda
//   su ubicación seguido para que el cliente lo siga en el radar, aunque use
//   Waze o Google Maps.
// Solo se inicia con la app en pantalla (al conectarse o tocar el paso), así
// que basta el permiso de ubicación normal: no se pide "permitir siempre".
// Si cierra la app por completo, el servicio se apaga; el servidor deja de
// recibir señal y lo desconecta con un aviso (sweepStaleMechanics).

export const LIVE_TRACKING_TASK = 'mecanifique-seguimiento';

export type TrackingReason = 'online' | 'en_route' | 'awaiting_parts';

type LocationSender = (coords: { latitude: number; longitude: number }) => Promise<{ tracking?: boolean; online?: boolean }>;

// La app registra aquí cómo mandar la ubicación (con su sesión y la
// renovación del token). Si el sistema reinició la tarea sin la app abierta
// no hay sesión a mano: el servicio se apaga y se reanuda al abrirla.
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
    // El servidor avisa cuando ya no hace falta: nadie lo sigue y ya no está
    // conectado (se desconectó, o el cliente canceló estando desconectado).
    if (result.tracking === false && result.online === false) {
      await stopLiveTracking();
    }
  } catch (sendError) {
    console.warn('No se pudo mandar la ubicación del seguimiento:', sendError);
  }
});

const NOTIFICATION: Record<TrackingReason, { title: string; body: string }> = {
  online: {
    title: 'Estás conectado',
    body: 'Te avisamos cuando llegue una solicitud cerca de ti. Para dejar de recibirlas, toca «Desconectarme» en la app.',
  },
  en_route: {
    title: 'Compartiendo tu ubicación',
    body: 'Tu cliente ve que vas en camino. Se apaga al marcar «Ya llegué».',
  },
  awaiting_parts: {
    title: 'Compartiendo tu ubicación',
    body: 'Tu cliente ve que fuiste por refacciones. Se apaga al retomar la reparación.',
  },
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
  // Conectado y esperando: una señal por minuto aunque no se mueva (ahorra
  // batería). En camino o por refacciones: seguido y preciso.
  const waiting = reason === 'online';
  await Location.startLocationUpdatesAsync(LIVE_TRACKING_TASK, {
    accuracy: waiting ? Location.Accuracy.Balanced : Location.Accuracy.High,
    timeInterval: waiting ? 60_000 : 15_000,
    distanceInterval: waiting ? 0 : 30,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: NOTIFICATION[reason].title,
      notificationBody: NOTIFICATION[reason].body,
      // Mismo azul que los avisos push (app.json).
      notificationColor: '#0072B2',
      // Cerrar la app por completo apaga el servicio (y lo desconecta).
      killServiceOnDestroy: true,
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
