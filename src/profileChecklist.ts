import { get } from "./db";

/**
 * "Completa tu perfil" en Inicio: qué le falta a cada cuenta, para que la
 * app lo recomiende (los textos viven en la app, mobile/components/ProfileChecklist.tsx).
 *
 * - Cliente: nombre, foto, teléfono, su auto y un mecánico favorito.
 * - Mecánico (ya activo: foto, identidad y precio van en "Activa tu cuenta"):
 *   portada, descripción, fotos de su trabajo, horarios en la agenda, CLABE
 *   para propinas y una promoción.
 */

export type ChecklistItem = { key: string; done: boolean };

const REAL_PHONE_SQL = (column: string) => `${column} GLOB '[0-9+(]*' AND LENGTH(${column}) >= 8`;

export async function profileChecklist(user: {
  id: number;
  role: string;
  fullName: string;
  customerId: number | null;
  mechanicId: number | null;
}): Promise<ChecklistItem[]> {
  if (user.role === "mechanic" && user.mechanicId) {
    const row = await get<{
      cover: number;
      bio: number;
      gallery: number;
      tips: number;
      schedule: number;
      promotion: number;
    }>(
      `SELECT
         cover_photo_url IS NOT NULL AND cover_photo_url <> '' AS cover,
         LENGTH(TRIM(COALESCE(bio, ''))) >= 20 AS bio,
         COALESCE(gallery_json, '[]') NOT IN ('', '[]') AS gallery,
         tip_clabe IS NOT NULL AND tip_clabe <> '' AS tips,
         EXISTS(SELECT 1 FROM mechanic_schedule_slots s
                WHERE s.mechanic_id = m.id AND s.status = 'available' AND s.slot_date >= date('now', '-6 hours')) AS schedule,
         EXISTS(SELECT 1 FROM mechanic_promotions p
                WHERE p.mechanic_id = m.id AND p.is_active = 1
                  AND (p.valid_until IS NULL OR p.valid_until >= date('now', '-6 hours'))) AS promotion
       FROM mechanics m WHERE m.id = ?`,
      [user.mechanicId]
    );
    return (["cover", "bio", "gallery", "schedule", "tips", "promotion"] as const).map((key) => ({
      key,
      done: Boolean(row?.[key])
    }));
  }

  if (user.role === "customer" && user.customerId) {
    const row = await get<{ phone: number; photo: number; vehicle: number; favorite: number }>(
      `SELECT
         ${REAL_PHONE_SQL("c.phone")} AS phone,
         c.photo_url IS NOT NULL AND c.photo_url <> '' AS photo,
         EXISTS(SELECT 1 FROM vehicle_profiles v WHERE v.customer_id = c.id) AS vehicle,
         EXISTS(SELECT 1 FROM favorite_mechanics f WHERE f.user_id = ?) AS favorite
       FROM customers c WHERE c.id = ?`,
      [user.id, user.customerId]
    );
    // Sin nombre, el registro guarda el correo como nombre.
    const hasName = Boolean(user.fullName?.trim()) && !user.fullName.includes("@");
    return [
      { key: "name", done: hasName },
      { key: "photo", done: Boolean(row?.photo) },
      { key: "phone", done: Boolean(row?.phone) },
      { key: "vehicle", done: Boolean(row?.vehicle) },
      { key: "favorite", done: Boolean(row?.favorite) }
    ];
  }

  return [];
}
