import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { html } from "lit-html";

import { createTodoApp } from "../server/app/todo-app";
import { component, useStore } from "../server/component";
import { RuntimeMetrics } from "../server/metrics";
import { Runtime } from "../server/runtime";
import { createDatabase, createTodoStore, type TodoStore } from "../server/store";
import type {
  ClientMessage,
  EventPayload,
  PatchOperation,
  ServerMessage,
  WireInstance,
} from "../shared/protocol";

/** Stands in for a `ws` socket, capturing everything the session sends. */
class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  readonly sent: ServerMessage[] = [];
  closedWith: { code: number; reason: string } | null = null;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerMessage);
  }

  close(code: number, reason: string): void {
    this.closedWith = { code, reason };
    this.readyState = 3;
    this.emit("close");
  }

  receive(message: ClientMessage | string): void {
    const raw = typeof message === "string" ? message : JSON.stringify(message);
    this.emit("message", raw, false);
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

async function settle(runtime: Runtime): Promise<void> {
  await runtime.whenIdle();
}

/** Walks the replicated tree the way the browser would, to locate a row. */
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

/** Addresses a row's checkbox the way the browser would, from its todo id. */
function checkboxAddress(
  root: WireInstance,
  todoId: string,
): { instanceId: string; hole: number } {
  const row = findInstance(root, (candidate) =>
    candidate.id.endsWith(`k:${todoId}`),
  );
  if (!row) throw new Error(`expected a row instance for ${todoId}`);

  const [hole] = eventHoles(row);
  if (hole === undefined) throw new Error("expected an event hole");

  return { instanceId: row.id, hole };
}

function eventHoles(instance: WireInstance): number[] {
  return instance.values.flatMap((value, hole) =>
    typeof value === "object" && value !== null && value.kind === "event"
      ? [hole]
      : [],
  );
}

describe("Runtime", () => {
  let directory: string;
  let store: TodoStore;
  let runtime: Runtime;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "socklit-runtime-"));
    store = await createTodoStore(join(directory, "todos.json"));
    await store.add("First");
    await store.add("Second");

    // Seeded as completed so every branch of the UI, including the "clear
    // completed" control, has already been sent when a session connects.
    const seeded = await store.add("Third");
    await store.toggle(seeded.id);

    const app = createTodoApp(createDatabase(store));
    runtime = new Runtime({
      createApp: () => ({ app }),
      subscribe: (listener) => store.onChange(listener),
    });
  });

  afterEach(async () => {
    runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  async function connect(): Promise<FakeSocket> {
    const socket = new FakeSocket();
    runtime.attach(socket.asWebSocket());
    await settle(runtime);
    return socket;
  }

  it("sends template layouts before the first snapshot", async () => {
    const socket = await connect();
    const [first, second] = socket.sent;

    expect(first?.type).toBe("templates");
    expect(second).toMatchObject({ type: "snapshot", revision: 1 });

    if (first?.type !== "templates") throw new Error("expected templates");
    expect(first.templates.length).toBeGreaterThan(1);
    expect(first.templates.every((template) => template.strings.length > 1)).toBe(
      true,
    );
  });

  it("keeps closures out of the snapshot", async () => {
    const socket = await connect();
    const snapshot = socket.find("snapshot");

    const json = JSON.stringify(snapshot);
    expect(json).not.toContain("=>");
    expect(json).not.toContain("function");
    expect(json).toContain('{"kind":"event"}');
  });

  it("replicates a toggle as hole values with no layout", async () => {
    const socket = await connect();
    const snapshot = socket.find("snapshot");
    if (snapshot?.type !== "snapshot") throw new Error("expected snapshot");

    const todo = store.list()[1];
    if (!todo) throw new Error("expected a todo");

    const row = findInstance(snapshot.root, (candidate) =>
      candidate.id.endsWith(`k:${todo.id}`),
    );
    if (!row) throw new Error("expected a row instance");

    const [checkboxHole] = eventHoles(row);
    if (checkboxHole === undefined) throw new Error("expected an event hole");

    socket.take();
    socket.receive({
      type: "event",
      revision: 1,
      instanceId: row.id,
      hole: checkboxHole,
      payload: { kind: "change", checked: true },
    });
    await settle(runtime);

    const update = socket.find("update");
    if (update?.type !== "update") throw new Error("expected an update");

    expect(update.revision).toBe(2);
    expect(store.list()[1]?.done).toBe(true);

    // Layout is already cached for every branch this render touches.
    expect(update.templates).toEqual([]);
    expect(JSON.stringify(update)).not.toContain("<");

    // Only values move, and the row itself changes exactly one hole.
    expect(update.operations.every((operation) => operation.op === "set")).toBe(
      true,
    );
    expect(
      update.operations.filter(
        (operation) => operation.instanceId === row.id,
      ),
    ).toEqual<PatchOperation[]>([
      { op: "set", instanceId: row.id, hole: 0, value: true },
    ]);
  });

  it("broadcasts a mutation to every live session", async () => {
    const first = await connect();
    const second = await connect();

    const snapshot = second.find("snapshot");
    if (snapshot?.type !== "snapshot") throw new Error("expected snapshot");

    const todo = store.list()[0];
    if (!todo) throw new Error("expected a todo");
    const row = findInstance(snapshot.root, (candidate) =>
      candidate.id.endsWith(`k:${todo.id}`),
    );
    if (!row) throw new Error("expected a row instance");
    const [checkboxHole] = eventHoles(row);
    if (checkboxHole === undefined) throw new Error("expected an event hole");

    first.take();
    second.take();

    second.receive({
      type: "event",
      revision: 1,
      instanceId: row.id,
      hole: checkboxHole,
      payload: { kind: "change", checked: true },
    });
    await settle(runtime);

    expect(second.find("update")).toBeDefined();

    const broadcast = first.find("update");
    if (broadcast?.type !== "update") {
      throw new Error("expected the other session to receive an update");
    }
    expect(broadcast.operations).toContainEqual({
      op: "set",
      instanceId: row.id,
      hole: 0,
      value: true,
    });
  });

  it("sends a keyed list operation when a row is added", async () => {
    const socket = await connect();
    socket.take();

    await store.add("Fourth");
    await settle(runtime);

    const update = socket.find("update");
    if (update?.type !== "update") throw new Error("expected an update");

    expect(update.templates).toEqual([]);

    // One structural operation for the list; the rest are counter values.
    const structural = update.operations.filter(
      (operation) => operation.op === "list",
    );
    expect(structural).toHaveLength(1);
    expect(structural[0]).toMatchObject({ op: "list", instanceId: "root/h1" });
  });

  it("sends a template the first time a branch of the UI appears", async () => {
    for (const todo of store.list()) {
      await store.remove(todo.id);
    }

    const socket = await connect();
    const initialTemplates = socket.find("templates");
    if (initialTemplates?.type !== "templates") {
      throw new Error("expected templates");
    }
    const knownIds = initialTemplates.templates.map((template) => template.id);
    socket.take();

    await store.add("First");
    await settle(runtime);

    const update = socket.find("update");
    if (update?.type !== "update") throw new Error("expected an update");

    // The list and row templates were never rendered for this session before.
    expect(update.templates.length).toBeGreaterThan(0);
    for (const template of update.templates) {
      expect(knownIds).not.toContain(template.id);
    }
  });

  it("gives each session its own template cache", async () => {
    const first = await connect();
    const second = await connect();

    const firstTemplates = first.find("templates");
    const secondTemplates = second.find("templates");
    if (
      firstTemplates?.type !== "templates" ||
      secondTemplates?.type !== "templates"
    ) {
      throw new Error("expected templates for both sessions");
    }

    expect(secondTemplates.templates.map((template) => template.id)).toEqual(
      firstTemplates.templates.map((template) => template.id),
    );
  });

  it("applies an event from a browser that is behind when its target survives", async () => {
    const socket = await connect();
    const snapshot = socket.find("snapshot");
    if (snapshot?.type !== "snapshot") throw new Error("expected snapshot");

    const todo = store.list()[0];
    if (!todo) throw new Error("expected a todo");
    const target = checkboxAddress(snapshot.root, todo.id);

    // Someone else changed the world; this session is now past revision 1.
    await store.add("Fourth");
    await settle(runtime);
    socket.take();

    socket.receive({
      type: "event",
      revision: 1,
      ...target,
      payload: { kind: "change", checked: true },
    });
    await settle(runtime);

    expect(socket.find("error")).toBeUndefined();
    expect(socket.find("update")).toBeDefined();
    expect(store.list()[0]?.done).toBe(true);
  });

  it("does not drop interactions performed within one round trip", async () => {
    const socket = await connect();
    const snapshot = socket.find("snapshot");
    if (snapshot?.type !== "snapshot") throw new Error("expected snapshot");

    const [first, second] = store.list();
    if (!first || !second) throw new Error("expected two todos");
    socket.take();

    // Neither click has seen the other's reply, so both carry revision 1.
    for (const todo of [first, second]) {
      socket.receive({
        type: "event",
        revision: 1,
        ...checkboxAddress(snapshot.root, todo.id),
        payload: { kind: "change", checked: true },
      });
    }
    await settle(runtime);

    expect(socket.find("error")).toBeUndefined();
    expect(store.list().every((todo) => todo.done)).toBe(true);
  });

  it("treats a repeated interaction as intent rather than a flip", async () => {
    const socket = await connect();
    const snapshot = socket.find("snapshot");
    if (snapshot?.type !== "snapshot") throw new Error("expected snapshot");

    const todo = store.list()[0];
    if (!todo) throw new Error("expected a todo");
    const target = checkboxAddress(snapshot.root, todo.id);
    socket.take();

    // Two clients asking for the same outcome must not cancel each other out.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      socket.receive({
        type: "event",
        revision: 1,
        ...target,
        payload: { kind: "change", checked: true },
      });
    }
    await settle(runtime);

    expect(store.list()[0]?.done).toBe(true);
  });

  it("rejects a stale event whose target no longer exists", async () => {
    const socket = await connect();
    const snapshot = socket.find("snapshot");
    if (snapshot?.type !== "snapshot") throw new Error("expected snapshot");

    const todo = store.list()[0];
    if (!todo) throw new Error("expected a todo");
    const target = checkboxAddress(snapshot.root, todo.id);

    // The row is deleted underneath the browser before its click lands.
    await store.remove(todo.id);
    await settle(runtime);
    socket.take();

    socket.receive({
      type: "event",
      revision: 1,
      ...target,
      payload: { kind: "change", checked: true },
    });
    await settle(runtime);

    expect(socket.find("error")).toMatchObject({
      code: "stale_event",
      recoverable: true,
    });
    expect(socket.find("snapshot")).toBeDefined();
  });

  it("rejects an event addressed to a hole with no handler", async () => {
    const socket = await connect();
    socket.take();

    socket.receive({
      type: "event",
      revision: 1,
      instanceId: "root/h9/k:nope",
      hole: 4,
      payload: { kind: "click" },
    });
    await settle(runtime);

    expect(socket.find("error")).toMatchObject({ code: "bad_event" });
    expect(socket.find("update")).toBeUndefined();
  });

  it("reports a failing handler without disturbing the committed tree", async () => {
    const socket = await connect();
    const snapshot = socket.find("snapshot");
    if (snapshot?.type !== "snapshot") throw new Error("expected snapshot");

    // The submit handler rejects empty text in the store.
    const formHole = eventHoles(snapshot.root)[0];
    if (formHole === undefined) throw new Error("expected a form event hole");

    socket.take();
    socket.receive({
      type: "event",
      revision: 1,
      instanceId: "root",
      hole: formHole,
      payload: { kind: "submit", fields: { text: "   " } },
    });
    await settle(runtime);

    expect(socket.find("error")).toMatchObject({
      code: "handler_failed",
      recoverable: true,
    });
    expect(socket.find("update")).toBeUndefined();
    expect(store.list()).toHaveLength(3);
  });

  it("adds a todo from a submit payload", async () => {
    const socket = await connect();
    const snapshot = socket.find("snapshot");
    if (snapshot?.type !== "snapshot") throw new Error("expected snapshot");

    const formHole = eventHoles(snapshot.root)[0];
    if (formHole === undefined) throw new Error("expected a form event hole");

    socket.take();
    socket.receive({
      type: "event",
      revision: 1,
      instanceId: "root",
      hole: formHole,
      payload: { kind: "submit", fields: { text: "  Written from a form  " } },
    });
    await settle(runtime);

    expect(store.list().map((todo) => todo.text)).toContain(
      "Written from a form",
    );
    expect(socket.find("update")).toBeDefined();
  });

  it("closes a client that keeps sending malformed messages", async () => {
    const socket = await connect();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      socket.receive("not json at all");
      await settle(runtime);
    }

    expect(socket.closedWith).toMatchObject({ code: 1008 });
  });

  it("drops sessions on disconnect", async () => {
    const socket = await connect();
    expect(runtime.sessionCount).toBe(1);

    socket.emit("close");
    expect(runtime.sessionCount).toBe(0);

    await store.add("Fourth");
    await settle(runtime);
  });
});

