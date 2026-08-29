import { createJsonStore, JsonStore, StoreError } from "../../json-store";

/**
 * Shared, authoritative content for the route-divergence probe.
 *
 * Everything here is genuinely shared: every session reads the same records and
 * sees the same values. Divergence between sessions comes from per-session
 * component state (the route, in `RoutesApp`'s `useState`) and from
 * `session.params` (the user), never from this store. That separation is what
 * makes the shareable fraction measurable — anything that differs across
 * sessions differs for exactly one of two reasons.
 *
 * The seed is deterministic so two runs of the measurement script produce the
 * same trees.
 */

export const TASK_STATUSES = ["todo", "doing", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  owner: string;
  project: string;
};

export type Metric = {
  id: string;
  label: string;
  value: number;
  unit: string;
};

export type ActivityEntry = {
  id: string;
  actor: string;
  text: string;
};

export type Toggle = {
  id: string;
  label: string;
  enabled: boolean;
};

export type Workspace = {
  metrics: Metric[];
  tasks: Task[];
  activity: ActivityEntry[];
  toggles: Toggle[];
};

export const USERS = ["alice", "bob", "carol", "dave"] as const;

const PROJECTS = ["atlas", "beacon", "cirrus"] as const;

const TASK_TITLES = [
  "Reconcile ledger export",
  "Retire the legacy webhook",
  "Backfill regional totals",
  "Audit permission classes",
  "Trim the settings payload",
  "Split the invoice worker",
  "Cache the amortization table",
  "Instrument the diff path",
  "Rotate the signing keys",
  "Prune orphaned attachments",
  "Document the wire format",
  "Chase the flaky rename test",
  "Batch the nightly digest",
  "Measure retained bytes",
  "Deduplicate the query layer",
  "Shard the session registry",
  "Replay the drain window",
  "Cost the fan-out inversion",
] as const;

function seed(): Workspace {
  const tasks: Task[] = TASK_TITLES.map((title, index) => ({
    id: `task-${String(index + 1).padStart(2, "0")}`,
    title,
    status: TASK_STATUSES[index % TASK_STATUSES.length] ?? "todo",
    owner: USERS[index % USERS.length] ?? "alice",
    project: PROJECTS[index % PROJECTS.length] ?? "atlas",
  }));

  return {
    metrics: [
      { id: "sessions", label: "Live sessions", value: 1284, unit: "" },
      { id: "renders", label: "Renders / min", value: 9310, unit: "" },
      { id: "patch", label: "Patch bytes / min", value: 412_000, unit: "B" },
      { id: "fanout", label: "Fan-out", value: 214, unit: "x" },
      { id: "drain", label: "Drain window", value: 38, unit: "s" },
      { id: "queue", label: "Queued events", value: 17, unit: "" },
    ],
    tasks,
    activity: [
      { id: "act-1", actor: "alice", text: "closed the ledger reconciliation" },
      { id: "act-2", actor: "bob", text: "reopened the webhook retirement" },
      { id: "act-3", actor: "carol", text: "moved two tasks into beacon" },
      { id: "act-4", actor: "dave", text: "commented on the wire format" },
      { id: "act-5", actor: "alice", text: "assigned the signing key rotation" },
      { id: "act-6", actor: "carol", text: "raised the drain window budget" },
      { id: "act-7", actor: "bob", text: "attached a flamegraph" },
      { id: "act-8", actor: "dave", text: "merged the diff instrumentation" },
    ],
    toggles: [
      { id: "digest", label: "Nightly digest", enabled: true },
      { id: "presence", label: "Presence indicators", enabled: false },
      { id: "shared-queries", label: "Deduplicate queries", enabled: true },
      { id: "amortize", label: "Share renders across sessions", enabled: false },
      { id: "audit", label: "Verbose audit log", enabled: false },
      { id: "beta", label: "Beta navigation", enabled: true },
    ],
  };
}

/**
 * The probe's data access layer. Mutations state an outcome rather than a delta,
 * so an event that arrives late or twice is still safe to apply.
 */
