import { afterEach, describe, expect, it } from "vitest";

import { DurableVault } from "../../server/durable";
import { renderFirstPaint } from "../../server/first-paint";
import {
  createFirstPaintProbe,
} from "../../server/probes/first-paint/probe";
import { createBriefStore } from "../../server/probes/first-paint/store";
import { listen, sessionToken, type ListenHandle } from "../../server/public";
import { SESSION_COOKIE } from "../../shared/protocol";

describe("first paint probe", () => {
  let handle: ListenHandle | undefined;

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it("puts the brief in the GET body (measurement 1)", async () => {
    handle = await host();
    const html = await get(handle.port, "/brief");
    expect(html).toContain("The wire is the document");
    expect(html).toContain("A note on first paint");
    expect(html).toContain("This paragraph must appear in the HTTP response.");
    expect(html).toContain('data-paint="html"');
    expect(html).toContain("12 readers");
  });

  it("serves a shell when asked, with no article (measurement 1 control)", async () => {
    handle = await host();
    const html = await get(handle.port, "/brief?paint=shell");
    expect(html).not.toContain("The wire is the document");
    expect(html).toContain('id="app"');
  });

  it("reads the cookie on GET without a socket (measurement 3)", async () => {
    handle = await host();
    const stranger = await get(handle.port, "/brief");
    expect(stranger).toMatch(/data-probe="chip"[^>]*>Sign in/);

    const ada = await get(handle.port, "/brief", {
      cookie: `${SESSION_COOKIE}=ada`,
    });
    expect(ada).toMatch(/data-probe="chip"[^>]*>Ada/);
    expect(ada).not.toMatch(/data-probe="chip"[^>]*>Sign in/);
  });

  it("leaves the star inert — no POST target (measurement 6)", async () => {
    handle = await host();
    const html = await get(handle.port, "/brief");
    expect(html).toContain('data-probe="star"');
    expect(html).not.toMatch(/<form[^>]*method=["']post/i);

    const posted = await fetch(`http://127.0.0.1:${handle.port}/brief`, {
      method: "POST",
    });
    expect(posted.status).toBe(404);
  });

  it("uses initials for useState and tab durable; user durable reads the vault (measurement 7)", async () => {
    handle = await host();
    const stranger = await get(handle.port, "/brief");
    expect(stranger).not.toContain('data-probe="flash"');
    expect(stranger).toMatch(/data-probe="tab-note"[^>]*>initial tab/);
    expect(stranger).toMatch(/data-probe="user-note"[^>]*>initial user/);

    const vault = DurableVault.memory();
    vault.set("user:ada:user-note", "kept for Ada");
    const store = createBriefStore();
    const probe = createFirstPaintProbe({ store });
    const painted = renderFirstPaint({
      createApp: probe.createApp,
      params: new URLSearchParams(),
      user: { id: "ada", name: "Ada" },
      durable: vault,
    });
    expect(painted.markup).toMatch(/data-probe="tab-note"[^>]*>initial tab/);
    expect(painted.markup).toMatch(/data-probe="user-note"[^>]*>kept for Ada/);
    expect(painted.markup).toMatch(/data-probe="chip"[^>]*>Ada/);
  });
});

async function host(): Promise<ListenHandle> {
  const store = createBriefStore();
  const probe = createFirstPaintProbe({ store });
  return listen({
    identify: (request) => {
      const token = sessionToken(request);
      return token === "ada" ? { id: "ada", name: "Ada" } : null;
    },
    createApp: probe.createApp,
    ...(probe.subscribe ? { subscribe: probe.subscribe } : {}),
    port: 0,
    onLog: () => undefined,
  });
}

async function get(
  port: number,
  path: string,
  options: { cookie?: string } = {},
): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: options.cookie ? { cookie: options.cookie } : {},
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/text\/html/);
  return response.text();
}
