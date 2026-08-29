import { html } from "lit-html";
import { describe, expect, it } from "vitest";

import { diff } from "../server/diff";
import { keyed } from "../server/keyed";
import { serialize, TemplateRegistry } from "../server/serialize";
import type { WireInstance, WireListValue } from "../shared/protocol";

type Todo = { id: string; text: string; done: boolean };

const registry = new TemplateRegistry();

function view(todos: Todo[], heading = "Todos"): WireInstance {
  return serialize(
    html`
      <main>
        <h1>${heading}</h1>
        <ul>
          ${keyed(
            todos,
            (todo) => todo.id,
            (todo) => html`
              <li>
                <input .checked=${todo.done} @change=${() => todo.id} />
                <span>${todo.text}</span>
              </li>
            `,
          )}
        </ul>
      </main>
    `,
    registry,
  ).root;
}

function rows(instance: WireInstance): WireListValue {
  const value = instance.values[1];
  if (!value || typeof value !== "object" || !("items" in value)) {
    throw new Error("expected a keyed list in hole 1");
  }
  return value;
}

const base: Todo[] = [
  { id: "a", text: "First", done: false },
  { id: "b", text: "Second", done: false },
];

describe("diff", () => {
  it("emits nothing when the tree is unchanged", () => {
    expect(diff(view(base), view(base))).toEqual([]);
  });

  it("emits one boolean hole set when a todo is toggled", () => {
    const next = base.map((todo) =>
      todo.id === "b" ? { ...todo, done: true } : todo,
    );

    expect(diff(view(base), view(next))).toEqual([
      {
        op: "set",
        instanceId: "root/h1/k:b",
        hole: 0,
        value: true,
      },
    ]);
  });

  it("emits one text hole set when a todo is renamed", () => {
    const next = base.map((todo) =>
      todo.id === "a" ? { ...todo, text: "Renamed" } : todo,
    );

    expect(diff(view(base), view(next))).toEqual([
      {
        op: "set",
        instanceId: "root/h1/k:a",
        hole: 2,
        value: "Renamed",
      },
    ]);
  });

  it("emits a single list operation when a row is removed", () => {
    const operations = diff(view(base), view(base.slice(1)));

    expect(operations).toHaveLength(1);
    const [operation] = operations;
    expect(operation).toMatchObject({ op: "list", instanceId: "root", hole: 1 });
  });

  it("keeps surviving instance addresses stable across a removal", () => {
    const before = rows(view(base));
    const after = rows(view(base.slice(1)));

    expect(before.items[1]?.instance.id).toBe("root/h1/k:b");
    expect(after.items[0]?.instance.id).toBe("root/h1/k:b");
  });

  it("emits a list operation when rows are reordered", () => {
    const operations = diff(view(base), view([...base].reverse()));

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ op: "list" });
  });

  it("combines a row change with an unrelated hole change", () => {
    const next = base.map((todo) =>
      todo.id === "a" ? { ...todo, done: true } : todo,
    );
    const operations = diff(view(base), view(next, "Inbox"));

    expect(operations).toEqual([
      { op: "set", instanceId: "root", hole: 0, value: "Inbox" },
      { op: "set", instanceId: "root/h1/k:a", hole: 0, value: true },
    ]);
  });

  it("never emits an operation for a changed closure", () => {
    // Fresh objects on every render mean fresh closures; the wire stays quiet.
    const first = view(base.map((todo) => ({ ...todo })));
    const second = view(base.map((todo) => ({ ...todo })));

    expect(diff(first, second)).toEqual([]);
  });

  it("replaces the root when the root template changes", () => {
    const previous = serialize(html`<p>${"a"}</p>`, registry).root;
    const next = serialize(html`<section>${"a"}</section>`, registry).root;

    expect(diff(previous, next)).toEqual([
      { op: "replace", instanceId: "root", instance: next },
    ]);
  });

  it("sets the whole hole when a nested template is swapped", () => {
    // One root tag site whose child hole switches between two nested sites.
    const panel = (expanded: boolean) =>
      serialize(
        html`<main>
          ${expanded
            ? html`<section>${"body"}</section>`
            : html`<p>${"body"}</p>`}
        </main>`,
        registry,
      ).root;

    const operations = diff(panel(false), panel(true));

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      op: "set",
      instanceId: "root",
      hole: 0,
    });
  });

  it("recurses into a nested template that kept its shape", () => {
    const panel = (body: string) =>
      serialize(html`<main>${html`<p>${body}</p>`}</main>`, registry).root;

    expect(diff(panel("a"), panel("b"))).toEqual([
      { op: "set", instanceId: "root/h0", hole: 0, value: "b" },
    ]);
  });

  it("carries no template strings in patch operations", () => {
    const next = base.map((todo) =>
      todo.id === "a" ? { ...todo, done: true } : todo,
    );
    const json = JSON.stringify(diff(view(base), view(next)));

    expect(json).not.toContain("<");
    expect(json).not.toContain("strings");
  });
});
