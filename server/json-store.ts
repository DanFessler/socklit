import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Thrown for invalid input or unknown records; never leaves the file rewritten. */
export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreError";
  }
}

export type StoreListener = () => void;

export type JsonStoreOptions<T> = {
  file: string;
  /** Value used when the file does not exist yet. */
  initial: () => T;
  /** Rejects or repairs whatever is actually on disk. */
  parse: (raw: unknown) => T;
  /** Shapes the on-disk representation. Defaults to the value itself. */
  serialize?: (value: T) => unknown;
};

/**
 * A JSON file behind a mutex, with atomic writes.
 *
 * This is the entire persistence layer available to a probe. Mutations are
 * serialized through one promise chain so two sessions cannot interleave a
 * read-modify-write, and each successful mutation is on disk before listeners
 * are notified, so a re-render can never observe state that is not yet durable.
 *
 * Values are treated as immutable: `mutate` returns a replacement rather than
 * editing in place, which is what makes the no-op short circuit safe.
 */
export class JsonStore<T> {
  private readonly file: string;
  private readonly initial: () => T;
  private readonly parse: (raw: unknown) => T;
  private readonly toDisk: (value: T) => unknown;
  private readonly listeners = new Set<StoreListener>();

  private current: T;
  private tail: Promise<unknown> = Promise.resolve();
  private writeCount = 0;

  constructor(options: JsonStoreOptions<T>) {
    this.file = options.file;
    this.initial = options.initial;
    this.parse = options.parse;
    this.toDisk = options.serialize ?? ((value) => value);
    this.current = options.initial();
  }

  async load(): Promise<void> {
    this.current = await this.readFromDisk();
  }

  /** The authoritative value. Do not mutate it; call `mutate` instead. */
  get state(): T {
    return this.current;
  }

  /**
   * Applies a replacement under the mutex.
   *
   * Returning the current value unchanged (by reference) is treated as a no-op:
   * nothing is written and nobody is notified, which is what makes an already
   * satisfied idempotent setter free.
   */
  mutate<R>(apply: (state: T) => { next: T; result: R }): Promise<R> {
    const run = async (): Promise<R> => {
      const { next, result } = apply(this.current);
      if (next === this.current) return result;

      await this.writeToDisk(next);
      this.current = next;
      this.notify();
      return result;
    };

    const settled = this.tail.then(run, run);
    this.tail = settled.catch(() => undefined);
    return settled;
  }

  onChange(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private async readFromDisk(): Promise<T> {
    let raw: string;
    try {
      raw = await readFile(this.file, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return this.initial();
      throw error;
    }

    return this.parse(JSON.parse(raw) as unknown);
  }

  /** Write-then-rename so a crash mid-write cannot truncate the file. */
  private async writeToDisk(value: T): Promise<void> {
    const temporary = `${this.file}.${process.pid}.${this.writeCount++}.tmp`;
    const payload = `${JSON.stringify(this.toDisk(value), null, 2)}\n`;

    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(temporary, payload, "utf8");

    try {
      await replaceFile(temporary, this.file);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}

export async function createJsonStore<T>(
  options: JsonStoreOptions<T>,
): Promise<JsonStore<T>> {
  const store = new JsonStore(options);
  await store.load();
  return store;
}

const REPLACE_ATTEMPTS = 12;
const RETRYABLE_REPLACE_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

/**
 * Renames over an existing file, retrying the codes Windows reports when
 * another process is briefly holding the freshly written temp file. Virus
 * scanners and search indexers both do this, and the failure is transient.
 */
export async function replaceFile(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (attempt >= REPLACE_ATTEMPTS || !RETRYABLE_REPLACE_CODES.has(code)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 5));
    }
  }
}

export function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}
