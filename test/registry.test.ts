import { html } from "lit-html";
import { describe, expect, it } from "vitest";

import { component } from "../server/component";
import { keyed } from "../server/keyed";
import { serialize, TemplateRegistry } from "../server/serialize";
import type { WireInstance, WireListValue } from "../shared/protocol";

function listValue(instance: WireInstance, hole = 0): WireListValue {
  const value = instance.values[hole];
  if (!value || typeof value !== "object" || !("items" in value)) {
    throw new Error(`expected a keyed list in hole ${hole}`);
  }
  return value;
}

const TagBox = component.tag("TagBox", (props: { label: string }) => {
  return html`<span>${props.label}</span>`;
});

describe("component.tag()", () => {
  it("leaves the function form unchanged", () => {
    expect(TagBox({ label: "x" }).name).toBe("TagBox");
    expect(TagBox.tag).toBe("TagBox");
  });

  it("is omitted by default, so a function-only component is not a tag", () => {
    const Local = component(function LocalOnly(props: { label: string }) {
      return html`<em>${props.label}</em>`;
    });
    expect(Local.tag).toBeUndefined();
    const { root } = serialize(Local({ label: "ok" }), new TemplateRegistry());
    expect(root.values[0]).toBe("ok");
  });

  it("refuses a second component bound to the same tag", () => {
    expect(() =>
      component.tag("TagBox", (props: { label: string }) => {
        return html`<i>${props.label}</i>`;
      }),
    ).toThrow(/already tagged/);
  });

  it("refuses a tag that is not a PascalCase identifier", () => {
    const fn = (props: { label: string }) => html`<span>${props.label}</span>`;
    expect(() => component.tag("tag-box", fn)).toThrow(/PascalCase/);
    expect(() => component.tag("anonymous", fn)).toThrow(/PascalCase/);
  });

  it("uses the tag as the diagnostic name when name is omitted", () => {
    const Box = component.tag("TagNamed", (props: { label: string }) => {
      return html`<b>${props.label}</b>`;
    });
    expect(Box({ label: "x" }).name).toBe("TagNamed");
  });
});

describe("component tags", () => {
  it("serializes a tag the same as a function call, including the address", () => {
    const items = [
      { id: "a", label: "First" },
      { id: "b", label: "Second" },
    ];

    const viaCall = serialize(
      html`<ul>
        ${keyed(items, (item) => item.id, (item) => TagBox({ label: item.label }))}
      </ul>`,
      new TemplateRegistry(),
    );
    const viaTag = serialize(
      html`<ul>
        ${keyed(
          items,
          (item) => item.id,
          (item) => html`<TagBox .label=${item.label}></TagBox>`,
        )}
      </ul>`,
      new TemplateRegistry(),
    );

    expect(listValue(viaTag.root).items.map((item) => item.instance.id)).toEqual([
      "root/h0/k:a",
      "root/h0/k:b",
    ]);
    expect(viaTag.root).toEqual(viaCall.root);
  });

  it("accepts a self-closing tag and a whitespace body", () => {
    const a = serialize(
      html`<p>${html`<TagBox .label=${"x"} />`}</p>`,
      new TemplateRegistry(),
    );
    const b = serialize(
      html`<p>${html`<TagBox .label=${"x"}>
      </TagBox>`}</p>`,
      new TemplateRegistry(),
    );
    const c = serialize(html`<p>${TagBox({ label: "x" })}</p>`, new TemplateRegistry());
    expect(a.root).toEqual(c.root);
    expect(b.root).toEqual(c.root);
  });

  it("throws on an unknown PascalCase tag instead of leaking it as HTML", () => {
    expect(() =>
      serialize(html`<MissingTag .label=${"x"}></MissingTag>`, new TemplateRegistry()),
    ).toThrow(/not registered/);
  });

  it("refuses children of a component tag", () => {
    expect(() =>
      serialize(
        html`<TagBox .label=${"x"}><span>nope</span></TagBox>`,
        new TemplateRegistry(),
      ),
    ).toThrow(/does not take children/);
  });

  it("refuses a static attribute", () => {
    expect(() =>
      serialize(html`<TagBox label="x"></TagBox>`, new TemplateRegistry()),
    ).toThrow(/must be a hole/);
  });
});
