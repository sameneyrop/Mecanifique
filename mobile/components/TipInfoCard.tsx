import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, Field, InfoRow, Input, PrimaryButton, SecondaryButton } from './ui';
import { formatClabe, formatError } from '../utils';
import type { ApiCall } from '../App';

type TipInfo = { clabe: string | null; holderName: string | null };

/**
 * Datos del mecánico para recibir propina directa (opcional). Solo los ve el
 * cliente de un servicio que ya le terminó; Mecanifique no toca ese dinero.
 */
export function TipInfoCard({ api }: { api: ApiCall }) {
  const { busy, setBusy, setMessage } = useAppContext();
  const [saved, setSaved] = useState<TipInfo | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ clabe: '', holderName: '' });

  useEffect(() => {
    api<TipInfo>('/api/mechanics/me/tip-info')
      .then(setSaved)
      .catch((error) => setMessage(formatError(error)));
  }, []);

  async function save() {
    const clabe = form.clabe.replace(/\s/g, '');
    if (!/^\d{18}$/.test(clabe)) {
      setMessage('La CLABE tiene 18 dígitos. Revisa que esté completa.');
      return;
    }
    if (form.holderName.trim().length < 3) {
      setMessage('Escribe el nombre del titular de la cuenta');
      return;
    }
    setBusy(true);
    try {
      setSaved(await api<TipInfo>('/api/mechanics/me/tip-info', { method: 'PUT', body: { clabe, holderName: form.holderName.trim() } }));
      setEditing(false);
      setMessage('Listo: tus clientes ya pueden mandarte propina');
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      setSaved(await api<TipInfo>('/api/mechanics/me/tip-info', { method: 'DELETE' }));
      setMessage('Quitamos tu CLABE');
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Propinas"
      subtitle="Opcional. Si pones tu CLABE, tus clientes pueden mandarte propina directo al terminar el servicio. Mecanifique no cobra nada de ella."
    >
      {saved === null ? (
        <ActivityIndicator color={colors.primary} />
      ) : editing ? (
        <View style={styles.stack}>
          <Field label="CLABE interbancaria (18 dígitos)">
            <Input
              value={form.clabe}
              keyboardType="number-pad"
              maxLength={22}
              placeholder="000 000 00000000000 0"
              onChangeText={(value) => setForm({ ...form, clabe: value.replace(/[^0-9\s]/g, '') })}
            />
          </Field>
          <Field label="Nombre del titular">
            <Input
              value={form.holderName}
              placeholder="Como aparece en tu banco"
              onChangeText={(value) => setForm({ ...form, holderName: value })}
            />
          </Field>
          <Text style={styles.smallText}>Solo la ven los clientes a los que ya les terminaste un servicio.</Text>
          <PrimaryButton title="Guardar CLABE" busy={busy} onPress={save} />
          <SecondaryButton title="Cancelar" onPress={() => setEditing(false)} />
        </View>
      ) : !saved.clabe ? (
        <PrimaryButton title="Agregar mi CLABE" onPress={() => setEditing(true)} />
      ) : (
        <View style={styles.stack}>
          <InfoRow icon="card-outline" text={formatClabe(saved.clabe)} />
          {saved.holderName ? <InfoRow icon="person-outline" text={saved.holderName} /> : null}
          <SecondaryButton
            title="Cambiar"
            onPress={() => {
              setForm({ clabe: formatClabe(saved.clabe ?? ''), holderName: saved.holderName ?? '' });
              setEditing(true);
            }}
          />
          <SecondaryButton title="Quitar mi CLABE" busy={busy} onPress={remove} />
        </View>
      )}
    </Card>
  );
}