describe("Runtime read scoping", () => {
  /**
   * A shared store with no persistence, so a test can change it and name
   * itself as the source the way a real store does.
   */
  class Counter {
    private readonly listeners = new Set<(source: unknown) => void>();
    value = 0;

    onChange(listener: (source: unknown) => void): () => void {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    bump(): void {
      this.value += 1;
      for (const listener of this.listeners) listener(this);
    }
  }

  /** Fans one runtime-level subscription out to several named sources. */
  function subscribeAll(stores: Counter[]) {
    return (listener: (source?: unknown) => void) => {
      const stops = stores.map((store) => store.onChange(listener));
      return () => {
        for (const stop of stops) stop();
      };
    };
  }

  const metrics = () => new RuntimeMetrics();

  it("skips a session that never read the store that changed", async () => {
    const prices = new Counter();
    const invoices = new Counter();
    const collected = metrics();

    // Which store a session reads is decided per session, which is the shape
    // the sharing argument cares about: one screen moving must not cost the
    // other screen a render.
    const Prices = component(() => html`<p>${useStore(prices).value}</p>`);
    const Invoices = component(() => html`<p>${useStore(invoices).value}</p>`);

    const runtime = new Runtime({
      createApp: (session) => ({
        app: () =>
          session.params.get("view") === "prices"
            ? html`<main>${Prices({})}</main>`
            : html`<main>${Invoices({})}</main>`,
      }),
      subscribe: subscribeAll([prices, invoices]),
      metrics: collected,
    });

    const onPrices = new FakeSocket();
    const onInvoices = new FakeSocket();
    runtime.attach(onPrices.asWebSocket(), new URLSearchParams("view=prices"));
    runtime.attach(
      onInvoices.asWebSocket(),
      new URLSearchParams("view=invoices"),
    );
    await runtime.whenIdle();

    onPrices.take();
    onInvoices.take();

    prices.bump();
    await runtime.whenIdle();

    expect(onPrices.find("update")).toBeDefined();
    expect(onInvoices.sent).toHaveLength(0);
    expect(collected.snapshot().scopedSkips).toBe(1);

    runtime.dispose();
  });

  it("re-renders every session when the source is not identified", async () => {
    const prices = new Counter();
    const collected = metrics();

    // The store announces a change without saying which store it was, which is
    // what every store did before scoping existed. Nothing may be skipped.
    const Prices = component(() => html`<p>${useStore(prices).value}</p>`);

    const runtime = new Runtime({
      createApp: () => ({ app: () => html`<main>${Prices({})}</main>` }),
      subscribe: (listener) => prices.onChange(() => listener()),
      metrics: collected,
    });

    const socket = new FakeSocket();
    runtime.attach(socket.asWebSocket());
    await runtime.whenIdle();
    socket.take();

    prices.bump();
    await runtime.whenIdle();

    expect(socket.find("update")).toBeDefined();
    expect(collected.snapshot().scopedSkips).toBe(0);

    runtime.dispose();
  });

  it("keeps updating an app that declares no reads at all", async () => {
    const prices = new Counter();
    const collected = metrics();

    // Reads the store directly, as every probe did before `useStore`. Scoping
    // has to be a no-op here or adopting it one store at a time is unsafe.
    const runtime = new Runtime({
      createApp: () => ({ app: () => html`<main>${prices.value}</main>` }),
      subscribe: subscribeAll([prices]),
      metrics: collected,
    });

    const socket = new FakeSocket();
    runtime.attach(socket.asWebSocket());
    await runtime.whenIdle();
    socket.take();

    prices.bump();
    await runtime.whenIdle();

    expect(socket.find("update")).toBeDefined();
    expect(collected.snapshot().scopedSkips).toBe(0);

    runtime.dispose();
  });
});

describe("Runtime handler session", () => {
  it("hands the acting session to a closure shared by both viewers", async () => {
    const claims: string[] = [];

    // Defined once, outside any session, and closing over nothing but the log.
    // Under the old signature this could not have been written at all: the
    // actor would have had to be captured, making the closure per session.
    const claim = (_payload: unknown, session: { params: URLSearchParams }) => {
      claims.push(session.params.get("user") ?? "anonymous");
    };

    const runtime = new Runtime({
      createApp: () => ({
        app: () => html`<button @click=${claim}>Claim</button>`,
      }),
    });

    const dana = new FakeSocket();
    const ravi = new FakeSocket();
    runtime.attach(dana.asWebSocket(), new URLSearchParams("user=dana"));
    runtime.attach(ravi.asWebSocket(), new URLSearchParams("user=ravi"));
    await runtime.whenIdle();

    for (const socket of [dana, ravi]) {
      socket.receive({
        type: "event",
        revision: 1,
        instanceId: "root",
        hole: 0,
        payload: { kind: "click" },
      });
    }
    await runtime.whenIdle();

    expect(claims).toEqual(["dana", "ravi"]);

    runtime.dispose();
  });

  it("delivers a key press with its modifiers", async () => {
    const pressed: string[] = [];

    const runtime = new Runtime({
      createApp: () => ({
        app: () =>
          html`<div
            @keydown=${(payload: EventPayload) => {
              if (payload.kind !== "key") throw new Error("expected a key");
              pressed.push(payload.shift ? `Shift+${payload.key}` : payload.key);
            }}
          ></div>`,
      }),
    });

    const socket = new FakeSocket();
    runtime.attach(socket.asWebSocket());
    await runtime.whenIdle();

    socket.receive({
      type: "event",
      revision: 1,
      instanceId: "root",
      hole: 0,
      payload: {
        kind: "key",
        key: "Escape",
        alt: false,
        ctrl: false,
        meta: false,
        shift: false,
        repeat: false,
      },
    });
    socket.receive({
      type: "event",
      revision: 1,
      instanceId: "root",
      hole: 0,
      payload: {
        kind: "key",
        key: "Tab",
        alt: false,
        ctrl: false,
        meta: false,
        shift: true,
        repeat: false,
      },
    });
    await runtime.whenIdle();

    expect(pressed).toEqual(["Escape", "Shift+Tab"]);

    runtime.dispose();
  });
});
