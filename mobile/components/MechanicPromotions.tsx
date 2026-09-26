import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, Field, Input, PrimaryButton, SecondaryButton, Segmented } from './ui';
import { formatDateOnly, formatError } from '../utils';
import type { ApiCall } from '../App';

type MyPromotion = {
  id: number;
  title: string;
  description: string;
  validUntil: string | null;
  isActive: boolean;
  isExpired: boolean;
};

// Vigencia con opciones en vez de escribir una fecha a mano.
const VALIDITY_OPTIONS = [
  { key: 'none', label: 'Sin fecha', days: null },
  { key: 'week', label: '1 semana', days: 7 },
  { key: 'month', label: '1 mes', days: 30 },
  { key: 'quarter', label: '3 meses', days: 90 },
] as const;

function dateInDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function promotionStatus(promotion: MyPromotion): { label: string; done: boolean; muted: boolean } {
  if (promotion.isExpired) return { label: 'Vencida', done: false, muted: true };
  if (!promotion.isActive) return { label: 'Pausada', done: false, muted: true };
  return { label: 'Activa', done: true, muted: false };
}

/** Promociones del propio mecánico: crear, pausar/activar y borrar. */
export function MechanicPromotions({ api, accountActive }: { api: ApiCall; accountActive: boolean }) {
  const { busy, setBusy, setMessage } = useAppContext();
  const [promotions, setPromotions] = useState<MyPromotion[] | null>(null);
  const [form, setForm] = useState({ title: '', description: '', validity: 'none' as (typeof VALIDITY_OPTIONS)[number]['key'] });

  async function load() {
    try {
      setPromotions((await api<{ promotions: MyPromotion[] }>('/api/promotions/mine')).promotions);
    } catch (error) {
      setMessage(formatError(error));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create() {
    if (form.title.trim().length < 5) {
      setMessage('Ponle un título a tu promoción (mínimo 5 letras)');
      return;
    }
    if (form.description.trim().length < 10) {
      setMessage('Explica la promoción en la descripción');
      return;
    }
    const days = VALIDITY_OPTIONS.find((option) => option.key === form.validity)?.days ?? null;
    setBusy(true);
    try {
      await api('/api/promotions', {
        method: 'POST',
        body: {
          title: form.title.trim(),
          description: form.description.trim(),
          ...(days ? { validUntil: dateInDays(days) } : {}),
        },
      });
      setForm({ title: '', description: '', validity: 'none' });
      setMessage('Promoción publicada');
      await load();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function setActive(promotion: MyPromotion, isActive: boolean) {
    try {
      await api(`/api/promotions/${promotion.id}`, { method: 'PATCH', body: { isActive } });
      setMessage(isActive ? 'Promoción activada' : 'Promoción pausada');
      await load();
    } catch (error) {
      setMessage(formatError(error));
    }
  }

  function remove(promotion: MyPromotion) {
    Alert.alert('¿Borrar esta promoción?', 'Los clientes ya no la verán.', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: async () => {
          try {
            await api(`/api/promotions/${promotion.id}`, { method: 'DELETE' });
            setMessage('Promoción borrada');
            await load();
          } catch (error) {
            setMessage(formatError(error));
          }
        },
      },
    ]);
  }

  return (
    <Card
      title="Tus promociones"
      subtitle={
        accountActive
          ? 'Los clientes cercanos las ven en Promociones y en tu perfil.'
          : 'Se mostrarán a los clientes en cuanto tu cuenta esté activa.'
      }
    >
      <View style={styles.stack}>
        {promotions === null ? (
          <ActivityIndicator color={colors.primary} />
        ) : promotions.length === 0 ? (
          <Text style={styles.smallText}>Todavía no publicas promociones.</Text>
        ) : (
          promotions.map((promotion) => {
            const status = promotionStatus(promotion);
            return (
              <View key={promotion.id} style={styles.item}>
                <Text style={styles.itemTitle}>{promotion.title}</Text>
                <Text style={styles.itemText}>{promotion.description}</Text>
                <View style={[styles.statusPill, status.done && styles.statusPillDone, status.muted && styles.statusPillMuted]}>
                  <Text
                    style={[styles.statusPillText, status.done && styles.statusPillTextDone, status.muted && styles.statusPillTextMuted]}
                  >
                    {status.label}
                    {promotion.validUntil ? ` · hasta el ${formatDateOnly(promotion.validUntil)}` : ''}
                  </Text>
                </View>
                <View style={styles.row}>
                  {!promotion.isExpired && (
                    <SecondaryButton
                      title={promotion.isActive ? 'Pausar' : 'Activar'}
                      compact
                      onPress={() => void setActive(promotion, !promotion.isActive)}
                    />
                  )}
                  <SecondaryButton title="Borrar" compact onPress={() => remove(promotion)} />
                </View>
              </View>
            );
          })
        )}

        <View style={styles.publicProfileBox}>
          <Text style={styles.publicProfileTitle}>Nueva promoción</Text>
          <Field label="Título">
            <Input
              value={form.title}
              maxLength={80}
              placeholder="Ej. Revisión de frenos gratis"
              onChangeText={(value) => setForm({ ...form, title: value })}
            />
          </Field>
          <Field label="¿En qué consiste?">
            <Input
              value={form.description}
              multiline
              maxLength={500}
              placeholder="Ej. Al contratar cualquier servicio conmigo, reviso tus frenos sin costo."
              onChangeText={(value) => setForm({ ...form, description: value })}
            />
          </Field>
          <Field label="¿Hasta cuándo?">
            <Segmented
              value={form.validity}
              options={VALIDITY_OPTIONS.map(({ key, label }) => ({ key, label }))}
              onChange={(value) => setForm({ ...form, validity: value as typeof form.validity })}
            />
          </Field>
        </View>
        <PrimaryButton title="Publicar promoción" busy={busy} onPress={() => void create()} />
      </View>
    </Card>
  );
}
