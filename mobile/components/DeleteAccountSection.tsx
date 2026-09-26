import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';

import { colors } from '../colors';
import { styles } from '../styles';
import { InfoRow, SecondaryButton } from './ui';

/**
 * "Eliminar mi cuenta" (requisito de Google Play): primero explica qué pasa
 * con los datos y después pide una última confirmación. Dos pasos a
 * propósito: no se puede deshacer.
 */
export function DeleteAccountSection({ busy, onDeleteAccount }: { busy: boolean; onDeleteAccount: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return <SecondaryButton title="Eliminar mi cuenta" compact onPress={() => setConfirming(true)} />;
  }

  return (
    <View style={styles.dangerBox}>
      <Text style={styles.publicProfileTitle}>¿Eliminar tu cuenta?</Text>
      <InfoRow icon="trash-outline" text="Se borran tus datos, vehículos, favoritos, preguntas, fotos y promociones." />
      <InfoRow icon="document-text-outline" text="Tus servicios pasados quedan en el historial, pero sin tu nombre ni dirección." />
      <InfoRow icon="alert-circle-outline" text="No se puede deshacer." />
      <SecondaryButton title="No, conservar mi cuenta" onPress={() => setConfirming(false)} />
      <Pressable
        style={({ pressed }) => [styles.dangerButton, (pressed || busy) && styles.buttonPressed]}
        disabled={busy}
        accessibilityRole="button"
        onPress={() =>
          Alert.alert('Última confirmación', 'Tu cuenta y tus datos se eliminarán para siempre.', [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Eliminar', style: 'destructive', onPress: () => void onDeleteAccount() },
          ])
        }
      >
        {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.dangerButtonText}>Sí, eliminar mi cuenta</Text>}
      </Pressable>
    </View>
  );
}
