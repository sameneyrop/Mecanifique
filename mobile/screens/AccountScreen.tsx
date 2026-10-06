import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';

import Constants from 'expo-constants';
import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import {
  Avatar,
  Card,
  Field,
  InfoRow,
  Input,
  MenuRow,
  PrimaryButton,
  SecondaryButton,
  IdentityVerificationCard,
} from '../components/ui';
import { BiometricSetting } from '../components/BiometricSetting';
import { takeAccountSection } from '../navigationRequests';
import { ThemeSetting } from '../components/ThemeSetting';
import { MotionPreview } from '../components/MotionPreview';
import { PASSWORD_RULE_TEXT, formatError, isValidPassword, normalizeSpecialties, openPrivacyNotice, openTerms, parseServerTimestamp } from '../utils';
import type { ApiCall, FavoriteMechanic } from '../App';
import { pickRequestPhoto } from '../photos';
import { DeleteAccountSection } from '../components/DeleteAccountSection';

const APP_VERSION = Constants.expoConfig?.version || '1.0.0';

// Cuántos avisos se muestran antes de "Ver más".

const ROLE_LABELS = { customer: 'Cliente', mechanic: 'Mecánico', admin: 'Administrador' } as const;

type Section = 'personal' | 'security' | 'favorites' | 'about' | 'problem' | 'help' | 'switchToPro';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "septiembre de 2026", de una fecha del servidor. */
function monthYear(value: string): string {
  const ms = parseServerTimestamp(value);
  if (ms === null) return '';
  const date = new Date(ms);
  return `${MONTHS[date.getMonth()]} de ${date.getFullYear()}`;
}

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
  onLoadAccountProfile: () => Promise<{
    fullName: string;
    email: string;
    phone: string;
    customerRating?: { average: number | null; count: number } | null;
    photoUrl?: string | null;
    customerSince?: string | null;
    completedServices?: number;
  }>;
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
    if (!isValidPassword(form.password)) {
      setMessage(`La contraseña necesita ${PASSWORD_RULE_TEXT.toLowerCase()}`);
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
          placeholder={PASSWORD_RULE_TEXT}
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
          Toca el corazón en el perfil de un mecánico para guardarlo aquí.
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
  api,
  onDeleteAccount,
  onOpenCommunity,
  favoriteMechanics,
  onOpenMechanic,
  onLoadAccountProfile,
  onUpdateProfile,
  onChangePassword,
  onSendSupport,
  onStartIdentityVerification,
  onClearSession,
  onSwitchRole,
  onStartTour,
}: {
  api: ApiCall;
  onDeleteAccount: () => Promise<void>;
  onOpenCommunity: () => void;
  onStartTour: () => void;
  favoriteMechanics: FavoriteMechanic[];
  onOpenMechanic: (mechanicId: number) => void;
  onLoadAccountProfile: () => Promise<{
    fullName: string;
    email: string;
    phone: string;
    customerRating?: { average: number | null; count: number } | null;
    photoUrl?: string | null;
    customerSince?: string | null;
    completedServices?: number;
  }>;
  onUpdateProfile: (payload: { fullName: string; phone: string }) => Promise<boolean>;
  onChangePassword: (password: string) => Promise<boolean>;
  onSendSupport: (kind: 'problem' | 'help', message: string) => Promise<boolean>;
  onStartIdentityVerification: () => void;
  onClearSession: () => Promise<void>;
  onSwitchRole: (payload: {
    targetRole: 'customer' | 'mechanic';
    city?: string;
    zone?: string;
    yearsExperience?: number;
    specialties?: string[];
  }) => Promise<void>;
}) {
  const { user, identityState, identityBusy, busy, setMessage, setCurrentScreen, vehicles } = useAppContext();
  const [expanded, setExpanded] = useState<Section | null>(() => takeAccountSection());
  const [proForm, setProForm] = useState({ city: '', zone: '', yearsExperience: '0', specialties: '' });
  // Su perfil de cliente: foto, calificación (la que ven los mecánicos antes
  // de aceptar), desde cuándo es cliente y cuántos servicios terminó.
  const [profile, setProfile] = useState<{
    photoUrl: string | null;
    rating: { average: number | null; count: number } | null;
    since: string | null;
    completed: number;
  } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  useEffect(() => {
    if (user?.role !== 'customer') return;
    onLoadAccountProfile()
      .then((loaded) =>
        setProfile({
          photoUrl: loaded.photoUrl ?? null,
          rating: loaded.customerRating ?? null,
          since: loaded.customerSince ?? null,
          completed: loaded.completedServices ?? 0,
        }),
      )
      .catch(() => undefined);
  }, [user?.role]);

  async function uploadPhoto(source: 'camera' | 'library') {
    try {
      const imageBase64 = await pickRequestPhoto(source);
      if (!imageBase64) return;
      setPhotoBusy(true);
      const saved = await api<{ url: string }>('/api/account/photo', { method: 'PUT', body: { imageBase64 } });
      setProfile((current) => (current ? { ...current, photoUrl: saved.url } : current));
      setMessage('Foto guardada');
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setPhotoBusy(false);
    }
  }

  function choosePhoto() {
    Alert.alert('Tu foto', 'El mecánico la ve para saber a quién busca cuando llegue.', [
      { text: 'Tomar foto', onPress: () => void uploadPhoto('camera') },
      { text: 'Elegir de la galería', onPress: () => void uploadPhoto('library') },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }

  if (!user) {
    return null;
  }

  const roleLabel = ROLE_LABELS[user.role];

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
            {user.role === 'customer' ? (
              <Pressable
                onPress={choosePhoto}
                disabled={photoBusy}
                accessibilityRole="button"
                accessibilityLabel={profile?.photoUrl ? 'Cambiar tu foto' : 'Agregar tu foto'}
              >
                {photoBusy ? (
                  <View style={styles.avatarCircle}>
                    <ActivityIndicator color={colors.primary} />
                  </View>
                ) : (
                  <Avatar uri={profile?.photoUrl} name={hasRealName(user.fullName) ? user.fullName : null} size={64} />
                )}
                <View style={styles.avatarEditBadge}>
                  <Ionicons name="camera" size={14} color={colors.white} />
                </View>
              </Pressable>
            ) : (
              <View style={styles.avatarCircle}>
                <Ionicons name="person-outline" size={30} color={colors.primary} />
              </View>
            )}
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{hasRealName(user.fullName) ? user.fullName : 'Tu cuenta'}</Text>
              <Text style={styles.smallText}>
                {roleLabel}
                {user.login ? ` · ${user.login}` : ''}
              </Text>
              {profile?.since ? (
                <Text style={styles.smallText}>
                  Cliente desde {monthYear(profile.since)}
                  {profile.completed > 0
                    ? ` · ${profile.completed} servicio${profile.completed === 1 ? '' : 's'} terminado${profile.completed === 1 ? '' : 's'}`
                    : ''}
                </Text>
              ) : null}
              {profile?.rating && profile.rating.count > 0 && profile.rating.average != null ? (
                <Text style={styles.smallText}>
                  Tu calificación como cliente: ★ {profile.rating.average.toFixed(1)} ({profile.rating.count})
                </Text>
              ) : null}
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
              <>
                <BiometricSetting />
                <SecurityPanel busy={busy} onChangePassword={onChangePassword} onDeleteAccount={onDeleteAccount} />
              </>
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
            <MenuRow icon="map-outline" label="Ver el recorrido de la app" onPress={onStartTour} />
            <MenuRow icon="information-circle-outline" label="Acerca de la aplicación" onPress={() => toggle('about')} />
            {expanded === 'about' && (
              <View style={[styles.publicProfileBox, styles.menuPanel]}>
                <Text style={styles.itemText}>Mecanifique v{APP_VERSION}</Text>
              </View>
            )}
            <MenuRow icon="reader-outline" label="Términos y condiciones" onPress={() => void openTerms()} />
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
          subtitle={user.mechanicId ? undefined : 'Ofrece tus servicios con esta misma cuenta.'}
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

      <Animated.View entering={FadeInDown.delay(240).duration(300)} needsOffscreenAlphaCompositing>
        <Card title="Apariencia">
          <ThemeSetting />
        </Card>
      </Animated.View>
      <MotionPreview />

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
