/**
 * Wire contract between the authoritative server session and the browser replica.
 *
 * Templates are sent at most once per connection. Everything after the initial
 * snapshot is expressed as changes to individual template holes.
 */

export const DEFAULT_PROTOCOL_PORT = 8787;
export const PROTOCOL_VERSION = 1;
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

/** Longest island callback name. Real names are `onChange`, `onOpen`. */
export const MAX_ISLAND_EVENT_NAME = 64;

/** Most arguments one island callback may send. */
export const MAX_ISLAND_ARGS = 8;

/** Deepest object an island may put in props or callback arguments. */
export const MAX_JSON_DEPTH = 8;

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
 * The only values that may cross into an island: JSON, nothing with a
 * prototype, and nothing that is a server render value.
 */
export type WireJson =
  | string
  | number
  | boolean
  | null
  | WireJson[]
  | { [key: string]: WireJson };

/**
 * A hole the server does not render. The client mounts a registered React
 * component here, feeds it `props`, and turns each name in `events` into a
 * stub that sends `{ type: "island" }` back.
 */
export type WireIslandValue = {
  kind: "island";
  name: string;
  props: { [key: string]: WireJson };
  events: string[];
  /**
   * A server-rendered region the island hosts. The replica paints it into
   * a `<socklit-slot>` the React tree placed. Omitted when the island is
   * terminal — a date picker, not a dialog.
   */
  slot?: WireInstance;
};

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
  | WireFocusValue
  | WireIslandValue;

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

/**
 * Cookie and query name for the opaque session token.
 * `identify` reads the cookie first. The query string is the `?ws=` fallback.
 * It is not a user id.
 */
export const SESSION_COOKIE = "socklit_session";
export const SESSION_QUERY = SESSION_COOKIE;

/**
 * Per-tab id the replica sends on connect. Survives refresh of this tab
 * (`sessionStorage`). A new tab mints a new one. `useDurable` keys on it
 * so a reconnect is not the other window's draft.
 */
export const TAB_QUERY = "socklit_tab";

export type ServerMessage =
  | { type: "templates"; templates: WireTemplate[] }
  | {
      type: "snapshot";
      revision: number;
      root: WireInstance;
      protocol: number;
    }
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
    }
  | {
      type: "credential";
      /** Opaque token for `identify`. `null` signs this tab out. */
      token: string | null;
    }
  | {
      type: "island-result";
      call: number;
      result: WireJson | null;
      error?: string;
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

export type EventMessage = {
  type: "event";
  revision: number;
  instanceId: string;
  hole: number;
  payload: EventPayload;
};

/**
 * An island called one of its stubs. `args` is whatever the React component
 * passed; the server handler is a closure that never left the process.
 */
export type IslandMessage = {
  type: "island";
  revision: number;
  instanceId: string;
  hole: number;
  event: string;
  args: WireJson[];
  /** Positive int; the replica waits for `island-result` with this id. */
  call?: number;
};

/**
 * Re-run `identify` on this connection after `grant` / `revoke`.
 *
 * Not an addressed event: there is no instance or hole. The replica keeps
 * the socket; `useState` and islands survive.
 */
export type ReidentifyMessage = {
  type: "reidentify";
  token: string | null;
};

export type ClientMessage = EventMessage | IslandMessage | ReidentifyMessage;

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

export function isWireIslandValue(value: WireValue): value is WireIslandValue {
  return isTaggedValue(value) && value.kind === "island";
}

function isTaggedValue(
  value: WireValue,
): value is
  | WireEventValue
  | WireInstanceValue
  | WireListValue
  | WireFocusValue
  | WireIslandValue {
  return typeof value === "object" && value !== null;
}

export type WireValueKind =
  | "primitive"
  | "event"
  | "instance"
  | "list"
  | "focus"
  | "island";

export function wireValueKind(value: WireValue): WireValueKind {
  if (isWireEventValue(value)) return "event";
  if (isWireInstanceValue(value)) return "instance";
  if (isWireListValue(value)) return "list";
  if (isWireFocusValue(value)) return "focus";
  if (isWireIslandValue(value)) return "island";
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

  if (!isRecord(parsed)) return null;

  if (parsed["type"] === "reidentify") {
    return parseReidentifyMessage(parsed);
  }

  const address = parseAddress(parsed);
  if (!address) return null;

  if (parsed["type"] === "island") {
    return parseIslandMessage(parsed, address);
  }
  if (parsed["type"] !== "event") return null;

  const payload = parseEventPayload(parsed["payload"]);
  if (payload === null) return null;

  return { type: "event", ...address, payload };
}

function parseAddress(
  parsed: Record<string, unknown>,
): { revision: number; instanceId: string; hole: number } | null {
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

  return { revision, instanceId, hole };
}

function parseIslandMessage(
  parsed: Record<string, unknown>,
  address: { revision: number; instanceId: string; hole: number },
): IslandMessage | null {
  const event = parsed["event"];
  if (
    typeof event !== "string" ||
    event.length === 0 ||
    event.length > MAX_ISLAND_EVENT_NAME ||
    !/^[A-Za-z][A-Za-z0-9]*$/.test(event)
  ) {
    return null;
  }

  const args = parsed["args"];
  if (!Array.isArray(args) || args.length > MAX_ISLAND_ARGS) return null;

  const sanitized: WireJson[] = [];
  for (const arg of args) {
    const json = parseWireJson(arg, 0);
    if (json === undefined) return null;
    sanitized.push(json);
  }

  const call = parsed["call"];
  if (call !== undefined) {
    if (!isIndex(call) || call < 1) return null;
    return { type: "island", ...address, event, args: sanitized, call };
  }

  return { type: "island", ...address, event, args: sanitized };
}

function parseReidentifyMessage(
  parsed: Record<string, unknown>,
): ReidentifyMessage | null {
  const token = parsed["token"];
  if (token !== null && typeof token !== "string") return null;
  return { type: "reidentify", token };
}

/**
 * Accepts JSON values and nothing else. `undefined` means rejected: a nested
 * function, a host object, or a tree deeper than `MAX_JSON_DEPTH`.
 */
export function parseWireJson(value: unknown, depth: number): WireJson | undefined {
  if (depth > MAX_JSON_DEPTH) return undefined;
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    const items: WireJson[] = [];
    for (const item of value) {
      const json = parseWireJson(item, depth + 1);
      if (json === undefined) return undefined;
      items.push(json);
    }
    return items;
  }
  if (typeof value !== "object") return undefined;

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return undefined;

  const record: { [key: string]: WireJson } = {};
  for (const [key, nested] of Object.entries(value)) {
    const json = parseWireJson(nested, depth + 1);
    if (json === undefined) return undefined;
    record[key] = json;
  }
  return record;
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
