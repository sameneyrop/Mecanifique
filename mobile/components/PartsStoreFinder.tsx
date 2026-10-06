import { useEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, Field, InfoRow, Input, PrimaryButton, SecondaryButton } from './ui';
import { AskStoresBox, MyPartRequests } from './PartRequests';
import { formatError, formatServerDate, openServiceNavigation, vehicleWords } from '../utils';
import type { ApiCall } from '../App';

/**
 * Buscar la pieza en refaccionarias (servidor: src/partsStores.ts). Las más
 * cercanas al auto primero; con un toque se manda por WhatsApp "¿tienen tal
 * pieza para tal auto?" con los datos del servicio, o se llama. El mecánico
 * marca "sí tenían la pieza" y puede sugerir tiendas que no estén.
 * Si hay refaccionarias de Mostrador cerca, además le puede preguntar a todas
 * de un jalón y apartar la respuesta (components/PartRequests.tsx).
 */

type Store = {
  id: number;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  zone: string | null;
  city: string;
  latitude: number | null;
  longitude: number | null;
  hours: string | null;
  specialties: string | null;
  recentHits: number;
  distanceKm: number | null;
  /** Contesta desde el Mostrador y alcanza el lugar. */
  mostrador: boolean;
};

const PAGE_SIZE = 12;

/** Número para wa.me: 10 dígitos de México llevan 52 adelante. */
function whatsappNumber(digits: string): string {
  return digits.length === 10 ? `52${digits}` : digits;
}

