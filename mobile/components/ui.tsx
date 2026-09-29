import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  Text,
  TextInput,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  FadeInUp,
  FadeOutUp,
  cancelAnimation,
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';

import { colors } from '../colors';
import { ILLUSTRATIONS } from '../illustrations';
import { styles } from '../styles';
import { formatServerDate, getServiceRequestStatusLabel } from '../utils';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function usePressScale(toValue = 0.97) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const onPressIn = () => {
    scale.value = withSpring(toValue, { damping: 24, stiffness: 180 });
    Haptics.selectionAsync().catch(() => undefined);
  };
  const onPressOut = () => {
    scale.value = withSpring(1, { damping: 24, stiffness: 180 });
  };
  return { animatedStyle, onPressIn, onPressOut };
}

type IconName = ComponentProps<typeof Ionicons>['name'];

type IdentityVerificationStatus = 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected';

type IdentityVerificationState = {
  status: IdentityVerificationStatus | null;
};

/**
 * Lugar reservado para una ilustración de marca que todavía no existe
 * (mismo recuadro punteado que el hero de Inicio). Cuando llegue la
 * ilustración final se reemplaza aquí, en un solo componente.
 */
export function ImagePlaceholder({ icon, compact = false }: { icon: IconName; compact?: boolean }) {
  return (
    <View style={[styles.heroPlaceholder, compact && styles.placeholderCompact]}>
      <Ionicons name={icon} size={compact ? 32 : 40} color={colors.primary} />
    </View>
  );
}

/**
 * Ilustración de marca (ver illustrations.ts): a todo lo ancho y con altura
 * fija, para que nunca tape lo que sigue en la pantalla. Llena el recuadro
 * recortando un poco las orillas; las cuadradas van con fit="contain" para
 * no cortarles la cabeza.
 */
export function Illustration({
  source,
  compact = false,
  fit = 'cover',
}: {
  source: ImageSourcePropType;
  compact?: boolean;
  fit?: 'cover' | 'contain';
}) {
  if (fit === 'contain') {
    // Entera dentro de un recuadro a todo lo ancho del mismo color que el
    // fondo de las ilustraciones: se ve como tarjeta, no como un cuadro suelto.
    return (
      <View style={[styles.illustration, compact && styles.illustrationCompact, styles.illustrationFrame]}>
        <Image source={source} resizeMode="contain" style={styles.illustrationFill} accessibilityIgnoresInvertColors />
      </View>
    );
  }
  return (
    <Image
      source={source}
      resizeMode="cover"
      style={[styles.illustration, compact && styles.illustrationCompact]}
      accessibilityIgnoresInvertColors
    />
  );
}

/** Pantalla o lista vacía: ilustración (o recuadro con ícono), qué pasa y qué hacer. */
export function EmptyState({
  icon,
  image,
  title,
  text,
  children,
}: {
  icon: IconName;
  image?: ImageSourcePropType;
  title: string;
  text?: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.stack}>
      {image ? <Illustration source={image} compact /> : <ImagePlaceholder icon={icon} compact />}
      <View style={styles.emptyState}>
        <Text style={styles.emptyStateTitle}>{title}</Text>
        {text ? <Text style={styles.emptyStateText}>{text}</Text> : null}
      </View>
      {children}
    </View>
  );
}

/** Opción seleccionable con ícono, título y descripción (como "Ahora mismo" en Inicio). */
export function ChoiceTile({
  icon,
  title,
  description,
  active,
  onPress,
  style,
}: {
  icon: IconName;
  title: string;
  description?: string;
  active: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.whenOption, active && styles.whenOptionActive, pressed && styles.buttonPressed, style]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Ionicons name={icon} size={18} color={active ? colors.primary : colors.textSecondary} />
      <Text style={[styles.whenOptionTitle, active && styles.whenOptionTitleActive]}>{title}</Text>
      {description ? <Text style={styles.smallText}>{description}</Text> : null}
    </Pressable>
  );
}

/** Un dato con su ícono azul al frente, en vez de "Etiqueta: valor". */
/** Foto de perfil en círculo; sin foto, las iniciales del nombre. */
export function Avatar({ uri, name, size = 48 }: { uri?: string | null; name?: string | null; size?: number }) {
  const circle = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[styles.avatarImage, circle]}
        accessibilityLabel={name ? `Foto de ${name}` : 'Foto de perfil'}
      />
    );
  }
  const initials = (name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
  return (
    <View style={[styles.avatarCircle, circle]}>
      {initials ? (
        <Text style={[styles.avatarInitials, { fontSize: Math.round(size * 0.38) }]}>{initials}</Text>
      ) : (
        <Ionicons name="person-outline" size={Math.round(size * 0.5)} color={colors.primary} />
      )}
    </View>
  );
}

