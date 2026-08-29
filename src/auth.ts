import type { NextFunction, Request, Response } from "express";

/**
 * Autenticación de Mecanifique.
 *
 * Todo el login/registro real pasa por Supabase (ver supabaseAuth.ts).
 * Este archivo solo define los tipos y el middleware de autorización
 * (requireAuth / requireRole) que protegen los endpoints usando el
 * `req.auth` que supabaseAuthMiddleware ya llena antes de llegar aquí.
 *
 * El sistema de login propio (password_hash local, tabla `sessions`,
 * /auth/register/*, /auth/login) se eliminó: la app móvil nunca lo
 * llamó (confirmado revisando App.tsx), y mantenerlo activo solo
 * agregaba superficie de ataque sin ningún uso real.
 */

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

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.auth) {
    next();
    return;
  }

  res.status(401).json({ error: "Autenticación requerida" });
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
