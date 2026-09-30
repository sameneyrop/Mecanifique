import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '../colors';
import { styles } from '../styles';
import { Card, PrimaryButton, Segmented } from './ui';
import { SearchingRadar } from './SearchingRadar';
import { CountdownRing, RingingBell } from './CountdownRing';
import { previewCelebration } from './Celebration';

/**
 * Solo en desarrollo (__DEV__, nunca en el APK ni en EAS Update): ver las
 * animaciones sin tener que armar el flujo real (una solicitud esperando
 * respuesta, una solicitud entrante, un servicio terminado).
 */

type Demo = 'radar' | 'ring' | 'done';
const RING_SECONDS = 30;

function RingDemo() {
  const [expiresAt, setExpiresAt] = useState(() => Date.now() + RING_SECONDS * 1000);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const intervalId = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, []);
  const secondsLeft = Math.max(0, Math.round((expiresAt - now) / 1000));
  // Al llegar a cero vuelve a empezar, para verlo las veces que haga falta.
  useEffect(() => {
    if (secondsLeft === 0) setExpiresAt(Date.now() + RING_SECONDS * 1000);
  }, [secondsLeft]);
  return (
    <View style={styles.incomingHeader}>
      <View style={[styles.flex, styles.stack]}>
        <RingingBell>
          <Ionicons name="notifications" size={30} color={colors.primary} />
        </RingingBell>
        <Text style={styles.incomingTitle}>Nueva solicitud</Text>
      </View>
      <CountdownRing expiresAt={expiresAt} totalSeconds={RING_SECONDS} secondsLeft={secondsLeft} />
    </View>
  );
}

export function MotionPreview() {
  const [demo, setDemo] = useState<Demo>('radar');
  if (!__DEV__) return null;
  return (
    <Card title="Vista previa de animaciones" subtitle="Solo en desarrollo: no aparece en el APK.">
      <View style={styles.stack}>
        <Segmented
          value={demo}
          options={[
            { key: 'radar', label: 'Buscando' },
            { key: 'ring', label: 'Tiempo' },
            { key: 'done', label: 'Terminado' },
          ]}
          onChange={(value) => setDemo(value as Demo)}
        />
        {demo === 'radar' && <SearchingRadar label="Vista previa del radar" />}
        {demo === 'ring' && <RingDemo />}
        {demo === 'done' && (
          <View style={styles.stack}>
            <PrimaryButton
              title="Festejo del cliente"
              onPress={() => previewCelebration('¡Tu auto quedó listo!', 'Juan terminó el servicio. Revisa el comprobante y califícalo.')}
            />
            <PrimaryButton
              title="Festejo del mecánico"
              onPress={() => previewCelebration('¡Servicio terminado!', 'Buen trabajo. Ahora cóbrale a María.')}
            />
          </View>
        )}
      </View>
    </Card>
  );
}
