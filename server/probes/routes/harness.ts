import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

import {
  MAX_MESSAGE_BYTES,
  type ClientMessage,
  type PatchOperation,
  type ServerMessage,
  type WireInstance,
} from "../../../shared/protocol";
import { RuntimeMetrics, type MetricsSnapshot } from "../../metrics";
import { Runtime } from "../../runtime";
import { ROUTES, type RouteId, type ShellMode } from "./app";
import {
  analyzeGroup,
  analyzePopulation,
  indexTree,
  type GroupReport,
  type PopulationReport,
  type TreeIndex,
} from "./measure";
import { create } from "./probe";

/**
 * The measurement rig for the routes probe.
 *
 * It starts a real `Runtime` behind a real WebSocket server on an ephemeral
 * port, connects real sessions with real query strings, and compares the
 * snapshots they receive. Nothing here is a simulation of the protocol; the only
 * thing it adds over the dev server is an isolated `RuntimeMetrics` per phase so
 * one phase's numbers are not polluted by another's.
 */

const DATA_ROOT = fileURLToPath(new URL("../../../data/routes/", import.meta.url));
const SETTLE_QUIET_MS = 40;

export type Harness = {
  url: string;
  metrics: RuntimeMetrics;
  sessionCount: () => number;
  close: () => Promise<void>;
};

