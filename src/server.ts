import "dotenv/config";
import cors from "cors";
import http from "node:http";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import { all, databaseKind, get, initDb, run } from "./db";
import { requireAuth, requireRole, type AuthUser } from "./auth";
import { handleAsync } from "./middleware";
import { vehiclesRouter } from "./routes/vehicles";
import { createCommunityRouter } from "./routes/community";
import {
  supabaseAuthMiddleware,
  requireSupabaseAuth,
  requireSupabaseRole,
  registerCustomerWithSupabase,
  registerMechanicWithSupabase,
  loginWithSupabase,
  refreshSupabaseSession,
  updateSupabaseUser,
  isSupabaseAdminConfigured,
  deleteSupabaseAuthUser
} from "./supabaseAuth";
import {
  anonymizeAccount,
  deletionRequestErrorPage,
  deletionRequestPage,
  deletionRequestReceivedPage,
  hasActiveServiceBlockingDeletion
} from "./accountDeletion";
import { getSupabaseDbHealth } from "./supabaseDb";
import { createDiditSession, verifyDiditWebhookSignature, type DiditWebhookPayload } from "./didit";
import { calculateDepositAmount } from "./payments";
import { PHOTO_UPLOAD_PATH, PhotoUploadError, decodePhoto, findPhoto, savePhoto } from "./uploads";

const app = express();
const port = Number(process.env.PORT ?? "4000");
const httpServer = http.createServer(app);
const realtimeChannels = new Map<string, Set<WebSocket>>();
const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const isProduction = process.env.NODE_ENV === "production";
const supabaseUrl = process.env.SUPABASE_URL || "";

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error("PORT debe ser un número entero entre 1 y 65535");
}

if (isProduction) {
  const missingProductionConfig = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "CORS_ORIGINS"].filter(
    (name) => !process.env[name]?.trim()
  );
  if (missingProductionConfig.length > 0) {
    throw new Error(`Faltan variables de producción: ${missingProductionConfig.join(", ")}`);
  }


  if (allowedOrigins.some((origin) => origin === "*" || origin.startsWith("http://localhost"))) {
    throw new Error("CORS_ORIGINS de producción no puede incluir comodines ni localhost");
  }
}

app.use(cors({
  origin: allowedOrigins.length > 0 ? allowedOrigins : isProduction ? false : true
}));

