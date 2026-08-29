import { html, type TemplateResult } from "lit-html";

import type { ChangePayload } from "../../../shared/protocol";
import {
  component,
  useState,
  useStore,
  type RenderOutput,
} from "../../component";
import { keyed } from "../../keyed";
import {
  TASK_STATUSES,
  type ActivityEntry,
  type Metric,
  type Task,
  type TaskStatus,
  type Toggle,
  type WorkspaceStore,
} from "./workspace";

export const ROUTES = [
  "dashboard",
  "tasks",
  "detail",
  "settings",
  "profile",
] as const;

export type RouteId = (typeof ROUTES)[number];

export const ROUTE_LABELS: Record<RouteId, string> = {
  dashboard: "Dashboard",
  tasks: "Tasks",
  detail: "Detail",
  settings: "Settings",
  profile: "Profile",
};

export function isRouteId(value: string | null): value is RouteId {
  return value !== null && (ROUTES as readonly string[]).includes(value);
}

/**
 * Whether the shell is one template with a body hole, or one template per route.
 *
 * `fused` is the shape a careful author writes; `split` is the shape that falls
 * out of `route === "x" ? html`...` : html`...`` at the top level. They are
 * behaviourally identical and cost very different amounts on the wire, which is
 * the S2 measurement.
 */
export type ShellMode = "fused" | "split";

/**
 * What a session brings with it from its query string.
 *
 * `route` and `selectedTaskId` are seeds only: after the first render they live
 * in `RoutesApp`'s `useState` slots and this is ignored. The rest is fixed for
 * the life of the connection, so it stays a prop rather than becoming state.
 */
export type SessionConfig = {
  route: RouteId;
  selectedTaskId: string;
  user: string;
  /** Whether the corner shows this user's name or a constant. */
  personalized: boolean;
  shell: ShellMode;
};

/** Sets the visible route. Held by `RoutesApp`, called from two subtrees. */
export type Navigate = (route: RouteId) => void;

/** Selects a task and shows it. Held by `RoutesApp`, called from task rows. */
export type OpenTask = (taskId: string) => void;

type ShellParts = {
  header: RenderOutput;
  body: RenderOutput;
  footer: RenderOutput;
};

/**
 * The whole application, and the owner of everything a single user diverges on.
 *
 * Both pieces of session state sit here rather than in the component that draws
 * the control that changes them, because both are read in one subtree and
 * written in another: the route decides the shell template, the header's active
 * link and the body, and it is set by a nav link in the header *and* by a task
 * row deep inside the body. `selectedTaskId` is the same shape — read only by
 * the detail route, written by rows on three different routes. So the state is
 * as high as its highest reader, and the setters travel down as props.
 *
 * Setting either re-renders this session and no other, which is what lets two
 * tabs of the same user sit on different routes (design-probes.md S2) and what
 * partitions the amortization space finding 3 of economics.md depends on (S1).
 */
export const RoutesApp = component(function RoutesApp(props: {
  store: WorkspaceStore;
  config: SessionConfig;
}) {
  const store = useStore(props.store);
  const { config } = props;

  const [route, setRoute] = useState(config.route);
  const [selectedTaskId, setSelectedTaskId] = useState(config.selectedTaskId);

  // Absolute, not relative: "go to tasks" is safe to apply late or twice,
  // whereas "go to the next route" would not be. Setting the route to what it
  // already is is a no-op, so a repeat click costs nothing on the wire.
  const navigate: Navigate = (next) => setRoute(next);

  // Re-checked against the store: rendering a row is not authorization to open
  // it, and the row may have been removed since it was rendered.
  const open: OpenTask = (taskId) => {
    if (!store.task(taskId)) return;
    setSelectedTaskId(taskId);
    setRoute("detail");
  };

  const parts: ShellParts = {
    header: RouteHeader({
      route,
      user: config.user,
      personalized: config.personalized,
      navigate,
    }),
    body: RouteBody({
      store,
      route,
      selectedTaskId,
      user: config.user,
      open,
    }),
    footer: RouteFooter({ store }),
  };

  return config.shell === "split"
    ? SPLIT_SHELLS[route](parts)
    : fusedShell(parts);
});

function fusedShell(parts: ShellParts): TemplateResult {
  return html`
    <div class="routes-shell">
      ${parts.header}
      <main class="routes-body">${parts.body}</main>
      ${parts.footer}
    </div>
  `;
}

/**
 * One shell template per route, deliberately duplicated.
 *
 * Five distinct tag sites means five distinct interned templates, so a route
 * change replaces the root instance and ships a shell the browser has never
 * seen. That is the cost this mode exists to measure.
 */
