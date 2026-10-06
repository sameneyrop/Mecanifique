import { useState, type Dispatch, type SetStateAction } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { ChoiceTile, Field, Input, SecondaryButton } from './ui';
import { pickRequestPhoto } from '../photos';
import { formatError, vehicleWords } from '../utils';
import type { ApiCall } from '../App';

/**
 * Al pedir un servicio: dónde está el auto y dos fotos, del auto y del lugar
 * donde está estacionado (con el número de la casa si se ve), para que el
 * mecánico llegue al lugar correcto.
 *
 * - "Aquí, donde estoy": se usa el GPS del teléfono.
 * - "En otro lugar": la dirección es obligatoria y las coordenadas salen de
 *   ella al enviar (App.handleCreateRequest); nunca se usa la ubicación del
 *   teléfono, que mandaría al mecánico a otro lado.
 */

type PlaceForm = {
  vehicleType?: 'auto' | 'moto';
  serviceAddress: string;
  city: string;
  zone: string;
  latitude: string;
  longitude: string;
  carPhotoUrl: string;
  spotPhotoUrl: string;
  carLocation: string;
};

export function RequestPlace<T extends PlaceForm>({
  api,
  form,
  setForm,
  hasGpsLocation,
  onUseMyLocation,
}: {
  api: ApiCall;
  form: T;
  setForm: Dispatch<SetStateAction<T>>;
  hasGpsLocation: boolean;
  onUseMyLocation: () => void;
}) {
  const { busy } = useAppContext();
  const elsewhere = form.carLocation === 'elsewhere';

  function chooseHere() {
    setForm((current) => ({ ...current, carLocation: 'here' }));
    if (!hasGpsLocation) onUseMyLocation();
  }

  function chooseElsewhere() {
    // Las coordenadas del teléfono no son las del auto: se quitan.
    setForm((current) => ({ ...current, carLocation: 'elsewhere', latitude: '', longitude: '' }));
  }

  return (
    <View style={styles.publicProfileBox}>
      <Text style={styles.publicProfileTitle}>¿Dónde está {vehicleWords(form.vehicleType).your}?</Text>
      <View style={styles.row}>
        <ChoiceTile
          icon="navigate-outline"
          title="Aquí, donde estoy"
          description="Usamos tu ubicación."
          active={form.carLocation === 'here'}
          onPress={chooseHere}
          style={styles.flex}
        />
        <ChoiceTile
          icon="map-outline"
          title="En otro lugar"
          description="Escribe dónde está."
          active={elsewhere}
          onPress={chooseElsewhere}
          style={styles.flex}
        />
      </View>
      {form.carLocation === 'here' && (
        <>
          <Text style={styles.smallText}>
            {hasGpsLocation
              ? 'Listo: el mecánico llegará a tu ubicación actual.'
              : 'Permite tu ubicación para que el mecánico llegue directo.'}
          </Text>
          {!hasGpsLocation && (
            <SecondaryButton title="Usar mi ubicación actual" compact busy={busy} onPress={onUseMyLocation} />
          )}
        </>
      )}
      <Field label={elsewhere ? `Dirección donde está ${vehicleWords(form.vehicleType).the}` : 'Número y referencias (opcional)'}>
        <Input
          value={form.serviceAddress}
          onChangeText={(value) => setForm((current) => ({ ...current, serviceAddress: value }))}
          placeholder={elsewhere ? 'Calle, número y colonia' : 'Ej. Casa azul, portón negro'}
        />
      </Field>
      <View style={styles.row}>
        <Field label="Ciudad" style={styles.flex}>
          <Input value={form.city} onChangeText={(value) => setForm((current) => ({ ...current, city: value }))} />
        </Field>
        <Field label="Zona" style={styles.flex}>
          <Input value={form.zone} onChangeText={(value) => setForm((current) => ({ ...current, zone: value }))} />
        </Field>
      </View>

      <Text style={styles.publicProfileTitle}>Fotos para que el mecánico lo encuentre</Text>
      <View style={styles.row}>
        <PhotoSlot
          api={api}
          label="Tu auto"
          url={form.carPhotoUrl}
          onUploaded={(url) => setForm((current) => ({ ...current, carPhotoUrl: url }))}
        />
        <PhotoSlot
          api={api}
          label="Dónde está estacionado"
          url={form.spotPhotoUrl}
          onUploaded={(url) => setForm((current) => ({ ...current, spotPhotoUrl: url }))}
        />
      </View>
      <Text style={styles.smallText}>
        Si se puede, que en la foto del lugar se vea el número de la casa. Solo las ve el mecánico que tome tu solicitud.
      </Text>
    </View>
  );
}

