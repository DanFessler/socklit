import { PROTOCOL_VERSION, asHealth } from "../shared/protocol";

export type PeerCheck =
  | { ok: true; name: string }
  | { ok: false; reason: string; retry: boolean };

/** Vite `define` from `firstPaint()`, or `data-app` on `#app` from a listen GET. */
export function expectedAppName(fromDocument?: string | null): string | undefined {
  const defined = readDefinedName();
  if (defined) return defined;
  if (fromDocument && fromDocument.length > 0) return fromDocument;
  return undefined;
}

export function healthUrlFromSocket(socketHref: string): string {
  const ws = new URL(socketHref);
  const http = ws.protocol === "wss:" ? "https:" : "http:";
  return `${http}//${ws.host}/health`;
}

export async function checkPeer(
  healthHref: string,
  expected: string | undefined,
): Promise<PeerCheck> {
  try {
    const response = await fetch(healthHref, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) {
      return { ok: false, reason: "listen() is not up", retry: true };
    }
    const health = asHealth(await response.json());
    if (!health) {
      return { ok: false, reason: "not a Socklit listen()", retry: true };
    }
    if (health.protocol !== PROTOCOL_VERSION) {
      return {
        ok: false,
        reason: `unsupported protocol ${health.protocol}`,
        retry: false,
      };
    }
    if (expected && health.name !== expected) {
      return {
        ok: false,
        reason: `this page is ${expected}; the process on this port is ${health.name}`,
        retry: false,
      };
    }
    return { ok: true, name: health.name };
  } catch {
    return { ok: false, reason: "listen() is not up", retry: true };
  }
}

function readDefinedName(): string | undefined {
  try {
    const value = import.meta.env["SOCKLIT_NAME"];
    if (typeof value === "string" && value.length > 0) return value;
  } catch {
    // Not a Vite bundle.
  }
  return undefined;
}