export function InfoRow({ icon, text, lines }: { icon: IconName; text: string; lines?: number }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text numberOfLines={lines} style={styles.infoRowText}>
        {text}
      </Text>
    </View>
  );
}

export function StatusPill({ status }: { status: string }) {
  const done = status === 'completed';
  const muted = status === 'cancelled';
  return (
    <View style={[styles.statusPill, done && styles.statusPillDone, muted && styles.statusPillMuted]}>
      <Text style={[styles.statusPillText, done && styles.statusPillTextDone, muted && styles.statusPillTextMuted]}>
        {getServiceRequestStatusLabel(status)}
      </Text>
    </View>
  );
}

type RequestCardData = {
  id: number;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: number;
  issueDescription?: string;
  status: string;
  mechanicName?: string | null;
  customerName?: string | null;
  serviceAddress?: string | null;
  city: string;
  zone: string;
  preferredTime?: string | null;
  scheduleSlotId?: number | null;
  holdExpiresAt?: string | null;
  updatedAt?: string;
  updates?: { id: number; source: string; message: string; createdAt: string }[];
};

/**
 * Resumen de una solicitud. Con onPress se comporta como renglón de lista
 * (flecha a la derecha); sin onPress, como encabezado del detalle.
 */
export function RequestCard({
  request,
  viewerRole,
  onPress,
}: {
  request: RequestCardData;
  viewerRole: 'customer' | 'mechanic' | 'admin';
  onPress?: () => void;
}) {
  const latestUpdate = request.updates && request.updates.length > 0 ? request.updates[request.updates.length - 1] : null;
  const pending = request.status === 'pending';
  const person =
    viewerRole === 'mechanic'
      ? request.customerName || 'Cliente'
      : pending
        ? request.mechanicName
          ? `Esperando respuesta de ${request.mechanicName}`
          : 'Buscando mecánico disponible'
        : request.mechanicName || 'Sin mecánico asignado';
  const when = request.preferredTime?.trim();

  return (
    <Pressable
      style={({ pressed }) => [styles.item, pressed && onPress && styles.buttonPressed]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <View style={styles.itemHeader}>
        <View style={styles.itemIcon}>
          <Ionicons name="car-sport-outline" size={20} color={colors.primary} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.itemTitle}>
            {request.vehicleMake} {request.vehicleModel} {request.vehicleYear}
          </Text>
          <Text style={styles.smallText}>
            Solicitud #{request.id}
            {request.updatedAt ? ` · ${formatServerDate(request.updatedAt)}` : ''}
          </Text>
        </View>
        {onPress && <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />}
      </View>
      <StatusPill status={request.status} />
      <InfoRow icon="person-outline" text={person} />
      <InfoRow icon="location-outline" text={request.serviceAddress || `${request.city} · ${request.zone}`} lines={2} />
      {(request.scheduleSlotId || when) && (
        <InfoRow icon="calendar-outline" text={when ? `Para: ${when}` : 'Turno agendado'} />
      )}
      {request.issueDescription ? <InfoRow icon="construct-outline" text={request.issueDescription} lines={2} /> : null}
      {latestUpdate && <InfoRow icon="chatbubble-ellipses-outline" text={latestUpdate.message} lines={1} />}
    </Pressable>
  );
}

/**
 * Aviso mientras el servidor despierta (Render gratis se duerme sin uso y
 * tarda hasta un minuto en responder la primera vez).
 */
export function ServerWakingBanner({ visible }: { visible: boolean }) {
  if (!visible) {
    return null;
  }
  return (
    <Animated.View entering={FadeInUp.duration(200)} exiting={FadeOutUp.duration(160)} style={styles.serverWakingBanner}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.serverWakingText}>Conectando con el servidor… puede tardar hasta un minuto.</Text>
    </Animated.View>
  );
}

const TOAST_AUTO_DISMISS_MS = 3500;

export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    if (!message) {
      return;
    }
    const timeout = setTimeout(onDismiss, TOAST_AUTO_DISMISS_MS);
    return () => clearTimeout(timeout);
  }, [message]);

  if (!message) {
    return null;
  }

  return (
    <View style={styles.toastWrap} pointerEvents="box-none">
      <Animated.View
        key={message}
        entering={FadeInUp.duration(220)}
        exiting={FadeOutUp.duration(180)}
        style={styles.toastCard}
      >
        <Text numberOfLines={3} style={styles.toastText}>
          {message}
        </Text>
      </Animated.View>
    </View>
  );
}

