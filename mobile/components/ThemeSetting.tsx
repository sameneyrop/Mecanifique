import { Text, View } from 'react-native';

import { styles } from '../styles';
import { Segmented } from './ui';
import { applyColorScheme, useColorScheme } from '../theme';
import type { ColorScheme } from '../colors';

/** Cuenta (cliente) y Acciones → Sesión (mecánico): tema claro u oscuro. */
export function ThemeSetting() {
  const scheme = useColorScheme();
  return (
    <View style={styles.stack}>
      <Text style={styles.itemTitle}>Tema de la app</Text>
      <Segmented
        value={scheme}
        options={[
          { key: 'light', label: 'Claro', icon: 'sunny-outline' },
          { key: 'dark', label: 'Oscuro', icon: 'moon-outline' },
        ]}
        onChange={(value) => applyColorScheme(value as ColorScheme)}
      />
      <Text style={styles.smallText}>También lo cambias con el botón de luna junto a la campana.</Text>
    </View>
  );
}
