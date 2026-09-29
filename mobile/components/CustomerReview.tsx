import { useState } from 'react';
import { View } from 'react-native';

import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, Field, Input, PrimaryButton, StarRating } from './ui';
import { formatError } from '../utils';
import type { ApiCall } from '../App';

/**
 * El mecánico califica al cliente al terminar (servidor:
 * src/customerReviews.ts). Otros mecánicos ven el promedio antes de aceptar
 * una solicitud; el comentario solo lo ve Mecanifique.
 */
export function CustomerReviewCard({
  api,
  request,
  onDone,
}: {
  api: ApiCall;
  request: {
    id: number;
    status: string;
    cancellationFee?: number | null;
    customerName?: string | null;
    customerReviewed?: boolean;
  };
  onDone: () => void;
}) {
  const { busy, setBusy, setMessage } = useAppContext();
  const [rating, setRating] = useState('');
  const [comment, setComment] = useState('');

  const finished = request.status === 'completed' || (request.status === 'cancelled' && (request.cancellationFee ?? 0) > 0);
  if (!finished || request.customerReviewed !== false) {
    return null;
  }
  const name = request.customerName?.trim().split(/\s+/)[0] || 'al cliente';

  async function submit() {
    if (!rating) {
      setMessage('Elige de 1 a 5 estrellas.');
      return;
    }
    setBusy(true);
    try {
      await api(`/api/service-requests/${request.id}/customer-review`, {
        method: 'POST',
        body: { rating: Number(rating), comment: comment.trim() || undefined },
      });
      setMessage('Gracias: tu calificación ayuda a otros mecánicos.');
      onDone();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={`Califica a ${name}`}
      subtitle="¿Te recibió a tiempo, fue claro y te pagó lo acordado? Otros mecánicos verán su promedio antes de aceptar sus solicitudes. El cliente solo ve su promedio, no tu calificación."
    >
      <View style={styles.stack}>
        <Field label="Calificación">
          <StarRating value={rating} onChange={setRating} />
        </Field>
        <Field label="Comentario (opcional, solo lo ve Mecanifique)">
          <Input value={comment} multiline maxLength={500} placeholder="Cuéntanos cómo fue" onChangeText={setComment} />
        </Field>
        <PrimaryButton title="Enviar calificación" busy={busy} onPress={() => void submit()} />
      </View>
    </Card>
  );
}
