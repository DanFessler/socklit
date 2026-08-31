import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { parseClientMessage } from "../shared/protocol";
import {
  html,
  listen,
  sessionToken,
  type ListenHandle,
  type SessionContext,
} from "../server/public";

describe("parseClientMessage reidentify", () => {
  it("accepts a token or null without addressing", () => {
    expect(
      parseClientMessage(JSON.stringify({ type: "reidentify", token: "ticket-1" })),
    ).toEqual({ type: "reidentify", token: "ticket-1" });
    expect(
      parseClientMessage(JSON.stringify({ type: "reidentify", token: null })),
    ).toEqual({ type: "reidentify", token: null });
  });

  it("rejects garbage", () => {
    expect(parseClientMessage(JSON.stringify({ type: "reidentify" }))).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ type: "reidentify", token: 1 })),
    ).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ type: "reidentify", token: { x: 1 } })),
    ).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "event", token: "x" }))).toBeNull();
  });
});

describe("reidentify on a live listen() session", () => {
  let handle: ListenHandle | undefined;

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it("updates user after grant without opening a new socket", async () => {
    let acting: SessionContext<{ id: string; name: string }> | undefined;

    handle = await listen({
      identify: (request) => {
        const token = sessionToken(request);
        if (token === "good") return { id: "ada", name: "Ada" };
        return null;
      },
      createApp: (session) => {
        acting = session;
        return () => html`<p>${session.user?.name ?? "guest"}</p>`;
      },
      port: 0,
      onLog: () => undefined,
    });

    await withSocket(handle.port, async (socket, received) => {
      await waitFor(() => received.some((message) => message.type === "snapshot"));
      expect(JSON.stringify(received)).toContain("guest");
      expect(acting).toBeDefined();

      acting!.grant("good");
      await waitFor(() => received.some((message) => message.type === "credential"));
      expect(received).toContainEqual({ type: "credential", token: "good" });

      expect(socket.readyState).toBe(WebSocket.OPEN);
      socket.send(JSON.stringify({ type: "reidentify", token: "good" }));

      await waitFor(() => JSON.stringify(received).includes("Ada"));
      expect(socket.readyState).toBe(WebSocket.OPEN);
      expect(received.filter((message) => message.type === "snapshot")).toHaveLength(
        1,
      );
      expect(received.some((message) => message.type === "update")).toBe(true);
    });
  });
});

function withSocket<T>(
  port: number,
  run: (socket: WebSocket, received: Array<{ type: string }>) => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const received: Array<{ type: string }> = [];
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("timed out waiting for socket work"));
    }, 3000);

    socket.on("message", (data) => {
      received.push(JSON.parse(String(data)) as { type: string });
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("open", () => {
      void run(socket, received)
        .then((value) => {
          clearTimeout(timer);
          socket.close();
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          socket.close();
          reject(error);
        });
    });
  });
}

function waitFor(ready: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (ready()) {
        resolve();
        return;
      }
      if (Date.now() - started > 2500) {
        reject(new Error("timed out waiting for condition"));
        return;
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}
