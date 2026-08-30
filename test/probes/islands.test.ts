import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createIslandsApp } from "../../server/probes/islands/app";
import {
  createCardStore,
  type CardStore,
} from "../../server/probes/islands/store";
import { Runtime } from "../../server/runtime";
import type {
  ClientMessage,
  ServerMessage,
  WireInstance,
  WireIslandValue,
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

  find<T extends ServerMessage["type"]>(
    type: T,
  ): Extract<ServerMessage, { type: T }> | undefined {
    return this.sent.find((message) => message.type === type) as
      | Extract<ServerMessage, { type: T }>
      | undefined;
  }
}

function findIsland(
  instance: WireInstance,
  name: string,
): { instanceId: string; hole: number; value: WireIslandValue } {
  for (const [hole, value] of instance.values.entries()) {
    if (typeof value !== "object" || value === null) continue;
    if (value.kind === "island" && value.name === name) {
      return { instanceId: instance.id, hole, value };
    }
    if (value.kind === "island" && value.slot) {
      const found = findIsland(value.slot, name);
      if (found) return found;
    }
    if (value.kind === "instance") {
      const found = findIsland(value.instance, name);
      if (found) return found;
    }
    if (value.kind === "list") {
      for (const item of value.items) {
        const found = findIsland(item.instance, name);
        if (found) return found;
      }
    }
  }
  throw new Error(`no island named ${name}`);
}

function findKeyedRow(instance: WireInstance, key: string): WireInstance | null {
  for (const value of instance.values) {
    if (typeof value !== "object" || value === null) continue;
    if (value.kind === "list") {
      const item = value.items.find((candidate) => candidate.key === key);
      if (item) return item.instance;
      for (const nested of value.items) {
        const found = findKeyedRow(nested.instance, key);
        if (found) return found;
      }
    }
    if (value.kind === "instance") {
      const found = findKeyedRow(value.instance, key);
      if (found) return found;
    }
    if (value.kind === "island" && value.slot) {
      const found = findKeyedRow(value.slot, key);
      if (found) return found;
    }
  }
  return null;
}

function firstEvent(
  instance: WireInstance,
): { instanceId: string; hole: number } | null {
  for (const [hole, value] of instance.values.entries()) {
    if (typeof value !== "object" || value === null) continue;
    if (value.kind === "event") return { instanceId: instance.id, hole };
    if (value.kind === "instance") {
      const found = firstEvent(value.instance);
      if (found) return found;
    }
    if (value.kind === "list") {
      for (const item of value.items) {
        const found = firstEvent(item.instance);
        if (found) return found;
      }
    }
  }
  return null;
}

function findEventInKeyedRow(
  instance: WireInstance,
  key: string,
): { instanceId: string; hole: number } {
  const row = findKeyedRow(instance, key);
  const event = row ? firstEvent(row) : null;
  if (!event) throw new Error(`no event in keyed row ${key}`);
  return event;
}

