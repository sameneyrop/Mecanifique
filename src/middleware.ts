import type { NextFunction, Request, Response } from "express";

/**
 * Envuelve un handler async para que sus errores lleguen al manejador
 * de errores de Express (next(error)) en vez de perderse en una promesa
 * rechazada sin capturar. Se usa en prácticamente todas las rutas.
 */
export function handleAsync(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

/**
 * Permite el paso a cualquier usuario autenticado, sea por el sistema
 * legado (req.auth, hoy llenado únicamente por supabaseAuthMiddleware)
 * o por Supabase directo (req.supabaseAuth). Úsalo cuando una ruta no
 * necesita restringir por rol, solo confirmar que hay sesión.
 */
export function requireAnyAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.auth || req.supabaseAuth) {
    next();
    return;
  }
  res.status(401).json({ error: "Autenticación requerida" });
}
