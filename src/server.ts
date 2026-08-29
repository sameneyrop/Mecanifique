import "dotenv/config";
import cors from "cors";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { all, get, initDb, run } from "./db";
import { requireAuth, requireRole } from "./auth";
import {
  supabaseAuthMiddleware,
  requireSupabaseAuth,
  requireSupabaseRole,
  registerCustomerWithSupabase,
  registerMechanicWithSupabase,
  loginWithSupabase
} from "./supabaseAuth";

const app = express();
const port = Number(process.env.PORT ?? "4000");
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
app.use(express.json({ limit: "1mb" }));
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

const customerSchema = z.object({
  fullName: z.string().min(3),
  phone: z.string().min(10)
});

const vehicleFieldsSchema = z.object({
  nickname: z.string().trim().min(1).max(50).optional(),
  make: z.string().trim().min(2).max(50),
  model: z.string().trim().min(1).max(50),
  year: z.number().int().gte(1886).lte(new Date().getFullYear() + 1),
  licensePlate: z.string().trim().min(2).max(12).regex(/^[A-Za-z0-9 -]+$/).optional(),
  color: z.string().trim().min(1).max(30).optional(),
  mileage: z.number().int().nonnegative().max(2_000_000).optional(),
  photoUrls: z.array(z.string().url().refine((url) => /^https?:\/\//i.test(url), "La foto debe ser una URL HTTP(S)")).max(10).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});
const vehicleCreateSchema = vehicleFieldsSchema;
const vehicleUpdateSchema = vehicleFieldsSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "Debes enviar al menos un campo para actualizar"
);

const serviceRequestSchema = z.object({
  customerId: z.number().int().positive(),
  vehicleMake: z.string().min(2),
  vehicleModel: z.string().min(1),
  vehicleYear: z.number().int().gte(1970).lte(new Date().getFullYear() + 1),
  issueDescription: z.string().min(10),
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

const mechanicStatusSchema = z.object({
  status: z.enum(["pending_verification", "active", "suspended"])
});

const updateSchema = z.object({
  source: z.enum(["mechanic", "system"]),
  message: z.string().min(3)
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
  diagnosisNotes: z.string().min(3).optional(),
  repairNotes: z.string().min(3).optional(),
  estimatedPrice: z.number().nonnegative().optional(),
  finalPrice: z.number().nonnegative().optional()
});

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
  note: z.string().min(1).optional()
});

const mechanicPublicProfileSchema = z.object({
  bio: z.string().max(500).optional(),
  coverPhotoUrl: z.string().url().optional().or(z.literal("")),
  galleryUrls: z.array(z.string().url()).max(6).optional()
});

const mechanicReviewSchema = z.object({
  serviceRequestId: z.number().int().positive(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().min(3).max(500)
});

const pushTokenSchema = z.object({
  pushToken: z.string().min(10)
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

async function createNotification(
  userId: number,
  title: string,
  body: string,
  data: Record<string, string | number | boolean | null> = {}
): Promise<void> {
  await run(
    `
    INSERT INTO notifications (user_id, title, body, data_json)
    VALUES (?, ?, ?, ?)
    `,
    [userId, title, body, JSON.stringify(data)]
  );
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

function handleAsync(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

function maskLicensePlate(plate: string | null): string | null {
  if (!plate) return null;
  const compact = plate.replace(/\s+/g, "");
  if (compact.length <= 3) return "*".repeat(compact.length);
  return `${compact.slice(0, Math.min(2, compact.length - 2))}${"*".repeat(Math.max(1, compact.length - 4))}${compact.slice(-2)}`;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function vehicleResponse(row: {
  id: number; customerId: number; nickname: string | null; make: string; model: string;
  year: number; licensePlate: string | null; color: string | null; mileage: number | null;
  photoUrlsJson: string; metadataJson: string; createdAt: string; updatedAt: string;
}) {
  return {
    id: row.id, customerId: row.customerId, nickname: row.nickname, make: row.make,
    model: row.model, year: row.year, licensePlate: maskLicensePlate(row.licensePlate),
    color: row.color, mileage: row.mileage,
    photoUrls: parseJson<string[]>(row.photoUrlsJson, []),
    metadata: parseJson<Record<string, unknown>>(row.metadataJson, {}),
    createdAt: row.createdAt, updatedAt: row.updatedAt
  };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "mecanifique-api" });
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

// ============================================================================
// VEHICLE PROFILES (customer-owned metadata; photos are external URLs only)
// ============================================================================
function requireAnyAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.auth || req.supabaseAuth) {
    next();
    return;
  }
  res.status(401).json({ error: "Autenticación requerida" });
}

function customerIdForVehicle(req: Request, res: Response): number | null {
  const customerId = req.auth?.user.customerId ?? req.supabaseAuth?.user.customerId ?? null;
  if (!customerId || (req.auth?.user.role !== "customer" && req.supabaseAuth?.user.role !== "customer")) {
    res.status(403).json({ error: "Solo los clientes pueden administrar sus vehículos" });
    return null;
  }
  return customerId;
}

const vehicleSelect = `
  SELECT id, customer_id AS customerId, nickname, make, model, year,
         license_plate AS licensePlate, color, mileage,
         photo_urls_json AS photoUrlsJson, metadata_json AS metadataJson,
         created_at AS createdAt, updated_at AS updatedAt
  FROM vehicle_profiles
`;

app.get(["/api/vehicles", "/api/customer/vehicles"], requireAnyAuth, handleAsync(async (req, res) => {
  const customerId = customerIdForVehicle(req, res);
  if (!customerId) return;
  const rows = await all<any>(`${vehicleSelect} WHERE customer_id = ? ORDER BY id DESC`, [customerId]);
  res.json({ vehicles: rows.map(vehicleResponse) });
}));

app.post(["/api/vehicles", "/api/customer/vehicles"], requireAnyAuth, handleAsync(async (req, res) => {
  const customerId = customerIdForVehicle(req, res);
  if (!customerId) return;
  const payload = vehicleCreateSchema.parse(req.body);
  const result = await run(
    `INSERT INTO vehicle_profiles
      (customer_id, nickname, make, model, year, license_plate, color, mileage, photo_urls_json, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [customerId, payload.nickname ?? null, payload.make, payload.model, payload.year,
      payload.licensePlate?.toUpperCase() ?? null, payload.color ?? null, payload.mileage ?? null,
      JSON.stringify(payload.photoUrls ?? []), JSON.stringify(payload.metadata ?? {})]
  );
  const row = await get<any>(`${vehicleSelect} WHERE id = ? AND customer_id = ?`, [result.lastID, customerId]);
  res.status(201).json(vehicleResponse(row));
}));

app.get(["/api/vehicles/:id", "/api/customer/vehicles/:id"], requireAnyAuth, handleAsync(async (req, res) => {
  const customerId = customerIdForVehicle(req, res);
  if (!customerId) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "vehicleId inválido" });
    return;
  }
  const row = await get<any>(`${vehicleSelect} WHERE id = ? AND customer_id = ?`, [id, customerId]);
  if (!row) {
    res.status(404).json({ error: "Vehículo no encontrado" });
    return;
  }
  res.json(vehicleResponse(row));
}));

app.patch(["/api/vehicles/:id", "/api/customer/vehicles/:id"], requireAnyAuth, handleAsync(async (req, res) => {
  const customerId = customerIdForVehicle(req, res);
  if (!customerId) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "vehicleId inválido" });
    return;
  }
  const payload = vehicleUpdateSchema.parse(req.body);
  const current = await get<any>(`SELECT * FROM vehicle_profiles WHERE id = ? AND customer_id = ?`, [id, customerId]);
  if (!current) {
    res.status(404).json({ error: "Vehículo no encontrado" });
    return;
  }
  const values: unknown[] = [];
  const sets: string[] = [];
  const add = (column: string, value: unknown) => { sets.push(`${column} = ?`); values.push(value); };
  if (payload.nickname !== undefined) add("nickname", payload.nickname);
  if (payload.make !== undefined) add("make", payload.make);
  if (payload.model !== undefined) add("model", payload.model);
  if (payload.year !== undefined) add("year", payload.year);
  if (payload.licensePlate !== undefined) add("license_plate", payload.licensePlate.toUpperCase());
  if (payload.color !== undefined) add("color", payload.color);
  if (payload.mileage !== undefined) add("mileage", payload.mileage);
  if (payload.photoUrls !== undefined) add("photo_urls_json", JSON.stringify(payload.photoUrls));
  if (payload.metadata !== undefined) add("metadata_json", JSON.stringify(payload.metadata));
  sets.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id, customerId);
  await run(`UPDATE vehicle_profiles SET ${sets.join(", ")} WHERE id = ? AND customer_id = ?`, values as any[]);
  const row = await get<any>(`${vehicleSelect} WHERE id = ? AND customer_id = ?`, [id, customerId]);
  res.json(vehicleResponse(row));
}));

app.delete(["/api/vehicles/:id", "/api/customer/vehicles/:id"], requireAnyAuth, handleAsync(async (req, res) => {
  const customerId = customerIdForVehicle(req, res);
  if (!customerId) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "vehicleId inválido" });
    return;
  }
  const result = await run("DELETE FROM vehicle_profiles WHERE id = ? AND customer_id = ?", [id, customerId]);
  if (result.changes === 0) {
    res.status(404).json({ error: "Vehículo no encontrado" });
    return;
  }
  res.status(204).send();
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
        expiresIn: 3600
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

app.get(
  "/auth/v2/google",
  handleAsync(async (req, res) => {
    if (!supabaseUrl) {
      res.status(503).json({ error: "La autenticación con Google no está configurada" });
      return;
    }
    const redirectTo = process.env.SUPABASE_MOBILE_REDIRECT_URL || "mecanifique://auth/callback";
    const authorizeUrl = new URL(`${supabaseUrl}/auth/v1/authorize`);
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
    res.json({ user: req.supabaseAuth?.user });
  })
);

// END OF SUPABASE AUTH ENDPOINTS
// ============================================================================

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

    if (!requestedMechanicId && !scheduleSlotId) {
      const nearbyMechanic = await get<{ id: number }>(
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
        [payload.city, payload.zone]
      );
      requestedMechanicId = nearbyMechanic?.id;
    }

    const holdExpiresAt = requestedMechanicId
      ? toSqliteTimestamp(new Date(Date.now() + mechanicHoldMinutes * 60 * 1000))
      : null;
    if (requestedMechanicId) {
      const requestedMechanic = await get<{ id: number; status: string; is_online: number; is_available: number }>(
        `
        SELECT id, status, is_online, is_available
        FROM mechanics
        WHERE id = ?
        `,
        [requestedMechanicId]
      );

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
        preferred_time, city, zone, service_address, latitude, longitude, mechanic_id, status, schedule_slot_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        scheduleSlotId ?? null
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
      await createNotification(
        customerUserId,
        "Solicitud creada",
        `Tu solicitud #${result.lastID} fue registrada`,
        { requestId: result.lastID }
      );
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
             estimated_price AS estimatedPrice, final_price AS finalPrice, created_at AS createdAt, updated_at AS updatedAt
      FROM service_requests
      WHERE id = ?
      `,
      [result.lastID]
    );

    if (requestedMechanicId) {
      await run(
        `
        INSERT INTO service_request_updates (service_request_id, source, message)
        VALUES (?, 'system', ?)
        `,
        [
          result.lastID,
          `Solicitud enviada directamente al mecánico ${requestedMechanicId}. Hold de ${mechanicHoldMinutes} minutos`
        ]
      );
    }

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

app.post(
  "/mechanics",
  handleAsync(async (req, res) => {
    const payload = mechanicRegistrationSchema.parse(req.body);
    const result = await run(
      `
      INSERT INTO mechanics (full_name, phone, city, zone, years_experience, specialties, latitude, longitude)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        payload.fullName,
        payload.phone,
        payload.city,
        payload.zone,
        payload.yearsExperience,
        JSON.stringify(payload.specialties),
        payload.latitude ?? null,
        payload.longitude ?? null
      ]
    );

    const created = await get<MechanicRow>(
      `
      SELECT id, full_name AS fullName, phone, city, zone, years_experience AS yearsExperience,
             specialties, status, is_available AS isAvailable, is_online AS isOnline, rating, review_count AS reviewCount, jobs_completed AS jobsCompleted,
             latitude, longitude, bio, cover_photo_url AS coverPhotoUrl, gallery_json AS galleryJson, created_at AS createdAt
      FROM mechanics
      WHERE id = ?
      `,
      [result.lastID]
    );

    if (!created) {
      res.status(500).json({ error: "No se pudo recuperar el mecánico creado" });
      return;
    }

    res.status(201).json({
      ...created,
      specialties: JSON.parse(created.specialties),
      isAvailable: created.isAvailable === 1,
      isOnline: created.isOnline === 1
    });
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
             latitude, longitude, bio, cover_photo_url AS coverPhotoUrl, gallery_json AS galleryJson, created_at AS createdAt
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
      specialties: JSON.parse(mechanic.specialties),
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
      SET bio = ?, cover_photo_url = ?, gallery_json = ?
      WHERE id = ?
      `,
      [payload.bio ?? null, payload.coverPhotoUrl || null, galleryJson, mechanicId]
    );

    if (updated.changes === 0) {
      res.status(404).json({ error: "Mecánico no encontrado" });
      return;
    }

    res.status(200).json({ ok: true });
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
  "/mechanics/:id/availability",
  handleAsync(async (req, res) => {
    const mechanicId = Number(req.params.id);
    const payload = availabilitySchema.parse(req.body);

    if (!Number.isInteger(mechanicId) || mechanicId <= 0) {
      res.status(400).json({ error: "mechanicId inválido" });
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
  "/mechanics/:id/status",
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

    const updated = await run(
      `
      UPDATE mechanics
      SET is_online = ?, is_available = CASE WHEN ? = 1 THEN is_available ELSE 0 END
      WHERE id = ?
      `,
      [payload.isOnline ? 1 : 0, payload.isOnline ? 1 : 0, mechanicId]
    );

    if (updated.changes === 0) {
      res.status(404).json({ error: "Mecánico no encontrado" });
      return;
    }

    res.status(200).json({ ok: true, isOnline: payload.isOnline });
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

app.post(
  "/customers",
  handleAsync(async (req, res) => {
    const payload = customerSchema.parse(req.body);
    const result = await run(
      `
      INSERT INTO customers (full_name, phone)
      VALUES (?, ?)
      `,
      [payload.fullName, payload.phone]
    );

    const customer = await get(
      `
      SELECT id, full_name AS fullName, phone, created_at AS createdAt
      FROM customers
      WHERE id = ?
      `,
      [result.lastID]
    );

    res.status(201).json(customer);
  })
);

app.post(
  "/service-requests",
  handleAsync(async (req, res) => {
    const payload = serviceRequestSchema.parse(req.body);

    const customer = await get<{ id: number }>(
      `
      SELECT id
      FROM customers
      WHERE id = ?
      `,
      [payload.customerId]
    );

    if (!customer) {
      res.status(404).json({ error: "Cliente no encontrado" });
      return;
    }

    const result = await run(
      `
      INSERT INTO service_requests (
        customer_id, vehicle_make, vehicle_model, vehicle_year, issue_description,
        preferred_time, city, zone, latitude, longitude
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        payload.customerId,
        payload.vehicleMake,
        payload.vehicleModel,
        payload.vehicleYear,
        payload.issueDescription,
        payload.preferredTime?.trim() || "Ahora",
        payload.city,
        payload.zone,
        payload.latitude ?? null,
        payload.longitude ?? null
      ]
    );

    const created = await get(
      `
      SELECT id, customer_id AS customerId, vehicle_make AS vehicleMake, vehicle_model AS vehicleModel,
             vehicle_year AS vehicleYear, issue_description AS issueDescription, preferred_time AS preferredTime,
             city, zone, latitude, longitude, status, mechanic_id AS mechanicId, schedule_slot_id AS scheduleSlotId, diagnosis_notes AS diagnosisNotes, repair_notes AS repairNotes,
             estimated_price AS estimatedPrice, final_price AS finalPrice, created_at AS createdAt, updated_at AS updatedAt
      FROM service_requests
      WHERE id = ?
      `,
      [result.lastID]
    );

    res.status(201).json(created);
  })
);

app.post(
  "/service-requests/:id/assign",
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
    }>(
      `
      SELECT id, city, zone, status
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

    const mechanic = await get<{ id: number; status: string; is_available: number }>(
      `
      SELECT id, status, is_available
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

    await run(
      `
      UPDATE service_requests
      SET mechanic_id = ?, status = 'assigned', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [mechanicId, requestId]
    );

    await run(
      `
      UPDATE mechanics
      SET is_available = 0
      WHERE id = ?
      `,
      [mechanicId]
    );

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
      if (customerUserId) {
        await createNotification(
          customerUserId,
          "Solicitud aceptada",
          `El mecánico ${mechanicId} aceptó tu solicitud #${requestId}`,
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
        [requestId, `Mecánico ${mechanicId} aceptó la solicitud`]
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
    if (slotRelease?.schedule_slot_id) {
      await run(
        `
        UPDATE mechanic_schedule_slots
        SET status = 'available', service_request_id = NULL
        WHERE id = ?
        `,
        [slotRelease.schedule_slot_id]
      );
    }

    const rejectResult = await run(
      `
      UPDATE service_requests
      SET mechanic_id = NULL, hold_expires_at = NULL, schedule_slot_id = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND status = 'pending'
        AND hold_expires_at IS NOT NULL
        AND hold_expires_at > CURRENT_TIMESTAMP
      `,
      [requestId]
    );
    if (rejectResult.changes === 0) {
      res.status(409).json({ error: "El hold ya expiró o la solicitud cambió de estado" });
      return;
    }

    const rejectedCustomerId = await get<{ customer_id: number }>(
      `
      SELECT customer_id
      FROM service_requests
      WHERE id = ?
      `,
      [requestId]
    );
    const rejectedCustomerUserId = rejectedCustomerId
      ? await getUserIdByCustomerId(rejectedCustomerId.customer_id)
      : null;
    const rejectedMechanicUserId = await getUserIdByMechanicId(mechanicId);
    if (rejectedCustomerUserId) {
      await createNotification(
        rejectedCustomerUserId,
        "Solicitud rechazada",
        `El mecánico ${mechanicId} rechazó tu solicitud #${requestId}`,
        { requestId, mechanicId }
      );
    }
    if (rejectedMechanicUserId) {
      await createNotification(
        rejectedMechanicUserId,
        "Solicitud rechazada",
        `Rechazaste la solicitud #${requestId}`,
        { requestId }
      );
    }

    await run(
      `
      INSERT INTO service_request_updates (service_request_id, source, message)
      VALUES (?, 'system', ?)
      `,
      [requestId, `Mecánico ${mechanicId} rechazó la solicitud en hold`]
    );

    res.status(200).json({ ok: true, status: "pending" });
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
    const payload = z.object({ message: z.string().min(1) }).parse(req.body);

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

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`Mecanifique API escuchando en http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("No se pudo inicializar la base de datos", error);
    process.exit(1);
  });
