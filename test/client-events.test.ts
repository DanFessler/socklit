import { describe, expect, it } from "vitest";

import { describeEvent } from "../client/runtime";

/**
 * A stand-in for a DOM event.
 *
 * These tests run without a DOM on purpose: what is being checked is which
 * branch a given event takes, and that is decided by the event's type and
 * properties rather than by anything a browser provides.
 */
function fakeEvent(
  type: string,
  properties: Record<string, unknown> = {},
): Event {
  return { type, currentTarget: null, ...properties } as unknown as Event;
}

describe("describeEvent", () => {
  it("describes a key press by its logical key and modifiers", () => {
    const payload = describeEvent(
      fakeEvent("keydown", {
        key: "ArrowDown",
        altKey: false,
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        repeat: false,
      }),
    );

    expect(payload).toEqual({
      kind: "key",
      key: "ArrowDown",
      alt: false,
      ctrl: false,
      meta: true,
      shift: false,
      repeat: false,
    });
  });

  it("does not describe a key press as an edit", () => {
    // The failure this prevents: `change` is the fallthrough, so a keydown on
    // an input used to be reported as a text change carrying the value from
    // *before* the key was applied — an off-by-one-character edit, sent as
    // though the user had typed it.
    const payload = describeEvent(
      fakeEvent("keydown", { key: "Escape", value: "stale" }),
    );

    expect(payload.kind).toBe("key");
  });

  it("reports that focus moved without saying where", () => {
    expect(describeEvent(fakeEvent("focus"))).toEqual({ kind: "focus" });
    expect(describeEvent(fakeEvent("blur"))).toEqual({ kind: "blur" });
    expect(describeEvent(fakeEvent("focusin"))).toEqual({ kind: "focus" });
    expect(describeEvent(fakeEvent("focusout"))).toEqual({ kind: "blur" });
  });

  it("still reduces a click to the smallest possible payload", () => {
    expect(describeEvent(fakeEvent("click"))).toEqual({ kind: "click" });
  });

  // The `change` fallthrough is not covered here: it reads the target through
  // `instanceof HTMLInputElement`, which needs a DOM these tests do not have.
});
