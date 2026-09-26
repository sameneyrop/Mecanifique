import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';

import Constants from 'expo-constants';
import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import {
  Card,
  Field,
  InfoRow,
  Input,
  MenuRow,
  PrimaryButton,
  SecondaryButton,
  IdentityVerificationCard,
} from '../components/ui';
import { formatServerDate, normalizeSpecialties } from '../utils';

// TODO: reemplazar por el canal de soporte real (ver README.md → "Riesgos
// operativos" / roadmap de lanzamiento) antes de publicar — hoy no hay un
// buzón confirmado detrás de esta dirección.
const SUPPORT_EMAIL = 'soporte@mecanifique.com';

const APP_VERSION = Constants.expoConfig?.version || '1.0.0';

// Cuántos avisos se muestran antes de "Ver más".
const NOTIFICATIONS_PAGE_SIZE = 5;

const ROLE_LABELS = { customer: 'Cliente', mechanic: 'Mecánico', admin: 'Administrador' } as const;

export function AccountScreen({
  onStartIdentityVerification,
  onMarkNotificationRead,
  onClearSession,
  onSwitchRole,
}: {
  onStartIdentityVerification: () => void;
  onMarkNotificationRead: (id: number) => void;
  onClearSession: () => Promise<void>;
  onSwitchRole: (payload: {
    targetRole: 'customer' | 'mechanic';
    city?: string;
    zone?: string;
    yearsExperience?: number;
    specialties?: string[];
  }) => Promise<void>;
}) {
  const { user, identityState, identityBusy, notifications, busy, setMessage } = useAppContext();
  const [expanded, setExpanded] = useState<'personal' | 'about' | 'switchToPro' | null>(null);
  const [proForm, setProForm] = useState({ city: '', zone: '', yearsExperience: '0', specialties: '' });
  const [visibleNotifications, setVisibleNotifications] = useState(NOTIFICATIONS_PAGE_SIZE);

  if (!user) {
    return null;
  }

  const roleLabel = ROLE_LABELS[user.role];
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  function toggle(section: 'personal' | 'about' | 'switchToPro') {
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

  async function handleSwitchToProfessional() {
    if (user!.mechanicId) {
      await onSwitchRole({ targetRole: 'mechanic' });
      return;
    }
    if (!proForm.city.trim() || !proForm.zone.trim() || !proForm.specialties.trim()) {
      setMessage('Completa ciudad, zona y especialidades');
      return;
    }
    await onSwitchRole({
      targetRole: 'mechanic',
      city: proForm.city.trim(),
      zone: proForm.zone.trim(),
      yearsExperience: Number(proForm.yearsExperience) || 0,
      specialties: normalizeSpecialties(proForm.specialties),
    });
  }

  const showProForm = !user.mechanicId && expanded === 'switchToPro';

  return (
    <>
      <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
        <View style={styles.card}>
          <View style={styles.itemHeader}>
            <View style={styles.avatarCircle}>
              <Ionicons name="person-outline" size={30} color={colors.primary} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{user.fullName}</Text>
              <Text style={styles.smallText}>
                {roleLabel}
                {user.login && user.login !== user.fullName ? ` · ${user.login}` : ''}
              </Text>
            </View>
          </View>
        </View>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(60).duration(300)} needsOffscreenAlphaCompositing>
        <IdentityVerificationCard
          identityState={identityState}
          identityBusy={identityBusy}
          onStart={onStartIdentityVerification}
        />
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(120).duration(300)} needsOffscreenAlphaCompositing>
        <Card
          title="Notificaciones"
          subtitle={
            notifications.length === 0
              ? 'Aquí te avisamos de tus solicitudes.'
              : unreadCount > 0
                ? `${unreadCount} sin leer`
                : 'Estás al día.'
          }
        >
          <View style={styles.list}>
            {notifications.slice(0, visibleNotifications).map((notification) => (
              <View key={notification.id} style={[styles.notificationItem, notification.readAt && styles.notificationItemRead]}>
                <View style={styles.itemHeader}>
                  <Ionicons
                    name={notification.readAt ? 'notifications-outline' : 'notifications'}
                    size={20}
                    color={colors.primary}
                  />
                  <Text style={[styles.itemTitle, styles.flex]}>{notification.title}</Text>
                </View>
                <Text style={styles.itemText}>{notification.body}</Text>
                <Text style={styles.smallText}>{formatServerDate(notification.createdAt)}</Text>
                {!notification.readAt && (
                  <SecondaryButton title="Marcar como leída" compact onPress={() => onMarkNotificationRead(notification.id)} />
                )}
              </View>
            ))}
            {notifications.length > visibleNotifications && (
              <SecondaryButton
                title="Ver más"
                onPress={() => setVisibleNotifications((count) => count + NOTIFICATIONS_PAGE_SIZE)}
              />
            )}
          </View>
        </Card>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(180).duration(300)} needsOffscreenAlphaCompositing>
        <Card title="Mi cuenta">
          <View>
            <MenuRow icon="person-outline" label="Información personal" onPress={() => toggle('personal')} />
            {expanded === 'personal' && (
              <View style={[styles.publicProfileBox, { marginBottom: 8 }]}>
                <InfoRow icon="person-outline" text={user.fullName} />
                <InfoRow icon="mail-outline" text={user.login} />
                <InfoRow icon="briefcase-outline" text={roleLabel} />
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
        <Card
          title="Modo profesional"
          subtitle={
            user.mechanicId
              ? 'Ya tienes perfil de mecánico. Cambia de modo cuando quieras.'
              : 'Ofrece tus servicios como mecánico con esta misma cuenta.'
          }
        >
          <View style={styles.stack}>
            {showProForm ? (
              <>
                <View style={styles.row}>
                  <Field label="Ciudad" style={styles.flex}>
                    <Input value={proForm.city} onChangeText={(value) => setProForm({ ...proForm, city: value })} />
                  </Field>
                  <Field label="Zona" style={styles.flex}>
                    <Input value={proForm.zone} onChangeText={(value) => setProForm({ ...proForm, zone: value })} />
                  </Field>
                </View>
                <Field label="Años de experiencia">
                  <Input
                    value={proForm.yearsExperience}
                    keyboardType="numeric"
                    onChangeText={(value) => setProForm({ ...proForm, yearsExperience: value })}
                  />
                </Field>
                <Field label="Especialidades (separadas por coma)">
                  <Input
                    value={proForm.specialties}
                    onChangeText={(value) => setProForm({ ...proForm, specialties: value })}
                    placeholder="Motor, Eléctrico"
                  />
                </Field>
                <SecondaryButton title="Cancelar" onPress={() => setExpanded(null)} />
                <PrimaryButton title="Activar modo profesional" busy={busy} onPress={handleSwitchToProfessional} />
              </>
            ) : (
              <>
                {!user.mechanicId && (
                  <>
                    <InfoRow icon="notifications-outline" text="Recibe solicitudes de clientes en tu zona." />
                    <InfoRow icon="shield-checkmark-outline" text="Tu perfil muestra que eres un mecánico verificado." />
                  </>
                )}
                <PrimaryButton
                  title={user.mechanicId ? 'Cambiar a modo profesional' : 'Quiero ofrecer mis servicios'}
                  busy={busy}
                  onPress={() => (user.mechanicId ? handleSwitchToProfessional() : toggle('switchToPro'))}
                />
              </>
            )}
          </View>
        </Card>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(300).duration(300)} needsOffscreenAlphaCompositing>
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
