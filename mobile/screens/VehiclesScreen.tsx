import { useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, EmptyState, Field, InfoRow, Input, PrimaryButton, Segmented, SecondaryButton } from '../components/ui';

const ENGINE_OPTIONS = [
  { key: 'gasolina', label: 'Gasolina', icon: 'water-outline' as const },
  { key: 'diesel', label: 'Diésel', icon: 'water-outline' as const },
  { key: 'hibrido', label: 'Híbrido', icon: 'leaf-outline' as const },
  { key: 'electrico', label: 'Eléctrico', icon: 'flash-outline' as const },
];

const TRANSMISSION_OPTIONS = [
  { key: 'manual', label: 'Manual' },
  { key: 'automatica', label: 'Automática' },
  { key: 'doble_embrague', label: 'Doble embrague' },
  { key: 'cvt', label: 'CVT' },
];

const ENGINE_LABELS: Record<string, string> = Object.fromEntries(ENGINE_OPTIONS.map((o) => [o.key, o.label]));
const TRANSMISSION_LABELS: Record<string, string> = Object.fromEntries(
  TRANSMISSION_OPTIONS.map((o) => [o.key, o.label]),
);

type NewVehicleForm = {
  nickname: string;
  make: string;
  model: string;
  year: string;
  engineType: string;
  transmissionType: string;
  color: string;
  licensePlate: string;
};

const EMPTY_FORM: NewVehicleForm = {
  nickname: '',
  make: '',
  model: '',
  year: '',
  engineType: 'gasolina',
  transmissionType: 'manual',
  color: '',
  licensePlate: '',
};

export function VehiclesScreen({
  onAddVehicle,
  onSetPrimaryVehicle,
}: {
  onAddVehicle: (payload: {
    nickname?: string;
    make: string;
    model: string;
    year: number;
    engineType?: string;
    transmissionType?: string;
    color?: string;
    licensePlate?: string;
  }) => Promise<void>;
  onSetPrimaryVehicle: (vehicleId: number) => Promise<void>;
}) {
  const { vehicles, busy } = useAppContext();
  const [showForm, setShowForm] = useState(vehicles.length === 0);
  const [form, setForm] = useState<NewVehicleForm>(EMPTY_FORM);

  const canSave = form.make.trim().length >= 2 && form.model.trim().length >= 1 && /^\d{4}$/.test(form.year);

  async function handleSave() {
    if (!canSave) return;
    await onAddVehicle({
      nickname: form.nickname.trim() || undefined,
      make: form.make.trim(),
      model: form.model.trim(),
      year: Number(form.year),
      engineType: form.engineType,
      transmissionType: form.transmissionType,
      color: form.color.trim() || undefined,
      licensePlate: form.licensePlate.trim() || undefined,
    });
    setForm(EMPTY_FORM);
    setShowForm(false);
  }

  return (
    <View style={styles.screenStack}>
      {vehicles.length === 0 && !showForm && (
        <Animated.View entering={FadeInDown.duration(300)}>
          <Card title="Tus vehículos">
            <EmptyState
              icon="car-sport-outline"
              title="Todavía no tienes vehículos"
              text="Guárdalo para no escribirlo cada vez que pidas un servicio."
            >
              <PrimaryButton title="Agregar vehículo" onPress={() => setShowForm(true)} />
            </EmptyState>
          </Card>
        </Animated.View>
      )}

      {vehicles.map((vehicle, index) => (
        <Animated.View key={vehicle.id} entering={FadeInDown.delay(index * 60).duration(300)}>
          <Card
            title={vehicle.nickname || `${vehicle.make} ${vehicle.model}`}
            subtitle={`${vehicle.make} ${vehicle.model} ${vehicle.year}`}
          >
            <View style={styles.stack}>
              {vehicle.isPrimary && (
                <View style={styles.statusPill}>
                  <Text style={styles.statusPillText}>Vehículo principal</Text>
                </View>
              )}
              {vehicle.engineType && (
                <InfoRow icon="flash-outline" text={`Motor ${ENGINE_LABELS[vehicle.engineType] || vehicle.engineType}`} />
              )}
              {vehicle.transmissionType && (
                <InfoRow
                  icon="cog-outline"
                  text={`Transmisión ${TRANSMISSION_LABELS[vehicle.transmissionType] || vehicle.transmissionType}`}
                />
              )}
              {vehicle.color && <InfoRow icon="color-palette-outline" text={vehicle.color} />}
              {vehicle.licensePlate && <InfoRow icon="card-outline" text={`Placa ${vehicle.licensePlate}`} />}
              {!vehicle.isPrimary && (
                <SecondaryButton
                  title="Marcar como principal"
                  compact
                  busy={busy}
                  onPress={() => onSetPrimaryVehicle(vehicle.id)}
                />
              )}
            </View>
          </Card>
        </Animated.View>
      ))}

      {vehicles.length > 0 && !showForm && (
        <SecondaryButton title="Agregar otro vehículo" onPress={() => setShowForm(true)} />
      )}

      {showForm && (
        <Animated.View entering={FadeInDown.duration(220)}>
          <Card title="Agregar vehículo" subtitle="Solo marca, modelo y año son obligatorios.">
            <View style={styles.stack}>
              <Field label="Alias (opcional)">
                <Input
                  value={form.nickname}
                  onChangeText={(value) => setForm({ ...form, nickname: value })}
                  placeholder="Ej. El diario"
                />
              </Field>
              <View style={styles.row}>
                <Field label="Marca" style={styles.flex}>
                  <Input value={form.make} onChangeText={(value) => setForm({ ...form, make: value })} placeholder="Nissan" />
                </Field>
                <Field label="Modelo" style={styles.flex}>
                  <Input value={form.model} onChangeText={(value) => setForm({ ...form, model: value })} placeholder="Versa" />
                </Field>
              </View>
              <Field label="Año">
                <Input
                  value={form.year}
                  onChangeText={(value) => setForm({ ...form, year: value })}
                  keyboardType="numeric"
                  maxLength={4}
                  placeholder="2020"
                />
              </Field>
              <Field label="Tipo de motor">
                <Segmented
                  value={form.engineType}
                  options={ENGINE_OPTIONS}
                  onChange={(value) => setForm({ ...form, engineType: value })}
                />
              </Field>
              <Field label="Tipo de transmisión">
                <Segmented
                  value={form.transmissionType}
                  options={TRANSMISSION_OPTIONS}
                  onChange={(value) => setForm({ ...form, transmissionType: value })}
                />
              </Field>
              <View style={styles.row}>
                <Field label="Color" style={styles.flex}>
                  <Input value={form.color} onChangeText={(value) => setForm({ ...form, color: value })} placeholder="Blanco" />
                </Field>
                <Field label="Placa" style={styles.flex}>
                  <Input
                    value={form.licensePlate}
                    onChangeText={(value) => setForm({ ...form, licensePlate: value })}
                    autoCapitalize="characters"
                    placeholder="ABC1234"
                  />
                </Field>
              </View>
              {vehicles.length > 0 && <SecondaryButton title="Cancelar" onPress={() => setShowForm(false)} />}
              <PrimaryButton title="Guardar vehículo" onPress={handleSave} busy={busy} />
            </View>
          </Card>
        </Animated.View>
      )}
    </View>
  );
}
