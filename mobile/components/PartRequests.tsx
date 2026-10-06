import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, Field, InfoRow, Input, PrimaryButton, Segmented, SecondaryButton } from './ui';
import { formatError, formatPesos, formatServerDate, openServiceNavigation, parseServerTimestamp } from '../utils';
import type { ApiCall } from '../App';

/**
 * Mostrador, lado del mecánico (servidor: src/mostrador.ts). Pregunta una
 * pieza y le llega a las refaccionarias de Mostrador cercanas; contestan con
 * precio y si la tienen, y el mecánico aparta la que le convenga: pasa por
 * ella o se la mandan. La paga en la tienda (Mecanifique no cobra la pieza) y,
 * si es para un servicio, el ticket de la tienda entra solo a sus piezas.
 */

type PartOption = {
  offerId: number;
  available: 'yes' | 'order';
  price: number;
  warranty: string | null;
  text: string;
};

type PartRequest = {
  id: number;
  serviceRequestId: number | null;
  part: string;
  category: string | null;
  vehicle: string | null;
  status: 'open' | 'held' | 'closed' | 'cancelled';
  createdAt: string;
  respondUntil: string;
  closesAt: string;
  storesNotified: number;
  stores: Array<{
    storeId: number;
    name: string;
    distanceKm: number | null;
    delivery: boolean;
    recentHits: number;
    declined: string | null;
    options: PartOption[];
  }>;
  hold: null | {
    id: number;
    offerId: number;
    storeId: number;
    storeName: string;
    method: 'pickup' | 'delivery';
    status: 'held' | 'dispatched' | 'delivered' | 'cancelled' | 'expired';
    price: number;
    expiresAt: string;
    ticketCode: string | null;
    cancelledBy: 'mechanic' | 'store' | null;
    cancelReason: string | null;
    address: string | null;
    city: string;
    storePhone: string | null;
    latitude: number | null;
    longitude: number | null;
  };
};

type Options = { categories: string[]; respondMinutes: number; holdMinutes: number };

const POLL_MS = 5000;

