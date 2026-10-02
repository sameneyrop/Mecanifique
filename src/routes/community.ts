import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { all, get, run } from "../db";
import { requireAuth, requireRole } from "../auth";
import { handleAsync } from "../middleware";
import { approximateLocation } from "../privacy";

/**
 * Comunidad (preguntas de clientes que responden mecánicos verificados;
 * quien "sigue" una pregunta recibe aviso de cada respuesta) y
 * promociones de mecánicos. Las dependencias que viven en server.ts
 * (notificaciones, distancia, límite de intentos) se inyectan para no
 * duplicarlas.
 */
type CommunityDeps = {
  createNotification: (
    userId: number,
    title: string,
    body: string,
    data?: Record<string, string | number | boolean | null>
  ) => Promise<void>;
  calculateDistanceKm: (latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number) => number;
  applyRateLimit: (scope: string, req: Request, res: Response, limit?: number, windowMs?: number) => boolean;
};

export const COMMUNITY_CATEGORIES = ["frenos", "suspension", "transmision", "motor", "electrico", "llantas", "otro"] as const;

/**
 * Nombre público de quien pregunta: "Emilio L." (primer nombre + inicial),
 * para no exponer el nombre completo de un cliente. Si la cuenta no tiene
 * nombre (fullName es el correo), "Usuario".
 */
export function communityAuthorName(fullName: string | null | undefined): string {
  const name = (fullName || "").trim();
  if (!name || name.includes("@")) {
    return "Usuario";
  }
  const [first, second] = name.split(/\s+/);
  return second ? `${first} ${second[0].toUpperCase()}.` : first;
}

function parseId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

const questionCreateSchema = z.object({
  title: z.string().trim().min(5).max(120),
  body: z.string().trim().min(10).max(2000),
  category: z.enum(COMMUNITY_CATEGORIES),
  vehicleLabel: z.string().trim().min(2).max(80).optional()
});

const answerCreateSchema = z.object({ body: z.string().trim().min(10).max(2000) });

const promotionCreateSchema = z.object({
  title: z.string().trim().min(5).max(80),
  description: z.string().trim().min(10).max(500),
  validUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD)")
    .refine((value) => value >= new Date().toISOString().slice(0, 10), "La fecha ya pasó")
    .optional()
});

// Máximo de promociones guardadas por mecánico (activas o pausadas).
const MAX_PROMOTIONS_PER_MECHANIC = 20;

type QuestionRow = {
  id: number;
  title: string;
  body: string;
  category: string;
  vehicleLabel: string | null;
  createdAt: string;
  authorUserId: number;
  authorFullName: string;
  answerCount: number;
  followerCount: number;
  followedByMe: number;
};

const QUESTION_SELECT = `
  SELECT q.id, q.title, q.body, q.category, q.vehicle_label AS vehicleLabel, q.created_at AS createdAt,
         q.author_user_id AS authorUserId, u.full_name AS authorFullName,
         (SELECT COUNT(*) FROM community_answers a WHERE a.question_id = q.id) AS answerCount,
         (SELECT COUNT(*) FROM community_reactions r WHERE r.target_type = 'question' AND r.target_id = q.id) AS followerCount,
         EXISTS (
           SELECT 1 FROM community_reactions r
           WHERE r.target_type = 'question' AND r.target_id = q.id AND r.user_id = ?
         ) AS followedByMe
  FROM community_questions q
  JOIN users u ON u.id = q.author_user_id
`;

function toQuestion(row: QuestionRow, viewerUserId: number) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    category: row.category,
    vehicleLabel: row.vehicleLabel,
    createdAt: row.createdAt,
    authorName: communityAuthorName(row.authorFullName),
    isMine: row.authorUserId === viewerUserId,
    answerCount: Number(row.answerCount),
    followerCount: Number(row.followerCount),
    followedByMe: Boolean(row.followedByMe)
  };
}

