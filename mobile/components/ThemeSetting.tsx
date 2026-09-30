import { Text, View } from 'react-native';

import { styles } from '../styles';
import { Segmented } from './ui';
import { applyThemePreference, useThemePreference, type ThemePreference } from '../theme';

/** Cuenta (cliente) y Acciones → Sesión (mecánico): tema automático, claro u oscuro. */
export function ThemeSetting() {
  const preference = useThemePreference();
  return (
    <View style={styles.stack}>
      <Text style={styles.itemTitle}>Tema de la app</Text>
      <Segmented
        value={preference}
        options={[
          { key: 'system', label: 'Automático', icon: 'phone-portrait-outline' },
          { key: 'light', label: 'Claro', icon: 'sunny-outline' },
          { key: 'dark', label: 'Oscuro', icon: 'moon-outline' },
        ]}
        onChange={(value) => applyThemePreference(value as ThemePreference)}
      />
      <Text style={styles.smallText}>
        Automático usa el modo de tu teléfono. También lo cambias con el botón de luna o sol junto a la campana.
      </Text>
    </View>
  );
}
