/**
 * Wire contract between the authoritative server session and the browser replica.
 *
 * Templates are sent at most once per connection. Everything after the initial
 * snapshot is expressed as changes to individual template holes.
 */

export const DEFAULT_PROTOCOL_PORT = 8787;
export const MAX_MESSAGE_BYTES = 16 * 1024;
export const MAX_HOLE_INDEX = 255;
export const MAX_SUBMIT_FIELDS = 64;
export const MAX_FIELD_LENGTH = 4096;
export const MAX_INSTANCE_ID_LENGTH = 512;

/**
 * Longest `KeyboardEvent.key` accepted.
 *
 * Real values are either one character or a named key like `ArrowDown`; the
 * longest in the UI Events spec is well inside this. The bound exists because
 * the field is attacker-controlled, not because long keys are meaningful.
 */
export const MAX_KEY_LENGTH = 32;

/** Static parts of one `html` tag site. Sent once, then referenced by id. */
export type WireTemplate = {
  id: number;
  strings: string[];
};

/** A hole occupied by a server closure. The closure itself never leaves the server. */
export type WireEventValue = { kind: "event" };
export type WireInstanceValue = { kind: "instance"; instance: WireInstance };
export type WireListValue = { kind: "list"; items: WireListItem[] };
export type WireListItem = { key: string; instance: WireInstance };
export type WirePrimitive = string | number | boolean | null;

/**
 * A request that the element carrying this hole take focus.
 *
 * Focus is a property of the browser rather than of the tree, so the server
 * cannot hold it and cannot read it back. What it can do is say *when* focus
 * should move, which is what this is: the client focuses the element on the
 * render where `active` becomes true and does nothing on the renders either
 * side of it. `nonce` exists for the case where focus has to move to the same
 * element twice without becoming inactive in between — changing it re-fires.
 */
export type WireFocusValue = {
  kind: "focus";
  active: boolean;
  nonce?: number;
};

export type WireValue =
  | WirePrimitive
  | WireEventValue
  | WireInstanceValue
  | WireListValue
  | WireFocusValue;

/** One rendered occurrence of a template, addressed by a structural id. */
export type WireInstance = {
  id: string;
  templateId: number;
  values: WireValue[];
};

export type PatchOperation =
  | { op: "set"; instanceId: string; hole: number; value: WireValue }
  | { op: "replace"; instanceId: string; instance: WireInstance }
  | { op: "list"; instanceId: string; hole: number; value: WireListValue };

export type ServerErrorCode =
  | "stale_event"
  | "bad_event"
  | "handler_failed"
  | "render_failed";

export type ServerMessage =
  | { type: "templates"; templates: WireTemplate[] }
  | { type: "snapshot"; revision: number; root: WireInstance }
  | {
      type: "update";
      revision: number;
      templates: WireTemplate[];
      operations: PatchOperation[];
    }
  | {
      type: "error";
      code: ServerErrorCode;
      message: string;
      recoverable: boolean;
    };

export type ClickPayload = { kind: "click" };
export type ChangePayload = {
  kind: "change";
  value?: string;
  checked?: boolean;
};
export type SubmitPayload = { kind: "submit"; fields: Record<string, string> };

/**
 * One key press, named rather than coded.
 *
 * `key` is `KeyboardEvent.key`, so it is the logical key the user pressed
 * ("Escape", "ArrowDown", "a") rather than a physical position. That is the
 * right choice for the two things this unblocks — dismissal and list
 * navigation — and the wrong one for games, which are not on the table.
 *
 * Modifiers travel with it because "Escape" and "Shift+Tab" are different
 * intents and a handler that cannot tell them apart cannot implement either.
 */
export type KeyPayload = {
  kind: "key";
  key: string;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  /** True while the key is being auto-repeated by the OS. */
  repeat: boolean;
};

/**
 * Focus entered or left the element carrying this handler.
 *
 * Deliberately carries nothing else. The server learns that focus moved, not
 * where it moved to, because the destination may be outside the tree entirely
 * and reporting it would leak the browser's DOM into an authoritative model
 * that has no representation for it.
 */
export type FocusPayload = { kind: "focus" } | { kind: "blur" };

/** Sanitized, transport-safe description of a browser interaction. */
export type EventPayload =
  | ClickPayload
  | ChangePayload
  | SubmitPayload
  | KeyPayload
  | FocusPayload;

export type ClientMessage = {
  type: "event";
  revision: number;
  instanceId: string;
  hole: number;
  payload: EventPayload;
};