// Este webhook se registra ANTES de express.json() a propósito: la firma
// HMAC de Didit se valida contra el body crudo (texto), no contra el objeto
// ya parseado. Si estuviera después del parser JSON global, la firma nunca
// calzaría.
app.post(
  "/api/webhooks/didit",
  express.text({ type: "*/*" }),
  handleAsync(async (req, res) => {
    const signature = req.header("x-signature") || req.header("x-didit-signature");
    const rawBody = req.body as string;

    if (!verifyDiditWebhookSignature(rawBody, signature)) {
      res.status(401).json({ error: "Firma inválida" });
      return;
    }

    const payload = JSON.parse(rawBody) as DiditWebhookPayload;
    const userId = Number(payload.vendor_data);
    if (!Number.isInteger(userId) || userId <= 0) {
      res.status(400).json({ error: "vendor_data inválido" });
      return;
    }

    const statusMap: Record<DiditWebhookPayload["status"], string | null> = {
      Approved: "approved",
      Declined: "rejected",
      "In Review": "under_review",
      Abandoned: null,
      Expired: null
    };
    const nextStatus = statusMap[payload.status];
    if (!nextStatus) {
      // Abandoned/Expired: no cambiamos el status local, el usuario puede
      // reintentar generando una nueva sesión.
      res.status(200).json({ ok: true });
      return;
    }

    const verification = await get<{ id: number }>(
      "SELECT id FROM identity_verifications WHERE user_id = ? AND didit_session_id = ?",
      [userId, payload.session_id]
    );
    if (!verification) {
      // Sesión no reconocida (o ya no coincide). No es un error del cliente
      // de Didit, así que respondemos 200 para que no reintente indefinidamente.
      res.status(200).json({ ok: true, warning: "session not matched" });
      return;
    }

    await run(
      `UPDATE identity_verifications
       SET status = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [nextStatus, verification.id]
    );

    if (nextStatus === "approved") {
      await run(
        "UPDATE mechanics SET status = 'active' WHERE id = (SELECT mechanic_id FROM users WHERE id = ?)",
        [userId]
      );
    }

    res.status(200).json({ ok: true });
  })
);

// Las fotos llegan en base64 (ya reducidas en el teléfono): solo esa ruta
// acepta cuerpos más grandes que el límite general.
const jsonParser = express.json({ limit: "1mb" });
const photoJsonParser = express.json({ limit: "6mb" });
app.use((req, res, next) => (req.path === PHOTO_UPLOAD_PATH ? photoJsonParser : jsonParser)(req, res, next));
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    console.info(JSON.stringify({
      event: "http_request",
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - startedAt
    }));
  });
  next();
});
app.use(supabaseAuthMiddleware);
app.use(express.static(path.resolve(process.cwd(), "public")));
// Fotos subidas por los mecánicos, servidas desde la base de datos. El
// nombre incluye un UUID aleatorio y nunca cambia de contenido: se puede
// guardar en caché mucho tiempo.
app.get(
  "/uploads/:fileName",
  handleAsync(async (req, res) => {
    const photo = await findPhoto(String(req.params.fileName));
    if (!photo) {
      res.status(404).json({ error: "Foto no encontrada" });
      return;
    }
    res.setHeader("Content-Type", photo.contentType);
    res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(photo.data);
  })
);
app.get("/auth/callback", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mecanifique</title></head>
  <body style="font-family:system-ui,sans-serif;padding:2rem;max-width:42rem;margin:auto">
    <h1>Correo confirmado</h1>
    <p>Tu correo fue confirmado correctamente. Regresa a la app Mecanifique e inicia sesión.</p>
  </body>
</html>`);
});

app.get("/supabase/health", handleAsync(async (_req, res) => {
 const health = await getSupabaseDbHealth();
 if (!health.configured || !health.connected) {
   res.status(503).json(health);
   return;
 }
 res.status(200).json(health);
}));

app.get("/realtime/health", (_req, res) => {
 res.status(200).json({
   ok: true,
   connectedClients: Array.from(realtimeChannels.values()).reduce((total, sockets) => total + sockets.size, 0),
   channels: Array.from(realtimeChannels.keys())
 });
});

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

wss.on("connection", (socket) => {
 socket.on("message", (rawMessage) => {
   try {
     const text = typeof rawMessage === "string" ? rawMessage : rawMessage.toString("utf8");
     const message = JSON.parse(text);

     if (message?.type === "ping") {
       socket.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
       return;
     }

     if (message?.type === "subscribe" && typeof message.channel === "string") {
       const channel = message.channel.trim();
       if (!channel) {
         socket.send(JSON.stringify({ type: "error", message: "channel requerido" }));
         return;
       }

       let channelSockets = realtimeChannels.get(channel);
       if (!channelSockets) {
         channelSockets = new Set<WebSocket>();
         realtimeChannels.set(channel, channelSockets);
       }
       channelSockets.add(socket);
       socket.send(JSON.stringify({ type: "subscribed", channel }));
       return;
     }

     if (message?.type === "unsubscribe" && typeof message.channel === "string") {
       const channel = message.channel.trim();
       const channelSockets = realtimeChannels.get(channel);
       if (channelSockets) {
         channelSockets.delete(socket);
         if (channelSockets.size === 0) {
           realtimeChannels.delete(channel);
         }
       }
     }
   } catch {
     socket.send(JSON.stringify({ type: "error", message: "Mensaje WebSocket inválido" }));
   }
 });

 socket.on("close", () => {
   for (const channelSockets of realtimeChannels.values()) {
     channelSockets.delete(socket);
   }
   for (const [channel, channelSockets] of Array.from(realtimeChannels.entries())) {
     if (channelSockets.size === 0) {
       realtimeChannels.delete(channel);
     }
   }
 });
});

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

const mechanicRegistrationSchema = z.object({
  fullName: z.string().min(3),
  phone: z.string().min(10),
  city: z.string().min(2),
  zone: z.string().min(2),
  yearsExperience: z.number().int().min(0),
  specialties: z.array(z.string().min(2)).min(1),
  latitude: z.number().optional(),
  longitude: z.number().optional()
});

const serviceRequestSchema = z.object({
  customerId: z.number().int().positive(),
  vehicleMake: z.string().min(2),
  vehicleModel: z.string().min(1),
  vehicleYear: z.number().int().gte(1970).lte(new Date().getFullYear() + 1),
  issueDescription: z.string().min(10).max(1_000),
  preferredTime: z.string().min(3).optional().or(z.literal("")),
  city: z.string().min(2),
  zone: z.string().min(2),
  serviceAddress: z.string().min(5).optional().or(z.literal("")),
  latitude: z.number().optional(),
  longitude: z.number().optional()
});

const customerRegistrationSchema = z.object({
  fullName: z.string().min(3),
  email: z.string().email(),
  phone: z.string().min(10),
  password: z.string().min(8)
});

const mechanicRegistrationAuthSchema = mechanicRegistrationSchema.extend({
  email: z.string().email(),
  password: z.string().min(8)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const apiServiceRequestSchema = serviceRequestSchema.omit({ customerId: true }).extend({
  customerId: z.number().int().positive().optional(),
  requestedMechanicId: z.number().int().positive().optional(),
  scheduleSlotId: z.number().int().positive().optional()
});

const authRateLimitWindowMs = 60_000;
const authRateLimitMaxAttempts = 5;
const authRateLimitBuckets = new Map<string, number[]>();

const availabilitySchema = z.object({
  isAvailable: z.boolean()
});

const onlineSchema = z.object({
  isOnline: z.boolean()
});

const mechanicLocationSchema = z.object({
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180)
});

const mechanicStatusSchema = z.object({
  status: z.enum(["pending_verification", "active", "suspended"])
});

const updateSchema = z.object({
  source: z.enum(["mechanic", "system"]),
  message: z.string().min(3).max(500)
});

const assignSchema = z.object({
  mechanicId: z.number().int().positive().optional()
});

const mechanicHoldResponseSchema = z.object({
  action: z.enum(["accept", "reject"])
});

const requestStatusSchema = z.object({
  status: z.enum([
    "pending",
    "assigned",
    "in_progress",
    "en_route",
    "on_site",
    "diagnosing",
    "repairing",
    "awaiting_parts",
    "completed",
    "cancelled"
  ]),
  diagnosisNotes: z.string().min(3).max(1_000).optional(),
  repairNotes: z.string().min(3).max(1_000).optional(),
  estimatedPrice: z.number().nonnegative().optional(),
  finalPrice: z.number().nonnegative().optional()
});

// Para los avisos al cliente: antes decían "tu solicitud cambió a en_route".
const requestStatusLabels: Record<string, string> = {
  pending: "buscando mecánico",
  assigned: "mecánico asignado",
  in_progress: "en progreso",
  en_route: "tu mecánico va en camino",
  on_site: "tu mecánico llegó",
  diagnosing: "en diagnóstico",
  repairing: "en reparación",
  awaiting_parts: "esperando refacciones",
  completed: "servicio terminado",
  cancelled: "cancelada"
};

const allowedRequestTransitions: Record<string, string[]> = {
  pending: ["assigned", "cancelled"],
  assigned: ["en_route", "in_progress", "cancelled"],
  in_progress: ["on_site", "diagnosing", "repairing", "awaiting_parts", "completed", "cancelled"],
  en_route: ["on_site", "cancelled"],
  on_site: ["diagnosing", "repairing", "awaiting_parts", "completed", "cancelled"],
  diagnosing: ["repairing", "awaiting_parts", "completed", "cancelled"],
  repairing: ["awaiting_parts", "completed", "cancelled"],
  awaiting_parts: ["repairing", "completed", "cancelled"],
  completed: [],
  cancelled: []
};

const mechanicScheduleSlotSchema = z.object({
  slotDate: z.string().min(8),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  note: z.string().min(1).max(500).optional()
});

const mechanicPublicProfileSchema = z.object({
  bio: z.string().max(500).optional(),
  coverPhotoUrl: z.string().url().optional().or(z.literal("")),
  galleryUrls: z.array(z.string().url()).max(6).optional(),
  laborRate: z.number().positive().max(50000).optional()
  // Tarifa fija de mano de obra en MXN. También sirve como apartado mínimo
  // por defecto — ver el modelo de pagos en README.md.
});

const mechanicReviewSchema = z.object({
  serviceRequestId: z.number().int().positive(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().min(3).max(500)
});

const pushTokenSchema = z.object({
  pushToken: z.string().min(10)
});

const identityDocumentTypeSchema = z.enum([
  "ine_front",
  "ine_back",
  "selfie",
  "proof_of_address",
  "criminal_record"
]);

const identityVerificationSchema = z.object({
  consent: z.literal(true)
});

const identityDocumentSchema = z.object({
  documentType: identityDocumentTypeSchema,
  storageKey: z.string().trim().min(3).max(500).regex(/^[A-Za-z0-9_./-]+$/)
});

const identityReviewSchema = z.object({
  status: z.enum(["under_review", "approved", "rejected"]),
  reviewerNote: z.string().trim().max(1_000).optional()
});

const disputeCreateSchema = z.object({
  serviceRequestId: z.number().int().positive(),
  category: z.enum(["incomplete_work", "incorrect_charge", "vehicle_damage", "other"]),
  description: z.string().trim().min(10).max(1_000)
});

const disputeResolveSchema = z.object({
  status: z.enum(["under_review", "resolved"]),
  resolutionNote: z.string().trim().max(1_000).optional(),
  refundAmount: z.number().positive().optional()
  // Si se manda refundAmount, se crea un registro en `payments` (kind:
  // 'refund') y se liga a la disputa vía refund_payment_id. La captura
  // real contra el procesador de pagos queda pendiente de la integración
  // de Stripe — por ahora esto solo deja el registro contable.
});

const panicAlertCreateSchema = z.object({
  serviceRequestId: z.number().int().positive().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional()
});

type MechanicRow = {
  id: number;
  fullName: string;
  phone: string;
  city: string;
  zone: string;
  yearsExperience: number;
  specialties: string;
  status: string;
  isAvailable: number;
  isOnline: number;
  rating: number;
  reviewCount: number;
  jobsCompleted: number;
  latitude: number | null;
  longitude: number | null;
  bio: string | null;
  coverPhotoUrl: string | null;
  galleryJson: string;
  createdAt: string;
};

type ScheduleSlotRow = {
  id: number;
  mechanicId: number;
  slotDate: string;
  startTime: string;
  endTime: string;
  status: string;
  serviceRequestId: number | null;
  note: string | null;
  createdAt: string;
};

type NotificationRow = {
  id: number;
  userId: number;
  title: string;
  body: string;
  dataJson: string | null;
  readAt: string | null;
  createdAt: string;
};

type RequestMessageRow = {
  id: number;
  serviceRequestId: number;
  senderUserId: number;
  senderRole: string;
  senderName: string;
  message: string;
  createdAt: string;
};

type MechanicReviewRow = {
  id: number;
  mechanicId: number;
  serviceRequestId: number;
  customerUserId: number;
  customerName: string;
  rating: number;
  comment: string;
  createdAt: string;
};

type PushTokenRow = {
  pushToken: string;
};

async function getUserIdByCustomerId(customerId: number): Promise<number | null> {
  const user = await get<{ id: number }>(
    `
    SELECT id
    FROM users
    WHERE customer_id = ?
    `,
    [customerId]
  );
  return user?.id ?? null;
}

async function getUserIdByMechanicId(mechanicId: number): Promise<number | null> {
  const user = await get<{ id: number }>(
    `
    SELECT id
    FROM users
    WHERE mechanic_id = ?
    `,
    [mechanicId]
  );
  return user?.id ?? null;
}

async function getAdminUserIds(): Promise<number[]> {
  const rows = await all<{ id: number }>("SELECT id FROM users WHERE role = 'admin'");
  return rows.map((row) => row.id);
}

async function getPushTokensByUserId(userId: number): Promise<string[]> {
  const rows = await all<PushTokenRow>(
    `
    SELECT push_token AS pushToken
    FROM push_tokens
    WHERE user_id = ?
    `,
    [userId]
  );

  return rows.map((row) => row.pushToken);
}

async function sendExpoPushNotifications(
  userId: number,
  title: string,
  body: string,
  data: Record<string, string | number | boolean | null> = {}
): Promise<void> {
  const tokens = await getPushTokensByUserId(userId);
  if (tokens.length === 0) {
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(
        tokens.map((token) => ({
          to: token,
          sound: "default",
          title,
          body,
          data
        }))
      ),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function sendRealtimeEvent(channel: string, event: string, payload: Record<string, unknown> = {}): void {
  const sockets = realtimeChannels.get(channel);
  if (!sockets || sockets.size === 0) {
    return;
  }

  const envelope = {
    type: "event",
    channel,
    event,
    payload
  };

  for (const socket of sockets) {
    if (socket.readyState !== socket.OPEN) {
      sockets.delete(socket);
      continue;
    }

    socket.send(JSON.stringify(envelope));
  }
}

function notifyUser(userId: number, event: string, payload: Record<string, unknown> = {}): void {
  sendRealtimeEvent(`user:${userId}`, event, payload);
}

function notifyRequest(requestId: number, event: string, payload: Record<string, unknown> = {}): void {
  sendRealtimeEvent(`service-request:${requestId}`, event, payload);
}

async function createNotification(
  userId: number,
  title: string,
  body: string,
  data: Record<string, string | number | boolean | null> = {}
): Promise<void> {
  const result = await run(
    `
    INSERT INTO notifications (user_id, title, body, data_json)
    VALUES (?, ?, ?, ?)
    `,
    [userId, title, body, JSON.stringify(data)]
  );

  notifyUser(userId, "notification", {
    id: result.lastID,
    title,
    body,
    data,
    createdAt: new Date().toISOString()
  });

  void sendExpoPushNotifications(userId, title, body, data).catch((error) => {
    console.error("Expo push notification failed:", error);
  });
}

async function refreshMechanicRating(mechanicId: number): Promise<void> {
  const stats = await get<{ averageRating: number | null; reviewCount: number }>(
    `
    SELECT AVG(rating) AS averageRating, COUNT(*) AS reviewCount
    FROM mechanic_reviews
    WHERE mechanic_id = ?
    `,
    [mechanicId]
  );

  if (!stats) {
    return;
  }

  await run(
    `
    UPDATE mechanics
    SET rating = COALESCE(?, rating), review_count = ?
    WHERE id = ?
    `,
    [stats.averageRating, stats.reviewCount, mechanicId]
  );
}

function applyRateLimit(
  scope: string,
  req: Request,
  res: Response,
  limit = authRateLimitMaxAttempts,
  windowMs = authRateLimitWindowMs
): boolean {
  const key = `${scope}:${req.ip ?? "unknown"}`;
  const now = Date.now();
  const windowStart = now - windowMs;
  const recentAttempts = (authRateLimitBuckets.get(key) ?? []).filter((timestamp) => timestamp >= windowStart);

  if (recentAttempts.length >= limit) {
    res.status(429).json({ error: "Demasiados intentos. Intenta de nuevo en un momento." });
    return true;
  }

  recentAttempts.push(now);
  authRateLimitBuckets.set(key, recentAttempts);
  return false;
}

const mechanicHoldMinutes = Number(process.env.MECHANIC_HOLD_MINUTES ?? "2");

function toSqliteTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * mechanics.specialties debe guardarse como JSON (JSON.stringify de un
 * array), pero versiones anteriores del registro lo guardaban como texto
 * separado por comas ("Motor, Electrico"). Si el valor no es JSON válido,
 * se interpreta como esa lista separada por comas en vez de reventar el
 * listado completo de mecánicos con un SyntaxError.
 */
function parseSpecialties(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch {
    return raw.split(",").map((item) => item.trim()).filter(Boolean);
  }
}

// ============================================================================
// EMPAREJAMIENTO: buscar al siguiente mecánico cuando uno no toma la solicitud
// ============================================================================
// Antes, si el mecánico rechazaba, la solicitud quedaba sin mecánico y nadie
// buscaba a otro; si el hold vencía sin respuesta, no pasaba nada en absoluto.
// En ambos casos el cliente veía "Pendiente" para siempre.

const MATCH_RADIUS_KM = 25;

// Condiciones para que un mecánico pueda recibir una oferta ahora mismo.
// Usa dos parámetros: requestId (dos veces) para excluir a quien ya no la
// tomó.
const ELIGIBLE_MECHANIC_CONDITIONS = `
  status = 'active'
  AND is_online = 1
  AND is_available = 1
  AND NOT EXISTS (
    SELECT 1
    FROM service_requests held
    WHERE held.mechanic_id = mechanics.id
      AND held.status = 'pending'
      AND held.hold_expires_at IS NOT NULL
      AND held.hold_expires_at > CURRENT_TIMESTAMP
  )
  AND (
    ? IS NULL OR NOT EXISTS (
      SELECT 1
      FROM service_request_declines declined
      WHERE declined.service_request_id = ?
        AND declined.mechanic_id = mechanics.id
    )
  )
`;

/**
 * Siguiente mecánico para una solicitud. Si la solicitud tiene coordenadas,
 * el más cercano dentro de MATCH_RADIUS_KM. Si no hay nadie cerca (o la
 * solicitud no tiene coordenadas), cae a coincidencia por ciudad/zona
 * escritas — antes era la única forma, y fallaba con cualquier diferencia de
 * texto ("Norte" vs "Zona Norte") aunque estuvieran a 2 km. En ese respaldo,
 * si la solicitud sí tiene coordenadas, solo cuentan mecánicos sin ubicación
 * conocida: uno que sabemos que está lejos no se elige por el texto.
 * Si se pasa requestId, excluye a quienes ya no tomaron esa solicitud.
 */
async function findAvailableMechanic(
  city: string,
  zone: string,
  requestId: number | null,
  coords: { latitude: number; longitude: number } | null
): Promise<number | null> {
  if (coords) {
    const candidates = await all<{ id: number; latitude: number; longitude: number; rating: number }>(
      `
      SELECT id, latitude, longitude, rating
      FROM mechanics
      WHERE latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND ${ELIGIBLE_MECHANIC_CONDITIONS}
      `,
      [requestId, requestId]
    );
    const nearest = candidates
      .map((mechanic) => ({
        id: mechanic.id,
        rating: mechanic.rating,
        distanceKm: calculateDistanceKm(coords.latitude, coords.longitude, mechanic.latitude, mechanic.longitude)
      }))
      .filter((mechanic) => mechanic.distanceKm <= MATCH_RADIUS_KM)
      .sort((a, b) => a.distanceKm - b.distanceKm || b.rating - a.rating)[0];
    if (nearest) {
      return nearest.id;
    }
  }

  const row = await get<{ id: number }>(
    `
    SELECT id
    FROM mechanics
    WHERE city = ?
      AND zone = ?
      ${coords ? "AND (latitude IS NULL OR longitude IS NULL)" : ""}
      AND ${ELIGIBLE_MECHANIC_CONDITIONS}
    ORDER BY rating DESC, jobs_completed DESC
    LIMIT 1
    `,
    [city, zone, requestId, requestId]
  );
  return row?.id ?? null;
}

/** Coordenadas de una fila de solicitud, o null si no las tiene. */
function requestCoords(row: { latitude: number | null; longitude: number | null }): { latitude: number; longitude: number } | null {
  return row.latitude != null && row.longitude != null ? { latitude: row.latitude, longitude: row.longitude } : null;
}

/** Ofrece una solicitud sin mecánico a uno nuevo, con su propio hold. */
async function offerRequestToMechanic(requestId: number, mechanicId: number): Promise<boolean> {
  const mechanic = await get<{ fullName: string; laborRate: number | null }>(
    "SELECT full_name AS fullName, labor_rate AS laborRate FROM mechanics WHERE id = ?",
    [mechanicId]
  );
  if (!mechanic) {
    return false;
  }

  const holdExpiresAt = toSqliteTimestamp(new Date(Date.now() + mechanicHoldMinutes * 60 * 1000));
  // El apartado depende de la tarifa de cada mecánico, así que se recalcula
  // al cambiar de mecánico. Todavía no se cobra nada (no hay Stripe), por lo
  // que recalcular es seguro.
  const offered = await run(
    `
    UPDATE service_requests
    SET mechanic_id = ?, hold_expires_at = ?, deposit_amount = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'pending' AND mechanic_id IS NULL
    `,
    [mechanicId, holdExpiresAt, calculateDepositAmount(mechanic.laborRate), requestId]
  );
  if (offered.changes === 0) {
    return false;
  }

  await run(
    "INSERT INTO service_request_updates (service_request_id, source, message) VALUES (?, 'system', ?)",
    [requestId, `Solicitud enviada a ${mechanic.fullName}. Tiene ${mechanicHoldMinutes} min para responder.`]
  );
  const mechanicUserId = await getUserIdByMechanicId(mechanicId);
  if (mechanicUserId) {
    await createNotification(mechanicUserId, "Nueva solicitud", `Tienes una solicitud pendiente #${requestId}`, { requestId });
  }
  notifyRequest(requestId, "request.offered", { requestId, mechanicId });
  return true;
}

/**
 * Se llama cuando un mecánico ya no tiene la solicitud (rechazó o dejó
 * vencer el hold) y el caller ya limpió mechanic_id/hold. Registra el
 * rechazo y, si la solicitud es automática, busca al siguiente mecánico.
 */
async function handleMechanicDeclined(requestId: number, mechanicId: number, reason: "rejected" | "expired"): Promise<void> {
  await run(
    "INSERT OR IGNORE INTO service_request_declines (service_request_id, mechanic_id, reason) VALUES (?, ?, ?)",
    [requestId, mechanicId, reason]
  );

  const request = await get<{
    city: string;
    zone: string;
    latitude: number | null;
    longitude: number | null;
    customerId: number;
    assignmentMode: string | null;
    status: string;
  }>(
    `
    SELECT city, zone, latitude, longitude, customer_id AS customerId, assignment_mode AS assignmentMode, status
    FROM service_requests
    WHERE id = ?
    `,
    [requestId]
  );
  if (!request || request.status !== "pending") {
    return;
  }
  const customerUserId = await getUserIdByCustomerId(request.customerId);

  if (request.assignmentMode === "direct") {
    await run(
      "INSERT INTO service_request_updates (service_request_id, source, message) VALUES (?, 'system', ?)",
      [requestId, "El mecánico elegido no pudo tomar la solicitud."]
    );
    if (customerUserId) {
      await createNotification(
        customerUserId,
        "El mecánico no pudo tomar tu solicitud",
        `Puedes buscar otro mecánico disponible desde el detalle de la solicitud #${requestId}.`,
        { requestId }
      );
    }
    notifyRequest(requestId, "request.unassigned", { requestId });
    return;
  }

  const nextMechanicId = await findAvailableMechanic(request.city, request.zone, requestId, requestCoords(request));
  if (nextMechanicId && (await offerRequestToMechanic(requestId, nextMechanicId))) {
    return;
  }

  await run(
    "INSERT INTO service_request_updates (service_request_id, source, message) VALUES (?, 'system', ?)",
    [requestId, "No hay otro mecánico disponible en la zona por ahora."]
  );
  if (customerUserId) {
    await createNotification(
      customerUserId,
      "No hay mecánicos disponibles ahora",
      `No encontramos otro mecánico en tu zona para la solicitud #${requestId}. Puedes intentar de nuevo en unos minutos.`,
      { requestId }
    );
  }
  notifyRequest(requestId, "request.unassigned", { requestId });
}

/** Libera un turno reservado por una solicitud que perdió a su mecánico. */
async function releaseScheduleSlot(scheduleSlotId: number | null): Promise<void> {
  if (!scheduleSlotId) {
    return;
  }
  await run(
    "UPDATE mechanic_schedule_slots SET status = 'available', service_request_id = NULL WHERE id = ?",
    [scheduleSlotId]
  );
}

/**
 * Nadie llama a un endpoint cuando un hold vence, así que esto corre
 * periódicamente (ver startHoldSweep) y trata cada hold vencido igual que
 * un rechazo.
 */
export async function sweepExpiredHolds(): Promise<number> {
  const expired = await all<{ id: number; mechanicId: number; scheduleSlotId: number | null }>(
    `
    SELECT id, mechanic_id AS mechanicId, schedule_slot_id AS scheduleSlotId
    FROM service_requests
    WHERE status = 'pending'
      AND mechanic_id IS NOT NULL
      AND hold_expires_at IS NOT NULL
      AND hold_expires_at <= CURRENT_TIMESTAMP
    `
  );

  let handled = 0;
  for (const row of expired) {
    // Condicional: si el mecánico aceptó o rechazó justo ahora, no hacer nada.
    const cleared = await run(
      `
      UPDATE service_requests
      SET mechanic_id = NULL, hold_expires_at = NULL, schedule_slot_id = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND status = 'pending'
        AND mechanic_id = ?
        AND hold_expires_at IS NOT NULL
        AND hold_expires_at <= CURRENT_TIMESTAMP
      `,
      [row.id, row.mechanicId]
    );
    if (cleared.changes === 0) {
      continue;
    }
    await releaseScheduleSlot(row.scheduleSlotId);

    const mechanicUserId = await getUserIdByMechanicId(row.mechanicId);
    if (mechanicUserId) {
      await createNotification(
        mechanicUserId,
        "Solicitud vencida",
        `No respondiste a tiempo la solicitud #${row.id}.`,
        { requestId: row.id }
      );
    }
    await handleMechanicDeclined(row.id, row.mechanicId, "expired");
    handled += 1;
  }
  return handled;
}

const HOLD_SWEEP_INTERVAL_MS = 20_000;
let holdSweepTimer: NodeJS.Timeout | null = null;
let holdSweepRunning = false;

function startHoldSweep(): void {
  if (holdSweepTimer) {
    return;
  }
  holdSweepTimer = setInterval(() => {
    if (holdSweepRunning) {
      return;
    }
    holdSweepRunning = true;
    sweepExpiredHolds()
      .catch((error) => console.error("Hold sweep failed:", error))
      .finally(() => {
        holdSweepRunning = false;
      });
  }, HOLD_SWEEP_INTERVAL_MS);
  // No mantener vivo el proceso solo por este timer (tests, apagado limpio).
  holdSweepTimer.unref();
}

function stopHoldSweep(): void {
  if (holdSweepTimer) {
    clearInterval(holdSweepTimer);
    holdSweepTimer = null;
  }
}

const ACTIVE_JOB_STATUSES_SQL = "('assigned', 'in_progress', 'en_route', 'on_site', 'diagnosing', 'repairing', 'awaiting_parts')";

async function isIdentityApproved(userId: number): Promise<boolean> {
  const verification = await get<{ status: string }>(
    "SELECT status FROM identity_verifications WHERE user_id = ?",
    [userId]
  );
  return verification?.status === "approved";
}

/**
 * Reconciliación: un mecánico pendiente cuyo usuario ya tiene la identidad
 * aprobada queda activo. Cubre a quien activó el modo profesional después
 * de verificarse como cliente, antes de que switch-role lo tuviera en
 * cuenta (quedaba pendiente para siempre, sin forma de volver a verificarse).
 */
export async function activateMechanicIfIdentityApproved(mechanicId: number, userId: number): Promise<boolean> {
  if (!(await isIdentityApproved(userId))) {
    return false;
  }
  const updated = await run(
    "UPDATE mechanics SET status = 'active' WHERE id = ? AND status = 'pending_verification'",
    [mechanicId]
  );
  return updated.changes > 0;
}

type MechanicConnectionResult = { ok: true; isAvailable: boolean } | { ok: false; status: number; error: string };

/**
 * Conecta/desconecta a un mecánico.
 *
 * Antes, conectarse conservaba is_available tal cual, y un mecánico nuevo
 * se registra con is_available = 0: nunca recibía solicitudes automáticas,
 * ni siquiera ya verificado (solo un admin podía destrabarlo a mano). Ahora,
 * al conectarse queda disponible salvo que tenga un trabajo en curso.
 *
 * Con enforceActive (el propio mecánico), no deja conectarse a una cuenta
 * pendiente o suspendida: antes aparecía "conectado" sin poder recibir
 * nada, sin ninguna explicación.
 */
export async function applyMechanicConnection(
  mechanicId: number,
  isOnline: boolean,
  enforceActive: boolean
): Promise<MechanicConnectionResult> {
  const mechanic = await get<{ status: string }>("SELECT status FROM mechanics WHERE id = ?", [mechanicId]);
  if (!mechanic) {
    return { ok: false, status: 404, error: "Mecánico no encontrado" };
  }

  if (!isOnline) {
    await run("UPDATE mechanics SET is_online = 0, is_available = 0 WHERE id = ?", [mechanicId]);
    return { ok: true, isAvailable: false };
  }

  if (enforceActive && mechanic.status !== "active") {
    return {
      ok: false,
      status: 409,
      error:
        mechanic.status === "suspended"
          ? "Tu cuenta está suspendida. Escríbenos a soporte para revisarla."
          : "Tu cuenta todavía no está activa. Verifica tu identidad para empezar a recibir solicitudes."
    };
  }

  const activeJob = await get<{ id: number }>(
    `SELECT id FROM service_requests WHERE mechanic_id = ? AND status IN ${ACTIVE_JOB_STATUSES_SQL} LIMIT 1`,
    [mechanicId]
  );
  const isAvailable = !activeJob;
  await run("UPDATE mechanics SET is_online = 1, is_available = ? WHERE id = ?", [isAvailable ? 1 : 0, mechanicId]);
  return { ok: true, isAvailable };
}

function calculateDistanceKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number
): number {
  const earthRadiusKm = 6371;
  const deltaLat = ((latitudeB - latitudeA) * Math.PI) / 180;
  const deltaLng = ((longitudeB - longitudeA) * Math.PI) / 180;
  const startLat = (latitudeA * Math.PI) / 180;
  const endLat = (latitudeB * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2) * Math.cos(startLat) * Math.cos(endLat);

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// database y commit sirven para confirmar tras un deploy que corre el código
// nuevo y que está conectado a Turso (y no a un archivo que se borra).
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "mecanifique-api",
    database: databaseKind,
    accountDeletion: isSupabaseAdminConfigured(),
    commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null
  });
});

// Login, registro y sesión de admin viven en Supabase (/auth/v2/*).
// El sistema propio de contraseñas locales se eliminó: nunca lo usaba
// la app móvil y solo agregaba superficie de ataque sin beneficio real.

app.get(
  "/auth/me",
  requireAuth,
  handleAsync(async (req, res) => {
    res.json({ user: req.auth?.user, token: req.auth?.token });
  })
);

// Perfiles de vehículos del cliente (metadata únicamente; las fotos son
// URLs externas, nunca binarios). Rutas completas en routes/vehicles.ts.
app.use("/api", vehiclesRouter);
app.use("/api", createCommunityRouter({ createNotification, calculateDistanceKm, applyRateLimit }));

// ============================================================================
// IDENTITY VERIFICATION (document binaries remain in private object storage)
// ============================================================================
function requiredIdentityDocuments(role: "customer" | "mechanic"): string[] {
  const customerDocuments = ["ine_front", "ine_back", "selfie"];
  return role === "mechanic"
    ? [...customerDocuments, "proof_of_address", "criminal_record"]
    : customerDocuments;
}

app.get("/api/identity-verification", requireAuth, handleAsync(async (req, res) => {
  const user = req.auth?.user;
  if (!user || user.role === "admin") {
    res.status(403).json({ error: "Esta verificación solo aplica a clientes y mecánicos" });
    return;
  }

  const verification = await get<{
    id: number; status: string; submittedAt: string | null; reviewerNote: string | null;
  }>(
    `SELECT id, status, submitted_at AS submittedAt, reviewer_note AS reviewerNote
     FROM identity_verifications WHERE user_id = ?`,
    [user.id]
  );
  const documents = verification
    ? await all<{ documentType: string }>(
      "SELECT document_type AS documentType FROM identity_verification_documents WHERE verification_id = ?",
      [verification.id]
    )
    : [];

  res.json({
    verification: verification
      ? { status: verification.status, submittedAt: verification.submittedAt, reviewerNote: verification.reviewerNote }
      : null,
    requiredDocuments: requiredIdentityDocuments(user.role),
    submittedDocuments: documents.map((document) => document.documentType)
  });
}));

app.post("/api/identity-verification", requireAuth, handleAsync(async (req, res) => {
  const user = req.auth?.user;
  if (!user || user.role === "admin") {
    res.status(403).json({ error: "Esta verificación solo aplica a clientes y mecánicos" });
    return;
  }
  identityVerificationSchema.parse(req.body);

  await run(
    `INSERT INTO identity_verifications (user_id, role, consent_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO NOTHING`,
    [user.id, user.role]
  );
  res.status(201).json({ message: "Consentimiento registrado" });
}));

// Crea (o reutiliza) una sesión de verificación en Didit y le devuelve al
// móvil la URL hospedada donde el usuario sube su INE y se toma la selfie.
// Requiere que ya exista consentimiento registrado (POST anterior).
const diditSessionRequestSchema = z.object({
  // "exp://" (y "exp+mecanifique://" en dev clients) son los esquemes que
  // genera Linking.createURL() al correr la app en Expo Go / dev client en
  // vez de un build standalone — sin aceptarlos, probar este flujo fuera de
  // un APK compilado siempre falla aquí, antes de llegar a Didit.
  callbackUrl: z.string().url().refine(
    (url) =>
      url.startsWith("mecanifique://") ||
      url.startsWith("exp://") ||
      url.startsWith("exp+mecanifique://") ||
      url.startsWith("https://mecanifique.onrender.com"),
    "callbackUrl debe ser un deep link de la app o del dominio de Mecanifique"
  )
});

app.post("/api/identity-verification/didit-session", requireAuth, handleAsync(async (req, res) => {
  const user = req.auth?.user;
  if (!user || user.role === "admin") {
    res.status(403).json({ error: "Esta verificación solo aplica a clientes y mecánicos" });
    return;
  }
  const { callbackUrl } = diditSessionRequestSchema.parse(req.body);

  const verification = await get<{ id: number; status: string; diditSessionId: string | null }>(
    "SELECT id, status, didit_session_id AS diditSessionId FROM identity_verifications WHERE user_id = ?",
    [user.id]
  );
  if (!verification) {
    res.status(409).json({ error: "Primero debes registrar tu consentimiento" });
    return;
  }
  if (verification.status === "approved") {
    res.status(409).json({ error: "Tu identidad ya está verificada" });
    return;
  }

  try {
    const session = await createDiditSession(user.id, callbackUrl);
    await run(
      "UPDATE identity_verifications SET didit_session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [session.session_id, verification.id]
    );
    res.json({ url: session.url });
  } catch (error) {
    if (error instanceof Error && error.message === "DIDIT_NOT_CONFIGURED") {
      res.status(503).json({ error: "La verificación de identidad no está disponible en este momento" });
      return;
    }
    throw error;
  }
}));

app.put("/api/identity-verification/documents", requireAuth, handleAsync(async (req, res) => {
  const user = req.auth?.user;
  if (!user || user.role === "admin") {
    res.status(403).json({ error: "Esta verificación solo aplica a clientes y mecánicos" });
    return;
  }
  const payload = identityDocumentSchema.parse(req.body);
  if (!requiredIdentityDocuments(user.role).includes(payload.documentType)) {
    res.status(400).json({ error: "Este documento no es requerido para tu tipo de cuenta" });
    return;
  }

  const verification = await get<{ id: number; status: string }>(
    "SELECT id, status FROM identity_verifications WHERE user_id = ?",
    [user.id]
  );
  if (!verification) {
    res.status(409).json({ error: "Primero debes aceptar el consentimiento de verificación" });
    return;
  }
  if (verification.status === "approved") {
    res.status(409).json({ error: "Tu identidad ya fue aprobada" });
    return;
  }

  await run(
    `INSERT INTO identity_verification_documents (verification_id, document_type, storage_key)
     VALUES (?, ?, ?)
     ON CONFLICT(verification_id, document_type)
     DO UPDATE SET storage_key = excluded.storage_key, created_at = CURRENT_TIMESTAMP`,
    [verification.id, payload.documentType, payload.storageKey]
  );
  res.status(200).json({ message: "Documento registrado para revisión" });
}));

app.post("/api/identity-verification/submit", requireAuth, handleAsync(async (req, res) => {
  const user = req.auth?.user;
  if (!user || user.role === "admin") {
    res.status(403).json({ error: "Esta verificación solo aplica a clientes y mecánicos" });
    return;
  }
  const verification = await get<{ id: number }>(
    "SELECT id FROM identity_verifications WHERE user_id = ?",
    [user.id]
  );
  if (!verification) {
    res.status(409).json({ error: "Primero debes aceptar el consentimiento de verificación" });
    return;
  }
  const documents = await all<{ documentType: string }>(
    "SELECT document_type AS documentType FROM identity_verification_documents WHERE verification_id = ?",
    [verification.id]
  );
  const requiredDocuments = requiredIdentityDocuments(user.role);
  const missingDocuments = requiredDocuments.filter(
    (documentType) => !documents.some((document) => document.documentType === documentType)
  );
  if (missingDocuments.length > 0) {
    res.status(400).json({ error: "Faltan documentos requeridos", missingDocuments });
    return;
  }
  await run(
    `UPDATE identity_verifications
     SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP, reviewer_note = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [verification.id]
  );
  res.status(200).json({ message: "Verificación enviada para revisión" });
}));

// Cliente reporta un problema con un servicio ya realizado (completado o no).
app.post("/api/disputes", requireAuth, handleAsync(async (req, res) => {
  const user = req.auth?.user;
  if (!user || user.role !== "customer" || !user.customerId) {
    res.status(403).json({ error: "Solo los clientes pueden reportar disputas" });
    return;
  }
  const payload = disputeCreateSchema.parse(req.body);

  const request = await get<{ id: number; customerId: number }>(
    "SELECT id, customer_id AS customerId FROM service_requests WHERE id = ?",
    [payload.serviceRequestId]
  );
  if (!request) {
    res.status(404).json({ error: "Solicitud no encontrada" });
    return;
  }
  if (request.customerId !== user.customerId) {
    res.status(403).json({ error: "Esta solicitud no te pertenece" });
    return;
  }

  const result = await run(
    `INSERT INTO disputes (service_request_id, customer_id, category, description)
     VALUES (?, ?, ?, ?)`,
    [payload.serviceRequestId, user.customerId, payload.category, payload.description]
  );
  res.status(201).json({ id: result.lastID, message: "Disputa reportada, un administrador la revisará." });
}));

// Cliente consulta el estado de sus propias disputas.
app.get("/api/disputes/mine", requireAuth, handleAsync(async (req, res) => {
  const user = req.auth?.user;
  if (!user || user.role !== "customer" || !user.customerId) {
    res.status(403).json({ error: "Solo los clientes tienen disputas propias" });
    return;
  }
  const disputes = await all<any>(
    `SELECT id, service_request_id AS serviceRequestId, category, description, status,
            resolution_note AS resolutionNote, created_at AS createdAt, resolved_at AS resolvedAt
     FROM disputes WHERE customer_id = ? ORDER BY created_at DESC`,
    [user.customerId]
  );
  res.json({ disputes });
}));

app.get("/api/admin/disputes", requireAuth, requireRole("admin"), handleAsync(async (_req, res) => {
  const disputes = await all<any>(
    `SELECT d.id, d.service_request_id AS serviceRequestId, d.category, d.description, d.status,
            d.resolution_note AS resolutionNote, d.created_at AS createdAt, d.resolved_at AS resolvedAt,
            c.full_name AS customerName
     FROM disputes d
     JOIN customers c ON c.id = d.customer_id
     ORDER BY CASE d.status WHEN 'reported' THEN 0 WHEN 'under_review' THEN 1 ELSE 2 END, d.created_at ASC`
  );
  res.json({ disputes });
}));

app.patch("/api/admin/disputes/:id", requireAuth, requireRole("admin"), handleAsync(async (req, res) => {
  const disputeId = Number(req.params.id);
  if (!Number.isInteger(disputeId) || disputeId <= 0) {
    res.status(400).json({ error: "disputeId inválido" });
    return;
  }
  const payload = disputeResolveSchema.parse(req.body);

  const dispute = await get<{ id: number; serviceRequestId: number }>(
    "SELECT id, service_request_id AS serviceRequestId FROM disputes WHERE id = ?",
    [disputeId]
  );
  if (!dispute) {
    res.status(404).json({ error: "Disputa no encontrada" });
    return;
  }

  let refundPaymentId: number | null = null;
  if (payload.refundAmount) {
    const payment = await run(
      `INSERT INTO payments (service_request_id, kind, amount, status)
       VALUES (?, 'refund', ?, 'pending')`,
      [dispute.serviceRequestId, payload.refundAmount]
    );
    refundPaymentId = payment.lastID;
  }

  await run(
    `UPDATE disputes
     SET status = ?, resolution_note = ?, refund_payment_id = COALESCE(?, refund_payment_id),
         resolved_by_user_id = ?, resolved_at = CASE WHEN ? = 'resolved' THEN CURRENT_TIMESTAMP ELSE resolved_at END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [payload.status, payload.resolutionNote ?? null, refundPaymentId, req.auth?.user.id ?? null, payload.status, disputeId]
  );
  res.status(200).json({ message: "Disputa actualizada", refundPaymentId });
}));

// El botón de pánico/911 en la app SIEMPRE llama al 911 directo desde el
// marcador nativo del teléfono, sin depender de este endpoint. Esta ruta
// solo deja constancia de que se presionó el botón (quién, desde qué
// solicitud, con qué ubicación) y avisa a los admins para que puedan dar
// seguimiento humano — nunca debe bloquear ni sustituir la llamada real.
app.post("/api/alerts/panic", requireAuth, handleAsync(async (req, res) => {
  const user = req.auth?.user;
  if (!user) {
    res.status(401).json({ error: "Autenticación requerida" });
    return;
  }
  const payload = panicAlertCreateSchema.parse(req.body);

  const result = await run(
    `INSERT INTO panic_alerts (service_request_id, reporter_user_id, reporter_role, latitude, longitude)
     VALUES (?, ?, ?, ?, ?)`,
    [payload.serviceRequestId ?? null, user.id, user.role, payload.latitude ?? null, payload.longitude ?? null]
  );

  const adminUserIds = await getAdminUserIds();
  const locationNote =
    payload.latitude != null && payload.longitude != null
      ? ` Última ubicación conocida: ${payload.latitude}, ${payload.longitude}.`
      : "";
  await Promise.all(
    adminUserIds.map((adminUserId) =>
      createNotification(
        adminUserId,
        "Alerta de emergencia (911)",
        `${user.role === "mechanic" ? "El mecánico" : "El cliente"} ${user.fullName} presionó el botón de emergencia${
          payload.serviceRequestId ? ` en la solicitud #${payload.serviceRequestId}` : ""
        }.${locationNote}`,
        { panicAlertId: result.lastID, serviceRequestId: payload.serviceRequestId ?? null }
      )
    )
  );

  res.status(201).json({ id: result.lastID });
}));

// Admin revisa el historial de alertas de pánico para dar seguimiento.
app.get("/api/admin/panic-alerts", requireAuth, requireRole("admin"), handleAsync(async (_req, res) => {
  const alerts = await all<any>(
    `SELECT pa.id, pa.service_request_id AS serviceRequestId, pa.reporter_user_id AS reporterUserId,
            pa.reporter_role AS reporterRole, pa.latitude, pa.longitude, pa.created_at AS createdAt,
            u.full_name AS reporterName
     FROM panic_alerts pa
     JOIN users u ON u.id = pa.reporter_user_id
     ORDER BY pa.created_at DESC`
  );
  res.json({ alerts });
}));

app.get("/api/admin/identity-verifications", requireAuth, requireRole("admin"), handleAsync(async (_req, res) => {
  const verifications = await all<{
    id: number; userId: number; role: string; status: string; fullName: string; login: string;
    submittedAt: string | null; reviewerNote: string | null;
  }>(
    `SELECT iv.id, iv.user_id AS userId, iv.role, iv.status, u.full_name AS fullName, u.login,
            iv.submitted_at AS submittedAt, iv.reviewer_note AS reviewerNote
     FROM identity_verifications iv
     JOIN users u ON u.id = iv.user_id
     ORDER BY CASE iv.status WHEN 'submitted' THEN 0 WHEN 'under_review' THEN 1 ELSE 2 END, iv.updated_at ASC`
  );
  res.json({ verifications });
}));

app.patch("/api/admin/identity-verifications/:id", requireAuth, requireRole("admin"), handleAsync(async (req, res) => {
  const verificationId = Number(req.params.id);
  if (!Number.isInteger(verificationId) || verificationId <= 0) {
    res.status(400).json({ error: "verificationId inválido" });
    return;
  }
  const payload = identityReviewSchema.parse(req.body);
  const result = await run(
    `UPDATE identity_verifications
     SET status = ?, reviewer_note = ?, reviewed_at = CURRENT_TIMESTAMP,
         reviewed_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [payload.status, payload.reviewerNote ?? null, req.auth?.user.id ?? null, verificationId]
  );
  if (result.changes === 0) {
    res.status(404).json({ error: "Verificación no encontrada" });
    return;
  }
  res.status(200).json({ message: "Estado de verificación actualizado" });
}));

// ============================================================================
// SUPABASE AUTH ENDPOINTS (NEW - parallel to existing auth)
// ============================================================================

/**
 * Register new customer with Supabase Auth
 * POST /auth/v2/register/customer
 */
app.post(
  "/auth/v2/register/customer",
  handleAsync(async (req, res) => {
    const payload = customerRegistrationSchema.parse(req.body);
    try {
      const result = await registerCustomerWithSupabase(
        payload.email,
        payload.password,
        payload.fullName,
        payload.phone
      );
      res.status(201).json({
        userId: result.userId,
        customerId: result.customerId,
        email: result.email,
        message: result.requiresEmailConfirmation
          ? "Cuenta creada. Revisa tu correo y confirma la cuenta antes de iniciar sesión."
          : "Cuenta creada exitosamente. Verifica tu correo electrónico."
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("already exists")) {
          res.status(409).json({ error: "Ya existe una cuenta con ese email" });
          return;
        }
        if (
          error.message.includes("over_email_send_rate_limit") ||
          error.message.toLowerCase().includes("email rate limit")
        ) {
          res.status(429).json({
            error: "Supabase limitó temporalmente el envío de correos de confirmación. Desactiva la confirmación de email durante las pruebas o configura un proveedor SMTP."
          });
          return;
        }
        res.status(400).json({ error: error.message });
        return;
      }
      throw error;
    }
  })
);

/**
 * Register new mechanic with Supabase Auth
 * POST /auth/v2/register/mechanic
 */
app.post(
  "/auth/v2/register/mechanic",
  handleAsync(async (req, res) => {
    const payload = mechanicRegistrationAuthSchema.parse(req.body);
    try {
      const result = await registerMechanicWithSupabase(
        payload.email,
        payload.password,
        payload.fullName,
        payload.phone,
        payload.city,
        payload.zone,
        payload.yearsExperience,
        payload.specialties
      );
      res.status(201).json({
        userId: result.userId,
        mechanicId: result.mechanicId,
        email: result.email,
        message: result.requiresEmailConfirmation
          ? "Cuenta creada. Revisa tu correo y confirma la cuenta antes de iniciar sesión."
          : "Cuenta creada exitosamente. Verifica tu correo electrónico."
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("already exists")) {
          res.status(409).json({ error: "Ya existe una cuenta con ese email" });
          return;
        }
        if (
          error.message.includes("over_email_send_rate_limit") ||
          error.message.toLowerCase().includes("email rate limit")
        ) {
          res.status(429).json({
            error: "Supabase limitó temporalmente el envío de correos de confirmación. Desactiva la confirmación de email durante las pruebas o configura un proveedor SMTP."
          });
          return;
        }
        res.status(400).json({ error: error.message });
        return;
      }
      throw error;
    }
  })
);

/**
 * Login with Supabase Auth
 * POST /auth/v2/login
 */
app.post(
  "/auth/v2/login",
  handleAsync(async (req, res) => {
    if (applyRateLimit("auth-login-v2", req, res)) {
      return;
    }

    const payload = z.object({
      email: z.string().email(),
      password: z.string().min(8)
    }).parse(req.body);

    try {
      const result = await loginWithSupabase(payload.email, payload.password);
      res.status(200).json({
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.session.refresh_token ?? null,
        expiresIn: result.session.expires_in ?? 3600
      });
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes("invalid credentials")) {
        res.status(401).json({ error: "Email o contraseña inválidos" });
        return;
      }
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
        return;
      }
      throw error;
    }
  })
);