export function MenuRow({
  icon,
  label,
  badge,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  badge?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.menuRow, pressed && styles.buttonPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={20} color={colors.textDark} />
      <Text style={styles.menuRowLabel}>{label}</Text>
      {badge && (
        <View style={styles.menuRowBadge}>
          <Text style={styles.menuRowBadgeText}>{badge}</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </Pressable>
  );
}

export function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {subtitle ? (
        <Text numberOfLines={3} ellipsizeMode="tail" style={styles.cardSubtitle}>
          {subtitle}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

export function Field({
  label,
  children,
  style,
}: {
  label: string;
  children: ReactNode;
  style?: object;
}) {
  return (
    <View style={style}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

export function Input(props: ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor={colors.textSecondary} style={styles.input} {...props} />;
}

export function CharCounter({ value, max }: { value: string; max: number }) {
  return (
    <Text style={styles.smallText}>
      {value.length}/{max}
    </Text>
  );
}

// Columnas por número de opciones: 4 van en 2x2 y 5 en una fila, para no
// dejar una opción sola ocupando todo el ancho en la última fila.
function segmentColumns(count: number): number {
  if (count === 4) return 2;
  if (count === 5) return 5;
  return Math.min(count, 3);
}

/** Una onda que sale del punto y se desvanece, en ciclo. */
function PulseRing({ delay }: { delay: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 2000, easing: Easing.out(Easing.quad) }), -1, false),
    );
    return () => cancelAnimation(progress);
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: 0.35 * (1 - progress.value),
    transform: [{ scale: 1 + progress.value * 1.8 }],
  }));
  return <Animated.View style={[styles.pulseRing, style]} />;
}

/** Punto de estado; encendido, irradia ondas suaves (como un indicador "en vivo"). */
export function StatusPulseDot({ active }: { active: boolean }) {
  return (
    <View style={styles.pulseDotWrap}>
      {active && [0, 1].map((ring) => <PulseRing key={ring} delay={ring * 1000} />)}
      <View style={[styles.connectionDot, active && styles.connectionDotOn]} />
    </View>
  );
}

const STAR_LABELS = ['Malo', 'Regular', 'Bien', 'Muy bien', 'Excelente'];

/**
 * Una estrella con brillo: al elegir, las encendidas saltan una tras otra y
 * se quedan con un halo dorado suave detrás.
 */
function RatingStar({
  star,
  filled,
  pulse,
  onPress,
}: {
  star: number;
  filled: boolean;
  pulse: number;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const glow = useSharedValue(filled ? 1 : 0);

  useEffect(() => {
    if (!filled) {
      glow.value = withTiming(0, { duration: 150 });
      return;
    }
    const delay = (star - 1) * 40;
    scale.value = withDelay(delay, withSequence(withTiming(1.12, { duration: 110 }), withSpring(1, { damping: 14 })));
    glow.value = withDelay(delay, withSequence(withTiming(1.2, { duration: 140 }), withTiming(1, { duration: 350 })));
  }, [filled, pulse]);

  const starStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: Math.min(glow.value, 1) * 0.3,
    transform: [{ scale: 0.75 + glow.value * 0.2 }],
  }));

  return (
    <Pressable
      style={styles.starButton}
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`${star} ${star === 1 ? 'estrella' : 'estrellas'}: ${STAR_LABELS[star - 1]}`}
      accessibilityState={{ selected: filled }}
    >
      <Animated.View style={[styles.starHalo, haloStyle]} />
      <Animated.View style={starStyle}>
        <Ionicons
          name={filled ? 'star' : 'star-outline'}
          size={40}
          color={colors.accent}
          style={filled ? styles.starGlow : undefined}
        />
      </Animated.View>
    </Pressable>
  );
}

/**
 * Calificación de 1 a 5 estrellas, de izquierda a derecha: tocar la tercera
 * llena de la 1 a la 3. value es '' mientras no se elige.
 */
export function StarRating({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = Number(value) || 0;
  // Cuenta cada toque para repetir el brillo aunque se toque la misma estrella.
  const [pulse, setPulse] = useState(0);
  return (
    <View style={styles.starRating}>
      <View style={styles.starRow}>
        {[1, 2, 3, 4, 5].map((star) => (
          <RatingStar
            key={star}
            star={star}
            filled={star <= selected}
            pulse={pulse}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
              setPulse((count) => count + 1);
              onChange(String(star));
            }}
          />
        ))}
      </View>
      <Text style={styles.starRatingLabel}>{selected ? STAR_LABELS[selected - 1] : 'Toca las estrellas para calificar'}</Text>
    </View>
  );
}

