import { Linking, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

// Mismo aviso que publica el sitio web (web/privacidad.html): un solo texto
// que mantener, y es el enlace que va en la ficha de Google Play.
export const PRIVACY_NOTICE_URL = 'https://mecanifique.vercel.app/privacidad';

/** Abre el aviso de privacidad en un navegador dentro de la app (al cerrarlo, se vuelve a donde estaba). */
export async function openPrivacyNotice() {
  try {
    await WebBrowser.openBrowserAsync(PRIVACY_NOTICE_URL);
  } catch {
    await Linking.openURL(PRIVACY_NOTICE_URL).catch(() => undefined);
  }
}

type Mechanic = {
  isOnline?: boolean;
  isAvailable: boolean;
};

/**
 * El servidor guarda timestamps de SQLite en UTC sin zona ("2026-09-25
 * 18:22:10"). new Date() los interpretaría como hora local, así que se
 * marcan como UTC explícitamente. Devuelve null si no se puede leer.
 */
export function parseServerTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const milliseconds = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isNaN(milliseconds) ? null : milliseconds;
}

const SHORT_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Fecha del servidor en lenguaje de persona: "Hoy, 09:52", "Ayer, 18:05" o
 * "26 sep, 09:52", en la hora local del teléfono.
 */
export function formatServerDate(value: string | null | undefined): string {
  const milliseconds = parseServerTimestamp(value);
  if (milliseconds === null) {
    return value || '';
  }
  const date = new Date(milliseconds);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(date, today)) return `Hoy, ${time}`;
  if (sameDay(date, yesterday)) return `Ayer, ${time}`;
  const year = date.getFullYear() === today.getFullYear() ? '' : ` ${date.getFullYear()}`;
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}${year}, ${time}`;
}

/** Fecha sin hora ("2026-09-30") como "30 sep" (con año si no es el actual). */
export function formatDateOnly(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const year = date.getFullYear() === new Date().getFullYear() ? '' : ` ${date.getFullYear()}`;
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}${year}`;
}

/** Distancia en línea recta (km) entre dos coordenadas. */
export function distanceKm(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const deltaLat = toRad(to.latitude - from.latitude);
  const deltaLon = toRad(to.longitude - from.longitude);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRad(from.latitude)) * Math.cos(toRad(to.latitude)) * Math.sin(deltaLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Abre la navegación en una app externa (Waze, si está instalada, si no
 * Google Maps) en vez de construir un sistema de mapas/rutas propio.
 */
export async function openExternalNavigation(latitude: number, longitude: number, label?: string) {
  const wazeUrl = `waze://ul?ll=${latitude},${longitude}&navigate=yes`;
  const googleMapsAppUrl = Platform.select({
    ios: `comgooglemaps://?daddr=${latitude},${longitude}&directionsmode=driving`,
    android: `google.navigation:q=${latitude},${longitude}`,
  });
  const googleMapsWebUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}${
    label ? `&destination_place_id=&query=${encodeURIComponent(label)}` : ''
  }`;

  const candidates = [wazeUrl, googleMapsAppUrl, googleMapsWebUrl].filter(Boolean) as string[];

  for (const url of candidates) {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
        return;
      }
    } catch {
      // Intenta la siguiente opción.
    }
  }

  await Linking.openURL(googleMapsWebUrl);
}

export function normalizeSpecialties(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Ocurrió un error inesperado';
}

export function normalizeServerTextError(payloadText: string): string {
  const preMatch = payloadText.match(/<pre>([\s\S]*?)<\/pre>/i);
  const rawMessage = preMatch ? preMatch[1] : payloadText;
  const cleanMessage = rawMessage.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  if (cleanMessage.includes('Cannot PATCH /api/mechanics/') && cleanMessage.includes('/online')) {
    return 'No se pudo conectar. Verifica que el backend esté corriendo.';
  }

  return cleanMessage || 'Error inesperado';
}

export function getMechanicPublicStatus(mechanic: Mechanic): string {
  if (!mechanic.isOnline) {
    return 'Fuera de línea';
  }

  if (mechanic.isAvailable) {
    return 'Disponible para solicitudes';
  }

  return 'Conectado pero ocupado';
}

export function getServiceRequestStatusLabel(status: string): string {
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

export function formatCalendarDate(date: string): { weekday: string; day: string; month: string } {
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