/**
 * Renovar la sesión cuando el access token venció
 * POST /auth/v2/refresh
 */
app.post(
  "/auth/v2/refresh",
  handleAsync(async (req, res) => {
    if (applyRateLimit("auth-refresh-v2", req, res, 30)) {
      return;
    }

    const payload = z.object({ refreshToken: z.string().min(10) }).parse(req.body);

    try {
      res.status(200).json(await refreshSupabaseSession(payload.refreshToken));
    } catch {
      res.status(401).json({ error: "Tu sesión expiró. Vuelve a iniciar sesión." });
    }
  })
);

app.get(
  "/auth/v2/google",
  handleAsync(async (req, res) => {
    const activeSupabaseUrl = process.env.SUPABASE_URL || supabaseUrl;
    if (!activeSupabaseUrl) {
      res.status(503).json({ error: "La autenticación con Google no está configurada" });
      return;
    }

    const requestedRedirect = typeof req.query.redirectTo === "string"
      ? req.query.redirectTo
      : typeof req.query.redirect_to === "string"
        ? req.query.redirect_to
        : process.env.SUPABASE_MOBILE_REDIRECT_URL || "mecanifique://auth/callback";

    const redirectTo = requestedRedirect.trim();
    if (!redirectTo) {
      res.status(400).json({ error: "redirectTo requerido para el flujo de Google OAuth" });
      return;
    }

    const authorizeUrl = new URL(`${activeSupabaseUrl}/auth/v1/authorize`);
    authorizeUrl.searchParams.set("provider", "google");
    authorizeUrl.searchParams.set("redirect_to", redirectTo);
    res.json({ url: authorizeUrl.toString() });
  })
);

