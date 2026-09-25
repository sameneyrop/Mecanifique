import { Text, View } from 'react-native';

import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, SecondaryButton, IdentityVerificationCard } from '../components/ui';
import { formatError } from '../utils';

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

  if (!user) {
    return null;
  }

  return (
    <>
      <IdentityVerificationCard
        identityState={identityState}
        identityBusy={identityBusy}
        onStart={onStartIdentityVerification}
      />

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

      <Card title={user.fullName} subtitle={user.role}>
        <SecondaryButton
          title="Cerrar sesión"
          onPress={async () => {
            await onClearSession();
            setMessage('Sesión cerrada');
          }}
        />
      </Card>
    </>
  );
}
