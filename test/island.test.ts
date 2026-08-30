import { html } from "lit-html";
import { describe, expect, it } from "vitest";

import { defineIsland } from "../server/island";
import { diff } from "../server/diff";
import {
  SerializeError,
  serialize,
  TemplateRegistry,
} from "../server/serialize";
import { ColorPicker } from "../islands/color-picker";
import { component } from "../server/component";
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
        ${Picker.mount({
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
      html`${ColorPicker.mount({
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
      html`${Picker.mount({
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
        html`${Picker.mount({
          value: new Date("2024-01-01") as unknown as string,
          swatches: [],
          onChange: () => undefined,
        })}`,
        registry,
      ),
    ).toThrow(SerializeError);

    expect(() =>
      serialize(
        html`${Picker.mount({
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

  it("rejects a server template passed as a prop", () => {
    expect(() =>
      serialize(
        html`${Picker.mount({
          value: html`<span>nope</span>` as unknown as string,
          swatches: [],
          onChange: () => undefined,
        })}`,
        new TemplateRegistry(),
      ),
    ).toThrow(/server render value/);
  });

  it("can sit in a component hole without changing the parent address", () => {
    const Row = component(function Row() {
      return html`<li>
        ${Picker.mount({
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
      html`${Picker.mount({
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
});