/**
 * Get current user from Supabase Auth
 * GET /auth/v2/me
 */
app.get(
  "/auth/v2/me",
  supabaseAuthMiddleware,
  requireSupabaseAuth,
  handleAsync(async (req, res) => {
    // Devolvemos el usuario local (id numérico, igual que en el login): la
    // app compara ese id contra senderUserId del chat. El de Supabase trae
    // un UUID como id y rompía el "Tú" al reabrir la app.
    res.json({ user: req.auth?.user ?? req.supabaseAuth?.user });
  })
);

// END OF SUPABASE AUTH ENDPOINTS
// ============================================================================

// ============================================================================
// DUAL-ROL: una misma cuenta puede operar como cliente y como mecánico.
// El rol activo vive en users.role (leído en cada request por
// supabaseAuthMiddleware desde la tabla local, no desde los metadatos de
// Supabase — ver el comentario de ensureLocalUser). Cambiar de "modo" es
// por lo tanto solo actualizar esa columna; el resto del backend (los 22
// requireRole existentes) y toda la app móvil ya funcionan preguntando
// "¿cuál es mi rol ahora?", que es exactamente lo que se vuelve dinámico.
// admin queda fuera: no participa del dual-rol.
// ============================================================================
const switchRoleSchema = z.object({
  targetRole: z.enum(["customer", "mechanic"]),
  // Solo se piden si el usuario todavía no tiene perfil de mecánico —
  // si ya lo tiene, se ignoran y se reutiliza el que ya existe.
  city: z.string().trim().min(2).optional(),
  zone: z.string().trim().min(2).optional(),
  yearsExperience: z.number().int().min(0).optional(),
  specialties: z.array(z.string().trim().min(2)).min(1).optional()
});

