import { html } from "lit-html";
import { describe, expect, it } from "vitest";

import { defineIsland, IslandError, mount, slot } from "../server/island";
import { diff } from "../server/diff";
import {
  SerializeError,
  serialize,
  TemplateRegistry,
} from "../server/serialize";
import { ColorPicker } from "../islands/color-picker";
import { component } from "../server/component";
import { keyed } from "../server/keyed";
import { countNodes } from "../server/metrics";
import type { SessionHandle } from "../server/session";
import type { WireIslandValue } from "../shared/protocol";

const Picker = defineIsland<
  { value: string; swatches: string[] },
  { onChange: (value: string) => void }
>("Picker");

function actingSession(id = "s1"): SessionHandle {
  return { id, params: new URLSearchParams() };
}

function islandHole(value: unknown): WireIslandValue {
  if (
    typeof value !== "object" ||
    value === null ||
    !("kind" in value) ||
    value.kind !== "island"
  ) {
    throw new Error("expected an island hole");
  }
  return value as WireIslandValue;
}

describe("defineIsland", () => {
  it("refuses a name that is not an identifier", () => {
    expect(() => defineIsland("color-picker")).toThrow(/identifier/);
    expect(() => defineIsland("")).toThrow(/identifier/);
  });
});

describe("serialize islands", () => {
  it("strips callbacks and keeps JSON props", () => {
    const registry = new TemplateRegistry();
    const { root, handlers, islandHandlers } = serialize(
      html`<div>
        ${mount(Picker, {
          value: "#a78bfa",
          swatches: ["#a78bfa", "#7dd3fc"],
          onChange: (color) => color,
        })}
      </div>`,
      registry,
    );

    expect(handlers.size).toBe(0);
    expect(islandHole(root.values[0])).toEqual({
      kind: "island",
      name: "Picker",
      props: { value: "#a78bfa", swatches: ["#a78bfa", "#7dd3fc"] },
      events: ["onChange"],
    });

    const handler = islandHandlers.get("root")?.get(0)?.get("onChange");
    expect(handler?.("#fb7185")).toBe("#fb7185");
  });

  it("never places a function in the serialized tree", () => {
    const { root } = serialize(
      html`${mount(ColorPicker, {
        value: "#fff",
        swatches: ["#fff"],
        onChange: () => "nope",
      })}`,
      new TemplateRegistry(),
    );

    const json = JSON.stringify(root);
    expect(json).not.toContain("function");
    expect(json).not.toContain("=>");
    expect(json).not.toContain("nope");
    expect(islandHole(root.values[0]).events).toEqual(["onChange"]);
  });

  it("invokes the closure with the arguments the island sent", () => {
    const seen: string[] = [];
    const { islandHandlers } = serialize(
      html`${mount(Picker, {
        value: "x",
        swatches: ["x"],
        onChange: (color) => {
          seen.push(color);
        },
      })}`,
      new TemplateRegistry(),
    );

    islandHandlers.get("root")?.get(0)?.get("onChange")?.(
      "red",
      actingSession("dana"),
    );
    expect(seen).toEqual(["red"]);
  });

  it("rejects a Date, a class instance, and a nested function", () => {
    const registry = new TemplateRegistry();

    expect(() =>
      serialize(
        html`${mount(Picker, {
          value: new Date("2024-01-01") as unknown as string,
          swatches: [],
          onChange: () => undefined,
        })}`,
        registry,
      ),
    ).toThrow(SerializeError);

    expect(() =>
      serialize(
        html`${mount(Picker, {
          value: "x",
          swatches: [],
          onChange: () => undefined,
          // buried callback — the event table is flat on purpose
          meta: { onClick: () => undefined },
        } as never)}`,
        registry,
      ),
    ).toThrow(/nested function/);
  });

  it("refuses slot() in a hole without mount()", () => {
    expect(() =>
      serialize(html`${slot(html`<span>x</span>`)}`, new TemplateRegistry()),
    ).toThrow(/without mount/);
  });

  it("refuses slot() passed as a prop", () => {
    expect(() =>
      serialize(
        html`${mount(Picker, {
          value: slot(html`<span>x</span>`) as unknown as string,
          swatches: [],
          onChange: () => undefined,
        })}`,
        new TemplateRegistry(),
      ),
    ).toThrow(/slot\(\)/);
  });

  it("rejects a server template passed as a prop", () => {
    expect(() =>
      serialize(
        html`${mount(Picker, {
          value: html`<span>nope</span>` as unknown as string,
          swatches: [],
          onChange: () => undefined,
        })}`,
        new TemplateRegistry(),
      ),
    ).toThrow(/server render value/);
  });

  it("serializes slot() as a hosted instance, not a prop", () => {
    const Panel = defineIsland<{ label: string }>("Panel");
    const { root, handlers } = serialize(
      html`${mount(
        Panel,
        { label: "Assign" },
        slot(html`
        <button @click=${() => "dana"}>Dana</button>
      `),
      )}`,
      new TemplateRegistry(),
    );

    const island = islandHole(root.values[0]);
    expect(island.props).toEqual({ label: "Assign" });
    expect(island.slot?.id).toBe("root/h0/s");
    expect(JSON.stringify(island.props)).not.toContain("Dana");
    expect(
      handlers.get("root/h0/s")?.get(0)?.(
        { kind: "click" },
        actingSession(),
      ),
    ).toBe("dana");
  });

  it("can sit in a component hole without changing the parent address", () => {
    const Row = component(function Row() {
      return html`<li>
        ${mount(Picker, {
          value: "a",
          swatches: ["a"],
          onChange: () => undefined,
        })}
      </li>`;
    });

    const { root } = serialize(Row({}), new TemplateRegistry());
    expect(root.id).toBe("root");
    expect(islandHole(root.values[0]).name).toBe("Picker");
  });
});

