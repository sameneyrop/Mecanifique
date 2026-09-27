import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
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
import { formatServerDate, normalizeSpecialties, openPrivacyNotice } from '../utils';
import type { FavoriteMechanic } from '../App';
import { DeleteAccountSection } from '../components/DeleteAccountSection';

const APP_VERSION = Constants.expoConfig?.version || '1.0.0';

// Cuántos avisos se muestran antes de "Ver más".
const NOTIFICATIONS_PAGE_SIZE = 5;

const ROLE_LABELS = { customer: 'Cliente', mechanic: 'Mecánico', admin: 'Administrador' } as const;

type Section = 'personal' | 'security' | 'favorites' | 'about' | 'problem' | 'help' | 'switchToPro';

// Si la cuenta no tiene nombre, el servidor pone el correo en fullName.
function hasRealName(fullName: string): boolean {
  return Boolean(fullName.trim()) && !fullName.includes('@');
}

function PersonalInfoPanel({
  fullName,
  email,
  busy,
  onLoadAccountProfile,
  onUpdateProfile,
}: {
  fullName: string;
  email: string;
  busy: boolean;
  onLoadAccountProfile: () => Promise<{ fullName: string; email: string; phone: string }>;
  onUpdateProfile: (payload: { fullName: string; phone: string }) => Promise<boolean>;
}) {
  const [form, setForm] = useState({ fullName: hasRealName(fullName) ? fullName : '', phone: '' });

  useEffect(() => {
    onLoadAccountProfile()
      .then((profile) => setForm((current) => ({ ...current, phone: current.phone || profile.phone })))
      .catch(() => undefined);
  }, []);

  return (
    <View style={[styles.publicProfileBox, styles.menuPanel]}>
      <Field label="Nombre completo">
        <Input
          value={form.fullName}
          autoComplete="name"
          placeholder="Ej. Sergio García"
          onChangeText={(value) => setForm({ ...form, fullName: value })}
        />
      </Field>
      <Field label="Teléfono">
        <Input
          value={form.phone}
          keyboardType="phone-pad"
          autoComplete="tel"
          placeholder="10 dígitos"
          onChangeText={(value) => setForm({ ...form, phone: value })}
        />
      </Field>
      <InfoRow icon="mail-outline" text={email} />
      <Text style={styles.smallText}>El correo es con el que entras; no se puede cambiar aquí.</Text>
      <PrimaryButton
        title="Guardar mis datos"
        busy={busy}
        onPress={() => void onUpdateProfile({ fullName: form.fullName.trim(), phone: form.phone.trim() })}
      />
    </View>
  );
}

