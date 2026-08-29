import type {
  Probe,
  ProbeContext,
  ProbeInstance,
  SessionContext,
} from "../types";
import { isRouteId, RoutesApp, ROUTES, type SessionConfig } from "./app";
import { createWorkspaceStore, type WorkspaceStore } from "./workspace";

/**
 * Route divergence: how much of a realistic app is actually shareable.
 *
 * The route is per-session state, but it is no longer held here: it lives in a
 * `useState` slot on the `RoutesApp` instance for this connection, and setting
 * it re-renders this session and no other. Two tabs of the same user can
 * therefore sit on different routes at once. That is the thing under test
 * (design-probes.md S2), and it is also what partitions the amortization space
 * that finding 3 of economics.md depends on (S1).
 *
 * What is left here is the query string: configuration that is fixed for the
 * life of the connection, plus the seeds the route state starts from.
 *
 * Per-tab configuration, all through `session.params`:
 *
 *   ?user=alice        the name in the corner, and the profile route's content
 *   ?route=tasks       seeds the initial route, so a measurement can place a
 *                      session on a route without driving a click
 *   ?task=task-04      seeds the detail route's selection
 *   ?personalize=0     replaces the per-user corner with a constant, which is
 *                      the with/without measurement design-probes.md predicts
 *                      collapses session-level sharing
 *   ?shell=split       one root template per route instead of a shared shell
 */
export async function create(context: ProbeContext): Promise<Probe> {
  const store = await createWorkspaceStore(context.dataFile("workspace.json"));

  return {
    id: "routes",
    title: "Route divergence",
    forces: "S1, S2",
    subscribe: (listener) => store.onChange(listener),
    createApp: (session) => createRouteSession(store, session),
  };
}

export function createRouteSession(
  store: WorkspaceStore,
  session: SessionContext,
): ProbeInstance {
  const config = initialConfig(store, session.params);
  return { app: () => RoutesApp({ store, config }) };
}

function initialConfig(
  store: WorkspaceStore,
  params: URLSearchParams,
): SessionConfig {
  const requestedRoute = params.get("route");
  const requestedTask = params.get("task");
  const tasks = store.tasks();

  return {
    route: isRouteId(requestedRoute) ? requestedRoute : ROUTES[0],
    selectedTaskId:
      requestedTask && store.task(requestedTask)
        ? requestedTask
        : (tasks[0]?.id ?? ""),
    user: (params.get("user") ?? "guest").slice(0, 40),
    personalized: params.get("personalize") !== "0",
    shell: params.get("shell") === "split" ? "split" : "fused",
  };
}
