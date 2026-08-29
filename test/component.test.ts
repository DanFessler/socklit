import { html } from "lit-html";
import { describe, expect, it, vi } from "vitest";

import {
  ComponentError,
  HookHost,
  component,
  createContext,
  useContext,
  useRef,
  useState,
  useStore,
  type ComponentMarker,
} from "../server/component";
import { keyed } from "../server/keyed";
import { serialize, TemplateRegistry } from "../server/serialize";
import type { WireInstance, WireListValue } from "../shared/protocol";

/** Renders repeatedly against one registry and one host, as a session does. */
function session(app: () => Parameters<typeof serialize>[0]) {
  const registry = new TemplateRegistry();
  const invalidated = vi.fn();
  const host = new HookHost(invalidated);

  return {
    host,
    invalidated,
    render: () => serialize(app(), registry, host),
  };
}

function listValue(instance: WireInstance, hole = 0): WireListValue {
  const value = instance.values[hole];
  if (!value || typeof value !== "object" || !("items" in value)) {
    throw new Error(`expected a keyed list in hole ${hole}`);
  }
  return value;
}

function rowText(root: WireInstance, key: string): unknown {
  const item = listValue(root).items.find((entry) => entry.key === key);
  if (!item) throw new Error(`no row keyed ${key}`);
  return item.instance.values[0];
}

describe("component addressing", () => {
  it("gives a component the address its template would have had", () => {
    const registry = new TemplateRegistry();

    // The same two tag sites either way, so template ids are comparable and
    // any difference in the result is caused by the component boundary alone.
    const shell = (body: unknown) => html`<main>${body}</main>`;
    const heading = (text: string) => html`<h1>${text}</h1>`;
    const Title = component((props: { text: string }) => heading(props.text));

    const inline = serialize(shell(heading("Todos")), registry);
    const extracted = serialize(shell(Title({ text: "Todos" })), registry);

    // The whole point: extracting a subtree into a component is invisible on
    // the wire, so it can never be the reason a diff changes.
    expect(extracted.root).toEqual(inline.root);
    expect(extracted.root.values[0]).toMatchObject({
      kind: "instance",
      instance: { id: "root/h0", values: ["Todos"] },
    });
  });

  it("addresses a component in a keyed row by the row's key", () => {
    const registry = new TemplateRegistry();
    const Row = component((props: { label: string }) => html`<li>${props.label}</li>`);

    const { root } = serialize(
      html`<ul>
        ${keyed(
          [
            { id: "a", label: "First" },
            { id: "b", label: "Second" },
          ],
          (item) => item.id,
          (item) => Row({ label: item.label }),
        )}
      </ul>`,
      registry,
    );

    expect(listValue(root).items.map((item) => item.instance.id)).toEqual([
      "root/h0/k:a",
      "root/h0/k:b",
    ]);
  });

  it("reuses the interned template across component instances", () => {
    const registry = new TemplateRegistry();
    const Row = component((props: { label: string }) => html`<li>${props.label}</li>`);

    serialize(
      html`<ul>
        ${keyed(
          ["a", "b", "c"],
          (key) => key,
          (key) => Row({ label: key }),
        )}
      </ul>`,
      registry,
    );

    expect(registry.size).toBe(2); // the list and the row
  });

  it("runs a component that delegates to another component", () => {
    const registry = new TemplateRegistry();

    const Admin = component(() => html`<p>${"admin"}</p>`);
    const Viewer = component(() => html`<p>${"viewer"}</p>`);
    const Page = component((props: { admin: boolean }) =>
      props.admin ? Admin({}) : Viewer({}),
    );

    const { root } = serialize(html`<main>${Page({ admin: true })}</main>`, registry);

    expect(root.values[0]).toMatchObject({
      kind: "instance",
      instance: { id: "root/h0", values: ["admin"] },
    });
  });

  it("refuses to delegate forever", () => {
    const registry = new TemplateRegistry();

    const Loop: (props: Record<string, never>) => ComponentMarker = component(
      () => Loop({}),
    );

    expect(() => serialize(html`<main>${Loop({})}</main>`, registry)).toThrow(
      /delegated to another component more than/,
    );
  });

  it("accepts a component as the root of a render", () => {
    const registry = new TemplateRegistry();
    const App = component(() => html`<main>${"hello"}</main>`);

    const { root } = serialize(App({}), registry);

    expect(root.id).toBe("root");
    expect(root.values).toEqual(["hello"]);
  });
});

