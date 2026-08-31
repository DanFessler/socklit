import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer } from "ws";

import { DEFAULT_PROTOCOL_PORT, MAX_MESSAGE_BYTES } from "../shared/protocol";
import type { RenderOutput } from "./component";
import { parseCookies } from "./cookies";
import type { ChangeListener, ProbeInstance, SessionContext } from "./probes/types";
import { PROTOCOL_VERSION } from "./protocol-version";
import { servePublicFile } from "./public-dir";
import { tokenIdentifyRequest } from "./reidentify";
import { DurableVault } from "./durable";
import { Runtime } from "./runtime";
import { readSessionBody, writeSessionCookie } from "./session-cookie";

export type IdentifyRequest = {
  /** WebSocket URL query. Used when the page cannot share a cookie (`?ws=`). */
  params: URLSearchParams;
  headers: IncomingHttpHeaders;
  /** Parsed `Cookie` header. Set by `POST /session` after `grant`. */
  cookies: Record<string, string>;
};

export type CreateApp<User = unknown> = (
  session: SessionContext<User>,
) => ProbeInstance | (() => RenderOutput);

export type ListenOptions<User = unknown> = {
  /**
   * The same render function for every session. Use this when nothing
   * diverges per connection. For a per-user route or identity, pass
   * `createApp` instead.
   */
  app?: () => RenderOutput;
  createApp?: CreateApp<User>;
  /**
   * Who this connection is. Return a user the *server* computed, or `null`
   * if the tab is signed out. Throw to refuse the socket.
   *
   * Read `sessionToken(request)` — cookie first, then `socklit_session` on
   * the query string when the replica had to use `?ws=`.
   */
  identify?: (request: IdentifyRequest) => User | null | Promise<User | null>;
  /**
   * Called when shared authoritative state changes. Return an unsubscribe.
   * Pass the source as `listener(source)` so `useStore(source)` can skip
   * sessions that did not read it.
   */
  subscribe?: (listener: ChangeListener) => () => void;
  /**
   * Directory of built files (`dist/`) to serve next to the socket.
   * Week one uses Vite and can omit this. After `vite build`, one process
   * is the page and the protocol.
   */
  publicDir?: string;
  /**
   * Allowed `Origin` values (and, if `Origin` is missing, `Host` as
   * `http(s)://host`). When set, other origins get 403 on the WebSocket
   * upgrade and on `POST /session`. Omit locally.
   */
  origin?: string | string[];
  port?: number;
  onLog?: (message: string) => void;
  /**
   * File for `useDurable` cells. Survives a process restart. Omit and
   * the vault is memory-only: reconnect works, a deploy does not.
   */
  durableFile?: string;
};

export type ListenHandle = {
  port: number;
  close: () => Promise<void>;
};

/**
 * Starts the session protocol for one application.
 *
 * This is the product host. The research process (`server/index.ts`) still
 * discovers probes; a first-party app does not.
 */
export async function listen<User = unknown>(
  options: ListenOptions<User>,
): Promise<ListenHandle> {
  if (options.app && options.createApp) {
    throw new Error("listen() takes app or createApp, not both");
  }
  if (!options.app && !options.createApp) {
    throw new Error("listen() requires app or createApp");
  }

  const createApp = normalizeCreateApp(options);
  const port = options.port ?? Number(process.env["PORT"] ?? DEFAULT_PROTOCOL_PORT);
  const log = options.onLog ?? ((message: string) => console.log(`[socklit] ${message}`));
  const publicDir = options.publicDir;
  const identify = options.identify;
  const durable = options.durableFile
    ? await DurableVault.file(options.durableFile)
    : DurableVault.memory();

  const runtime = new Runtime({
    createApp,
    ...(options.subscribe ? { subscribe: options.subscribe } : {}),
    onLog: log,
    durable,
    reidentify: async (token, params) => {
      if (!identify) return null;
      return identify(tokenIdentifyRequest(token, params, {}));
    },
  });

  const server = createServer((request, response) => {
    void handleHttp(request, response);
  });

  async function handleHttp(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (url.pathname === "/health") {
      json(response, 200, {
        ok: true,
        sessions: runtime.sessionCount,
        protocol: PROTOCOL_VERSION,
      });
      return;
    }

    if (url.pathname === "/session" && request.method === "POST") {
      if (!originAllowed(request, options.origin)) {
        json(response, 403, { error: "origin not allowed" });
        return;
      }
      try {
        const token = await readSessionBody(request);
        writeSessionCookie(response, request, token);
        response.writeHead(204);
        response.end();
      } catch {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid session body" }));
      }
      return;
    }

    if (publicDir && (await servePublicFile(publicDir, request, response))) {
      return;
    }

    json(response, 404, { error: "this process serves the session protocol" });
  }

  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  server.on("upgrade", (request, socket, head) => {
    if (!originAllowed(request, options.origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      sockets.emit("connection", ws, request);
    });
  });
  sockets.on("connection", (socket, request) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const identifyRequest: IdentifyRequest = {
      params: url.searchParams,
      headers: request.headers,
      cookies: parseCookies(request.headers.cookie),
    };

    void settleIdentity(options.identify, identifyRequest).then(
      (user) => {
        runtime.attach(socket, identifyRequest.params, user);
      },
      (error: unknown) => {
        const reason = error instanceof Error ? error.message : "identify failed";
        log(`identify rejected a connection: ${reason}`);
        socket.close(1008, reason.slice(0, 120));
      },
    );
  });

  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      const address = server.address();
      const bound =
        typeof address === "object" && address !== null ? address.port : port;
      log(`session protocol on ws://localhost:${bound}`);
      resolve({
        port: bound,
        close: () =>
          new Promise((done) => {
            runtime.dispose();
            sockets.close();
            server.close(() => {
              void runtime.flushDurable().then(() => done());
            });
          }),
      });
    });
    server.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        log(
          `port ${port} is already in use. Change listen({ port }) and the Vite proxy target together.`,
        );
      }
      reject(error);
    });
  });
}

async function settleIdentity<User>(
  identify: ListenOptions<User>["identify"],
  request: IdentifyRequest,
): Promise<User | null> {
  if (!identify) return null;
  return identify(request);
}

function normalizeCreateApp<User>(
  options: ListenOptions<User>,
): (session: SessionContext) => ProbeInstance {
  if (options.app) {
    const app = options.app;
    return () => ({ app });
  }

  const create = options.createApp;
  if (!create) {
    throw new Error("listen() requires app or createApp");
  }

  return (session) => {
    const result = create(session as SessionContext<User>);
    if (typeof result === "function") return { app: result };
    return result;
  };
}

function originAllowed(
  request: IncomingMessage,
  allowed?: string | string[],
): boolean {
  if (!allowed) return true;
  const actual = requestOrigin(request);
  if (!actual) return false;
  const list = Array.isArray(allowed) ? allowed : [allowed];
  return list.includes(actual);
}

function requestOrigin(request: IncomingMessage): string | undefined {
  const header = request.headers.origin;
  if (typeof header === "string" && header.length > 0) return header;
  const host = request.headers.host;
  if (!host) return undefined;
  const forwarded = request.headers["x-forwarded-proto"];
  const encrypted = Boolean((request.socket as { encrypted?: boolean }).encrypted);
  const proto = forwarded === "https" || encrypted ? "https" : "http";
  return `${proto}://${host}`;
}

function json(
  response: ServerResponse<IncomingMessage>,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  response.end(JSON.stringify(body));
}
