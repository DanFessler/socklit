/**
 * Load harness for the odds probe.
 *
 * Opens N concurrent sessions against `?probe=odds`, holds them while the
 * shared simulator ticks, and reports what the server actually spent from
 * /metrics. The point is research/economics.md finding 3: without render
 * sharing, cost should be linear in fan-out. This measures whether it is, and
 * how much of that cost is provably redundant.
 *
 *   npx tsx scripts/odds-load.ts 100
 *   npx tsx scripts/odds-load.ts 1,10,50,100,250,500 --seconds 10
 *   npx tsx scripts/odds-load.ts 250 --mine
 *   npx tsx scripts/odds-load.ts 50 --url http://localhost:8787 --no-spawn
 *
 * By default it spawns its own server on a spare port so that measurements are
 * not polluted by the dev server's browser tabs, and kills it again on the way
 * out.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { WebSocket } from "ws";

type Options = {
  sessions: number[];
  seconds: number;
  warmup: number;
  tickMs: number;
  markets: number;
  moveChance: number | null;
  quoteKeys: boolean;
  mine: boolean;
  url: string | null;
  port: number;
  batch: number;
  identityTicks: number;
  json: string | null;
};

type MetricsSnapshot = {
  sessions: number;
  renders: number;
  quietRenders: number;
  nodes: number;
  renderMicroseconds: number;
  microsecondsPerNode: number | null;
  averageNodesPerRender: number | null;
  retainedBytesPerSession: number | null;
  sentBytes: { templates: number; snapshots: number; updates: number };
  eventsHandled: number;
  eventsRejected: number;
};

type TickRecord = {
  emittedAt: number;
  first: number;
  last: number;
  arrivals: number;
  /** Patch payloads seen for this tick, hashed, with a count each. */
  payloads: Map<string, number> | null;
};

type RunResult = {
  sessions: number;
  connected: number;
  elapsedSeconds: number;
  renders: number;
  rendersPerSecond: number;
  microsecondsPerSecond: number;
  cores: number;
  microsecondsPerNode: number;
  nodesPerRender: number;
  quietFraction: number;
  updateBytesPerSecond: number;
  retainedBytesPerSession: number | null;
  /** Server process working set with no sessions attached, in bytes. */
  baselineRss: number | null;
  /** Server process working set at the end of the window, in bytes. */
  loadedRss: number | null;
  /** (loaded - baseline) / sessions: measured cost of holding one session. */
  rssPerSession: number | null;
  framesReceived: number;
  bytesReceived: number;
  /** Complete fan-outs: ticks every live session received. */
  completeTicks: number;
  deliveryP50: number | null;
  deliveryP95: number | null;
  deliveryMax: number | null;
  spreadMean: number | null;
  spreadMax: number | null;
  identicalFraction: number | null;
  identityTicksSampled: number;
  otherProbeRenders: number;
};

