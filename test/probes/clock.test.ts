import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import type { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { countNodes, RuntimeMetrics } from "../../server/metrics";
import {
  createClockStore,
  formatClock,
  type ClockStore,
} from "../../server/probes/clock/clock-store";
import { createClockProbe } from "../../server/probes/clock/probe";
import { Runtime } from "../../server/runtime";
import type {
  ClientMessage,
  ServerMessage,
  WireInstance,
} from "../../shared/protocol";

/** Stands in for a `ws` socket, capturing everything the session sends. */
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

type Harness = {
  runtime: Runtime;
  store: ClockStore;
  metrics: RuntimeMetrics;
  connect: (params?: string) => Promise<FakeSocket>;
  tick: (milliseconds?: number) => Promise<void>;
  dispose: () => void;
};

const START = Date.UTC(2024, 0, 1, 12, 0, 0);

function harness(store?: ClockStore): Harness {
  let clock = START;
  const active =
    store ?? createClockStore({ autoTick: false, now: () => clock });
  const probe = createClockProbe({ store: active });
  const metrics = new RuntimeMetrics();

  const runtime = new Runtime({
    createApp: probe.createApp,
    ...(probe.subscribe ? { subscribe: probe.subscribe } : {}),
    metrics,
  });

  return {
    runtime,
    store: active,
    metrics,
    async connect(params = ""): Promise<FakeSocket> {
      const socket = new FakeSocket();
      runtime.attach(socket.asWebSocket(), new URLSearchParams(params));
      await runtime.whenIdle();
      return socket;
    },
    async tick(milliseconds = 1000): Promise<void> {
      clock += milliseconds;
      active.tick();
      await runtime.whenIdle();
    },
    dispose(): void {
      runtime.dispose();
      active.dispose();
    },
  };
}

function findInstance(root: WireInstance, id: string): WireInstance | undefined {
  if (root.id === id) return root;

  for (const value of root.values) {
    if (typeof value !== "object" || value === null) continue;

    if (value.kind === "instance") {
      const found = findInstance(value.instance, id);
      if (found) return found;
    } else if (value.kind === "list") {
      for (const item of value.items) {
        const found = findInstance(item.instance, id);
        if (found) return found;
      }
    }
  }
  return undefined;
}

function eventHoles(instance: WireInstance): number[] {
  return instance.values.flatMap((value, hole) =>
    typeof value === "object" && value !== null && value.kind === "event"
      ? [hole]
      : [],
  );
}

function snapshotOf(socket: FakeSocket): WireInstance {
  const snapshot = socket.find("snapshot");
  if (snapshot?.type !== "snapshot") throw new Error("expected a snapshot");
  return snapshot.root;
}

function updateOf(socket: FakeSocket): Extract<
  ServerMessage,
  { type: "update" }
> {
  const update = socket.find("update");
  if (update?.type !== "update") throw new Error("expected an update");
  return update;
}

describe("clock probe", () => {
  let live: Harness | null = null;

  afterEach(() => {
    live?.dispose();
    live = null;
  });

  it("spends one operation on a tick, whatever else is on screen", async () => {
    live = harness();
    const socket = await live.connect("rows=200");
    const before = formatClock(START);
    const root = snapshotOf(socket);
    socket.take();

    await live.tick();
    const update = updateOf(socket);

    // Layout is never re-sent, and exactly one hole moved.
    expect(update.templates).toEqual([]);
    expect(update.operations).toHaveLength(1);

    const [operation] = update.operations;
    if (operation?.op !== "set") throw new Error("expected a set operation");
    expect(operation.value).toBe(formatClock(START + 1000));

    // The address it names is the clock face, which held the previous second.
    const target = findInstance(root, operation.instanceId);
    expect(target?.values[operation.hole]).toBe(before);
    expect(operation.instanceId).not.toBe("root");
  });

  it("emits the same patch for a tree forty times the size", async () => {
    live = harness();
    const small = await live.connect("rows=50");
    const large = await live.connect("rows=2000");

    const smallNodes = countNodes(snapshotOf(small));
    const largeNodes = countNodes(snapshotOf(large));
    expect(largeNodes).toBeGreaterThan(smallNodes * 30);

    small.take();
    large.take();
    await live.tick();

    const smallUpdate = updateOf(small);
    const largeUpdate = updateOf(large);

    // Tree size is invisible to the patch: same operation count, same bytes.
    expect(smallUpdate.operations).toHaveLength(1);
    expect(largeUpdate.operations).toHaveLength(1);
    expect(JSON.stringify(largeUpdate).length).toBe(
      JSON.stringify(smallUpdate).length,
    );
  });

  it("re-renders a session that does not read the clock and sends it nothing", async () => {
    live = harness();
    const socket = await live.connect("rows=500&clock=off");
    socket.take();

    const before = live.metrics.snapshot();
    await live.tick();
    const after = live.metrics.snapshot();

    expect(socket.sent).toEqual([]);

    // The render happened, cost node-proportional time, and produced no output.
    expect(after.renders).toBe(before.renders + 1);
    expect(after.quietRenders).toBe(before.quietRenders + 1);
    expect(after.nodes - before.nodes).toBeGreaterThan(2000);
    expect(after.sentBytes.updates).toBe(before.sentBytes.updates);
  });

  it("stops being quiet as soon as the session counts its own renders", async () => {
    live = harness();
    const socket = await live.connect("rows=50&clock=off&counter=on");
    socket.take();

    const before = live.metrics.snapshot();
    await live.tick();
    const after = live.metrics.snapshot();

    // Nothing on screen depends on the clock, yet observing the render costs a
    // frame: the counter is the only thing that moved.
    const update = updateOf(socket);
    expect(update.operations).toHaveLength(1);
    expect(after.quietRenders).toBe(before.quietRenders);
  });

  it("keeps a tick faster than the display resolution entirely quiet", async () => {
    live = harness();
    const socket = await live.connect("rows=50");
    socket.take();

    const before = live.metrics.snapshot();
    for (let step = 0; step < 4; step += 1) {
      await live.tick(250);
    }
    const after = live.metrics.snapshot();

    // Four renders at 4 Hz, one second crossed, one update.
    expect(after.renders).toBe(before.renders + 4);
    expect(after.quietRenders).toBe(before.quietRenders + 3);
    expect(socket.sent.filter((message) => message.type === "update")).toHaveLength(
      1,
    );
  });

  it("hides the clock for one session without disturbing another", async () => {
    live = harness();
    const first = await live.connect("rows=20");
    const second = await live.connect("rows=20");

    const controls = findInstance(snapshotOf(first), "root/h1");
    if (!controls) throw new Error("expected the controls instance");
    const holes = eventHoles(controls);
    const toggle = holes[2];
    if (toggle === undefined) throw new Error("expected a visibility handler");

    first.take();
    second.take();

    first.receive({
      type: "event",
      revision: 1,
      instanceId: controls.id,
      hole: toggle,
      payload: { kind: "change", checked: false },
    });
    await live.runtime.whenIdle();

    expect(updateOf(first).operations.length).toBeGreaterThan(0);
    expect(second.sent).toEqual([]);

    // The hidden session now receives nothing at all from a tick.
    first.take();
    await live.tick();
    expect(first.sent).toEqual([]);
    expect(updateOf(second).operations).toHaveLength(1);
  });

  it("pauses shared ticking from a handler and disarms the timer", async () => {
    live = harness(createClockStore({ intervalMs: 1000 }));
    const socket = await live.connect("rows=10");
    expect(live.store.isTicking()).toBe(true);

    const controls = findInstance(snapshotOf(socket), "root/h1");
    if (!controls) throw new Error("expected the controls instance");
    const pause = eventHoles(controls)[1];
    if (pause === undefined) throw new Error("expected a pause handler");
    socket.take();

    socket.receive({
      type: "event",
      revision: 1,
      instanceId: controls.id,
      hole: pause,
      payload: { kind: "click" },
    });
    await live.runtime.whenIdle();

    expect(live.store.state().running).toBe(false);
    expect(live.store.isTicking()).toBe(false);
    expect(updateOf(socket).operations.length).toBeGreaterThan(0);
  });

  it("arms the timer only while a session is attached", async () => {
    live = harness(createClockStore({ intervalMs: 1000 }));
    expect(live.store.isTicking()).toBe(false);

    const first = await live.connect("rows=10");
    const second = await live.connect("rows=10");
    expect(live.store.isTicking()).toBe(true);

    first.close();
    expect(live.store.isTicking()).toBe(true);

    second.close();
    expect(live.store.isTicking()).toBe(false);
  });

  it("renders the number of rows it was asked for", async () => {
    live = harness();
    const socket = await live.connect("rows=3");

    // The list is a hole of the root template rather than its own instance.
    const value = snapshotOf(socket).values[2];
    if (typeof value !== "object" || value === null || value.kind !== "list") {
      throw new Error("expected a keyed list");
    }
    expect(value.items).toHaveLength(3);
    expect(value.items.map((item) => item.key)).toEqual([
      "row-0",
      "row-1",
      "row-2",
    ]);
  });
});

describe("clock store", () => {
  it("ignores a request for the state it is already in", () => {
    const store = createClockStore({ autoTick: false });
    let published = 0;
    store.onChange(() => {
      published += 1;
    });

    store.setRunning(true);
    expect(published).toBe(0);

    store.setRunning(false);
    expect(published).toBe(1);
    store.dispose();
  });

  it("clamps the tick interval", () => {
    const store = createClockStore({ autoTick: false, intervalMs: 1 });
    expect(store.state().intervalMs).toBe(20);

    store.setIntervalMs(10_000_000);
    expect(store.state().intervalMs).toBe(60_000);
    store.dispose();
  });

  it("actually ticks on its own interval", async () => {
    const store = createClockStore({ intervalMs: 20 });
    const detach = store.attach();

    await delay(120);
    expect(store.state().ticks).toBeGreaterThanOrEqual(2);

    detach();
    expect(store.isTicking()).toBe(false);
    store.dispose();
  });
});