function SecurityPanel({
  busy,
  onChangePassword,
  onDeleteAccount,
}: {
  busy: boolean;
  onChangePassword: (password: string) => Promise<boolean>;
  onDeleteAccount: () => Promise<void>;
}) {
  const { setMessage } = useAppContext();
  const [form, setForm] = useState({ password: '', confirm: '' });

  async function submit() {
    if (form.password.length < 8) {
      setMessage('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    if (form.password !== form.confirm) {
      setMessage('Las dos contraseñas no coinciden');
      return;
    }
    if (await onChangePassword(form.password)) {
      setForm({ password: '', confirm: '' });
    }
  }

  return (
    <View style={[styles.publicProfileBox, styles.menuPanel]}>
      <Text style={styles.publicProfileTitle}>Cambiar contraseña</Text>
      <Field label="Nueva contraseña">
        <Input
          value={form.password}
          secureTextEntry
          autoCapitalize="none"
          placeholder="Mínimo 8 caracteres"
          onChangeText={(value) => setForm({ ...form, password: value })}
        />
      </Field>
      <Field label="Escríbela otra vez">
        <Input
          value={form.confirm}
          secureTextEntry
          autoCapitalize="none"
          onChangeText={(value) => setForm({ ...form, confirm: value })}
        />
      </Field>
      <PrimaryButton title="Cambiar contraseña" busy={busy} onPress={() => void submit()} />
      <Text style={[styles.publicProfileTitle, styles.menuPanel]}>Eliminar cuenta</Text>
      <DeleteAccountSection busy={busy} onDeleteAccount={onDeleteAccount} />
    </View>
  );
}

function FavoritesPanel({
  favorites,
  onOpenMechanic,
}: {
  favorites: FavoriteMechanic[];
  onOpenMechanic: (mechanicId: number) => void;
}) {
  return (
    <View style={[styles.publicProfileBox, styles.menuPanel]}>
      {favorites.length === 0 ? (
        <Text style={styles.smallText}>
          Toca el corazón en el perfil de un mecánico (pestaña Mecánicos) para guardarlo aquí.
        </Text>
      ) : (
        favorites.map((mechanic) => (
          <Pressable
            key={mechanic.id}
            style={({ pressed }) => [styles.slotCard, pressed && styles.buttonPressed]}
            onPress={() => onOpenMechanic(mechanic.id)}
            accessibilityRole="button"
          >
            <View style={styles.itemHeader}>
              <Ionicons name="heart" size={20} color={colors.primary} />
              <View style={styles.flex}>
                <Text style={styles.itemTitle}>{mechanic.fullName}</Text>
                <Text style={styles.smallText}>
                  ★ {mechanic.rating.toFixed(1)} · {mechanic.zone}, {mechanic.city} ·{' '}
                  {mechanic.isOnline ? (mechanic.isAvailable ? 'Disponible ahora' : 'Ocupado') : 'Desconectado'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </View>
          </Pressable>
        ))
      )}
    </View>
  );
}

const SUPPORT_COPY = {
  problem: {
    label: '¿Qué pasó?',
    placeholder: 'Ej. Al pedir un mecánico la app se queda cargando.',
    button: 'Enviar reporte',
  },
  help: {
    label: '¿En qué te ayudamos?',
    placeholder: 'Ej. No sé cómo agendar un turno con un mecánico.',
    button: 'Enviar mensaje',
  },
} as const;

function SupportPanel({
  kind,
  email,
  busy,
  onSendSupport,
}: {
  kind: 'problem' | 'help';
  email: string;
  busy: boolean;
  onSendSupport: (kind: 'problem' | 'help', message: string) => Promise<boolean>;
}) {
  const { setMessage } = useAppContext();
  const [message, setMessageText] = useState('');
  const copy = SUPPORT_COPY[kind];

  async function submit() {
    if (message.trim().length < 5) {
      setMessage('Cuéntanos un poco más');
      return;
    }
    if (await onSendSupport(kind, message.trim())) {
      setMessageText('');
    }
  }

  return (
    <View style={[styles.publicProfileBox, styles.menuPanel]}>
      <Field label={copy.label}>
        <Input value={message} multiline maxLength={2000} placeholder={copy.placeholder} onChangeText={setMessageText} />
      </Field>
      <Text style={styles.smallText}>Te respondemos a {email}.</Text>
      <PrimaryButton title={copy.button} busy={busy} onPress={() => void submit()} />
    </View>
  );
}

export function AccountScreen({
  onDeleteAccount,
  onOpenCommunity,
  favoriteMechanics,
  onOpenMechanic,
  onLoadAccountProfile,
  onUpdateProfile,
  onChangePassword,
  onSendSupport,
  onStartIdentityVerification,
  onMarkNotificationRead,
  onClearSession,
  onSwitchRole,
}: {
  onDeleteAccount: () => Promise<void>;
  onOpenCommunity: () => void;
  favoriteMechanics: FavoriteMechanic[];
  onOpenMechanic: (mechanicId: number) => void;
  onLoadAccountProfile: () => Promise<{ fullName: string; email: string; phone: string }>;
  onUpdateProfile: (payload: { fullName: string; phone: string }) => Promise<boolean>;
  onChangePassword: (password: string) => Promise<boolean>;
  onSendSupport: (kind: 'problem' | 'help', message: string) => Promise<boolean>;
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
  const { user, identityState, identityBusy, notifications, busy, setMessage, setCurrentScreen, vehicles } = useAppContext();
  const [expanded, setExpanded] = useState<Section | null>(null);
  const [proForm, setProForm] = useState({ city: '', zone: '', yearsExperience: '0', specialties: '' });
  const [visibleNotifications, setVisibleNotifications] = useState(NOTIFICATIONS_PAGE_SIZE);

  if (!user) {
    return null;
  }

  const roleLabel = ROLE_LABELS[user.role];
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  function toggle(section: Section) {
    setExpanded((current) => (current === section ? null : section));
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
              <Text style={styles.cardTitle}>{hasRealName(user.fullName) ? user.fullName : 'Tu cuenta'}</Text>
              <Text style={styles.smallText}>
                {roleLabel}
                {user.login ? ` · ${user.login}` : ''}
              </Text>
            </View>
          </View>
          {!hasRealName(user.fullName) && (
            <SecondaryButton title="Agrega tu nombre" compact onPress={() => setExpanded('personal')} />
          )}
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
            {user.role === 'customer' && (
              <MenuRow
                icon="car-sport-outline"
                label="Mis vehículos"
                badge={vehicles.length > 0 ? String(vehicles.length) : undefined}
                onPress={() => setCurrentScreen('vehicles')}
              />
            )}
            <MenuRow icon="person-outline" label="Información personal" onPress={() => toggle('personal')} />
            {expanded === 'personal' && (
              <PersonalInfoPanel
                fullName={user.fullName}
                email={user.login}
                busy={busy}
                onLoadAccountProfile={onLoadAccountProfile}
                onUpdateProfile={onUpdateProfile}
              />
            )}
            <MenuRow icon="shield-checkmark-outline" label="Seguridad" onPress={() => toggle('security')} />
            {expanded === 'security' && (
              <SecurityPanel busy={busy} onChangePassword={onChangePassword} onDeleteAccount={onDeleteAccount} />
            )}
            <MenuRow
              icon="heart-outline"
              label="Favoritos"
              badge={favoriteMechanics.length > 0 ? String(favoriteMechanics.length) : undefined}
              onPress={() => toggle('favorites')}
            />
            {expanded === 'favorites' && <FavoritesPanel favorites={favoriteMechanics} onOpenMechanic={onOpenMechanic} />}
            <MenuRow icon="chatbubble-ellipses-outline" label="Comunidad" onPress={onOpenCommunity} />
            <MenuRow icon="pricetag-outline" label="Promociones" onPress={() => setCurrentScreen('promotions')} />
            <MenuRow icon="information-circle-outline" label="Acerca de la aplicación" onPress={() => toggle('about')} />
            {expanded === 'about' && (
              <View style={[styles.publicProfileBox, styles.menuPanel]}>
                <Text style={styles.itemText}>Mecanifique v{APP_VERSION}</Text>
                <Text style={styles.smallText}>Conecta clientes con mecánicos verificados.</Text>
              </View>
            )}
            <MenuRow icon="document-text-outline" label="Aviso de privacidad" onPress={() => void openPrivacyNotice()} />
            <MenuRow icon="bug-outline" label="Reportar un problema" onPress={() => toggle('problem')} />
            {expanded === 'problem' && (
              <SupportPanel kind="problem" email={user.login} busy={busy} onSendSupport={onSendSupport} />
            )}
            <MenuRow icon="help-circle-outline" label="Obtener ayuda" onPress={() => toggle('help')} />
            {expanded === 'help' && (
              <SupportPanel kind="help" email={user.login} busy={busy} onSendSupport={onSendSupport} />
            )}
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
