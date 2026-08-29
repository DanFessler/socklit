import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTodoStore, StoreError, TodoStore } from "../server/store";

describe("TodoStore", () => {
  let directory: string;
  let file: string;
  let store: TodoStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "socklit-store-"));
    file = join(directory, "todos.json");
    store = await createTodoStore(file);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("starts empty when the database file does not exist", () => {
    expect(store.list()).toEqual([]);
  });

  it("persists an added todo to disk", async () => {
    const todo = await store.add("  Buy milk  ");

    expect(todo.text).toBe("Buy milk");
    expect(todo.done).toBe(false);

    const written = JSON.parse(await readFile(file, "utf8"));
    expect(written.todos).toEqual([todo]);
  });

  it("reproduces todos from disk after a reload", async () => {
    await store.add("First");
    await store.add("Second");

    const reloaded = await createTodoStore(file);
    expect(reloaded.list().map((todo) => todo.text)).toEqual([
      "First",
      "Second",
    ]);
  });

  it("toggles and removes by id", async () => {
    const first = await store.add("First");
    const second = await store.add("Second");

    const toggled = await store.toggle(second.id);
    expect(toggled.done).toBe(true);
    expect(store.list().find((todo) => todo.id === first.id)?.done).toBe(false);

    await store.remove(first.id);
    expect(store.list().map((todo) => todo.id)).toEqual([second.id]);
  });

  it("rejects empty and oversized text without writing the file", async () => {
    await expect(store.add("   ")).rejects.toBeInstanceOf(StoreError);
    await expect(store.add("x".repeat(201))).rejects.toBeInstanceOf(StoreError);
    await expect(readFile(file, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects unknown ids without writing the file", async () => {
    await store.add("First");
    const before = await readFile(file, "utf8");

    await expect(store.toggle("missing")).rejects.toBeInstanceOf(StoreError);
    await expect(store.remove("missing")).rejects.toBeInstanceOf(StoreError);

    expect(await readFile(file, "utf8")).toBe(before);
  });

  it("notifies listeners only after a mutation is persisted", async () => {
    const seen: number[] = [];
    store.onChange(() => {
      // A listener must already be able to observe the mutation on disk.
      const persisted = JSON.parse(readFileSync(file, "utf8"));
      seen.push(persisted.todos.length);
    });

    await store.add("First");
    await store.add("Second");
    await expect(store.add("")).rejects.toBeInstanceOf(StoreError);

    expect(seen).toEqual([1, 2]);
  });

  it("serializes concurrent mutations so no write is lost", async () => {
    await Promise.all([
      store.add("one"),
      store.add("two"),
      store.add("three"),
      store.add("four"),
    ]);

    const persisted = JSON.parse(await readFile(file, "utf8"));
    expect(persisted.todos).toHaveLength(4);
    expect(store.list()).toHaveLength(4);
  });

  it("keeps returned lists detached from authoritative state", async () => {
    await store.add("First");

    const list = store.list();
    const first = list[0];
    if (!first) throw new Error("expected a todo");
    first.text = "mutated";

    expect(store.list()[0]?.text).toBe("First");
  });
});