describe("useState", () => {
  it("retains state across renders and re-renders when it changes", () => {
    let bump = () => {};

    const Counter = component(() => {
      const [count, setCount] = useState(0);
      bump = () => setCount(count + 1);
      return html`<p>${count}</p>`;
    });

    const view = session(() => html`<main>${Counter({})}</main>`);

    expect(view.render().root.values[0]).toMatchObject({
      instance: { values: [0] },
    });

    bump();
    expect(view.invalidated).toHaveBeenCalledTimes(1);

    expect(view.render().root.values[0]).toMatchObject({
      instance: { values: [1] },
    });
  });

  it("does not re-render when the value is unchanged", () => {
    const Counter = component(() => {
      const [count, setCount] = useState(3);
      setters.push(() => setCount(count));
      return html`<p>${count}</p>`;
    });
    const setters: Array<() => void> = [];

    const view = session(() => html`<main>${Counter({})}</main>`);
    view.render();

    setters.at(-1)?.();
    expect(view.invalidated).not.toHaveBeenCalled();
  });

  it("accepts a lazy initial value and an updater function", () => {
    const initial = vi.fn(() => 10);
    let add = () => {};

    const Counter = component(() => {
      const [count, setCount] = useState(initial);
      add = () => setCount((previous) => previous + 5);
      return html`<p>${count}</p>`;
    });

    const view = session(() => html`<main>${Counter({})}</main>`);
    view.render();
    add();
    const second = view.render();

    expect(initial).toHaveBeenCalledTimes(1);
    expect(second.root.values[0]).toMatchObject({ instance: { values: [15] } });
  });

  it("sees the value from the render that produced the setter", () => {
    let bump = () => {};

    const Counter = component(() => {
      const [count, setCount] = useState(0);
      bump = () => setCount(count + 1);
      return html`<p>${count}</p>`;
    });

    const view = session(() => html`<main>${Counter({})}</main>`);
    view.render();

    // Three calls to one render's setter, each computing 0 + 1. This is React's
    // stale-closure semantics, kept deliberately: the updater form below is how
    // you accumulate.
    bump();
    bump();
    bump();

    expect(view.render().root.values[0]).toMatchObject({
      instance: { values: [1] },
    });
  });

  it("keeps separate state per component instance", () => {
    const bumps = new Map<string, () => void>();

    const Row = component((props: { id: string }) => {
      const [count, setCount] = useState(0);
      bumps.set(props.id, () => setCount((previous) => previous + 1));
      return html`<li>${count}</li>`;
    });

    const view = session(
      () => html`<ul>
        ${keyed(
          ["a", "b"],
          (id) => id,
          (id) => Row({ id }),
        )}
      </ul>`,
    );

    view.render();
    bumps.get("a")?.();
    bumps.get("a")?.();
    const root = view.render().root;

    expect(rowText(root, "a")).toBe(2);
    expect(rowText(root, "b")).toBe(0);
  });
});

