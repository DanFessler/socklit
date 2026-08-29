import type { RenderOutput } from "./component";

const KEYED_LIST = Symbol("socklit.keyed-list");

export type KeyedItem = {
  key: string;
  /**
   * A template, or a component waiting for its address.
   *
   * Building the list stays eager because creating a component marker has no
   * side effects. What defers is the component body, which serialization runs
   * once the row's address exists.
   */
  result: RenderOutput;
};

export type KeyedList = {
  [KEYED_LIST]: true;
  items: KeyedItem[];
};

/**
 * Marks a collection as keyed so the replica can preserve per-row identity.
 *
 * Positional lists are deliberately unsupported: a row's key seeds its instance
 * address, which is what keeps DOM state and server event routing attached to
 * the same record when siblings are inserted or removed.
 */
export function keyed<T>(
  items: Iterable<T>,
  keyOf: (item: T, index: number) => string | number,
  render: (item: T, index: number) => RenderOutput,
): KeyedList {
  const entries: KeyedItem[] = [];
  const seen = new Set<string>();
  let index = 0;

  for (const item of items) {
    const key = String(keyOf(item, index));
    if (key.length === 0) {
      throw new Error(`keyed(): key at index ${index} is empty`);
    }
    if (seen.has(key)) {
      throw new Error(`keyed(): duplicate key ${JSON.stringify(key)}`);
    }
    seen.add(key);
    entries.push({ key, result: render(item, index) });
    index += 1;
  }

  return { [KEYED_LIST]: true, items: entries };
}

export function isKeyedList(value: unknown): value is KeyedList {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<KeyedList>)[KEYED_LIST] === true
  );
}

/**
 * Percent-encodes the characters used as separators in instance addresses so a
 * key can never forge the address of a different instance.
 */
export function escapeKey(key: string): string {
  return key.replace(
    /[%:/]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase()}`,
  );
}
