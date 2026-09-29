import { Linking, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

// Mismo aviso que publica el sitio web (web/privacidad.html): un solo texto
// que mantener, y es el enlace que va en la ficha de Google Play.
// Contraseña: al menos 8 caracteres, con letras y números (el servidor
// revisa lo mismo).
export const PASSWORD_RULE_TEXT = 'Mínimo 8 caracteres, con letras y números';

export function isValidPassword(password: string): boolean {
  return password.length >= 8 && password.length <= 72 && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(password) && /\d/.test(password);
}

export const PRIVACY_NOTICE_URL = 'https://mecanifique.vercel.app/privacidad';
export const TERMS_URL = 'https://mecanifique.vercel.app/terminos';

// Abre una página del sitio en un navegador dentro de la app (al cerrarlo, se
// vuelve a donde estaba).
async function openSitePage(url: string) {
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    await Linking.openURL(url).catch(() => undefined);
  }
}

export function openPrivacyNotice() {
  return openSitePage(PRIVACY_NOTICE_URL);
}

export function openTerms() {
  return openSitePage(TERMS_URL);
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
// La cuota de servicio queda apartada en la tarjeta y Stripe suelta un
// apartado a los 7 días: por eso un turno solo se puede apartar dentro de los
// próximos 7 días (hoy incluido). El servidor revisa lo mismo.
export const BOOKING_WINDOW_DAYS = 7;

export function isWithinBookingWindow(slotDate: string): boolean {
  const today = new Date();
  const last = new Date(today.getFullYear(), today.getMonth(), today.getDate() + BOOKING_WINDOW_DAYS - 1);
  const lastKey = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  return slotDate <= lastKey;
}

/** CLABE en grupos (banco, plaza, cuenta, control) para leerla y dictarla fácil. */
export function formatClabe(clabe: string): string {
  const digits = clabe.replace(/\D/g, '');
  if (digits.length !== 18) return clabe;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 17)} ${digits.slice(17)}`;
}

export function formatDateOnly(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const year = date.getFullYear() === new Date().getFullYear() ? '' : ` ${date.getFullYear()}`;
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}${year}`;
}

/** Pesos sin centavos y con comas: $2,200. */
export function formatPesos(amount: number): string {
  return `$${String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/** Texto del estado de la cuota de servicio de una solicitud (null si no hay nada que mostrar). */
export function serviceFeeStatusText(fee: { amount: number; status: string } | null | undefined): string | null {
  if (!fee) return null;
  switch (fee.status) {
    case 'authorized':
      return `Cuota de $${fee.amount} apartada: se cobra cuando llegue el mecánico.`;
    case 'captured':
      return `Cuota de servicio cobrada: $${fee.amount}.`;
    case 'released':
      return 'Cuota liberada: no se te cobró.';
    case 'failed':
      return 'No se realizó el cobro de la cuota.';
    default:
      return null;
  }
}

/**
 * Revisa el formulario de solicitud con las mismas reglas del servidor, antes
 * de pedir el pago: nadie debe pagar para luego enterarse de que faltaba un dato.
 */
export function validateRequestForm(form: {
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: string;
  issueDescription: string;
  preferredTime: string;
  city: string;
  zone: string;
  serviceAddress: string;
}): string | null {
  const year = Number(form.vehicleYear);
  if (form.vehicleMake.trim().length < 2 || form.vehicleModel.trim().length < 1) {
    return 'Escribe la marca y el modelo de tu auto.';
  }
  if (!Number.isInteger(year) || year < 1970 || year > new Date().getFullYear() + 1) {
    return 'Revisa el año de tu auto.';
  }
  if (form.issueDescription.trim().length < 10) {
    return 'Describe la falla con un poco más de detalle (mínimo 10 letras).';
  }
  if (form.preferredTime.trim() && form.preferredTime.trim().length < 3) {
    return 'Escribe mejor para cuándo lo necesitas, o déjalo vacío.';
  }
  if (form.city.trim().length < 2 || form.zone.trim().length < 2) {
    return 'Escribe tu ciudad y tu zona.';
  }
  if (form.serviceAddress.trim() && form.serviceAddress.trim().length < 5) {
    return 'La dirección es muy corta: escríbela completa o déjala vacía.';
  }
  return null;
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

  await openFirstNavigationApp([wazeUrl, googleMapsAppUrl], googleMapsWebUrl);
}

async function openFirstNavigationApp(appUrls: Array<string | undefined>, webUrl: string) {
  for (const url of appUrls) {
    if (!url) continue;
    try {
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
        return;
      }
    } catch {
      // Intenta la siguiente opción.
    }
  }
  await Linking.openURL(webUrl);
}

/**
 * Ruta al lugar del servicio: por coordenadas si el cliente compartió su
 * ubicación; si no, por la dirección escrita (antes, sin coordenadas no había
 * botón para llegar).
 */
export async function openServiceNavigation(place: {
  latitude?: number | null;
  longitude?: number | null;
  serviceAddress?: string | null;
  city: string;
  zone: string;
}) {
  const typed = place.serviceAddress?.trim() || `${place.zone}, ${place.city}`;
  // Sin la ciudad, Maps puede encontrar la misma calle en otra ciudad.
  const address = typed.toLowerCase().includes(place.city.trim().toLowerCase()) ? typed : `${typed}, ${place.city}`;
  if (place.latitude != null && place.longitude != null) {
    await openExternalNavigation(place.latitude, place.longitude, address);
    return;
  }
  const query = encodeURIComponent(address);
  await openFirstNavigationApp(
    [
      `waze://ul?q=${query}&navigate=yes`,
      Platform.select({ ios: `comgooglemaps://?daddr=${query}&directionsmode=driving`, android: `google.navigation:q=${query}` }),
    ],
    `https://www.google.com/maps/dir/?api=1&destination=${query}`,
  );
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
