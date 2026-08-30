import type { WireInstance } from "../shared/protocol";

/**
 * The two numbers research/economics.md says every projection rests on:
 * microseconds per node for render plus diff, and retained bytes per session.
 *
 * Its sensitivity analysis notes the first can move the fan-out crossover from
 * ~500 sessions per distinct view to past any real audience, so it is measured
 * here rather than assumed. Retained bytes is sampled, since sizing a tree costs
 * about as much as building one.
 */

const RETAINED_SAMPLE_INTERVAL = 20;

export type MetricsSnapshot = {
  sessions: number;
  renders: number;
  /** Renders that produced no operations and no templates. */
  quietRenders: number;
  nodes: number;
  renderMicroseconds: number;
  microsecondsPerNode: number | null;
  averageNodesPerRender: number | null;
  retainedBytesPerSession: number | null;
  sentBytes: { templates: number; snapshots: number; updates: number };
  eventsHandled: number;
  eventsRejected: number;
  /**
   * Renders avoided because the session had not read the store that changed.
   *
   * The figure to compare against `renders`: it is the whole return on read
   * scoping, and it stays at zero for an app that never calls `useStore`, which
   * is how you tell the mechanism is inert rather than ineffective.
   */
  scopedSkips: number;
};

export class RuntimeMetrics {
  private sessions = 0;
  private renders = 0;
  private quietRenders = 0;
  private nodes = 0;
  private renderMicroseconds = 0;
  private retainedSamples = 0;
  private retainedBytes = 0;
  private eventsHandled = 0;
  private eventsRejected = 0;
  private scopedSkips = 0;

  private readonly sentBytes = { templates: 0, snapshots: 0, updates: 0 };

  setSessions(count: number): void {
    this.sessions = count;
  }

  /** `microseconds` must cover app(), serialize(), and diff() together. */
  recordRender(options: {
    root: WireInstance;
    microseconds: number;
    quiet: boolean;
  }): void {
    const nodes = countNodes(options.root);

    this.renders += 1;
    this.nodes += nodes;
    this.renderMicroseconds += options.microseconds;
    if (options.quiet) this.quietRenders += 1;

    if (this.renders % RETAINED_SAMPLE_INTERVAL === 1) {
      this.retainedSamples += 1;
      this.retainedBytes += JSON.stringify(options.root).length;
    }
  }

  recordSend(kind: keyof MetricsSnapshot["sentBytes"], bytes: number): void {
    this.sentBytes[kind] += bytes;
  }

  recordEvent(accepted: boolean): void {
    if (accepted) this.eventsHandled += 1;
    else this.eventsRejected += 1;
  }

  recordScopedSkip(): void {
    this.scopedSkips += 1;
  }

  snapshot(): MetricsSnapshot {
    return {
      sessions: this.sessions,
      renders: this.renders,
      quietRenders: this.quietRenders,
      nodes: this.nodes,
      renderMicroseconds: Math.round(this.renderMicroseconds),
      microsecondsPerNode:
        this.nodes === 0
          ? null
          : round(this.renderMicroseconds / this.nodes, 3),
      averageNodesPerRender:
        this.renders === 0 ? null : round(this.nodes / this.renders, 1),
      retainedBytesPerSession:
        this.retainedSamples === 0
          ? null
          : Math.round(this.retainedBytes / this.retainedSamples),
      sentBytes: { ...this.sentBytes },
      eventsHandled: this.eventsHandled,
      eventsRejected: this.eventsRejected,
      scopedSkips: this.scopedSkips,
    };
  }
}

/** Counts instances plus hole values, which is the unit render cost scales with. */
export function countNodes(instance: WireInstance): number {
  let total = 1;

  for (const value of instance.values) {
    total += 1;
    if (typeof value !== "object" || value === null) continue;

    if (value.kind === "instance") {
      total += countNodes(value.instance);
    } else if (value.kind === "list") {
      for (const item of value.items) {
        total += countNodes(item.instance);
      }
    } else if (value.kind === "island" && value.slot) {
      total += countNodes(value.slot);
    }
  }

  return total;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
