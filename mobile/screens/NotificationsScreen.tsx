import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, EmptyState, SecondaryButton } from '../components/ui';
import { formatServerDate } from '../utils';

type AppNotification = {
  id: number;
  title: string;
  body: string;
  dataJson?: string | null;
  readAt: string | null;
  createdAt: string;
};

const PAGE_SIZE = 15;

/** Adónde lleva tocar un aviso, según lo que trae (solicitud o pregunta). */
export function notificationTarget(notification: AppNotification): { requestId: number } | { questionId: number } | null {
  try {
    const data = notification.dataJson ? (JSON.parse(notification.dataJson) as Record<string, unknown>) : {};
    const requestId = Number(data.requestId ?? data.serviceRequestId);
    if (Number.isInteger(requestId) && requestId > 0) return { requestId };
    const questionId = Number(data.questionId);
    if (Number.isInteger(questionId) && questionId > 0) return { questionId };
  } catch {
    // Datos viejos o mal formados: el aviso solo se marca como leído.
  }
  return null;
}

export function NotificationsScreen({
  onOpenNotification,
  onMarkRead,
  onMarkAllRead,
}: {
  onOpenNotification: (notification: AppNotification) => void;
  onMarkRead: (notification: AppNotification) => void;
  onMarkAllRead: () => void;
}) {
  const { notifications, unreadNotifications, busy } = useAppContext();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // Plegados para que quepan más en pantalla; uno abierto a la vez.
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <Animated.View entering={FadeInDown.duration(300)} needsOffscreenAlphaCompositing>
      <Card
        title={unreadNotifications > 0 ? `${unreadNotifications} sin leer` : 'Estás al día'}
        subtitle="Toca un aviso para ver el detalle."
      >
        {notifications.length === 0 ? (
          <EmptyState
            icon="notifications-outline"
            title="Todavía no tienes avisos"
            text="Aquí te avisamos cuando cambie algo en tus solicitudes o te respondan en la Comunidad."
          />
        ) : (
          <View style={styles.list}>
            {unreadNotifications > 0 && (
              <SecondaryButton title="Marcar todas como leídas" busy={busy} onPress={onMarkAllRead} />
            )}
            {notifications.slice(0, visibleCount).map((notification) => {
              const unread = !notification.readAt;
              const target = notificationTarget(notification);
              const expanded = expandedId === notification.id;
              return (
                <View key={notification.id} style={[styles.notificationItem, !unread && styles.notificationItemRead]}>
                  <Pressable
                    style={({ pressed }) => [styles.notificationRow, pressed && styles.buttonPressed]}
                    onPress={() => {
                      setExpandedId(expanded ? null : notification.id);
                      onMarkRead(notification);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    accessibilityLabel={`${unread ? 'Sin leer. ' : ''}${notification.title}`}
                  >
                    {unread ? (
                      <View style={styles.notificationDot} />
                    ) : (
                      <Ionicons name="notifications-outline" size={16} color={colors.textSecondary} />
                    )}
                    <Text
                      style={[styles.notificationTitle, unread && styles.notificationTitleUnread]}
                      numberOfLines={expanded ? undefined : 1}
                    >
                      {notification.title}
                    </Text>
                    <Text style={styles.smallText}>{formatServerDate(notification.createdAt)}</Text>
                    <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
                  </Pressable>
                  {expanded && (
                    <View style={styles.stack}>
                      <Text style={styles.itemText}>{notification.body}</Text>
                      {target && (
                        <SecondaryButton
                          compact
                          title={'questionId' in target ? 'Ver pregunta' : 'Ver solicitud'}
                          onPress={() => onOpenNotification(notification)}
                        />
                      )}
                    </View>
                  )}
                </View>
              );
            })}
            {notifications.length > visibleCount && (
              <SecondaryButton title="Ver más" onPress={() => setVisibleCount((count) => count + PAGE_SIZE)} />
            )}
          </View>
        )}
      </Card>
    </Animated.View>
  );
}