describe("islands probe", () => {
  let directory: string;
  let store: CardStore;
  let runtime: Runtime;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "socklit-islands-"));
    store = await createCardStore(join(directory, "cards.json"));
    runtime = new Runtime({
      createApp: () => ({ app: createIslandsApp(store) }),
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
    await runtime.whenIdle();
    return socket;
  }

  it("places Radix contracts in the snapshot as island holes, not markup", async () => {
    const socket = await connect();
    const snapshot = socket.find("snapshot");
    if (!snapshot) throw new Error("expected a snapshot");

    const priority = findIsland(snapshot.root, "PrioritySelect");
    const color = findIsland(snapshot.root, "ColorPicker");

    expect(priority.value.props["value"]).toBe("high");
    expect(priority.value.events).toEqual(["onChange"]);
    expect(color.value.props["value"]).toBe("#a78bfa");
    expect(JSON.stringify(snapshot.root)).not.toContain("setPriority");
    expect(JSON.stringify(snapshot.root)).not.toContain("setColor");
  });

  it("applies an island callback as a server write visible to every session", async () => {
    const first = await connect();
    const second = await connect();
    const snapshot = first.find("snapshot");
    if (!snapshot) throw new Error("expected a snapshot");

    const { instanceId, hole } = findIsland(snapshot.root, "PrioritySelect");
    second.sent.length = 0;

    first.receive({
      type: "island",
      revision: snapshot.revision,
      instanceId,
      hole,
      event: "onChange",
      args: ["urgent"],
    });
    await runtime.whenIdle();

    expect(store.list().find((card) => card.id === "cut-branch")?.priority).toBe(
      "urgent",
    );
    expect(second.find("update")).toBeDefined();
  });

  it("rejects an island event aimed at a name that was never mounted", async () => {
    const socket = await connect();
    const snapshot = socket.find("snapshot");
    if (!snapshot) throw new Error("expected a snapshot");

    const { instanceId, hole } = findIsland(snapshot.root, "ColorPicker");
    socket.sent.length = 0;

    socket.receive({
      type: "island",
      revision: snapshot.revision,
      instanceId,
      hole,
      event: "onLaunch",
      args: [],
    });
    await runtime.whenIdle();

    expect(socket.find("error")?.code).toBe("bad_event");
  });

  it("places a server tree in the assign island's slot, not in its props", async () => {
    const socket = await connect();
    const snapshot = socket.find("snapshot");
    if (!snapshot) throw new Error("expected a snapshot");

    const assign = findIsland(snapshot.root, "AssigneePicker");
    expect(assign.value.props["label"]).toBe("Dana");
    expect(assign.value.events).toEqual([]);
    expect(assign.value.slot).toBeDefined();
    expect(JSON.stringify(assign.value.props)).not.toContain("Omar");
    expect(JSON.stringify(assign.value.slot)).toContain("Omar");
    expect(JSON.stringify(snapshot.root)).not.toContain("setTeam");
  });

  it("assigns a person through a slot click, not an island event", async () => {
    const first = await connect();
    const second = await connect();
    const snapshot = first.find("snapshot");
    if (!snapshot) throw new Error("expected a snapshot");

    const assign = findIsland(snapshot.root, "AssigneePicker");
    if (!assign.value.slot) throw new Error("expected a slot");
    const omar = findEventInKeyedRow(assign.value.slot, "omar");
    second.sent.length = 0;

    first.receive({
      type: "event",
      revision: snapshot.revision,
      instanceId: omar.instanceId,
      hole: omar.hole,
      payload: { kind: "click" },
    });
    await runtime.whenIdle();

    expect(store.list().find((card) => card.id === "cut-branch")?.assigneeId).toBe(
      "omar",
    );
    expect(second.find("update")).toBeDefined();
  });

  it("diffs the hosted list when the team filter changes, and does not resend the slot on the island hole", async () => {
    const socket = await connect();
    const snapshot = socket.find("snapshot");
    if (!snapshot) throw new Error("expected a snapshot");

    const assign = findIsland(snapshot.root, "AssigneePicker");
    if (!assign.value.slot) throw new Error("expected a slot");
    const east = findEventInKeyedRow(assign.value.slot, "east");
    socket.sent.length = 0;

    socket.receive({
      type: "event",
      revision: snapshot.revision,
      instanceId: east.instanceId,
      hole: east.hole,
      payload: { kind: "click" },
    });
    await runtime.whenIdle();

    const update = socket.find("update");
    if (update?.type !== "update") throw new Error("expected an update");

    expect(store.list().find((card) => card.id === "cut-branch")?.team).toBe("east");
    expect(
      update.operations.some(
        (operation) =>
          operation.op === "set" &&
          operation.instanceId === assign.instanceId &&
          operation.hole === assign.hole &&
          typeof operation.value === "object" &&
          operation.value !== null &&
          "kind" in operation.value &&
          operation.value.kind === "island" &&
          "slot" in operation.value,
      ),
    ).toBe(false);
    expect(
      update.operations.some((operation) =>
        operation.instanceId.endsWith("/s"),
      ),
    ).toBe(true);
  });
});
