import { describe, expect, it } from "vitest";

import { discardHttpPaint } from "../client/runtime";

function mount(paint: string | undefined, children: number) {
  let count = children;
  return {
    dataset: { ...(paint ? { paint } : {}) },
    hasChildNodes: () => count > 0,
    replaceChildren: () => {
      count = 0;
    },
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
  });
});
