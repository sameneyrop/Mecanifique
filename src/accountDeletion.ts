import { get, transaction } from "./db";
import { recordFingerprintsBeforeDeletion } from "./unpaidFingerprints";

/**
 * Eliminación de cuenta (requisito de Google Play).
 *
 * Se BORRA lo que es solo de la persona: datos de perfil, vehículos,
 * favoritos, notificaciones, verificación de identidad, contenido de
 * Comunidad, fotos, promociones y turnos libres.
 *
 * Se ANONIMIZA lo que también es historial de otra persona: la fila de
 * users/customers/mechanics queda como "Cuenta eliminada" (sin correo,
 * teléfono ni vínculo con Supabase), las solicitudes pierden dirección y
 * ubicación, los mensajes de chat quedan como "Mensaje eliminado" y las
 * reseñas conservan la calificación (para no alterar la del mecánico) pero
 * pierden el comentario.
 *
 * Se CONSERVAN, ya sin datos que identifiquen, las alertas de emergencia,
 * disputas y pagos, por motivos de seguridad y legales. Si debe un servicio,
 * antes se guarda la huella cifrada de la cuenta (src/unpaidFingerprints.ts)
 * para que no abra otra cuenta y pida sin pagarlo; deja de contar al pagarse.
 */

type DeletableUser = {
  id: number;
  customerId: number | null;
  mechanicId: number | null;
};

// Estados en los que un servicio sigue vivo. Para el cliente cuenta también
// 'pending' (su solicitud sigue buscando mecánico).
const MECHANIC_ACTIVE_STATUSES = "('assigned', 'in_progress', 'en_route', 'on_site', 'diagnosing', 'repairing', 'awaiting_parts')";
const CUSTOMER_ACTIVE_STATUSES = "('pending', 'assigned', 'in_progress', 'en_route', 'on_site', 'diagnosing', 'repairing', 'awaiting_parts')";

/** true si la cuenta tiene un servicio en curso (como cliente o como mecánico). */
export async function hasActiveServiceBlockingDeletion(user: DeletableUser): Promise<boolean> {
  if (user.customerId) {
    const asCustomer = await get<{ id: number }>(
      `SELECT id FROM service_requests WHERE customer_id = ? AND status IN ${CUSTOMER_ACTIVE_STATUSES} LIMIT 1`,
      [user.customerId]
    );
    if (asCustomer) return true;
  }
  if (user.mechanicId) {
    const asMechanic = await get<{ id: number }>(
      `SELECT id FROM service_requests WHERE mechanic_id = ? AND status IN ${MECHANIC_ACTIVE_STATUSES} LIMIT 1`,
      [user.mechanicId]
    );
    if (asMechanic) return true;
  }
  return false;
}