describe("diff islands", () => {
  const view = (value: string) =>
    serialize(
      html`${mount(Picker, {
        value,
        swatches: ["a", "b"],
        onChange: () => undefined,
      })}`,
      new TemplateRegistry(),
    ).root;

  it("emits one set when props change and nothing when they do not", () => {
    expect(diff(view("a"), view("b"))).toEqual([
      {
        op: "set",
        instanceId: "root",
        hole: 0,
        value: {
          kind: "island",
          name: "Picker",
          props: { value: "b", swatches: ["a", "b"] },
          events: ["onChange"],
        },
      },
    ]);
    expect(diff(view("a"), view("a"))).toEqual([]);
  });

  const Panel = defineIsland<{ label: string }>("Panel");
  const slotted = (label: string, names: string[]) =>
    serialize(
      html`${mount(
        Panel,
        { label },
        slot(html`
        ${keyed(names, (name) => name, (name) => html`<span>${name}</span>`)}
      `),
      )}`,
      new TemplateRegistry(),
    ).root;

  it("patches the slot without replacing the island when only the hosted tree changes", () => {
    const operations = diff(slotted("Assign", ["Dana"]), slotted("Assign", ["Omar"]));
    expect(operations.some((operation) => operation.instanceId === "root")).toBe(
      false,
    );
    expect(operations.length).toBeGreaterThan(0);
    expect(operations.every((operation) => operation.instanceId === "root/h0/s")).toBe(
      true,
    );
  });

  it("omits the slot from a shell-only island set", () => {
    expect(diff(slotted("Assign", ["Dana"]), slotted("Owner", ["Dana"]))).toEqual([
      {
        op: "set",
        instanceId: "root",
        hole: 0,
        value: {
          kind: "island",
          name: "Panel",
          props: { label: "Owner" },
          events: [],
        },
      },
    ]);
  });

  it("counts hosted slot nodes", () => {
    const bare = serialize(
      html`${mount(Panel, { label: "A" })}`,
      new TemplateRegistry(),
    ).root;
    const hosted = slotted("A", ["Dana"]);
    expect(countNodes(hosted)).toBeGreaterThan(countNodes(bare));
  });
});

describe("mount and slot as template elements", () => {
  const view = (value: string) =>
    html`<li>
      <mount
        .Island=${Picker}
        .value=${value}
        .swatches=${["a", "b"]}
        .onChange=${() => undefined}
      ></mount>
    </li>`;

  it("compiles <mount> into an island hole and keeps the surrounding markup", () => {
    const { root } = serialize(view("high"), new TemplateRegistry());
    expect(islandHole(root.values[0])).toEqual({
      kind: "island",
      name: "Picker",
      props: { value: "high", swatches: ["a", "b"] },
      events: ["onChange"],
    });
    expect(JSON.stringify(root)).not.toContain("<mount");
  });

  it("interns the rewritten strings, not the authoring strings", () => {
    const registry = new TemplateRegistry();
    const first = serialize(view("a"), registry);
    const second = serialize(view("b"), registry);
    expect(second.root.templateId).toBe(first.root.templateId);
    expect(registry.definition(first.root.templateId).strings.join("")).not.toContain(
      "<mount",
    );
  });

  it("hosts <slot> as a server tree, not as a prop", () => {
    const Panel = defineIsland<{ label: string }>("Panel");
    const { root, handlers } = serialize(
      html`<mount .Island=${Panel} .label=${"Assign"}>
        <slot>
          <button @click=${() => "dana"}>Dana</button>
        </slot>
      </mount>`,
      new TemplateRegistry(),
    );

    const island = islandHole(root.values[0]);
    expect(island.props).toEqual({ label: "Assign" });
    expect(island.slot).toBeDefined();
    expect(JSON.stringify(island.props)).not.toContain("Dana");
    expect(
      handlers.get(island.slot?.id ?? "")?.get(0)?.(
        { kind: "click" },
        actingSession(),
      ),
    ).toBe("dana");
  });

  it("refuses children of <mount> that are not a <slot>", () => {
    expect(() =>
      serialize(
        html`<mount .Island=${Picker} .value=${"a"} .swatches=${[]} .onChange=${() => {}}>
          <button>nope</button>
        </mount>`,
        new TemplateRegistry(),
      ),
    ).toThrow(IslandError);
  });

  it("refuses a bare <slot>", () => {
    expect(() =>
      serialize(html`<slot>${"x"}</slot>`, new TemplateRegistry()),
    ).toThrow(/<slot>/);
  });
});
