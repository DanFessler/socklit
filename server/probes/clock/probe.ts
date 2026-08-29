import type { Probe, ProbeContext, SessionContext } from "../types";
import { createClockApp } from "./clock-app";
import { createClockStore, type ClockStore } from "./clock-store";
import { createRowSource, type RowSource } from "./dataset";

/**
 * S3: what is the granularity of invalidation?
 *
 * A once-per-second change to one string, next to an arbitrarily large body of
 * content that does not depend on it. The runtime has exactly one granularity,
 * so the whole app re-runs for every session on every tick; the size of the
 * inert part is a query parameter so the cost of that can be plotted rather
 * than asserted.
 *
 * Query parameters (all optional):
 *   ?rows=500      inert rows in this session's tree (default 200, max 20000)
 *   ?clock=off     hide the clock, so this session depends on nothing shared
 *   ?counter=on    show a per-session render count
 *   ?tickMs=250    shared tick interval; a rate above 1 Hz produces renders
 *                  that change nothing at all
 *   ?running=off   pause ticking, so the server can be left idle
 *
 * `tickMs` and `running` write shared state from a per-session parameter, so
 * the last connection wins. That is deliberate — it is how a load script leaves
 * the server quiet — but it is not a pattern to copy into a real app.
 */

const DEFAULT_ROWS = 200;
const MAX_ROWS = 20_000;

export type ClockProbeOptions = {
  store?: ClockStore;
  rows?: RowSource;
  log?: (message: string) => void;
};

export function createClockProbe(options: ClockProbeOptions = {}): Probe {
  const store = options.store ?? createClockStore();
  const rows = options.rows ?? createRowSource();
  const log = options.log ?? (() => {});

  return {
    id: "clock",
    title: "Ticking clock",
    forces: "S3",

    subscribe: (listener) => store.onChange(listener),

    createApp: (session: SessionContext) => {
      const rowCount = readInt(
        session.params.get("rows"),
        DEFAULT_ROWS,
        0,
        MAX_ROWS,
      );

      const tickMs = session.params.get("tickMs");
      if (tickMs !== null) store.setIntervalMs(Number(tickMs));

      const running = session.params.get("running");
      if (running !== null) store.setRunning(isOn(running));

      // Registered before the first render so the timer is already armed, and
      // released in dispose() so the last session leaving stops it.
      const detach = store.attach();
      log(`session ${session.id} attached with ${rowCount} rows`);

      const app = createClockApp({
        store,
        rows: rows.take(rowCount),
        showClock: isOn(session.params.get("clock") ?? "on"),
        countRenders: isOn(session.params.get("counter") ?? "off"),
      });

      return { app, dispose: detach };
    },
  };
}

export async function create(context: ProbeContext): Promise<Probe> {
  return createClockProbe({ log: context.log });
}

function readInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function isOn(raw: string): boolean {
  return raw !== "off" && raw !== "0" && raw !== "false";
}
