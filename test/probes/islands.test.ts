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
});
