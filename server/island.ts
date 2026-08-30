import { MAX_JSON_DEPTH, type WireJson } from "../shared/protocol";
import { isComponentMarker } from "./component";
import { isFocusRequest } from "./focus";
import { isKeyedList } from "./keyed";

/**
 * The server half of an island: a named contract and a `.mount()` that
 * occupies a template hole.
 *
 * This is the whole authoring tell. A server component is called as a
 * function and returns markup. An island is *mounted*, and what it returns
 * is a marker the serializer turns into `{ kind: "island" }`. The two
 * cannot be confused at a call site, which is the point — RSC's problem is
 * that both sides are the same JSX.
 *
 * The React implementation lives in `*.island.tsx` and is imported only by
 * the client registry. This file never imports `react`.
 */

const ISLAND = Symbol("socklit.island");

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;
const MAX_NAME = 64;

export type IslandEvents = {
  readonly [name: string]: (...args: never[]) => unknown;
};

export type IslandMount = {
  readonly [ISLAND]: true;
  readonly name: string;
  readonly props: Record<string, unknown>;
};

export type IslandHandle<
  P extends Record<string, WireJson>,
  E extends IslandEvents,
> = {
  readonly name: string;
  mount(props: P & E): IslandMount;
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
 * `P` is JSON. `E` is callbacks. Both are enforced at the `.mount()` call
 * by TypeScript, and again at serialize time for anything types missed —
 * a `Date`, a class instance, a nested function, a template.
 */
export function defineIsland<
  P extends Record<string, WireJson>,
  E extends IslandEvents = Record<string, never>,
>(name: string): IslandHandle<P, E> {
  if (!NAME_PATTERN.test(name) || name.length > MAX_NAME) {
    throw new IslandError(
      `island name "${name}" must be an identifier of at most ${MAX_NAME} characters`,
    );
  }

  return {
    name,
    mount(props: P & E): IslandMount {
      return { [ISLAND]: true, name, props };
    },
  };
}

export function isIslandMount(value: unknown): value is IslandMount {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<IslandMount>)[ISLAND] === true
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
  if (isIslandMount(value)) {
    return fail(
      `${path} is another island. Islands cannot nest; compose them in the server template instead`,
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
