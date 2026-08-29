import { createTodoApp } from "../../app/todo-app";
import { createDatabase, createTodoStore } from "../../store";
import type { Probe, ProbeContext } from "../types";

/**
 * The original prototype, kept as the reference probe.
 *
 * It holds no per-session state, so every session shares one app function and
 * one store. That is the simple case; probes that diverge per user build their
 * state inside `createApp` instead.
 */
export async function create(context: ProbeContext): Promise<Probe> {
  const store = await createTodoStore(context.dataFile("todos.json"));
  const app = createTodoApp(createDatabase(store));

  return {
    id: "todo",
    title: "Durable todos",
    forces: "Baseline: does authoring feel like local UI code",
    subscribe: (listener) => store.onChange(listener),
    createApp: () => ({ app }),
  };
}
