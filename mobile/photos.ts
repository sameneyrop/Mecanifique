import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/**
 * Foto de evidencia (ticket de refacciones, etc.): solo con la cámara, en ese
 * momento, sin elegir de la galería ni recortar, para que no se pueda usar una
 * foto vieja o editada. Se reduce en el teléfono (máx. 1600 px, legible para
 * un ticket) y se devuelve en base64 para subirla. null si se canceló.
 */
export async function takeEvidencePhoto(): Promise<string | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Necesitamos permiso para usar la cámara. Puedes darlo en los ajustes del teléfono.');
  }
  const picked = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 });
  const asset = picked.canceled ? null : picked.assets[0];
  if (!asset) {
    return null;
  }
  const context = ImageManipulator.manipulate(asset.uri);
  const longest = Math.max(asset.width, asset.height);
  if (longest > 1600) {
    context.resize(asset.width >= asset.height ? { width: 1600 } : { height: 1600 });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ base64: true, compress: 0.7, format: SaveFormat.JPEG });
  if (!saved.base64) {
    throw new Error('No se pudo preparar la foto');
  }
  return saved.base64;
}
