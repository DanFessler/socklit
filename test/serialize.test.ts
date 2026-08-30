import { html } from "lit-html";
import { describe, expect, it } from "vitest";

import { component, HookHost, useState } from "../server/component";
import { diff } from "../server/diff";
import { focusWhen } from "../server/focus";
import { keyed } from "../server/keyed";
import {
  AddressBook,
  SerializeError,
  serialize,
  TemplateRegistry,
} from "../server/serialize";
import type { SessionHandle } from "../server/session";
import type { WireInstance, WireListValue } from "../shared/protocol";

type Todo = { id: string; text: string; done: boolean };

const todos: Todo[] = [
  { id: "a", text: "First", done: false },
  { id: "b", text: "Second", done: true },
];

function todoList(items: Todo[]) {
  return html`
    <ul>
      ${keyed(
        items,
        (todo) => todo.id,
        (todo) => html`
          <li>
            <input .checked=${todo.done} @change=${() => todo.id} />
            <span>${todo.text}</span>
          </li>
        `,
      )}
    </ul>
  `;
}

/** Stands in for the session the runtime passes at dispatch. */
function actingSession(id = "s1", query = ""): SessionHandle {
  return {
    id,
    params: new URLSearchParams(query),
    user: null,
    grant() {},
    revoke() {},
  };
}

function listValue(root: WireInstance): WireListValue {
  const value = root.values[0];
  if (!value || typeof value !== "object" || !("items" in value)) {
    throw new Error("expected a keyed list in hole 0");
  }
  return value;
}

describe("serialize", () => {
  it("never places a function in the serialized tree", () => {
    const registry = new TemplateRegistry();
    const { root } = serialize(todoList(todos), registry);

    const json = JSON.stringify(root);
    expect(json).not.toContain("function");
    expect(json).not.toContain("=>");

    // Every event hole is reduced to an opaque marker.
    const item = listValue(root).items[0];
    expect(item?.instance.values[1]).toEqual({ kind: "event" });
  });

  it("collects closures into a handler table addressed by instance and hole", () => {
    const registry = new TemplateRegistry();
    const { root, handlers } = serialize(todoList(todos), registry);

    const first = listValue(root).items[0];
    if (!first) throw new Error("expected a row");

    const handler = handlers.get(first.instance.id)?.get(1);
    expect(typeof handler).toBe("function");
    expect(handler?.({ kind: "change" }, actingSession())).toBe("a");
  });

  it("hands the acting session to a handler that never captured one", () => {
    // Written as a shared closure would have to be written: the actor arrives
    // as an argument, so this one function is correct for every viewer.
    const view = () =>
      html`<button @click=${(_: unknown, session: SessionHandle) =>
        session.params.get("user")}>Claim</button>`;

    const { handlers } = serialize(view(), new TemplateRegistry());
    const handler = handlers.get("root")?.get(0);

    expect(handler?.({ kind: "click" }, actingSession("s1", "user=dana"))).toBe(
      "dana",
    );
    expect(handler?.({ kind: "click" }, actingSession("s2", "user=ravi"))).toBe(
      "ravi",
    );
  });

  it("interns each template site once across renders", () => {
    const registry = new TemplateRegistry();

    const first = serialize(todoList(todos), registry);
    expect(registry.size).toBe(2); // the list template and the row template

    const second = serialize(todoList(todos), registry);
    expect(registry.size).toBe(2);
    expect(second.usedTemplateIds).toEqual(first.usedTemplateIds);
    expect(second.root.templateId).toBe(first.root.templateId);
  });

  it("gives every row a key-derived address that survives sibling removal", () => {
    const registry = new TemplateRegistry();

    const before = serialize(todoList(todos), registry).root;
    const after = serialize(todoList(todos.slice(1)), registry).root;

    expect(listValue(before).items.map((item) => item.instance.id)).toEqual([
      "root/h0/k:a",
      "root/h0/k:b",
    ]);
    expect(listValue(after).items.map((item) => item.instance.id)).toEqual([
      "root/h0/k:b",
    ]);
  });

  it("escapes address separators inside keys", () => {
    const registry = new TemplateRegistry();
    const { root } = serialize(
      html`<ul>
        ${keyed(
          ["a/b", "a:b"],
          (key) => key,
          (key) => html`<li>${key}</li>`,
        )}
      </ul>`,
      registry,
    );

    expect(listValue(root).items.map((item) => item.instance.id)).toEqual([
      "root/h0/k:a%2Fb",
      "root/h0/k:a%3Ab",
    ]);
  });

  it("serializes nested templates by hole address", () => {
    const registry = new TemplateRegistry();
    const { root } = serialize(
      html`<main>${html`<h1>${"Todos"}</h1>`}</main>`,
      registry,
    );

    const nested = root.values[0];
    expect(nested).toMatchObject({
      kind: "instance",
      instance: { id: "root/h0", values: ["Todos"] },
    });
  });

  it("normalizes null and undefined holes", () => {
    const registry = new TemplateRegistry();
    const { root } = serialize(
      html`<p title=${undefined}>${null}</p>`,
      registry,
    );

    expect(root.values).toEqual([null, null]);
  });

  it("rejects a plain array with guidance toward keyed()", () => {
    const registry = new TemplateRegistry();

    expect(() => serialize(html`<ul>${[1, 2, 3]}</ul>`, registry)).toThrow(
      SerializeError,
    );
    expect(() => serialize(html`<ul>${[1, 2, 3]}</ul>`, registry)).toThrow(
      /keyed\(items, keyOf, render\)/,
    );
  });

  it("rejects duplicate keys while rendering", () => {
    expect(() =>
      keyed(
        [{ id: "a" }, { id: "a" }],
        (item) => item.id,
        () => html`<li></li>`,
      ),
    ).toThrow(/duplicate key/);
  });

  it("rejects unsupported hole values", () => {
    const registry = new TemplateRegistry();

    expect(() =>
      serialize(html`<p>${{ text: "nope" }}</p>`, registry),
    ).toThrow(SerializeError);
    expect(() => serialize(html`<p>${Number.NaN}</p>`, registry)).toThrow(
      /non-finite/,
    );
  });
});

