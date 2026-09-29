import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/**
 * Foto de evidencia (ticket de refacciones, etc.): solo con la cámara, en ese
 * momento, sin elegir de la galería ni recortar, para que no se pueda usar una
 * foto vieja o editada. Se reduce en el teléfono (máx. 1600 px, legible para
 * un ticket) y se devuelve en base64 para subirla. null si se canceló.
 */
export async function takeEvidencePhoto(): Promise<string | null> {
  return takeCameraPhoto({ allowsEditing: false, quality: 1 }, 1600);
}

/**
 * Foto de perfil del mecánico: una selfie con la cámara frontal (no de la
 * galería, para que sea su cara y no cualquier imagen), recortada en cuadro.
 * Máx. 800 px: se ve en círculo y pesa poco. La cámara frontal es una
 * sugerencia: algunos Android abren la trasera y la persona la cambia.
 */
export async function takeProfilePhoto(): Promise<string | null> {
  return takeCameraPhoto(
    { allowsEditing: true, aspect: [1, 1], quality: 1, cameraType: ImagePicker.CameraType.front },
    800,
  );
}

/**
 * Foto que manda el cliente al pedir (su auto y el lugar donde está): con la
 * cámara o de la galería, porque puede no estar junto al auto.
 */
export async function pickRequestPhoto(source: 'camera' | 'library'): Promise<string | null> {
  if (source === 'camera') {
    return takeCameraPhoto({ allowsEditing: false, quality: 1 }, 1600);
  }
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 });
  return resizeToBase64(picked.canceled ? null : picked.assets[0], 1600);
}

async function takeCameraPhoto(options: ImagePicker.ImagePickerOptions, maxSide: number): Promise<string | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Necesitamos permiso para usar la cámara. Puedes darlo en los ajustes del teléfono.');
  }
  const picked = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], ...options });
  return resizeToBase64(picked.canceled ? null : picked.assets[0], maxSide);
}

async function resizeToBase64(asset: ImagePicker.ImagePickerAsset | null | undefined, maxSide: number): Promise<string | null> {
  if (!asset) {
    return null;
  }
  const context = ImageManipulator.manipulate(asset.uri);
  const longest = Math.max(asset.width, asset.height);
  if (longest > maxSide) {
    context.resize(asset.width >= asset.height ? { width: maxSide } : { height: maxSide });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ base64: true, compress: 0.7, format: SaveFormat.JPEG });
  if (!saved.base64) {
    throw new Error('No se pudo preparar la foto');
  }
  return saved.base64;
}
