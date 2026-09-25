import { useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, Field, Input, PrimaryButton, Segmented, SecondaryButton } from '../components/ui';

const ENGINE_OPTIONS = [
  { key: 'gasolina', label: 'Gasolina' },
  { key: 'diesel', label: 'Diésel' },
  { key: 'hibrido', label: 'Híbrido' },
  { key: 'electrico', label: 'Eléctrico' },
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
    <View style={styles.stack}>
      {vehicles.length === 0 && !showForm && (
        <Animated.View entering={FadeInDown.duration(300)}>
          <Card title="Todavía no tienes vehículos" subtitle="Agrega uno para poder pedir un servicio">
            <PrimaryButton title="Agregar vehículo" onPress={() => setShowForm(true)} />
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
                <View style={styles.row}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
                  <Text style={[styles.itemText, { color: colors.primary }]}>Vehículo principal</Text>
                </View>
              )}
              {vehicle.engineType && (
                <Text style={styles.itemText}>Motor: {ENGINE_LABELS[vehicle.engineType] || vehicle.engineType}</Text>
              )}
              {vehicle.transmissionType && (
                <Text style={styles.itemText}>
                  Transmisión: {TRANSMISSION_LABELS[vehicle.transmissionType] || vehicle.transmissionType}
                </Text>
              )}
              {vehicle.color && <Text style={styles.itemText}>Color: {vehicle.color}</Text>}
              {vehicle.licensePlate && <Text style={styles.smallText}>Placa: {vehicle.licensePlate}</Text>}
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
        <SecondaryButton title="+ Agregar vehículo" onPress={() => setShowForm(true)} />
      )}

      {showForm && (
        <Animated.View entering={FadeInDown.duration(220)}>
          <Card title="Agregar vehículo">
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
              <PrimaryButton title="Guardar" onPress={handleSave} busy={busy} />
              {vehicles.length > 0 && <SecondaryButton title="Cancelar" onPress={() => setShowForm(false)} />}
            </View>
          </Card>
        </Animated.View>
      )}
    </View>
  );
}
