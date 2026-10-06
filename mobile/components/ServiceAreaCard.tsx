import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, Field, Input, PrimaryButton, Segmented } from './ui';
import { formatError, placeKey } from '../utils';
import type { ApiCall } from '../App';

/**
 * Acciones → Mi perfil → Dónde das servicio (servidor: src/serviceAreas.ts).
 * - Ciudad y zona de su taller: lo que se ve en su perfil.
 * - Municipios donde también atiende: los clientes de ahí lo encuentran al
 *   buscar en Mecánicos. Su ciudad siempre cuenta.
 * - Hasta dónde va por un "Ahora mismo": la solicitud le llega si el auto está
 *   a esa distancia o menos de donde está él (antes eran 25 km para todos).
 */

type ServiceArea = {
  city: string;
  zone: string;
  serviceAreas: string[];
  serviceRadiusKm: number;
  municipalities: string[];
  radiusOptions: number[];
};

type Form = { city: string; zone: string; areas: string[]; radius: number };

const STATE_RADIUS_KM = 100;

function radiusLabel(km: number): string {
  return km >= STATE_RADIUS_KM ? 'Todo el estado' : `${km} km`;
}

export function ServiceAreaCard({ api }: { api: ApiCall }) {
  const { busy, setBusy, setMessage } = useAppContext();
  const [data, setData] = useState<ServiceArea | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const apiRef = useRef(api);
  apiRef.current = api;

  function load(area: ServiceArea) {
    setData(area);
    setForm({ city: area.city, zone: area.zone, areas: area.serviceAreas, radius: area.serviceRadiusKm });
  }

  useEffect(() => {
    apiRef
      .current<ServiceArea>('/api/mechanics/me/service-area')
      .then(load)
      .catch((error) => setMessage(formatError(error)));
  }, []);

  if (!data || !form) {
    return (
      <Card title="Dónde das servicio">
        <ActivityIndicator color={colors.primary} />
      </Card>
    );
  }

  // Su ciudad siempre cuenta: su municipio sale marcado y no se puede quitar.
  const homeMunicipality = data.municipalities.find((name) => placeKey(name) === placeKey(form.city)) ?? null;
  const covers = (name: string) => name === homeMunicipality || form.areas.includes(name);
  const wholeState = data.municipalities.every(covers);

  function toggle(name: string) {
    if (!form || name === homeMunicipality) return;
    setForm({ ...form, areas: form.areas.includes(name) ? form.areas.filter((area) => area !== name) : [...form.areas, name] });
  }

  function toggleWholeState() {
    if (!form || !data) return;
    setForm(
      wholeState
        ? { ...form, areas: [] }
        : // Si atiende en todo el estado, lo normal es que también vaya lejos por un "Ahora mismo".
          { ...form, areas: [...data.municipalities], radius: Math.max(form.radius, STATE_RADIUS_KM) },
    );
  }

  async function save() {
    if (!form) return;
    if (form.city.trim().length < 2 || form.zone.trim().length < 2) {
      setMessage('Escribe la ciudad y la zona de tu taller.');
      return;
    }
    setBusy(true);
    try {
      load(
        await apiRef.current<ServiceArea>('/api/mechanics/me/service-area', {
          method: 'PUT',
          body: {
            city: form.city.trim(),
            zone: form.zone.trim(),
            // Si con su ciudad ya cubre todos, se guardan todos: así se lee "Todo el estado".
            serviceAreas: wholeState ? data?.municipalities ?? form.areas : form.areas,
            serviceRadiusKm: form.radius,
          },
        }),
      );
      setMessage('Listo: guardamos dónde das servicio');
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  const chip = (label: string, active: boolean, onPress: () => void, locked = false) => (
    <Pressable
      key={label}
      style={({ pressed }) => [styles.categoryChip, active && styles.categoryChipActive, pressed && !locked && styles.buttonPressed]}
      onPress={onPress}
      disabled={locked}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active, disabled: locked }}
      accessibilityHint={locked ? 'Es la ciudad de tu taller: siempre cuenta' : undefined}
    >
      {active ? <Ionicons name={locked ? 'home' : 'checkmark'} size={15} color={colors.primaryDark} /> : null}
      <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>{label}</Text>
    </Pressable>
  );

  return (
    <Card title="Dónde das servicio">
      <View style={styles.stack}>
        <View style={styles.row}>
          <Field label="Ciudad o municipio" style={styles.flex}>
            <Input value={form.city} maxLength={60} onChangeText={(value) => setForm({ ...form, city: value })} />
          </Field>
          <Field label="Zona" style={styles.flex}>
            <Input value={form.zone} maxLength={60} placeholder="Ej. Sur" onChangeText={(value) => setForm({ ...form, zone: value })} />
          </Field>
        </View>

        <Text style={styles.label}>¿En qué municipios atiendes?</Text>
        <View style={styles.chipWrap}>
          {chip('Todo el estado', wholeState, toggleWholeState)}
          {data.municipalities.map((name) => chip(name, covers(name), () => toggle(name), name === homeMunicipality))}
        </View>

        <Text style={styles.label}>¿Hasta dónde vas por un servicio de «Ahora mismo»?</Text>
        <Segmented
          value={String(form.radius)}
          options={data.radiusOptions.map((km) => ({ key: String(km), label: radiusLabel(km) }))}
          onChange={(value) => setForm({ ...form, radius: Number(value) })}
        />
        <Text style={styles.smallText}>
          Te llegan las que estén a esta distancia o menos de donde estás.
        </Text>

        <PrimaryButton title="Guardar dónde das servicio" busy={busy} onPress={save} />
      </View>
    </Card>
  );
}