describe("state identity in collections", () => {
  it("follows the row's key when siblings are reordered", () => {
    const bumps = new Map<string, () => void>();
    let order = ["a", "b", "c"];

    const Row = component((props: { id: string }) => {
      const [count, setCount] = useState(0);
      bumps.set(props.id, () => setCount((previous) => previous + 1));
      return html`<li>${count}</li>`;
    });

    const view = session(
      () => html`<ul>
        ${keyed(
          order,
          (id) => id,
          (id) => Row({ id }),
        )}
      </ul>`,
    );

    view.render();
    bumps.get("c")?.();
    bumps.get("c")?.();
    bumps.get("c")?.();
    view.render();

    // The row that was last is now first. Positional slots would hand its
    // count to `a`; addresses hand it back to `c`.
    order = ["c", "a", "b"];
    const root = view.render().root;

    expect(rowText(root, "c")).toBe(3);
    expect(rowText(root, "a")).toBe(0);
    expect(rowText(root, "b")).toBe(0);
  });

  it("releases state for a row that leaves the tree", () => {
    let order = ["a", "b"];
    const Row = component(() => {
      useState(0);
      return html`<li>${"row"}</li>`;
    });

    const view = session(
      () => html`<ul>
        ${keyed(
          order,
          (id) => id,
          () => Row({}),
        )}
      </ul>`,
    );

    view.render();
    expect(view.host.size).toBe(2);

    order = ["a"];
    view.render();
    expect(view.host.size).toBe(1);
  });

  it("gives a removed row fresh state if it comes back", () => {
    const bumps = new Map<string, () => void>();
    let order = ["a", "b"];

    const Row = component((props: { id: string }) => {
      const [count, setCount] = useState(0);
      bumps.set(props.id, () => setCount(count + 1));
      return html`<li>${count}</li>`;
    });

    const view = session(
      () => html`<ul>
        ${keyed(
          order,
          (id) => id,
          (id) => Row({ id }),
        )}
      </ul>`,
    );

    view.render();
    bumps.get("b")?.();
    view.render();
    expect(rowText(view.render().root, "b")).toBe(1);

    order = ["a"];
    view.render();
    order = ["a", "b"];

    expect(rowText(view.render().root, "b")).toBe(0);
  });

  it("ignores a setter held over from a removed row", () => {
    let order = ["a", "b"];
    const bumps = new Map<string, () => void>();

    const Row = component((props: { id: string }) => {
      const [count, setCount] = useState(0);
      bumps.set(props.id, () => setCount(count + 1));
      return html`<li>${count}</li>`;
    });

    const view = session(
      () => html`<ul>
        ${keyed(
          order,
          (id) => id,
          (id) => Row({ id }),
        )}
      </ul>`,
    );

    view.render();
    order = ["a"];
    view.render();
    view.invalidated.mockClear();

    // A handler that was in flight when the row disappeared. React treats this
    // as a no-op and so do we: it must not schedule a render.
    expect(() => bumps.get("b")?.()).not.toThrow();
    expect(view.invalidated).not.toHaveBeenCalled();
  });

  it("discards state when a different component takes the address", () => {
    const Left = component(() => {
      const [count, setCount] = useState(0);
      bump = () => setCount(count + 1);
      return html`<p>${`left:${count}`}</p>`;
    });
    const Right = component(() => {
      const [count] = useState(0);
      return html`<p>${`right:${count}`}</p>`;
    });

    let bump = () => {};
    let showLeft = true;

    const view = session(
      () => html`<main>${showLeft ? Left({}) : Right({})}</main>`,
    );

    view.render();
    bump();
    view.render();

    showLeft = false;
    expect(view.render().root.values[0]).toMatchObject({
      instance: { values: ["right:0"] },
    });
  });

  /**
   * The displaced component's setter has to go inert, and the path that gets
   * there is easy to miss.
   *
   * A component whose function has never run a hook skips the table lookup, so
   * it does not discover the entry it is about to displace. If it then runs its
   * first hook, it overwrites that entry without anyone having marked the old
   * one dead — leaving a live setter pointing at an orphaned slot, which would
   * schedule renders for a component no longer in the tree.
   */
  it("kills the setter of a component displaced by one that skipped the lookup", () => {
    let bump = () => {};
    let showLeft = true;

    const Left = component(() => {
      const [count, setCount] = useState(0);
      bump = () => setCount((previous) => previous + 1);
      return html`<p>${`left:${count}`}</p>`;
    });

    // Never rendered before, so its site has not latched and its first render
    // takes the skip-the-lookup path.
    const Right = component(() => {
      const [count] = useState(0);
      return html`<p>${`right:${count}`}</p>`;
    });

    const view = session(
      () => html`<main>${showLeft ? Left({}) : Right({})}</main>`,
    );

    view.render();
    showLeft = false;
    view.render();

    view.invalidated.mockClear();
    bump();

    expect(view.invalidated).not.toHaveBeenCalled();
  });
});