app.post("/api/account/switch-role", requireAuth, handleAsync(async (req, res) => {
  const authUser = req.auth!.user;
  if (authUser.role === "admin") {
    res.status(403).json({ error: "Los administradores no cambian de modo" });
    return;
  }

  const payload = switchRoleSchema.parse(req.body);

  if (payload.targetRole === authUser.role) {
    res.json({ user: authUser });
    return;
  }

  if (payload.targetRole === "customer") {
    let customerId = authUser.customerId;
    if (!customerId) {
      const mechanicPhone = authUser.mechanicId
        ? (await get<{ phone: string }>("SELECT phone FROM mechanics WHERE id = ?", [authUser.mechanicId]))?.phone
        : null;
      const result = await run(
        "INSERT INTO customers (full_name, phone) VALUES (?, ?)",
        [authUser.fullName, mechanicPhone || `sin-telefono-${authUser.id}`]
      );
      customerId = result.lastID;
      await run("UPDATE users SET customer_id = ? WHERE id = ?", [customerId, authUser.id]);
    }
  } else {
    let mechanicId = authUser.mechanicId;
    if (!mechanicId) {
      if (!payload.city || !payload.zone || payload.yearsExperience == null || !payload.specialties) {
        res.status(400).json({
          error: "Completa ciudad, zona, años de experiencia y especialidades para activar el modo profesional"
        });
        return;
      }
      const customerPhone = authUser.customerId
        ? (await get<{ phone: string }>("SELECT phone FROM customers WHERE id = ?", [authUser.customerId]))?.phone
        : null;
      // Si ya verificó su identidad como cliente, el perfil de mecánico nace
      // activo: no puede volver a verificarse (didit-session responde 409) y
      // el webhook de Didit solo activa a un mecánico que ya existía.
      const initialStatus = (await isIdentityApproved(authUser.id)) ? "active" : "pending_verification";
      const result = await run(
        `INSERT INTO mechanics (full_name, phone, city, zone, years_experience, specialties, status, is_available)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          authUser.fullName,
          customerPhone || `sin-telefono-${authUser.id}`,
          payload.city,
          payload.zone,
          payload.yearsExperience,
          JSON.stringify(payload.specialties),
          initialStatus
        ]
      );
      mechanicId = result.lastID;
      await run("UPDATE users SET mechanic_id = ? WHERE id = ?", [mechanicId, authUser.id]);
    }
  }

  await run("UPDATE users SET role = ? WHERE id = ?", [payload.targetRole, authUser.id]);

  const updatedUser = await get<AuthUser>(
    `SELECT id, role, login, full_name AS fullName, customer_id AS customerId, mechanic_id AS mechanicId
     FROM users WHERE id = ?`,
    [authUser.id]
  );
  res.json({ user: updatedUser });
}));

// ============================================================================
// CUENTA: datos personales, contraseña, favoritos y soporte
// ============================================================================

const accountProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^[0-9+()\-\s]{8,20}$/, "Teléfono inválido").optional()
});

// Nombre visible y teléfono. El nombre también se guarda en Supabase para
// que no se pierda si hay que reconstruir el usuario local.
app.get("/api/account/profile", requireAuth, handleAsync(async (req, res) => {
  const authUser = req.auth!.user;
  const phoneRow = authUser.customerId
    ? await get<{ phone: string }>("SELECT phone FROM customers WHERE id = ?", [authUser.customerId])
    : authUser.mechanicId
      ? await get<{ phone: string }>("SELECT phone FROM mechanics WHERE id = ?", [authUser.mechanicId])
      : undefined;
  // Los teléfonos de relleno ("sin-telefono-…", "supabase-…") no se muestran.
  const phone = phoneRow?.phone && /^[0-9+()\-\s]+$/.test(phoneRow.phone) ? phoneRow.phone : "";
  res.json({ fullName: authUser.fullName, email: authUser.login, phone });
}));

app.patch("/api/account/profile", requireAuth, handleAsync(async (req, res) => {
  const authUser = req.auth!.user;
  const payload = accountProfileSchema.parse(req.body);

  try {
    await run("UPDATE users SET full_name = ? WHERE id = ?", [payload.fullName, authUser.id]);
    if (authUser.customerId) {
      await run(
        "UPDATE customers SET full_name = ?, phone = COALESCE(?, phone) WHERE id = ?",
        [payload.fullName, payload.phone ?? null, authUser.customerId]
      );
    }
    if (authUser.mechanicId) {
      await run(
        "UPDATE mechanics SET full_name = ?, phone = COALESCE(?, phone) WHERE id = ?",
        [payload.fullName, payload.phone ?? null, authUser.mechanicId]
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Ese teléfono ya está registrado en otra cuenta" });
      return;
    }
    throw error;
  }

  // Mejor esfuerzo: si Supabase falla, el cambio local ya quedó.
  updateSupabaseUser(req.auth!.token, {
    data: { full_name: payload.fullName, ...(payload.phone ? { phone: payload.phone } : {}) }
  }).catch((error) => console.error("No se pudo copiar el nombre a Supabase", error));

  res.json({ user: { ...authUser, fullName: payload.fullName } });
}));

app.post("/api/account/password", requireAuth, handleAsync(async (req, res) => {
  if (applyRateLimit("account-password", req, res)) {
    return;
  }
  const payload = z.object({ newPassword: z.string().min(8).max(72) }).parse(req.body);

  try {
    await updateSupabaseUser(req.auth!.token, { password: payload.newPassword });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    res.status(400).json({
      error: message.includes("different")
        ? "La nueva contraseña debe ser distinta de la actual."
        : message.includes("reauth")
          ? "Por seguridad, cierra sesión, vuelve a entrar y cámbiala de nuevo."
          : "No se pudo cambiar la contraseña. Intenta de nuevo."
    });
    return;
  }
  res.json({ ok: true });
}));

app.get("/api/favorites", requireAuth, handleAsync(async (req, res) => {
  const rows = await all<{
    id: number;
    fullName: string;
    city: string;
    zone: string;
    rating: number;
    jobsCompleted: number;
    isOnline: number;
    isAvailable: number;
  }>(
    `SELECT m.id, m.full_name AS fullName, m.city, m.zone, m.rating, m.jobs_completed AS jobsCompleted,
            m.is_online AS isOnline, m.is_available AS isAvailable
     FROM favorite_mechanics f
     JOIN mechanics m ON m.id = f.mechanic_id
     WHERE f.user_id = ? AND m.status = 'active'
     ORDER BY f.created_at DESC`,
    [req.auth!.user.id]
  );
  res.json({
    mechanics: rows.map((row) => ({ ...row, isOnline: Boolean(row.isOnline), isAvailable: Boolean(row.isAvailable) }))
  });
}));

function parseMechanicIdParam(value: unknown): number | null {
  const mechanicId = Number(value);
  return Number.isInteger(mechanicId) && mechanicId > 0 ? mechanicId : null;
}

app.put("/api/favorites/:mechanicId", requireAuth, handleAsync(async (req, res) => {
  const mechanicId = parseMechanicIdParam(req.params.mechanicId);
  if (!mechanicId) {
    res.status(400).json({ error: "Mecánico inválido" });
    return;
  }
  const mechanic = await get<{ id: number }>("SELECT id FROM mechanics WHERE id = ? AND status = 'active'", [mechanicId]);
  if (!mechanic) {
    res.status(404).json({ error: "Mecánico no encontrado" });
    return;
  }
  await run("INSERT OR IGNORE INTO favorite_mechanics (user_id, mechanic_id) VALUES (?, ?)", [req.auth!.user.id, mechanicId]);
  res.json({ ok: true });
}));

app.delete("/api/favorites/:mechanicId", requireAuth, handleAsync(async (req, res) => {
  const mechanicId = parseMechanicIdParam(req.params.mechanicId);
  if (!mechanicId) {
    res.status(400).json({ error: "Mecánico inválido" });
    return;
  }
  await run("DELETE FROM favorite_mechanics WHERE user_id = ? AND mechanic_id = ?", [req.auth!.user.id, mechanicId]);
  res.json({ ok: true });
}));

// Eliminar la propia cuenta (requisito de Google Play). Primero se borra el
// acceso en Supabase: si eso falla no se toca nada; después se borran y
// anonimizan los datos locales (ver src/accountDeletion.ts).
app.delete("/api/account", requireAuth, handleAsync(async (req, res) => {
  if (applyRateLimit("account-delete", req, res)) {
    return;
  }
  const authUser = req.auth!.user;
  if (authUser.role === "admin") {
    res.status(403).json({ error: "Las cuentas de administrador no se eliminan desde la app" });
    return;
  }
  if (!isSupabaseAdminConfigured()) {
    res.status(503).json({ error: "Eliminar cuentas todavía no está disponible. Escríbenos desde Cuenta → Obtener ayuda." });
    return;
  }
  if (await hasActiveServiceBlockingDeletion(authUser)) {
    res.status(409).json({
      error: "Tienes un servicio en curso o una solicitud buscando mecánico. Termínalo o cancélalo antes de eliminar tu cuenta."
    });
    return;
  }

  const row = await get<{ supabaseUserId: string | null }>(
    "SELECT supabase_user_id AS supabaseUserId FROM users WHERE id = ?",
    [authUser.id]
  );
  if (row?.supabaseUserId) {
    try {
      await deleteSupabaseAuthUser(row.supabaseUserId);
    } catch (error) {
      console.error("No se pudo borrar el usuario de Supabase", error);
      res.status(502).json({ error: "No pudimos eliminar tu cuenta en este momento. Intenta de nuevo en unos minutos." });
      return;
    }
  }
  await anonymizeAccount(authUser);
  res.json({ ok: true });
}));

// Página pública para pedir la eliminación sin la app (Google Play la exige
// en la ficha de la tienda). Guarda la solicitud y avisa a los admins.
app.get("/eliminar-cuenta", (_req, res) => {
  res.type("html").send(deletionRequestPage());
});

app.post("/eliminar-cuenta", express.urlencoded({ extended: false, limit: "10kb" }), handleAsync(async (req, res) => {
  if (applyRateLimit("account-delete-web", req, res)) {
    return;
  }
  const parsed = z.object({
    email: z.string().trim().email().max(254),
    message: z.string().trim().max(1000).optional()
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).type("html").send(deletionRequestErrorPage("Escribe un correo válido."));
    return;
  }
  const result = await run(
    "INSERT INTO account_deletion_requests (email, message) VALUES (?, ?)",
    [parsed.data.email.toLowerCase(), parsed.data.message || null]
  );
  const adminUserIds = await getAdminUserIds();
  await Promise.all(
    adminUserIds.map((adminUserId) =>
      createNotification(adminUserId, "Solicitud de eliminación de cuenta", `Desde la web: ${parsed.data.email}`, {
        accountDeletionRequestId: result.lastID
      })
    )
  );
  res.type("html").send(deletionRequestReceivedPage());
}));

app.post("/api/support", requireAuth, handleAsync(async (req, res) => {
  if (applyRateLimit("support-request", req, res)) {
    return;
  }
  const authUser = req.auth!.user;
  const payload = z.object({
    kind: z.enum(["problem", "help"]),
    message: z.string().trim().min(5).max(2000)
  }).parse(req.body);

  const result = await run(
    "INSERT INTO support_requests (user_id, kind, message) VALUES (?, ?, ?)",
    [authUser.id, payload.kind, payload.message]
  );

  const title = payload.kind === "problem" ? "Reporte de problema" : "Solicitud de ayuda";
  const preview = payload.message.length > 140 ? `${payload.message.slice(0, 140)}…` : payload.message;
  const adminUserIds = await getAdminUserIds();
  await Promise.all(
    adminUserIds.map((adminUserId) =>
      createNotification(adminUserId, title, `${authUser.fullName} (${authUser.login}): ${preview}`, {
        supportRequestId: result.lastID
      })
    )
  );

  res.status(201).json({ ok: true });
}));

app.get(
  "/api/notifications",
  requireAuth,
  handleAsync(async (req, res) => {
    const userId = req.auth?.user.id;
    if (!userId) {
      res.status(400).json({ error: "Usuario autenticado inválido" });
      return;
    }

    const notifications = await all<NotificationRow>(
      `
      SELECT id, user_id AS userId, title, body, data_json AS dataJson, read_at AS readAt, created_at AS createdAt
      FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 20
      `,
      [userId]
    );

    const unreadCountRow = await get<{ unreadCount: number }>(
      `
      SELECT COUNT(*) AS unreadCount
      FROM notifications
      WHERE user_id = ? AND read_at IS NULL
      `,
      [userId]
    );

    res.status(200).json({
      notifications,
      unreadCount: unreadCountRow?.unreadCount ?? 0
    });
  })
);

app.post(
  "/api/notifications/:id/read",
  requireAuth,
  handleAsync(async (req, res) => {
    const notificationId = Number(req.params.id);
    const userId = req.auth?.user.id;

    if (!Number.isInteger(notificationId) || notificationId <= 0) {
      res.status(400).json({ error: "notificationId inválido" });
      return;
    }

    if (!userId) {
      res.status(400).json({ error: "Usuario autenticado inválido" });
      return;
    }

    const updated = await run(
      `
      UPDATE notifications
      SET read_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND read_at IS NULL
      `,
      [notificationId, userId]
    );

    if (updated.changes === 0) {
      res.status(404).json({ error: "Notificación no encontrada" });
      return;
    }

    res.status(200).json({ ok: true });
  })
);

app.post(
  "/api/push-tokens",
  requireAuth,
  handleAsync(async (req, res) => {
    const payload = pushTokenSchema.parse(req.body);
    const userId = req.auth?.user.id;
    if (!userId) {
      res.status(400).json({ error: "Usuario autenticado inválido" });
      return;
    }

    await run(
      `
      INSERT INTO push_tokens (user_id, push_token)
      VALUES (?, ?)
      ON CONFLICT(push_token) DO UPDATE SET user_id = excluded.user_id
      `,
      [userId, payload.pushToken]
    );

    res.status(201).json({ ok: true });
  })
);

app.post(
  "/api/service-requests",
  requireAuth,
  requireRole("customer", "admin"),
  handleAsync(async (req, res) => {
    const payload = apiServiceRequestSchema.parse(req.body);
    const customerId = req.auth?.user.role === "customer" ? req.auth.user.customerId : payload.customerId;

    if (!customerId) {
      res.status(400).json({ error: "customerId requerido para crear la solicitud" });
      return;
    }

    let requestedMechanicId = payload.requestedMechanicId;
    const scheduleSlotId = payload.scheduleSlotId;
    let scheduleSlot: ScheduleSlotRow | undefined;

    if (scheduleSlotId) {
      scheduleSlot = await get<ScheduleSlotRow>(
        `
        SELECT id, mechanic_id AS mechanicId, slot_date AS slotDate, start_time AS startTime,
               end_time AS endTime, status, service_request_id AS serviceRequestId, note, created_at AS createdAt
        FROM mechanic_schedule_slots
        WHERE id = ?
        `,
        [scheduleSlotId]
      );

      if (!scheduleSlot) {
        res.status(404).json({ error: "El turno seleccionado no existe" });
        return;
      }

      if (scheduleSlot.status !== "available") {
        res.status(409).json({ error: "El turno ya no está disponible" });
        return;
      }

      requestedMechanicId = requestedMechanicId ?? scheduleSlot.mechanicId;
      if (requestedMechanicId !== scheduleSlot.mechanicId) {
        res.status(409).json({ error: "El turno no pertenece al mecánico solicitado" });
        return;
      }
    }

    // Se decide antes de auto-asignar: si el cliente eligió mecánico o turno,
    // la solicitud es 'direct' y no se reasigna sola a otro mecánico.
    const assignmentMode: "auto" | "direct" = requestedMechanicId || scheduleSlotId ? "direct" : "auto";

    if (!requestedMechanicId && !scheduleSlotId) {
      const coords =
        payload.latitude != null && payload.longitude != null
          ? { latitude: payload.latitude, longitude: payload.longitude }
          : null;
      requestedMechanicId = (await findAvailableMechanic(payload.city, payload.zone, null, coords)) ?? undefined;
    }

    const holdExpiresAt = requestedMechanicId
      ? toSqliteTimestamp(new Date(Date.now() + mechanicHoldMinutes * 60 * 1000))
      : null;
    let requestedMechanicLaborRate: number | null = null;
    let requestedMechanicName: string | null = null;
    if (requestedMechanicId) {
      const requestedMechanic = await get<{ id: number; status: string; is_online: number; is_available: number; labor_rate: number | null; full_name: string }>(
        `
        SELECT id, status, is_online, is_available, labor_rate, full_name
        FROM mechanics
        WHERE id = ?
        `,
        [requestedMechanicId]
      );
      requestedMechanicLaborRate = requestedMechanic?.labor_rate ?? null;
      requestedMechanicName = requestedMechanic?.full_name ?? null;

      if (!requestedMechanic || requestedMechanic.status !== "active" || requestedMechanic.is_online !== 1 || requestedMechanic.is_available !== 1) {
        res.status(404).json({ error: "Mecánico solicitado no disponible para recibir solicitudes" });
        return;
      }

      const activeHold = await get<{ id: number }>(
        `
        SELECT id
        FROM service_requests
        WHERE mechanic_id = ?
          AND status = 'pending'
          AND hold_expires_at IS NOT NULL
          AND hold_expires_at > CURRENT_TIMESTAMP
        LIMIT 1
        `,
        [requestedMechanicId]
      );
      if (activeHold) {
        res.status(409).json({ error: "El mecánico ya está atendiendo otra solicitud" });
        return;
      }
    }

    const customer = await get<{ id: number }>(
      `
      SELECT id
      FROM customers
      WHERE id = ?
      `,
      [customerId]
    );

    if (!customer) {
      res.status(404).json({ error: "Cliente no encontrado" });
      return;
    }

    const result = await run(
      `
      INSERT INTO service_requests (
        customer_id, vehicle_make, vehicle_model, vehicle_year, issue_description,
        preferred_time, city, zone, service_address, latitude, longitude, mechanic_id, status, schedule_slot_id,
        deposit_amount, assignment_mode
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        customerId,
        payload.vehicleMake,
        payload.vehicleModel,
        payload.vehicleYear,
        payload.issueDescription,
        scheduleSlot
          ? `${scheduleSlot.slotDate} ${scheduleSlot.startTime}-${scheduleSlot.endTime}`
          : payload.preferredTime?.trim() || "Ahora",
        payload.city,
        payload.zone,
        payload.serviceAddress?.trim() || `${payload.city}, ${payload.zone}`,
        payload.latitude ?? null,
        payload.longitude ?? null,
        requestedMechanicId ?? null,
        "pending",
        scheduleSlotId ?? null,
        calculateDepositAmount(requestedMechanicLaborRate),
        assignmentMode
      ]
    );

    if (scheduleSlotId) {
      await run(
        `
        UPDATE mechanic_schedule_slots
        SET status = 'reserved', service_request_id = ?, note = COALESCE(note, ?)
        WHERE id = ?
        `,
        [result.lastID, `Reservado por solicitud #${result.lastID}`, scheduleSlotId]
      );
    }

    if (requestedMechanicId) {
      await run(
        `
        UPDATE service_requests
        SET hold_expires_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [holdExpiresAt, result.lastID]
      );
    }

    const customerUserId = await getUserIdByCustomerId(customerId);
    if (customerUserId) {
      if (requestedMechanicId) {
        await createNotification(
          customerUserId,
          "Solicitud creada",
          `Tu solicitud #${result.lastID} fue registrada`,
          { requestId: result.lastID }
        );
      } else {
        // Antes esto era silencioso: la solicitud quedaba "Pendiente" sin
        // mecánico y el cliente no sabía que nadie la iba a recibir.
        await createNotification(
          customerUserId,
          "No hay mecánicos disponibles ahora",
          `Registramos tu solicitud #${result.lastID}, pero no hay mecánicos disponibles en tu zona en este momento. Puedes intentar de nuevo en unos minutos.`,
          { requestId: result.lastID }
        );
      }
    }

    if (requestedMechanicId) {
      const mechanicUserId = await getUserIdByMechanicId(requestedMechanicId);
      if (mechanicUserId) {
        await createNotification(
          mechanicUserId,
          "Nueva solicitud",
          `Tienes una solicitud pendiente #${result.lastID}`,
          { requestId: result.lastID }
        );
      }
    }

    const created = await get(
      `
      SELECT id, customer_id AS customerId, vehicle_make AS vehicleMake, vehicle_model AS vehicleModel,
             vehicle_year AS vehicleYear, issue_description AS issueDescription, preferred_time AS preferredTime,
             city, zone, latitude, longitude, status, mechanic_id AS mechanicId, schedule_slot_id AS scheduleSlotId, hold_expires_at AS holdExpiresAt,
             diagnosis_notes AS diagnosisNotes, repair_notes AS repairNotes,
             estimated_price AS estimatedPrice, final_price AS finalPrice, deposit_amount AS depositAmount,
             created_at AS createdAt, updated_at AS updatedAt
      FROM service_requests
      WHERE id = ?
      `,
      [result.lastID]
    );

    await run(
      `
      INSERT INTO service_request_updates (service_request_id, source, message)
      VALUES (?, 'system', ?)
      `,
      [
        result.lastID,
        requestedMechanicId
          ? `Solicitud enviada a ${requestedMechanicName ?? "un mecánico"}. Tiene ${mechanicHoldMinutes} min para responder.`
          : "No hay mecánicos disponibles en la zona por ahora."
      ]
    );

    res.status(201).json(created);
  })
);

app.post(
  "/api/service-requests/:id/assign",
  requireAuth,
  requireRole("admin"),
  handleAsync(async (req, res) => {
    const requestId = Number(req.params.id);
    const payload = assignSchema.parse(req.body);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      res.status(400).json({ error: "requestId inválido" });
      return;
    }

    const serviceRequest = await get<{
      id: number;
      city: string;
      zone: string;
      status: string;
      customerId: number;
    }>(
      `
      SELECT id, customer_id AS customerId, city, zone, status
      FROM service_requests
      WHERE id = ?
      `,
      [requestId]
    );

    if (!serviceRequest) {
      res.status(404).json({ error: "Solicitud no encontrada" });
      return;
    }

    if (serviceRequest.status === "completed" || serviceRequest.status === "cancelled") {
      res.status(409).json({ error: "No se puede asignar una solicitud cerrada" });
      return;
    }

    let mechanicId = payload.mechanicId;
    if (!mechanicId) {
      const bestMechanic = await get<{ id: number }>(
        `
        SELECT id
        FROM mechanics
        WHERE status = 'active'
          AND is_online = 1
          AND is_available = 1
          AND city = ?
          AND zone = ?
          AND NOT EXISTS (
            SELECT 1
            FROM service_requests held
            WHERE held.mechanic_id = mechanics.id
              AND held.status = 'pending'
              AND held.hold_expires_at IS NOT NULL
              AND held.hold_expires_at > CURRENT_TIMESTAMP
          )
        ORDER BY rating DESC, jobs_completed DESC
        LIMIT 1
        `,
        [serviceRequest.city, serviceRequest.zone]
      );

      mechanicId = bestMechanic?.id;
    }

    if (!mechanicId) {
      res.status(404).json({ error: "No hay mecánicos disponibles en la zona" });
      return;
    }

    const mechanic = await get<{ id: number; status: string; is_available: number; is_online: number }>(
      `
      SELECT id, status, is_available, is_online
      FROM mechanics
      WHERE id = ?
      `,
      [mechanicId]
    );

    if (!mechanic || mechanic.status !== "active") {
      res.status(404).json({ error: "Mecánico activo no encontrado" });
      return;
    }

    if (mechanic.is_available !== 1) {
      res.status(409).json({ error: "Mecánico no disponible" });
      return;
    }
    if (mechanic.is_online !== 1) {
      res.status(409).json({ error: "Mecánico desconectado" });
      return;
    }

    const mechanicClaim = await run(
      `
      UPDATE mechanics
      SET is_available = 0
      WHERE id = ?
        AND status = 'active'
        AND is_online = 1
        AND is_available = 1
      `,
      [mechanicId]
    );
    if (mechanicClaim.changes === 0) {
      res.status(409).json({ error: "El mecánico ya no está disponible" });
      return;
    }

    const requestClaim = await run(
      `
      UPDATE service_requests
      SET mechanic_id = ?, status = 'assigned', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND status = 'pending'
        AND mechanic_id IS NULL
      `,
      [mechanicId, requestId]
    );
    if (requestClaim.changes === 0) {
      await run("UPDATE mechanics SET is_available = 1 WHERE id = ?", [mechanicId]);
      res.status(409).json({ error: "La solicitud ya fue asignada o cambió de estado" });
      return;
    }

    const customerUserId = await getUserIdByCustomerId(serviceRequest.customerId);
    const mechanicUserId = await getUserIdByMechanicId(mechanicId);
    if (customerUserId) {
      await createNotification(
        customerUserId,
        "Solicitud asignada",
        `Tu solicitud #${requestId} fue asignada al mecánico ${mechanicId}`,
        { requestId, mechanicId }
      );
    }
    if (mechanicUserId) {
      await createNotification(
        mechanicUserId,
        "Solicitud asignada",
        `Fuiste asignado a la solicitud #${requestId}`,
        { requestId }
      );
    }

    await run(
      `
      INSERT INTO service_request_updates (service_request_id, source, message)
      VALUES (?, 'system', ?)
      `,
      [requestId, `Mecánico ${mechanicId} asignado`]
    );

    res.status(200).json({ ok: true, mechanicId });
  })
);

