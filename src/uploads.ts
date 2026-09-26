import crypto from "node:crypto";
import { get, run } from "./db";

/**
 * Fotos que suben los mecánicos (foto principal y fotos de trabajos).
 * Se guardan dentro de la base de datos (tabla uploaded_photos) y no en
 * disco: el plan gratis de Render borra su sistema de archivos en cada
 * deploy y cada vez que el servicio se duerme. La app las reduce antes de
 * subirlas (~200 KB), así que caben bien como BLOB.
 */
export const PHOTO_UPLOAD_PATH = "/api/uploads/photo";

// Solo frena archivos absurdos; lo normal es ~200 KB.
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CONTENT_TYPES = { jpg: "image/jpeg", png: "image/png" } as const;
const FILE_NAME_PATTERN = /^([0-9a-f-]{36})\.(jpg|png)$/;

export class PhotoUploadError extends Error {}

/**
 * Decodifica la foto en base64 y confirma, por sus primeros bytes y no por
 * lo que diga el cliente, que de verdad es un JPG o un PNG.
 */
export function decodePhoto(base64: string): { buffer: Buffer; extension: "jpg" | "png" } {
  const buffer = Buffer.from(base64.replace(/^data:image\/[a-z]+;base64,/i, ""), "base64");
  if (buffer.length === 0) {
    throw new PhotoUploadError("La foto está vacía");
  }
  if (buffer.length > MAX_PHOTO_BYTES) {
    throw new PhotoUploadError("La foto es demasiado grande (máximo 4 MB)");
  }
  if (buffer.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) {
    return { buffer, extension: "jpg" };
  }
  if (buffer.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    return { buffer, extension: "png" };
  }
  throw new PhotoUploadError("Solo se aceptan fotos JPG o PNG");
}

/** Guarda la foto y devuelve su nombre público ("<uuid>.jpg"). */
export async function savePhoto(
  photo: { buffer: Buffer; extension: "jpg" | "png" },
  uploadedByUserId: number | null
): Promise<string> {
  const id = crypto.randomUUID();
  await run(
    "INSERT INTO uploaded_photos (id, content_type, data, uploaded_by_user_id) VALUES (?, ?, ?, ?)",
    [id, CONTENT_TYPES[photo.extension], photo.buffer, uploadedByUserId]
  );
  return `${id}.${photo.extension}`;
}

/** La foto por su nombre público, o null si no existe o el nombre no es válido. */
export async function findPhoto(fileName: string): Promise<{ contentType: string; data: Buffer } | null> {
  const match = FILE_NAME_PATTERN.exec(fileName);
  if (!match) {
    return null;
  }
  const row = await get<{ contentType: string; data: ArrayBuffer | Uint8Array }>(
    "SELECT content_type AS contentType, data FROM uploaded_photos WHERE id = ? AND content_type = ?",
    [match[1], CONTENT_TYPES[match[2] as "jpg" | "png"]]
  );
  if (!row) {
    return null;
  }
  const data = row.data instanceof ArrayBuffer ? Buffer.from(row.data) : Buffer.from(row.data);
  return { contentType: row.contentType, data };
}
