import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION } from "../shared/protocol";
import { resolveAppName } from "./app-name";
import { RuntimeMetrics } from "./metrics";
import { discoverProbes } from "./probes/discover";
import { DurableVault } from "./durable";
import {
  DEFAULT_SHELL,
  injectApp,
  parsePaint,
} from "./markup";
import { Runtime } from "./runtime";

/** Not 8787. That default is a product app; the lab must not share it. */
const LAB_PROTOCOL_PORT = 8795;
const port = Number(process.env["PORT"] ?? LAB_PROTOCOL_PORT);
const DEFAULT_PROBE = "todo";
const appName = resolveAppName();

const log = (message: string): void => console.log(`[server] ${message}`);

const probes = await discoverProbes(log);
if (probes.length === 0) {
  throw new Error("no probes discovered under server/probes");
}

/**
 * One runtime per probe.
 *
 * Runtimes share nothing: separate template registries, separate sessions,
 * separate metrics. That is what lets probes be developed independently, and it
 * also means cross-probe render sharing (design-probes.md S1/A6) would have to
 * be introduced deliberately rather than emerging by accident.
 */
const DATA_ROOT = fileURLToPath(new URL("../data/", import.meta.url));

const hosted = new Map(
  await Promise.all(
    probes.map(async (probe) => {
      const metrics = new RuntimeMetrics();
      const durable = await DurableVault.file(
        join(DATA_ROOT, probe.id, "durable.json"),
      );
      const runtime = new Runtime({
        createApp: (session) => probe.createApp(session),
        ...(probe.subscribe ? { subscribe: probe.subscribe } : {}),
        onLog: (message) => console.log(`[${probe.id}] ${message}`),
        metrics,
        durable,
      });
      return [probe.id, { probe, runtime, metrics }] as const;
    }),
  ),
);

for (const { probe } of hosted.values()) {
  log(`probe "${probe.id}" ready — ${probe.title}`);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (url.pathname === "/health") {
    respond(response, 200, {
      ok: true,
      name: appName,
      probes: [...hosted.keys()],
      sessions: totalSessions(),
      protocol: PROTOCOL_VERSION,
    });
    return;
  }

  // The client is served from a different origin by Vite in development.
  if (url.pathname === "/probes") {
    respond(
      response,
      200,
      [...hosted.values()].map(({ probe, runtime }) => ({
        id: probe.id,
        title: probe.title,
        forces: probe.forces,
        sessions: runtime.sessionCount,
      })),
    );
    return;
  }

  if (url.pathname === "/metrics") {
    respond(
      response,
      200,
      Object.fromEntries(
        [...hosted.entries()].map(([id, { metrics }]) => [
          id,
          metrics.snapshot(),
        ]),
      ),
    );
    return;
  }

  const method = request.method ?? "GET";
  const ext = posix.extname(url.pathname);
  if (
    (method === "GET" || method === "HEAD") &&
    (ext === "" || ext === ".html")
  ) {
    const requested = url.searchParams.get("probe") ?? DEFAULT_PROBE;
    const target = hosted.get(requested);
    const paint = parsePaint(url.searchParams.get("paint"));
    if (!target) {
      respond(response, 404, { error: `unknown probe: ${requested}` });
      return;
    }
    if (paint === "shell") {
      sendHtml(response, method, DEFAULT_SHELL);
      return;
    }
    const params = new URLSearchParams(url.searchParams);
    if (!params.has("path")) params.set("path", url.pathname);
    const user = params.get("user");
    try {
      const painted = target.runtime.firstPaint(params, user);
      // Revision race: HTML is revision N; the store moves before connect.
      if (url.searchParams.get("race") === "1") {
        const bump = (target.probe as { bumpReaders?: () => void }).bumpReaders;
        bump?.();
      }
      sendHtml(
        response,
        method,
        injectApp(DEFAULT_SHELL, painted.markup, painted.revision, paint, appName),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "first paint failed";
      log(`first paint rejected ${url.pathname}: ${reason}`);
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(reason);
    }
    return;
  }

  respond(response, 404, { error: "this process serves the session protocol" });
});

const sockets = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES });

sockets.on("connection", (socket, request) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const requested = url.searchParams.get("probe") ?? DEFAULT_PROBE;
  const target = hosted.get(requested);

  if (!target) {
    log(`rejected connection for unknown probe "${requested}"`);
    socket.close(1008, `unknown probe: ${requested}`);
    return;
  }

  target.runtime.attach(socket, url.searchParams);
});

server.listen(port, () => {
  log(`session protocol on ws://localhost:${port}`);
  log(`select a probe with ?probe=<id>, default "${DEFAULT_PROBE}"`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\n[server] ${signal} received, shutting down`);
    const runtimes = [...hosted.values()].map(({ runtime }) => runtime);
    for (const runtime of runtimes) runtime.dispose();
    void Promise.all(runtimes.map((runtime) => runtime.flushDurable())).then(() => {
      sockets.close();
      server.close(() => process.exit(0));
    });
  });
}

function totalSessions(): number {
  let total = 0;
  for (const { runtime } of hosted.values()) {
    total += runtime.sessionCount;
  }
  return total;
}

function sendHtml(
  response: ServerResponse<IncomingMessage>,
  method: string,
  body: string,
): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  if (method === "HEAD") {
    response.end();
    return;
  }
  response.end(body);
}

function respond(
  response: ServerResponse<IncomingMessage>,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  response.end(JSON.stringify(body, null, 2));
}
