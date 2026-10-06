import { useEffect, useRef, useState } from 'react';
import { Pressable, Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, Field, InfoRow, Input, PrimaryButton, Segmented, SecondaryButton } from './ui';
import { formatError, formatServerDate } from '../utils';
import type { ApiCall } from '../App';

/**
 * Acciones → Mostrador (solo admin; servidor: src/routes/mostrador.ts). Las
 * refaccionarias entran al Mostrador solo por invitación: se elige la tienda
 * del directorio (o se da de alta), se escribe el correo de quien lo va a usar
 * y se le manda el enlace. Con él crea su cuenta en mecanifique.vercel.app/mostrador.
 */

type AdminStore = {
  id: number;
  name: string;
  zone: string | null;
  enabled: boolean;
  members: Array<{ name: string; role: string }>;
  invitations: Array<{ id: number; email: string; expiresAt: string }>;
};

type DirectoryStore = { id: number; name: string; zone: string | null; address: string | null; enabled: boolean };

export function AdminMostradorCard({ api }: { api: ApiCall }) {
  const { busy, setBusy, setMessage } = useAppContext();
  const [stores, setStores] = useState<AdminStore[] | null>(null);
  const [inviting, setInviting] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DirectoryStore[]>([]);
  const [selected, setSelected] = useState<{ id: number; name: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newStore, setNewStore] = useState({ name: '', phone: '', zone: '', address: '' });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'owner' | 'staff'>('owner');
  const [link, setLink] = useState<{ url: string; storeName: string; expiresAt: string } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<number | null>(null);
  const apiRef = useRef(api);
  apiRef.current = api;

  function load() {
    apiRef
      .current<{ stores: AdminStore[] }>('/api/admin/mostrador/stores')
      .then((data) => setStores(data.stores))
      .catch(() => setStores([]));
  }
  useEffect(load, []);

  // Busca en el directorio mientras escribe (con una pausa para no pedir en cada letra).
  useEffect(() => {
    if (!inviting || selected) return;
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      apiRef
        .current<{ stores: DirectoryStore[] }>(`/api/admin/mostrador/directory?q=${encodeURIComponent(term)}`)
        .then((data) => setResults(data.stores))
        .catch(() => setResults([]));
    }, 350);
    return () => clearTimeout(timer);
  }, [query, inviting, selected]);

  function reset() {
    setInviting(false);
    setQuery('');
    setResults([]);
    setSelected(null);
    setCreating(false);
    setNewStore({ name: '', phone: '', zone: '', address: '' });
    setEmail('');
    setRole('owner');
  }

  async function createStore() {
    if (newStore.name.trim().length < 3) {
      setMessage('Escribe el nombre de la refaccionaria.');
      return;
    }
    setBusy(true);
    try {
      const created = await apiRef.current<{ id: number; name: string }>('/api/admin/mostrador/stores', {
        method: 'POST',
        body: {
          name: newStore.name.trim(),
          phone: newStore.phone.trim() || undefined,
          zone: newStore.zone.trim() || undefined,
          address: newStore.address.trim() || undefined,
        },
      });
      setSelected(created);
      setCreating(false);
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function invite() {
    if (!selected) return;
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setMessage('Escribe el correo de quien va a usar el Mostrador.');
      return;
    }
    setBusy(true);
    try {
      const created = await apiRef.current<{ id: number; link: string; expiresAt: string }>('/api/admin/mostrador/invitations', {
        method: 'POST',
        body: { storeId: selected.id, email: email.trim().toLowerCase(), role },
      });
      setLink({ url: created.link, storeName: selected.name, expiresAt: created.expiresAt });
      reset();
      load();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(invitationId: number) {
    setBusy(true);
    try {
      await apiRef.current(`/api/admin/mostrador/invitations/${invitationId}`, { method: 'DELETE' });
      setConfirmRevoke(null);
      setMessage('Invitación cancelada: ese enlace ya no sirve.');
      load();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  const inviteText = link
    ? `Hola, te invito al Mostrador de Mecanifique para ${link.storeName}: ahí te llegan los mecánicos que buscan piezas cerca de tu tienda. Crea tu cuenta con este enlace (vence en 14 días): ${link.url}`
    : '';

  return (
    <Card
      title="Mostrador"
      subtitle="Refaccionarias que contestan a los mecánicos desde mecanifique.vercel.app/mostrador. Entran solo con tu invitación."
    >
      <View style={styles.stack}>
        {link ? (
          <View style={styles.partHoldBox}>
            <Text style={styles.partHoldTitle}>Invitación lista para {link.storeName}</Text>
            <Text style={styles.smallText} selectable>
              {link.url}
            </Text>
            <Text style={styles.smallText}>
              Mándasela a esa persona nada más: con el enlace crea su cuenta. Sirve una vez y vence en 14 días.
            </Text>
            <View style={styles.row}>
              <SecondaryButton
                title="Compartir"
                compact
                onPress={() => void Share.share({ message: inviteText }).catch(() => setMessage('No se pudo compartir.'))}
              />
              <SecondaryButton
                title="Copiar enlace"
                compact
                onPress={() =>
                  void Clipboard.setStringAsync(link.url)
                    .then(() => setMessage('Enlace copiado.'))
                    .catch(() => setMessage('No se pudo copiar.'))
                }
              />
              <SecondaryButton title="Listo" compact onPress={() => setLink(null)} />
            </View>
          </View>
        ) : null}

        {stores === null ? (
          <Text style={styles.smallText}>Cargando…</Text>
        ) : stores.length === 0 ? (
          <Text style={styles.itemText}>Todavía no has invitado a ninguna refaccionaria.</Text>
        ) : (
          <View style={styles.list}>
            {stores.map((store) => (
              <View key={store.id} style={styles.item}>
                <Text style={styles.itemTitle}>{store.name}</Text>
                <Text style={styles.smallText}>
                  {[store.zone, store.enabled ? 'En el Mostrador' : 'Invitada, sin entrar todavía'].filter(Boolean).join(' · ')}
                </Text>
                {store.members.map((member, index) => (
                  <InfoRow
                    key={`${member.name}-${index}`}
                    icon="person-outline"
                    text={`${member.name} · ${member.role === 'owner' ? 'Dueño o encargado' : 'Empleado'}`}
                  />
                ))}
                {store.invitations.map((invitation) => (
                  <View key={invitation.id} style={styles.stack}>
                    <InfoRow icon="mail-outline" text={`Invitación a ${invitation.email} · vence ${formatServerDate(invitation.expiresAt)}`} lines={2} />
                    {confirmRevoke === invitation.id ? (
                      <View style={styles.row}>
                        <SecondaryButton title="Sí, cancelarla" compact busy={busy} onPress={() => void revoke(invitation.id)} />
                        <SecondaryButton title="No" compact onPress={() => setConfirmRevoke(null)} />
                      </View>
                    ) : (
                      <Text style={[styles.textLink, styles.smallText]} onPress={() => setConfirmRevoke(invitation.id)} accessibilityRole="button">
                        Cancelar invitación
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}

        {!inviting ? (
          <PrimaryButton title="Invitar una refaccionaria" onPress={() => setInviting(true)} />
        ) : (
          <View style={styles.publicProfileBox}>
            <Text style={styles.publicProfileTitle}>Invitar una refaccionaria</Text>
            {selected ? (
              <>
                <InfoRow icon="storefront-outline" text={selected.name} />
                <Text style={[styles.textLink, styles.smallText]} onPress={() => setSelected(null)} accessibilityRole="button">
                  Elegir otra
                </Text>
                <Field label="Correo de quien la va a usar">
                  <Input
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={120}
                    placeholder="encargado@refaccionaria.com"
                  />
                </Field>
                <Segmented
                  value={role}
                  options={[
                    { key: 'owner', label: 'Dueño o encargado' },
                    { key: 'staff', label: 'Empleado' },
                  ]}
                  onChange={(value) => setRole(value as 'owner' | 'staff')}
                />
                <PrimaryButton title="Crear invitación" busy={busy} onPress={() => void invite()} />
              </>
            ) : creating ? (
              <>
                <Field label="Nombre">
                  <Input value={newStore.name} maxLength={120} onChangeText={(value) => setNewStore({ ...newStore, name: value })} />
                </Field>
                <Field label="Teléfono (opcional)">
                  <Input
                    value={newStore.phone}
                    keyboardType="phone-pad"
                    maxLength={30}
                    onChangeText={(value) => setNewStore({ ...newStore, phone: value })}
                  />
                </Field>
                <Field label="Zona (opcional)">
                  <Input value={newStore.zone} maxLength={80} placeholder="Ej. Sur" onChangeText={(value) => setNewStore({ ...newStore, zone: value })} />
                </Field>
                <Field label="Dirección (opcional)">
                  <Input value={newStore.address} maxLength={200} onChangeText={(value) => setNewStore({ ...newStore, address: value })} />
                </Field>
                <Text style={styles.smallText}>También aparece en la lista de refaccionarias de los mecánicos. Su ubicación la pone la tienda al entrar.</Text>
                <PrimaryButton title="Darla de alta" busy={busy} onPress={() => void createStore()} />
                <SecondaryButton title="Regresar a buscar" compact onPress={() => setCreating(false)} />
              </>
            ) : (
              <>
                <Field label="Buscar en el directorio">
                  <Input value={query} maxLength={60} placeholder="Nombre, zona o calle" onChangeText={setQuery} autoCorrect={false} />
                </Field>
                {results.map((store) => (
                  <Pressable
                    key={store.id}
                    style={({ pressed }) => [styles.item, pressed && styles.buttonPressed]}
                    onPress={() => setSelected({ id: store.id, name: store.name })}
                    accessibilityRole="button"
                  >
                    <Text style={styles.itemTitle}>{store.name}</Text>
                    <Text style={styles.smallText}>
                      {[store.zone, store.address, store.enabled ? 'Ya está en el Mostrador' : null].filter(Boolean).join(' · ')}
                    </Text>
                  </Pressable>
                ))}
                {query.trim().length >= 2 && results.length === 0 ? (
                  <Text style={styles.smallText}>No la encontramos en el directorio.</Text>
                ) : null}
                <Text style={[styles.textLink, styles.smallText]} onPress={() => setCreating(true)} accessibilityRole="button">
                  ¿No está? Darla de alta
                </Text>
              </>
            )}
            <SecondaryButton title="Cancelar" compact onPress={reset} />
          </View>
        )}
      </View>
    </Card>
  );
}
