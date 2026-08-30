import { describe, expect, it } from "vitest";

import {
  MAX_ISLAND_ARGS,
  MAX_KEY_LENGTH,
  parseClientMessage,
  wireValueKind,
} from "../shared/protocol";

function eventOf(raw: string) {
  const parsed = parseClientMessage(raw);
  return parsed?.type === "event" ? parsed.payload : undefined;
}

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
    expect(
      eventOf(
        message({
          kind: "key",
          key: "ArrowDown",
          alt: false,
          ctrl: true,
          meta: false,
          shift: false,
          repeat: true,
        }),
      ),
    ).toEqual({
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
    expect(eventOf(message({ kind: "key", key: "Escape" }))).toEqual({
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
    expect(eventOf(message({ kind: "focus" }))).toEqual({
      kind: "focus",
    });
    expect(eventOf(message({ kind: "blur" }))).toEqual({
      kind: "blur",
    });
  });

  it("discards anything a client attaches to them", () => {
    // The server is told that focus moved, never where to. A destination would
    // be a DOM reference, which the authoritative tree has no way to name.
    expect(
      eventOf(message({ kind: "focus", target: "#password" })),
    ).toEqual({ kind: "focus" });
  });
});

describe("wireValueKind", () => {
  it("names a focus request distinctly from other holes", () => {
    expect(wireValueKind({ kind: "focus", active: true })).toBe("focus");
    expect(wireValueKind({ kind: "event" })).toBe("event");
    expect(wireValueKind("text")).toBe("primitive");
  });

  it("names an island distinctly from an event", () => {
    expect(
      wireValueKind({
        kind: "island",
        name: "ColorPicker",
        props: { value: "#fff" },
        events: ["onChange"],
      }),
    ).toBe("island");
  });
});

describe("island messages", () => {
  function island(over: Record<string, unknown> = {}): string {
    return JSON.stringify({
      type: "island",
      revision: 1,
      instanceId: "root",
      hole: 0,
      event: "onChange",
      args: ["#a78bfa"],
      ...over,
    });
  }

  it("accepts a named callback with JSON arguments", () => {
    expect(parseClientMessage(island())).toEqual({
      type: "island",
      revision: 1,
      instanceId: "root",
      hole: 0,
      event: "onChange",
      args: ["#a78bfa"],
    });
  });

  it("rejects a callback name that is not an identifier", () => {
    expect(parseClientMessage(island({ event: "on-change" }))).toBeNull();
    expect(parseClientMessage(island({ event: "" }))).toBeNull();
  });

  it("rejects a surplus of arguments", () => {
    expect(
      parseClientMessage(island({ args: Array(MAX_ISLAND_ARGS + 1).fill("x") })),
    ).toBeNull();
  });
});