const STAMP = /"t(\d+)@(\d+\.\d+)"/;
const REVISION = /"revision":\d+,/;
const REPOSITORY = fileURLToPath(new URL("..", import.meta.url));

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const results: RunResult[] = [];

  for (const count of options.sessions) {
    results.push(await runOnce(count, options));
  }

  process.stdout.write(`\n${table(results, options)}\n`);

  if (options.json) {
    await writeFile(
      options.json,
      `${JSON.stringify({ options, results }, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(`wrote ${options.json}\n`);
  }
}

async function runOnce(count: number, options: Options): Promise<RunResult> {
  const server = options.url === null ? await startServer(options) : null;
  const base = options.url ?? `http://127.0.0.1:${options.port}`;
  const sockets: WebSocket[] = [];

  try {
    await waitForHealth(base);

    const baselineRss = await workingSet(server?.pid);
    const ticks = new Map<number, TickRecord>();
    let framesReceived = 0;
    let bytesReceived = 0;
    let recording = false;
    let identitySampled = 0;

    const observe = (raw: string): void => {
      framesReceived += 1;
      bytesReceived += raw.length;
      if (!recording) return;

      const match = STAMP.exec(raw);
      if (!match) return;

      const seq = Number(match[1]);
      const emittedAt = Number(match[2]);
      const arrivedAt = epochMicros();

      let record = ticks.get(seq);
      if (!record) {
        const sampleIdentity = identitySampled < options.identityTicks;
        if (sampleIdentity) identitySampled += 1;
        record = {
          emittedAt,
          first: arrivedAt,
          last: arrivedAt,
          arrivals: 0,
          payloads: sampleIdentity ? new Map() : null,
        };
        ticks.set(seq, record);
      }

      record.arrivals += 1;
      record.last = Math.max(record.last, arrivedAt);
      record.first = Math.min(record.first, arrivedAt);

      if (record.payloads) {
        // The revision is per-session by construction, so it is stripped: what
        // is being tested is whether the patch content is byte-identical.
        const key = raw.replace(REVISION, "");
        record.payloads.set(key, (record.payloads.get(key) ?? 0) + 1);
      }
    };

    const query = options.mine ? "?probe=odds&mine=1" : "?probe=odds";
    const wsBase = base.replace(/^http/, "ws");

    for (let index = 0; index < count; index += options.batch) {
      const size = Math.min(options.batch, count - index);
      const opening: Promise<WebSocket>[] = [];
      for (let inner = 0; inner < size; inner += 1) {
        opening.push(connect(`${wsBase}/${query}`, observe));
      }
      sockets.push(...(await Promise.all(opening)));
      process.stderr.write(`\r  connected ${sockets.length}/${count}`);
    }
    process.stderr.write("\n");

    await sleep(options.warmup * 1000);

    const before = await fetchMetrics(base);
    const startedAt = epochMicros();
    recording = true;

    await sleep(options.seconds * 1000);

    recording = false;
    const elapsedSeconds = (epochMicros() - startedAt) / 1000;
    const after = await fetchMetrics(base);
    const loadedRss = await workingSet(server?.pid);

    return summarize({
      count,
      connected: sockets.length,
      elapsedSeconds,
      before,
      after,
      ticks,
      framesReceived,
      bytesReceived,
      identitySampled,
      baselineRss,
      loadedRss,
    });
  } finally {
    for (const socket of sockets) {
      socket.removeAllListeners();
      socket.close();
    }
    await sleep(150);
    for (const socket of sockets) {
      if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
    }
    if (server) await stopServer(server);
  }
}

function summarize(input: {
  count: number;
  connected: number;
  elapsedSeconds: number;
  before: Record<string, MetricsSnapshot>;
  after: Record<string, MetricsSnapshot>;
  ticks: Map<number, TickRecord>;
  framesReceived: number;
  bytesReceived: number;
  identitySampled: number;
  baselineRss: number | null;
  loadedRss: number | null;
}): RunResult {
  const odds = delta(input.before["odds"], input.after["odds"]);
  const others = Object.keys(input.after)
    .filter((id) => id !== "odds")
    .reduce(
      (total, id) => total + delta(input.before[id], input.after[id]).renders,
      0,
    );

  // Only ticks the whole population received describe a full fan-out. The
  // first and last tick in the window are usually clipped by it.
  const complete = [...input.ticks.values()].filter(
    (record) => record.arrivals >= input.connected,
  );

  const deliveries: number[] = [];
  const spreads: number[] = [];
  for (const record of complete) {
    deliveries.push(record.last - record.emittedAt);
    spreads.push(record.last - record.first);
  }

  let identicalTotal = 0;
  let identicalMatched = 0;
  for (const record of input.ticks.values()) {
    if (!record.payloads || record.arrivals < input.connected) continue;
    let largest = 0;
    let total = 0;
    for (const seen of record.payloads.values()) {
      total += seen;
      largest = Math.max(largest, seen);
    }
    identicalTotal += total;
    identicalMatched += largest;
  }

  return {
    sessions: input.count,
    connected: input.connected,
    elapsedSeconds: round(input.elapsedSeconds, 2),
    renders: odds.renders,
    rendersPerSecond: round(odds.renders / input.elapsedSeconds, 1),
    microsecondsPerSecond: Math.round(
      odds.renderMicroseconds / input.elapsedSeconds,
    ),
    cores: round(odds.renderMicroseconds / input.elapsedSeconds / 1e6, 4),
    microsecondsPerNode:
      odds.nodes === 0 ? 0 : round(odds.renderMicroseconds / odds.nodes, 3),
    nodesPerRender: odds.renders === 0 ? 0 : round(odds.nodes / odds.renders, 1),
    quietFraction:
      odds.renders === 0 ? 0 : round(odds.quietRenders / odds.renders, 3),
    updateBytesPerSecond: Math.round(
      odds.updateBytes / input.elapsedSeconds,
    ),
    retainedBytesPerSession:
      input.after["odds"]?.retainedBytesPerSession ?? null,
    baselineRss: input.baselineRss,
    loadedRss: input.loadedRss,
    rssPerSession:
      input.baselineRss === null ||
      input.loadedRss === null ||
      input.connected === 0
        ? null
        : Math.round((input.loadedRss - input.baselineRss) / input.connected),
    framesReceived: input.framesReceived,
    bytesReceived: input.bytesReceived,
    completeTicks: complete.length,
    deliveryP50: percentile(deliveries, 0.5),
    deliveryP95: percentile(deliveries, 0.95),
    deliveryMax: percentile(deliveries, 1),
    spreadMean: spreads.length === 0 ? null : round(mean(spreads), 2),
    spreadMax: percentile(spreads, 1),
    identicalFraction:
      identicalTotal === 0 ? null : round(identicalMatched / identicalTotal, 4),
    identityTicksSampled: input.identitySampled,
    otherProbeRenders: others,
  };
}

function delta(
  before: MetricsSnapshot | undefined,
  after: MetricsSnapshot | undefined,
): {
  renders: number;
  quietRenders: number;
  nodes: number;
  renderMicroseconds: number;
  updateBytes: number;
} {
  const zero = {
    renders: 0,
    quietRenders: 0,
    nodes: 0,
    renderMicroseconds: 0,
    updateBytes: 0,
  };
  if (!before || !after) return zero;

  return {
    renders: after.renders - before.renders,
    quietRenders: after.quietRenders - before.quietRenders,
    nodes: after.nodes - before.nodes,
    renderMicroseconds: after.renderMicroseconds - before.renderMicroseconds,
    updateBytes: after.sentBytes.updates - before.sentBytes.updates,
  };
}

function connect(
  url: string,
  observe: (raw: string) => void,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { perMessageDeflate: false });
    let ready = false;

    socket.on("message", (data: Buffer) => {
      const raw = data.toString("utf8");
      observe(raw);
      if (!ready && raw.includes('"type":"snapshot"')) {
        ready = true;
        resolve(socket);
      }
    });

    socket.on("error", (error) => {
      if (!ready) reject(error);
    });
    socket.on("close", () => {
      if (!ready) reject(new Error(`socket closed before snapshot: ${url}`));
    });
  });
}

