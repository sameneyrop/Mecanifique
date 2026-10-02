import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { get } from "../db";
import { requireAuth, requireRole } from "../auth";
import { handleAsync } from "../middleware";
import {
  DECLINE_REASONS,
  HOLD_MINUTES,
  MostradorError,
  PART_CATEGORIES,
  PAYMENT_METHODS,
  RESPOND_MINUTES,
  STORE_RADIUS_OPTIONS,
  acceptInvitation,
  cancelHoldByStore,
  cancelPartRequest,
  createInvitation,
  createPartRequest,
  createStoreForAdmin,
  searchDirectory,
  validInvitation,
  deliverHold,
  dispatchHold,
  getStoreSettings,
  holdOffer,
  invitationByToken,

  mechanicPartRequests,
  membershipsForUser,
  mostradorStoresForAdmin,
  requireMembership,
  respondToPartRequest,
  revokeInvitation,
  storeFeed,
  updateStoreSettings
} from "../mostrador";

/**
 * Rutas del Mostrador (src/mostrador.ts):
 * - /api/part-requests…   el mecánico pregunta, ve respuestas, aparta.
 * - /api/mostrador/…      la tienda contesta, entrega y ajusta su tienda.
 * - /api/mostrador/invitations/:token   abrir y aceptar una invitación.
 * - /api/admin/mostrador/…  el admin invita tiendas.
 *
 * Por el canal en tiempo real (`store:<id>`) solo viaja un aviso sin datos
 * ("hay algo nuevo"): el canal no pide sesión, así que lo de la solicitud se
 * pide aparte, con sesión, a /api/mostrador/feed.
 */

type Notify = (userId: number, title: string, body: string, data?: Record<string, string | number | boolean | null>) => Promise<void>;

type MostradorDeps = {
  createNotification: Notify;
  sendRealtimeEvent: (channel: string, event: string, payload?: Record<string, unknown>) => void;
  calculateDistanceKm: (latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number) => number;
  applyRateLimit: (scope: string, req: Request, res: Response, limit?: number, windowMs?: number) => boolean;
  getUserIdByMechanicId: (mechanicId: number) => Promise<number | null>;
  /** Crea la cuenta (correo ya confirmado) y entra; null si no hay clave de administrador de Supabase. */
  createStoreAccount: (email: string, password: string, fullName: string) => Promise<StoreAccountResult>;
  siteUrl: string;
};

export type StoreAccountResult =
  | { ok: true; userId: number; session: Record<string, unknown> }
  | { ok: false; status: number; error: string };

function sendError(res: Response, error: unknown): boolean {
  if (error instanceof MostradorError) {
    res.status(error.status).json({ error: error.message });
    return true;
  }
  return false;
}

function parseId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const money = (amount: number) => `$${Math.round(amount).toLocaleString("es-MX")}`;

