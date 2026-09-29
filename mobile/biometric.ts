import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Entrar con huella (o rostro). Al cerrar sesión, la sesión (su refresh
 * token) se guarda sellada con la huella en vez de borrarse; "Entrar con
 * huella" la abre y la renueva en el servidor. No se guarda la contraseña y
 * funciona también con las cuentas de Facebook.
 *
 * - El sello es del sistema (Keystore de Android con autenticación
 *   obligatoria): si alguien agrega otra huella al teléfono, deja de abrir y
 *   se entra con la contraseña.
 * - Se usa una vez: al renovarse, esa sesión cambia; al volver a cerrar
 *   sesión se sella la nueva.
 * - Entrar normal (correo o Facebook) borra la que estuviera sellada.
 */

const SESSION_KEY = 'mecanifique.biometric.session';
const HINT_KEY = 'mecanifique.biometric.hint';
const PREF_KEY = 'mecanifique.biometric.pref';
// Llavero propio en iOS: los datos con huella no se mezclan con los demás.
const STORE_OPTIONS = { keychainService: 'mecanifique.biometric' };

export type BiometricPref = 'on' | 'off';
/** Lo que muestra la pantalla de entrada sin pedir la huella ("Entrar como Sergio"). */
export type BiometricHint = { name: string };

/** La huella no abre la sesión guardada (cambió la huella del teléfono, se desactivó, etc.). */
export class BiometricUnavailableError extends Error {}

export function biometricAvailable(): boolean {
  try {
    return SecureStore.canUseBiometricAuthentication();
  } catch {
    return false;
  }
}

export async function getBiometricPref(): Promise<BiometricPref | null> {
  const value = await AsyncStorage.getItem(PREF_KEY).catch(() => null);
  return value === 'on' || value === 'off' ? value : null;
}

export async function setBiometricPref(pref: BiometricPref): Promise<void> {
  await AsyncStorage.setItem(PREF_KEY, pref).catch(() => undefined);
  if (pref === 'off') await forgetSealedSession();
}

export async function getBiometricHint(): Promise<BiometricHint | null> {
  try {
    const raw = await AsyncStorage.getItem(HINT_KEY);
    return raw ? (JSON.parse(raw) as BiometricHint) : null;
  } catch {
    return null;
  }
}

/** Sella la sesión con la huella (el teléfono la pide). false si se canceló o no se pudo. */
export async function sealSession(refreshToken: string, hint: BiometricHint): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(SESSION_KEY, refreshToken, {
      ...STORE_OPTIONS,
      requireAuthentication: true,
      authenticationPrompt: 'Confirma para entrar con tu huella la próxima vez',
    });
    await AsyncStorage.setItem(HINT_KEY, JSON.stringify(hint));
    return true;
  } catch {
    return false;
  }
}

/**
 * Pide la huella y devuelve la sesión guardada; null si la persona canceló.
 * Lanza BiometricUnavailableError si ya no se puede abrir.
 */
export async function openSealedSession(): Promise<string | null> {
  try {
    const value = await SecureStore.getItemAsync(SESSION_KEY, {
      ...STORE_OPTIONS,
      requireAuthentication: true,
      authenticationPrompt: 'Entra a Mecanifique',
    });
    if (!value) throw new BiometricUnavailableError('Sin sesión guardada');
    return value;
  } catch (error) {
    if (error instanceof BiometricUnavailableError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/cancel/i.test(message)) return null;
    throw new BiometricUnavailableError(message);
  }
}

export async function forgetSealedSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(SESSION_KEY, STORE_OPTIONS).catch(() => undefined),
    AsyncStorage.removeItem(HINT_KEY).catch(() => undefined),
  ]);
}
