import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

import { DEFAULT_PROTOCOL_PORT, MAX_MESSAGE_BYTES } from "../shared/protocol";
import { RuntimeMetrics } from "./metrics";
import { discoverProbes } from "./probes/discover";
import { DurableVault } from "./durable";
import { Runtime } from "./runtime";

const port = Number(process.env["PORT"] ?? DEFAULT_PROTOCOL_PORT);
const DEFAULT_PROBE = "todo";

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
      probes: [...hosted.keys()],
      sessions: totalSessions(),
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
