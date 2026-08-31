import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Sign a ticket the app can put in `grant` and read back in `identify`.
 *
 * The secret is yours — pass `process.env.SOCKLIT_SECRET` if you keep it
 * there. These functions do not read the environment.
 *
 * Format: `base64url(JSON).base64url(HMAC-SHA256 of the first part)`.
 */
export function signTicket(payload: Record<string, unknown>, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest();
  return `${body}.${mac.toString("base64url")}`;
}

/**
 * Verify a ticket. Returns the payload, or `null` on a bad secret, bad
 * shape, tamper, or an `exp` (unix seconds) that has passed.
 */
export function verifyTicket<T = Record<string, unknown>>(
  token: string,
  secret: string,
): T | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || token.indexOf(".", dot + 1) !== -1) return null;

  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!body || !sig) return null;

  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }

  const expected = createHmac("sha256", secret).update(body).digest();
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "exp")) {
    const exp = (payload as { exp: unknown }).exp;
    if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
    if (exp < Math.floor(Date.now() / 1000)) return null;
  }

  return payload as T;
}
