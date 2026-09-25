type Mechanic = {
  isOnline?: boolean;
  isAvailable: boolean;
};

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