describe("hook rules", () => {
  it("refuses a hook called outside a component", () => {
    expect(() => useState(0)).toThrow(ComponentError);
    expect(() => useState(0)).toThrow(/outside a component/);
  });

  it("refuses a hook called after its component returned", () => {
    let escaped = () => {};
    const Leaky = component(() => {
      escaped = () => useState(0);
      return html`<p>${"x"}</p>`;
    });

    const view = session(() => html`<main>${Leaky({})}</main>`);
    view.render();

    expect(escaped).toThrow(/outside a component/);
  });

  it("refuses a hook count that changes between renders", () => {
    let extra = false;
    const Wobbly = component(() => {
      useState(0);
      if (extra) useState(1);
      return html`<p>${"x"}</p>`;
    });

    const view = session(() => html`<main>${Wobbly({})}</main>`);
    view.render();

    extra = true;
    expect(() => view.render()).toThrow(/same order every time/);
  });

  /**
   * The half of the count guard that lazy entries could have cost.
   *
   * A component with no entry is indistinguishable from one that never
   * rendered, so dropping to zero hooks has to be caught by the entry that
   * already exists rather than by the render that follows. If it were not, the
   * end-of-render sweep would read the component as having left the tree and
   * discard its state without a word.
   */
  it("refuses a component that stops calling hooks", () => {
    let quiet = false;
    const Fickle = component(() => {
      if (!quiet) useState(0);
      return html`<p>${"x"}</p>`;
    });

    const view = session(() => html`<main>${Fickle({})}</main>`);
    view.render();

    quiet = true;
    expect(() => view.render()).toThrow(/ran 0 hooks this render and 1 last render/);
  });

  it("names component() in the message, because the usual cause is a missing wrapper", () => {
    let rows = 1;

    // The footgun: a helper that uses hooks but was never wrapped. Its slots
    // land in the parent's table, so the parent's hook count tracks the row
    // count and the corruption surfaces the moment that changes.
    const unwrappedRow = () => {
      const [count] = useState(0);
      return html`<li>${count}</li>`;
    };

    const Parent = component(() => {
      const items = Array.from({ length: rows }, () => unwrappedRow());
      return html`<ul>
        ${items[0]}${items[1] ?? null}
      </ul>`;
    });

    const view = session(() => html`<main>${Parent({})}</main>`);
    view.render();

    rows = 2;
    expect(() => view.render()).toThrow(/wrap any helper that calls hooks in component\(\)/);
  });

  it("refuses state set during a render", () => {
    const Recursive = component(() => {
      const [count, setCount] = useState(0);
      setCount(count + 1);
      return html`<p>${count}</p>`;
    });

    const view = session(() => html`<main>${Recursive({})}</main>`);

    expect(() => view.render()).toThrow(/set state while rendering/);
  });

  it("keeps state when a render throws", () => {
    let bump = () => {};
    let broken = false;

    const Counter = component(() => {
      const [count, setCount] = useState(0);
      bump = () => setCount(count + 1);
      if (broken) throw new Error("render blew up");
      return html`<p>${count}</p>`;
    });

    const view = session(() => html`<main>${Counter({})}</main>`);
    view.render();
    bump();
    view.render();

    broken = true;
    expect(() => view.render()).toThrow("render blew up");

    // A failed render must not garbage-collect the tree it failed to replace.
    broken = false;
    expect(view.render().root.values[0]).toMatchObject({
      instance: { values: [1] },
    });
  });
});

