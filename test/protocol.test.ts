import { describe, expect, it } from "vitest";

import {
  MAX_KEY_LENGTH,
  parseClientMessage,
  wireValueKind,
} from "../shared/protocol";

/** Wraps a payload in the addressing every inbound message carries. */
function message(payload: unknown): string {
  return JSON.stringify({
    type: "event",
    revision: 1,
    instanceId: "root",
    hole: 0,
    payload,
  });
}

describe("key payloads", () => {
  it("accepts a named key with its modifiers", () => {
    const parsed = parseClientMessage(
      message({
        kind: "key",
        key: "ArrowDown",
        alt: false,
        ctrl: true,
        meta: false,
        shift: false,
        repeat: true,
      }),
    );

    expect(parsed?.payload).toEqual({
      kind: "key",
      key: "ArrowDown",
      alt: false,
      ctrl: true,
      meta: false,
      shift: false,
      repeat: true,
    });
  });

  it("treats absent modifiers as unpressed", () => {
    const parsed = parseClientMessage(message({ kind: "key", key: "Escape" }));

    expect(parsed?.payload).toEqual({
      kind: "key",
      key: "Escape",
      alt: false,
      ctrl: false,
      meta: false,
      shift: false,
      repeat: false,
    });
  });

  it("rejects a modifier that is not a boolean", () => {
    // Coercing would let a handler branch on a truthy string it never expected.
    expect(
      parseClientMessage(message({ kind: "key", key: "a", shift: "yes" })),
    ).toBeNull();
  });

  it("rejects a missing, empty, or oversized key", () => {
    expect(parseClientMessage(message({ kind: "key" }))).toBeNull();
    expect(parseClientMessage(message({ kind: "key", key: "" }))).toBeNull();
    expect(
      parseClientMessage(
        message({ kind: "key", key: "x".repeat(MAX_KEY_LENGTH + 1) }),
      ),
    ).toBeNull();
  });
});

describe("focus payloads", () => {
  it("accepts focus and blur, and carries nothing else", () => {
    expect(parseClientMessage(message({ kind: "focus" }))?.payload).toEqual({
      kind: "focus",
    });
    expect(parseClientMessage(message({ kind: "blur" }))?.payload).toEqual({
      kind: "blur",
    });
  });

  it("discards anything a client attaches to them", () => {
    // The server is told that focus moved, never where to. A destination would
    // be a DOM reference, which the authoritative tree has no way to name.
    const parsed = parseClientMessage(
      message({ kind: "focus", target: "#password" }),
    );

    expect(parsed?.payload).toEqual({ kind: "focus" });
  });
});

describe("wireValueKind", () => {
  it("names a focus request distinctly from other holes", () => {
    expect(wireValueKind({ kind: "focus", active: true })).toBe("focus");
    expect(wireValueKind({ kind: "event" })).toBe("event");
    expect(wireValueKind("text")).toBe("primitive");
  });
});
