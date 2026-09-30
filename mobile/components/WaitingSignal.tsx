import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '../colors';
import { fonts } from '../fonts';
import { Avatar } from './ui';

/**
 * "Esperando respuesta": tu auto y el mecánico, con una señal que viaja del
 * uno al otro mientras él revisa la solicitud. A propósito no es un mapa (eso
 * es el seguimiento "en camino"): aquí no importa dónde está, sino que la
 * solicitud le llegó y la está viendo.
 */

const NODE = 56;
const DOTS = 7;
const TRAVEL_MS = 1500;

function SignalDot({ index, phase, animate }: { index: number; phase: SharedValue<number>; animate: boolean }) {
  // La señal recorre los puntos de izquierda a derecha; cada uno brilla al pasar.
  const style = useAnimatedStyle(() => {
    if (!animate) return { opacity: 0.6, transform: [{ scale: 1 }] };
    const position = phase.value * (DOTS + 2) - 1;
    const glow = Math.max(0, 1 - Math.abs(position - index) / 1.4);
    return { opacity: 0.3 + 0.7 * glow, transform: [{ scale: 1 + 0.5 * glow }] };
  });
  return <Animated.View style={[signalStyles.dot, { backgroundColor: colors.primary }, style]} />;
}

function ReviewRing({ delay, animate }: { delay: number; animate: boolean }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    if (!animate) return;
    progress.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2000, easing: Easing.out(Easing.quad) }), -1, false));
    return () => cancelAnimation(progress);
  }, [animate]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.5 * (1 - progress.value),
    transform: [{ scale: 1 + progress.value * 0.55 }],
  }));
  if (!animate) return null;
  return <Animated.View style={[signalStyles.ring, { borderColor: colors.accent }, style]} />;
}

export function WaitingSignal({ mechanicName, mechanicPhotoUrl }: { mechanicName?: string | null; mechanicPhotoUrl?: string | null }) {
  const reduceMotion = useReducedMotion();
  const phase = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    phase.value = withRepeat(withTiming(1, { duration: TRAVEL_MS, easing: Easing.inOut(Easing.quad) }), -1, false);
    return () => cancelAnimation(phase);
  }, [reduceMotion]);

  const firstName = mechanicName?.trim().split(/\s+/)[0] || 'Mecánico';

  return (
    <View
      style={signalStyles.stage}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Tu solicitud le llegó a ${firstName}; está revisándola`}
    >
      <View style={signalStyles.node}>
        <View style={[signalStyles.circle, { backgroundColor: colors.primary, borderColor: colors.surface }]}>
          <Ionicons name="car-sport" size={26} color={colors.white} />
        </View>
        <Text style={[signalStyles.caption, { color: colors.textSecondary }]}>Tu auto</Text>
      </View>

      <View style={signalStyles.path}>
        {Array.from({ length: DOTS }, (_, index) => (
          <SignalDot key={index} index={index} phase={phase} animate={!reduceMotion} />
        ))}
      </View>

      <View style={signalStyles.node}>
        <View style={signalStyles.mechanic}>
          <ReviewRing delay={0} animate={!reduceMotion} />
          <ReviewRing delay={1000} animate={!reduceMotion} />
          {mechanicPhotoUrl ? (
            <View style={[signalStyles.photoFrame, { borderColor: colors.accent }]}>
              <Avatar uri={mechanicPhotoUrl} name={firstName} size={NODE - 6} />
            </View>
          ) : (
            <View style={[signalStyles.circle, { backgroundColor: colors.accent, borderColor: colors.surface }]}>
              <Ionicons name="construct" size={24} color={colors.white} />
            </View>
          )}
        </View>
        <Text style={[signalStyles.caption, { color: colors.textSecondary }]} numberOfLines={1}>
          {firstName}
        </Text>
      </View>
    </View>
  );
}

const signalStyles = StyleSheet.create({
  stage: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  node: {
    width: NODE + 24,
    alignItems: 'center',
    gap: 6,
  },
  circle: {
    width: NODE,
    height: NODE,
    borderRadius: NODE / 2,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mechanic: {
    width: NODE,
    height: NODE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoFrame: {
    width: NODE,
    height: NODE,
    borderRadius: NODE / 2,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  ring: {
    position: 'absolute',
    width: NODE,
    height: NODE,
    borderRadius: NODE / 2,
    borderWidth: 2,
  },
  path: {
    flex: 1,
    height: NODE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  caption: {
    fontFamily: fonts.semibold,
    fontSize: 13,
  },
});