describe("the hook table", () => {
  /**
   * Sized by state, not by structure.
   *
   * Most components in the probes converted so far hold nothing, and an entry
   * for one of those is an allocation and a map insert bought in exchange for
   * a slot array that stays empty for the life of the session. The first hook
   * opens the entry; a component that calls none never appears in the table.
   */
  it("holds nothing for components that call no hooks", () => {
    const Inert = component((props: { label: string }) => html`<li>${props.label}</li>`);
    const Stateful = component(() => {
      const [count] = useState(0);
      return html`<li>${count}</li>`;
    });

    const view = session(
      () => html`<ul>
        ${keyed(
          ["a", "b", "c"],
          (id) => id,
          (id) => Inert({ label: id }),
        )}
        ${Stateful({})}
      </ul>`,
    );

    view.render();

    expect(view.host.size).toBe(1);
  });

  /**
   * The failure this replaces is a wrong number, not a crash.
   *
   * A script that re-renders in a loop without keeping a host hands every
   * component its initial state on every pass. The tree that comes out is
   * completely plausible, so the mistake surfaces as a measurement that quietly
   * disagrees with the runtime rather than as anything that looks like a bug.
   */
  it("refuses a hook on a host that will not outlive the render", () => {
    const Stateful = component(function Stateful() {
      const [count] = useState(0);
      return html`<p>${count}</p>`;
    });

    expect(() => serialize(Stateful({}), new TemplateRegistry())).toThrow(
      /no session to hold its state/,
    );
  });

  it("lets a stateless tree render without a host", () => {
    const Inert = component(() => html`<p>${"x"}</p>`);

    expect(() => serialize(Inert({}), new TemplateRegistry())).not.toThrow();
  });

  it("still sweeps a stateful component that leaves the tree", () => {
    let present = true;
    const Stateful = component(() => {
      const [count] = useState(0);
      return html`<li>${count}</li>`;
    });

    const view = session(
      () => html`<ul>
        ${present ? Stateful({}) : null}
      </ul>`,
    );

    view.render();
    expect(view.host.size).toBe(1);

    present = false;
    view.render();
    expect(view.host.size).toBe(0);
  });
});

describe("useRef", () => {
  /**
   * The case `useState` cannot serve: a value that changes *because* a render
   * happened. A setter is refused mid-render, so a counter built from state
   * would either throw or loop.
   */
  it("survives renders and does not cause one", () => {
    const Counted = component(() => {
      const renders = useRef(0);
      renders.current += 1;
      return html`<p>${renders.current}</p>`;
    });

    const view = session(() => html`<main>${Counted({})}</main>`);

    view.render();
    view.render();
    const root = view.render().root;

    expect((root.values[0] as { instance: WireInstance }).instance.values[0]).toBe(3);
    expect(view.invalidated).not.toHaveBeenCalled();
  });

  it("keeps a separate cell per instance and releases it with the row", () => {
    const seen = new Map<string, { current: number }>();
    let rows = ["a", "b"];

    const Row = component((props: { id: string }) => {
      const cell = useRef(0);
      cell.current += 1;
      seen.set(props.id, cell);
      return html`<li>${cell.current}</li>`;
    });

    const view = session(
      () => html`<ul>
        ${keyed(
          rows,
          (id) => id,
          (id) => Row({ id }),
        )}
      </ul>`,
    );

    view.render();
    view.render();

    expect(seen.get("a")?.current).toBe(2);
    expect(seen.get("b")?.current).toBe(2);

    rows = ["a"];
    view.render();
    rows = ["a", "b"];
    view.render();

    expect(seen.get("a")?.current).toBe(4);
    expect(seen.get("b")?.current).toBe(1);
  });

  it("refuses a slot that held state last render", () => {
    let useAState = true;
    const Confused = component(() => {
      if (useAState) useState(0);
      else useRef(0);
      return html`<p>${"x"}</p>`;
    });

    const view = session(() => html`<main>${Confused({})}</main>`);
    view.render();

    useAState = false;
    expect(() => view.render()).toThrow(/was not a useRef last render/);
  });
});

