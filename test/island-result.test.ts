import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";

import { html } from "lit-html";

import { finish, wait } from "../client/island-calls";
import { defineIsland, mount } from "../server/island";
import { Runtime } from "../server/runtime";
import {
  parseClientMessage,
  type ClientMessage,
  type ServerMessage,
} from "../shared/protocol";

const Picker = defineIsland<
  { value: string },
  { onChange: (value: string) => unknown }
>("Picker");

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

  find<T extends ServerMessage["type"]>(
    type: T,
  ): Extract<ServerMessage, { type: T }> | undefined {
    return this.sent.find((message) => message.type === type) as
      | Extract<ServerMessage, { type: T }>
      | undefined;
  }
}

describe("parseClientMessage island call", () => {
  function island(over: Record<string, unknown> = {}): string {
    return JSON.stringify({
      type: "island",
      revision: 1,
      instanceId: "root",
      hole: 0,
      event: "onChange",
      args: ["#a78bfa"],
      ...over,
    });
  }

  it("accepts an optional positive call id", () => {
    expect(parseClientMessage(island({ call: 3 }))).toEqual({
      type: "island",
      revision: 1,
      instanceId: "root",
      hole: 0,
      event: "onChange",
      args: ["#a78bfa"],
      call: 3,
    });
  });

  it("still accepts an island message without call", () => {
    expect(parseClientMessage(island())).toEqual({
      type: "island",
      revision: 1,
      instanceId: "root",
      hole: 0,
      event: "onChange",
      args: ["#a78bfa"],
    });
  });

  it("rejects a non-positive call", () => {
    expect(parseClientMessage(island({ call: 0 }))).toBeNull();
    expect(parseClientMessage(island({ call: -1 }))).toBeNull();
    expect(parseClientMessage(island({ call: 1.5 }))).toBeNull();
  });
});

describe("island-calls", () => {
  it("resolves wait when finish has a result", async () => {
    const pending = wait(1001);
    finish(1001, { ok: true });
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it("rejects wait when finish has an error", async () => {
    const pending = wait(1002);
    finish(1002, null, "boom");
    await expect(pending).rejects.toThrow("boom");
  });
});

describe("Runtime island-result", () => {
  let runtime: Runtime;

  afterEach(() => {
    runtime.dispose();
  });

  async function connect(
    onChange: (value: string) => unknown,
  ): Promise<FakeSocket> {
    runtime = new Runtime({
      createApp: () => ({
        app: () =>
          html`${mount(Picker, {
            value: "x",
            onChange,
          })}`,
      }),
    });
    const socket = new FakeSocket();
    runtime.attach(socket.asWebSocket());
    await runtime.whenIdle();
    return socket;
  }

  it("sends the handler return value after flush", async () => {
    const socket = await connect((color) => color.toUpperCase());
    const snapshot = socket.find("snapshot");
    if (snapshot?.type !== "snapshot") throw new Error("expected snapshot");

    socket.receive({
      type: "island",
      revision: snapshot.revision,
      instanceId: "root",
      hole: 0,
      event: "onChange",
      args: ["#fff"],
      call: 7,
    });
    await runtime.whenIdle();

    expect(socket.find("island-result")).toEqual({
      type: "island-result",
      call: 7,
      result: "#FFF",
    });
    expect(socket.closedWith).toBeNull();
  });

  it("sends a visible error when the handler throws and keeps the socket", async () => {
    const socket = await connect(() => {
      throw new Error("boom");
    });
    const snapshot = socket.find("snapshot");
    if (snapshot?.type !== "snapshot") throw new Error("expected snapshot");

    socket.receive({
      type: "island",
      revision: snapshot.revision,
      instanceId: "root",
      hole: 0,
      event: "onChange",
      args: ["#fff"],
      call: 1,
    });
    await runtime.whenIdle();

    expect(socket.find("island-result")).toEqual({
      type: "island-result",
      call: 1,
      result: null,
      error: "boom",
    });
    expect(socket.closedWith).toBeNull();
    expect(socket.find("error")).toBeUndefined();
  });

  it("does not send island-result when the client omitted call", async () => {
    const socket = await connect((color) => color);
    const snapshot = socket.find("snapshot");
    if (snapshot?.type !== "snapshot") throw new Error("expected snapshot");

    socket.receive({
      type: "island",
      revision: snapshot.revision,
      instanceId: "root",
      hole: 0,
      event: "onChange",
      args: ["#fff"],
    });
    await runtime.whenIdle();

    expect(socket.find("island-result")).toBeUndefined();
  });
});