export function isWireEventValue(value: WireValue): value is WireEventValue {
  return isTaggedValue(value) && value.kind === "event";
}

export function isWireInstanceValue(
  value: WireValue,
): value is WireInstanceValue {
  return isTaggedValue(value) && value.kind === "instance";
}

export function isWireListValue(value: WireValue): value is WireListValue {
  return isTaggedValue(value) && value.kind === "list";
}

export function isWireFocusValue(value: WireValue): value is WireFocusValue {
  return isTaggedValue(value) && value.kind === "focus";
}

function isTaggedValue(
  value: WireValue,
): value is
  | WireEventValue
  | WireInstanceValue
  | WireListValue
  | WireFocusValue {
  return typeof value === "object" && value !== null;
}

export type WireValueKind =
  | "primitive"
  | "event"
  | "instance"
  | "list"
  | "focus";

export function wireValueKind(value: WireValue): WireValueKind {
  if (isWireEventValue(value)) return "event";
  if (isWireInstanceValue(value)) return "instance";
  if (isWireListValue(value)) return "list";
  if (isWireFocusValue(value)) return "focus";
  return "primitive";
}

const INSTANCE_ID_PATTERN = /^[A-Za-z0-9_\-%:./]+$/;

/**
 * Validates an inbound client message. Anything unexpected is rejected rather
 * than coerced: every event is an RPC into a live server session, so the shape,
 * the addressing and the payload are all treated as untrusted.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > MAX_MESSAGE_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || parsed["type"] !== "event") return null;

  const revision = parsed["revision"];
  const instanceId = parsed["instanceId"];
  const hole = parsed["hole"];

  if (!isIndex(revision)) return null;
  if (
    typeof instanceId !== "string" ||
    instanceId.length === 0 ||
    instanceId.length > MAX_INSTANCE_ID_LENGTH ||
    !INSTANCE_ID_PATTERN.test(instanceId)
  ) {
    return null;
  }
  if (!isIndex(hole) || hole > MAX_HOLE_INDEX) return null;

  const payload = parseEventPayload(parsed["payload"]);
  if (payload === null) return null;

  return { type: "event", revision, instanceId, hole, payload };
}

function parseEventPayload(value: unknown): EventPayload | null {
  if (!isRecord(value)) return null;

  switch (value["kind"]) {
    case "click":
      return { kind: "click" };

    case "change": {
      const raw = value["value"];
      const checked = value["checked"];
      if (raw !== undefined && typeof raw !== "string") return null;
      if (checked !== undefined && typeof checked !== "boolean") return null;
      if (typeof raw === "string" && raw.length > MAX_FIELD_LENGTH) return null;

      const payload: ChangePayload = { kind: "change" };
      if (typeof raw === "string") payload.value = raw;
      if (typeof checked === "boolean") payload.checked = checked;
      return payload;
    }

    case "key": {
      const key = value["key"];
      if (
        typeof key !== "string" ||
        key.length === 0 ||
        key.length > MAX_KEY_LENGTH
      ) {
        return null;
      }

      // Absent modifiers are false rather than a rejection: a client that omits
      // them is describing a plain key press, which is the common case.
      const alt = optionalFlag(value["alt"]);
      const ctrl = optionalFlag(value["ctrl"]);
      const meta = optionalFlag(value["meta"]);
      const shift = optionalFlag(value["shift"]);
      const repeat = optionalFlag(value["repeat"]);
      if (
        alt === null ||
        ctrl === null ||
        meta === null ||
        shift === null ||
        repeat === null
      ) {
        return null;
      }

      return { kind: "key", key, alt, ctrl, meta, shift, repeat };
    }

    case "focus":
      return { kind: "focus" };

    case "blur":
      return { kind: "blur" };

    case "submit": {
      const fields = value["fields"];
      if (!isRecord(fields)) return null;

      const names = Object.keys(fields);
      if (names.length > MAX_SUBMIT_FIELDS) return null;

      const sanitized: Record<string, string> = {};
      for (const name of names) {
        const field = fields[name];
        if (typeof field !== "string" || field.length > MAX_FIELD_LENGTH) {
          return null;
        }
        sanitized[name] = field;
      }
      return { kind: "submit", fields: sanitized };
    }

    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** `false` when absent, the value when boolean, `null` when it is neither. */
function optionalFlag(value: unknown): boolean | null {
  if (value === undefined) return false;
  return typeof value === "boolean" ? value : null;
}
