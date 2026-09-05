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

async function ensureLocalUser(supabaseUser: {
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

  const metadata = supabaseUser.user_metadata || {};
  const email = supabaseUser.email || "";
  const role: "customer" | "mechanic" | "admin" =
    metadata.role === "mechanic" ? "mechanic" : metadata.role === "admin" ? "admin" : "customer";
  const fullName = String(metadata.full_name || email);
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
  if (role === "admin") {
    await run(
      `
      INSERT OR IGNORE INTO users (role, login, supabase_user_id, full_name, password_salt, password_hash)
      VALUES ('admin', ?, ?, ?, ?, ?)
      `,
      [
        email,
        supabaseUser.id,
        fullName,
        crypto.randomBytes(16).toString("hex"),
        crypto.randomBytes(32).toString("hex")
      ]
    );
  } else if (role === "mechanic") {
    // mechanics.phone es UNIQUE, así que dos peticiones concurrentes con el
    // mismo teléfono (el caso real: es la misma persona registrándose dos
    // veces en paralelo) competirían por esa fila también, no solo por la
    // de `users`. INSERT OR IGNORE aquí evita que la segunda petición
    // lance una excepción en vez de simplemente no insertar nada.
    const phoneValue = phone || `supabase-${supabaseUser.id}`;
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
        Array.isArray(metadata.specialties) ? metadata.specialties.join(", ") : String(metadata.specialties || "")
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
    const phoneValue = phone || `supabase-${supabaseUser.id}`;
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
        user_metadata: {
          full_name: fullName,
          phone,
          role: "customer",
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Supabase signup error:", data);
      throw new Error(`Signup failed: ${getSupabaseError(data, "No fue posible crear la cuenta")}`);
    }

    if (!data.user) {
      return {
        userId: null,
        customerId: null,
        email,
        requiresEmailConfirmation: true,
      };
    }

    // Also create customer record in local SQLite for reference
    const result = await run(
      `
      INSERT INTO customers (full_name, phone, created_at)
      VALUES (?, ?, datetime('now'))
      `,
      [fullName, phone]
    );
    await run(
      `
      INSERT INTO users (role, login, supabase_user_id, full_name, password_salt, password_hash, customer_id)
      VALUES ('customer', ?, ?, ?, ?, ?, ?)
      `,
      [
        email,
        data.user.id,
        fullName,
        crypto.randomBytes(16).toString("hex"),
        crypto.randomBytes(32).toString("hex"),
        result.lastID
      ]
    );

    return {
      userId: data.user.id,
      customerId: result.lastID,
      email: data.user.email,
    };
  } catch (err) {
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
        user_metadata: {
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
      throw new Error(`Signup failed: ${getSupabaseError(data, "No fue posible crear la cuenta")}`);
    }

    if (!data.user) {
      return {
        userId: null,
        mechanicId: null,
        email,
        requiresEmailConfirmation: true,
      };
    }

    // Create mechanic record in SQLite
    const result = await run(
      `
      INSERT INTO mechanics (
        full_name, phone, city, zone, years_experience, specialties,
        status, is_available, is_online, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'pending_verification', 0, 0, datetime('now'))
      `,
      [
        fullName,
        phone,
        city,
        zone,
        yearsExperience,
        specialties.join(", ")
      ]
    );
    await run(
      `
      INSERT INTO users (role, login, supabase_user_id, full_name, password_salt, password_hash, mechanic_id)
      VALUES ('mechanic', ?, ?, ?, ?, ?, ?)
      `,
      [
        email,
        data.user.id,
        fullName,
        crypto.randomBytes(16).toString("hex"),
        crypto.randomBytes(32).toString("hex"),
        result.lastID
      ]
    );

    return {
      userId: data.user.id,
      mechanicId: result.lastID,
      email: data.user.email,
    };
  } catch (err) {
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