async function startServer(options: Options): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "server/index.ts"],
    {
      cwd: REPOSITORY,
      env: {
        ...process.env,
        PORT: String(options.port),
        ODDS_TICK_MS: String(options.tickMs),
        ODDS_MARKETS: String(options.markets),
        ODDS_QUOTE_BINDING: options.quoteKeys ? "key" : "value",
        ...(options.moveChance === null
          ? {}
          : { ODDS_MOVE_CHANCE: String(options.moveChance) }),
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8").trim();
    if (text.length > 0) process.stderr.write(`[server] ${text}\n`);
  });

  return child;
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return;

  const finished = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(resolve, 4000).unref();
  });

  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    child.kill("SIGTERM");
  }

  await finished;
}

/**
 * Working set of another process, in bytes, or null if it cannot be read.
 *
 * Node cannot report another process's memory, and the server is the process
 * holding the sessions, so this shells out. Failure is not fatal: memory is one
 * line of the report, not the point of it.
 */
function workingSet(pid: number | undefined): Promise<number | null> {
  if (pid === undefined) return Promise.resolve(null);

  const command =
    process.platform === "win32"
      ? { file: "tasklist", args: ["/fi", `PID eq ${pid}`, "/nh", "/fo", "csv"] }
      : { file: "ps", args: ["-o", "rss=", "-p", String(pid)] };

  return new Promise((resolve) => {
    const child = spawn(command.file, command.args, {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      // tasklist reports `"name","pid",...,"12,345 K"`; ps reports kilobytes.
      const kilobytes =
        process.platform === "win32"
          ? /"([\d.,\s]+)\s?K"\s*$/.exec(output.trim())?.[1]
          : output.trim();
      if (kilobytes === undefined) return resolve(null);

      const parsed = Number(kilobytes.replace(/[^\d]/g, ""));
      resolve(Number.isFinite(parsed) && parsed > 0 ? parsed * 1024 : null);
    });
  });
}