describe("context", () => {
  /**
   * The property that makes context free: a provider carries its subtree rather
   * than wrapping it, so what it provides to occupies the address it would have
   * had anyway and the bytes are unchanged.
   */
  it("adds no instance, no hole and no template", () => {
    const Theme = createContext("theme", "light");
    const body = () => html`<p>${"hello"}</p>`;

    const plain = session(() => html`<main>${body()}</main>`);
    const wrapped = session(() => html`<main>${Theme.provide("dark", body())}</main>`);

    expect(wrapped.render().root).toEqual(plain.render().root);
  });

  it("reaches a component that was never handed the value", () => {
    const Theme = createContext("theme", "light");

    const Leaf = component(() => html`<b>${useContext(Theme)}</b>`);
    const Middle = component(() => html`<div>${Leaf({})}</div>`);

    const view = session(
      () => html`<main>${Theme.provide("dark", Middle({}))}</main>`,
    );

    expect(JSON.stringify(view.render().root)).toContain("dark");
  });

  it("falls back when nothing provided a value", () => {
    const Theme = createContext("theme", "light");
    const Leaf = component(() => html`<b>${useContext(Theme)}</b>`);

    const view = session(() => html`<main>${Leaf({})}</main>`);

    expect(JSON.stringify(view.render().root)).toContain("light");
  });

  it("scopes the value to the subtree and restores the outer one after it", () => {
    const Theme = createContext("theme", "light");
    const Leaf = component(() => html`<b>${useContext(Theme)}</b>`);

    const view = session(
      () => html`<main>
        ${Theme.provide("dark", Leaf({}))}${Leaf({})}
      </main>`,
    );

    const root = view.render().root;
    const read = (hole: number) =>
      (root.values[hole] as { instance: WireInstance }).instance.values[0];

    expect(read(0)).toBe("dark");
    expect(read(1)).toBe("light");
  });

  it("nests, with the innermost provider winning", () => {
    const Theme = createContext("theme", "light");
    const Leaf = component(() => html`<b>${useContext(Theme)}</b>`);
    const Inner = component(() => Theme.provide("high-contrast", Leaf({})));

    const view = session(
      () => html`<main>${Theme.provide("dark", Inner({}))}</main>`,
    );

    expect(JSON.stringify(view.render().root)).toContain("high-contrast");
  });

  /**
   * A render that throws must not leave a value on the stack, or every
   * subsequent render in the process reads a value from a tree that failed.
   */
  it("unwinds when a render throws", () => {
    const Theme = createContext("theme", "light");
    const Leaf = component(() => html`<b>${useContext(Theme)}</b>`);

    let explode = true;
    const Boom = component(() => {
      if (explode) throw new Error("render failed");
      return html`<i>${"ok"}</i>`;
    });

    const view = session(
      () => html`<main>${Theme.provide("dark", Boom({}))}${Leaf({})}</main>`,
    );

    expect(() => view.render()).toThrow(/render failed/);

    explode = false;
    const root = view.render().root;
    expect((root.values[1] as { instance: WireInstance }).instance.values[0]).toBe(
      "light",
    );
  });

  it("refuses to be read outside a component", () => {
    const Theme = createContext("theme", "light");
    expect(() => useContext(Theme)).toThrow(/outside a component/);
  });
});

