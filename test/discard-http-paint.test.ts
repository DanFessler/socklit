import { describe, expect, it } from "vitest";

import { discardHttpPaint } from "../client/runtime";

function mount(paint: string | undefined, children: number, part: unknown = { stale: true }) {
  let count = children;
  return {
    dataset: { ...(paint ? { paint } : {}) },
    hasChildNodes: () => count > 0,
    replaceChildren: () => {
      count = 0;
    },
    _$litPart$: part,
    get size() {
      return count;
    },
  };
}

describe("discardHttpPaint", () => {
  it("clears a first-paint tree so the snapshot does not stack a second copy", () => {
    const app = mount("html", 3);
    discardHttpPaint(app);
    expect(app.size).toBe(0);
  });

  it("leaves an empty shell alone", () => {
    const app = mount("html", 0);
    discardHttpPaint(app);
    expect(app.size).toBe(0);
  });

  it("keeps the HTTP tree when the document asked to adopt", () => {
    const app = mount("html+adopt", 3);
    discardHttpPaint(app);
    expect(app.size).toBe(3);
    expect(app._$litPart$).toEqual({ stale: true });
  });

  it("drops a stale lit root part so a reconnect can render again", () => {
    const app = mount("html", 3);
    discardHttpPaint(app);
    expect(app._$litPart$).toBeUndefined();
  });
});
