import type { IncomingHttpHeaders } from "node:http";

import { SESSION_COOKIE } from "../shared/protocol";
import type { IdentifyRequest } from "./listen";

/**
 * Build the request `identify` expects after `grant` / `revoke` on a live socket.
 *
 * The original handshake cookies do not update. The token the replica just
 * persisted is the source of truth, so it is written into both the cookie map
 * and the query string (and stripped on sign-out so a leftover `?ws=` token
 * cannot keep the previous person).
 */
export function tokenIdentifyRequest(
  token: string | null,
  params: URLSearchParams,
  headers: IncomingHttpHeaders,
): IdentifyRequest {
  const next = new URLSearchParams(params);
  if (token) next.set(SESSION_COOKIE, token);
  else next.delete(SESSION_COOKIE);

  return {
    params: next,
    headers,
    cookies: token ? { [SESSION_COOKIE]: token } : {},
  };
}
