import { afterEach, describe, expect, it } from "vitest";

import { component, html, listen, type ListenHandle } from "../server/public";
import { checkPeer, healthUrlFromSocket } from "../client/peer";

const Hello = component(function Hello() {
  return html`<p>ok</p>`;
});

describe("checkPeer", () => {
  let handle: ListenHandle | undefined;

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it("accepts a listen() that advertises the expected name", async () => {
    handle = await listen({
      app: () => Hello({}),
      name: "todos",
      port: 0,
      onLog: () => undefined,
    });

    const peer = await checkPeer(`http://127.0.0.1:${handle.port}/health`, "todos");
    expect(peer).toEqual({ ok: true, name: "todos" });
  });

  it("refuses a different app on the same port", async () => {
    handle = await listen({
      app: () => Hello({}),
      name: "floor",
      port: 0,
      onLog: () => undefined,
    });

    const peer = await checkPeer(`http://127.0.0.1:${handle.port}/health`, "todos");
    expect(peer.ok).toBe(false);
    if (peer.ok) return;
    expect(peer.retry).toBe(false);
    expect(peer.reason).toContain("floor");
  });

  it("retries when listen() is down", async () => {
    const peer = await checkPeer("http://127.0.0.1:1/health", "todos");
    expect(peer).toEqual({
      ok: false,
      reason: "listen() is not up",
      retry: true,
    });
  });
});

describe("healthUrlFromSocket", () => {
  it("uses the socket host, not the page host", () => {
    expect(healthUrlFromSocket("ws://127.0.0.1:8787/ws?probe=todo")).toBe(
      "http://127.0.0.1:8787/health",
    );
  });
});
