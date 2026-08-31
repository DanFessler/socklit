import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { html } from "lit-html";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ComponentError,
  HookHost,
  component,
  useDurable,
  useState,
} from "../server/component";
import {
  DurableVault,
  durableCellKey,
  durableIdentity,
} from "../server/durable";
import { serialize, TemplateRegistry } from "../server/serialize";

function durableSession(
  app: () => Parameters<typeof serialize>[0],
  options: {
    vault?: DurableVault;
    identity?: string | null;
    tab?: string | null;
  } = {},
) {
  const registry = new TemplateRegistry();
  const invalidated = vi.fn();
  const vault = options.vault ?? DurableVault.memory();
  const host = new HookHost(invalidated, {
    vault,
    identity: () =>
      options.identity === undefined ? "ada" : options.identity,
    tab: () => (options.tab === undefined ? "t1" : options.tab),
  });

  return {
    host,
    invalidated,
    vault,
    render: () => serialize(app(), registry, host),
  };
}

describe("DurableVault", () => {
  let directory: string | null = null;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = null;
  });

  it("notifies watchers and clones on write", () => {
    const vault = DurableVault.memory();
    const seen: unknown[] = [];
    vault.watch("k", () => seen.push(vault.get("k")));

    const draft = { step: 1 };
    vault.set("k", draft);
    draft.step = 9;

    expect(vault.get("k")).toEqual({ step: 1 });
    expect(seen).toEqual([{ step: 1 }]);
  });

  it("reproduces cells from disk after a reload", async () => {
    directory = await mkdtemp(join(tmpdir(), "socklit-durable-"));
    const file = join(directory, "durable.json");

    const first = await DurableVault.file(file);
    first.set("tab:ada:t1:wizard", { step: 2, cart: { mug: 1 } });
    await first.flush();

    const second = await DurableVault.file(file);
    expect(second.get("tab:ada:t1:wizard")).toEqual({
      step: 2,
      cart: { mug: 1 },
    });
  });
});

describe("durable keys", () => {
  it("reads identity from a string, a number, an id field, or ?user=", () => {
    const empty = new URLSearchParams();
    expect(durableIdentity("ada", empty)).toBe("ada");
    expect(durableIdentity(7, empty)).toBe("7");
    expect(durableIdentity({ id: "ben" }, empty)).toBe("ben");
    expect(durableIdentity({ id: 3 }, empty)).toBe("3");
    expect(durableIdentity(null, new URLSearchParams("user=guest"))).toBe(
      "guest",
    );
    expect(durableIdentity(null, empty)).toBeNull();
  });

  it("keys a tab cell by person and tab, and a user cell by person only", () => {
    expect(
      durableCellKey({
        share: "tab",
        name: "wizard",
        identity: "ada",
        tab: "t1",
      }),
    ).toBe("tab:ada:t1:wizard");
    expect(
      durableCellKey({
        share: "user",
        name: "wizard",
        identity: "ada",
        tab: "t1",
      }),
    ).toBe("user:ada:wizard");
  });

  it("refuses a shared cell without a person and a tab cell without a tab", () => {
    expect(() =>
      durableCellKey({
        share: "user",
        name: "wizard",
        identity: null,
        tab: "t1",
      }),
    ).toThrow(/needs a person/);
    expect(() =>
      durableCellKey({
        share: "tab",
        name: "wizard",
        identity: "ada",
        tab: null,
      }),
    ).toThrow(/needs a tab id/);
  });
});