describe("useStore", () => {
  /** The minimum a store is: state plus a way to announce that it moved. */
  function fakeStore(items: string[] = ["a"]) {
    return {
      list: () => [...items],
      onChange: (_listener: () => void) => () => {},
    };
  }

  it("hands back the store it was given", () => {
    const store = fakeStore();
    let seen: unknown = null;

    const View = component(() => {
      seen = useStore(store);
      return html`<p>${"x"}</p>`;
    });

    const view = session(() => html`<main>${View({})}</main>`);
    view.render();

    expect(seen).toBe(store);
  });

  it("refuses to be called outside a component", () => {
    expect(() => useStore(fakeStore())).toThrow(/outside a component/);
  });

  it("rejects a record of stores, which would silently stop updates", () => {
    const db = { todos: fakeStore() };

    const View = component(() => {
      useStore(db);
      return html`<p>${"x"}</p>`;
    });

    const view = session(() => html`<main>${View({})}</main>`);
    expect(() => view.render()).toThrow(/useStore\(db.todos\)/);
  });

  it("records the read so a change elsewhere can be scoped out", () => {
    const shown = fakeStore();
    const other = fakeStore();

    const View = component(() => {
      useStore(shown).list();
      return html`<p>${"x"}</p>`;
    });

    const view = session(() => html`<main>${View({})}</main>`);
    view.render();

    expect(view.host.didRead(shown)).toBe(true);
    expect(view.host.didRead(other)).toBe(false);
  });

  it("treats a render that declared nothing as reading everything", () => {
    // The conservative answer, and the reason adopting read scoping one store
    // at a time is safe: an app that never declares a read keeps updating.
    const store = fakeStore();
    const view = session(() => html`<main>${"x"}</main>`);
    view.render();

    expect(view.host.declaresReads).toBe(false);
    expect(view.host.didRead(store)).toBe(true);
  });

  it("forgets a store the latest render stopped reading", () => {
    const prices = fakeStore();
    let showPrices = true;

    // Two components rather than a condition inside one, because a conditional
    // hook is exactly what the boundary refuses.
    const Prices = component(() => html`<p>${useStore(prices).list()[0]}</p>`);
    const Blank = component(() => html`<p>${"—"}</p>`);

    const view = session(
      () => html`<main>${showPrices ? Prices({}) : Blank({})}</main>`,
    );

    view.render();
    expect(view.host.didRead(prices)).toBe(true);

    showPrices = false;
    view.render();
    expect(view.host.didRead(prices)).toBe(false);
  });

  it("keeps the previous read set when a render throws", () => {
    const store = fakeStore();
    let fail = false;

    const View = component(() => {
      useStore(store).list();
      if (fail) throw new Error("render failed");
      return html`<p>${"x"}</p>`;
    });

    const view = session(() => html`<main>${View({})}</main>`);
    view.render();

    fail = true;
    expect(() => view.render()).toThrow(/render failed/);

    // The failed render never committed, so the session is still described by
    // the tree the browser is actually showing.
    expect(view.host.didRead(store)).toBe(true);
  });
});

describe("session isolation", () => {
  it("keeps two sessions' component state apart", () => {
    const bumps: Array<() => void> = [];

    const Counter = component(() => {
      const [count, setCount] = useState(0);
      bumps.push(() => setCount(count + 1));
      return html`<p>${count}</p>`;
    });

    const app = () => html`<main>${Counter({})}</main>`;
    const first = session(app);
    const second = session(app);

    first.render();
    second.render();

    bumps[0]?.();

    expect(first.render().root.values[0]).toMatchObject({
      instance: { values: [1] },
    });
    expect(second.render().root.values[0]).toMatchObject({
      instance: { values: [0] },
    });
  });

  it("releases every entry when a session ends", () => {
    const Row = component(() => {
      useState(0);
      return html`<li>${"row"}</li>`;
    });

    const view = session(
      () => html`<ul>
        ${keyed(
          ["a", "b", "c"],
          (id) => id,
          () => Row({}),
        )}
      </ul>`,
    );

    view.render();
    expect(view.host.size).toBe(3);

    view.host.disposeAll();
    expect(view.host.size).toBe(0);
  });
});
