import { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';

import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, InfoRow, PrimaryButton, SecondaryButton, Segmented } from './ui';
import { formatError, formatServerDate } from '../utils';
import type { ApiCall } from '../App';

/**
 * Acciones → Lista de espera (solo admin): quién se registró en el sitio
 * (servidor: /api/admin/waitlist). Primero los que faltan de contactar; un
 * botón abre WhatsApp o el correo con un saludo que se puede editar antes de
 * mandarlo, y "Ya le escribí" lo marca para no escribirle dos veces.
 */

type Signup = {
  id: number;
  role: 'customer' | 'mechanic';
  name: string | null;
  contact: string;
  contactKey: string;
  city: string | null;
  createdAt: string;
  contactedAt: string | null;
};

type Filter = 'all' | 'customer' | 'mechanic';

const PAGE_SIZE = 20;

/** Número para wa.me: 10 dígitos de México llevan 52 adelante. */
function whatsappNumber(contactKey: string): string | null {
  if (!/^\d+$/.test(contactKey)) return null;
  if (contactKey.length === 10) return `52${contactKey}`;
  return contactKey.length >= 11 ? contactKey : null;
}

function greeting(signup: Signup): string {
  const firstName = signup.name?.trim().split(/\s+/)[0];
  return `Hola${firstName ? ` ${firstName}` : ''}, te escribo de Mecanifique porque te registraste en nuestra lista de espera.`;
}

export function AdminWaitlistCard({ api }: { api: ApiCall }) {
  const { busy, setBusy, setMessage } = useAppContext();
  const [signups, setSignups] = useState<Signup[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);

  const load = useCallback(() => {
    api<{ signups: Signup[] }>('/api/admin/waitlist')
      .then((data) => setSignups(data.signups))
      .catch(() => setSignups([]));
  }, [api]);
  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const list = (signups ?? []).filter((signup) => filter === 'all' || signup.role === filter);
    // Sin contactar primero; dentro de cada grupo, el más reciente arriba (así llega del servidor).
    return [...list].sort((a, b) => Number(Boolean(a.contactedAt)) - Number(Boolean(b.contactedAt)));
  }, [signups, filter]);

  const pending = (signups ?? []).filter((signup) => !signup.contactedAt).length;
  const customers = (signups ?? []).filter((signup) => signup.role === 'customer').length;
  const mechanics = (signups ?? []).length - customers;

  function openContact(signup: Signup) {
    const phone = whatsappNumber(signup.contactKey);
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(greeting(signup))}`
      : `mailto:${signup.contact}?subject=${encodeURIComponent('Mecanifique')}&body=${encodeURIComponent(greeting(signup))}`;
    Linking.openURL(url).catch(() => setMessage('No se pudo abrir. Copia el contacto y escríbele desde tu teléfono.'));
  }

  async function copyContact(signup: Signup) {
    await Clipboard.setStringAsync(signup.contact);
    setMessage('Contacto copiado');
  }

  async function setContacted(signup: Signup, contacted: boolean) {
    setBusy(true);
    try {
      await api(`/api/admin/waitlist/${signup.id}/contacted`, { method: 'POST', body: { contacted } });
      load();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove(signup: Signup) {
    setBusy(true);
    try {
      await api(`/api/admin/waitlist/${signup.id}`, { method: 'DELETE' });
      setConfirmingDelete(null);
      setMessage(`${signup.name || signup.contact} ya no está en la lista.`);
      load();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  const subtitle = !signups
    ? undefined
    : signups.length === 0
      ? 'Todavía nadie se registra en el sitio.'
      : `${signups.length} registro${signups.length === 1 ? '' : 's'} · ${pending} sin contactar`;

  return (
    <Card title="Lista de espera" subtitle={subtitle}>
      {!signups ? (
        <Text style={styles.smallText}>Cargando…</Text>
      ) : signups.length === 0 ? null : (
        <View style={styles.stack}>
          <Segmented
            value={filter}
            options={[
              { key: 'all', label: `Todos (${signups.length})` },
              { key: 'customer', label: `Clientes (${customers})` },
              { key: 'mechanic', label: `Mecánicos (${mechanics})` },
            ]}
            onChange={(value) => {
              setFilter(value as Filter);
              setVisible(PAGE_SIZE);
            }}
          />
          <View style={styles.list}>
            {shown.slice(0, visible).map((signup) => {
              const isPhone = Boolean(whatsappNumber(signup.contactKey));
              return (
                <View key={signup.id} style={styles.item}>
                  <Text style={styles.itemTitle}>{signup.name || 'Sin nombre'}</Text>
                  <InfoRow
                    icon={signup.role === 'mechanic' ? 'construct-outline' : 'car-sport-outline'}
                    text={`${signup.role === 'mechanic' ? 'Mecánico' : 'Cliente'}${signup.city ? ` · ${signup.city}` : ''}`}
                  />
                  <InfoRow icon={isPhone ? 'call-outline' : 'mail-outline'} text={signup.contact} />
                  <Text style={styles.smallText}>
                    Se registró: {formatServerDate(signup.createdAt)}
                    {signup.contactedAt ? ` · Le escribiste: ${formatServerDate(signup.contactedAt)}` : ''}
                  </Text>
                  <View style={styles.row}>
                    <SecondaryButton
                      title={isPhone ? 'WhatsApp' : 'Correo'}
                      compact
                      onPress={() => openContact(signup)}
                    />
                    <SecondaryButton title="Copiar" compact onPress={() => void copyContact(signup)} />
                    <SecondaryButton
                      title={signup.contactedAt ? 'Desmarcar' : 'Ya le escribí'}
                      compact
                      busy={busy}
                      onPress={() => void setContacted(signup, !signup.contactedAt)}
                    />
                  </View>
                  {confirmingDelete === signup.id ? (
                    <View style={styles.stack}>
                      <Text style={styles.smallText}>
                        Quítalo solo si te pidió que borres sus datos. No se puede deshacer.
                      </Text>
                      <View style={styles.row}>
                        <PrimaryButton title="Sí, quitar" busy={busy} onPress={() => void remove(signup)} />
                        <SecondaryButton title="Cancelar" compact onPress={() => setConfirmingDelete(null)} />
                      </View>
                    </View>
                  ) : (
                    <Text
                      style={[styles.textLink, styles.smallText]}
                      onPress={() => setConfirmingDelete(signup.id)}
                      accessibilityRole="button"
                    >
                      Quitar de la lista
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
          {shown.length > visible && (
            <SecondaryButton
              title={`Ver más (${shown.length - visible})`}
              onPress={() => setVisible((count) => count + PAGE_SIZE)}
            />
          )}
        </View>
      )}
    </Card>
  );
}
