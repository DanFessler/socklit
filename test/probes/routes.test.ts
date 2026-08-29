import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ROUTES, type RouteId } from "../../server/probes/routes/app";
import {
  analyzeGroup,
  analyzePopulation,
  indexTree,
} from "../../server/probes/routes/measure";
import { create } from "../../server/probes/routes/probe";
import type { Probe } from "../../server/probes/types";
import { Runtime } from "../../server/runtime";
import type {
  ClientMessage,
  ServerMessage,
  WireInstance,
} from "../../shared/protocol";

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  readonly sent: ServerMessage[] = [];

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerMessage);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close");
  }

  receive(message: ClientMessage): void {
    this.emit("message", JSON.stringify(message), false);
  }

  asWebSocket(): WebSocket {
    return this as unknown as WebSocket;
  }

  take(): ServerMessage[] {
    return this.sent.splice(0, this.sent.length);
  }

  find<T extends ServerMessage["type"]>(
    type: T,
  ): Extract<ServerMessage, { type: T }> | undefined {
    return this.sent.find((message) => message.type === type) as
      | Extract<ServerMessage, { type: T }>
      | undefined;
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

function navAddress(
  root: WireInstance,
  route: RouteId,
): { instanceId: string; hole: number } {
  const link = findInstance(root, (candidate) =>
    candidate.id.endsWith(`/k:${route}`),
  );
  if (!link) throw new Error(`no nav link for ${route}`);

  const hole = link.values.findIndex(
    (value) =>
      typeof value === "object" && value !== null && value.kind === "event",
  );
  if (hole < 0) throw new Error(`nav link ${link.id} has no event hole`);

  return { instanceId: link.id, hole };
}

/** The visible route, read from the body's template rather than from the app. */
function bodyTemplateId(root: WireInstance): number {
  const body = findInstance(root, (candidate) => candidate.id === "root/h1");
  if (!body) throw new Error("expected a body instance at root/h1");
  return body.templateId;
}

describe("routes probe", () => {
  let directory: string;
  let probe: Probe;
  let runtime: Runtime;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "socklit-routes-"));
    probe = await create({
      dataFile: (name) => join(directory, name),
      log: () => {},
    });
    runtime = new Runtime({
      createApp: (session) => probe.createApp(session),
      ...(probe.subscribe ? { subscribe: probe.subscribe } : {}),
    });
  });

  afterEach(async () => {
    runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  async function connect(query = ""): Promise<FakeSocket> {
    const socket = new FakeSocket();
    runtime.attach(socket.asWebSocket(), new URLSearchParams(query));
    await runtime.whenIdle();
    return socket;
  }

  function snapshotRoot(socket: FakeSocket): WireInstance {
    const snapshot = socket.find("snapshot");
    if (snapshot?.type !== "snapshot") throw new Error("expected a snapshot");
    return snapshot.root;
  }

  it("declares the register entries it forces", () => {
    expect(probe.id).toBe("routes");
    expect(probe.forces).toBe("S1, S2");
  });

  it("seeds the route from the query string and rejects an unknown one", async () => {
    const tasks = await connect("route=tasks");
    const bogus = await connect("route=nowhere");
    const dashboard = await connect("route=dashboard");

    expect(bodyTemplateId(snapshotRoot(tasks))).not.toBe(
      bodyTemplateId(snapshotRoot(dashboard)),
    );
    expect(bodyTemplateId(snapshotRoot(bogus))).toBe(
      bodyTemplateId(snapshotRoot(dashboard)),
    );
  });

  it("lets two sessions hold different routes at once", async () => {
    const first = await connect("user=alice&route=dashboard");
    const second = await connect("user=bob&route=settings");

    const firstRoot = snapshotRoot(first);
    const secondRoot = snapshotRoot(second);
    const settingsBody = bodyTemplateId(secondRoot);

    expect(bodyTemplateId(firstRoot)).not.toBe(settingsBody);

    // The first session navigates; the second must be untouched.
    first.take();
    second.take();
    first.receive({
      type: "event",
      revision: 1,
      ...navAddress(firstRoot, "profile"),
      payload: { kind: "click" },
    });
    await runtime.whenIdle();

    expect(first.find("update")).toBeDefined();
    expect(second.sent).toEqual([]);

    // And the second session still shows settings, not profile.
    second.receive({
      type: "event",
      revision: 1,
      ...navAddress(secondRoot, "settings"),
      payload: { kind: "click" },
    });
    await runtime.whenIdle();
    expect(second.sent).toEqual([]);
  });

  it("re-renders only the session that navigated", async () => {
    const navigator = await connect("user=alice&route=dashboard");
    const bystander = await connect("user=bob&route=dashboard");

    const root = snapshotRoot(navigator);
    navigator.take();
    bystander.take();

    navigator.receive({
      type: "event",
      revision: 1,
      ...navAddress(root, "tasks"),
      payload: { kind: "click" },
    });
    await runtime.whenIdle();

    expect(navigator.find("update")).toBeDefined();
    expect(bystander.sent).toHaveLength(0);
  });

  it("swaps the body subtree rather than replacing the tree", async () => {
    const socket = await connect("route=dashboard");
    const root = snapshotRoot(socket);
    socket.take();

    socket.receive({
      type: "event",
      revision: 1,
      ...navAddress(root, "tasks"),
      payload: { kind: "click" },
    });
    await runtime.whenIdle();

    const update = socket.find("update");
    if (update?.type !== "update") throw new Error("expected an update");

    expect(update.operations.every((operation) => operation.op === "set")).toBe(
      true,
    );

    // One set for the body, one for each nav link whose active flag changed.
    expect(update.operations).toHaveLength(3);
    expect(
      update.operations.filter(
        (operation) => operation.op === "set" && operation.instanceId === "root",
      ),
    ).toHaveLength(1);
  });

  it("replaces the whole tree when the shell is chosen per route", async () => {
    const socket = await connect("route=dashboard&shell=split");
    const root = snapshotRoot(socket);
    socket.take();

    socket.receive({
      type: "event",
      revision: 1,
      ...navAddress(root, "tasks"),
      payload: { kind: "click" },
    });
    await runtime.whenIdle();

    const update = socket.find("update");
    if (update?.type !== "update") throw new Error("expected an update");

    expect(update.operations).toHaveLength(1);
    expect(update.operations[0]).toMatchObject({
      op: "replace",
      instanceId: "root",
    });
  });

  it("ships a route's templates on first visit and nothing on a revisit", async () => {
    const socket = await connect("route=dashboard");
    const root = snapshotRoot(socket);
    socket.take();

    const visit = async (route: RouteId): Promise<number> => {
      socket.receive({
        type: "event",
        revision: 1,
        ...navAddress(root, route),
        payload: { kind: "click" },
      });
      await runtime.whenIdle();

      const update = socket.find("update");
      if (update?.type !== "update") throw new Error("expected an update");
      const count = update.templates.length;
      socket.take();
      return count;
    };

    expect(await visit("tasks")).toBeGreaterThan(0);
    expect(await visit("dashboard")).toBe(0);
    expect(await visit("tasks")).toBe(0);
  });

  it("broadcasts a shared mutation to sessions on every route", async () => {
    const sessions = await Promise.all(
      ROUTES.map(async (route) => {
        const socket = await connect(`user=alice&route=${route}`);
        return { route, socket, root: snapshotRoot(socket) };
      }),
    );

    const on = (route: RouteId): (typeof sessions)[number] => {
      const found = sessions.find((session) => session.route === route);
      if (!found) throw new Error(`no session on ${route}`);
      return found;
    };

    const eventHole = (instance: WireInstance): number => {
      const hole = instance.values.findIndex(
        (value) =>
          typeof value === "object" && value !== null && value.kind === "event",
      );
      if (hole < 0) throw new Error(`instance ${instance.id} has no event hole`);
      return hole;
    };

    const settings = on("settings");
    const toggle = findInstance(settings.root, (candidate) =>
      candidate.id.includes("/k:amortize"),
    );
    if (!toggle) throw new Error("expected the amortize toggle");

    for (const session of sessions) session.socket.take();

    settings.socket.receive({
      type: "event",
      revision: 1,
      instanceId: toggle.id,
      hole: eventHole(toggle),
      payload: { kind: "change", checked: true },
    });
    await runtime.whenIdle();

    // The toggle only appears on one route, so only that session changes even
    // though every session re-rendered.
    expect(settings.socket.find("update")).toBeDefined();
    for (const session of sessions) {
      if (session.route === "settings") continue;
      expect(session.socket.sent).toHaveLength(0);
    }

    // A task status lives in the shell footer as well, so it reaches everyone.
    const detail = on("detail");
    const statusButton = findInstance(detail.root, (candidate) =>
      candidate.id.includes("/k:done"),
    );
    if (!statusButton) throw new Error("expected a status button on detail");

    for (const session of sessions) session.socket.take();

    detail.socket.receive({
      type: "event",
      revision: 1,
      instanceId: statusButton.id,
      hole: eventHole(statusButton),
      payload: { kind: "click" },
    });
    await runtime.whenIdle();

    for (const session of sessions) {
      const update = session.socket.find("update");
      if (update?.type !== "update") {
        throw new Error(
          `expected ${session.route} to receive the footer change`,
        );
      }
      expect(
        update.operations.some((operation) =>
          operation.instanceId.startsWith("root/h2"),
        ),
      ).toBe(true);
    }
  });

  it("collapses to one render only when nothing is personalized", async () => {
    const alice = await connect("user=alice&route=dashboard");
    const bob = await connect("user=bob&route=dashboard");

    const personalized = [alice, bob].map((socket) =>
      indexTree(snapshotRoot(socket)),
    );
    const personalizedGroup = analyzeGroup("personalized", personalized);

    expect(personalizedGroup.wholeTreeIdentical).toBe(false);
    expect(analyzePopulation(personalized).distinctTrees).toBe(2);

    // Exactly two nodes carry the difference: the header that holds the name,
    // and the root above it. Everything else is byte-identical.
    expect(
      personalizedGroup.addresses - personalizedGroup.identicalSubtreeNodes,
    ).toBe(2);
    expect(personalizedGroup.sharedByteFraction).toBeGreaterThan(0.8);

    const plainAlice = await connect("user=alice&route=dashboard&personalize=0");
    const plainBob = await connect("user=bob&route=dashboard&personalize=0");
    const plain = [plainAlice, plainBob].map((socket) =>
      indexTree(snapshotRoot(socket)),
    );

    expect(analyzeGroup("plain", plain).wholeTreeIdentical).toBe(true);
    expect(analyzePopulation(plain).distinctTrees).toBe(1);
  });

  it("puts event handlers inside the largest shareable subtree", async () => {
    const sockets = await Promise.all([
      connect("user=alice&route=tasks"),
      connect("user=bob&route=tasks"),
    ]);
    const group = analyzeGroup(
      "two users on tasks",
      sockets.map((socket) => indexTree(snapshotRoot(socket))),
    );

    const body = group.boundaries.find(
      (boundary) => boundary.id === "root/h1",
    );
    if (!body) throw new Error("expected the body to be shareable");

    // The subtree a shared render would cover is not handler-free, so sharing
    // the wire form does not remove the need for a per-session handler table.
    expect(body.events).toBeGreaterThan(10);
    expect(body.bytes / group.bytes).toBeGreaterThan(0.7);
  });

  it("shares almost nothing between sessions on different routes", async () => {
    const sockets = await Promise.all(
      ROUTES.map((route) => connect(`user=alice&route=${route}&personalize=0`)),
    );
    const group = analyzeGroup(
      "one session per route",
      sockets.map((socket) => indexTree(snapshotRoot(socket))),
    );

    // The footer is the only subtree every route has in common.
    expect(group.boundaries.map((boundary) => boundary.id)).toEqual(["root/h2"]);
    expect(group.sharedByteFraction).toBeLessThan(0.05);
  });
});
