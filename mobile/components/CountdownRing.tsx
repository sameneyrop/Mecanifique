import { useEffect, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { colors } from '../colors';
import { fonts } from '../fonts';

/**
 * Tiempo para responder una solicitud entrante: un anillo que se vacía de
 * forma continua (no a saltos cada segundo). En los últimos segundos se pone
 * amarillo y late, para que se note sin tener que leer el número.
 */

const SIZE = 108;
const STROKE = 8;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const URGENT_SECONDS = 15;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function CountdownRing({
  expiresAt,
  totalSeconds,
  secondsLeft,
}: {
  /** Cuándo vence (ms). */
  expiresAt: number;
  /** Lo que duraba la oferta completa, para saber qué tan lleno empieza. */
  totalSeconds: number;
  secondsLeft: number;
}) {
  const reduceMotion = useReducedMotion();
  const remaining = useSharedValue(1);
  const beat = useSharedValue(1);
  const urgent = secondsLeft <= URGENT_SECONDS;

  useEffect(() => {
    const remainingMs = Math.max(0, expiresAt - Date.now());
    remaining.value = Math.min(1, remainingMs / (totalSeconds * 1000));
    remaining.value = withTiming(0, { duration: remainingMs, easing: Easing.linear });
    return () => cancelAnimation(remaining);
  }, [expiresAt, totalSeconds]);

  useEffect(() => {
    if (!urgent || reduceMotion) {
      beat.value = withTiming(1, { duration: 150 });
      return;
    }
    beat.value = withRepeat(
      withSequence(withTiming(1.07, { duration: 180, easing: Easing.out(Easing.quad) }), withTiming(1, { duration: 320 })),
      -1,
      false,
    );
    return () => cancelAnimation(beat);
  }, [urgent, reduceMotion]);

  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: CIRCUMFERENCE * (1 - remaining.value) }));
  const beatStyle = useAnimatedStyle(() => ({ transform: [{ scale: beat.value }] }));
  const tint = urgent ? colors.accent : colors.primary;

  return (
    <Animated.View
      style={[ringStyles.ring, beatStyle]}
      accessible
      accessibilityRole="timer"
      accessibilityLabel={`Quedan ${formatCountdown(secondsLeft)} para responder`}
    >
      {/* Girado -90° para que empiece arriba, como un reloj. */}
      <Svg width={SIZE} height={SIZE} style={ringStyles.svg}>
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} stroke={colors.primaryLight} strokeWidth={STROKE} fill={colors.surface} />
        <AnimatedCircle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke={tint}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          fill="none"
          animatedProps={ringProps}
        />
      </Svg>
      <Text style={[ringStyles.time, { color: colors.textDark }]}>{formatCountdown(secondsLeft)}</Text>
      <Text style={[ringStyles.caption, { color: colors.textSecondary }]}>para responder</Text>
    </Animated.View>
  );
}

/** La campana de "Nueva solicitud": suena al llegar y cada pocos segundos. */
export function RingingBell({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const swing = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    // Un vaivén corto y suave, y una pausa larga: avisa sin distraer.
    const ring = withSequence(
      withTiming(-7, { duration: 120, easing: Easing.out(Easing.quad) }),
      withTiming(5, { duration: 160, easing: Easing.inOut(Easing.quad) }),
      withTiming(-2, { duration: 140, easing: Easing.inOut(Easing.quad) }),
      withTiming(0, { duration: 120, easing: Easing.out(Easing.quad) }),
    );
    swing.value = withRepeat(withSequence(ring, withDelay(3800, withTiming(0, { duration: 1 }))), -1, false);
    return () => cancelAnimation(swing);
  }, [reduceMotion]);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${swing.value}deg` }] }));
  return <Animated.View style={[ringStyles.bell, style]}>{children}</Animated.View>;
}

const ringStyles = StyleSheet.create({
  ring: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  svg: {
    position: 'absolute',
    transform: [{ rotate: '-90deg' }],
  },
  time: {
    fontFamily: fonts.extrabold,
    fontSize: 22,
    fontVariant: ['tabular-nums'],
  },
  caption: {
    fontFamily: fonts.medium,
    fontSize: 10,
    marginTop: -2,
  },
  bell: {
    transformOrigin: 'top',
  },
});
