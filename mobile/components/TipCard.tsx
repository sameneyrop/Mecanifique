import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, InfoRow, PrimaryButton } from './ui';
import { formatClabe } from '../utils';
import type { ApiCall } from '../App';

type TipInfo = { mechanicName: string | null; clabe: string | null; holderName: string | null };

/**
 * Propina directa al terminar el servicio: el cliente transfiere a la CLABE
 * del mecánico (si la puso) o se la da en efectivo. El dinero nunca pasa por
 * Mecanifique.
 */
export function TipCard({ api, requestId }: { api: ApiCall; requestId: number }) {
  const { setMessage } = useAppContext();
  const [info, setInfo] = useState<TipInfo | null>(null);

  useEffect(() => {
    api<TipInfo>(`/api/service-requests/${requestId}/tip-info`)
      .then(setInfo)
      .catch(() => setInfo(null));
  }, [requestId]);

  if (!info) {
    return null;
  }

  const name = info.mechanicName || 'tu mecánico';

  async function copyClabe() {
    if (!info?.clabe) return;
    await Clipboard.setStringAsync(info.clabe);
    setMessage('CLABE copiada. Pégala en la app de tu banco.');
  }

  return (
    <Card
      title={`¿Quieres dejarle propina a ${name}?`}
      subtitle="Es opcional y va completa para él: Mecanifique no cobra nada de ella."
    >
      {info.clabe ? (
        <View style={styles.stack}>
          <Text style={styles.itemText}>Puedes mandársela por transferencia a esta cuenta:</Text>
          <InfoRow icon="card-outline" text={formatClabe(info.clabe)} />
          {info.holderName ? <InfoRow icon="person-outline" text={`A nombre de ${info.holderName}`} /> : null}
          <PrimaryButton title="Copiar CLABE" onPress={() => void copyClabe()} />
          <Text style={styles.smallText}>También puedes dársela en efectivo.</Text>
        </View>
      ) : (
        <Text style={styles.itemText}>Si quieres dejarle propina, puedes dársela en efectivo.</Text>
      )}
    </Card>
  );
}
