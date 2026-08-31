import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { SESSION_COOKIE, SESSION_QUERY } from "../shared/protocol";
import { parseCookies } from "../server/cookies";
import {
  component,
  html,
  listen,
  sessionToken,
  type ListenHandle,
  type SessionContext,
} from "../server/public";

const Hello = component(function Hello() {
  return html`<p>${"hello from listen"}</p>`;
});

describe("listen()", () => {
  let handle: ListenHandle | undefined;

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it("serves a snapshot to a connecting replica", async () => {
    handle = await listen({
      app: () => Hello({}),
      port: 0,
      onLog: () => undefined,
    });

    const messages = await collectMessages(handle.port, 2);
    const types = messages.map((message) => message.type);
    expect(types).toContain("templates");
    expect(types).toContain("snapshot");
    expect(JSON.stringify(messages)).toContain("hello from listen");
  });

  it("answers /health", async () => {
    handle = await listen({
      app: () => Hello({}),
      port: 0,
      onLog: () => undefined,
    });

    const response = await fetch(`http://127.0.0.1:${handle.port}/health`);
    expect(await response.json()).toEqual({
      ok: true,
      name: "socklit",
      sessions: 0,
      protocol: 1,
    });
  });

  it("advertises listen({ name }) on /health", async () => {
    handle = await listen({
      app: () => Hello({}),
      name: "floor",
      port: 0,
      onLog: () => undefined,
    });

    const response = await fetch(`http://127.0.0.1:${handle.port}/health`);
    expect(await response.json()).toMatchObject({ ok: true, name: "floor" });
  });

  it("passes identify's user into createApp", async () => {
    handle = await listen({
      identify: (request) => {
        const token = request.params.get(SESSION_QUERY);
        if (token === "good") return { id: "ada", name: "Ada" };
        return null;
      },
      createApp: (session) => {
        const name = session.user?.name ?? "guest";
        return () => html`<p>${name}</p>`;
      },
      port: 0,
      onLog: () => undefined,
    });

    const guest = await collectMessages(handle.port, 2);
    expect(JSON.stringify(guest)).toContain("guest");

    const signed = await collectMessages(handle.port, 2, `${SESSION_QUERY}=good`);
    expect(JSON.stringify(signed)).toContain("Ada");
  });

  it("sends a credential when the session grants a token", async () => {
    let acting: SessionContext | undefined;

    handle = await listen({
      createApp: (session) => {
        acting = session;
        return () => Hello({});
      },
      port: 0,
      onLog: () => undefined,
    });

    const frames = await withSocket(handle.port, async (socket, received) => {
      await waitFor(() => received.some((message) => message.type === "snapshot"));
      expect(acting).toBeDefined();
      acting!.grant("ticket-1");
      await waitFor(() => received.some((message) => message.type === "credential"));
      return received;
    });

    expect(frames).toContainEqual({ type: "credential", token: "ticket-1" });
  });

  it("closes the socket when identify throws", async () => {
    handle = await listen({
      identify: () => {
        throw new Error("nope");
      },
      app: () => Hello({}),
      port: 0,
      onLog: () => undefined,
    });

    const closed = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${handle!.port}`);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("timed out waiting for identify rejection"));
      }, 3000);
      socket.on("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
      socket.on("error", () => {
        // ws may emit error before close when the handshake is refused.
      });
    });

    expect(closed).toBe(1008);
  });

  it("sets an HttpOnly cookie on POST /session", async () => {
    handle = await listen({
      app: () => Hello({}),
      port: 0,
      onLog: () => undefined,
    });

    const response = await fetch(`http://127.0.0.1:${handle.port}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "ticket-1" }),
    });
    expect(response.status).toBe(204);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=ticket-1`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("passes a cookie token into identify", async () => {
    handle = await listen({
      identify: (request) => {
        const token = sessionToken(request);
        if (token === "good") return { id: "ada", name: "Ada" };
        return null;
      },
      createApp: (session) => {
        const name = session.user?.name ?? "guest";
        return () => html`<p>${name}</p>`;
      },
      port: 0,
      onLog: () => undefined,
    });

    const signed = await collectMessages(handle.port, 2, "", {
      headers: { Cookie: `${SESSION_COOKIE}=good` },
    });
    expect(JSON.stringify(signed)).toContain("Ada");
  });

  it("serves files from publicDir", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "socklit-public-"));
    await writeFile(path.join(root, "index.html"), "<!doctype html><p>built</p>");

    handle = await listen({
      app: () => Hello({}),
      publicDir: root,
      port: 0,
      onLog: () => undefined,
    });

    const response = await fetch(`http://127.0.0.1:${handle.port}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("built");
  });

  it("rejects POST /session from a disallowed Origin", async () => {
    handle = await listen({
      app: () => Hello({}),
      origin: "https://app.example",
      port: 0,
      onLog: () => undefined,
    });

    const response = await fetch(`http://127.0.0.1:${handle.port}/session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ token: "ticket-1" }),
    });
    expect(response.status).toBe(403);
  });

  it("renders the app into #app on GET (first paint)", async () => {
    handle = await listen({
      app: () => Hello({}),
      port: 0,
      onLog: () => undefined,
    });

    const response = await fetch(`http://127.0.0.1:${handle.port}/`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("hello from listen");
    expect(body).toContain('data-paint="html"');
    expect(body).toContain('id="app"');
  });

  it("falls back to index.html for a missing public path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "socklit-spa-"));
    await writeFile(path.join(root, "index.html"), "<!doctype html><p>spa</p>");

    handle = await listen({
      app: () => Hello({}),
      publicDir: root,
      port: 0,
      onLog: () => undefined,
    });

    const response = await fetch(`http://127.0.0.1:${handle.port}/guide`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("spa");
  });
});

describe("parseCookies", () => {
  it("splits a Cookie header", () => {
    expect(parseCookies("session=abc; theme=dark")).toEqual({
      session: "abc",
      theme: "dark",
    });
  });

  it("decodes values and ignores junk", () => {
    expect(parseCookies("name=Ada%20Lovelace; =empty; lone")).toEqual({
      name: "Ada Lovelace",
    });
  });

  it("returns empty for a missing header", () => {
    expect(parseCookies(undefined)).toEqual({});
  });
});

describe("sessionToken", () => {
  it("prefers the cookie over the query string", () => {
    expect(
      sessionToken({
        cookies: { [SESSION_COOKIE]: "from-cookie" },
        params: new URLSearchParams(`${SESSION_QUERY}=from-query`),
      }),
    ).toBe("from-cookie");
  });
});

function collectMessages(
  port: number,
  count: number,
  query = "",
  socketOptions?: { headers?: Record<string, string> },
): Promise<Array<{ type: string }>> {
  const path = query ? `/?${query}` : "/";
  return withSocket(
    port,
    async (socket, received) => {
      await waitFor(() => received.length >= count);
      socket.close();
      return received.slice();
    },
    path,
    socketOptions,
  );
}

function withSocket<T>(
  port: number,
  run: (socket: WebSocket, received: Array<{ type: string }>) => Promise<T>,
  path = "/",
  socketOptions?: { headers?: Record<string, string> },
): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, {
      headers: socketOptions?.headers,
    });
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