/**
 * Reusing an address string across renders must change nothing.
 *
 * Addresses are built by concatenation, which leaves a rope that the hook
 * table, the diff and the JSON encoder each flatten and hash again. Handing
 * back the same string object makes all three cheap, but only if an address is
 * a pure function of its path — so this reorders rows, grows and shrinks the
 * list, and swaps which component occupies an address, comparing a book carried
 * across every render against a fresh one each time.
 */
describe("address reuse", () => {
  type Row = { id: string; label: string };

  const Left = component(function Left(props: { row: Row }) {
    const [n] = useState(0);
    return html`<li><span>${props.row.label}</span><b>${n}</b></li>`;
  });

  const Right = component(function Right(props: { row: Row }) {
    return html`<li><em>${props.row.label}</em></li>`;
  });

  const view = (ids: string[], flipped: boolean) => {
    const rows = ids.map((id) => ({ id, label: `Item ${id}` }));
    return html`<main>
      <ul>
        ${keyed(
          rows,
          (row) => row.id,
          (row) => (flipped ? Right({ row }) : Left({ row })),
        )}
      </ul>
      <footer>${rows.length}</footer>
    </main>`;
  };

  const stages: Array<[string[], boolean]> = [
    [["a", "b", "c"], false],
    [["c", "a", "b"], false],
    [["c", "a", "b", "d", "e"], false],
    [["e"], false],
    [["e", "a"], true],
    [["a", "e"], false],
  ];

  const run = (carry: boolean): string => {
    const registry = new TemplateRegistry();
    const host = new HookHost();
    const carried = new AddressBook();

    return stages
      .map(([ids, flipped]) => {
        const { root, handlers } = serialize(
          view(ids, flipped),
          registry,
          host,
          carry ? carried : new AddressBook(),
        );
        return JSON.stringify([root, [...handlers.keys()].sort()]);
      })
      .join("\u0000");
  };

  it("produces the same tree and handler table as rebuilding every render", () => {
    expect(run(true)).toBe(run(false));
  });
});

