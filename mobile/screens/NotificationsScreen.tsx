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
  onMarkAllRead,
}: {
  onOpenNotification: (notification: AppNotification) => void;
  onMarkAllRead: () => void;
}) {
  const { notifications, unreadNotifications, busy } = useAppContext();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  return (
    <Animated.View entering={FadeInDown.duration(300)} needsOffscreenAlphaCompositing>
      <Card
        title={unreadNotifications > 0 ? `${unreadNotifications} sin leer` : 'Estás al día'}
        subtitle="Toca un aviso para ver de qué se trata."
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
              const opensSomething = notificationTarget(notification) !== null;
              return (
                <Pressable
                  key={notification.id}
                  style={({ pressed }) => [
                    styles.notificationItem,
                    !unread && styles.notificationItemRead,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => onOpenNotification(notification)}
                  accessibilityRole="button"
                  accessibilityLabel={`${unread ? 'Sin leer. ' : ''}${notification.title}. ${notification.body}`}
                >
                  <View style={styles.itemHeader}>
                    <Ionicons name={unread ? 'notifications' : 'notifications-outline'} size={20} color={colors.primary} />
                    <Text style={[styles.itemTitle, styles.flex]}>{notification.title}</Text>
                    {opensSomething && <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />}
                  </View>
                  <Text style={styles.itemText}>{notification.body}</Text>
                  <Text style={styles.smallText}>{formatServerDate(notification.createdAt)}</Text>
                </Pressable>
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
