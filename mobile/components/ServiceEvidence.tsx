import { useState } from 'react';
import { Text, View } from 'react-native';

import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, InfoRow, SecondaryButton, Segmented } from './ui';
import { PhotoThumbs } from './RequestPlace';
import { acceptedWarranty, warrantyText } from './Quote';
import { takeEvidencePhoto } from '../photos';
import { formatError, vehicleWords } from '../utils';
import type { ApiCall } from '../App';
import type { ServiceQuote } from '../context/AppContext';

/**
 * Evidencia del servicio (servidor: src/serviceEvidence.ts): fotos de antes y
 * después que toma el mecánico con la cámara, y qué pasó con las piezas
 * cambiadas. Protege a los dos: el cliente ve cómo recibió y cómo quedó su
 * auto; el mecánico tiene cómo demostrar su trabajo en una disputa.
 */

type Photo = { id: number; kind: 'before' | 'after'; photoUrl: string; createdAt: string };
type EvidenceRequest = {
  id: number;
  status: string;
  vehicleType?: 'auto' | 'moto';
  servicePhotos?: Photo[];
  oldPartsStatus?: 'delivered' | 'declined' | 'none' | null;
  quotes?: ServiceQuote[];
};

const OLD_PARTS_LABELS: Record<'delivered' | 'declined' | 'none', string> = {
  delivered: 'El mecánico te entregó las piezas cambiadas.',
  declined: 'No quisiste las piezas cambiadas.',
  none: 'No se cambiaron piezas.',
};

// Mientras está con el auto, antes de terminar.
const WITH_CAR = new Set(['on_site', 'in_progress', 'diagnosing', 'repairing', 'awaiting_parts']);
const REPAIRING = new Set(['repairing', 'awaiting_parts']);

function thumbs(photos: Photo[], kind: 'before' | 'after') {
  const label = kind === 'before' ? 'Antes' : 'Después';
  return photos.filter((photo) => photo.kind === kind).map((photo) => ({ url: photo.photoUrl, label }));
}

/** Mecánico, en el trabajo en curso: tomar las fotos y marcar las piezas. */
export function MechanicEvidencePanel({
  api,
  request,
  onChanged,
}: {
  api: ApiCall;
  request: EvidenceRequest;
  onChanged: () => void;
}) {
  const { busy, setBusy, setMessage } = useAppContext();
  const [uploading, setUploading] = useState<'before' | 'after' | null>(null);

  if (!WITH_CAR.has(request.status)) {
    return null;
  }
  const photos = request.servicePhotos ?? [];
  const before = thumbs(photos, 'before');
  const after = thumbs(photos, 'after');
  const repairing = REPAIRING.has(request.status);

  async function takePhoto(kind: 'before' | 'after') {
    try {
      const imageBase64 = await takeEvidencePhoto();
      if (!imageBase64) return;
      setUploading(kind);
      await api(`/api/service-requests/${request.id}/service-photos`, { method: 'POST', body: { kind, imageBase64 } });
      onChanged();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setUploading(null);
    }
  }

  async function markOldParts(status: string) {
    setBusy(true);
    try {
      await api(`/api/service-requests/${request.id}/old-parts`, { method: 'POST', body: { status } });
      onChanged();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Fotos del servicio" subtitle={`Cómo recibiste ${vehicleWords(request.vehicleType).the} y cómo quedó.`}>
      <View style={styles.stack}>
        <Text style={styles.itemTitle}>Antes {before.length === 0 ? '· obligatoria para empezar a reparar' : `· ${before.length}`}</Text>
        <PhotoThumbs photos={before} />
        <SecondaryButton
          title={before.length === 0 ? 'Tomar foto de antes' : 'Tomar otra foto de antes'}
          compact
          busy={uploading === 'before'}
          onPress={() => void takePhoto('before')}
        />
        {repairing && (
          <>
            <Text style={styles.itemTitle}>Después {after.length === 0 ? '· obligatoria para terminar' : `· ${after.length}`}</Text>
            <PhotoThumbs photos={after} />
            <SecondaryButton
              title={after.length === 0 ? 'Tomar foto de cómo quedó' : 'Tomar otra foto de después'}
              compact
              busy={uploading === 'after'}
              onPress={() => void takePhoto('after')}
            />
            <Text style={styles.itemTitle}>¿Y las piezas que cambiaste?</Text>
            <Segmented
              value={request.oldPartsStatus ?? ''}
              options={[
                { key: 'delivered', label: 'Se las entregué' },
                { key: 'declined', label: 'No las quiso' },
                { key: 'none', label: 'No cambié piezas' },
              ]}
              onChange={(value) => {
                if (!busy) void markOldParts(value);
              }}
            />
            <Text style={styles.smallText}>
              Ofrécele al cliente las piezas que cambiaste: así ve qué se reemplazó y le da confianza. Obligatorio para terminar.
            </Text>
          </>
        )}
      </View>
    </Card>
  );
}

/** Cliente (y admin): la evidencia de su servicio y la garantía, para consultarla después. */
export function ServiceEvidenceView({ request }: { request: EvidenceRequest }) {
  const photos = request.servicePhotos ?? [];
  const before = thumbs(photos, 'before');
  const after = thumbs(photos, 'after');
  const accepted = (request.quotes ?? []).filter((quote) => quote.status === 'accepted');
  const warranty = warrantyText(acceptedWarranty(accepted));

  if (before.length === 0 && after.length === 0 && !request.oldPartsStatus && !warranty) {
    return null;
  }

  return (
    <Card title={request.vehicleType === 'moto' ? 'Cómo quedó tu moto' : 'Cómo quedó tu auto'} subtitle="Quedan guardadas en tu servicio.">
      <View style={styles.stack}>
        {before.length > 0 && (
          <>
            <Text style={styles.itemTitle}>Antes</Text>
            <PhotoThumbs photos={before} />
          </>
        )}
        {after.length > 0 && (
          <>
            <Text style={styles.itemTitle}>Después</Text>
            <PhotoThumbs photos={after} />
          </>
        )}
        {request.oldPartsStatus && <InfoRow icon="cube-outline" text={OLD_PARTS_LABELS[request.oldPartsStatus]} />}
        {warranty && <InfoRow icon="shield-checkmark-outline" text={warranty} />}
      </View>
    </Card>
  );
}
