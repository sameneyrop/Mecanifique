import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import * as Location from 'expo-location';

import { useAppContext } from '../context/AppContext';
import { InfoRow, SecondaryButton } from './ui';
import { formatError, parseServerTimestamp } from '../utils';
import { takeEvidencePhoto } from '../photos';
import type { ApiCall } from '../App';

/**
 * Acciones del mecánico cuando el servicio no se puede hacer (servidor:
 * src/cancellations.ts): "Ya no puedo ir" antes de llegar, y "El cliente no
 * está" 15 minutos después de llegar, con foto del lugar.
 */

const ABSENCE_WAIT_MINUTES = 15;

type CancellableRequest = {
  id: number;
  status: string;
  arrivedAt?: string | null;
  parentRequestId?: number | null;
  customerName?: string | null;
};

function useApiAction(api: ApiCall, onDone: () => void) {
  const { setBusy, setMessage } = useAppContext();
  return async (path: string, body: object | undefined, success: string) => {
    setBusy(true);
    try {
      await api(path, { method: 'POST', body });
      setMessage(success);
      onDone();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  };
}

/** "Ya no puedo ir": antes de llegar. El cliente no paga; se busca a otro. */
export function WithdrawButton({ api, request, onDone }: { api: ApiCall; request: CancellableRequest; onDone: () => void }) {
  const { busy } = useAppContext();
  const act = useApiAction(api, onDone);
  // En una visita de regreso tiene la pieza que el cliente ya pagó: se habla con él.
  if ((request.status !== 'assigned' && request.status !== 'en_route') || request.parentRequestId) {
    return null;
  }
  function confirm() {
    Alert.alert(
      '¿Ya no puedes ir?',
      'El cliente no paga nada y buscaremos a otro mecánico. Queda en tu historial: si pasa seguido, tu cuenta puede suspenderse.',
      [
        { text: 'Sí puedo ir', style: 'cancel' },
        {
          text: 'Ya no puedo ir',
          style: 'destructive',
          onPress: () => void act(`/api/service-requests/${request.id}/withdraw`, {}, 'Listo. Le avisamos al cliente.'),
        },
      ],
    );
  }
  return <SecondaryButton title="Ya no puedo ir" busy={busy} onPress={confirm} />;
}

/**
 * "El cliente no está": a los 15 minutos de llegar. Antes, una cuenta
 * regresiva; al marcarlo, foto del lugar y la ubicación del mecánico.
 */
export function CustomerAbsentAction({ api, request, onDone }: { api: ApiCall; request: CancellableRequest; onDone: () => void }) {
  const { busy, setMessage, currentLocation } = useAppContext();
  const act = useApiAction(api, onDone);
  const [now, setNow] = useState(() => Date.now());
  const arrived = parseServerTimestamp(request.arrivedAt);
  const onSite = request.status === 'on_site' || request.status === 'in_progress';

  useEffect(() => {
    if (!onSite) return;
    const intervalId = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(intervalId);
  }, [onSite]);

  if (!onSite || arrived === null) {
    return null;
  }
  const minutesLeft = Math.ceil(ABSENCE_WAIT_MINUTES - (now - arrived) / 60_000);
  const client = request.customerName?.trim().split(/\s+/)[0] || 'el cliente';

  if (minutesLeft > 0) {
    return <InfoRow icon="time-outline" text={`Si ${client} no aparece, en ${minutesLeft} min podrás marcar que no está.`} />;
  }

  async function markAbsent() {
    let imageBase64: string | null;
    try {
      imageBase64 = await takeEvidencePhoto();
    } catch (error) {
      setMessage(formatError(error));
      return;
    }
    if (!imageBase64) return;
    // La ubicación de este momento: hay que estar en la dirección del servicio.
    let coords = currentLocation;
    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      coords = { latitude: position.coords.latitude, longitude: position.coords.longitude };
    } catch {
      // Se usa la última conocida.
    }
    await act(
      `/api/service-requests/${request.id}/customer-absent`,
      { imageBase64, latitude: coords?.latitude, longitude: coords?.longitude },
      `Listo. Le avisamos a ${client}; se cobra la visita.`,
    );
  }

  function confirm() {
    Alert.alert(
      `¿${client} no está?`,
      'Tómale foto al lugar (la puerta o el número de la casa). Se cancela el servicio y se cobra la visita. Si el cliente demuestra que sí estaba, tu cuenta puede suspenderse.',
      [
        { text: 'Seguir esperando', style: 'cancel' },
        { text: 'Tomar foto y marcar', style: 'destructive', onPress: () => void markAbsent() },
      ],
    );
  }

  return <SecondaryButton title={`${client[0].toUpperCase()}${client.slice(1)} no está`} busy={busy} onPress={confirm} />;
}
