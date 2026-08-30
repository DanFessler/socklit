import type { IncomingMessage, ServerResponse } from "node:http";

import { SESSION_COOKIE } from "../shared/protocol";

const MAX_TOKEN_BYTES = 512;

/** Cookie first, then the `?ws=` query fallback. */
export function sessionToken(request: {
  cookies: Record<string, string>;
  params: URLSearchParams;
}): string | null {
  return request.cookies[SESSION_COOKIE] ?? request.params.get(SESSION_COOKIE) ?? null;
}

export function writeSessionCookie(
  response: ServerResponse,
  request: IncomingMessage,
  token: string | null,
): void {
  const secure =
    request.headers["x-forwarded-proto"] === "https" ||
    Boolean((request.socket as { encrypted?: boolean }).encrypted);

  const parts = [
    token
      ? `${SESSION_COOKIE}=${encodeURIComponent(token)}`
      : `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (!token) parts.push("Max-Age=0");
  if (secure) parts.push("Secure");
  response.setHeader("set-cookie", parts.join("; "));
}

export async function readSessionBody(
  request: IncomingMessage,
): Promise<string | null> {
  const raw = await readBody(request, 2048);
  if (raw.length === 0) return null;
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("expected { token }");
  }
  const token = (parsed as { token?: unknown }).token;
  if (token === null || token === undefined || token === "") return null;
  if (typeof token !== "string" || token.length > MAX_TOKEN_BYTES) {
    throw new Error("invalid token");
  }
  return token;
}

function readBody(request: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}