async function waitForHealth(base: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) {
        const body = (await response.json()) as { probes?: string[] };
        if (body.probes?.includes("odds")) return;
        throw new Error(
          `server does not host the odds probe (found ${body.probes?.join(", ")})`,
        );
      }
    } catch (error) {
      if (attempt === 199) throw error;
    }
    await sleep(100);
  }
  throw new Error(`server at ${base} never became healthy`);
}

async function fetchMetrics(
  base: string,
): Promise<Record<string, MetricsSnapshot>> {
  const response = await fetch(`${base}/metrics`);
  if (!response.ok) throw new Error(`GET /metrics failed: ${response.status}`);
  return (await response.json()) as Record<string, MetricsSnapshot>;
}

function table(results: RunResult[], options: Options): string {
  const header = [
    "| N | renders/s | µs/s | cores | µs/node | nodes/render | update B/s | identical | fan-out ms p50 | p95 | max | spread ms | KB/session |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  const rows = results.map((result) =>
    [
      result.connected,
      result.rendersPerSecond,
      result.microsecondsPerSecond,
      result.cores,
      result.microsecondsPerNode,
      result.nodesPerRender,
      result.updateBytesPerSecond,
      result.identicalFraction === null
        ? "—"
        : `${round(result.identicalFraction * 100, 2)}%`,
      show(result.deliveryP50),
      show(result.deliveryP95),
      show(result.deliveryMax),
      show(result.spreadMax),
      result.rssPerSession === null
        ? "—"
        : round(result.rssPerSession / 1024, 1),
    ].join(" | "),
  );

  const settings = [
    `tick ${options.tickMs}ms`,
    `${options.markets} markets`,
    `${options.seconds}s window`,
    `mine=${options.mine ? 1 : 0}`,
    `quotes=${options.quoteKeys ? "key" : "value"}`,
    options.moveChance === null ? null : `move=${options.moveChance}`,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  const noise = results.reduce(
    (total, result) => total + result.otherProbeRenders,
    0,
  );
  const footer =
    noise === 0
      ? []
      : [`note: other probes rendered ${noise} times during these runs`];

  return [settings, ...header, ...rows.map((row) => `| ${row} |`), ...footer].join(
    "\n",
  );
}

function show(value: number | null): string {
  return value === null ? "—" : String(value);
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    sessions: [25],
    seconds: 10,
    warmup: 3,
    tickMs: 250,
    markets: 40,
    moveChance: null,
    quoteKeys: false,
    mine: false,
    url: null,
    port: 8799,
    batch: 50,
    identityTicks: 4,
    json: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;

    const next = (): string => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${argument} needs a value`);
      index += 1;
      return value;
    };

    switch (argument) {
      case "--sessions":
        options.sessions = parseCounts(next());
        break;
      case "--seconds":
        options.seconds = Number(next());
        break;
      case "--warmup":
        options.warmup = Number(next());
        break;
      case "--tick":
        options.tickMs = Number(next());
        break;
      case "--markets":
        options.markets = Number(next());
        break;
      case "--move":
        options.moveChance = Number(next());
        break;
      case "--quote-keys":
        options.quoteKeys = true;
        break;
      case "--mine":
        options.mine = true;
        break;
      case "--url":
        options.url = next().replace(/\/$/, "");
        break;
      case "--no-spawn":
        options.url = options.url ?? "http://127.0.0.1:8787";
        break;
      case "--port":
        options.port = Number(next());
        break;
      case "--batch":
        options.batch = Number(next());
        break;
      case "--identity-ticks":
        options.identityTicks = Number(next());
        break;
      case "--json":
        options.json = next();
        break;
      default:
        if (argument.startsWith("--")) {
          throw new Error(`unknown option ${argument}`);
        }
        options.sessions = parseCounts(argument);
    }
  }

  return options;
}

function parseCounts(raw: string): number[] {
  const counts = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isSafeInteger(value) && value > 0);

  if (counts.length === 0) throw new Error(`not a session count: ${raw}`);
  return counts;
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return round(sorted[index] ?? 0, 2);
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function epochMicros(): number {
  return performance.timeOrigin + performance.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
