import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

import { colors } from '../colors';
import { fonts } from '../fonts';
import { PrimaryButton } from './ui';

/**
 * Festejo al terminar un servicio: una palomita que se dibuja sola y confeti
 * con los colores de la marca. Se ve encima de todo (App.tsx) y se cierra
 * solo, con "Continuar" o tocando fuera. Cada servicio se festeja una vez
 * (se recuerda en el teléfono), para el cliente y para el mecánico.
 */

type Celebration = { key: number; title: string; text: string };

let current: Celebration | null = null;
const listeners = new Set<() => void>();

function emit(next: Celebration | null) {
  current = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const CELEBRATED_KEY = 'mecanifique.celebratedRequests';

/** Festeja el servicio si no se ha festejado antes en este teléfono. */
export async function celebrateServiceOnce(requestId: number, title: string, text: string) {
  let celebrated: number[] = [];
  try {
    celebrated = JSON.parse((await AsyncStorage.getItem(CELEBRATED_KEY)) ?? '[]');
  } catch {
    celebrated = [];
  }
  if (celebrated.includes(requestId)) return;
  AsyncStorage.setItem(CELEBRATED_KEY, JSON.stringify([...celebrated, requestId].slice(-30))).catch(() => undefined);
  emit({ key: Date.now(), title, text });
}

/** Solo la vista previa de desarrollo: festeja sin recordar nada. */
export function previewCelebration(title: string, text: string) {
  emit({ key: Date.now(), title, text });
}

const AUTO_CLOSE_MS = 4500;
const CHECK_SIZE = 96;
const CHECK_RADIUS = 42;
const CIRCLE_LENGTH = 2 * Math.PI * CHECK_RADIUS;
const CHECK_PATH = 'M 30 50 L 43 63 L 67 37';
const CHECK_LENGTH = 55;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

// Fijos (no del tema): el confeti va sobre el fondo oscurecido en los dos temas.
const CONFETTI_COLORS = ['#2F8FEA', '#F2B84B', '#5CCB8A', '#7DB8F2', '#FFFFFF', '#1C6DC4'];
const CONFETTI_COUNT = 36;
const CONFETTI_MS = 1900;
const GRAVITY = 620;

type Piece = {
  color: string;
  width: number;
  height: number;
  round: boolean;
  vx: number;
  vy: number;
  spin: number;
  wobble: number;
  phase: number;
  delay: number;
};

function makePieces(): Piece[] {
  return Array.from({ length: CONFETTI_COUNT }, (_, index) => {
    // Hacia arriba en abanico (de -165° a -15°), con fuerza distinta cada uno.
    const angle = ((-165 + Math.random() * 150) * Math.PI) / 180;
    const speed = 260 + Math.random() * 260;
    const round = index % 5 === 0;
    return {
      color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
      width: round ? 8 : 6 + Math.random() * 4,
      height: round ? 8 : 10 + Math.random() * 6,
      round,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      spin: (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540),
      wobble: 6 + Math.random() * 10,
      phase: Math.random() * Math.PI * 2,
      delay: Math.random() * 120,
    };
  });
}

function ConfettiPiece({ piece }: { piece: Piece }) {
  const time = useSharedValue(0);
  useEffect(() => {
    time.value = withDelay(piece.delay, withTiming(1, { duration: CONFETTI_MS, easing: Easing.linear }));
  }, []);
  const style = useAnimatedStyle(() => {
    const t = time.value;
    const x = piece.vx * t + Math.sin(t * 12 + piece.phase) * piece.wobble;
    const y = piece.vy * t + GRAVITY * t * t;
    return {
      opacity: t === 0 ? 0 : t > 0.7 ? (1 - t) / 0.3 : 1,
      transform: [{ translateX: x }, { translateY: y }, { rotate: `${piece.spin * t}deg` }],
    };
  });
  return (
    <Animated.View
      style={[
        celebrationStyles.piece,
        {
          width: piece.width,
          height: piece.height,
          marginLeft: -piece.width / 2,
          marginTop: -piece.height / 2,
          borderRadius: piece.round ? piece.width / 2 : 2,
          backgroundColor: piece.color,
        },
        style,
      ]}
    />
  );
}

function DrawnCheck({ animate }: { animate: boolean }) {
  const circle = useSharedValue(animate ? 0 : 1);
  const check = useSharedValue(animate ? 0 : 1);
  const pop = useSharedValue(animate ? 0.6 : 1);

  useEffect(() => {
    if (!animate) return;
    pop.value = withSpring(1, { damping: 12, stiffness: 160 });
    circle.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) });
    check.value = withDelay(320, withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) }));
  }, []);

  const circleProps = useAnimatedProps(() => ({ strokeDashoffset: CIRCLE_LENGTH * (1 - circle.value) }));
  const checkProps = useAnimatedProps(() => ({ strokeDashoffset: CHECK_LENGTH * (1 - check.value) }));
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  return (
    <Animated.View style={popStyle}>
      <Svg width={CHECK_SIZE} height={CHECK_SIZE} viewBox="0 0 100 100">
        <Circle cx={50} cy={50} r={CHECK_RADIUS} fill={colors.successBg} />
        <AnimatedCircle
          cx={50}
          cy={50}
          r={CHECK_RADIUS}
          stroke={colors.successText}
          strokeWidth={5}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${CIRCLE_LENGTH} ${CIRCLE_LENGTH}`}
          animatedProps={circleProps}
          transform="rotate(-90 50 50)"
        />
        <AnimatedPath
          d={CHECK_PATH}
          stroke={colors.successText}
          strokeWidth={7}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          strokeDasharray={`${CHECK_LENGTH} ${CHECK_LENGTH}`}
          animatedProps={checkProps}
        />
      </Svg>
    </Animated.View>
  );
}

function CelebrationCard({ celebration }: { celebration: Celebration }) {
  const reduceMotion = useReducedMotion();
  const { height } = useWindowDimensions();
  const pieces = useMemo(makePieces, [celebration.key]);
  const lift = useSharedValue(reduceMotion ? 0 : 24);

  useEffect(() => {
    lift.value = withTiming(0, { duration: 320, easing: Easing.out(Easing.back(1.4)) });
    const hapticTimer = setTimeout(
      () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined),
      reduceMotion ? 0 : 600,
    );
    const closeTimer = setTimeout(() => emit(null), AUTO_CLOSE_MS);
    return () => {
      clearTimeout(hapticTimer);
      clearTimeout(closeTimer);
    };
  }, [celebration.key]);

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateY: lift.value }] }));

  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(220)} style={StyleSheet.absoluteFill}>
      <Pressable
        style={celebrationStyles.backdrop}
        onPress={() => emit(null)}
        accessibilityRole="button"
        accessibilityLabel="Cerrar"
      />
      <View style={celebrationStyles.center} pointerEvents="box-none">
        <Animated.View
          style={[celebrationStyles.card, { backgroundColor: colors.surface }, cardStyle]}
          accessible
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${celebration.title}. ${celebration.text}`}
        >
          <DrawnCheck animate={!reduceMotion} />
          <Text style={[celebrationStyles.title, { color: colors.textDark }]}>{celebration.title}</Text>
          <Text style={[celebrationStyles.text, { color: colors.textSecondary }]}>{celebration.text}</Text>
          <View style={celebrationStyles.button}>
            <PrimaryButton title="Continuar" onPress={() => emit(null)} />
          </View>
        </Animated.View>
      </View>
      {/* El confeti sale de donde está la palomita y cae por encima de la tarjeta. */}
      {!reduceMotion && (
        <View style={[celebrationStyles.burst, { top: height / 2 - 70 }]} pointerEvents="none">
          {pieces.map((piece, index) => (
            <ConfettiPiece key={`${celebration.key}-${index}`} piece={piece} />
          ))}
        </View>
      )}
    </Animated.View>
  );
}

export function CelebrationOverlay() {
  const celebration = useSyncExternalStore(subscribe, () => current);
  if (!celebration) return null;
  return (
    <View style={celebrationStyles.layer} pointerEvents="box-none">
      <CelebrationCard key={celebration.key} celebration={celebration} />
    </View>
  );
}

const celebrationStyles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2000,
    elevation: 2000,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11, 15, 34, 0.6)',
  },
  burst: {
    position: 'absolute',
    left: '50%',
    width: 0,
    height: 0,
  },
  piece: {
    position: 'absolute',
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 20,
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontFamily: fonts.extrabold,
    fontSize: 24,
    textAlign: 'center',
    marginTop: 4,
  },
  text: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
  button: {
    alignSelf: 'stretch',
    marginTop: 8,
  },
});
