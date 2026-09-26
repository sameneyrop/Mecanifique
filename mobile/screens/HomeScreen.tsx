import { type Dispatch, type SetStateAction, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, Field, Input, PrimaryButton } from '../components/ui';

type RequestFormShape = {
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: string;
  issueDescription: string;
  preferredTime: string;
  city: string;
  zone: string;
  serviceAddress: string;
  customerId: string;
  requestedMechanicId: string;
  scheduleSlotId: string;
  latitude: string;
  longitude: string;
};

const TRUST_BADGES: Array<{ icon: keyof typeof Ionicons.glyphMap; label: string }> = [
  { icon: 'shield-checkmark-outline', label: 'Mecánicos verificados' },
  { icon: 'star-outline', label: 'Experiencia comprobada' },
  { icon: 'location-outline', label: 'Llegada rápida' },
  { icon: 'ribbon-outline', label: 'Garantía real' },
];

function TrustBadge({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.trustBadge}>
      <Ionicons name={icon} size={20} color={colors.primary} />
      <Text style={styles.trustBadgeText}>{label}</Text>
    </View>
  );
}

function CustomerHome({
  requestForm,
  setRequestForm,
}: {
  requestForm: RequestFormShape;
  setRequestForm: Dispatch<SetStateAction<RequestFormShape>>;
}) {
  const { user, setCurrentScreen, setRequestsView, setRequestCreateStep, setMessage } = useAppContext();
  const [when, setWhen] = useState<'now' | 'schedule'>('now');

  function handleSearch() {
    setRequestCreateStep('vehicle');
    setRequestsView('create');
    setCurrentScreen('requests');
    if (when === 'schedule') {
      setMessage('Ahora indica cuándo prefieres el servicio');
    }
  }

  return (
    <View style={styles.stack}>
      <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
        {/* PLACEHOLDER: reemplazar por ilustración de marca final (mascota) */}
        <View style={styles.heroPlaceholder}>
          <Ionicons name="car-sport-outline" size={40} color={colors.primary} />
        </View>
        <Text style={styles.title}>Tu auto, en buenas manos</Text>
        <Text style={styles.subtitle}>
          Encuentra mecánicos verificados, cerca de ti o agenda para cuando lo necesites.
        </Text>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(90).duration(300)} needsOffscreenAlphaCompositing>
        <View style={styles.trustRow}>
          {TRUST_BADGES.map((badge) => (
            <TrustBadge key={badge.label} icon={badge.icon} label={badge.label} />
          ))}
        </View>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(180).duration(300)} needsOffscreenAlphaCompositing>
        <Card title="Busca un mecánico" subtitle="Escribe tu ciudad y zona para encontrarte el mejor servicio.">
          <View style={styles.stack}>
            <View style={styles.row}>
              <Field label="Ciudad" style={styles.flex}>
                <Input value={requestForm.city} onChangeText={(value) => setRequestForm((current) => ({ ...current, city: value }))} />
              </Field>
              <Field label="Zona" style={styles.flex}>
                <Input value={requestForm.zone} onChangeText={(value) => setRequestForm((current) => ({ ...current, zone: value }))} />
              </Field>
            </View>
            <View style={styles.row}>
              <Pressable
                style={[styles.whenOption, when === 'now' && styles.whenOptionActive, styles.flex]}
                onPress={() => setWhen('now')}
              >
                <Ionicons name="flash-outline" size={18} color={when === 'now' ? colors.primary : colors.textSecondary} />
                <Text style={[styles.whenOptionTitle, when === 'now' && styles.whenOptionTitleActive]}>Ahora mismo</Text>
                <Text style={styles.smallText}>Un mecánico cerca de ti, listo para ayudarte.</Text>
              </Pressable>
              <Pressable
                style={[styles.whenOption, when === 'schedule' && styles.whenOptionActive, styles.flex]}
                onPress={() => setWhen('schedule')}
              >
                <Ionicons name="calendar-outline" size={18} color={when === 'schedule' ? colors.primary : colors.textSecondary} />
                <Text style={[styles.whenOptionTitle, when === 'schedule' && styles.whenOptionTitleActive]}>Agendar fecha</Text>
                <Text style={styles.smallText}>Elige el día y la hora que prefieras.</Text>
              </Pressable>
            </View>
            <PrimaryButton title="Buscar" onPress={handleSearch} />
          </View>
        </Card>
      </Animated.View>

      {!user?.mechanicId && (
        <Animated.View entering={FadeInDown.delay(240).duration(300)} needsOffscreenAlphaCompositing>
          <Pressable style={styles.mechanicBanner} onPress={() => setCurrentScreen('account')}>
            <Ionicons name="construct-outline" size={22} color={colors.white} />
            <View style={styles.flex}>
              <Text style={styles.mechanicBannerTitle}>¿Eres mecánico?</Text>
              <Text style={styles.mechanicBannerText}>Únete a nuestra red y recibe solicitudes de clientes en tu zona.</Text>
            </View>
            <Ionicons name="arrow-forward" size={18} color={colors.white} />
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

export function HomeScreen({
  requestForm,
  setRequestForm,
  onToggleMechanicConnection,
}: {
  requestForm: RequestFormShape;
  setRequestForm: Dispatch<SetStateAction<RequestFormShape>>;
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

  if (user.role !== 'mechanic') {
    return <CustomerHome requestForm={requestForm} setRequestForm={setRequestForm} />;
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