app.get(
  "/mechanics",
  handleAsync(async (req, res) => {
    const city = typeof req.query.city === "string" ? req.query.city : undefined;
    const zone = typeof req.query.zone === "string" ? req.query.zone : undefined;
    const availableOnly = req.query.available === "true";
    const latitude = typeof req.query.latitude === "string" ? Number(req.query.latitude) : undefined;
    const longitude = typeof req.query.longitude === "string" ? Number(req.query.longitude) : undefined;
    const requestedRadiusKm = typeof req.query.radiusKm === "string" ? Number(req.query.radiusKm) : 25;
    const radiusKm = Number.isFinite(requestedRadiusKm) ? requestedRadiusKm : 25;
    const hasLocation =
      typeof latitude === "number" &&
      Number.isFinite(latitude) &&
      typeof longitude === "number" &&
      Number.isFinite(longitude);

    let sql = `
      SELECT id, full_name AS fullName, phone, city, zone, years_experience AS yearsExperience,
             specialties, status, is_available AS isAvailable, is_online AS isOnline, rating, review_count AS reviewCount, jobs_completed AS jobsCompleted,
             latitude, longitude, bio, cover_photo_url AS coverPhotoUrl, gallery_json AS galleryJson, labor_rate AS laborRate, created_at AS createdAt
      FROM mechanics
      WHERE status = 'active'
    `;
    const params: Array<string | number> = [];

    if (city) {
      sql += " AND city = ?";
      params.push(city);
    }
    if (zone) {
      sql += " AND zone = ?";
      params.push(zone);
    }
    if (availableOnly) {
      sql += " AND is_available = 1";
    }

    sql += " ORDER BY rating DESC, jobs_completed DESC";

    const mechanics = await all<MechanicRow>(sql, params);
    const normalized = mechanics.map((mechanic) => ({
      ...mechanic,
      specialties: parseSpecialties(mechanic.specialties),
      gallery: JSON.parse(mechanic.galleryJson || '[]'),
      isAvailable: mechanic.isAvailable === 1,
      isOnline: mechanic.isOnline === 1
    }));

    if (!hasLocation) {
      res.json(normalized);
      return;
    }

    const lat = latitude;
    const lng = longitude;
    if (lat === undefined || lng === undefined) {
      res.json(normalized);
      return;
    }

    const nearby = normalized
      .filter((mechanic) => mechanic.latitude !== null && mechanic.longitude !== null)
      .map((mechanic) => ({
        ...mechanic,
        distanceKm: calculateDistanceKm(
          lat,
          lng,
          mechanic.latitude as number,
          mechanic.longitude as number
        )
      }))
      .filter((mechanic) => mechanic.distanceKm <= radiusKm)
      .sort((left, right) => left.distanceKm - right.distanceKm);

    res.json(nearby);
  })
);

app.get(
  "/mechanics/:id/schedule-slots",
  handleAsync(async (req, res) => {
    const mechanicId = Number(req.params.id);
    if (!Number.isInteger(mechanicId) || mechanicId <= 0) {
      res.status(400).json({ error: "mechanicId inválido" });
      return;
    }

    const slots = await all<ScheduleSlotRow>(
      `
      SELECT id, mechanic_id AS mechanicId, slot_date AS slotDate, start_time AS startTime,
             end_time AS endTime, status, service_request_id AS serviceRequestId, note, created_at AS createdAt
      FROM mechanic_schedule_slots
      WHERE mechanic_id = ?
      ORDER BY slot_date ASC, start_time ASC
      LIMIT 20
      `,
      [mechanicId]
    );

    res.status(200).json(slots);
  })
);

app.get(
  "/mechanics/:id/reviews",
  handleAsync(async (req, res) => {
    const mechanicId = Number(req.params.id);
    if (!Number.isInteger(mechanicId) || mechanicId <= 0) {
      res.status(400).json({ error: "mechanicId inválido" });
      return;
    }

    const reviews = await all<MechanicReviewRow>(
      `
      SELECT r.id, r.mechanic_id AS mechanicId, r.service_request_id AS serviceRequestId,
             r.customer_user_id AS customerUserId, u.full_name AS customerName, r.rating, r.comment,
             r.created_at AS createdAt
      FROM mechanic_reviews r
      JOIN users u ON u.id = r.customer_user_id
      WHERE r.mechanic_id = ?
      ORDER BY r.id DESC
      LIMIT 10
      `,
      [mechanicId]
    );

    const stats = await get<{ averageRating: number | null; reviewCount: number }>(
      `
      SELECT AVG(rating) AS averageRating, COUNT(*) AS reviewCount
      FROM mechanic_reviews
      WHERE mechanic_id = ?
      `,
      [mechanicId]
    );

    res.status(200).json({
      stats: {
        averageRating: stats?.averageRating ?? null,
        reviewCount: stats?.reviewCount ?? 0
      },
      reviews
    });
  })
);

app.patch(
  "/api/mechanics/:id/public-profile",
  requireAuth,
  requireRole("mechanic", "admin"),
  handleAsync(async (req, res) => {
    const mechanicId = Number(req.params.id);
    if (!Number.isInteger(mechanicId) || mechanicId <= 0) {
      res.status(400).json({ error: "mechanicId inválido" });
      return;
    }

    if (req.auth?.user.role === "mechanic" && req.auth.user.mechanicId !== mechanicId) {
      res.status(403).json({ error: "Solo puedes editar tu propio perfil público" });
      return;
    }

    const payload = mechanicPublicProfileSchema.parse(req.body);
    const galleryJson = JSON.stringify(payload.galleryUrls ?? []);

    const updated = await run(
      `
      UPDATE mechanics
      SET bio = ?, cover_photo_url = ?, gallery_json = ?, labor_rate = COALESCE(?, labor_rate)
      WHERE id = ?
      `,
      [payload.bio ?? null, payload.coverPhotoUrl || null, galleryJson, payload.laborRate ?? null, mechanicId]
    );

    if (updated.changes === 0) {
      res.status(404).json({ error: "Mecánico no encontrado" });
      return;
    }

    res.status(200).json({ ok: true });
  })
);

// Sube una foto (del perfil público del mecánico) y devuelve su dirección
// pública. El perfil guarda esa dirección con PATCH .../public-profile.
app.post(
  PHOTO_UPLOAD_PATH,
  requireAuth,
  requireRole("mechanic", "admin"),
  handleAsync(async (req, res) => {
    if (applyRateLimit("photo-upload", req, res, 30)) {
      return;
    }

    const payload = z.object({ imageBase64: z.string().min(100) }).parse(req.body);

    let photo: ReturnType<typeof decodePhoto>;
    try {
      photo = decodePhoto(payload.imageBase64);
    } catch (error) {
      if (error instanceof PhotoUploadError) {
        res.status(400).json({ error: error.message });
        return;
      }
      throw error;
    }

    const fileName = await savePhoto(photo, req.auth?.user.id ?? null);
    // Detrás del proxy de Render req.protocol es "http"; el original viene
    // en x-forwarded-proto. Android bloquea imágenes por http en producción.
    const protocol = req.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol;
    const baseUrl = process.env.PUBLIC_BASE_URL || `${protocol}://${req.get("host")}`;
    res.status(201).json({ url: `${baseUrl}/uploads/${fileName}` });
  })
);

app.post(
  "/api/mechanics/:id/reviews",
  requireAuth,
  requireRole("customer", "admin"),
  handleAsync(async (req, res) => {
    const mechanicId = Number(req.params.id);
    if (!Number.isInteger(mechanicId) || mechanicId <= 0) {
      res.status(400).json({ error: "mechanicId inválido" });
      return;
    }

    const payload = mechanicReviewSchema.parse(req.body);
    if (payload.serviceRequestId <= 0) {
      res.status(400).json({ error: "serviceRequestId inválido" });
      return;
    }

    const serviceRequest = await get<{
      id: number;
      customerId: number;
      mechanicId: number | null;
      status: string;
    }>(
      `
      SELECT sr.id, sr.customer_id AS customerId, sr.mechanic_id AS mechanicId, sr.status
      FROM service_requests sr
      WHERE sr.id = ?
      `,
      [payload.serviceRequestId]
    );

    if (!serviceRequest) {
      res.status(404).json({ error: "Solicitud no encontrada" });
      return;
    }

    if (serviceRequest.mechanicId !== mechanicId) {
      res.status(403).json({ error: "La reseña debe corresponder al mecánico asignado" });
      return;
    }

    if (serviceRequest.status !== "completed") {
      res.status(409).json({ error: "Solo puedes reseñar solicitudes terminadas" });
      return;
    }

    if (req.auth?.user.role === "customer" && req.auth.user.customerId !== serviceRequest.customerId) {
      res.status(403).json({ error: "Solo puedes reseñar tus propias solicitudes" });
      return;
    }

    const user = req.auth?.user;
    if (!user) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }

    const existingReview = await get<{ id: number }>(
      `
      SELECT id
      FROM mechanic_reviews
      WHERE service_request_id = ?
      `,
      [payload.serviceRequestId]
    );

    if (existingReview) {
      res.status(409).json({ error: "Ya existe una reseña para esta solicitud" });
      return;
    }

    const result = await run(
      `
      INSERT INTO mechanic_reviews (mechanic_id, service_request_id, customer_user_id, rating, comment)
      VALUES (?, ?, ?, ?, ?)
      `,
      [mechanicId, payload.serviceRequestId, user.id, payload.rating, payload.comment]
    );

    await refreshMechanicRating(mechanicId);

    const created = await get<MechanicReviewRow>(
      `
      SELECT r.id, r.mechanic_id AS mechanicId, r.service_request_id AS serviceRequestId,
             r.customer_user_id AS customerUserId, u.full_name AS customerName, r.rating, r.comment,
             r.created_at AS createdAt
      FROM mechanic_reviews r
      JOIN users u ON u.id = r.customer_user_id
      WHERE r.id = ?
      `,
      [result.lastID]
    );

    const mechanicUserId = await getUserIdByMechanicId(mechanicId);
    if (mechanicUserId) {
      await createNotification(
        mechanicUserId,
        "Nueva reseña",
        `Recibiste una reseña de ${payload.rating} estrellas`,
        { mechanicId, reviewId: result.lastID }
      );
    }

    res.status(201).json(created);
  })
);

app.patch(
  "/api/mechanics/:id/availability",
  requireAuth,
  requireRole("mechanic", "admin"),
  handleAsync(async (req, res) => {
    const mechanicId = Number(req.params.id);
    const payload = availabilitySchema.parse(req.body);

    if (!Number.isInteger(mechanicId) || mechanicId <= 0) {
      res.status(400).json({ error: "mechanicId inválido" });
      return;
    }

    if (req.auth?.user.role === "mechanic" && req.auth.user.mechanicId !== mechanicId) {
      res.status(403).json({ error: "Solo puedes actualizar tu propia disponibilidad" });
      return;
    }

    const updated = await run(
      `
      UPDATE mechanics
      SET is_available = ?
      WHERE id = ?
      `,
      [payload.isAvailable ? 1 : 0, mechanicId]
    );

    if (updated.changes === 0) {
      res.status(404).json({ error: "Mecánico no encontrado" });
      return;
    }

    res.status(200).json({ ok: true });
  })
);

app.patch(
  "/api/mechanics/:id/online",
  requireAuth,
  requireRole("mechanic", "admin"),
  handleAsync(async (req, res) => {
    const mechanicId = Number(req.params.id);
    const payload = onlineSchema.parse(req.body);

    if (!Number.isInteger(mechanicId) || mechanicId <= 0) {
      res.status(400).json({ error: "mechanicId inválido" });
      return;
    }

    if (req.auth?.user.role === "mechanic" && req.auth.user.mechanicId !== mechanicId) {
      res.status(403).json({ error: "Solo puedes cambiar tu propio estado de conexión" });
      return;
    }

    const result = await applyMechanicConnection(mechanicId, payload.isOnline, req.auth?.user.role === "mechanic");
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    res.status(200).json({ ok: true, isOnline: payload.isOnline, isAvailable: result.isAvailable });
  })
);

// Perfil propio del mecánico, en cualquier estado. GET /mechanics solo lista
// mecánicos activos, así que uno pendiente de verificación no podía ver su
// propio estado ni su tarifa desde la app.
app.get(
  "/api/mechanics/me",
  requireAuth,
  requireRole("mechanic"),
  handleAsync(async (req, res) => {
    const mechanicId = req.auth?.user.mechanicId;
    if (!mechanicId) {
      res.status(400).json({ error: "Mecánico autenticado inválido" });
      return;
    }
    await activateMechanicIfIdentityApproved(mechanicId, req.auth!.user.id);
    const mechanic = await get<{
      id: number;
      status: string;
      isOnline: number;
      isAvailable: number;
      laborRate: number | null;
      bio: string | null;
      coverPhotoUrl: string | null;
      galleryJson: string | null;
      city: string;
      zone: string;
    }>(
      `
      SELECT id, status, is_online AS isOnline, is_available AS isAvailable, labor_rate AS laborRate,
             bio, cover_photo_url AS coverPhotoUrl, gallery_json AS galleryJson, city, zone
      FROM mechanics
      WHERE id = ?
      `,
      [mechanicId]
    );
    if (!mechanic) {
      res.status(404).json({ error: "Mecánico no encontrado" });
      return;
    }
    res.json({
      id: mechanic.id,
      status: mechanic.status,
      isOnline: mechanic.isOnline === 1,
      isAvailable: mechanic.isAvailable === 1,
      laborRate: mechanic.laborRate,
      bio: mechanic.bio,
      coverPhotoUrl: mechanic.coverPhotoUrl,
      gallery: JSON.parse(mechanic.galleryJson || "[]"),
      city: mechanic.city,
      zone: mechanic.zone
    });
  })
);

app.patch(
  "/api/mechanics/:id/location",
  requireAuth,
  requireRole("mechanic", "admin"),
  handleAsync(async (req, res) => {
    const mechanicId = Number(req.params.id);
    const payload = mechanicLocationSchema.parse(req.body);
    if (!Number.isInteger(mechanicId) || mechanicId <= 0) {
      res.status(400).json({ error: "mechanicId inválido" });
      return;
    }
    if (req.auth?.user.role === "mechanic" && req.auth.user.mechanicId !== mechanicId) {
      res.status(403).json({ error: "Solo puedes actualizar tu propia ubicación" });
      return;
    }

    const updated = await run(
      "UPDATE mechanics SET latitude = ?, longitude = ? WHERE id = ?",
      [payload.latitude, payload.longitude, mechanicId]
    );
    if (updated.changes === 0) {
      res.status(404).json({ error: "Mecánico no encontrado" });
      return;
    }
    res.status(200).json({ ok: true });
  })
);

