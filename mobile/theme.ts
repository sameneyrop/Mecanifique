import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { getActiveScheme, setActiveScheme, type ColorScheme } from './colors';

/**
 * Tema claro u oscuro, elegido por la persona (botón junto a la campana,
 * Cuenta o Acciones) y recordado en el teléfono. App se vuelve a pintar entera
 * al cambiarlo (ver useColorScheme en App.tsx).
 */

const THEME_KEY = 'mecanifique.theme';
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

/** Al abrir la app, mientras se ve la pantalla de carga. */
export async function loadColorScheme(): Promise<void> {
  const stored = await AsyncStorage.getItem(THEME_KEY).catch(() => null);
  if (stored === 'dark' || stored === 'light') {
    setActiveScheme(stored);
    notify();
  }
}

export function applyColorScheme(scheme: ColorScheme) {
  if (scheme === getActiveScheme()) return;
  setActiveScheme(scheme);
  AsyncStorage.setItem(THEME_KEY, scheme).catch(() => undefined);
  notify();
}

export function toggleColorScheme() {
  applyColorScheme(getActiveScheme() === 'dark' ? 'light' : 'dark');
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribe, getActiveScheme);
}
