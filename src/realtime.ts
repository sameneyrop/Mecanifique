import type http from "node:http";
import { WebSocketServer, type RawData, type WebSocket } from "ws";

/**
 * Tiempo real del panel del Mostrador (web/mostrador.html): cada tienda
 * escucha "store:<id>" y, con cada aviso (que no lleva datos), vuelve a pedir
 * su feed. Para escuchar hay que mandar la sesión en el mismo mensaje de
 * suscripción, y solo entran los miembros de esa tienda.
 *
 * Es el único canal. Antes cualquiera, sin sesión, podía suscribirse a
 * "user:<id>" o "service-request:<id>" y leer los avisos de otras personas;
 * la app nunca los usó (usa avisos push), así que se quitaron.
 */
export type StoreAccessCheck = (token: string, storeId: number) => Promise<boolean>;

const MAX_CHANNELS_PER_SOCKET = 3;
const channels = new Map<string, Set<WebSocket>>();

/** El canal "store:<id>" si la sesión es de un miembro de esa tienda; si no, null. */
export async function authorizeStoreChannel(
  channel: unknown,
  token: unknown,
  canAccessStore: StoreAccessCheck
): Promise<string | null> {
  if (typeof channel !== "string" || typeof token !== "string" || !token || token.length > 4_000) {
    return null;
  }
  const match = /^store:([1-9]\d{0,9})$/.exec(channel.trim());
  if (!match) {
    return null;
  }
  try {
    return (await canAccessStore(token, Number(match[1]))) ? `store:${match[1]}` : null;
  } catch {
    return null;
  }
}

function textOf(raw: RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  return Buffer.from(raw as ArrayBuffer).toString("utf8");
}

function leave(socket: WebSocket, channel: string): void {
  const sockets = channels.get(channel);
  if (!sockets) return;
  sockets.delete(socket);
  if (sockets.size === 0) channels.delete(channel);
}

export function attachRealtime(server: http.Server, canAccessStore: StoreAccessCheck): WebSocketServer {
  // Los mensajes válidos son de unos cientos de bytes (incluido el token).
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 8 * 1024 });
  wss.on("connection", (socket) => {
    const joined = new Set<string>();
    const send = (body: Record<string, unknown>) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(body));
    };
    socket.on("message", async (raw) => {
      let message: { type?: unknown; channel?: unknown; token?: unknown };
      try {
        message = JSON.parse(textOf(raw));
      } catch {
        send({ type: "error", message: "Mensaje inválido" });
        return;
      }
      if (message?.type === "ping") {
        send({ type: "pong", timestamp: Date.now() });
        return;
      }
      if (message?.type === "subscribe") {
        if (joined.size >= MAX_CHANNELS_PER_SOCKET) {
          send({ type: "error", message: "Demasiados canales" });
          return;
        }
        const channel = await authorizeStoreChannel(message.channel, message.token, canAccessStore);
        if (!channel) {
          send({ type: "error", message: "No autorizado" });
          return;
        }
        let sockets = channels.get(channel);
        if (!sockets) {
          sockets = new Set();
          channels.set(channel, sockets);
        }
        sockets.add(socket);
        joined.add(channel);
        send({ type: "subscribed", channel });
        return;
      }
      if (message?.type === "unsubscribe" && typeof message.channel === "string" && joined.has(message.channel)) {
        leave(socket, message.channel);
        joined.delete(message.channel);
      }
    });
    socket.on("close", () => {
      for (const channel of joined) leave(socket, channel);
    });
  });
  return wss;
}

/** Avisa a quien escucha el canal (hoy solo "store:<id>"). El aviso no lleva datos personales. */
export function sendRealtimeEvent(channel: string, event: string, payload: Record<string, unknown> = {}): void {
  const sockets = channels.get(channel);
  if (!sockets) return;
  const envelope = JSON.stringify({ type: "event", channel, event, payload });
  for (const socket of sockets) {
    if (socket.readyState !== socket.OPEN) {
      sockets.delete(socket);
      continue;
    }
    socket.send(envelope);
  }
}
