import { describe, expect, it } from "vitest";

import { encodeMarkup, extractApp, injectApp, parsePaint } from "../server/markup";
import type { WireInstance } from "../shared/protocol";

const templates = {
  definition: (id: number) => {
    if (id === 1) return { strings: ["<h1>", "</h1><p>", "</p>"] };
    if (id === 2) return { strings: ["<button @click=", ">Star</button>"] };
    throw new Error(`unknown ${id}`);
  },
};

describe("encodeMarkup", () => {
  it("joins interned strings with escaped hole values", () => {
    const root: WireInstance = {
      id: "root",
      templateId: 1,
      values: ["The wire is the document", "A <note> & more"],
    };
    expect(encodeMarkup(root, templates)).toBe(
      "<h1>The wire is the document</h1><p>A &lt;note&gt; &amp; more</p>",
    );
  });

  it("leaves event holes empty so a button is inert", () => {
    const root: WireInstance = {
      id: "root",
      templateId: 2,
      values: [{ kind: "event" }],
    };
    expect(encodeMarkup(root, templates)).toBe('<button @click="">Star</button>');
  });
});

describe("injectApp", () => {
  it("fills #app and stamps revision", () => {
    const document = `<!doctype html><main id="app" class="app"></main>`;
    expect(injectApp(document, "<h1>Hi</h1>", 1, "html", "todos")).toBe(
      `<!doctype html><main id="app" class="app" data-revision="1" data-paint="html" data-app="todos"><h1>Hi</h1></main>`,
    );
  });

  it("leaves a document without #app unchanged", () => {
    const document = `<!doctype html><p>built</p>`;
    expect(injectApp(document, "<h1>Hi</h1>", 1, "html")).toBe(document);
  });
});

describe("extractApp", () => {
  it("reads the tree listen wrote into #app", () => {
    const document = injectApp(
      `<!doctype html><main id="app"></main>`,
      "<h1>Hi</h1>",
      2,
      "html",
    );
    expect(extractApp(document)).toEqual({ inner: "<h1>Hi</h1>", revision: 2 });
  });
});

describe("parsePaint", () => {
  it("defaults to html", () => {
    expect(parsePaint(null)).toBe("html");
    expect(parsePaint("shell")).toBe("shell");
    expect(parsePaint("html+adopt")).toBe("adopt");
  });
});
