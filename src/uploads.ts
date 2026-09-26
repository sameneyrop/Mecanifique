import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Fotos que suben los mecánicos (foto principal y fotos de trabajos).
 * Viven dentro de data/, que en Render es el disco persistente — el mismo
 * donde está la base de SQLite — así que sobreviven a cada deploy.
 */
export const uploadsDir = path.resolve(process.cwd(), "data", "uploads");
export const PHOTO_UPLOAD_PATH = "/api/uploads/photo";

// La app ya reduce la foto antes de subirla (~200 KB); esto solo frena
// archivos absurdos.
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

/** Guarda la foto con un nombre aleatorio y devuelve ese nombre. */
export async function savePhoto(photo: { buffer: Buffer; extension: "jpg" | "png" }): Promise<string> {
  await fs.promises.mkdir(uploadsDir, { recursive: true });
  const fileName = `${crypto.randomUUID()}.${photo.extension}`;
  await fs.promises.writeFile(path.join(uploadsDir, fileName), photo.buffer);
  return fileName;
}
