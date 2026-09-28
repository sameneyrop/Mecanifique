import type { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import { get, run } from "./db";
import type { AuthUser } from "./auth";

export type SupabaseAuthUser = {
  id: string;
  email: string;
  role: "customer" | "mechanic" | "admin";
  fullName: string;
  customerId?: number | null;
  mechanicId?: number | null;
};

export type SupabaseAuthContext = {
  user: SupabaseAuthUser;
  token: string;
};

declare module "express-serve-static-core" {
  interface Request {
    supabaseAuth?: SupabaseAuthContext;
  }
}

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
const emailRedirectTo =
  process.env.SUPABASE_REDIRECT_URL || "https://mecanifique.onrender.com/auth/callback";
const supabaseRequestTimeoutMs = 15_000;
const verifiedTokenCache = new Map<string, { user: SupabaseAuthUser; expiresAt: number }>();
const tokenCacheTtlMs = 60_000;

function getSupabaseError(data: Record<string, unknown>, fallback: string): string {
  return String(data.error_description || data.msg || data.message || data.error || fallback);
}

export type SignupErrorCode =
  | "already_registered"
  | "phone_taken"
  | "weak_password"
  | "invalid_email"
  | "rate_limited"
  | "other";

/** Error del registro en Supabase, ya con un mensaje en español para la app. */
export class SignupError extends Error {
  constructor(public code: SignupErrorCode, message: string) {
    super(message);
  }
}

// Supabase responde en inglés ("User already registered", etc.); aquí se
// traduce a lo que la persona puede hacer.
function signupErrorFrom(data: Record<string, unknown>): SignupError {
  const code = String(data.error_code || data.code || "");
  const raw = getSupabaseError(data, "").toLowerCase();
  if (code === "user_already_exists" || /already (registered|exists)/.test(raw)) {
    return new SignupError("already_registered", "Ya existe una cuenta con ese correo.");
  }
  if (code === "weak_password" || raw.includes("password")) {
    return new SignupError("weak_password", "Esa contraseña es muy débil. Usa una más larga, con letras y números.");
  }
  if (code === "email_address_invalid" || code === "validation_failed" || raw.includes("email")) {
    return new SignupError("invalid_email", "Revisa tu correo: parece que está mal escrito.");
  }
  if (code === "over_email_send_rate_limit" || raw.includes("rate limit")) {
    return new SignupError(
      "rate_limited",
      "Hay demasiados registros seguidos. Espera unos minutos e intenta de nuevo."
    );
  }
  console.error("Supabase signup error:", data);
  return new SignupError("other", "No pudimos crear tu cuenta. Intenta de nuevo en unos minutos.");
}

type ProfileTable = "mechanics" | "customers";

// El teléfono es único en cada tabla. Una fila con ese teléfono solo se
// reutiliza si ya es de esta misma cuenta (dos peticiones a la vez al entrar
// por primera vez); si es de otra persona, o de un perfil sin cuenta, la
// cuenta nueva nace con un teléfono de relleno que puede corregir en Cuenta.
// Antes se ligaba a esa fila: la base lo rechazaba y la persona se quedaba
// sin poder entrar ("No se pudo crear el perfil local").
export async function phoneForNewProfile(table: ProfileTable, phone: string, supabaseUserId: string): Promise<string> {
  const placeholder = `supabase-${supabaseUserId}`;
  if (!phone) {
    return placeholder;
  }
  const link = table === "mechanics" ? "mechanic_id" : "customer_id";
  const row = await get<{ supabaseUserId: string | null }>(
    `SELECT u.supabase_user_id AS supabaseUserId FROM ${table} t LEFT JOIN users u ON u.${link} = t.id WHERE t.phone = ?`,
    [phone]
  );
  if (!row) {
    return phone;
  }
  return row.supabaseUserId === supabaseUserId ? phone : placeholder;
}

export async function isPhoneTaken(table: ProfileTable, phone: string): Promise<boolean> {
  return Boolean(await get<{ id: number }>(`SELECT id FROM ${table} WHERE phone = ?`, [phone]));
}

const PHONE_TAKEN_MESSAGE = "Ese teléfono ya está registrado en otra cuenta. Si es tuya, inicia sesión con ella; si no, usa otro número.";

// Exportada para poder testear directamente la resolución de condiciones de
// carrera (ver tests/api.test.js) sin depender de una llamada real a la API
// de Supabase Auth.
export async function ensureLocalUser(supabaseUser: {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}): Promise<AuthUser> {
  const existing = await get<AuthUser>(
    `SELECT id, role, login, full_name AS fullName, customer_id AS customerId, mechanic_id AS mechanicId
     FROM users WHERE supabase_user_id = ?`,
    [supabaseUser.id]
  );
  if (existing) {
    return existing;
  }

  // user_metadata lo escribe el propio usuario (cualquiera con la clave
  // pública de Supabase puede registrarse mandando lo que quiera ahí), así
  // que de ahí solo se acepta cliente o mecánico: el mecánico nace pendiente
  // de verificación. Un admin nunca sale de aquí; se asigna a mano en la base
  // (UPDATE users SET role = 'admin' ...).
  const metadata = supabaseUser.user_metadata || {};
  const email = supabaseUser.email || "";
  const role: "customer" | "mechanic" = metadata.role === "mechanic" ? "mechanic" : "customer";
  // Google manda full_name y name; el registro propio, full_name.
  const fullName = String(metadata.full_name || metadata.name || email);
  const phone = String(metadata.phone || "");

  // Dos peticiones concurrentes (ej. login + la primera petición autenticada
  // que dispara el middleware) pueden llegar aquí ambas con `existing` en
  // null, porque ninguna vio todavía el INSERT de la otra. Para que esto no
  // produzca una fila con el rol equivocado (bug confirmado en producción
  // el 2026-09-05), el INSERT en `users` usa `OR IGNORE`, apoyado en el
  // índice único de supabase_user_id: como máximo una de las peticiones
  // concurrentes logra insertar; la(s) otra(s) simplemente no hacen nada
  // ahí, y todas relogran leyendo el resultado final al final de la
  // función — sin importar cuál "ganó", todas devuelven la misma fila.
  // users.login es único y un correo solo puede tener una cuenta en Supabase.
  // Si una fila local vieja todavía lo tiene (su cuenta de Supabase ya no
  // existe, p. ej. se borró a mano), se le cambia el login para liberarlo;
  // sin esto el INSERT de abajo se ignoraba y la persona no podía entrar.
  if (email) {
    await run(
      `UPDATE users SET login = 'reemplazada-' || id || '@mecanifique.invalid'
       WHERE login = ? AND (supabase_user_id IS NULL OR supabase_user_id <> ?)`,
      [email, supabaseUser.id]
    );
  }

  if (role === "mechanic") {
    // mechanics.phone es UNIQUE, así que dos peticiones concurrentes con el
    // mismo teléfono (el caso real: es la misma persona registrándose dos
    // veces en paralelo) competirían por esa fila también, no solo por la
    // de `users`. INSERT OR IGNORE aquí evita que la segunda petición
    // lance una excepción en vez de simplemente no insertar nada.
    const phoneValue = await phoneForNewProfile("mechanics", phone, supabaseUser.id);
    await run(
      `
      INSERT OR IGNORE INTO mechanics (
        full_name, phone, city, zone, years_experience, specialties,
        status, is_available, is_online, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'pending_verification', 0, 0, datetime('now'))
      `,
      [
        fullName,
        phoneValue,
        String(metadata.city || ""),
        String(metadata.zone || ""),
        Number(metadata.years_experience || 0),
        JSON.stringify(Array.isArray(metadata.specialties) ? metadata.specialties : [String(metadata.specialties || "")].filter(Boolean))
      ]
    );
    // Releemos por phone (no por lastID: si OR IGNORE no insertó porque ya
    // existía, lastID no apunta a la fila real) para obtener el id correcto
    // sin importar cuál petición ganó la carrera.
    const mechanicRow = await get<{ id: number }>("SELECT id FROM mechanics WHERE phone = ?", [phoneValue]);
    if (!mechanicRow) {
      throw new Error("No se pudo crear ni encontrar el registro de mecánico");
    }
    const insertResult = await run(
      `
      INSERT OR IGNORE INTO users (role, login, supabase_user_id, full_name, password_salt, password_hash, mechanic_id)
      VALUES ('mechanic', ?, ?, ?, ?, ?, ?)
      `,
      [email, supabaseUser.id, fullName, crypto.randomBytes(16).toString("hex"), crypto.randomBytes(32).toString("hex"), mechanicRow.id]
    );
  } else {
    // customers.phone también es UNIQUE — mismo patrón que mechanics.
    const phoneValue = await phoneForNewProfile("customers", phone, supabaseUser.id);
    await run(
      `INSERT OR IGNORE INTO customers (full_name, phone, created_at) VALUES (?, ?, datetime('now'))`,
      [fullName, phoneValue]
    );
    const customerRow = await get<{ id: number }>("SELECT id FROM customers WHERE phone = ?", [phoneValue]);
    if (!customerRow) {
      throw new Error("No se pudo crear ni encontrar el registro de cliente");
    }
    await run(
      `
      INSERT OR IGNORE INTO users (role, login, supabase_user_id, full_name, password_salt, password_hash, customer_id)
      VALUES ('customer', ?, ?, ?, ?, ?, ?)
      `,
      [email, supabaseUser.id, fullName, crypto.randomBytes(16).toString("hex"), crypto.randomBytes(32).toString("hex"), customerRow.id]
    );
  }

  const created = await get<AuthUser>(
    `SELECT id, role, login, full_name AS fullName, customer_id AS customerId, mechanic_id AS mechanicId
     FROM users WHERE supabase_user_id = ?`,
    [supabaseUser.id]
  );
  if (!created) {
    throw new Error("No se pudo crear el perfil local");
  }
  return created;
}

async function supabaseFetch(input: string, init: RequestInit): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), supabaseRequestTimeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Register a new customer using Supabase REST API
 */
