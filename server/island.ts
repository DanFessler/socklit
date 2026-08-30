import { MAX_JSON_DEPTH, type WireJson } from "../shared/protocol";
import {
  isComponentMarker,
  type RenderOutput,
} from "./component";
import { isFocusRequest } from "./focus";
import { isKeyedList } from "./keyed";
import type { SessionHandle } from "./session";

/**
 * The server half of an island: a named contract, and two reserved
 * elements — `<mount>` and `<slot>` — that compile down to `mount()` /
 * `slot()` markers.
 *
 * That is the authoring tell. A server component is called as a function,
 * or written as a tag after `component.tag("Name", fn)`. An island
 * is a `<mount>`. A hosted region is a `<slot>`, not a child. RSC's
 * problem is that both sides are the same JSX.
 *
 * The React implementation lives in `*.island.tsx` and is imported only by
 * the client registry. This file never imports `react`.
 */

const ISLAND = Symbol("socklit.island");
const HANDLE = Symbol("socklit.islandHandle");
const WELL = Symbol("socklit.slot");

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;
const MAX_NAME = 64;

/**
 * Callbacks as the island sends them (JSON arguments only).
 * `mount()` types the server closure as these args plus `session`.
 */
export type IslandEvents = {
  readonly [name: string]: (...args: never[]) => unknown;
};

type IslandServerFn<F extends (...args: never[]) => unknown> = F extends (
  ...args: infer A
) => infer R
  ? (...args: [...A, SessionHandle]) => R
  : never;

/** What you write next to `<mount>`: island args, then the acting session. */
export type IslandServerEvents<E extends IslandEvents> = {
  readonly [K in keyof E]: IslandServerFn<E[K]>;
};

export type IslandMount = {
  readonly [ISLAND]: true;
  readonly name: string;
  readonly props: Record<string, unknown>;
  /** Server tree the replica keeps painting; not a React child. */
  readonly slotted?: RenderOutput;
};

export type IslandHandle<
  P extends Record<string, WireJson>,
  E extends IslandEvents,
> = {
  readonly [HANDLE]: true;
  readonly name: string;
};

export type SlotWell = {
  readonly [WELL]: true;
  readonly content: RenderOutput;
};

export class IslandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IslandError";
  }
}

/**
 * Declares a client widget the server may place, and nothing else.
 *
 * `P` is JSON. `E` is callbacks. Both are enforced at the `mount()` call
 * by TypeScript, and again at serialize time for anything types missed —
 * a `Date`, a class instance, a nested function, a template.
 */
export function defineIsland<
  P extends Record<string, WireJson>,
  E extends IslandEvents = Record<never, never>,
>(name: string): IslandHandle<P, E> {
  if (!NAME_PATTERN.test(name) || name.length > MAX_NAME) {
    throw new IslandError(
      `island name "${name}" must be an identifier of at most ${MAX_NAME} characters`,
    );
  }

  return { [HANDLE]: true, name };
}

/**
 * Places an island in a hole. The handle is the contract; the props are
 * JSON plus top-level callbacks. A hosted server tree is a third
 * argument, and it must be `slot(...)`, not a bare template.
 */
export function mount<
  P extends Record<string, WireJson>,
  E extends IslandEvents,
>(
  island: IslandHandle<P, E>,
  props: P & IslandServerEvents<E>,
  well?: SlotWell,
): IslandMount {
  if (!isIslandHandle(island)) {
    throw new IslandError("mount() expected an island from defineIsland()");
  }

  return {
    [ISLAND]: true,
    name: island.name,
    props,
    ...(well === undefined ? {} : { slotted: well.content }),
  };
}

/**
 * Marks a server tree as a well for `mount()`, not as a child and not as
 * a prop. The island cannot read it. The replica paints it.
 */
export function slot(content: RenderOutput): SlotWell {
  return { [WELL]: true, content };
}

export function isIslandMount(value: unknown): value is IslandMount {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<IslandMount>)[ISLAND] === true
  );
}

export function isIslandHandle(
  value: unknown,
): value is IslandHandle<Record<string, WireJson>, IslandEvents> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { [HANDLE]?: unknown })[HANDLE] === true
  );
}

export function isSlotWell(value: unknown): value is SlotWell {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { [WELL]?: unknown })[WELL] === true
  );
}

export type IslandPropResult =
  | { ok: true; value: WireJson }
  | { ok: false; error: string };

/**
 * JSON, or a reason it is not. Used by serialize so the error names the
 * hole and the prop, not just "unsupported object".
 */
export function islandPropJson(
  value: unknown,
  path: string,
  depth = 0,
): IslandPropResult {
  if (depth > MAX_JSON_DEPTH) {
    return fail(`${path} is nested deeper than ${MAX_JSON_DEPTH} levels`);
  }
  if (typeof value === "function") {
    return fail(
      `${path} is a nested function. Island callbacks must be top-level props, not buried in an object`,
    );
  }
  if (isIslandMount(value) || isIslandHandle(value)) {
    return fail(
      `${path} is another island. Islands cannot nest; compose them in the server template instead`,
    );
  }
  if (isSlotWell(value)) {
    return fail(
      `${path} is a slot(). Pass it as mount(Island, props, slot(...)), not as a prop`,
    );
  }
  if (isServerRenderValue(value)) {
    return fail(
      `${path} is a server render value, which cannot cross into an island. Props must be JSON`,
    );
  }
  if (value === undefined) {
    return fail(`${path} is undefined. Omit the prop, or pass null`);
  }
  if (value === null) return ok(null);
  if (typeof value === "string" || typeof value === "boolean") return ok(value);
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? ok(value)
      : fail(`${path} is a non-finite number, which cannot cross into an island`);
  }
  if (Array.isArray(value)) {
    const items: WireJson[] = [];
    for (const [index, item] of value.entries()) {
      const nested = islandPropJson(item, `${path}[${index}]`, depth + 1);
      if (!nested.ok) return nested;
      items.push(nested.value);
    }
    return ok(items);
  }
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      const kind = value.constructor?.name || "object";
      return fail(
        `${path} is a ${kind}, which cannot cross into an island. Props must be JSON`,
      );
    }

    const record: { [key: string]: WireJson } = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      const nested = islandPropJson(nestedValue, `${path}.${key}`, depth + 1);
      if (!nested.ok) return nested;
      record[key] = nested.value;
    }
    return ok(record);
  }

  return fail(
    `${path} is a ${typeof value}, which cannot cross into an island. Props must be JSON`,
  );
}

function isServerRenderValue(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (isComponentMarker(value) || isKeyedList(value) || isFocusRequest(value)) {
    return true;
  }
  const record = value as Record<PropertyKey, unknown>;
  return "_$litType$" in record || "_$litDirective$" in record;
}

function ok(value: WireJson): IslandPropResult {
  return { ok: true, value };
}

function fail(error: string): IslandPropResult {
  return { ok: false, error };
}