const SPLIT_SHELLS: Record<RouteId, (parts: ShellParts) => TemplateResult> = {
  dashboard: (parts) => html`
    <div class="routes-shell" data-shell="dashboard">
      ${parts.header}
      <main class="routes-body">${parts.body}</main>
      ${parts.footer}
    </div>
  `,
  tasks: (parts) => html`
    <div class="routes-shell" data-shell="tasks">
      ${parts.header}
      <main class="routes-body">${parts.body}</main>
      ${parts.footer}
    </div>
  `,
  detail: (parts) => html`
    <div class="routes-shell" data-shell="detail">
      ${parts.header}
      <main class="routes-body">${parts.body}</main>
      ${parts.footer}
    </div>
  `,
  settings: (parts) => html`
    <div class="routes-shell" data-shell="settings">
      ${parts.header}
      <main class="routes-body">${parts.body}</main>
      ${parts.footer}
    </div>
  `,
  profile: (parts) => html`
    <div class="routes-shell" data-shell="profile">
      ${parts.header}
      <main class="routes-body">${parts.body}</main>
      ${parts.footer}
    </div>
  `,
};

const RouteHeader = component(function RouteHeader(props: {
  route: RouteId;
  user: string;
  personalized: boolean;
  navigate: Navigate;
}) {
  const { route, user, personalized, navigate } = props;

  return html`
    <header class="routes-header">
      <span class="routes-brand">Atlas Console</span>
      <nav class="routes-nav">
        ${keyed(
          ROUTES,
          (candidate) => candidate,
          (candidate) =>
            NavLink({ route: candidate, active: candidate === route, navigate }),
        )}
      </nav>
      <span class="routes-user"
        >${personalized ? displayName(user) : "Signed in"}</span
      >
    </header>
  `;
});

const NavLink = component(function NavLink(props: {
  route: RouteId;
  active: boolean;
  navigate: Navigate;
}) {
  const { route, active, navigate } = props;

  return html`
    <button
      class="routes-nav-link"
      type="button"
      aria-current=${active ? "page" : "false"}
      @click=${() => navigate(route)}
    >
      ${ROUTE_LABELS[route]}
    </button>
  `;
});

/** Shared in full: every session reads the same counts from the same store. */
const RouteFooter = component(function RouteFooter(props: {
  store: WorkspaceStore;
}) {
  const store = useStore(props.store);
  const tasks = store.tasks();
  const done = tasks.filter((task) => task.status === "done").length;
  const doing = tasks.filter((task) => task.status === "doing").length;

  return html`
    <footer class="routes-footer">
      <span>${tasks.length} tasks</span>
      <span>${doing} in progress</span>
      <span>${done} done</span>
    </footer>
  `;
});

/**
 * Picks the route's component, and nothing else.
 *
 * It renders no template of its own, so it occupies the body hole's address and
 * hands it straight to the route: `root/h1` is the route's own section element
 * in the wire tree, exactly as it was when this was a `switch` returning a
 * template.
 */
const RouteBody = component(function RouteBody(props: {
  store: WorkspaceStore;
  route: RouteId;
  selectedTaskId: string;
  user: string;
  open: OpenTask;
}): RenderOutput {
  const { store, route, selectedTaskId, user, open } = props;

  switch (route) {
    case "dashboard":
      return DashboardRoute({ store });
    case "tasks":
      return TasksRoute({ store, open });
    case "detail":
      return DetailRoute({ store, selectedTaskId, open });
    case "settings":
      return SettingsRoute({ store });
    case "profile":
      return ProfileRoute({ store, user, open });
  }
});

const DashboardRoute = component(function DashboardRoute(props: {
  store: WorkspaceStore;
}) {
  const store = useStore(props.store);

  return html`
    <section class="route-dashboard">
      <h2>Overview</h2>
      <div class="metric-grid">
        ${keyed(
          store.metrics(),
          (metric) => metric.id,
          (metric) => MetricCard({ metric }),
        )}
      </div>
      <h3>Recent activity</h3>
      <ul class="activity-list">
        ${keyed(
          store.activity(),
          (entry) => entry.id,
          (entry) => ActivityRow({ entry }),
        )}
      </ul>
    </section>
  `;
});

const MetricCard = component(function MetricCard(props: { metric: Metric }) {
  const { metric } = props;

  return html`
    <div class="metric-card">
      <span class="metric-label">${metric.label}</span>
      <span class="metric-value">${metric.value}${metric.unit}</span>
    </div>
  `;
});

