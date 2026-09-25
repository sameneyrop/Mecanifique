import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import Constants from 'expo-constants';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, MenuRow, SecondaryButton, IdentityVerificationCard } from '../components/ui';
import { formatError } from '../utils';

// TODO: reemplazar por el canal de soporte real (ver README.md → "Riesgos
// operativos" / roadmap de lanzamiento) antes de publicar — hoy no hay un
// buzón confirmado detrás de esta dirección.
const SUPPORT_EMAIL = 'soporte@mecanifique.com';

const APP_VERSION = Constants.expoConfig?.version || '1.0.0';

export function AccountScreen({
  onStartIdentityVerification,
  onLoadNotifications,
  onMarkNotificationRead,
  onClearSession,
}: {
  onStartIdentityVerification: () => void;
  onLoadNotifications: () => Promise<void>;
  onMarkNotificationRead: (id: number) => void;
  onClearSession: () => Promise<void>;
}) {
  const { user, identityState, identityBusy, notifications, setMessage } = useAppContext();
  const [expanded, setExpanded] = useState<'personal' | 'about' | null>(null);

  if (!user) {
    return null;
  }

  function toggle(section: 'personal' | 'about') {
    setExpanded((current) => (current === section ? null : section));
  }

  function openSupportEmail(subject: string) {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`).catch(() =>
      setMessage(`No se pudo abrir tu correo. Escríbenos a ${SUPPORT_EMAIL}`),
    );
  }

  function comingSoon(feature: string) {
    setMessage(`${feature}: todavía no está disponible.`);
  }

  return (
    <>
      <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
        <Card title={user.fullName} subtitle={user.login} />
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(60).duration(300)} needsOffscreenAlphaCompositing>
        <IdentityVerificationCard
          identityState={identityState}
          identityBusy={identityBusy}
          onStart={onStartIdentityVerification}
        />
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(120).duration(300)} needsOffscreenAlphaCompositing>
        <Card title="Notificaciones" subtitle="Últimos avisos de la plataforma">
          <View style={styles.stack}>
            <SecondaryButton
              title="Refrescar"
              compact
              onPress={async () => {
                try {
                  await onLoadNotifications();
                } catch (error) {
                  setMessage(formatError(error));
                }
              }}
            />
            {notifications.length === 0 && (
              <Text style={styles.smallText}>Sin notificaciones por ahora.</Text>
            )}
            {notifications.map((notification) => (
              <View key={notification.id} style={[styles.notificationItem, notification.readAt && styles.notificationItemRead]}>
                <Text style={styles.itemTitle}>{notification.title}</Text>
                <Text style={styles.itemText}>{notification.body}</Text>
                <Text style={styles.smallText}>{notification.createdAt}</Text>
                {!notification.readAt && (
                  <SecondaryButton title="Marcar leída" compact onPress={() => onMarkNotificationRead(notification.id)} />
                )}
              </View>
            ))}
          </View>
        </Card>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(180).duration(300)} needsOffscreenAlphaCompositing>
        <Card title="Mi cuenta">
          <View>
            <MenuRow icon="person-outline" label="Información personal" onPress={() => toggle('personal')} />
            {expanded === 'personal' && (
              <View style={[styles.publicProfileBox, { marginBottom: 8 }]}>
                <Text style={styles.itemText}>Nombre: {user.fullName}</Text>
                <Text style={styles.itemText}>Correo: {user.login}</Text>
                <Text style={styles.itemText}>Rol: {user.role === 'customer' ? 'Cliente' : user.role === 'mechanic' ? 'Mecánico' : 'Admin'}</Text>
                <Text style={styles.smallText}>Editar estos datos todavía no está disponible.</Text>
              </View>
            )}
            <MenuRow icon="shield-checkmark-outline" label="Seguridad" onPress={() => comingSoon('Seguridad')} />
            <MenuRow icon="heart-outline" label="Favoritos" onPress={() => comingSoon('Favoritos')} />
            <MenuRow icon="chatbubble-ellipses-outline" label="Comunidad" badge="Próximamente" onPress={() => comingSoon('Comunidad')} />
            <MenuRow icon="pricetag-outline" label="Promociones" badge="Próximamente" onPress={() => comingSoon('Promociones')} />
            <MenuRow icon="information-circle-outline" label="Acerca de la aplicación" onPress={() => toggle('about')} />
            {expanded === 'about' && (
              <View style={[styles.publicProfileBox, { marginBottom: 8 }]}>
                <Text style={styles.itemText}>Mecanifique v{APP_VERSION}</Text>
                <Text style={styles.smallText}>Conecta clientes con mecánicos verificados.</Text>
              </View>
            )}
            <MenuRow icon="bug-outline" label="Reportar un problema" onPress={() => openSupportEmail('Reporte de problema en Mecanifique')} />
            <MenuRow icon="help-circle-outline" label="Obtener ayuda" onPress={() => openSupportEmail('Necesito ayuda con Mecanifique')} />
          </View>
        </Card>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(240).duration(300)} needsOffscreenAlphaCompositing>
        <Card title="Sesión">
          <SecondaryButton
            title="Cerrar sesión"
            onPress={async () => {
              await onClearSession();
              setMessage('Sesión cerrada');
            }}
          />
        </Card>
      </Animated.View>
    </>
  );
}
