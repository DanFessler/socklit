import { clearInterval, setInterval } from "node:timers";

/**
 * The one piece of shared state in this probe: the current second.
 *
 * It is deliberately the smallest possible authoritative datum — eight
 * characters, read by one hole — so that everything /metrics reports about the
 * cost of publishing it is attributable to the runtime rather than to the app.
 *
 * The timer only runs while at least one session is attached and ticking is
 * enabled, so an unwatched probe costs nothing. That is a property of this
 * store, not of the runtime: the runtime subscribes once at boot and never
 * tells a probe whether anyone is connected.
 */

export type ClockState = {
  /** Epoch milliseconds sampled at the last tick. */
  now: number;
  ticks: number;
  running: boolean;
  intervalMs: number;
  sessions: number;
};

export type ClockStore = {
  state: () => ClockState;
  /** Absolute intent, per authoring rule I6: never a toggle. */
  setRunning: (running: boolean) => void;
  setIntervalMs: (intervalMs: number) => void;
  /** Publishes one tick. The interval calls this; tests call it directly. */
  tick: () => void;
  onChange: (listener: () => void) => () => void;
  /** Registers a live session and returns its detach function. */
  attach: () => () => void;
  /** Whether a timer is currently armed, for tests and for leak checks. */
  isTicking: () => boolean;
  dispose: () => void;
};

export type ClockStoreOptions = {
  now?: () => number;
  intervalMs?: number;
  running?: boolean;
  /** Off in tests, where ticks are driven by calling `tick()` directly. */
  autoTick?: boolean;
};

export const MIN_INTERVAL_MS = 20;
export const MAX_INTERVAL_MS = 60_000;
export const DEFAULT_INTERVAL_MS = 1000;

export function createClockStore(options: ClockStoreOptions = {}): ClockStore {
  const now = options.now ?? Date.now;
  const autoTick = options.autoTick ?? true;

  let intervalMs = clampInterval(options.intervalMs ?? DEFAULT_INTERVAL_MS);
  let running = options.running ?? true;
  let sessions = 0;
  let ticks = 0;
  let current = now();
  let timer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

  const listeners = new Set<() => void>();

  function publish(): void {
    for (const listener of [...listeners]) listener();
  }

  function tick(): void {
    if (disposed) return;
    ticks += 1;
    current = now();
    publish();
  }

  /** Arms or disarms the interval to match the state it should have. */
  function syncTimer(): void {
    const wanted = autoTick && running && sessions > 0 && !disposed;

    if (wanted && timer === null) {
      timer = setInterval(tick, intervalMs);
      // The clock must never be the reason a process stays alive.
      timer.unref?.();
      return;
    }

    if (!wanted && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    state: () => ({ now: current, ticks, running, intervalMs, sessions }),

    setRunning(next: boolean): void {
      // No-op short circuit: asking for the state the store is already in must
      // not invalidate every session.
      if (typeof next !== "boolean" || next === running) return;
      running = next;
      syncTimer();
      publish();
    },

    setIntervalMs(next: number): void {
      const clamped = clampInterval(next);
      if (clamped === intervalMs) return;
      intervalMs = clamped;

      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      syncTimer();
      publish();
    },

    tick,

    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    attach(): () => void {
      sessions += 1;
      syncTimer();

      let detached = false;
      return () => {
        if (detached) return;
        detached = true;
        sessions = Math.max(0, sessions - 1);
        syncTimer();
      };
    },

    isTicking: () => timer !== null,

    dispose(): void {
      disposed = true;
      listeners.clear();
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

export function clampInterval(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_INTERVAL_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(value)));
}

/** Seconds resolution, so a tick faster than 1 Hz changes nothing on screen. */
export function formatClock(epochMs: number): string {
  const date = new Date(epochMs);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}
