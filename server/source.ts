import { randomUUID } from "node:crypto";

/**
 * An identity `useStore` can record and `listen({ subscribe })` can name.
 *
 * Socklit does not own the database. A source is the object you pass to both
 * `useStore(source)` and `onChange(source)` so read-scoping can match. It must
 * be a class instance — a plain `{ … }` is rejected as an inert record.
 */
export class ChangeSource {
  readonly id: string;

  constructor() {
    this.id = randomUUID();
  }
}

/** A unique source. Pass the same instance to `useStore` and to `onChange`. */
export function changeSource(): ChangeSource {
  return new ChangeSource();
}