export function Segmented({
  value,
  options,
  onChange,
  onBackground = false,
}: {
  value: string;
  options: Array<{ key: string; label: string; icon?: IconName }>;
  onChange: (value: string) => void;
  /** Directo sobre el fondo de la pantalla (no dentro de una tarjeta): opciones blancas. */
  onBackground?: boolean;
}) {
  const basis = `${Math.floor(100 / segmentColumns(options.length)) - 4}%` as const;
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            style={({ pressed }) => [
              styles.segment,
              { flexBasis: basis },
              onBackground && styles.segmentOnBackground,
              active && styles.segmentActive,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => onChange(option.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            {option.icon && (
              <Ionicons name={option.icon} size={18} color={active ? colors.primary : colors.textSecondary} />
            )}
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function BottomNavButton({
  active,
  onPress,
  iconName,
  label,
  accessibilityLabel,
}: {
  active: boolean;
  onPress: () => void;
  iconName: ComponentProps<typeof Ionicons>['name'];
  label: string;
  accessibilityLabel: string;
}) {
  const { animatedStyle, onPressIn, onPressOut } = usePressScale(0.92);
  return (
    <AnimatedPressable
      style={[styles.bottomNavButton, animatedStyle]}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
    >
      <Ionicons name={iconName} size={23} color={active ? colors.primary : colors.textSecondary} />
      <Text style={[styles.bottomNavItem, active && styles.bottomNavItemActive]} numberOfLines={1}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}
export function PrimaryButton({
  title,
  onPress,
  busy = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const { animatedStyle, onPressIn, onPressOut } = usePressScale();
  return (
    <AnimatedPressable
      style={[styles.primaryButton, (busy || disabled) && styles.primaryButtonBusy, animatedStyle]}
      hitSlop={8}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={busy || disabled}
      accessibilityState={{ busy, disabled: busy || disabled }}
    >
      {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryButtonText}>{title}</Text>}
    </AnimatedPressable>
  );
}

export function SecondaryButton({
  title,
  onPress,
  compact = false,
  busy = false,
}: {
  title: string;
  onPress: () => void;
  compact?: boolean;
  busy?: boolean;
}) {
  const { animatedStyle, onPressIn, onPressOut } = usePressScale();
  return (
    <AnimatedPressable
      style={[
        styles.secondaryButton,
        compact && styles.secondaryButtonCompact,
        busy && styles.primaryButtonBusy,
        animatedStyle,
      ]}
      hitSlop={8}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={busy}
      accessibilityState={{ busy, disabled: busy }}
    >
      {busy ? <ActivityIndicator /> : <Text style={[styles.secondaryButtonText, compact && styles.secondaryButtonTextCompact]}>{title}</Text>}
    </AnimatedPressable>
  );
}

export function IdentityVerificationCard({
  identityState,
  identityBusy,
  onStart,
}: {
  identityState: IdentityVerificationState;
  identityBusy: boolean;
  onStart: () => void;
}) {
  return (
    <Card
      title="Verificación de identidad"
      subtitle={
        identityState.status === 'approved'
          ? 'Tu identidad ya está verificada.'
          : identityState.status === 'draft' || !identityState.status
            ? 'Verifica tu identidad para poder usar la plataforma con confianza.'
            : identityState.status === 'rejected'
              ? 'Tu verificación fue rechazada. Puedes volver a intentarlo.'
              : 'Tu verificación está en revisión.'
      }
    >
      {identityState.status !== 'approved' && <Illustration source={ILLUSTRATIONS.identity} compact />}
      {identityState.status === 'approved' && (
        <InfoRow icon="shield-checkmark-outline" text="Los mecánicos y clientes ven que eres una persona verificada." />
      )}
      {identityState.status !== 'approved' &&
        identityState.status !== 'submitted' &&
        identityState.status !== 'under_review' && (
          <>
            <Text style={styles.identityHint}>
              Usa la cámara en vivo para tus fotos — no subas imágenes desde tu galería, esa opción puede fallar.
            </Text>
            <PrimaryButton
              title={identityState.status === 'rejected' ? 'Volver a intentar' : 'Verificar identidad'}
              busy={identityBusy}
              onPress={onStart}
            />
          </>
        )}
    </Card>
  );
}