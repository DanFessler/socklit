import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer } from "ws";

import { DEFAULT_PROTOCOL_PORT, MAX_MESSAGE_BYTES } from "../shared/protocol";
import type { RenderOutput } from "./component";
import { parseCookies } from "./cookies";
import type { ChangeListener, ProbeInstance, SessionContext } from "./probes/types";
import { servePublicFile } from "./public-dir";
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
   * Pass the store as `listener(store)` so `useStore(store)` can skip
   * sessions that did not read it.
   */
  subscribe?: (listener: ChangeListener) => () => void;
  /**
   * Directory of built files (`dist/`) to serve next to the socket.
   * Week one uses Vite and can omit this. After `vite build`, one process
   * is the page and the protocol.
   */
  publicDir?: string;
  port?: number;
  onLog?: (message: string) => void;
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
export function listen<User = unknown>(
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

  const runtime = new Runtime({
    createApp,
    ...(options.subscribe ? { subscribe: options.subscribe } : {}),
    onLog: log,
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
      json(response, 200, { ok: true, sessions: runtime.sessionCount });
      return;
    }

    if (url.pathname === "/session" && request.method === "POST") {
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

  const sockets = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES });
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
            server.close(() => done());
          }),
      });
    });
    server.on("error", reject);
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
