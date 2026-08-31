/**
 * Dev first paint: Vite still serves modules and HMR; the HTML is a
 * listen() render. Production does the same via listen({ publicDir }).
 *
 * Bakes the app name into the replica so a leftover process on the
 * protocol port cannot become the page.
 *
 * Import as `socklit/vite`.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { IncomingMessage } from "node:http";
import type { Plugin } from "vite";

import { DEFAULT_PROTOCOL_PORT, asHealth } from "../shared/protocol";
import { resolveAppName } from "./app-name";
import { extractApp, injectApp, parsePaint } from "./markup";

/**
 * Vite proxy keys are prefixes. `/session` would steal `/session-token.ts`
 * and the replica module never loads — the protocol pane stays "connecting".
 */
export function bypassUnlessPath(path: string) {
  return (req: { url?: string }) => {
    const pathname = (req.url ?? "").split("?")[0] ?? "";
    if (pathname !== path) return req.url;
    return undefined;
  };
}

export type FirstPaintOptions = {
  /** `listen()` port. Default is `PORT` or 8787. */
  port?: number;
  /**
   * Must match `listen({ name })` / `package.json` `"name"`.
   * Default is the same `resolveAppName()` listen() uses.
   */
  name?: string;
};

export type PaintRequest = {
  url: URL;
  cookie?: string;
};

const current = new AsyncLocalStorage<PaintRequest>();

const PAINT_TIMEOUT_MS = 2000;

export function firstPaint(options: FirstPaintOptions = {}): Plugin {
  const port = options.port ?? Number(process.env["PORT"] ?? DEFAULT_PROTOCOL_PORT);
  const name = resolveAppName(options.name);

  return {
    name: "socklit-first-paint",
    config() {
      return {
        define: {
          "import.meta.env.SOCKLIT_NAME": JSON.stringify(name),
        },
      };
    },
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (!isDocumentRequest(req)) {
          next();
          return;
        }
        const host = headerString(req.headers.host) ?? "127.0.0.1";
        const path = requestPath(req);
        current.run(
          {
            url: new URL(path, `http://${host}`),
            cookie: headerString(req.headers.cookie),
          },
          next,
        );
      });
    },
    transformIndexHtml: {
      order: "pre",
      async handler(html) {
        return paintDevHtml(html, { port, name });
      },
    },
  };
}

/** Same inject listen() uses, against Vite's index.html. */
export async function paintDevHtml(
  html: string,
  options: { port: number; name?: string; request?: PaintRequest },
): Promise<string> {
  const request = options.request ?? current.getStore();
  if (!request) return html;
  const paint = parsePaint(request.url.searchParams.get("paint"));
  if (paint === "shell") return html;
  const expected = resolveAppName(options.name);
  const peer = await fetchListenHealth(options.port);
  if (!peer) return html;
  if (peer.name !== expected) return html;
  const painted = await fetchListenDocument(options.port, request);
  if (!painted) return html;
  const extracted = extractApp(painted);
  if (!extracted) return html;
  return injectApp(html, extracted.inner, extracted.revision, paint, expected);
}

export async function fetchListenHealth(port: number) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(PAINT_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return asHealth(await response.json());
  } catch {
    return null;
  }
}

export async function fetchListenDocument(
  port: number,
  request: PaintRequest,
): Promise<string | null> {
  const target = new URL(request.url.pathname + request.url.search, `http://127.0.0.1:${port}`);
  try {
    const response = await fetch(target, {
      headers: request.cookie ? { cookie: request.cookie } : {},
      signal: AbortSignal.timeout(PAINT_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

type ViteReq = IncomingMessage & { originalUrl?: string };

function requestPath(req: IncomingMessage): string {
  const viteReq = req as ViteReq;
  return viteReq.originalUrl ?? req.url ?? "/";
}

function isDocumentRequest(req: IncomingMessage): boolean {
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") return false;
  const path = (requestPath(req).split("?")[0] ?? "/") || "/";
  if (
    path.startsWith("/@") ||
    path.startsWith("/node_modules/") ||
    path === "/ws" ||
    path.startsWith("/ws/") ||
    path === "/session" ||
    path === "/health" ||
    path === "/probes" ||
    path === "/metrics"
  ) {
    return false;
  }
  const leaf = path.slice(path.lastIndexOf("/") + 1);
  if (leaf.includes(".") && !leaf.endsWith(".html")) return false;
  const accept = headerString(req.headers.accept) ?? "";
  if (accept && !accept.includes("text/html") && !accept.includes("*/*")) {
    return false;
  }
  return true;
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.join("; ");
  return value;
}