/** Borra y anonimiza los datos de la cuenta, todo o nada (una transacción). */
export async function anonymizeAccount(user: DeletableUser): Promise<void> {
  const userId = user.id;
  const customerId = user.customerId ?? -1;
  const mechanicId = user.mechanicId ?? -1;

  // Antes de borrar teléfono, correo y celulares: la huella de lo que debe.
  await recordFingerprintsBeforeDeletion(user.customerId);

  await transaction([
    // Solo de la persona: se borra.
    { sql: "DELETE FROM push_tokens WHERE user_id = ?", params: [userId] },
    { sql: "DELETE FROM trusted_devices WHERE user_id = ?", params: [userId] },
    { sql: "DELETE FROM user_devices WHERE user_id = ?", params: [userId] },
    // Las calificaciones que le pusieron los mecánicos son datos sobre la persona.
    { sql: "DELETE FROM customer_reviews WHERE customer_id = ?", params: [customerId] },
    { sql: "DELETE FROM notifications WHERE user_id = ?", params: [userId] },
    { sql: "DELETE FROM sessions WHERE user_id = ?", params: [userId] },
    { sql: "DELETE FROM favorite_mechanics WHERE user_id = ? OR mechanic_id = ?", params: [userId, mechanicId] },
    { sql: "DELETE FROM support_requests WHERE user_id = ?", params: [userId] },
    { sql: "DELETE FROM uploaded_photos WHERE uploaded_by_user_id = ?", params: [userId] },
    { sql: "DELETE FROM vehicle_profiles WHERE customer_id = ?", params: [customerId] },
    { sql: "DELETE FROM mechanic_promotions WHERE mechanic_id = ?", params: [mechanicId] },
    { sql: "DELETE FROM mechanic_schedule_slots WHERE mechanic_id = ? AND status = 'available'", params: [mechanicId] },
    {
      sql: "DELETE FROM identity_verification_documents WHERE verification_id IN (SELECT id FROM identity_verifications WHERE user_id = ?)",
      params: [userId]
    },
    { sql: "UPDATE identity_verifications SET reviewed_by_user_id = NULL WHERE reviewed_by_user_id = ?", params: [userId] },
    { sql: "DELETE FROM identity_verifications WHERE user_id = ?", params: [userId] },
    // Comunidad: sus reacciones, sus preguntas (con sus respuestas) y sus respuestas.
    {
      sql: `DELETE FROM community_reactions
            WHERE user_id = ?
               OR (target_type = 'question' AND target_id IN (SELECT id FROM community_questions WHERE author_user_id = ?))
               OR (target_type = 'answer' AND target_id IN (
                    SELECT a.id FROM community_answers a
                    LEFT JOIN community_questions q ON q.id = a.question_id
                    WHERE a.author_user_id = ? OR q.author_user_id = ?))`,
      params: [userId, userId, userId, userId]
    },
    {
      sql: `DELETE FROM community_answers
            WHERE author_user_id = ? OR question_id IN (SELECT id FROM community_questions WHERE author_user_id = ?)`,
      params: [userId, userId]
    },
    { sql: "DELETE FROM community_questions WHERE author_user_id = ?", params: [userId] },

    // Historial compartido: se anonimiza.
    {
      sql: "UPDATE service_requests SET service_address = NULL, latitude = NULL, longitude = NULL WHERE customer_id = ?",
      params: [customerId]
    },
    { sql: "UPDATE service_request_messages SET message = 'Mensaje eliminado' WHERE sender_user_id = ?", params: [userId] },
    { sql: "UPDATE mechanic_reviews SET comment = '' WHERE customer_user_id = ?", params: [userId] },
    {
      sql: "UPDATE customers SET full_name = 'Cliente eliminado', phone = 'eliminado-c' || id, photo_url = NULL WHERE id = ?",
      params: [customerId]
    },
    {
      sql: `UPDATE mechanics
            SET full_name = 'Mecánico eliminado', phone = 'eliminado-m' || id, status = 'suspended',
                is_online = 0, is_available = 0, bio = NULL, cover_photo_url = NULL, profile_photo_url = NULL, gallery_json = '[]',
                latitude = NULL, longitude = NULL, location_updated_at = NULL,
                tip_clabe = NULL, tip_holder_name = NULL
            WHERE id = ?`,
      params: [mechanicId]
    },
    {
      sql: `UPDATE users
            SET full_name = 'Cuenta eliminada', login = 'eliminada-' || id || '@mecanifique.invalid',
                supabase_user_id = NULL, verified_phone = NULL, phone_verified_at = NULL,
                deleted_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
      params: [userId]
    }
  ]);
}

// ---------------------------------------------------------------------------
// Página web /eliminar-cuenta (fuera de la app, como pide Google Play)
// ---------------------------------------------------------------------------

function page(body: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Eliminar tu cuenta · Mecanifique</title>
<style>
  body { margin: 0; background: #E3ECF8; color: #0b0f22; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 560px; margin: 0 auto; padding: 24px 16px 48px; }
  .logo { color: #1C6DC4; font-weight: 800; font-size: 22px; }
  .card { background: #fff; border-radius: 20px; padding: 20px; margin-top: 16px; }
  h1 { font-size: 24px; margin: 16px 0 8px; }
  h2 { font-size: 18px; margin: 0 0 8px; }
  p, li { font-size: 16px; line-height: 1.5; color: #4A5568; }
  label { display: block; font-weight: 700; margin: 12px 0 6px; }
  input, textarea { width: 100%; box-sizing: border-box; font-size: 16px; padding: 12px; border: 1px solid #D6E4F5; border-radius: 12px; background: #EEF3FA; }
  button { width: 100%; margin-top: 16px; padding: 14px; font-size: 16px; font-weight: 800; color: #fff; background: #2F8FEA; border: 0; border-radius: 999px; }
</style>
</head>
<body><main><div class="logo">Mecanifique</div>${body}</main></body>
</html>`;
}

const RETENTION_SECTION = `
<div class="card">
  <h2>Qué pasa con tus datos</h2>
  <ul>
    <li><strong>Se borran:</strong> nombre, correo, teléfono, vehículos, favoritos, notificaciones, verificación de identidad, preguntas y respuestas de Comunidad, fotos y promociones.</li>
    <li><strong>Se anonimizan:</strong> los servicios que hiciste quedan sin tu nombre, dirección ni ubicación (son parte del historial de la otra persona); tus reseñas conservan la calificación pero no el comentario.</li>
    <li><strong>Se conservan sin datos que te identifiquen:</strong> alertas de emergencia, disputas y pagos, por motivos de seguridad y legales.</li>
  </ul>
</div>`;

export function deletionRequestPage(): string {
  return page(`
<h1>Eliminar tu cuenta</h1>
<div class="card">
  <h2>Desde la app (inmediato)</h2>
  <p>Abre Mecanifique → <strong>Cuenta</strong> → <strong>Seguridad</strong> → <strong>Eliminar mi cuenta</strong>. Si eres mecánico: <strong>Acciones</strong> → <strong>Eliminar mi cuenta</strong>.</p>
</div>
<div class="card">
  <h2>Sin la app</h2>
  <p>Escribe el correo con el que te registraste y eliminaremos tu cuenta en un plazo máximo de 30 días.</p>
  <form method="post" action="/eliminar-cuenta">
    <label for="email">Correo de tu cuenta</label>
    <input id="email" name="email" type="email" required maxlength="254" autocomplete="email">
    <label for="message">Comentario (opcional)</label>
    <textarea id="message" name="message" rows="3" maxlength="1000"></textarea>
    <button type="submit">Solicitar eliminación</button>
  </form>
</div>
${RETENTION_SECTION}`);
}

export function deletionRequestReceivedPage(): string {
  return page(`
<h1>Recibimos tu solicitud</h1>
<div class="card">
  <p>Eliminaremos la cuenta asociada a ese correo en un plazo máximo de 30 días. Si no existe una cuenta con ese correo, no hay nada que eliminar.</p>
</div>
${RETENTION_SECTION}`);
}

export function deletionRequestErrorPage(message: string): string {
  // message es siempre un texto fijo del servidor, nunca lo que escribió el usuario.
  return page(`
<h1>No pudimos enviar tu solicitud</h1>
<div class="card"><p>${message}</p><p><a href="/eliminar-cuenta">Volver a intentar</a></p></div>`);
}