export function createMostradorRouter(deps: MostradorDeps) {
  const router = Router();
  const pingStores = (storeIds: number[], event: string) => {
    for (const storeId of new Set(storeIds)) deps.sendRealtimeEvent(`store:${storeId}`, event, {});
  };
  const notifyMechanic = async (mechanicId: number, title: string, body: string, data: Record<string, string | number | boolean | null>) => {
    const userId = await deps.getUserIdByMechanicId(mechanicId);
    if (userId) await deps.createNotification(userId, title, body, data);
  };
  const storeIdFrom = (req: Request) => parseId(req.header("x-store-id") ?? req.query.storeId);
  const wrap =
    (handler: (req: Request, res: Response) => Promise<void>) =>
    handleAsync(async (req: Request, res: Response) => {
      try {
        await handler(req, res);
      } catch (error) {
        if (!sendError(res, error)) throw error;
      }
    });

  // ---------------------------------------------------------------------
  // Mecánico
  // ---------------------------------------------------------------------

  router.get("/part-requests/options", requireAuth, requireRole("mechanic"), (_req, res) => {
    res.json({ categories: PART_CATEGORIES, respondMinutes: RESPOND_MINUTES, holdMinutes: HOLD_MINUTES });
  });

  router.post("/part-requests", requireAuth, requireRole("mechanic"), wrap(async (req, res) => {
    if (deps.applyRateLimit("part-request", req, res, 15)) return;
    const mechanicId = req.auth!.user.mechanicId!;
    const created = await createPartRequest(mechanicId, req.body, deps.calculateDistanceKm);
    pingStores(created.storeIds, "part-request");
    res.status(201).json({ id: created.id, storesNotified: created.storeIds.length });
  }));

  router.get("/part-requests/mine", requireAuth, requireRole("mechanic"), wrap(async (req, res) => {
    const serviceRequestId = parseId(req.query.serviceRequestId);
    res.json({ requests: await mechanicPartRequests(req.auth!.user.mechanicId!, serviceRequestId) });
  }));

  router.post("/part-requests/:id/hold", requireAuth, requireRole("mechanic"), wrap(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) throw new MostradorError(400, "Solicitud inválida");
    const hold = await holdOffer(req.auth!.user.mechanicId!, id, req.body);
    pingStores([hold.storeId], "part-hold");
    res.status(201).json(hold);
  }));

  router.post("/part-requests/:id/cancel", requireAuth, requireRole("mechanic"), wrap(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) throw new MostradorError(400, "Solicitud inválida");
    const result = await cancelPartRequest(req.auth!.user.mechanicId!, id);
    pingStores(result.storeIds, "part-request");
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------------------
  // Tienda
  // ---------------------------------------------------------------------

  router.get("/mostrador/me", requireAuth, wrap(async (req, res) => {
    const memberships = await membershipsForUser(req.auth!.user.id);
    if (!memberships.length) {
      res.status(403).json({ error: "Tu cuenta no está ligada a ninguna refaccionaria de Mostrador.", memberships: [] });
      return;
    }
    const current = await requireMembership(req.auth!.user.id, storeIdFrom(req));
    res.json({
      user: { fullName: req.auth!.user.fullName },
      memberships,
      store: await getStoreSettings(current.storeId),
      role: current.role,
      options: {
        categories: PART_CATEGORIES,
        radiusKm: STORE_RADIUS_OPTIONS,
        declineReasons: DECLINE_REASONS,
        paymentMethods: PAYMENT_METHODS,
        holdMinutes: HOLD_MINUTES
      }
    });
  }));

  router.put("/mostrador/settings", requireAuth, wrap(async (req, res) => {
    const member = await requireMembership(req.auth!.user.id, storeIdFrom(req));
    res.json({ store: await updateStoreSettings(member.storeId, req.body) });
  }));

  router.get("/mostrador/feed", requireAuth, wrap(async (req, res) => {
    const member = await requireMembership(req.auth!.user.id, storeIdFrom(req));
    res.json(await storeFeed(member.storeId));
  }));

  router.post("/mostrador/requests/:id/respond", requireAuth, wrap(async (req, res) => {
    const member = await requireMembership(req.auth!.user.id, storeIdFrom(req));
    const id = parseId(req.params.id);
    if (!id) throw new MostradorError(400, "Solicitud inválida");
    const result = await respondToPartRequest({ storeId: member.storeId, userId: req.auth!.user.id, partRequestId: id, body: req.body });
    if (result.available !== "no") {
      await notifyMechanic(
        result.mechanicId,
        `${result.storeName} ${result.available === "yes" ? "tiene" : "consigue"} tu ${result.part.toLowerCase()}`,
        `Desde ${money(result.cheapest ?? 0)}. Ábrela para apartarla.`,
        { partRequestId: id, ...(result.serviceRequestId ? { requestId: result.serviceRequestId } : {}) }
      );
    }
    res.json({ ok: true });
  }));

  router.post("/mostrador/holds/:id/dispatch", requireAuth, wrap(async (req, res) => {
    const member = await requireMembership(req.auth!.user.id, storeIdFrom(req));
    const id = parseId(req.params.id);
    if (!id) throw new MostradorError(400, "Apartado inválido");
    const hold = await dispatchHold(member.storeId, id);
    await notifyMechanic(hold.mechanicId, "Tu pieza va en camino", `${hold.storeName} mandó tu ${hold.part.toLowerCase()} con su repartidor.`, {
      partRequestId: hold.partRequestId,
      ...(hold.serviceRequestId ? { requestId: hold.serviceRequestId } : {})
    });
    res.json({ ok: true });
  }));

  router.post("/mostrador/holds/:id/deliver", requireAuth, wrap(async (req, res) => {
    const member = await requireMembership(req.auth!.user.id, storeIdFrom(req));
    const id = parseId(req.params.id);
    if (!id) throw new MostradorError(400, "Apartado inválido");
    const delivered = await deliverHold(member.storeId, id, req.body);
    await notifyMechanic(
      delivered.mechanicId,
      "Recibiste tu pieza",
      delivered.receiptId
        ? `El ticket ${delivered.ticketCode} de ${delivered.storeName} ya está en el servicio.`
        : `${delivered.storeName} registró la entrega con el ticket ${delivered.ticketCode}.`,
      { partRequestId: delivered.partRequestId, ...(delivered.serviceRequestId ? { requestId: delivered.serviceRequestId } : {}) }
    );
    if (delivered.customerId && delivered.serviceRequestId) {
      const customer = await get<{ id: number }>("SELECT id FROM users WHERE customer_id = ?", [delivered.customerId]);
      if (customer) {
        await deps.createNotification(
          customer.id,
          delivered.overEstimate ? "Revisa un ticket de refacciones" : "Ticket de refacciones",
          delivered.overEstimate
            ? `${delivered.storeName}: ${money(delivered.price)}, más de lo cotizado. Apruébalo en tu servicio.`
            : `${delivered.storeName}: ${delivered.part}, ${money(delivered.price)}. Es el precio de la tienda.`,
          { requestId: delivered.serviceRequestId }
        );
      }
    }
    res.json({ ok: true, ticketCode: delivered.ticketCode, receiptCreated: Boolean(delivered.receiptId) });
  }));

  router.post("/mostrador/holds/:id/cancel", requireAuth, wrap(async (req, res) => {
    const member = await requireMembership(req.auth!.user.id, storeIdFrom(req));
    const id = parseId(req.params.id);
    if (!id) throw new MostradorError(400, "Apartado inválido");
    const hold = await cancelHoldByStore(member.storeId, id, req.body);
    await notifyMechanic(
      hold.mechanicId,
      `${hold.storeName} ya no puede entregar tu pieza`,
      `Aparta otra respuesta de tu ${hold.part.toLowerCase()} o pregunta de nuevo.`,
      { partRequestId: hold.partRequestId, ...(hold.serviceRequestId ? { requestId: hold.serviceRequestId } : {}) }
    );
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------------------
  // Invitaciones
  // ---------------------------------------------------------------------

  router.get("/mostrador/invitations/:token", wrap(async (req, res) => {
    if (deps.applyRateLimit("store-invitation-view", req, res, 30)) return;
    const invitation = await invitationByToken(String(req.params.token));
    if (!invitation) {
      res.status(404).json({ error: "Invitación no encontrada. Revisa el enlace." });
      return;
    }
    res.json({ storeName: invitation.storeName, email: invitation.email, state: invitation.state });
  }));

  // Cuenta nueva: la crea con el correo de la invitación (ya confirmado: el
  // enlace se lo mandó el admin directo) y la liga a la tienda.
  router.post("/mostrador/invitations/:token/accept", wrap(async (req, res) => {
    if (deps.applyRateLimit("store-invitation-accept", req, res, 8)) return;
    const payload = z
      .object({ fullName: z.string().trim().min(3).max(80), password: z.string().min(8).max(72) })
      .safeParse(req.body);
    if (!payload.success) throw new MostradorError(400, "Escribe tu nombre y una contraseña de al menos 8 caracteres.");
    if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(payload.data.password) || !/\d/.test(payload.data.password)) {
      throw new MostradorError(400, "Tu contraseña necesita letras y números.");
    }
    const invitation = await validInvitation(String(req.params.token));
    const account = await deps.createStoreAccount(invitation.email, payload.data.password, payload.data.fullName);
    if (!account.ok) {
      res.status(account.status).json({ error: account.error });
      return;
    }
    const membership = await acceptInvitation(String(req.params.token), account.userId);
    res.status(201).json({ ...account.session, membership });
  }));

  // Ya tenía cuenta de Mecanifique: entra con ella y acepta.
  router.post("/mostrador/invitations/:token/claim", requireAuth, wrap(async (req, res) => {
    const membership = await acceptInvitation(String(req.params.token), req.auth!.user.id);
    res.json({ membership });
  }));

  // ---------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------

  router.get("/admin/mostrador/stores", requireAuth, requireRole("admin"), wrap(async (_req, res) => {
    const stores = await mostradorStoresForAdmin();
    const directory = await get<{ total: number }>("SELECT COUNT(*) AS total FROM parts_stores WHERE status = 'active'");
    res.json({ stores, directoryCount: Number(directory?.total ?? 0) });
  }));

  router.get("/admin/mostrador/directory", requireAuth, requireRole("admin"), wrap(async (req, res) => {
    res.json({ stores: await searchDirectory(typeof req.query.q === "string" ? req.query.q : "") });
  }));

  router.post("/admin/mostrador/stores", requireAuth, requireRole("admin"), wrap(async (req, res) => {
    res.status(201).json(await createStoreForAdmin(req.body));
  }));

  router.post("/admin/mostrador/invitations", requireAuth, requireRole("admin"), wrap(async (req, res) => {
    const payload = z
      .object({ storeId: z.number().int().positive(), email: z.string().trim().max(120), role: z.enum(["owner", "staff"]).optional() })
      .safeParse(req.body);
    if (!payload.success) throw new MostradorError(400, "Elige la refaccionaria y escribe el correo de quien la va a usar.");
    const invitation = await createInvitation({ ...payload.data, createdByUserId: req.auth!.user.id });
    const link = `${deps.siteUrl.replace(/\/$/, "")}/mostrador?invitacion=${invitation.token}`;
    res.status(201).json({ id: invitation.id, link, expiresAt: invitation.expiresAt });
  }));

  router.delete("/admin/mostrador/invitations/:id", requireAuth, requireRole("admin"), wrap(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) throw new MostradorError(400, "Invitación inválida");
    await revokeInvitation(id);
    res.json({ ok: true });
  }));

  return router;
}