/**
 * Source layout must not reach the browser.
 *
 * The static strings of a template are shipped verbatim, so before this the
 * indentation an author happened to use was part of the protocol: moving a
 * template out of a closure re-indented it and changed the bytes, and so did
 * running a formatter, with neither the type checker nor any test noticing.
 */
describe("template normalization", () => {
  const shipped = (result: Parameters<typeof serialize>[0]): string[] => {
    const registry = new TemplateRegistry();
    const { usedTemplateIds } = serialize(result, registry);
    const id = [...usedTemplateIds][0];
    if (id === undefined) throw new Error("nothing was interned");
    return registry.definition(id).strings;
  };

  it("ships the same bytes however the source was indented", () => {
    // The same markup as a formatter would leave it at two nesting depths,
    // which is exactly what hoisting a template out of a closure produces.
    const shallow = shipped(html`
      <ul>
        <li>${"a"}</li>
      </ul>
    `);
    const deep = shipped(html`
              <ul>
                <li>${"a"}</li>
              </ul>
    `);

    expect(deep).toEqual(shallow);
  });

  it("leaves one space where a line break separated two inline elements", () => {
    // `<span>a</span><span>b</span>` reads "ab" and the newline version reads
    // "a b", so collapsing to nothing would silently join words.
    const [before] = shipped(html`
      <span>a</span>
      <span>${"b"}</span>
    `);

    expect(before).toContain("</span> <span>");
  });

  it("keeps a newline that is inside a quoted attribute value", () => {
    const [only] = shipped(html`<p title="one
two">${"x"}</p>`);

    expect(only).toContain("one\ntwo");
  });

  it("is not fooled by an apostrophe in prose", () => {
    const [before] = shipped(html`
      <p>don't</p>
      <p>${"x"}</p>
    `);

    expect(before).toContain("</p> <p>");
  });

  it("leaves a template alone when its content is rendered literally", () => {
    const [before] = shipped(html`<textarea>
one
two</textarea
    >${"x"}`);

    expect(before).toContain("one\ntwo");
  });
});

/**
 * Focus is the one thing the server cannot mirror, so it is expressed as a
 * transition in a hole rather than as state. The wire has to carry that
 * distinction, because the diff is what decides whether the browser acts.
 */
describe("focus requests", () => {
  const holeValue = (result: Parameters<typeof serialize>[0]) =>
    serialize(result, new TemplateRegistry()).root.values[0];

  it("serializes as a focus hole rather than a handler or a primitive", () => {
    expect(holeValue(html`<div ${focusWhen(true)}></div>`)).toEqual({
      kind: "focus",
      active: true,
    });
  });

  it("omits the nonce when the caller did not need one", () => {
    // It is only there to force a repeat, so an app that never repeats should
    // not pay for the field on every frame.
    const value = holeValue(html`<div ${focusWhen(false)}></div>`);

    expect(value).toEqual({ kind: "focus", active: false });
    expect(JSON.stringify(value)).not.toContain("nonce");
  });

  it("carries the nonce when one was given", () => {
    expect(holeValue(html`<div ${focusWhen(true, 3)}></div>`)).toEqual({
      kind: "focus",
      active: true,
      nonce: 3,
    });
  });

  it("produces a patch when focus moves and none when it does not", () => {
    const registry = new TemplateRegistry();
    const view = (open: boolean) => html`<div ${focusWhen(open)}></div>`;

    const closed = serialize(view(false), registry).root;
    const opened = serialize(view(true), registry).root;

    expect(diff(closed, opened)).toEqual([
      { op: "set", instanceId: "root", hole: 0, value: { kind: "focus", active: true } },
    ]);
    expect(diff(opened, serialize(view(true), registry).root)).toEqual([]);
  });
});