export async function registerCustomerWithSupabase(
  email: string,
  password: string,
  fullName: string,
  phone: string
) {
  try {
    // Antes de crear la cuenta en Supabase: si algo local falla después, la
    // cuenta queda a medias (existe allá, no aquí).
    if (phone && (await isPhoneTaken("customers", phone))) {
      throw new SignupError("phone_taken", PHONE_TAKEN_MESSAGE);
    }
    // Call Supabase Auth REST API
    const response = await supabaseFetch(`${supabaseUrl}/auth/v1/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify({
        email,
        password,
        email_redirect_to: emailRedirectTo,
        // GoTrue lee los metadatos del usuario de `data`; con `user_metadata`
        // los ignoraba en silencio y Supabase se quedaba sin nombre ni rol.
        data: {
          full_name: fullName,
          phone,
          role: "customer",
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw signupErrorFrom(data);
    }

    if (!data.user) {
      return {
        userId: null,
        customerId: null,
        email,
        requiresEmailConfirmation: true,
      };
    }

    // Perfil local con la misma lógica que al entrar por primera vez.
    const localUser = await ensureLocalUser(data.user);
    return {
      userId: data.user.id,
      customerId: localUser.customerId ?? null,
      email: data.user.email,
    };
  } catch (err) {
    if (err instanceof SignupError) throw err;
    throw new Error(`Failed to register customer: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Register a new mechanic using Supabase REST API
 */
export async function registerMechanicWithSupabase(
  email: string,
  password: string,
  fullName: string,
  phone: string,
  city: string,
  zone: string,
  yearsExperience: number,
  specialties: string[]
) {
  try {
    if (phone && (await isPhoneTaken("mechanics", phone))) {
      throw new SignupError("phone_taken", PHONE_TAKEN_MESSAGE);
    }
    // Call Supabase Auth REST API
    const response = await supabaseFetch(`${supabaseUrl}/auth/v1/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify({
        email,
        password,
        email_redirect_to: emailRedirectTo,
        data: {
          full_name: fullName,
          phone,
          role: "mechanic",
          city,
          zone,
          years_experience: yearsExperience,
          specialties,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw signupErrorFrom(data);
    }

    if (!data.user) {
      return {
        userId: null,
        mechanicId: null,
        email,
        requiresEmailConfirmation: true,
      };
    }

    // Perfil local con la misma lógica que al entrar por primera vez.
    const localUser = await ensureLocalUser(data.user);
    return {
      userId: data.user.id,
      mechanicId: localUser.mechanicId ?? null,
      email: data.user.email,
    };
  } catch (err) {
    if (err instanceof SignupError) throw err;
    throw new Error(`Failed to register mechanic: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Login using Supabase REST API
 */
export async function loginWithSupabase(email: string, password: string) {
  try {
    const response = await supabaseFetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify({
        email,
        password,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(getSupabaseError(data, "Email o contraseña inválidos"));
    }

    if (!data.user || !data.access_token) {
      throw new Error("No session returned from login");
    }

    const localUser = await ensureLocalUser(data.user);

    // Fallback to Supabase auth user metadata if not in SQLite
    const role = localUser.role || (data.user.user_metadata?.role ?? "customer");

    return {
      user: {
        id: data.user.id,
        email: data.user.email || "",
        role: role,
        fullName: localUser.fullName,
        customerId: localUser.customerId,
        mechanicId: localUser.mechanicId,
      },
      session: data,
      accessToken: data.access_token,
    };
  } catch (err) {
    throw new Error(`Login failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Renueva una sesión de Supabase con su refresh token. El access token de
 * Supabase vence a la hora; sin esto, la app queda con un token muerto y
 * todas las rutas protegidas responden 401 hasta cerrar sesión a mano.
 * Supabase rota el refresh token en cada uso: siempre hay que guardar el
 * nuevo que devuelve esta función.
 */
export async function refreshSupabaseSession(refreshToken: string) {
  const response = await supabaseFetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  const data = await response.json();

  if (!response.ok || !data.access_token || !data.refresh_token) {
    throw new Error(getSupabaseError(data, "La sesión ya no es válida"));
  }

  return {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token),
    expiresIn: Number(data.expires_in || 3600),
  };
}

/** Hay clave de administrador de Supabase (necesaria para eliminar cuentas). */
export function isSupabaseAdminConfigured(): boolean {
  return Boolean(supabaseUrl && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

/**
 * Borra el usuario de Supabase Auth (ya no podrá iniciar sesión). Usa la
 * clave de administrador: la heredada "service_role" (un JWT, va también en
 * Authorization) o la nueva "sb_secret_…" (solo en apikey).
 */
export async function deleteSupabaseAuthUser(supabaseUserId: string): Promise<void> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  const headers: Record<string, string> = { apikey: key };
  if (!key.startsWith("sb_")) {
    headers.Authorization = `Bearer ${key}`;
  }
  const response = await supabaseFetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(supabaseUserId)}`, {
    method: "DELETE",
    headers,
  });
  if (response.status === 404) {
    return; // ya no existía
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(getSupabaseError(data as Record<string, unknown>, "No se pudo eliminar el acceso"));
  }
}

/**
 * Cambia datos de la cuenta en Supabase con el token del propio usuario
 * (contraseña y/o metadatos como el nombre).
 */
/**
 * Pide a Supabase que mande el correo para crear una nueva contraseña. El
 * enlace regresa a redirectTo con la sesión en el hash (#access_token=...).
 * Debe estar en Supabase → Authentication → URL Configuration → Redirect URLs.
 */
export async function sendSupabasePasswordRecovery(email: string, redirectTo: string): Promise<void> {
  const url = new URL(`${supabaseUrl}/auth/v1/recover`);
  url.searchParams.set("redirect_to", redirectTo);
  const response = await supabaseFetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: supabaseAnonKey },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(getSupabaseError(data as Record<string, unknown>, "No se pudo mandar el correo"));
  }
}

/** Vuelve a mandar el correo de confirmación de una cuenta sin confirmar. */
export async function resendSupabaseSignupConfirmation(email: string, redirectTo: string): Promise<void> {
  const url = new URL(`${supabaseUrl}/auth/v1/resend`);
  url.searchParams.set("redirect_to", redirectTo);
  const response = await supabaseFetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: supabaseAnonKey },
    body: JSON.stringify({ type: "signup", email }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(getSupabaseError(data as Record<string, unknown>, "No se pudo reenviar el correo"));
  }
}

export async function updateSupabaseUser(
  token: string,
  changes: { password?: string; data?: Record<string, unknown> }
): Promise<void> {
  const response = await supabaseFetch(`${supabaseUrl}/auth/v1/user`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(changes),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(getSupabaseError(data as Record<string, unknown>, "No se pudo actualizar la cuenta"));
  }
}

/**
 * Verify JWT token from Supabase
 */
export async function verifySupabaseToken(token: string) {
  const cached = verifiedTokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  try {
    const response = await supabaseFetch(`${supabaseUrl}/auth/v1/user`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
    });

    const data = await response.json();

    if (!response.ok || !data.id) {
      throw new Error(`Invalid token: ${data.message || "Token verification failed"}`);
    }

    const localUser = await ensureLocalUser(data);

    // Fallback to Supabase auth user metadata if not in SQLite
    const role = localUser.role || (data.user_metadata?.role ?? "customer");

    const user = {
      id: data.id,
      email: data.email || "",
      role: role,
      fullName: localUser.fullName,
      customerId: localUser.customerId,
      mechanicId: localUser.mechanicId,
    };
    verifiedTokenCache.set(token, { user, expiresAt: Date.now() + tokenCacheTtlMs });
    return user;
  } catch (err) {
    throw new Error(`Token verification failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Middleware to extract Supabase auth from request
 */
export async function supabaseAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.substring(7);

  try {
    const user = await verifySupabaseToken(token);
      req.supabaseAuth = {
        user: user as SupabaseAuthUser,
        token,
      };
      const localUser = await get<AuthUser>(
        `SELECT id, role, login, full_name AS fullName, customer_id AS customerId, mechanic_id AS mechanicId
         FROM users WHERE supabase_user_id = ?`,
        [user.id]
      );
      if (localUser) {
        req.auth = { user: localUser, token };
      }
      next();
  } catch (err) {
    console.error("Supabase auth middleware error:", err);
    next();
  }
}

/**
 * Middleware to require Supabase auth
 */
export function requireSupabaseAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.supabaseAuth) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

/**
 * Middleware to require specific role
 */
export function requireSupabaseRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.supabaseAuth) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!roles.includes(req.supabaseAuth.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    next();
  };
}