app.post(
  "/api/mechanics/:id/schedule-slots",
  requireAuth,
  requireRole("mechanic", "admin"),
  handleAsync(async (req, res) => {
    const mechanicId = Number(req.params.id);
    const payload = mechanicScheduleSlotSchema.parse(req.body);

    if (!Number.isInteger(mechanicId) || mechanicId <= 0) {
      res.status(400).json({ error: "mechanicId inválido" });
      return;
    }

    if (req.auth?.user.role === "mechanic" && req.auth.user.mechanicId !== mechanicId) {
      res.status(403).json({ error: "Solo puedes crear turnos para tu propio perfil" });
      return;
    }

    const result = await run(
      `
      INSERT INTO mechanic_schedule_slots (
        mechanic_id, slot_date, start_time, end_time, note
      )
      VALUES (?, ?, ?, ?, ?)
      `,
      [mechanicId, payload.slotDate, payload.startTime, payload.endTime, payload.note ?? null]
    );

    const slot = await get(
      `
      SELECT id, mechanic_id AS mechanicId, slot_date AS slotDate, start_time AS startTime,
             end_time AS endTime, status, service_request_id AS serviceRequestId, note, created_at AS createdAt
      FROM mechanic_schedule_slots
      WHERE id = ?
      `,
      [result.lastID]
    );

    res.status(201).json(slot);
  })
);

app.patch(
  "/api/mechanics/:id/status",
  requireAuth,
  requireRole("admin"),
  handleAsync(async (req, res) => {
    const mechanicId = Number(req.params.id);
    const payload = mechanicStatusSchema.parse(req.body);

    if (!Number.isInteger(mechanicId) || mechanicId <= 0) {
      res.status(400).json({ error: "mechanicId inválido" });
      return;
    }

    const updated = await run(
      `
      UPDATE mechanics
      SET status = ?
      WHERE id = ?
      `,
      [payload.status, mechanicId]
    );

    if (updated.changes === 0) {
      res.status(404).json({ error: "Mecánico no encontrado" });
      return;
    }

    res.status(200).json({ ok: true });
  })
);

app.patch(
  "/service-requests/:id/status",
  requireAuth,
  requireRole("mechanic", "admin"),
  handleAsync(async (req, res) => {
    const requestId = Number(req.params.id);
    const payload = requestStatusSchema.parse(req.body);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      res.status(400).json({ error: "requestId inválido" });
      return;
    }

    const existing = await get<{ id: number; customerId: number; mechanic_id: number | null; status: string }>(
      `
      SELECT id, customer_id AS customerId, mechanic_id, status
      FROM service_requests
      WHERE id = ?
      `,
      [requestId]
    );

    if (!existing) {
      res.status(404).json({ error: "Solicitud no encontrada" });
      return;
    }

    if (req.auth?.user.role === "mechanic" && req.auth.user.mechanicId !== existing.mechanic_id) {
      res.status(403).json({ error: "Solo el mecánico asignado puede actualizar esta solicitud" });
      return;
    }

    if (!allowedRequestTransitions[existing.status]?.includes(payload.status)) {
      res.status(409).json({
        error: `Transición no permitida: ${existing.status} -> ${payload.status}`
      });
      return;
    }

    await run(
      `
      UPDATE service_requests
      SET status = ?, diagnosis_notes = COALESCE(?, diagnosis_notes),
          repair_notes = COALESCE(?, repair_notes), estimated_price = COALESCE(?, estimated_price),
          final_price = COALESCE(?, final_price), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [
        payload.status,
        payload.diagnosisNotes ?? null,
        payload.repairNotes ?? null,
        payload.estimatedPrice ?? null,
        payload.finalPrice ?? null,
        requestId
      ]
    );

    if (payload.status === "completed" && existing.mechanic_id) {
      await run(
        `
        UPDATE mechanics
        SET is_available = 1, jobs_completed = jobs_completed + 1
        WHERE id = ?
        `,
        [existing.mechanic_id]
      );
    }

    const statusCustomerUserId = await getUserIdByCustomerId(existing.customerId);
    const statusMechanicUserId = existing.mechanic_id ? await getUserIdByMechanicId(existing.mechanic_id) : null;
    if (statusCustomerUserId) {
      await createNotification(
        statusCustomerUserId,
        "Estado actualizado",
        `Tu solicitud #${requestId} cambió a ${payload.status}`,
        { requestId, status: payload.status }
      );
    }
    if (statusMechanicUserId) {
      await createNotification(
        statusMechanicUserId,
        "Estado actualizado",
        `La solicitud #${requestId} cambió a ${payload.status}`,
        { requestId, status: payload.status }
      );
    }

    notifyRequest(requestId, "status-updated", {
      requestId,
      status: payload.status,
      diagnosisNotes: payload.diagnosisNotes ?? null,
      repairNotes: payload.repairNotes ?? null,
      estimatedPrice: payload.estimatedPrice ?? null,
      finalPrice: payload.finalPrice ?? null
    });
    if (statusCustomerUserId) {
      notifyUser(statusCustomerUserId, "status-updated", { requestId, status: payload.status });
    }
    if (statusMechanicUserId) {
      notifyUser(statusMechanicUserId, "status-updated", { requestId, status: payload.status });
    }

    res.status(200).json({ ok: true });
  })
);

app.post(
  "/service-requests/:id/updates",
  requireAuth,
  requireRole("mechanic", "admin"),
  handleAsync(async (req, res) => {
    const requestId = Number(req.params.id);
    const payload = updateSchema.parse(req.body);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      res.status(400).json({ error: "requestId inválido" });
      return;
    }

    const serviceRequest = await get<{ id: number; customerId: number; mechanicId: number | null }>(
      `
      SELECT id, customer_id AS customerId, mechanic_id AS mechanicId
      FROM service_requests
      WHERE id = ?
      `,
      [requestId]
    );

    if (!serviceRequest) {
      res.status(404).json({ error: "Solicitud no encontrada" });
      return;
    }

    const result = await run(
      `
      INSERT INTO service_request_updates (service_request_id, source, message)
      VALUES (?, ?, ?)
      `,
      [requestId, payload.source, payload.message]
    );

    const created = await get(
      `
      SELECT id, service_request_id AS serviceRequestId, source, message, created_at AS createdAt
      FROM service_request_updates
      WHERE id = ?
      `,
      [result.lastID]
    );

    const updateCustomerUserId = await getUserIdByCustomerId(serviceRequest.customerId);
    const updateMechanicUserId = serviceRequest.mechanicId ? await getUserIdByMechanicId(serviceRequest.mechanicId) : null;
    if (updateCustomerUserId) {
      await createNotification(
        updateCustomerUserId,
        "Nuevo update",
        `Tu solicitud #${requestId} recibió una actualización`,
        { requestId, updateId: result.lastID }
      );
    }
    if (updateMechanicUserId) {
      await createNotification(
        updateMechanicUserId,
        "Update publicado",
        `Publicaste un update en la solicitud #${requestId}`,
        { requestId, updateId: result.lastID }
      );
    }

    notifyRequest(requestId, "update-posted", {
      requestId,
      updateId: result.lastID,
      update: created
    });
    if (updateCustomerUserId) {
      notifyUser(updateCustomerUserId, "update-posted", { requestId, updateId: result.lastID });
    }
    if (updateMechanicUserId) {
      notifyUser(updateMechanicUserId, "update-posted", { requestId, updateId: result.lastID });
    }

    res.status(201).json(created);
  })
);

app.get(
  "/api/service-requests/mine",
  requireAuth,
  requireRole("customer", "mechanic", "admin"),
  handleAsync(async (req, res) => {
    const role = req.auth?.user.role;
    const customerId = req.auth?.user.customerId;
    const mechanicId = req.auth?.user.mechanicId;

    let sql = `
      SELECT sr.id, sr.customer_id AS customerId, sr.vehicle_make AS vehicleMake, sr.vehicle_model AS vehicleModel,
             sr.vehicle_year AS vehicleYear, sr.issue_description AS issueDescription, sr.preferred_time AS preferredTime,
             sr.city, sr.zone, sr.status, sr.mechanic_id AS mechanicId, sr.schedule_slot_id AS scheduleSlotId, sr.hold_expires_at AS holdExpiresAt,
             sr.latitude, sr.longitude,
             m.full_name AS mechanicName, c.full_name AS customerName, c.phone AS customerPhone,
             sr.created_at AS createdAt, sr.updated_at AS updatedAt
      FROM service_requests sr
      JOIN customers c ON c.id = sr.customer_id
      LEFT JOIN mechanics m ON m.id = sr.mechanic_id
      WHERE 1 = 1
    `;
    const params: Array<string | number> = [];

    if (role === "customer") {
      if (!customerId) {
        res.status(400).json({ error: "Cliente autenticado inválido" });
        return;
      }

      sql += " AND sr.customer_id = ?";
      params.push(customerId);
    } else if (role === "mechanic") {
      if (!mechanicId) {
        res.status(400).json({ error: "Mecánico autenticado inválido" });
        return;
      }

      sql += " AND sr.mechanic_id = ?";
      params.push(mechanicId);
    }

    sql += " ORDER BY sr.updated_at DESC LIMIT 20";

    const requests = await all(sql, params);
    res.status(200).json(requests);
  })
);

app.get(
  "/api/mechanics/incoming-request",
  requireAuth,
  requireRole("mechanic"),
  handleAsync(async (req, res) => {
    const mechanicId = req.auth?.user.mechanicId;
    if (!mechanicId) {
      res.status(400).json({ error: "Mecánico autenticado inválido" });
      return;
    }

    const mechanic = await get<{ is_online: number; status: string }>(
      `
      SELECT is_online, status
      FROM mechanics
      WHERE id = ?
      `,
      [mechanicId]
    );
    if (!mechanic || mechanic.status !== "active" || mechanic.is_online !== 1) {
      res.status(200).json({ request: null });
      return;
    }

    const incoming = await get(
      `
      SELECT sr.id, sr.customer_id AS customerId, sr.vehicle_make AS vehicleMake, sr.vehicle_model AS vehicleModel,
             sr.vehicle_year AS vehicleYear, sr.issue_description AS issueDescription, sr.preferred_time AS preferredTime,
             sr.city, sr.zone, sr.latitude, sr.longitude, sr.status, sr.mechanic_id AS mechanicId, sr.schedule_slot_id AS scheduleSlotId,
              sr.service_address AS serviceAddress,
             sr.hold_expires_at AS holdExpiresAt, c.full_name AS customerName, c.phone AS customerPhone
      FROM service_requests sr
      JOIN customers c ON c.id = sr.customer_id
      WHERE sr.mechanic_id = ?
        AND sr.status = 'pending'
        AND sr.hold_expires_at IS NOT NULL
        AND sr.hold_expires_at > CURRENT_TIMESTAMP
      ORDER BY sr.updated_at DESC
      LIMIT 1
      `,
      [mechanicId]
    );

    if (!incoming) {
      res.status(200).json({ request: null });
      return;
    }

    res.status(200).json({ request: incoming });
  })
);

app.post(
  "/api/service-requests/:id/respond",
  requireAuth,
  requireRole("mechanic"),
  handleAsync(async (req, res) => {
    const requestId = Number(req.params.id);
    const payload = mechanicHoldResponseSchema.parse(req.body);
    const mechanicId = req.auth?.user.mechanicId;

    if (!Number.isInteger(requestId) || requestId <= 0) {
      res.status(400).json({ error: "requestId inválido" });
      return;
    }

    if (!mechanicId) {
      res.status(400).json({ error: "Mecánico autenticado inválido" });
      return;
    }

    const request = await get<{ id: number; mechanic_id: number | null; status: string; hold_expires_at: string | null }>(
      `
      SELECT id, mechanic_id, status, hold_expires_at
      FROM service_requests
      WHERE id = ?
      `,
      [requestId]
    );

    if (!request) {
      res.status(404).json({ error: "Solicitud no encontrada" });
      return;
    }

    if (request.mechanic_id !== mechanicId) {
      res.status(403).json({ error: "La solicitud no está dirigida a este mecánico" });
      return;
    }

    if (request.status !== "pending" || !request.hold_expires_at) {
      res.status(409).json({ error: "El hold ya expiró o la solicitud cambió de estado" });
      return;
    }

    if (payload.action === "accept") {
      const acceptResult = await run(
        `
        UPDATE service_requests
        SET status = 'assigned', hold_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'pending'
          AND hold_expires_at IS NOT NULL
          AND hold_expires_at > CURRENT_TIMESTAMP
        `,
        [requestId]
      );
      if (acceptResult.changes === 0) {
        res.status(409).json({ error: "El hold ya expiró o la solicitud cambió de estado" });
        return;
      }
      await run(
        `
        UPDATE mechanics
        SET is_available = 0
        WHERE id = ?
        `,
        [mechanicId]
      );
      const customerUserId = await getUserIdByCustomerId((await get<{ customer_id: number }>("SELECT customer_id FROM service_requests WHERE id = ?", [requestId]))?.customer_id ?? 0);
      const mechanicUserId = await getUserIdByMechanicId(mechanicId);
      const acceptingMechanicName =
        (await get<{ fullName: string }>("SELECT full_name AS fullName FROM mechanics WHERE id = ?", [mechanicId]))?.fullName ??
        "Tu mecánico";
      if (customerUserId) {
        await createNotification(
          customerUserId,
          "Solicitud aceptada",
          `${acceptingMechanicName} aceptó tu solicitud #${requestId}`,
          { requestId, mechanicId }
        );
      }
      if (mechanicUserId) {
        await createNotification(
          mechanicUserId,
          "Solicitud aceptada",
          `Aceptaste la solicitud #${requestId}`,
          { requestId }
        );
      }
      await run(
        `
        INSERT INTO service_request_updates (service_request_id, source, message)
        VALUES (?, 'system', ?)
        `,
        [requestId, `${acceptingMechanicName} aceptó la solicitud`]
      );

      res.status(200).json({ ok: true, status: "assigned" });
      return;
    }

    const slotRelease = await get<{ schedule_slot_id: number | null }>(
      `
      SELECT schedule_slot_id
      FROM service_requests
      WHERE id = ?
      `,
      [requestId]
    );

    const rejectResult = await run(
      `
      UPDATE service_requests
      SET mechanic_id = NULL, hold_expires_at = NULL, schedule_slot_id = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND status = 'pending'
        AND mechanic_id = ?
        AND hold_expires_at IS NOT NULL
        AND hold_expires_at > CURRENT_TIMESTAMP
      `,
      [requestId, mechanicId]
    );
    if (rejectResult.changes === 0) {
      res.status(409).json({ error: "El hold ya expiró o la solicitud cambió de estado" });
      return;
    }
    // El turno se libera solo si el rechazo realmente se aplicó (antes se
    // liberaba incluso cuando el hold ya había vencido y se respondía 409).
    await releaseScheduleSlot(slotRelease?.schedule_slot_id ?? null);

    const rejectedMechanicUserId = await getUserIdByMechanicId(mechanicId);
    if (rejectedMechanicUserId) {
      await createNotification(
        rejectedMechanicUserId,
        "Solicitud rechazada",
        `Rechazaste la solicitud #${requestId}`,
        { requestId }
      );
    }

    await handleMechanicDeclined(requestId, mechanicId, "rejected");

    res.status(200).json({ ok: true, status: "pending" });
  })
);

// El cliente pide volver a buscar mecánico para una solicitud que quedó sin
// ninguno (nadie disponible, o el mecánico que eligió no pudo tomarla). La
// solicitud pasa a 'auto' desde este momento.
app.post(
  "/api/service-requests/:id/search-again",
  requireAuth,
  requireRole("customer"),
  handleAsync(async (req, res) => {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      res.status(400).json({ error: "requestId inválido" });
      return;
    }

    const request = await get<{
      customerId: number;
      status: string;
      mechanicId: number | null;
      city: string;
      zone: string;
      latitude: number | null;
      longitude: number | null;
    }>(
      `
      SELECT customer_id AS customerId, status, mechanic_id AS mechanicId, city, zone, latitude, longitude
      FROM service_requests
      WHERE id = ?
      `,
      [requestId]
    );
    if (!request || request.customerId !== req.auth?.user.customerId) {
      res.status(404).json({ error: "Solicitud no encontrada" });
      return;
    }
    if (request.status !== "pending") {
      res.status(409).json({ error: "Esta solicitud ya no está buscando mecánico" });
      return;
    }
    if (request.mechanicId) {
      res.status(409).json({ error: "Un mecánico ya está revisando tu solicitud" });
      return;
    }

    await run("UPDATE service_requests SET assignment_mode = 'auto', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [requestId]);
    // Quien no respondió a tiempo puede estar libre ahora, así que se le puede
    // volver a ofrecer. Quien rechazó explícitamente no se vuelve a molestar.
    await run("DELETE FROM service_request_declines WHERE service_request_id = ? AND reason = 'expired'", [requestId]);

    const nextMechanicId = await findAvailableMechanic(request.city, request.zone, requestId, requestCoords(request));
    const found = nextMechanicId !== null && (await offerRequestToMechanic(requestId, nextMechanicId));
    res.status(200).json({ found });
  })
);