export function PartsStoreFinder({
  api,
  request,
  near,
}: {
  api: ApiCall;
  /** El servicio en curso: busca cerca del auto y pone el auto en el mensaje. */
  request?: { id: number; vehicleType?: 'auto' | 'moto'; vehicleMake: string; vehicleModel: string; vehicleYear: number | string } | null;
  /** Sin servicio: cerca de dónde está el mecánico. */
  near?: { latitude: number; longitude: number } | null;
}) {
  const { busy, setBusy, setMessage } = useAppContext();
  const [open, setOpen] = useState(false);
  const [stores, setStores] = useState<Store[] | null>(null);
  const [part, setPart] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [marked, setMarked] = useState<number[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState({ name: '', phone: '', address: '' });
  const [askedKey, setAskedKey] = useState(0);
  const apiRef = useRef(api);
  apiRef.current = api;

  const vehicle = request
    ? `${request.vehicleType === 'moto' ? 'moto ' : ''}${request.vehicleMake} ${request.vehicleModel} ${request.vehicleYear}`
    : '';

  async function load() {
    const params = request
      ? `requestId=${request.id}`
      : near
        ? `latitude=${near.latitude}&longitude=${near.longitude}`
        : '';
    try {
      const data = await apiRef.current<{ stores: Store[] }>(`/api/parts-stores${params ? `?${params}` : ''}`);
      setStores(data.stores);
    } catch (error) {
      setMessage(formatError(error));
      setStores([]);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && stores === null) void load();
  }

  function message(): string | null {
    const wanted = part.trim();
    if (wanted.length < 3) {
      setMessage('Escribe qué pieza buscas.');
      return null;
    }
    return `Hola, ¿tienen ${wanted}${vehicle ? ` para ${vehicle}` : ''}? Soy mecánico de Mecanifique.`;
  }

  function askByWhatsapp(store: Store) {
    const text = message();
    if (!text || !store.whatsapp) return;
    Linking.openURL(`https://wa.me/${whatsappNumber(store.whatsapp)}?text=${encodeURIComponent(text)}`).catch(() =>
      setMessage('No se pudo abrir WhatsApp.'),
    );
  }

  async function markHadPart(store: Store) {
    try {
      await apiRef.current(`/api/parts-stores/${store.id}/had-part`, {
        method: 'POST',
        body: { requestId: request?.id, part: part.trim() || undefined, vehicle: vehicle || undefined },
      });
      setMarked((current) => [...current, store.id]);
      setMessage('Gracias: así otros mecánicos saben dónde buscar.');
    } catch (error) {
      setMessage(formatError(error));
    }
  }

  async function suggest() {
    if (suggestion.name.trim().length < 3 || suggestion.phone.replace(/\D/g, '').length < 7) {
      setMessage('Escribe el nombre y el teléfono de la refaccionaria.');
      return;
    }
    setBusy(true);
    try {
      await apiRef.current('/api/parts-stores', {
        method: 'POST',
        body: {
          name: suggestion.name.trim(),
          phone: suggestion.phone.trim(),
          address: suggestion.address.trim() || undefined,
        },
      });
      setSuggesting(false);
      setSuggestion({ name: '', phone: '', address: '' });
      setMessage('Gracias: la revisamos y la agregamos a la lista.');
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  const subtitle = request ? `Las más cercanas ${vehicleWords(request.vehicleType).toThe}.` : 'Las más cercanas a ti.';

  const myRequests = <MyPartRequests api={api} serviceRequestId={request?.id} refreshKey={askedKey} />;
  const mostradorStores = stores?.filter((store) => store.mostrador).length ?? 0;

  if (!open) {
    return (
      <>
        {myRequests}
        <Card title="¿Te falta una pieza?" subtitle={subtitle}>
          <SecondaryButton title="Buscar en refaccionarias" onPress={toggle} />
        </Card>
      </>
    );
  }

  return (
    <>
    {myRequests}
    <Card title="Buscar la pieza" subtitle={subtitle}>
      <View style={styles.stack}>
        <Field label="¿Qué pieza buscas?">
          <Input value={part} maxLength={120} placeholder="Ej. bomba de gasolina" onChangeText={setPart} />
        </Field>
        <AskStoresBox
          api={api}
          serviceRequestId={request?.id}
          near={near}
          part={part}
          stores={mostradorStores}
          onAsked={() => {
            setPart('');
            setAskedKey((key) => key + 1);
          }}
        />

        {stores === null ? (
          <Text style={styles.smallText}>Buscando refaccionarias…</Text>
        ) : stores.length === 0 ? (
          <Text style={styles.itemText}>Todavía no tenemos refaccionarias en la lista. Sugiere las que conozcas.</Text>
        ) : (
          <View style={styles.list}>
            {stores.slice(0, visible).map((store) => (
              <View key={store.id} style={styles.item}>
                <Text style={styles.itemTitle}>{store.name}</Text>
                <Text style={styles.smallText}>
                  {[store.distanceKm != null ? `a ${store.distanceKm} km` : null, store.zone, store.hours].filter(Boolean).join(' · ')}
                </Text>
                {store.mostrador ? <InfoRow icon="flash-outline" text="Contesta aquí en la app" /> : null}
                {store.specialties ? <InfoRow icon="construct-outline" text={store.specialties} /> : null}
                {store.recentHits > 0 ? (
                  <InfoRow
                    icon="checkmark-circle-outline"
                    text={`Sí tenían la pieza ${store.recentHits} ${store.recentHits === 1 ? 'vez' : 'veces'} (últimos 3 meses)`}
                  />
                ) : null}
                <View style={styles.row}>
                  {store.whatsapp ? <SecondaryButton title="WhatsApp" compact onPress={() => askByWhatsapp(store)} /> : null}
                  {store.phone ? (
                    <SecondaryButton title="Llamar" compact onPress={() => void Linking.openURL(`tel:${store.phone}`)} />
                  ) : null}
                  {store.latitude != null || store.address ? (
                    <SecondaryButton
                      title="Cómo llegar"
                      compact
                      onPress={() =>
                        void openServiceNavigation({
                          latitude: store.latitude,
                          longitude: store.longitude,
                          serviceAddress: store.address,
                          city: store.city,
                          zone: store.zone ?? '',
                        })
                      }
                    />
                  ) : null}
                </View>
                {marked.includes(store.id) ? (
                  <Text style={styles.smallText}>Marcaste que sí tenían la pieza.</Text>
                ) : (
                  <Text style={[styles.textLink, styles.smallText]} onPress={() => void markHadPart(store)} accessibilityRole="button">
                    Sí tenían la pieza
                  </Text>
                )}
              </View>
            ))}
            {stores.length > visible && (
              <SecondaryButton title={`Ver más (${stores.length - visible})`} onPress={() => setVisible((count) => count + PAGE_SIZE)} />
            )}
          </View>
        )}

        {suggesting ? (
          <View style={styles.publicProfileBox}>
            <Text style={styles.publicProfileTitle}>Sugerir una refaccionaria</Text>
            <Field label="Nombre">
              <Input value={suggestion.name} maxLength={120} onChangeText={(value) => setSuggestion({ ...suggestion, name: value })} />
            </Field>
            <Field label="Teléfono">
              <Input
                value={suggestion.phone}
                keyboardType="phone-pad"
                maxLength={30}
                onChangeText={(value) => setSuggestion({ ...suggestion, phone: value })}
              />
            </Field>
            <Field label="Dirección (opcional)">
              <Input value={suggestion.address} maxLength={200} onChangeText={(value) => setSuggestion({ ...suggestion, address: value })} />
            </Field>
            <PrimaryButton title="Mandar sugerencia" busy={busy} onPress={() => void suggest()} />
            <SecondaryButton title="Cancelar" compact onPress={() => setSuggesting(false)} />
          </View>
        ) : (
          <Text style={[styles.textLink, styles.smallText]} onPress={() => setSuggesting(true)} accessibilityRole="button">
            ¿Falta una refaccionaria? Sugiérela
          </Text>
        )}
        <SecondaryButton title="Cerrar" compact onPress={toggle} />
      </View>
    </Card>
    </>
  );
}

type PendingStore = Store & { suggestedBy: string | null; createdAt: string };

/**
 * Acciones → Refaccionarias sugeridas (solo admin). Antes de aprobar, llamar
 * para confirmar que el número es de la tienda. Si no hay nada por revisar,
 * no ocupa lugar (al admin le llega un aviso cuando alguien sugiere una).
 */
export function AdminPartsStoresCard({ api }: { api: ApiCall }) {
  const { busy, setBusy, setMessage } = useAppContext();
  const [pending, setPending] = useState<PendingStore[] | null>(null);
  const apiRef = useRef(api);
  apiRef.current = api;

  function load() {
    apiRef
      .current<{ stores: PendingStore[] }>('/api/admin/parts-stores/pending')
      .then((data) => setPending(data.stores))
      .catch(() => setPending([]));
  }
  useEffect(load, []);

  async function review(store: PendingStore, approve: boolean) {
    setBusy(true);
    try {
      await apiRef.current(`/api/admin/parts-stores/${store.id}/review`, { method: 'POST', body: { approve } });
      setMessage(approve ? `${store.name} ya aparece en la lista.` : `${store.name} no se agregó.`);
      load();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  if (!pending || pending.length === 0) return null;

  return (
    <Card
      title="Refaccionarias sugeridas"
      subtitle={`${pending.length} por revisar. Llámales antes de aprobar para confirmar que el número es de la tienda.`}
    >
      <View style={styles.list}>
        {pending.map((store) => (
          <View key={store.id} style={styles.item}>
            <Text style={styles.itemTitle}>{store.name}</Text>
            {store.phone ? <InfoRow icon="call-outline" text={store.phone} /> : null}
            {store.address ? <InfoRow icon="location-outline" text={store.address} lines={2} /> : null}
            <Text style={styles.smallText}>
              Sugerida por {store.suggestedBy || 'un mecánico'} · {formatServerDate(store.createdAt)}
            </Text>
            <View style={styles.row}>
              {store.phone ? (
                <SecondaryButton title="Llamar" compact onPress={() => void Linking.openURL(`tel:${store.phone}`)} />
              ) : null}
              <SecondaryButton title="No agregar" compact busy={busy} onPress={() => void review(store, false)} />
              <PrimaryButton title="Aprobar" busy={busy} onPress={() => void review(store, true)} />
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}
