import { useMemo } from 'react';
import { Pressable, Text } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card } from '../components/ui';

export function HomeScreen({
  onToggleMechanicConnection,
}: {
  onToggleMechanicConnection: (next: 'online' | 'offline') => void;
}) {
  const { user, myRequests, mechanicConnection } = useAppContext();

  const liveLocationRequest = useMemo(
    () => myRequests.find((request) => request.status !== 'completed' && request.status !== 'cancelled'),
    [myRequests],
  );

  if (!user) {
    return null;
  }

  return (
    <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
      <Card
        title="Modo conductor mecánico"
        subtitle={
          liveLocationRequest
            ? `Compartiendo ubicación durante la solicitud #${liveLocationRequest.id}.`
            : 'Tu ubicación solo se comparte mientras tienes un servicio activo.'
        }
      >
        <Pressable
          style={[styles.connectionButton, mechanicConnection === 'online' ? styles.connectionOn : styles.connectionOff]}
          onPress={() => onToggleMechanicConnection(mechanicConnection === 'online' ? 'offline' : 'online')}
        >
          <Text style={styles.connectionButtonText}>
            {mechanicConnection === 'online' ? 'DESCONECTARME' : 'CONECTARME'}
          </Text>
        </Pressable>
      </Card>
    </Animated.View>
  );
}