app.post(
  "/api/service-requests/:id/cancel",
  requireAuth,
  requireRole("customer", "admin"),
  handleAsync(async (req, res) => {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      res.status(400).json({ error: "requestId inválido" });
      return;
    }

    const request = await get<{ id: number; customer_id: number; status: string; mechanic_id: number | null; schedule_slot_id: number | null }>(
      `
      SELECT id, customer_id, status, mechanic_id, schedule_slot_id
      FROM service_requests
      WHERE id = ?
      `,
      [requestId]
    );

    if (!request) {
      res.status(404).json({ error: "Solicitud no encontrada" });
      return;
    }

    if (req.auth?.user.role === "customer" && req.auth.user.customerId !== request.customer_id) {
      res.status(403).json({ error: "Solo puedes cancelar tus propias solicitudes" });
      return;
    }

    if (request.status === "completed" || request.status === "cancelled") {
      res.status(409).json({ error: "La solicitud ya está cerrada" });
      return;
    }

    await run(
      `
      UPDATE service_requests
      SET status = 'cancelled', hold_expires_at = NULL, schedule_slot_id = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [requestId]
    );

    if (request.schedule_slot_id) {
      await run(
        `
        UPDATE mechanic_schedule_slots
        SET status = 'available', service_request_id = NULL
        WHERE id = ?
        `,
        [request.schedule_slot_id]
      );
    }

    if (request.mechanic_id) {
      await run(
        `
        UPDATE mechanics
        SET is_available = 1
        WHERE id = ?
        `,
        [request.mechanic_id]
      );
    }

    const cancelledCustomerUserId = await getUserIdByCustomerId(request.customer_id);
    const cancelledMechanicUserId = request.mechanic_id ? await getUserIdByMechanicId(request.mechanic_id) : null;
    if (cancelledCustomerUserId) {
      await createNotification(
        cancelledCustomerUserId,
        "Solicitud cancelada",
        `Tu solicitud #${requestId} fue cancelada`,
        { requestId }
      );
    }
    if (cancelledMechanicUserId) {
      await createNotification(
        cancelledMechanicUserId,
        "Solicitud cancelada",
        `La solicitud #${requestId} fue cancelada`,
        { requestId }
      );
    }

    await run(
      `
      INSERT INTO service_request_updates (service_request_id, source, message)
      VALUES (?, 'system', 'Solicitud cancelada por cliente/admin')
      `,
      [requestId]
    );

    res.status(200).json({ ok: true, status: "cancelled" });
  })
);

app.get(
  "/service-requests/:id",
  requireAuth,
  handleAsync(async (req, res) => {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      res.status(400).json({ error: "requestId inválido" });
      return;
    }

    const request = await get<{
      customerId: number;
      mechanicId: number | null;
    }>(
      `
      SELECT sr.id, sr.customer_id AS customerId, sr.vehicle_make AS vehicleMake, sr.vehicle_model AS vehicleModel,
             sr.vehicle_year AS vehicleYear, sr.issue_description AS issueDescription, sr.preferred_time AS preferredTime,
             sr.city, sr.zone, sr.service_address AS serviceAddress, sr.latitude, sr.longitude, sr.status, sr.mechanic_id AS mechanicId, sr.schedule_slot_id AS scheduleSlotId, sr.hold_expires_at AS holdExpiresAt, sr.diagnosis_notes AS diagnosisNotes,
             sr.repair_notes AS repairNotes, sr.estimated_price AS estimatedPrice, sr.final_price AS finalPrice,
             sr.assignment_mode AS assignmentMode,
             sr.created_at AS createdAt, sr.updated_at AS updatedAt,
             c.full_name AS customerName, c.phone AS customerPhone,
             m.full_name AS mechanicName, m.phone AS mechanicPhone
      FROM service_requests sr
      JOIN customers c ON c.id = sr.customer_id
      LEFT JOIN mechanics m ON m.id = sr.mechanic_id
      WHERE sr.id = ?
      `,
      [requestId]
    );

    if (!request) {
      res.status(404).json({ error: "Solicitud no encontrada" });
      return;
    }

    if (req.auth?.user.role === "customer" && req.auth.user.customerId !== request.customerId) {
      res.status(403).json({ error: "Solo puedes ver tus propias solicitudes" });
      return;
    }

    if (req.auth?.user.role === "mechanic" && req.auth.user.mechanicId !== request.mechanicId) {
      res.status(403).json({ error: "Solo puedes ver solicitudes asignadas a ti" });
      return;
    }

    const updates = await all(
      `
      SELECT id, source, message, created_at AS createdAt
      FROM service_request_updates
      WHERE service_request_id = ?
      ORDER BY id ASC
      `,
      [requestId]
    );

    res.status(200).json({
      ...request,
      updates
    });
  })
);

app.get(
  "/api/service-requests/:id/messages",
  requireAuth,
  handleAsync(async (req, res) => {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      res.status(400).json({ error: "requestId inválido" });
      return;
    }

    const serviceRequest = await get<{ customerId: number; mechanicId: number | null }>(
      `
      SELECT customer_id AS customerId, mechanic_id AS mechanicId
      FROM service_requests
      WHERE id = ?
      `,
      [requestId]
    );

    if (!serviceRequest) {
      res.status(404).json({ error: "Solicitud no encontrada" });
      return;
    }

    if (req.auth?.user.role === "customer" && req.auth.user.customerId !== serviceRequest.customerId) {
      res.status(403).json({ error: "Solo puedes ver mensajes de tus propias solicitudes" });
      return;
    }

    if (req.auth?.user.role === "mechanic" && req.auth.user.mechanicId !== serviceRequest.mechanicId) {
      res.status(403).json({ error: "Solo puedes ver mensajes de solicitudes asignadas a ti" });
      return;
    }

    const messages = await all<RequestMessageRow>(
      `
      SELECT m.id, m.service_request_id AS serviceRequestId, m.sender_user_id AS senderUserId,
             m.sender_role AS senderRole, u.full_name AS senderName, m.message, m.created_at AS createdAt
      FROM service_request_messages m
      JOIN users u ON u.id = m.sender_user_id
      WHERE m.service_request_id = ?
      ORDER BY m.id ASC
      `,
      [requestId]
    );

    res.status(200).json(messages);
  })
);

app.post(
  "/api/service-requests/:id/messages",
  requireAuth,
  handleAsync(async (req, res) => {
    const requestId = Number(req.params.id);
    const payload = z.object({ message: z.string().min(1).max(1_000) }).parse(req.body);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      res.status(400).json({ error: "requestId inválido" });
      return;
    }

    const serviceRequest = await get<{ customerId: number; mechanicId: number | null; status: string }>(
      `
      SELECT customer_id AS customerId, mechanic_id AS mechanicId, status
      FROM service_requests
      WHERE id = ?
      `,
      [requestId]
    );

    if (!serviceRequest) {
      res.status(404).json({ error: "Solicitud no encontrada" });
      return;
    }

    const user = req.auth?.user;
    if (!user) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }

    const isCustomerOwner = user.role === "customer" && user.customerId === serviceRequest.customerId;
    const isAssignedMechanic = user.role === "mechanic" && user.mechanicId === serviceRequest.mechanicId;
    const isAdmin = user.role === "admin";
    if (!isCustomerOwner && !isAssignedMechanic && !isAdmin) {
      res.status(403).json({ error: "No puedes enviar mensajes en esta solicitud" });
      return;
    }

    const result = await run(
      `
      INSERT INTO service_request_messages (service_request_id, sender_user_id, sender_role, message)
      VALUES (?, ?, ?, ?)
      `,
      [requestId, user.id, user.role, payload.message]
    );

    const created = await get<RequestMessageRow>(
      `
      SELECT m.id, m.service_request_id AS serviceRequestId, m.sender_user_id AS senderUserId,
             m.sender_role AS senderRole, u.full_name AS senderName, m.message, m.created_at AS createdAt
      FROM service_request_messages m
      JOIN users u ON u.id = m.sender_user_id
      WHERE m.id = ?
      `,
      [result.lastID]
    );

    const otherUserId =
      user.role === "customer"
        ? await getUserIdByMechanicId(serviceRequest.mechanicId ?? 0)
        : await getUserIdByCustomerId(serviceRequest.customerId);
    if (otherUserId) {
      await createNotification(
        otherUserId,
        "Nuevo mensaje",
        `${user.fullName} escribió en la solicitud #${requestId}`,
        { requestId, messageId: result.lastID }
      );
    }

    res.status(201).json(created);
  })
);

app.patch(
  "/api/service-requests/:id/status",
  requireAuth,
  requireRole("mechanic", "admin"),
  handleAsync(async (req, res) => {
    const requestId = Number(req.params.id);
    const payload = requestStatusSchema.parse(req.body);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      res.status(400).json({ error: "requestId inválido" });
      return;
    }

    const existing = await get<{ id: number; mechanic_id: number | null; status: string }>(
      `
      SELECT id, mechanic_id, status
      FROM service_requests
      WHERE id = ?
      `,
      [requestId]
    );

    if (!existing) {
      res.status(404).json({ error: "Solicitud no encontrada" });
      return;
    }

    if (req.auth?.user.role === "mechanic" && req.auth.user.mechanicId !== existing.mechanic_id) {
      res.status(403).json({ error: "Solo el mecánico asignado puede actualizar esta solicitud" });
      return;
    }

    if (!allowedRequestTransitions[existing.status]?.includes(payload.status)) {
      res.status(409).json({
        error: `Transición no permitida: ${existing.status} -> ${payload.status}`
      });
      return;
    }

    await run(
      `
      UPDATE service_requests
      SET status = ?, diagnosis_notes = COALESCE(?, diagnosis_notes),
          repair_notes = COALESCE(?, repair_notes), estimated_price = COALESCE(?, estimated_price),
          final_price = COALESCE(?, final_price), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [
        payload.status,
        payload.diagnosisNotes ?? null,
        payload.repairNotes ?? null,
        payload.estimatedPrice ?? null,
        payload.finalPrice ?? null,
        requestId
      ]
    );

    if (payload.status === "completed" && existing.mechanic_id) {
      await run(
        `
        UPDATE mechanics
        SET is_available = 1, jobs_completed = jobs_completed + 1
        WHERE id = ?
        `,
        [existing.mechanic_id]
      );
    }

    const statusRequest = await get<{ customer_id: number }>(
      `
      SELECT customer_id
      FROM service_requests
      WHERE id = ?
      `,
      [requestId]
    );
    const statusCustomerUserId = statusRequest ? await getUserIdByCustomerId(statusRequest.customer_id) : null;
    const statusMechanicUserId = existing.mechanic_id ? await getUserIdByMechanicId(existing.mechanic_id) : null;
    const statusLabel = requestStatusLabels[payload.status] ?? payload.status;
    if (statusCustomerUserId) {
      await createNotification(
        statusCustomerUserId,
        payload.status === "completed" ? "Servicio terminado" : "Novedades de tu servicio",
        payload.status === "completed"
          ? `Tu solicitud #${requestId} terminó. Cuéntanos cómo te fue calificando a tu mecánico.`
          : `Solicitud #${requestId}: ${statusLabel}.`,
        { requestId, status: payload.status }
      );
    }
    // El mecánico no necesita un aviso de un cambio que él mismo acaba de
    // hacer; solo si lo hizo un admin.
    if (statusMechanicUserId && req.auth?.user.role === "admin") {
      await createNotification(
        statusMechanicUserId,
        "Estado actualizado",
        `La solicitud #${requestId} cambió a: ${statusLabel}.`,
        { requestId, status: payload.status }
      );
    }

    res.status(200).json({ ok: true });
  })
);

app.post(
  "/api/service-requests/:id/updates",
  requireAuth,
  requireRole("mechanic", "admin"),
  handleAsync(async (req, res) => {
    const requestId = Number(req.params.id);
    const payload = updateSchema.parse(req.body);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      res.status(400).json({ error: "requestId inválido" });
      return;
    }

    const serviceRequest = await get<{ id: number; mechanic_id: number | null }>(
      `
      SELECT id, mechanic_id
      FROM service_requests
      WHERE id = ?
      `,
      [requestId]
    );

    if (!serviceRequest) {
      res.status(404).json({ error: "Solicitud no encontrada" });
      return;
    }

    if (req.auth?.user.role === "mechanic" && req.auth.user.mechanicId !== serviceRequest.mechanic_id) {
      res.status(403).json({ error: "Solo el mecánico asignado puede publicar updates" });
      return;
    }

    const result = await run(
      `
      INSERT INTO service_request_updates (service_request_id, source, message)
      VALUES (?, ?, ?)
      `,
      [requestId, payload.source, payload.message]
    );

    const created = await get(
      `
      SELECT id, service_request_id AS serviceRequestId, source, message, created_at AS createdAt
      FROM service_request_updates
      WHERE id = ? 
      `,
      [result.lastID]
    );

    res.status(201).json(created);

    const requestCustomer = await get<{ customer_id: number }>(
      `
      SELECT customer_id
      FROM service_requests
      WHERE id = ?
      `,
      [requestId]
    );
    const updateCustomerUserId = requestCustomer ? await getUserIdByCustomerId(requestCustomer.customer_id) : null;
    const updateMechanicUserId = serviceRequest.mechanic_id ? await getUserIdByMechanicId(serviceRequest.mechanic_id) : null;
    if (updateCustomerUserId) {
      await createNotification(
        updateCustomerUserId,
        "Nuevo update",
        `Tu solicitud #${requestId} recibió una actualización`,
        { requestId, updateId: result.lastID }
      );
    }
    if (updateMechanicUserId) {
      await createNotification(
        updateMechanicUserId,
        "Update publicado",
        `Publicaste un update en la solicitud #${requestId}`,
        { requestId, updateId: result.lastID }
      );
    }
  })
);

// TEMPORAL: promueve una cuenta existente a admin. Protegido por una clave
// secreta (ADMIN_SETUP_SECRET) que solo tú conoces. Quitar este bloque
// después de usarlo una vez.
app.get(
  "/api/admin-setup/promote",
  handleAsync(async (req, res) => {
    const secret = typeof req.query.key === "string" ? req.query.key : "";
    const email = typeof req.query.email === "string" ? req.query.email : "";

    if (!process.env.ADMIN_SETUP_SECRET || secret !== process.env.ADMIN_SETUP_SECRET) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!email) {
      res.status(400).json({ error: "email requerido" });
      return;
    }

    const updated = await run(
      `UPDATE users SET role = 'admin', mechanic_id = NULL, customer_id = NULL WHERE login = ?`,
      [email]
    );

    if (updated.changes === 0) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    res.status(200).json({ ok: true, message: `${email} ahora es admin` });
  })
);

app.use((_req, res) => {
  res.status(404).json({ error: "Ruta no encontrada" });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) {
    return;
  }

  if (error instanceof z.ZodError) {
    res.status(400).json({
      error: "Payload inválido",
      details: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
    return;
  }

  if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({ error: "JSON inválido" });
    return;
  }

  if (error instanceof Error && "code" in error && error.code === "SQLITE_CONSTRAINT") {
    res.status(409).json({ error: "Conflicto de datos, revisa llaves únicas y relaciones" });
    return;
  }

  console.error("Unhandled request error:", error instanceof Error ? error.message : error);
  res.status(500).json({ error: "Error interno del servidor" });
});

export async function startServer(): Promise<typeof httpServer> {
  await initDb();

  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      httpServer.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      httpServer.off("error", onError);
      startHoldSweep();
      httpServer.once("close", stopHoldSweep);
      console.log(`Mecanifique API escuchando en http://localhost:${port}`);
      resolve(httpServer);
    };

    httpServer.once("error", onError);
    httpServer.once("listening", onListening);
    httpServer.listen(port);
  });
}

if (process.env.MECANIFIQUE_AUTO_START !== "false") {
  startServer().catch((error) => {
    console.error("No se pudo inicializar la base de datos", error);
    process.exit(1);
  });
}