describe("useDurable", () => {
  it("retains a cell across a new host of the same tab", () => {
    const vault = DurableVault.memory();
    let bump = () => {};

    const Counter = component(() => {
      const [count, setCount] = useDurable("count", 0);
      bump = () => setCount(count + 1);
      return html`<p>${count}</p>`;
    });

    const first = durableSession(() => html`<main>${Counter({})}</main>`, {
      vault,
    });
    first.render();
    bump();
    first.render();
    first.host.disposeAll();

    const again = durableSession(() => html`<main>${Counter({})}</main>`, {
      vault,
    });
    expect(again.render().root.values[0]).toMatchObject({
      instance: { values: [1] },
    });
  });

  it("does not share a cell with a second tab", () => {
    const vault = DurableVault.memory();
    let bump = () => {};

    const Counter = component(() => {
      const [count, setCount] = useDurable("count", 0);
      bump = () => setCount(count + 1);
      return html`<p>${count}</p>`;
    });

    const one = durableSession(() => html`<main>${Counter({})}</main>`, {
      vault,
      tab: "t1",
    });
    one.render();
    bump();
    one.render();

    const two = durableSession(() => html`<main>${Counter({})}</main>`, {
      vault,
      tab: "t2",
    });
    expect(two.render().root.values[0]).toMatchObject({
      instance: { values: [0] },
    });
  });

  it("shares a cell across tabs when asked", () => {
    const vault = DurableVault.memory();
    let bump = () => {};

    const Counter = component(() => {
      const [count, setCount] = useDurable("count", 0, { share: "user" });
      bump = () => setCount(count + 1);
      return html`<p>${count}</p>`;
    });

    const one = durableSession(() => html`<main>${Counter({})}</main>`, {
      vault,
      tab: "t1",
    });
    one.render();
    bump();
    one.render();

    const two = durableSession(() => html`<main>${Counter({})}</main>`, {
      vault,
      tab: "t2",
    });
    expect(two.render().root.values[0]).toMatchObject({
      instance: { values: [1] },
    });
  });

  it("invalidates other sessions watching the same cell", () => {
    const vault = DurableVault.memory();
    let bump = () => {};

    const Counter = component(() => {
      const [count, setCount] = useDurable("count", 0, { share: "user" });
      bump = () => setCount(count + 1);
      return html`<p>${count}</p>`;
    });

    const one = durableSession(() => html`<main>${Counter({})}</main>`, {
      vault,
      tab: "t1",
    });
    const two = durableSession(() => html`<main>${Counter({})}</main>`, {
      vault,
      tab: "t2",
    });
    one.render();
    two.render();
    bump();

    expect(one.invalidated).toHaveBeenCalled();
    expect(two.invalidated).toHaveBeenCalled();
  });

  it("accepts a lazy initial value and an updater function", () => {
    const initial = vi.fn(() => 10);
    let add = () => {};

    const Counter = component(() => {
      const [count, setCount] = useDurable("count", initial);
      add = () => setCount((previous) => previous + 5);
      return html`<p>${count}</p>`;
    });

    const view = durableSession(() => html`<main>${Counter({})}</main>`);
    view.render();
    add();
    const second = view.render();

    expect(initial).toHaveBeenCalledTimes(1);
    expect(second.root.values[0]).toMatchObject({ instance: { values: [15] } });
  });

  it("does not re-render when the JSON value is unchanged", () => {
    const setters: Array<() => void> = [];
    const Counter = component(() => {
      const [count, setCount] = useDurable("count", { n: 3 });
      setters.push(() => setCount({ n: 3 }));
      return html`<p>${count.n}</p>`;
    });

    const view = durableSession(() => html`<main>${Counter({})}</main>`);
    view.render();
    setters.at(-1)?.();
    expect(view.invalidated).not.toHaveBeenCalled();
  });

  it("refuses a name that is not an identifier", () => {
    const Bad = component(() => {
      useDurable("1wizard", 0);
      return html`<p>x</p>`;
    });

    expect(() =>
      durableSession(() => html`<main>${Bad({})}</main>`).render(),
    ).toThrow(/not a usable name/);
  });

  it("refuses share: user without a person", () => {
    const Shared = component(() => {
      useDurable("wizard", 0, { share: "user" });
      return html`<p>x</p>`;
    });

    expect(() =>
      durableSession(() => html`<main>${Shared({})}</main>`, {
        identity: null,
      }).render(),
    ).toThrow(/needs a person/);
  });

  it("refuses a render with no vault", () => {
    const Counter = component(() => {
      useDurable("count", 0);
      return html`<p>x</p>`;
    });
    const registry = new TemplateRegistry();
    const host = new HookHost();

    expect(() =>
      serialize(html`<main>${Counter({})}</main>`, registry, host),
    ).toThrow(ComponentError);
    expect(() =>
      serialize(html`<main>${Counter({})}</main>`, registry, host),
    ).toThrow(/no durable vault/);
  });

  it("refuses a hook that was not useDurable last render", () => {
    let flip = false;
    const Flip = component(() => {
      if (flip) useDurable("count", 0);
      else useState(0);
      return html`<p>x</p>`;
    });

    const view = durableSession(() => html`<main>${Flip({})}</main>`);
    view.render();
    flip = true;
    expect(() => view.render()).toThrow(/was not a useDurable last render/);
  });
});
