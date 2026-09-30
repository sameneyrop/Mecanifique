import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '../colors';
import { styles } from '../styles';
import { Card, PrimaryButton, SecondaryButton, Segmented, StatusPulseDot } from './ui';
import { WaitingSignal } from './WaitingSignal';
import { CountdownRing, RingingBell } from './CountdownRing';
import { previewCelebration } from './Celebration';
import { MechanicRadar } from './MechanicRadar';
import { CountUp, GrowIn } from './CountUp';
import { SlideToConfirm } from './SlideToConfirm';
import { distanceKm, formatPesos } from '../utils';

/**
 * Solo en desarrollo (__DEV__, nunca en el APK ni en EAS Update): ver las
 * animaciones sin tener que armar el flujo real (una solicitud esperando
 * respuesta, una solicitud entrante, un servicio terminado…).
 */

type Demo = 'radar' | 'ring' | 'finish' | 'route' | 'connect' | 'numbers';
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

// El auto en el centro de Aguascalientes y un mecánico que se acerca.
const CAR = { latitude: 21.8818, longitude: -102.2916 };
const ROUTE = [
  { latitude: 21.905, longitude: -102.262 },
  { latitude: 21.899, longitude: -102.27 },
  { latitude: 21.894, longitude: -102.279 },
  { latitude: 21.889, longitude: -102.284 },
  { latitude: 21.885, longitude: -102.288 },
];

function RouteDemo() {
  const [step, setStep] = useState(0);
  // Como el seguimiento real, llega una ubicación nueva cada tantos segundos.
  useEffect(() => {
    const intervalId = setInterval(() => setStep((current) => (current + 1) % ROUTE.length), 3500);
    return () => clearInterval(intervalId);
  }, []);
  const point = ROUTE[step];
  return (
    <MechanicRadar
      userLocation={CAR}
      mechanics={[{ id: 1, fullName: 'Juan', ...point, distanceKm: distanceKm(CAR, point) }]}
      maxDistanceKm={6}
      live
    />
  );
}

function ConnectDemo() {
  const [online, setOnline] = useState(false);
  return (
    <View style={styles.stack}>
      <View style={styles.connectionStatus}>
        <StatusPulseDot active={online} />
        <Text style={styles.connectionStatusText}>{online ? 'Conectado' : 'Desconectado'}</Text>
      </View>
      {online ? (
        <SecondaryButton title="Desconectarme" onPress={() => setOnline(false)} />
      ) : (
        <PrimaryButton title="Conectarme" onPress={() => setOnline(true)} />
      )}
    </View>
  );
}

function NumbersDemo() {
  const [round, setRound] = useState(0);
  const [amount, setAmount] = useState(186);
  const bars = [2, 5, 9, 14, 11, 6, 8, 12, 7, 3];
  const max = Math.max(...bars);
  return (
    <View style={styles.stack}>
      <Text style={styles.itemTitle}>
        <CountUp value={amount} format={formatPesos} /> de comisión · 3 servicios
      </Text>
      <View key={round} style={styles.trendChart}>
        {bars.map((count, index) => (
          <View key={index} style={styles.trendBarSlot}>
            <GrowIn direction="up" delay={index * 18} style={[styles.trendBar, { height: (count / max) * 96 }]} />
          </View>
        ))}
      </View>
      <SecondaryButton
        title="Otra vez"
        onPress={() => {
          setAmount(100 + Math.round(Math.random() * 400));
          setRound((current) => current + 1);
        }}
      />
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
            { key: 'finish', label: 'Terminar' },
            { key: 'route', label: 'En camino' },
            { key: 'connect', label: 'Conectar' },
            { key: 'numbers', label: 'Números' },
          ]}
          onChange={(value) => setDemo(value as Demo)}
        />
        {demo === 'radar' && <WaitingSignal mechanicName="Juan Gallegos" />}
        {demo === 'ring' && <RingDemo />}
        {demo === 'finish' && (
          <View style={styles.stack}>
            <SlideToConfirm
              label="Desliza para terminar"
              hint="Le cobrarás $650 a María"
              onConfirm={() => previewCelebration('¡Servicio terminado!', 'Buen trabajo. Ahora cóbrale a María.')}
            />
            <SecondaryButton
              title="Festejo del cliente"
              onPress={() => previewCelebration('¡Tu auto quedó listo!', 'Juan terminó el servicio. Revisa el comprobante y califícalo.')}
            />
          </View>
        )}
        {demo === 'route' && <RouteDemo />}
        {demo === 'connect' && <ConnectDemo />}
        {demo === 'numbers' && <NumbersDemo />}
      </View>
    </Card>
  );
}
