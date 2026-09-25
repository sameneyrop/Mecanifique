import { View } from 'react-native';
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

export function MechanicRadar({
  userLocation,
  mechanics,
  maxDistanceKm = 25,
}: {
  userLocation: { latitude: number; longitude: number };
  mechanics: RadarMechanic[];
  maxDistanceKm?: number;
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
          const dx = Math.sin(angleRad);
          const dy = -Math.cos(angleRad);
          const cx = CENTER + dx * MAX_RADIUS * ratio;
          const cy = CENTER + dy * MAX_RADIUS * ratio;
          return <Circle key={mechanic.id} cx={cx} cy={cy} r={7} fill={colors.primary} stroke={colors.white} strokeWidth={2} />;
        })}
        <Circle cx={CENTER} cy={CENTER} r={8} fill={colors.textDark} stroke={colors.white} strokeWidth={2} />
      </Svg>
    </View>
  );
}
