import { afterEach, describe, expect, it } from "vitest";

import { extractApp } from "../server/markup";
import { listen, type ListenHandle } from "../server/public";
import { component, html } from "../server/public";
import { paintDevHtml } from "../server/vite-plugin";

const Hello = component(function Hello() {
  return html`<p>${"hello from listen"}</p>`;
});

const VITE_SHELL = `<!doctype html>
<html>
<body>
<main id="app" class="app"></main>
<script type="module" src="/src/client.ts"></script>
</body>
</html>
`;

describe("extractApp", () => {
  it("reads inner HTML and revision from a listen GET", () => {
    const painted =
      `<main id="app" data-revision="3" data-paint="html"><p>Hi</p></main>`;
    expect(extractApp(painted)).toEqual({ inner: "<p>Hi</p>", revision: 3 });
  });

  it("returns null when there is no #app", () => {
    expect(extractApp("<p>built</p>")).toBeNull();
  });
});

describe("paintDevHtml", () => {
  let handle: ListenHandle | undefined;

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it("puts the listen tree into Vite's #app and keeps the module script", async () => {
    handle = await listen({
      app: () => Hello({}),
      port: 0,
      onLog: () => undefined,
    });

    const html = await paintDevHtml(VITE_SHELL, {
      port: handle.port,
      request: { url: new URL("http://127.0.0.1/compare") },
    });

    expect(html).toContain("hello from listen");
    expect(html).toContain('data-paint="html"');
    expect(html).toContain('src="/src/client.ts"');
    expect(html).toContain('id="app"');
  });

  it("does not inject a listen() whose name is not this page", async () => {
    handle = await listen({
      app: () => Hello({}),
      name: "floor",
      port: 0,
      onLog: () => undefined,
    });

    const html = await paintDevHtml(VITE_SHELL, {
      port: handle.port,
      name: "socklit",
      request: { url: new URL("http://127.0.0.1/") },
    });

    expect(html).not.toContain("hello from listen");
    expect(html).toContain('src="/src/client.ts"');
  });

  it("leaves the Vite shell empty when asked for paint=shell", async () => {
    handle = await listen({
      app: () => Hello({}),
      port: 0,
      onLog: () => undefined,
    });

    const html = await paintDevHtml(VITE_SHELL, {
      port: handle.port,
      request: { url: new URL("http://127.0.0.1/?paint=shell") },
    });

    expect(html).not.toContain("hello from listen");
    expect(html).toContain('src="/src/client.ts"');
  });
});
