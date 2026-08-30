import crypto from "node:crypto";

/**
 * Integración con Didit (verificación de identidad).
 * Docs: https://docs.didit.me
 *
 * Flujo: tu backend crea una "sesión" en Didit y le devuelve al móvil la
 * URL hospedada por Didit (session.url). El móvil abre esa URL en un
 * WebView; ahí el mecánico sube su INE y se toma la selfie — Didit se
 * encarga de esas pantallas, tu servidor nunca ve ni guarda el archivo.
 * Cuando termina, Didit llama a tu webhook con el resultado.
 */

const DIDIT_API_BASE = "https://verification.didit.me/v2";

type DiditConfig = {
  apiKey: string;
  workflowId: string;
  webhookSecret: string;
};

export function getDiditConfig(): DiditConfig | null {
  const apiKey = process.env.DIDIT_API_KEY?.trim();
  const workflowId = process.env.DIDIT_WORKFLOW_ID?.trim();
  const webhookSecret = process.env.DIDIT_WEBHOOK_SECRET?.trim();

  if (!apiKey || !workflowId || !webhookSecret) {
    return null;
  }

  return { apiKey, workflowId, webhookSecret };
}

export type DiditSession = {
  session_id: string;
  url: string;
};

/**
 * Crea una sesión de verificación en Didit para un usuario específico.
 * vendorData amarra la sesión a tu propio userId, para poder identificar
 * a quién corresponde cuando llegue el webhook con el resultado.
 */
export async function createDiditSession(userId: number, callbackUrl: string): Promise<DiditSession> {
  const config = getDiditConfig();
  if (!config) {
    throw new Error("DIDIT_NOT_CONFIGURED");
  }

  const response = await fetch(`${DIDIT_API_BASE}/session/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey
    },
    body: JSON.stringify({
      workflow_id: config.workflowId,
      vendor_data: String(userId),
      callback: callbackUrl
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DIDIT_SESSION_FAILED: ${response.status} ${text}`);
  }

  const data = (await response.json()) as DiditSession;
  return data;
}

/**
 * Didit firma cada webhook con HMAC-SHA256 sobre el body crudo, usando el
 * webhook secret como clave. Hay que verificarlo ANTES de confiar en el
 * contenido — cualquiera podría mandar un POST falso a esta URL si no se
 * valida la firma.
 */
export function verifyDiditWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
  const config = getDiditConfig();
  if (!config || !signatureHeader) {
    return false;
  }

  const expected = crypto.createHmac("sha256", config.webhookSecret).update(rawBody).digest("hex");

  // timingSafeEqual requiere buffers del mismo tamaño; si no coinciden en
  // longitud, ya sabemos que la firma es inválida.
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(signatureHeader, "hex");
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

export type DiditWebhookPayload = {
  session_id: string;
  status: "Approved" | "Declined" | "In Review" | "Abandoned" | "Expired";
  vendor_data: string;
};