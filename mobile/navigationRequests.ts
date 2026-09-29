/**
 * Abrir una pestaña interna de otra pantalla (p. ej. "Mi agenda" en Acciones)
 * desde fuera, sin navegación real: quien navega deja pedida la pestaña y la
 * pantalla la toma al montarse (cada cambio de pantalla la vuelve a montar).
 */

export type MechanicTab = 'profile' | 'schedule' | 'promotions' | 'commissions';
export type AccountSection = 'personal' | 'security' | 'favorites';

let mechanicTab: MechanicTab | null = null;
let accountSection: AccountSection | null = null;

export function requestMechanicTab(tab: MechanicTab) {
  mechanicTab = tab;
}

export function takeMechanicTab(): MechanicTab | null {
  const tab = mechanicTab;
  mechanicTab = null;
  return tab;
}

export function requestAccountSection(section: AccountSection) {
  accountSection = section;
}

export function takeAccountSection(): AccountSection | null {
  const section = accountSection;
  accountSection = null;
  return section;
}
