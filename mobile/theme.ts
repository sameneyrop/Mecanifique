import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { getActiveScheme, setActiveScheme, type ColorScheme } from './colors';

/**
 * Tema de la app: "Automático" (igual que el teléfono, lo de fábrica), claro u
 * oscuro. Se elige en Cuenta o Acciones, o con el botón junto a la campana
 * (que fija claro u oscuro), y se recuerda en el teléfono. App se vuelve a
 * pintar entera al cambiar (ver useColorScheme en App.tsx).
 *
 * "Automático" necesita `userInterfaceStyle: automatic` en app.json (desde el
 * APK 1.0.2); con un APK anterior el teléfono siempre dice "claro".
 */

export type ThemePreference = 'system' | ColorScheme;

const THEME_KEY = 'mecanifique.theme';
const listeners = new Set<() => void>();
let preference: ThemePreference = 'system';

function notify() {
  listeners.forEach((listener) => listener());
}

function systemScheme(): ColorScheme {
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}

/** Aplica la preferencia a la paleta activa y avisa si cambió. */
function sync() {
  const next = preference === 'system' ? systemScheme() : preference;
  if (next !== getActiveScheme()) {
    setActiveScheme(next);
  }
  notify();
}

// Si el teléfono cambia de modo con la app abierta y está en "Automático".
Appearance.addChangeListener(() => {
  if (preference === 'system') sync();
});

/** Al abrir la app, mientras se ve la pantalla de carga. */
export async function loadColorScheme(): Promise<void> {
  const stored = await AsyncStorage.getItem(THEME_KEY).catch(() => null);
  preference = stored === 'dark' || stored === 'light' ? stored : 'system';
  sync();
}

export function applyThemePreference(next: ThemePreference) {
  preference = next;
  AsyncStorage.setItem(THEME_KEY, next).catch(() => undefined);
  sync();
}

/** El botón junto a la campana: fija el contrario del que se ve ahora. */
export function toggleColorScheme() {
  applyThemePreference(getActiveScheme() === 'dark' ? 'light' : 'dark');
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

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, () => preference);
}
