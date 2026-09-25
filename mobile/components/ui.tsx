import { useEffect, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, Text, TextInput, View } from 'react-native';
import Animated, {
  Easing,
  FadeInUp,
  FadeOutUp,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';

import { colors } from '../colors';
import { styles } from '../styles';
import { getServiceRequestStatusLabel } from '../utils';

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

const ILLUST_WAITING = require('../assets/illust-waiting.png');
const ILLUST_IDENTITY = require('../assets/illust-identity.png');

type IdentityVerificationStatus = 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected';

type IdentityVerificationState = {
  status: IdentityVerificationStatus | null;
};

type ServiceRequest = {
  id: number;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: number;
  issueDescription: string;
  status: string;
  mechanicName?: string | null;
  serviceAddress?: string | null;
  city: string;
  zone: string;
  scheduleSlotId?: number | null;
  updates?: { id: number; source: string; message: string; createdAt: string }[];
};

export function RequestCard({ request }: { request: ServiceRequest }) {
  const latestUpdate = request.updates && request.updates.length > 0 ? request.updates[request.updates.length - 1] : null;
  return (
    <View style={styles.item}>
      {request.status === 'pending' && (
        <Image source={ILLUST_WAITING} resizeMode="contain" style={styles.cardIllustration} />
      )}
      <Text style={styles.itemTitle}>Solicitud #{request.id}</Text>
      <Text style={styles.itemText}>
        {request.vehicleMake} {request.vehicleModel} {request.vehicleYear}
      </Text>
      <Text style={styles.itemText}>Estado: {getServiceRequestStatusLabel(request.status)}</Text>
      <Text style={styles.itemText}>Mecánico: {request.mechanicName || 'sin asignar'}</Text>
      <Text style={styles.itemText}>Dirección: {request.serviceAddress || `${request.city}, ${request.zone}`}</Text>
      {request.scheduleSlotId && <Text style={styles.smallText}>Turno #{request.scheduleSlotId}</Text>}
      <Text numberOfLines={2} style={styles.smallText}>{request.issueDescription}</Text>
      {latestUpdate && (
        <Text numberOfLines={1} style={styles.smallText}>
          Último update: {latestUpdate.source} · {latestUpdate.message}
        </Text>
      )}
    </View>
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

export function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ key: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            style={({ pressed }) => [styles.segment, active && styles.segmentActive, pressed && styles.buttonPressed]}
            onPress={() => onChange(option.key)}
          >
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
  accessibilityLabel,
  onLayoutMeasured,
}: {
  active: boolean;
  onPress: () => void;
  iconName: ComponentProps<typeof Ionicons>['name'];
  accessibilityLabel: string;
  onLayoutMeasured?: (layout: { x: number; width: number }) => void;
}) {
  const { animatedStyle, onPressIn, onPressOut } = usePressScale(0.88);
  return (
    <AnimatedPressable
      style={[styles.bottomNavButton, active && styles.bottomNavButtonActive, animatedStyle]}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onLayout={(event) => {
        const { x, width } = event.nativeEvent.layout;
        onLayoutMeasured?.({ x, width });
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
    >
      <Ionicons name={iconName} size={24} color={active ? colors.white : colors.textDark} />
    </AnimatedPressable>
  );
}

export function NavTooltip({
  text,
  x,
  width,
  containerWidth,
  onDismiss,
}: {
  text: string;
  x: number;
  width: number;
  /** Ancho real del contenedor (la barra de navegación) donde el tooltip se posiciona, medido con onLayout. */
  containerWidth: number;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timeout = setTimeout(onDismiss, 2200);
    return () => clearTimeout(timeout);
  }, [text, x]);

  // El "ease-in" se maneja a mano con un shared value en vez de la prop
  // `entering`: `entering` solo se dispara cuando el componente se MONTA, y
  // este mismo NavTooltip se reutiliza (sin desmontar) al pasar de un botón
  // a otro para evitar el efecto "doble" de dos tooltips solapados. Al
  // reutilizarse, `entering` nunca vuelve a disparar — por eso solo se veía
  // el ease-out final (ese sí es un unmount real). Reiniciando el shared
  // value en cada cambio de texto se logra el mismo ease-in cada vez.
  const appear = useSharedValue(0);
  useEffect(() => {
    appear.value = 0;
    appear.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
  }, [text, x]);
  const appearStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [{ translateY: (1 - appear.value) * -8 }],
  }));

  // El wrapper ocupa exactamente el ancho del botón (x/width medidos con
  // onLayout) y centra la burbuja con flexbox — no hay matemática manual de
  // por medio, así que no puede quedar descentrado respecto al botón.
  // edgeShift solo corrige el caso borde: que la burbuja se salga de la
  // barra en los botones de las puntas.
  const tooltipWidth = 210;
  const buttonCenter = x + width / 2;
  const overflowLeft = tooltipWidth / 2 - buttonCenter;
  const overflowRight = buttonCenter + tooltipWidth / 2 - containerWidth;
  const edgeShift = containerWidth <= 0 ? 0 : overflowLeft > 0 ? overflowLeft : overflowRight > 0 ? -overflowRight : 0;

  return (
    <View
      style={{ position: 'absolute', bottom: 72, left: x, width, alignItems: 'center' }}
      pointerEvents="none"
    >
      <Animated.View exiting={FadeOutUp.duration(160)}>
        <Animated.View style={appearStyle}>
          <View style={[styles.navTooltip, { transform: [{ translateX: edgeShift }] }]}>
            <Text style={styles.navTooltipText} numberOfLines={2}>
              {text}
            </Text>
          </View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}
export function PrimaryButton({
  title,
  onPress,
  busy = false,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
}) {
  const { animatedStyle, onPressIn, onPressOut } = usePressScale();
  return (
    <AnimatedPressable
      style={[styles.primaryButton, busy && styles.primaryButtonBusy, animatedStyle]}
      hitSlop={8}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={busy}
      accessibilityState={{ busy, disabled: busy }}
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
      {identityState.status !== 'approved' && (
        <Image source={ILLUST_IDENTITY} resizeMode="contain" style={styles.cardIllustration} />
      )}
      {identityState.status !== 'approved' &&
        identityState.status !== 'submitted' &&
        identityState.status !== 'under_review' && (
          <>
            <Text style={styles.identityHint}>
              Usa la cámara en vivo para tus fotos — no subas imágenes desde tu galería, esa opción puede fallar.
            </Text>
            <Pressable style={styles.primaryButton} disabled={identityBusy} onPress={onStart}>
              {identityBusy ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {identityState.status === 'rejected' ? 'Volver a intentar' : 'Verificar identidad'}
                </Text>
              )}
            </Pressable>
          </>
        )}
    </Card>
  );
}