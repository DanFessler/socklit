import { html } from "lit-html";
import { describe, expect, it, vi } from "vitest";

import { HookHost, component, useStore } from "../server/component";
import { changeSource, ChangeSource } from "../server/public";
import { serialize, TemplateRegistry } from "../server/serialize";

describe("changeSource", () => {
  it("returns a unique instance each call", () => {
    const first = changeSource();
    const second = changeSource();
    expect(first).toBeInstanceOf(ChangeSource);
    expect(second).toBeInstanceOf(ChangeSource);
    expect(first).not.toBe(second);
    expect(first.id).not.toBe(second.id);
  });

  it("is accepted by useStore", () => {
    const source = changeSource();
    let seen: unknown = null;

    const View = component(() => {
      seen = useStore(source);
      return html`<p>${"ok"}</p>`;
    });

    const registry = new TemplateRegistry();
    const host = new HookHost(vi.fn());
    expect(() => serialize(html`<main>${View({})}</main>`, registry, host)).not.toThrow();
    expect(seen).toBe(source);
  });
});
