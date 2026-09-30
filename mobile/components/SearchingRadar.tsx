import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '../colors';

/**
 * "Esperando respuesta": un radar con el auto del cliente al centro. El haz
 * da vueltas, salen ondas del auto y el punto amarillo (el mecánico al que se
 * le ofreció) se enciende cada vez que el haz le pasa por encima.
 */

const SIZE = 220;
const CENTER = SIZE / 2;
const RADIUS = CENTER - 6;
const CAR_SIZE = 48;
const TURN_MS = 2800;
// Dónde está el mecánico en el dibujo (grados desde arriba, sentido horario).
const BLIP_ANGLE = 58;
const BLIP_RATIO = 0.64;
// Estela del haz: franjas cada vez más tenues detrás del borde.
const TRAIL_STEPS = 16;
const TRAIL_STEP_DEG = 4;

function pointAt(angleDeg: number, radius: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CENTER + radius * Math.sin(rad), y: CENTER - radius * Math.cos(rad) };
}

function wedgePath(fromDeg: number, toDeg: number) {
  const start = pointAt(fromDeg, RADIUS);
  const end = pointAt(toDeg, RADIUS);
  return `M ${CENTER} ${CENTER} L ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 0 1 ${end.x} ${end.y} Z`;
}

const blipPoint = pointAt(BLIP_ANGLE, RADIUS * BLIP_RATIO);

function PulseWave({ delay, animate }: { delay: number; animate: boolean }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    if (!animate) return;
    progress.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1, false));
    return () => cancelAnimation(progress);
  }, [animate]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.45 * (1 - progress.value),
    transform: [{ scale: 1 + progress.value * ((RADIUS * 2) / CAR_SIZE - 1) }],
  }));
  if (!animate) return null;
  return <Animated.View style={[radarStyles.wave, { borderColor: colors.primary }, style]} />;
}

export function SearchingRadar({ label }: { label: string }) {
  const reduceMotion = useReducedMotion();
  const turn = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    turn.value = withRepeat(withTiming(360, { duration: TURN_MS, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(turn);
  }, [reduceMotion]);

  const sweepStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  // Brillo del mecánico: al máximo justo cuando pasa el haz y se apaga poco a poco.
  const blipStyle = useAnimatedStyle(() => {
    if (reduceMotion) return { opacity: 1, transform: [{ scale: 1 }] };
    const behind = (turn.value - BLIP_ANGLE + 360) % 360;
    const glow = behind < 220 ? 1 - behind / 220 : 0;
    return { opacity: 0.35 + 0.65 * glow, transform: [{ scale: 1 + 0.35 * glow }] };
  });
  const haloStyle = useAnimatedStyle(() => {
    if (reduceMotion) return { opacity: 0 };
    const behind = (turn.value - BLIP_ANGLE + 360) % 360;
    const glow = behind < 160 ? 1 - behind / 160 : 0;
    return { opacity: 0.4 * glow, transform: [{ scale: 1 + 1.4 * (1 - glow) }] };
  });

  return (
    <View style={radarStyles.stage} accessible accessibilityRole="image" accessibilityLabel={label}>
      <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
        <Circle cx={CENTER} cy={CENTER} r={RADIUS} fill={colors.primaryLighter} />
        {[1 / 3, 2 / 3, 1].map((ratio) => (
          <Circle key={ratio} cx={CENTER} cy={CENTER} r={RADIUS * ratio} stroke={colors.primaryLight} strokeWidth={1.5} fill="none" />
        ))}
        <Line x1={CENTER} y1={CENTER - RADIUS} x2={CENTER} y2={CENTER + RADIUS} stroke={colors.primaryLight} strokeWidth={1} />
        <Line x1={CENTER - RADIUS} y1={CENTER} x2={CENTER + RADIUS} y2={CENTER} stroke={colors.primaryLight} strokeWidth={1} />
      </Svg>

      {!reduceMotion && (
        <Animated.View style={[StyleSheet.absoluteFill, sweepStyle]} pointerEvents="none">
          <Svg width={SIZE} height={SIZE}>
            {/* Capas encimadas que nacen en el borde: más densas junto al haz, sin
                costuras entre franjas. */}
            {Array.from({ length: TRAIL_STEPS }, (_, step) => (
              <Path key={step} d={wedgePath(-(step + 1) * TRAIL_STEP_DEG, 0)} fill={colors.primary} opacity={0.035} />
            ))}
            <Line x1={CENTER} y1={CENTER} x2={CENTER} y2={CENTER - RADIUS} stroke={colors.primary} strokeWidth={2} strokeLinecap="round" />
          </Svg>
        </Animated.View>
      )}

      {[0, 800, 1600].map((delay) => (
        <PulseWave key={delay} delay={delay} animate={!reduceMotion} />
      ))}

      <Animated.View
        style={[radarStyles.blipHalo, { left: blipPoint.x - 14, top: blipPoint.y - 14, backgroundColor: colors.accent }, haloStyle]}
      />
      <Animated.View
        style={[
          radarStyles.blip,
          { left: blipPoint.x - 8, top: blipPoint.y - 8, backgroundColor: colors.accent, borderColor: colors.surface },
          blipStyle,
        ]}
      />

      <View style={[radarStyles.car, { backgroundColor: colors.primary, borderColor: colors.surface }]}>
        <Ionicons name="car-sport" size={24} color={colors.white} />
      </View>
    </View>
  );
}

const radarStyles = StyleSheet.create({
  stage: {
    width: SIZE,
    height: SIZE,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wave: {
    position: 'absolute',
    width: CAR_SIZE,
    height: CAR_SIZE,
    borderRadius: CAR_SIZE / 2,
    borderWidth: 2,
  },
  car: {
    width: CAR_SIZE,
    height: CAR_SIZE,
    borderRadius: CAR_SIZE / 2,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blip: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
  },
  blipHalo: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
  },
});