/** "09:42", hora del teléfono, como la de formatServerDate ("Hoy, 09:42"). */
function clock(value: string): string {
  const ms = parseServerTimestamp(value);
  if (ms === null) return '';
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function isPast(value: string): boolean {
  const ms = parseServerTimestamp(value);
  return ms !== null && ms <= Date.now();
}

/** Sigue cambiando: esperando respuestas, o con un apartado en curso. */
function isLive(request: PartRequest): boolean {
  if (request.status === 'open') return !isPast(request.closesAt);
  return request.status === 'held' && (request.hold?.status === 'held' || request.hold?.status === 'dispatched');
}

/**
 * Debajo de "¿Qué pieza buscas?": preguntarle a las refaccionarias de
 * Mostrador cercanas. Solo se muestra si hay alguna.
 */
export function AskStoresBox({
  api,
  serviceRequestId,
  near,
  part,
  stores,
  onAsked,
}: {
  api: ApiCall;
  serviceRequestId?: number | null;
  near?: { latitude: number; longitude: number } | null;
  part: string;
  /** Refaccionarias de Mostrador que alcanzan el lugar. */
  stores: number;
  onAsked: () => void;
}) {
  const { busy, setBusy, setMessage } = useAppContext();
  const [options, setOptions] = useState<Options | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    apiRef
      .current<Options>('/api/part-requests/options')
      .then(setOptions)
      .catch(() => undefined);
  }, []);

  async function ask() {
    const wanted = part.trim();
    if (wanted.length < 3) {
      setMessage('Escribe qué pieza buscas.');
      return;
    }
    if (!serviceRequestId && !near) {
      setMessage('Necesitamos tu ubicación para preguntarle a las refaccionarias cercanas.');
      return;
    }
    setBusy(true);
    try {
      const created = await apiRef.current<{ id: number; storesNotified: number }>('/api/part-requests', {
        method: 'POST',
        body: {
          part: wanted,
          category: category ?? undefined,
          note: note.trim() || undefined,
          ...(serviceRequestId ? { serviceRequestId } : { latitude: near!.latitude, longitude: near!.longitude }),
        },
      });
      const minutes = options?.respondMinutes ?? 5;
      setMessage(
        `Le preguntamos a ${created.storesNotified} ${created.storesNotified === 1 ? 'refaccionaria' : 'refaccionarias'}. Contestan en máximo ${minutes} min.`,
      );
      setCategory(null);
      setNote('');
      onAsked();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  if (stores === 0) return null;

  return (
    <View style={styles.askStoresBox}>
      <Text style={styles.publicProfileTitle}>
        {stores === 1 ? 'Una refaccionaria cercana' : `${stores} refaccionarias cercanas`} te contesta aquí mismo
      </Text>
      <Text style={styles.smallText}>
        Te dicen si la tienen y a qué precio en máximo {options?.respondMinutes ?? 5} min. Apartas la que te convenga y la
        pagas en la tienda.
      </Text>
      {options && (
        <>
          <Text style={styles.label}>¿De qué es? (opcional)</Text>
          <View style={styles.chipWrap}>
            {options.categories.map((name) => {
              const active = category === name;
              return (
                <Pressable
                  key={name}
                  style={({ pressed }) => [styles.categoryChip, active && styles.categoryChipActive, pressed && styles.buttonPressed]}
                  onPress={() => setCategory(active ? null : name)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                >
                  {active ? <Ionicons name="checkmark" size={15} color={colors.primaryDark} /> : null}
                  <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>{name}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.smallText}>Así solo les llega a las que manejan eso.</Text>
        </>
      )}
      <Field label="Nota para la tienda (opcional)">
        <Input value={note} maxLength={300} placeholder="Ej. lado izquierdo, con sensor" onChangeText={setNote} />
      </Field>
      <PrimaryButton
        title={stores === 1 ? 'Preguntarle' : `Preguntarle a las ${stores}`}
        busy={busy}
        disabled={part.trim().length < 3}
        onPress={() => void ask()}
      />
    </View>
  );
}

/**
 * Las piezas que preguntó (las de este servicio, o las de las últimas 24 h)
 * con lo que contestó cada tienda. Mientras hay algo en curso se refresca
 * sola. Sin solicitudes no ocupa lugar.
 */
export function MyPartRequests({
  api,
  serviceRequestId,
  refreshKey,
}: {
  api: ApiCall;
  serviceRequestId?: number | null;
  /** Cambia cuando se acaba de preguntar una pieza. */
  refreshKey: number;
}) {
  const { busy, setBusy, setMessage } = useAppContext();
  const [requests, setRequests] = useState<PartRequest[]>([]);
  const [choosing, setChoosing] = useState<{ requestId: number; offerId: number; method: 'pickup' | 'delivery' } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<number | null>(null);
  const apiRef = useRef(api);
  apiRef.current = api;

  async function load() {
    try {
      const data = await apiRef.current<{ requests: PartRequest[] }>(
        `/api/part-requests/mine${serviceRequestId ? `?serviceRequestId=${serviceRequestId}` : ''}`,
      );
      setRequests(data.requests.filter((request) => request.status !== 'cancelled'));
    } catch {
      // Se vuelve a intentar en la siguiente vuelta.
    }
  }

  useEffect(() => {
    void load();
  }, [refreshKey, serviceRequestId]);

  const live = requests.some(isLive);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [live, serviceRequestId]);

  async function reserve(request: PartRequest) {
    if (!choosing) return;
    setBusy(true);
    try {
      await apiRef.current(`/api/part-requests/${request.id}/hold`, {
        method: 'POST',
        body: { offerId: choosing.offerId, method: choosing.method },
      });
      setChoosing(null);
      setMessage(choosing.method === 'pickup' ? 'Apartada. Pasa por ella y la pagas en la tienda.' : 'Apartada. La tienda te avisa cuando salga el repartidor.');
      await load();
    } catch (error) {
      setMessage(formatError(error));
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function cancel(request: PartRequest) {
    setBusy(true);
    try {
      await apiRef.current(`/api/part-requests/${request.id}/cancel`, { method: 'POST' });
      setConfirmCancel(null);
      setMessage(request.hold?.status === 'held' ? 'Listo: le avisamos a la tienda que ya no la necesitas.' : 'Listo: ya no les llega a las tiendas.');
      await load();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  if (requests.length === 0) return null;

  function statusText(request: PartRequest): string {
    const withOptions = request.stores.filter((store) => store.options.length > 0).length;
    const answered = request.stores.length;
    if (request.status === 'closed') {
      return request.hold?.status === 'expired' ? 'Se venció el apartado: nadie pasó por ella.' : 'Se cerró sin apartar.';
    }
    if (request.status === 'open' && isPast(request.closesAt)) return 'Se cerró sin apartar.';
    if (request.status !== 'open') return '';
    if (!isPast(request.respondUntil)) {
      return `Preguntando a ${request.storesNotified} ${request.storesNotified === 1 ? 'refaccionaria' : 'refaccionarias'}… ${answered} ${answered === 1 ? 'contestó' : 'contestaron'}. Tienen hasta las ${clock(request.respondUntil)}.`;
    }
    if (withOptions > 0) return `${withOptions} la ${withOptions === 1 ? 'tiene' : 'tienen'}. Aparta la que te convenga.`;
    if (answered > 0) return 'Ninguna la tiene ahorita. Llama a otras de la lista de abajo.';
    return 'Nadie contestó a tiempo. Llama a las de la lista de abajo.';
  }

  return (
    <Card title="Piezas que preguntaste" subtitle="Lo que contestó cada refaccionaria. La pagas en la tienda.">
      <View style={styles.list}>
        {requests.map((request) => {
          const hold = request.hold;
          const activeHold = hold && (hold.status === 'held' || hold.status === 'dispatched' || hold.status === 'delivered');
          const canHold = request.status === 'open' && !isPast(request.closesAt);
          const canCancel = request.status === 'open' || (request.status === 'held' && hold?.status === 'held');
          return (
            <View key={request.id} style={styles.item}>
              <Text style={styles.itemTitle}>{request.part}</Text>
              <Text style={styles.smallText}>
                {[request.vehicle, request.category, formatServerDate(request.createdAt)].filter(Boolean).join(' · ')}
              </Text>

              {activeHold && hold ? (
                <HoldBox hold={hold} forService={Boolean(request.serviceRequestId)} />
              ) : (
                <>
                  {hold?.cancelledBy === 'store' && request.status === 'open' ? (
                    <InfoRow icon="alert-circle-outline" text={`${hold.storeName} canceló tu apartado: ${hold.cancelReason ?? 'ya no la tiene'}. Aparta otra.`} lines={3} />
                  ) : null}
                  <Text style={styles.itemText}>{statusText(request)}</Text>
                  {request.stores.map((store) => (
                    <View key={store.storeId} style={styles.partStoreBox}>
                      <View style={styles.partStoreHeader}>
                        <Text style={[styles.publicProfileTitle, styles.flex]}>{store.name}</Text>
                        {store.distanceKm != null ? <Text style={styles.smallText}>a {store.distanceKm} km</Text> : null}
                      </View>
                      {store.declined ? <Text style={styles.smallText}>No la tiene: {store.declined}</Text> : null}
                      {store.options.map((option) => {
                        const open = choosing?.requestId === request.id && choosing.offerId === option.offerId;
                        return (
                          <View key={option.offerId} style={styles.stack}>
                            <View style={styles.partOptionRow}>
                              <View style={[styles.flex, styles.stack]}>
                                <Text style={styles.itemText}>{option.text}</Text>
                                {option.warranty ? <Text style={styles.smallText}>Garantía: {option.warranty}</Text> : null}
                              </View>
                              <Text style={styles.partPrice}>{formatPesos(option.price)}</Text>
                            </View>
                            {canHold && !open ? (
                              <SecondaryButton
                                title="Apartar"
                                compact
                                onPress={() => setChoosing({ requestId: request.id, offerId: option.offerId, method: 'pickup' })}
                              />
                            ) : null}
                            {canHold && open ? (
                              <View style={styles.stack}>
                                {store.delivery ? (
                                  <Segmented
                                    value={choosing.method}
                                    options={[
                                      { key: 'pickup', label: 'Paso por ella', icon: 'walk-outline' },
                                      { key: 'delivery', label: 'Que me la manden', icon: 'bicycle-outline' },
                                    ]}
                                    onChange={(value) => setChoosing({ ...choosing, method: value as 'pickup' | 'delivery' })}
                                  />
                                ) : (
                                  <Text style={styles.smallText}>Esta tienda no tiene repartidor: pasas por ella.</Text>
                                )}
                                <Text style={styles.smallText}>
                                  {choosing.method === 'pickup'
                                    ? 'Te la guardan 30 min. La pagas al recogerla.'
                                    : 'La pagas al recibirla. El costo del envío lo arreglas con la tienda.'}
                                </Text>
                                <PrimaryButton title={`Apartar por ${formatPesos(option.price)}`} busy={busy} onPress={() => void reserve(request)} />
                                <SecondaryButton title="Ahora no" compact onPress={() => setChoosing(null)} />
                              </View>
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  ))}
                </>
              )}

              {canCancel ? (
                confirmCancel === request.id ? (
                  <View style={styles.row}>
                    <SecondaryButton title="Sí, ya no la necesito" compact busy={busy} onPress={() => void cancel(request)} />
                    <SecondaryButton title="No" compact onPress={() => setConfirmCancel(null)} />
                  </View>
                ) : (
                  <Text style={[styles.textLink, styles.smallText]} onPress={() => setConfirmCancel(request.id)} accessibilityRole="button">
                    Ya no la necesito
                  </Text>
                )
              ) : null}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function HoldBox({ hold, forService }: { hold: NonNullable<PartRequest['hold']>; forService: boolean }) {
  const title =
    hold.status === 'delivered'
      ? `Entregada · ${formatPesos(hold.price)}`
      : hold.status === 'dispatched'
        ? 'Ya va en camino'
        : `Apartada · ${formatPesos(hold.price)}`;
  const text =
    hold.status === 'delivered'
      ? `${hold.storeName}${hold.ticketCode ? `, ticket ${hold.ticketCode}` : ''}.${forService ? ' El ticket ya está en las piezas del servicio.' : ''}`
      : hold.status === 'dispatched'
        ? `El repartidor de ${hold.storeName} ya salió con tu pieza. La pagas al recibirla.`
        : hold.method === 'pickup'
          ? `En ${hold.storeName}. Pasa por ella antes de las ${clock(hold.expiresAt)} y la pagas en la tienda.`
          : `En ${hold.storeName}. Te avisamos cuando salga el repartidor; la pagas al recibirla.`;
  return (
    <View style={styles.partHoldBox}>
      <Text style={styles.partHoldTitle}>{title}</Text>
      <Text style={styles.itemText}>{text}</Text>
      {hold.status !== 'delivered' && (
        <View style={styles.row}>
          {hold.storePhone ? (
            <SecondaryButton title="Llamar a la tienda" compact onPress={() => void Linking.openURL(`tel:${hold.storePhone}`)} />
          ) : null}
          {hold.method === 'pickup' && (hold.latitude != null || hold.address) ? (
            <SecondaryButton
              title="Cómo llegar"
              compact
              onPress={() =>
                void openServiceNavigation({
                  latitude: hold.latitude,
                  longitude: hold.longitude,
                  serviceAddress: hold.address,
                  city: hold.city,
                  zone: '',
                })
              }
            />
          ) : null}
        </View>
      )}
    </View>
  );
}
