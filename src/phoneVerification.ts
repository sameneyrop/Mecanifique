import crypto from "node:crypto";
import { get, run } from "./db";

/**
 * Verificación por teléfono (SMS con Twilio Verify):
 * - Al registrarse (o al cambiar de número) hay que confirmar el teléfono con
 *   un código.
 * - Al entrar desde un teléfono que la cuenta no había usado, se vuelve a
 *   pedir un código. Cada teléfono manda un identificador propio en el
 *   encabezado X-Device-Id (lo genera la app y lo guarda cifrado).
 * Mientras falte, el servidor responde 403 con code
 * PHONE_VERIFICATION_REQUIRED a todo salvo lo necesario para verificarse.
 *
 * Sin TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_VERIFY_SERVICE_SID en el
 * entorno, la verificación queda apagada y la app funciona como antes.
 */

export type VerifyGateway = {
  send(to: string): Promise<void>;
  check(to: string, code: string): Promise<boolean>;
};

let gatewayForTests: VerifyGateway | undefined;

export function setVerifyGatewayForTests(gateway: VerifyGateway | undefined) {
  gatewayForTests = gateway;
}

function twilioGateway(): VerifyGateway | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();
  if (!accountSid || !authToken || !serviceSid) {
    return null;
  }
  const base = `https://verify.twilio.com/v2/Services/${serviceSid}`;
  const headers = {
    Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
    "Content-Type": "application/x-www-form-urlencoded"
  };
  return {
    async send(to) {
      const response = await fetch(`${base}/Verifications`, {
        method: "POST",
        headers,
        body: new URLSearchParams({ To: to, Channel: "sms", Locale: "es" })
      });
      if (!response.ok) {
        throw new Error(`Twilio Verify ${response.status}: ${await response.text()}`);
      }
    },
    async check(to, code) {
      const response = await fetch(`${base}/VerificationCheck`, {
        method: "POST",
        headers,
        body: new URLSearchParams({ To: to, Code: code })
      });
      // 404: el código venció o ya se usó.
      if (response.status === 404) return false;
      if (!response.ok) {
        throw new Error(`Twilio Verify ${response.status}: ${await response.text()}`);
      }
      const data = (await response.json()) as { status?: string };
      return data.status === "approved";
    }
  };
}

function gateway(): VerifyGateway | null {
  return gatewayForTests ?? twilioGateway();
}

export function isPhoneVerificationEnabled(): boolean {
  return gateway() !== null;
}

export class PhoneVerificationError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Número mexicano en formato internacional (+52 y 10 dígitos), o null. */
export function normalizeMexicanPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+52${digits}`;
  if (digits.length === 12 && digits.startsWith("52")) return `+${digits}`;
  if (digits.length === 13 && digits.startsWith("521")) return `+52${digits.slice(3)}`;
  return null;
}

function phoneHint(phone: string): string {
  return `•••• ${phone.slice(-4, -2)} ${phone.slice(-2)}`;
}

type Viewer = { id: number; customerId: number | null; mechanicId: number | null };

async function currentPhone(viewer: Viewer): Promise<string | null> {
  const row = viewer.customerId
    ? await get<{ phone: string }>("SELECT phone FROM customers WHERE id = ?", [viewer.customerId])
    : viewer.mechanicId
      ? await get<{ phone: string }>("SELECT phone FROM mechanics WHERE id = ?", [viewer.mechanicId])
      : undefined;
  return normalizeMexicanPhone(row?.phone);
}

export type VerificationStatus = {
  required: boolean;
  // 'phone': falta confirmar el número; 'device': teléfono nuevo.
  reason: "phone" | "device" | null;
  needsPhoneNumber: boolean;
  phoneHint: string | null;
};

export async function getVerificationStatus(viewer: Viewer, deviceId: string | undefined): Promise<VerificationStatus> {
  if (!isPhoneVerificationEnabled()) {
    return { required: false, reason: null, needsPhoneNumber: false, phoneHint: null };
  }
  const phone = await currentPhone(viewer);
  const user = await get<{ verifiedPhone: string | null }>("SELECT verified_phone AS verifiedPhone FROM users WHERE id = ?", [
    viewer.id
  ]);
  const phoneVerified = Boolean(phone && user?.verifiedPhone === phone);
  const deviceTrusted = Boolean(
    deviceId &&
      (await get<{ id: number }>("SELECT id FROM trusted_devices WHERE user_id = ? AND device_id = ?", [viewer.id, deviceId]))
  );
  if (phoneVerified && deviceTrusted) {
    return { required: false, reason: null, needsPhoneNumber: false, phoneHint: null };
  }
  return {
    required: true,
    reason: phoneVerified ? "device" : "phone",
    needsPhoneNumber: !phone,
    phoneHint: phone ? phoneHint(phone) : null
  };
}

/** Manda el código. Si la cuenta no tiene un número válido, se guarda el que escribió. */
export async function sendVerificationCode(viewer: Viewer, newPhone?: string): Promise<{ phoneHint: string }> {
  const verify = gateway();
  if (!verify) {
    throw new PhoneVerificationError(503, "La verificación por teléfono no está disponible.");
  }
  let phone = await currentPhone(viewer);
  if (newPhone !== undefined) {
    const normalized = normalizeMexicanPhone(newPhone);
    if (!normalized) {
      throw new PhoneVerificationError(400, "Escribe tu número a 10 dígitos, por ejemplo 449 123 4567.");
    }
    if (normalized !== phone) {
      const localDigits = normalized.slice(3);
      try {
        if (viewer.customerId) await run("UPDATE customers SET phone = ? WHERE id = ?", [localDigits, viewer.customerId]);
        if (viewer.mechanicId) await run("UPDATE mechanics SET phone = ? WHERE id = ?", [localDigits, viewer.mechanicId]);
      } catch (error) {
        if (error instanceof Error && error.message.includes("UNIQUE")) {
          throw new PhoneVerificationError(409, "Ese teléfono ya está registrado en otra cuenta.");
        }
        throw error;
      }
      phone = normalized;
    }
  }
  if (!phone) {
    throw new PhoneVerificationError(400, "Escribe tu número de teléfono para mandarte el código.");
  }
  await verify.send(phone);
  return { phoneHint: phoneHint(phone) };
}

/**
 * Revisa el código: confirma el número y confía en este teléfono. Si el
 * teléfono todavía no tiene identificador, se le crea uno (la app lo guarda).
 */
export async function confirmVerificationCode(
  viewer: Viewer,
  deviceId: string | undefined,
  code: string
): Promise<{ deviceId: string }> {
  const verify = gateway();
  if (!verify) {
    throw new PhoneVerificationError(503, "La verificación por teléfono no está disponible.");
  }
  const phone = await currentPhone(viewer);
  if (!phone) {
    throw new PhoneVerificationError(400, "Escribe tu número de teléfono para mandarte el código.");
  }
  if (!(await verify.check(phone, code))) {
    throw new PhoneVerificationError(400, "Ese código no es correcto o ya venció. Pide otro.");
  }
  await run("UPDATE users SET verified_phone = ?, phone_verified_at = CURRENT_TIMESTAMP WHERE id = ?", [phone, viewer.id]);
  const trustedId = deviceId ?? crypto.randomUUID();
  await run(
    `INSERT INTO trusted_devices (user_id, device_id) VALUES (?, ?)
     ON CONFLICT(user_id, device_id) DO UPDATE SET last_used_at = CURRENT_TIMESTAMP`,
    [viewer.id, trustedId]
  );
  return { deviceId: trustedId };
}