/** Un recuadro de foto: tomarla o elegirla, subirla y verla; al tocarla, cambiarla. */
function PhotoSlot({
  api,
  label,
  url,
  onUploaded,
}: {
  api: ApiCall;
  label: string;
  url: string;
  onUploaded: (url: string) => void;
}) {
  const { setMessage } = useAppContext();
  const [uploading, setUploading] = useState(false);

  async function upload(source: 'camera' | 'library') {
    try {
      const imageBase64 = await pickRequestPhoto(source);
      if (!imageBase64) return;
      setUploading(true);
      const saved = await api<{ url: string }>('/api/uploads/photo', { method: 'POST', body: { imageBase64 } });
      onUploaded(saved.url);
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setUploading(false);
    }
  }

  function choose() {
    Alert.alert(label, url ? '¿Quieres cambiar esta foto?' : undefined, [
      { text: 'Tomar foto', onPress: () => void upload('camera') },
      { text: 'Elegir de la galería', onPress: () => void upload('library') },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.requestPhotoSlot, pressed && styles.buttonPressed]}
      onPress={choose}
      disabled={uploading}
      accessibilityRole="button"
      accessibilityLabel={url ? `Cambiar foto: ${label}` : `Agregar foto: ${label}`}
    >
      {uploading ? (
        <ActivityIndicator color={colors.primary} />
      ) : url ? (
        <Image source={{ uri: url }} style={styles.requestPhotoImage} />
      ) : (
        <>
          <Ionicons name="camera-outline" size={28} color={colors.primary} />
          <Text style={styles.photoAddText}>{label}</Text>
        </>
      )}
      {url && !uploading ? <Text style={styles.requestPhotoLabel}>{label}</Text> : null}
    </Pressable>
  );
}

/**
 * Para el mecánico (y el cliente en su detalle): las fotos del auto y del
 * lugar; al tocar una se ve completa.
 */
export function RequestPhotos({
  carPhotoUrl,
  spotPhotoUrl,
  locationSource,
}: {
  carPhotoUrl?: string | null;
  spotPhotoUrl?: string | null;
  locationSource?: string | null;
}) {
  const photos = [
    { url: carPhotoUrl, label: 'El auto' },
    { url: spotPhotoUrl, label: 'Dónde está' },
  ].filter((photo): photo is { url: string; label: string } => Boolean(photo.url));

  if (photos.length === 0 && locationSource !== 'address') {
    return null;
  }

  return (
    <View style={styles.stack}>
      <PhotoThumbs photos={photos} />
      {locationSource === 'address' && (
        <Text style={styles.smallText}>
          El auto no está donde estaba el cliente al pedir: la ubicación sale de la dirección escrita. Revísala con las
          fotos.
        </Text>
      )}
    </View>
  );
}

/** Miniaturas con su etiqueta, de dos en dos; al tocar una se ve completa. */
export function PhotoThumbs({ photos }: { photos: Array<{ url: string; label: string }> }) {
  const [open, setOpen] = useState<string | null>(null);
  if (photos.length === 0) {
    return null;
  }
  return (
    <>
      <View style={styles.row}>
        {photos.map((photo) => (
          <Pressable
            key={photo.url}
            style={styles.requestPhotoThumb}
            onPress={() => setOpen(photo.url)}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Ver foto: ${photo.label}`}
          >
            <Image source={{ uri: photo.url }} style={styles.requestPhotoImage} />
            <Text style={styles.requestPhotoLabel}>{photo.label}</Text>
          </Pressable>
        ))}
      </View>
      <Modal visible={open !== null} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <Pressable style={styles.photoViewer} onPress={() => setOpen(null)} accessibilityLabel="Cerrar foto">
          {open ? <Image source={{ uri: open }} style={styles.photoViewerImage} resizeMode="contain" /> : null}
          <View style={styles.photoViewerClose}>
            <Ionicons name="close" size={22} color={colors.white} />
            <Text style={styles.photoViewerCloseText}>Cerrar</Text>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