export class WorkspaceStore {
  private readonly store: JsonStore<Workspace>;

  constructor(file: string) {
    this.store = new JsonStore<Workspace>({
      file,
      initial: seed,
      parse: (raw) => parseWorkspace(raw, file),
    });
  }

  async load(): Promise<void> {
    await this.store.load();
  }

  /** Detached copies, so a render cannot mutate authoritative state. */
  tasks(): Task[] {
    return this.store.state.tasks.map((task) => ({ ...task }));
  }

  metrics(): Metric[] {
    return this.store.state.metrics.map((metric) => ({ ...metric }));
  }

  activity(): ActivityEntry[] {
    return this.store.state.activity.map((entry) => ({ ...entry }));
  }

  toggles(): Toggle[] {
    return this.store.state.toggles.map((toggle) => ({ ...toggle }));
  }

  task(id: string): Task | undefined {
    const found = this.store.state.tasks.find((task) => task.id === id);
    return found ? { ...found } : undefined;
  }

  setStatus(id: string, status: TaskStatus): Promise<Task> {
    return this.store.mutate((workspace) => {
      const current = workspace.tasks.find((task) => task.id === id);
      if (!current) throw new StoreError(`unknown task: ${id}`);
      if (!TASK_STATUSES.includes(status)) {
        throw new StoreError(`unknown status: ${status}`);
      }
      if (current.status === status) {
        return { next: workspace, result: { ...current } };
      }

      const updated: Task = { ...current, status };
      return {
        next: {
          ...workspace,
          tasks: workspace.tasks.map((task) =>
            task.id === id ? updated : task,
          ),
        },
        result: updated,
      };
    });
  }

  setToggle(id: string, enabled: boolean): Promise<Toggle> {
    return this.store.mutate((workspace) => {
      const current = workspace.toggles.find((toggle) => toggle.id === id);
      if (!current) throw new StoreError(`unknown toggle: ${id}`);
      if (current.enabled === enabled) {
        return { next: workspace, result: { ...current } };
      }

      const updated: Toggle = { ...current, enabled };
      return {
        next: {
          ...workspace,
          toggles: workspace.toggles.map((toggle) =>
            toggle.id === id ? updated : toggle,
          ),
        },
        result: updated,
      };
    });
  }

  onChange(listener: () => void): () => void {
    return this.store.onChange(listener);
  }
}

export async function createWorkspaceStore(
  file: string,
): Promise<WorkspaceStore> {
  const store = new WorkspaceStore(file);
  await store.load();
  return store;
}

function parseWorkspace(raw: unknown, file: string): Workspace {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`malformed workspace file: ${file}`);
  }

  const candidate = raw as Partial<Workspace>;
  const fallback = seed();

  return {
    metrics: Array.isArray(candidate.metrics)
      ? candidate.metrics.filter(isMetric)
      : fallback.metrics,
    tasks: Array.isArray(candidate.tasks)
      ? candidate.tasks.filter(isTask)
      : fallback.tasks,
    activity: Array.isArray(candidate.activity)
      ? candidate.activity.filter(isActivity)
      : fallback.activity,
    toggles: Array.isArray(candidate.toggles)
      ? candidate.toggles.filter(isToggle)
      : fallback.toggles,
  };
}

function isMetric(value: unknown): value is Metric {
  const candidate = value as Partial<Metric> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate.id === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.value === "number" &&
    typeof candidate.unit === "string"
  );
}

function isTask(value: unknown): value is Task {
  const candidate = value as Partial<Task> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.owner === "string" &&
    typeof candidate.project === "string" &&
    TASK_STATUSES.includes(candidate.status as TaskStatus)
  );
}

function isActivity(value: unknown): value is ActivityEntry {
  const candidate = value as Partial<ActivityEntry> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate.id === "string" &&
    typeof candidate.actor === "string" &&
    typeof candidate.text === "string"
  );
}

function isToggle(value: unknown): value is Toggle {
  const candidate = value as Partial<Toggle> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate.id === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.enabled === "boolean"
  );
}
