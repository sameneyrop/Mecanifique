import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { get, run } from "./db";

export type AuthRole = "customer" | "mechanic" | "admin";

export type AuthUser = {
  id: number;
  role: AuthRole;
  login: string;
  fullName: string;
  customerId: number | null;
  mechanicId: number | null;
};

export type AuthContext = {
  user: AuthUser;
  token: string;
};

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthContext;
  }
}

const iterations = 120000;
const keyLength = 64;
const digest = "sha256";
const tokenTtlDays = 30;

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.pbkdf2Sync(password, salt, iterations, keyLength, digest).toString("hex");
  return { salt, hash: derived };
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = hashPassword(password, salt).hash;
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expectedHash, "hex");

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function createSession(userId: number): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + tokenTtlDays * 24 * 60 * 60 * 1000).toISOString();

  await run(
    `
    INSERT INTO sessions (user_id, token_hash, expires_at)
    VALUES (?, ?, ?)
    `,
    [userId, tokenHash, expiresAt]
  );

  return token;
}

export async function getUserByToken(token: string): Promise<AuthUser | null> {
  const tokenHash = sha256(token);
  const user = await get<AuthUser & { expiresAt: string }>(
    `
    SELECT u.id, u.role, u.login, u.full_name AS fullName, u.customer_id AS customerId,
           u.mechanic_id AS mechanicId, s.expires_at AS expiresAt
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
      AND s.revoked_at IS NULL
      AND s.expires_at > CURRENT_TIMESTAMP
    `,
    [tokenHash]
  );

  if (!user) {
    return null;
  }

  return user;
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    next();
    return;
  }

  const token = header.slice(7).trim();
  getUserByToken(token)
    .then((user) => {
      if (user) {
        req.auth = { user, token };
      }
      next();
    })
    .catch(next);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.auth) {
    next();
    return;
  }

  const header = req.header("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    res.status(401).json({ error: "Autenticación requerida" });
    return;
  }

  const token = header.slice(7).trim();
  getUserByToken(token)
    .then((user) => {
      if (!user) {
        res.status(401).json({ error: "Sesión inválida o expirada" });
        return;
      }

      req.auth = { user, token };
      next();
    })
    .catch(next);
}

export function requireRole(...roles: AuthRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({ error: "Autenticación requerida" });
      return;
    }

    if (!roles.includes(req.auth.user.role)) {
      res.status(403).json({ error: "No tienes permisos para esta acción" });
      return;
    }

    next();
  };
}

export async function seedDevAdmin(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  const login = process.env.ADMIN_LOGIN ?? "admin";
  const password = process.env.ADMIN_PASSWORD ?? "admin1234";
  const existing = await get<{ id: number }>(
    `
    SELECT id
    FROM users
    WHERE login = ? AND role = 'admin'
    `,
    [login]
  );

  if (existing) {
    return;
  }

  const { salt, hash } = hashPassword(password);
  await run(
    `
    INSERT INTO users (role, login, full_name, password_salt, password_hash)
    VALUES ('admin', ?, 'Admin', ?, ?)
    `,
    [login, salt, hash]
  );
}

export async function registerCustomerUser(input: {
  fullName: string;
  phone: string;
  password: string;
}): Promise<AuthUser> {
  const customer = await get<{ id: number }>(
    `
    SELECT id
    FROM customers
    WHERE phone = ?
    `,
    [input.phone]
  );

  let customerId = customer?.id;
  if (!customerId) {
    const created = await run(
      `
      INSERT INTO customers (full_name, phone)
      VALUES (?, ?)
      `,
      [input.fullName, input.phone]
    );
    customerId = created.lastID;
  }

  const existingUser = await get<{ id: number }>(
    `
    SELECT id
    FROM users
    WHERE login = ?
    `,
    [input.phone]
  );

  if (existingUser) {
    throw new Error("ACCOUNT_EXISTS");
  }

  const { salt, hash } = hashPassword(input.password);
  const createdUser = await run(
    `
    INSERT INTO users (role, login, full_name, password_salt, password_hash, customer_id)
    VALUES ('customer', ?, ?, ?, ?, ?)
    `,
    [input.phone, input.fullName, salt, hash, customerId]
  );

  return {
    id: createdUser.lastID,
    role: "customer",
    login: input.phone,
    fullName: input.fullName,
    customerId,
    mechanicId: null
  };
}

export async function registerMechanicUser(input: {
  fullName: string;
  phone: string;
  password: string;
  city: string;
  zone: string;
  yearsExperience: number;
  specialties: string[];
  latitude?: number;
  longitude?: number;
}): Promise<AuthUser> {
  const existingUser = await get<{ id: number }>(
    `
    SELECT id
    FROM users
    WHERE login = ?
    `,
    [input.phone]
  );

  if (existingUser) {
    throw new Error("ACCOUNT_EXISTS");
  }

  const mechanicRow = await get<{ id: number }>(
    `
    SELECT id
    FROM mechanics
    WHERE phone = ?
    `,
    [input.phone]
  );

  let mechanicId = mechanicRow?.id;
  if (!mechanicId) {
    const created = await run(
      `
      INSERT INTO mechanics (full_name, phone, city, zone, years_experience, specialties, latitude, longitude)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        input.fullName,
        input.phone,
        input.city,
        input.zone,
        input.yearsExperience,
        JSON.stringify(input.specialties),
        input.latitude ?? null,
        input.longitude ?? null
      ]
    );
    mechanicId = created.lastID;
  }

  const { salt, hash } = hashPassword(input.password);
  const createdUser = await run(
    `
    INSERT INTO users (role, login, full_name, password_salt, password_hash, mechanic_id)
    VALUES ('mechanic', ?, ?, ?, ?, ?)
    `,
    [input.phone, input.fullName, salt, hash, mechanicId]
  );

  return {
    id: createdUser.lastID,
    role: "mechanic",
    login: input.phone,
    fullName: input.fullName,
    customerId: null,
    mechanicId
  };
}

export async function loginUser(input: { login: string; password: string }): Promise<{ user: AuthUser; token: string }> {
  const user = await get<
    AuthUser & { passwordSalt: string; passwordHash: string }
  >(
    `
    SELECT id, role, login, full_name AS fullName, customer_id AS customerId, mechanic_id AS mechanicId,
           password_salt AS passwordSalt, password_hash AS passwordHash
    FROM users
    WHERE login = ?
    `,
    [input.login]
  );

  if (!user) {
    throw new Error("INVALID_CREDENTIALS");
  }

  if (!verifyPassword(input.password, user.passwordSalt, user.passwordHash)) {
    throw new Error("INVALID_CREDENTIALS");
  }

  const token = await createSession(user.id);
  return {
    token,
    user: {
      id: user.id,
      role: user.role,
      login: user.login,
      fullName: user.fullName,
      customerId: user.customerId,
      mechanicId: user.mechanicId
    }
  };
}