export async function startHarness(dataDirectory = DATA_ROOT): Promise<Harness> {
  const metrics = new RuntimeMetrics();
  const probe = await create({
    dataFile: (name) => join(dataDirectory, name),
    log: () => {},
  });

  const runtime = new Runtime({
    createApp: (session) => probe.createApp(session),
    ...(probe.subscribe ? { subscribe: probe.subscribe } : {}),
    metrics,
  });

  const server: Server = createServer((_request, response) => {
    response.writeHead(404).end();
  });
  const sockets = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES });

  sockets.on("connection", (socket, request) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    runtime.attach(socket, url.searchParams);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;

  return {
    url: `ws://127.0.0.1:${address.port}`,
    metrics,
    sessionCount: () => runtime.sessionCount,
    close: async () => {
      runtime.dispose();
      sockets.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

export type SessionOptions = {
  user: string;
  route?: RouteId;
  task?: string;
  personalized?: boolean;
  shell?: ShellMode;
};

export type Frame = { message: ServerMessage; bytes: number };

/**
 * A browser replica, reduced to what a measurement needs.
 *
 * It keeps the same invariant the real client does — patches are applied
 * positionally against the retained tree — so a navigation measurement is
 * reading the same tree the browser would be showing.
 */
export class ProbeSession {
  private readonly socket: WebSocket;
  private readonly frames: Frame[] = [];
  private drained = 0;
  private failure: Error | null = null;

  readonly templateIds = new Set<number>();
  root: WireInstance | null = null;
  revision = 0;

  private constructor(socket: WebSocket) {
    this.socket = socket;
  }

  static async open(
    baseUrl: string,
    options: SessionOptions,
  ): Promise<ProbeSession> {
    const url = new URL(baseUrl);
    url.searchParams.set("probe", "routes");
    url.searchParams.set("user", options.user);
    if (options.route) url.searchParams.set("route", options.route);
    if (options.task) url.searchParams.set("task", options.task);
    if (options.personalized === false) url.searchParams.set("personalize", "0");
    if (options.shell) url.searchParams.set("shell", options.shell);

    const socket = new WebSocket(url.toString());
    const session = new ProbeSession(socket);

    socket.on("message", (data: unknown) => {
      try {
        session.receive(String(data));
      } catch (error) {
        session.failure =
          error instanceof Error ? error : new Error(String(error));
      }
    });

    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", (error: Error) => reject(error));
    });

    await session.settle(() => session.root !== null);
    return session;
  }

  /** Frames received since the last call. */
  drain(): Frame[] {
    const slice = this.frames.slice(this.drained);
    this.drained = this.frames.length;
    return slice;
  }

  /** Clicks a nav link the way the browser would, by address. */
  async navigate(route: RouteId): Promise<Frame[]> {
    const target = this.navAddress(route);
    this.send({
      type: "event",
      revision: this.revision,
      instanceId: target.instanceId,
      hole: target.hole,
      payload: { kind: "click" },
    });
    await this.settle();
    return this.drain();
  }

  navAddress(route: RouteId): { instanceId: string; hole: number } {
    const root = this.requireRoot();
    const link = findInstance(root, (candidate) =>
      candidate.id.endsWith(`/k:${route}`),
    );
    if (!link) throw new Error(`no nav link for route ${route}`);

    const hole = link.values.findIndex(
      (value) =>
        typeof value === "object" && value !== null && value.kind === "event",
    );
    if (hole < 0) throw new Error(`nav link ${link.id} has no event hole`);

    return { instanceId: link.id, hole };
  }

  requireRoot(): WireInstance {
    if (this.failure) throw this.failure;
    if (!this.root) throw new Error("session has no snapshot yet");
    return this.root;
  }

  tree(): TreeIndex {
    return indexTree(this.requireRoot());
  }

  close(): void {
    this.socket.close();
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Waits for the wire to go quiet, and for `until` if one is given. */
  async settle(until?: () => boolean, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    if (until) {
      while (!until()) {
        if (this.failure) throw this.failure;
        if (Date.now() > deadline) throw new Error("timed out waiting for frames");
        await delay(5);
      }
    }

    for (;;) {
      const before = this.frames.length;
      await delay(SETTLE_QUIET_MS);
      if (this.frames.length === before) break;
      if (Date.now() > deadline) break;
    }

    if (this.failure) throw this.failure;
  }

  private receive(raw: string): void {
    const message = JSON.parse(raw) as ServerMessage;
    this.frames.push({ message, bytes: raw.length });

    switch (message.type) {
      case "templates":
        for (const template of message.templates) {
          this.templateIds.add(template.id);
        }
        return;

      case "snapshot":
        this.revision = message.revision;
        this.root = message.root;
        return;

      case "update":
        for (const template of message.templates) {
          this.templateIds.add(template.id);
        }
        this.revision = message.revision;
        this.applyOperations(message.operations);
        return;

      case "error":
        throw new Error(`server error ${message.code}: ${message.message}`);
    }
  }

  private applyOperations(operations: PatchOperation[]): void {
    for (const operation of operations) {
      const target = findInstance(
        this.requireRoot(),
        (candidate) => candidate.id === operation.instanceId,
      );
      if (!target) {
        throw new Error(`patch addressed unknown instance ${operation.instanceId}`);
      }

      if (operation.op === "replace") {
        target.templateId = operation.instance.templateId;
        target.values = operation.instance.values;
        continue;
      }

      target.values[operation.hole] = operation.value;
    }
  }
}

function findInstance(
  instance: WireInstance,
  predicate: (candidate: WireInstance) => boolean,
): WireInstance | undefined {
  if (predicate(instance)) return instance;

  for (const value of instance.values) {
    if (typeof value !== "object" || value === null) continue;

    if (value.kind === "instance") {
      const found = findInstance(value.instance, predicate);
      if (found) return found;
    } else if (value.kind === "list") {
      for (const item of value.items) {
        const found = findInstance(item.instance, predicate);
        if (found) return found;
      }
    }
  }

  return undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

const WORKSPACE_USERS = ["alice", "bob", "carol", "dave"] as const;
const POPULATION = 12;

export type PopulationRow = {
  routes: number;
  sessionsPerRoute: number;
  personalized: boolean;
  population: PopulationReport;
  group: GroupReport;
};

/**
 * A fixed population spread across a varying number of routes.
 *
 * This is the amortization ratio from the decision rule, measured: how many
 * renders a population of 12 actually needs, against how many it appears to
 * need from the number of distinct views.
 */
export async function measurePopulation(harness: Harness): Promise<PopulationRow[]> {
  const rows: PopulationRow[] = [];

  for (const personalized of [true, false]) {
    for (const routeCount of [1, 2, 3, 4, 5]) {
      const routes = ROUTES.slice(0, routeCount);
      const sessions: ProbeSession[] = [];

      for (let index = 0; index < POPULATION; index += 1) {
        const route =
          routes[Math.min(routes.length - 1, Math.floor((index * routeCount) / POPULATION))] ??
          "dashboard";
        const user = WORKSPACE_USERS[index % WORKSPACE_USERS.length] ?? "alice";
        sessions.push(
          await ProbeSession.open(harness.url, { user, route, personalized }),
        );
      }

      const trees = sessions.map((session) => session.tree());
      rows.push({
        routes: routeCount,
        sessionsPerRoute: round(POPULATION / routeCount, 1),
        personalized,
        population: analyzePopulation(trees),
        group: analyzeGroup(
          `${POPULATION} sessions / ${routeCount} route(s) / personalize=${personalized ? "on" : "off"}`,
          trees,
        ),
      });

      for (const session of sessions) session.close();
    }
  }

  return rows;
}

export type RouteGroupRow = {
  route: RouteId;
  sessions: number;
  personalized: boolean;
  group: GroupReport;
  population: PopulationReport;
};

/** One route, several distinct users: the shareable fraction within a view. */
export async function measureRouteGroups(
  harness: Harness,
  sizes: readonly number[] = [4],
): Promise<RouteGroupRow[]> {
  const rows: RouteGroupRow[] = [];

  for (const route of ROUTES) {
    for (const size of sizes) {
      for (const personalized of [true, false]) {
        const sessions: ProbeSession[] = [];
        for (let index = 0; index < size; index += 1) {
          const user =
            WORKSPACE_USERS[index % WORKSPACE_USERS.length] ?? "alice";
          sessions.push(
            await ProbeSession.open(harness.url, { user, route, personalized }),
          );
        }

        const trees = sessions.map((session) => session.tree());
        rows.push({
          route,
          sessions: size,
          personalized,
          group: analyzeGroup(
            `${size} on ${route} / personalize=${personalized ? "on" : "off"}`,
            trees,
          ),
          population: analyzePopulation(trees),
        });

        for (const session of sessions) session.close();
      }
    }
  }

  return rows;
}

export type ScaleRow = {
  route: RouteId;
  sessions: number;
  personalized: boolean;
  group: GroupReport;
  population: PopulationReport;
};

/**
 * The same route with a growing number of distinct users.
 *
 * Users are synthetic here rather than workspace members, so the only thing
 * that varies between sessions is the name in the corner. It isolates the "one
 * personalized element" claim from every other source of divergence.
 */
export async function measureScale(
  harness: Harness,
  route: RouteId = "dashboard",
  sizes: readonly number[] = [2, 4, 8, 16],
): Promise<ScaleRow[]> {
  const rows: ScaleRow[] = [];

  for (const personalized of [true, false]) {
    for (const size of sizes) {
      const sessions: ProbeSession[] = [];
      for (let index = 0; index < size; index += 1) {
        sessions.push(
          await ProbeSession.open(harness.url, {
            user: `viewer${String(index + 1).padStart(2, "0")}`,
            route,
            personalized,
          }),
        );
      }

      const trees = sessions.map((session) => session.tree());
      rows.push({
        route,
        sessions: size,
        personalized,
        group: analyzeGroup(
          `${size} on ${route} / distinct names / personalize=${personalized ? "on" : "off"}`,
          trees,
        ),
        population: analyzePopulation(trees),
      });

      for (const session of sessions) session.close();
    }
  }

  return rows;
}

export type NavigationStep = {
  from: RouteId;
  to: RouteId;
  visit: "first" | "repeat";
  templates: number;
  operations: number;
  ops: string[];
  rootReplace: boolean;
  bytes: number;
};

export type NavigationReport = {
  shell: ShellMode;
  connectTemplates: number;
  connectTemplateBytes: number;
  connectSnapshotBytes: number;
  steps: NavigationStep[];
  firstVisitBytes: number;
  repeatVisitBytes: number;
  templatesAfterTour: number;
};

/** What a route change costs on the wire, in both shell shapes. */
export async function measureNavigation(
  harness: Harness,
  shell: ShellMode,
): Promise<NavigationReport> {
  const session = await ProbeSession.open(harness.url, {
    user: "alice",
    route: "dashboard",
    shell,
  });

  const connect = session.drain();
  const connectTemplates = connect
    .filter((frame) => frame.message.type === "templates")
    .reduce(
      (total, frame) =>
        total +
        (frame.message.type === "templates" ? frame.message.templates.length : 0),
      0,
    );
  const connectTemplateBytes = connect
    .filter((frame) => frame.message.type === "templates")
    .reduce((total, frame) => total + frame.bytes, 0);
  const connectSnapshotBytes = connect
    .filter((frame) => frame.message.type === "snapshot")
    .reduce((total, frame) => total + frame.bytes, 0);

  const tour: RouteId[] = [
    "tasks",
    "detail",
    "settings",
    "profile",
    "dashboard",
    "tasks",
    "profile",
  ];

  const visited = new Set<RouteId>(["dashboard"]);
  const steps: NavigationStep[] = [];
  let from: RouteId = "dashboard";

  for (const to of tour) {
    const visit = visited.has(to) ? "repeat" : "first";
    const frames = await session.navigate(to);

    let templates = 0;
    let operations = 0;
    const ops: string[] = [];
    let rootReplace = false;
    let bytes = 0;

    for (const frame of frames) {
      bytes += frame.bytes;
      if (frame.message.type === "templates") {
        templates += frame.message.templates.length;
      }
      if (frame.message.type === "update") {
        templates += frame.message.templates.length;
        operations += frame.message.operations.length;
        for (const operation of frame.message.operations) {
          ops.push(`${operation.op}:${operation.instanceId}`);
          if (operation.op === "replace" && operation.instanceId === "root") {
            rootReplace = true;
          }
        }
      }
    }

    steps.push({ from, to, visit, templates, operations, ops, rootReplace, bytes });
    visited.add(to);
    from = to;
  }

  session.close();

  return {
    shell,
    connectTemplates,
    connectTemplateBytes,
    connectSnapshotBytes,
    steps,
    firstVisitBytes: steps
      .filter((step) => step.visit === "first")
      .reduce((total, step) => total + step.bytes, 0),
    repeatVisitBytes: steps
      .filter((step) => step.visit === "repeat")
      .reduce((total, step) => total + step.bytes, 0),
    templatesAfterTour: session.templateIds.size,
  };
}

export type BoundaryReport = {
  label: string;
  group: GroupReport;
};

/** Where the shareable boundary falls, for a few interesting groupings. */
export async function measureBoundaries(
  harness: Harness,
): Promise<BoundaryReport[]> {
  const reports: BoundaryReport[] = [];

  const cases: Array<{
    label: string;
    sessions: SessionOptions[];
  }> = [
    {
      label: "4 sessions on dashboard, distinct users, personalized",
      sessions: WORKSPACE_USERS.map((user) => ({
        user,
        route: "dashboard" as RouteId,
        personalized: true,
      })),
    },
    {
      label: "4 sessions on dashboard, distinct users, not personalized",
      sessions: WORKSPACE_USERS.map((user) => ({
        user,
        route: "dashboard" as RouteId,
        personalized: false,
      })),
    },
    {
      label: "4 sessions on tasks, distinct users, personalized",
      sessions: WORKSPACE_USERS.map((user) => ({
        user,
        route: "tasks" as RouteId,
        personalized: true,
      })),
    },
    {
      label: "2 tabs, same user, different routes (dashboard, tasks)",
      sessions: [
        { user: "alice", route: "dashboard", personalized: true },
        { user: "alice", route: "tasks", personalized: true },
      ],
    },
    {
      label: "2 tabs, different users, different routes (dashboard, tasks)",
      sessions: [
        { user: "alice", route: "dashboard", personalized: true },
        { user: "bob", route: "tasks", personalized: true },
      ],
    },
    {
      label: "5 sessions, one per route, same user, not personalized",
      sessions: ROUTES.map((route) => ({
        user: "alice",
        route,
        personalized: false,
      })),
    },
    {
      label: "5 sessions, one per route, distinct users, personalized",
      sessions: ROUTES.map((route, index) => ({
        user: WORKSPACE_USERS[index % WORKSPACE_USERS.length] ?? "alice",
        route,
        personalized: true,
      })),
    },
  ];

  for (const testCase of cases) {
    const sessions: ProbeSession[] = [];
    for (const options of testCase.sessions) {
      sessions.push(await ProbeSession.open(harness.url, options));
    }

    reports.push({
      label: testCase.label,
      group: analyzeGroup(
        testCase.label,
        sessions.map((session) => session.tree()),
      ),
    });

    for (const session of sessions) session.close();
  }

  return reports;
}

export type Measurements = {
  generatedAt: string;
  population: PopulationRow[];
  routeGroups: RouteGroupRow[];
  scale: ScaleRow[];
  navigation: NavigationReport[];
  boundaries: BoundaryReport[];
  metrics: {
    sharing: MetricsSnapshot;
    navigation: MetricsSnapshot;
  };
};

/**
 * Runs every phase and returns the raw numbers.
 *
 * Each phase gets its own server so its metrics are not polluted by another's,
 * and both run against a scratch data directory rather than `data/routes/`, so a
 * toggle flipped in a browser cannot silently move the measurements.
 */
export async function runMeasurements(): Promise<Measurements> {
  const scratch = await mkdtemp(join(tmpdir(), "socklit-routes-"));

  try {
    return await measureAll(scratch);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function measureAll(dataDirectory: string): Promise<Measurements> {
  const sharing = await startHarness(dataDirectory);

  const population = await measurePopulation(sharing);
  const routeGroups = await measureRouteGroups(sharing);
  const scale = await measureScale(sharing);
  const boundaries = await measureBoundaries(sharing);

  const sharingMetrics = sharing.metrics.snapshot();
  await sharing.close();

  const navigationHarness = await startHarness(dataDirectory);
  const navigation = [
    await measureNavigation(navigationHarness, "fused"),
    await measureNavigation(navigationHarness, "split"),
  ];
  const navigationMetrics = navigationHarness.metrics.snapshot();
  await navigationHarness.close();

  return {
    generatedAt: new Date().toISOString(),
    population,
    routeGroups,
    scale,
    navigation,
    boundaries,
    metrics: { sharing: sharingMetrics, navigation: navigationMetrics },
  };
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