const ActivityRow = component(function ActivityRow(props: {
  entry: ActivityEntry;
}) {
  const { entry } = props;

  return html`
    <li class="activity-row">
      <strong>${entry.actor}</strong>
      <span>${entry.text}</span>
    </li>
  `;
});

const TasksRoute = component(function TasksRoute(props: {
  store: WorkspaceStore;
  open: OpenTask;
}) {
  const store = useStore(props.store);
  const { open } = props;
  const tasks = store.tasks();
  const openCount = tasks.filter((task) => task.status !== "done").length;

  return html`
    <section class="route-tasks">
      <h2>Tasks</h2>
      <p class="route-summary">${openCount} open of ${tasks.length}</p>
      <ul class="task-list">
        ${keyed(
          tasks,
          (task) => task.id,
          (task) => TaskRow({ task, open }),
        )}
      </ul>
    </section>
  `;
});

const TaskRow = component(function TaskRow(props: {
  task: Task;
  open: OpenTask;
}) {
  const { task, open } = props;

  return html`
    <li class="task-row" data-status=${task.status}>
      <button
        class="task-title"
        type="button"
        @click=${() => open(task.id)}
      >
        ${task.title}
      </button>
      <span class="task-owner">${task.owner}</span>
      <span class="task-project">${task.project}</span>
      <span class="task-status">${task.status}</span>
    </li>
  `;
});

const DetailRoute = component(function DetailRoute(props: {
  store: WorkspaceStore;
  selectedTaskId: string;
  open: OpenTask;
}) {
  const store = useStore(props.store);
  const { selectedTaskId, open } = props;

  const task = store.task(selectedTaskId);
  if (!task) {
    return html`
      <section class="route-detail">
        <h2>Nothing selected</h2>
        <p>Pick a task from the list.</p>
      </section>
    `;
  }

  const related = store
    .tasks()
    .filter((other) => other.project === task.project && other.id !== task.id);

  return html`
    <section class="route-detail">
      <h2>${task.title}</h2>
      <p class="detail-meta">
        ${task.project} &middot; ${task.owner} &middot; ${task.status}
      </p>
      <div class="detail-actions">
        ${keyed(
          TASK_STATUSES,
          (status) => status,
          (status) => StatusButton({ store, task, status }),
        )}
      </div>
      <h3>Also in ${task.project}</h3>
      <ul class="task-list">
        ${keyed(
          related,
          (other) => other.id,
          (other) => TaskRow({ task: other, open }),
        )}
      </ul>
    </section>
  `;
});

const StatusButton = component(function StatusButton(props: {
  store: WorkspaceStore;
  task: Task;
  status: TaskStatus;
}) {
  const store = useStore(props.store);
  const { task, status } = props;

  return html`
    <button
      class="detail-status"
      type="button"
      aria-pressed=${task.status === status ? "true" : "false"}
      @click=${() => store.setStatus(task.id, status)}
    >
      ${status}
    </button>
  `;
});

const SettingsRoute = component(function SettingsRoute(props: {
  store: WorkspaceStore;
}) {
  const store = useStore(props.store);

  return html`
    <section class="route-settings">
      <h2>Workspace settings</h2>
      <ul class="toggle-list">
        ${keyed(
          store.toggles(),
          (toggle) => toggle.id,
          (toggle) => ToggleRow({ store, toggle }),
        )}
      </ul>
    </section>
  `;
});

const ToggleRow = component(function ToggleRow(props: {
  store: WorkspaceStore;
  toggle: Toggle;
}) {
  const store = useStore(props.store);
  const { toggle } = props;

  return html`
    <li class="toggle-row">
      <label>
        <input
          type="checkbox"
          .checked=${toggle.enabled}
          @change=${(event: ChangePayload) =>
            store.setToggle(toggle.id, event.checked ?? !toggle.enabled)}
        />
        <span>${toggle.label}</span>
      </label>
    </li>
  `;
});

/** The only route whose body is per-user by construction. */
const ProfileRoute = component(function ProfileRoute(props: {
  store: WorkspaceStore;
  user: string;
  open: OpenTask;
}) {
  const store = useStore(props.store);
  const { user, open } = props;

  const assigned = store
    .tasks()
    .filter((task) => task.owner === user.toLowerCase());

  return html`
    <section class="route-profile">
      <h2>${displayName(user)}</h2>
      <p class="profile-meta">
        ${assigned.length} assigned &middot; signed in as ${user}
      </p>
      <ul class="task-list">
        ${keyed(
          assigned,
          (task) => task.id,
          (task) => TaskRow({ task, open }),
        )}
      </ul>
    </section>
  `;
});

export function displayName(user: string): string {
  const trimmed = user.trim();
  if (trimmed.length === 0) return "Guest";
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}
