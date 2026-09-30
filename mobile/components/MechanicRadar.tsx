import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';

import { colors } from '../colors';

type RadarMechanic = {
  id: number;
  fullName: string;
  latitude?: number | null;
  longitude?: number | null;
  distanceKm?: number;
};

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number) {
  return (rad * 180) / Math.PI;
}

/** Rumbo real (0° = norte, sentido horario) del punto 2 visto desde el punto 1. */
function getBearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaLambda = toRad(lon2 - lon1);
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const SIZE = 250;
const CENTER = SIZE / 2;
const MAX_RADIUS = CENTER - 26;
const RINGS = [1 / 3, 2 / 3, 1];
const DOT_RADIUS = 7;
// Al llegar una ubicación nueva, el punto se desliza hasta ahí en vez de saltar.
const MOVE_MS = 2500;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * Un mecánico en el radar. Aparece con un pequeño rebote y, cuando cambia su
 * ubicación (o la escala del radar), se desliza. `live`: late como "en vivo"
 * (el seguimiento del mecánico que va en camino).
 */
function RadarDot({ x, y, live }: { x: number; y: number; live: boolean }) {
  const reduceMotion = useReducedMotion();
  const cx = useSharedValue(x);
  const cy = useSharedValue(y);
  const appear = useSharedValue(reduceMotion ? 1 : 0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (!reduceMotion) appear.value = withSpring(1, { damping: 11, stiffness: 180 });
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      cx.value = x;
      cy.value = y;
      return;
    }
    const move = { duration: MOVE_MS, easing: Easing.inOut(Easing.cubic) };
    cx.value = withTiming(x, move);
    cy.value = withTiming(y, move);
  }, [x, y]);

  useEffect(() => {
    if (!live || reduceMotion) return;
    pulse.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(pulse);
  }, [live, reduceMotion]);

  const dotProps = useAnimatedProps(() => ({ cx: cx.value, cy: cy.value, r: DOT_RADIUS * appear.value }));
  const haloProps = useAnimatedProps(() => ({
    cx: cx.value,
    cy: cy.value,
    r: DOT_RADIUS + pulse.value * 16,
    opacity: 0.4 * (1 - pulse.value),
  }));

  return (
    <>
      {live && !reduceMotion && <AnimatedCircle animatedProps={haloProps} fill={colors.primary} />}
      <AnimatedCircle animatedProps={dotProps} fill={colors.primary} stroke={colors.white} strokeWidth={2} />
    </>
  );
}

export function MechanicRadar({
  userLocation,
  mechanics,
  maxDistanceKm = 25,
  live = false,
}: {
  userLocation: { latitude: number; longitude: number };
  mechanics: RadarMechanic[];
  maxDistanceKm?: number;
  live?: boolean;
}) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={SIZE} height={SIZE}>
        {RINGS.map((ratio) => (
          <Circle
            key={ratio}
            cx={CENTER}
            cy={CENTER}
            r={MAX_RADIUS * ratio}
            stroke={colors.primaryLight}
            strokeWidth={1}
            fill="none"
          />
        ))}
        <Line x1={CENTER} y1={CENTER - MAX_RADIUS} x2={CENTER} y2={CENTER + MAX_RADIUS} stroke={colors.primaryLighter} strokeWidth={1} />
        <Line x1={CENTER - MAX_RADIUS} y1={CENTER} x2={CENTER + MAX_RADIUS} y2={CENTER} stroke={colors.primaryLighter} strokeWidth={1} />
        {RINGS.map((ratio) => (
          <SvgText key={`label-${ratio}`} x={CENTER + 6} y={CENTER - MAX_RADIUS * ratio + 12} fontSize={10} fill={colors.textSecondary}>
            {Math.round(maxDistanceKm * ratio)} km
          </SvgText>
        ))}
        {mechanics.map((mechanic) => {
          if (mechanic.latitude == null || mechanic.longitude == null) {
            return null;
          }
          const bearing = getBearingDeg(userLocation.latitude, userLocation.longitude, mechanic.latitude, mechanic.longitude);
          const ratio = Math.min(1, (mechanic.distanceKm ?? 0) / maxDistanceKm);
          const angleRad = toRad(bearing);
          const x = CENTER + Math.sin(angleRad) * MAX_RADIUS * ratio;
          const y = CENTER - Math.cos(angleRad) * MAX_RADIUS * ratio;
          return <RadarDot key={mechanic.id} x={x} y={y} live={live} />;
        })}
        <Circle cx={CENTER} cy={CENTER} r={8} fill={colors.textDark} stroke={colors.white} strokeWidth={2} />
      </Svg>
    </View>
  );
}