async function toggleReaction(
  userId: number,
  targetType: "question" | "answer",
  targetId: number
): Promise<{ active: boolean; count: number }> {
  const removed = await run(
    "DELETE FROM community_reactions WHERE user_id = ? AND target_type = ? AND target_id = ?",
    [userId, targetType, targetId]
  );
  if (removed.changes === 0) {
    await run(
      "INSERT OR IGNORE INTO community_reactions (user_id, target_type, target_id) VALUES (?, ?, ?)",
      [userId, targetType, targetId]
    );
  }
  const count = await get<{ total: number }>(
    "SELECT COUNT(*) AS total FROM community_reactions WHERE target_type = ? AND target_id = ?",
    [targetType, targetId]
  );
  return { active: removed.changes === 0, count: Number(count?.total ?? 0) };
}

export function createCommunityRouter({ createNotification, calculateDistanceKm, applyRateLimit }: CommunityDeps) {
  const router = Router();

  // ---------------------------------------------------------------------
  // Comunidad
  // ---------------------------------------------------------------------

  router.get("/community/questions", requireAuth, handleAsync(async (req, res) => {
    const viewer = req.auth!.user;
    const scope = req.query.scope === "mine" ? "mine" : "public";
    const category = typeof req.query.category === "string" && (COMMUNITY_CATEGORIES as readonly string[]).includes(req.query.category)
      ? req.query.category
      : null;
    const search = typeof req.query.q === "string" && req.query.q.trim() ? `%${escapeLike(req.query.q.trim())}%` : null;

    const rows = await all<QuestionRow>(
      `${QUESTION_SELECT}
       WHERE (? = 'public' OR q.author_user_id = ?)
         AND (? IS NULL OR q.category = ?)
         AND (? IS NULL OR q.title LIKE ? ESCAPE '\\' OR q.body LIKE ? ESCAPE '\\')
       ORDER BY q.created_at DESC, q.id DESC
       LIMIT 50`,
      [viewer.id, scope, viewer.id, category, category, search, search, search]
    );
    res.json({ questions: rows.map((row) => toQuestion(row, viewer.id)) });
  }));

  router.post("/community/questions", requireAuth, handleAsync(async (req, res) => {
    if (applyRateLimit("community-question", req, res)) {
      return;
    }
    const payload = questionCreateSchema.parse(req.body);
    const result = await run(
      "INSERT INTO community_questions (author_user_id, title, body, category, vehicle_label) VALUES (?, ?, ?, ?, ?)",
      [req.auth!.user.id, payload.title, payload.body, payload.category, payload.vehicleLabel ?? null]
    );
    res.status(201).json({ id: result.lastID });
  }));

  router.get("/community/questions/:id", requireAuth, handleAsync(async (req, res) => {
    const viewer = req.auth!.user;
    const questionId = parseId(req.params.id);
    if (!questionId) {
      res.status(400).json({ error: "Pregunta inválida" });
      return;
    }
    const question = await get<QuestionRow>(`${QUESTION_SELECT} WHERE q.id = ?`, [viewer.id, questionId]);
    if (!question) {
      res.status(404).json({ error: "Pregunta no encontrada" });
      return;
    }
    const answers = await all<{
      id: number;
      body: string;
      createdAt: string;
      mechanicId: number;
      authorUserId: number;
      mechanicName: string;
      mechanicStatus: string;
      rating: number;
      jobsCompleted: number;
      helpfulCount: number;
      helpfulByMe: number;
    }>(
      `SELECT a.id, a.body, a.created_at AS createdAt, a.mechanic_id AS mechanicId, a.author_user_id AS authorUserId,
              m.full_name AS mechanicName, m.status AS mechanicStatus, m.rating, m.jobs_completed AS jobsCompleted,
              (SELECT COUNT(*) FROM community_reactions r WHERE r.target_type = 'answer' AND r.target_id = a.id) AS helpfulCount,
              EXISTS (
                SELECT 1 FROM community_reactions r
                WHERE r.target_type = 'answer' AND r.target_id = a.id AND r.user_id = ?
              ) AS helpfulByMe
       FROM community_answers a
       JOIN mechanics m ON m.id = a.mechanic_id
       WHERE a.question_id = ?
       ORDER BY helpfulCount DESC, a.created_at ASC`,
      [viewer.id, questionId]
    );
    res.json({
      question: toQuestion(question, viewer.id),
      answers: answers.map((answer) => ({
        id: answer.id,
        body: answer.body,
        createdAt: answer.createdAt,
        mechanicId: answer.mechanicId,
        mechanicName: answer.mechanicName,
        mechanicVerified: answer.mechanicStatus === "active",
        rating: answer.rating,
        jobsCompleted: answer.jobsCompleted,
        helpfulCount: Number(answer.helpfulCount),
        helpfulByMe: Boolean(answer.helpfulByMe),
        isMine: answer.authorUserId === viewer.id
      }))
    });
  }));

  router.delete("/community/questions/:id", requireAuth, handleAsync(async (req, res) => {
    const viewer = req.auth!.user;
    const questionId = parseId(req.params.id);
    if (!questionId) {
      res.status(400).json({ error: "Pregunta inválida" });
      return;
    }
    const question = await get<{ authorUserId: number }>(
      "SELECT author_user_id AS authorUserId FROM community_questions WHERE id = ?",
      [questionId]
    );
    if (!question) {
      res.status(404).json({ error: "Pregunta no encontrada" });
      return;
    }
    if (question.authorUserId !== viewer.id && viewer.role !== "admin") {
      res.status(403).json({ error: "Solo puedes borrar tus propias preguntas" });
      return;
    }
    await run(
      `DELETE FROM community_reactions
       WHERE (target_type = 'question' AND target_id = ?)
          OR (target_type = 'answer' AND target_id IN (SELECT id FROM community_answers WHERE question_id = ?))`,
      [questionId, questionId]
    );
    await run("DELETE FROM community_answers WHERE question_id = ?", [questionId]);
    await run("DELETE FROM community_questions WHERE id = ?", [questionId]);
    res.json({ ok: true });
  }));

  router.post("/community/questions/:id/answers", requireAuth, requireRole("mechanic"), handleAsync(async (req, res) => {
    if (applyRateLimit("community-answer", req, res, 10)) {
      return;
    }
    const viewer = req.auth!.user;
    const questionId = parseId(req.params.id);
    if (!questionId) {
      res.status(400).json({ error: "Pregunta inválida" });
      return;
    }
    const mechanic = viewer.mechanicId
      ? await get<{ id: number; status: string; fullName: string }>(
          "SELECT id, status, full_name AS fullName FROM mechanics WHERE id = ?",
          [viewer.mechanicId]
        )
      : undefined;
    if (!mechanic || mechanic.status !== "active") {
      res.status(403).json({ error: "Solo los mecánicos verificados pueden responder. Verifica tu identidad en Inicio." });
      return;
    }
    const question = await get<{ authorUserId: number; title: string }>(
      "SELECT author_user_id AS authorUserId, title FROM community_questions WHERE id = ?",
      [questionId]
    );
    if (!question) {
      res.status(404).json({ error: "Pregunta no encontrada" });
      return;
    }
    const payload = answerCreateSchema.parse(req.body);
    const result = await run(
      "INSERT INTO community_answers (question_id, mechanic_id, author_user_id, body) VALUES (?, ?, ?, ?)",
      [questionId, mechanic.id, viewer.id, payload.body]
    );
    if (question.authorUserId !== viewer.id) {
      await createNotification(
        question.authorUserId,
        "Un mecánico respondió tu pregunta",
        `${mechanic.fullName} respondió "${question.title}"`,
        { questionId }
      );
    }
    const followers = await all<{ userId: number }>(
      `SELECT user_id AS userId FROM community_reactions
       WHERE target_type = 'question' AND target_id = ? AND user_id NOT IN (?, ?)`,
      [questionId, question.authorUserId, viewer.id]
    );
    await Promise.all(
      followers.map((follower) =>
        createNotification(
          follower.userId,
          "Nueva respuesta en una pregunta que sigues",
          `${mechanic.fullName} respondió "${question.title}"`,
          { questionId }
        )
      )
    );
    res.status(201).json({ id: result.lastID });
  }));

  router.delete("/community/answers/:id", requireAuth, handleAsync(async (req, res) => {
    const viewer = req.auth!.user;
    const answerId = parseId(req.params.id);
    if (!answerId) {
      res.status(400).json({ error: "Respuesta inválida" });
      return;
    }
    const answer = await get<{ authorUserId: number }>(
      "SELECT author_user_id AS authorUserId FROM community_answers WHERE id = ?",
      [answerId]
    );
    if (!answer) {
      res.status(404).json({ error: "Respuesta no encontrada" });
      return;
    }
    if (answer.authorUserId !== viewer.id && viewer.role !== "admin") {
      res.status(403).json({ error: "Solo puedes borrar tus propias respuestas" });
      return;
    }
    await run("DELETE FROM community_reactions WHERE target_type = 'answer' AND target_id = ?", [answerId]);
    await run("DELETE FROM community_answers WHERE id = ?", [answerId]);
    res.json({ ok: true });
  }));

  // Seguir una pregunta ajena: avisa de cada respuesta nueva.
  router.post("/community/questions/:id/follow", requireAuth, handleAsync(async (req, res) => {
    if (applyRateLimit("community-reaction", req, res, 60)) {
      return;
    }
    const questionId = parseId(req.params.id);
    const question = questionId
      ? await get<{ authorUserId: number }>("SELECT author_user_id AS authorUserId FROM community_questions WHERE id = ?", [questionId])
      : undefined;
    if (!questionId || !question) {
      res.status(404).json({ error: "Pregunta no encontrada" });
      return;
    }
    if (question.authorUserId === req.auth!.user.id) {
      res.status(400).json({ error: "Ya te avisamos de las respuestas a tus preguntas" });
      return;
    }
    res.json(await toggleReaction(req.auth!.user.id, "question", questionId));
  }));

  // Marcar como útil una respuesta ajena.
  router.post("/community/answers/:id/helpful", requireAuth, handleAsync(async (req, res) => {
    if (applyRateLimit("community-reaction", req, res, 60)) {
      return;
    }
    const answerId = parseId(req.params.id);
    const answer = answerId
      ? await get<{ authorUserId: number }>("SELECT author_user_id AS authorUserId FROM community_answers WHERE id = ?", [answerId])
      : undefined;
    if (!answerId || !answer) {
      res.status(404).json({ error: "Respuesta no encontrada" });
      return;
    }
    if (answer.authorUserId === req.auth!.user.id) {
      res.status(400).json({ error: "Es tu propia respuesta" });
      return;
    }
    res.json(await toggleReaction(req.auth!.user.id, "answer", answerId));
  }));

  // ---------------------------------------------------------------------
  // Promociones
  // ---------------------------------------------------------------------

  // Promociones vigentes de mecánicos activos, las más cercanas primero
  // (si se manda la ubicación). Con mechanicId, solo las de ese mecánico.
  router.get("/promotions", requireAuth, handleAsync(async (req, res) => {
    const latitude = Number(req.query.latitude);
    const longitude = Number(req.query.longitude);
    const hasCoords = Number.isFinite(latitude) && Number.isFinite(longitude) && req.query.latitude !== undefined;
    const mechanicId = parseId(req.query.mechanicId);

    const rows = await all<{
      id: number;
      title: string;
      description: string;
      validUntil: string | null;
      mechanicId: number;
      mechanicName: string;
      city: string;
      zone: string;
      rating: number;
      latitude: number | null;
      longitude: number | null;
    }>(
      `SELECT p.id, p.title, p.description, p.valid_until AS validUntil, p.mechanic_id AS mechanicId,
              m.full_name AS mechanicName, m.city, m.zone, m.rating, m.latitude, m.longitude
       FROM mechanic_promotions p
       JOIN mechanics m ON m.id = p.mechanic_id
       WHERE p.is_active = 1
         AND m.status = 'active'
         AND (p.valid_until IS NULL OR p.valid_until >= date('now'))
         AND (? IS NULL OR p.mechanic_id = ?)
       ORDER BY p.created_at DESC
       LIMIT 100`,
      [mechanicId, mechanicId]
    );

    // La distancia sale de la ubicación aproximada del mecánico, nunca de la
    // exacta: midiendo desde varios puntos se le podría ubicar (src/privacy.ts).
    const promotions = rows
      .map(({ latitude: mechanicLatitude, longitude: mechanicLongitude, ...promotion }) => {
        const approximate = approximateLocation(mechanicLatitude, mechanicLongitude);
        return {
          ...promotion,
          distanceKm:
            hasCoords && approximate
              ? Math.round(calculateDistanceKm(latitude, longitude, approximate.latitude, approximate.longitude) * 10) / 10
              : null
        };
      })
      .sort((a, b) => (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY));

    res.json({ promotions });
  }));

  router.get("/promotions/mine", requireAuth, requireRole("mechanic"), handleAsync(async (req, res) => {
    const rows = await all<{
      id: number;
      title: string;
      description: string;
      validUntil: string | null;
      isActive: number;
      isExpired: number;
      createdAt: string;
    }>(
      `SELECT id, title, description, valid_until AS validUntil, is_active AS isActive,
              (valid_until IS NOT NULL AND valid_until < date('now')) AS isExpired, created_at AS createdAt
       FROM mechanic_promotions
       WHERE mechanic_id = ?
       ORDER BY created_at DESC`,
      [req.auth!.user.mechanicId ?? 0]
    );
    res.json({
      promotions: rows.map((row) => ({ ...row, isActive: Boolean(row.isActive), isExpired: Boolean(row.isExpired) }))
    });
  }));

  router.post("/promotions", requireAuth, requireRole("mechanic"), handleAsync(async (req, res) => {
    const mechanicId = req.auth!.user.mechanicId;
    if (!mechanicId) {
      res.status(400).json({ error: "No encontramos tu perfil de mecánico" });
      return;
    }
    const payload = promotionCreateSchema.parse(req.body);
    const existing = await get<{ total: number }>(
      "SELECT COUNT(*) AS total FROM mechanic_promotions WHERE mechanic_id = ?",
      [mechanicId]
    );
    if (Number(existing?.total ?? 0) >= MAX_PROMOTIONS_PER_MECHANIC) {
      res.status(409).json({ error: `Puedes tener hasta ${MAX_PROMOTIONS_PER_MECHANIC} promociones. Borra alguna para crear otra.` });
      return;
    }
    const result = await run(
      "INSERT INTO mechanic_promotions (mechanic_id, title, description, valid_until) VALUES (?, ?, ?, ?)",
      [mechanicId, payload.title, payload.description, payload.validUntil ?? null]
    );
    res.status(201).json({ id: result.lastID });
  }));

  router.patch("/promotions/:id", requireAuth, requireRole("mechanic"), handleAsync(async (req, res) => {
    const promotionId = parseId(req.params.id);
    const payload = z.object({ isActive: z.boolean() }).parse(req.body);
    const updated = promotionId
      ? await run(
          "UPDATE mechanic_promotions SET is_active = ? WHERE id = ? AND mechanic_id = ?",
          [payload.isActive ? 1 : 0, promotionId, req.auth!.user.mechanicId ?? 0]
        )
      : { changes: 0 };
    if (updated.changes === 0) {
      res.status(404).json({ error: "Promoción no encontrada" });
      return;
    }
    res.json({ ok: true });
  }));

  router.delete("/promotions/:id", requireAuth, handleAsync(async (req, res) => {
    const viewer = req.auth!.user;
    const promotionId = parseId(req.params.id);
    if (!promotionId) {
      res.status(400).json({ error: "Promoción inválida" });
      return;
    }
    const deleted =
      viewer.role === "admin"
        ? await run("DELETE FROM mechanic_promotions WHERE id = ?", [promotionId])
        : await run("DELETE FROM mechanic_promotions WHERE id = ? AND mechanic_id = ?", [promotionId, viewer.mechanicId ?? 0]);
    if (deleted.changes === 0) {
      res.status(404).json({ error: "Promoción no encontrada" });
      return;
    }
    res.json({ ok: true });
  }));

  return router;
}
