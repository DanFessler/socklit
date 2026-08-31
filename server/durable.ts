import { TAB_QUERY } from "../shared/protocol";
import { createJsonStore, type JsonStore } from "./json-store";

/**
 * Named cells that outlive a socket.
 *
 * This is the middle lifetime S4 named: this person, this task. The vault is
 * per runtime, so every session of an app reads the same table. Keys are
 * built by `useDurable` from identity, tab, and the author-chosen name.
 *
 * Values are JSON. A function or a class instance will not come back.
 */

export type DurableRecord = {
  cells: Record<string, unknown>;
};

export class DurableVault {
  private readonly cells = new Map<string, unknown>();
  private readonly watchers = new Map<string, Set<() => void>>();
  private store: JsonStore<DurableRecord> | null = null;
  private persistTail: Promise<unknown> = Promise.resolve();

  static memory(): DurableVault {
    return new DurableVault();
  }

  static async file(path: string): Promise<DurableVault> {
    const vault = new DurableVault();
    vault.store = await createJsonStore<DurableRecord>({
      file: path,
      initial: () => ({ cells: {} }),
      parse: parseRecord,
    });
    for (const [key, value] of Object.entries(vault.store.state.cells)) {
      vault.cells.set(key, value);
    }
    return vault;
  }

  get(key: string): unknown {
    return this.cells.get(key);
  }

  has(key: string): boolean {
    return this.cells.has(key);
  }

  set(key: string, value: unknown): void {
    const stored = cloneJson(value);
    this.cells.set(key, stored);
    this.notify(key);
    this.persist();
  }

  /** Wait until every queued file write has finished. Memory vaults resolve immediately. */
  flush(): Promise<void> {
    return this.persistTail.then(() => undefined);
  }

  watch(key: string, listener: () => void): () => void {
    let group = this.watchers.get(key);
    if (!group) {
      group = new Set();
      this.watchers.set(key, group);
    }
    group.add(listener);
    return () => {
      group.delete(listener);
      if (group.size === 0) this.watchers.delete(key);
    };
  }

  private notify(key: string): void {
    const group = this.watchers.get(key);
    if (!group) return;
    for (const listener of [...group]) listener();
  }

  private persist(): void {
    const store = this.store;
    if (!store) return;

    const snapshot = Object.fromEntries(this.cells);
    this.persistTail = this.persistTail
      .then(() =>
        store.mutate((state) => {
          if (sameCells(state.cells, snapshot)) {
            return { next: state, result: undefined };
          }
          return { next: { cells: snapshot }, result: undefined };
        }),
      )
      .catch(() => undefined);
  }
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseRecord(raw: unknown): DurableRecord {
  if (typeof raw !== "object" || raw === null) return { cells: {} };
  const cells = (raw as { cells?: unknown }).cells;
  if (typeof cells !== "object" || cells === null || Array.isArray(cells)) {
    return { cells: {} };
  }
  return { cells: { ...(cells as Record<string, unknown>) } };
}

function sameCells(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function durableIdentity(
  user: unknown,
  params: URLSearchParams,
): string | null {
  if (typeof user === "string" && user.length > 0) return user;
  if (typeof user === "number" && Number.isFinite(user)) return String(user);
  if (user && typeof user === "object" && "id" in user) {
    const id = (user as { id: unknown }).id;
    if (typeof id === "string" && id.length > 0) return id;
    if (typeof id === "number" && Number.isFinite(id)) return String(id);
  }
  const named = params.get("user");
  return named && named.length > 0 ? named : null;
}

export function durableCellKey(options: {
  share: "tab" | "user";
  name: string;
  identity: string | null;
  tab: string | null;
}): string {
  if (options.share === "user") {
    if (!options.identity) {
      throw new Error(
        `useDurable("${options.name}", { share: "user" }) needs a person ` +
          `(session.user, or ?user=). Without one there is no row to share.`,
      );
    }
    return `user:${options.identity}:${options.name}`;
  }

  if (!options.tab) {
    throw new Error(
      `useDurable("${options.name}") needs a tab id. The replica sends ?${TAB_QUERY}=.`,
    );
  }

  const who = options.identity ?? "anon";
  return `tab:${who}:${options.tab}:${options.name}`;
}
