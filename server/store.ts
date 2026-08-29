import { randomUUID } from "node:crypto";

import {
  JsonStore,
  StoreError,
  type StoreListener,
} from "./json-store";

export { StoreError, type StoreListener };

export type Todo = {
  id: string;
  text: string;
  done: boolean;
};

export type DatabaseFile = {
  todos: Todo[];
};

export const MAX_TEXT_LENGTH = 200;

/**
 * The todo probe's data access layer.
 *
 * Application code calls these methods directly from event handlers. Durability,
 * atomicity, and the mutation mutex all come from `JsonStore`; this class only
 * adds the todo vocabulary and its validation rules.
 */
export class TodoStore {
  private readonly store: JsonStore<Todo[]>;

  constructor(file: string) {
    this.store = new JsonStore<Todo[]>({
      file,
      initial: () => [],
      parse: (raw) => parseDatabaseFile(raw, file),
      serialize: (todos) => ({ todos } satisfies DatabaseFile),
    });
  }

  async load(): Promise<void> {
    await this.store.load();
  }

  /** Detached copies: app code cannot mutate authoritative state by accident. */
  list(): Todo[] {
    return this.store.state.map((todo) => ({ ...todo }));
  }

  add(text: string): Promise<Todo> {
    return this.store.mutate((todos) => {
      const trimmed = normalizeText(text);
      const todo: Todo = { id: randomUUID(), text: trimmed, done: false };
      return { next: [...todos, todo], result: todo };
    });
  }

  /**
   * States the desired outcome rather than flipping the current one.
   *
   * Prefer this over `toggle` for anything driven by a user interaction. A
   * relative flip is not safe once a request can be in flight: two clients that
   * both ask for "done" would cancel each other out, whereas asking for an
   * absolute value is idempotent and order-independent.
   */
  setDone(id: string, done: boolean): Promise<Todo> {
    return this.store.mutate((todos) => {
      const current = requireTodo(todos, id);
      if (current.done === done) {
        return { next: todos, result: current };
      }

      const updated: Todo = { ...current, done };
      return { next: replaceTodo(todos, id, updated), result: updated };
    });
  }

  toggle(id: string): Promise<Todo> {
    return this.store.mutate((todos) => {
      const current = requireTodo(todos, id);
      const updated: Todo = { ...current, done: !current.done };
      return { next: replaceTodo(todos, id, updated), result: updated };
    });
  }

  rename(id: string, text: string): Promise<Todo> {
    return this.store.mutate((todos) => {
      const current = requireTodo(todos, id);
      const updated: Todo = { ...current, text: normalizeText(text) };
      return { next: replaceTodo(todos, id, updated), result: updated };
    });
  }

  remove(id: string): Promise<Todo> {
    return this.store.mutate((todos) => {
      const current = requireTodo(todos, id);
      return {
        next: todos.filter((todo) => todo.id !== id),
        result: current,
      };
    });
  }

  clearCompleted(): Promise<number> {
    return this.store.mutate((todos) => {
      const remaining = todos.filter((todo) => !todo.done);
      const removed = todos.length - remaining.length;
      if (removed === 0) {
        throw new StoreError("no completed todos to clear");
      }
      return { next: remaining, result: removed };
    });
  }

  /**
   * Notifies with this store as the source, so read scoping can match it.
   *
   * The identity has to be the same object application code passes to
   * `useStore`, which is this one — `useStore(db.todos)`. The `JsonStore`
   * underneath is deliberately not the identity: it is an implementation
   * detail that no app holds a reference to.
   */
  onChange(listener: (source: unknown) => void): () => void {
    return this.store.onChange(() => listener(this));
  }
}

export async function createTodoStore(file: string): Promise<TodoStore> {
  const store = new TodoStore(file);
  await store.load();
  return store;
}

/** What the todo application sees. There is no other data access layer. */
export type Database = {
  todos: TodoStore;
};

export function createDatabase(todos: TodoStore): Database {
  return { todos };
}

function requireTodo(todos: readonly Todo[], id: string): Todo {
  const todo = todos.find((candidate) => candidate.id === id);
  if (!todo) {
    throw new StoreError(`unknown todo: ${id}`);
  }
  return todo;
}

function replaceTodo(
  todos: readonly Todo[],
  id: string,
  updated: Todo,
): Todo[] {
  return todos.map((todo) => (todo.id === id ? updated : todo));
}

function parseDatabaseFile(raw: unknown, file: string): Todo[] {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !Array.isArray((raw as DatabaseFile).todos)
  ) {
    throw new Error(`malformed database file: ${file}`);
  }

  return (raw as DatabaseFile).todos.filter(isTodo).map((todo) => ({
    id: todo.id,
    text: todo.text,
    done: todo.done,
  }));
}

function normalizeText(text: unknown): string {
  if (typeof text !== "string") {
    throw new StoreError("todo text must be a string");
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new StoreError("todo text must not be empty");
  }
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new StoreError(
      `todo text must be at most ${MAX_TEXT_LENGTH} characters`,
    );
  }
  return trimmed;
}

function isTodo(value: unknown): value is Todo {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Todo>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.text === "string" &&
    typeof candidate.done === "boolean"
  );
}
