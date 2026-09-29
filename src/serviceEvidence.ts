import { all, get, run } from "./db";

/**
 * Protección del cliente (y del mecánico) después del servicio:
 *
 * - Fotos de antes y después: el mecánico toma al menos una de "antes" para
 *   empezar a reparar y una de "después" para terminar un servicio donde hubo
 *   reparación (cotización aceptada). Sirven de evidencia si hay disputa.
 * - Piezas cambiadas: al terminar, el mecánico dice si se las entregó al
 *   cliente, si el cliente no las quiso o si no se cambiaron piezas.
 * - La garantía de la mano de obra va en la cotización (service_quotes.warranty_days).
 */

export type ServicePhotoKind = "before" | "after";
export type OldPartsStatus = "delivered" | "declined" | "none";

const MAX_PHOTOS_PER_KIND = 6;
// Mientras el mecánico está con el auto.
const EVIDENCE_STATUSES = new Set(["on_site", "in_progress", "diagnosing", "repairing", "awaiting_parts"]);

export class ServiceEvidenceError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

async function assignedRequest(requestId: number, mechanicId: number | null | undefined) {
  const request = await get<{ mechanicId: number | null; status: string }>(
    "SELECT mechanic_id AS mechanicId, status FROM service_requests WHERE id = ?",
    [requestId]
  );
  if (!request) {
    throw new ServiceEvidenceError(404, "Solicitud no encontrada");
  }
  if (!mechanicId || request.mechanicId !== mechanicId) {
    throw new ServiceEvidenceError(403, "Solo el mecánico del servicio puede hacer esto");
  }
  return request;
}

export async function addServicePhoto(input: {
  requestId: number;
  mechanicId: number | null | undefined;
  kind: ServicePhotoKind;
  /** Guarda la foto y devuelve su dirección; se llama después de validar. */
  savePhoto: () => Promise<string>;
}): Promise<{ id: number; kind: ServicePhotoKind; photoUrl: string }> {
  const request = await assignedRequest(input.requestId, input.mechanicId);
  if (!EVIDENCE_STATUSES.has(request.status)) {
    throw new ServiceEvidenceError(409, "Las fotos se toman mientras estás con el auto.");
  }
  const count = await get<{ total: number }>(
    "SELECT COUNT(*) AS total FROM service_photos WHERE service_request_id = ? AND kind = ?",
    [input.requestId, input.kind]
  );
  if (Number(count?.total ?? 0) >= MAX_PHOTOS_PER_KIND) {
    throw new ServiceEvidenceError(409, `Ya subiste ${MAX_PHOTOS_PER_KIND} fotos de este tipo.`);
  }
  const photoUrl = await input.savePhoto();
  const result = await run(
    "INSERT INTO service_photos (service_request_id, mechanic_id, kind, photo_url) VALUES (?, ?, ?, ?)",
    [input.requestId, input.mechanicId as number, input.kind, photoUrl]
  );
  return { id: result.lastID, kind: input.kind, photoUrl };
}

export async function getServicePhotos(
  requestId: number
): Promise<Array<{ id: number; kind: ServicePhotoKind; photoUrl: string; createdAt: string }>> {
  return all(
    `SELECT id, kind, photo_url AS photoUrl, created_at AS createdAt
     FROM service_photos WHERE service_request_id = ? ORDER BY id`,
    [requestId]
  );
}

export async function hasServicePhoto(requestId: number, kind: ServicePhotoKind): Promise<boolean> {
  return Boolean(
    await get<{ id: number }>("SELECT id FROM service_photos WHERE service_request_id = ? AND kind = ? LIMIT 1", [requestId, kind])
  );
}

export async function setOldPartsStatus(input: {
  requestId: number;
  mechanicId: number | null | undefined;
  status: OldPartsStatus;
}): Promise<void> {
  const request = await assignedRequest(input.requestId, input.mechanicId);
  if (!EVIDENCE_STATUSES.has(request.status)) {
    throw new ServiceEvidenceError(409, "Esto se marca antes de terminar el servicio.");
  }
  await run("UPDATE service_requests SET old_parts_status = ? WHERE id = ?", [input.status, input.requestId]);
}

export async function getOldPartsStatus(requestId: number): Promise<OldPartsStatus | null> {
  const row = await get<{ status: OldPartsStatus | null }>("SELECT old_parts_status AS status FROM service_requests WHERE id = ?", [
    requestId
  ]);
  return row?.status ?? null;
}
