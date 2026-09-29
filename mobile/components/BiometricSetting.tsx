import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { SecondaryButton } from './ui';
import { biometricAvailable, getBiometricPref, setBiometricPref, type BiometricPref } from '../biometric';

/**
 * Cuenta → Seguridad (cliente) y Acciones → Sesión (mecánico): activar o no
 * "Entrar con huella". Solo aparece si el teléfono tiene huella o rostro.
 * Activada, al cerrar sesión la sesión queda sellada con la huella.
 */
export function BiometricSetting() {
  const { setMessage } = useAppContext();
  const [pref, setPref] = useState<BiometricPref | null>(null);
  const available = biometricAvailable();

  useEffect(() => {
    void getBiometricPref().then(setPref);
  }, []);

  if (!available) {
    return null;
  }

  const on = pref === 'on';

  async function toggle() {
    const next: BiometricPref = on ? 'off' : 'on';
    await setBiometricPref(next);
    setPref(next);
    setMessage(
      next === 'on'
        ? 'Listo: cuando cierres sesión podrás volver a entrar con tu huella.'
        : 'Ya no se guardará tu sesión con la huella.',
    );
  }

  return (
    <View style={[styles.publicProfileBox, styles.menuPanel]}>
      <Text style={styles.itemTitle}>Entrar con huella: {on ? 'activado' : 'desactivado'}</Text>
      <Text style={styles.smallText}>
        Al cerrar sesión, tu sesión queda guardada con tu huella para volver a entrar sin escribir tu correo ni tu
        contraseña. Tu huella no sale de tu teléfono.
      </Text>
      <SecondaryButton title={on ? 'Desactivar' : 'Activar'} compact onPress={() => void toggle()} />
    </View>
  );
}
