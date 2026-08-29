/**
 * Simulated network latency for the session protocol.
 *
 * On localhost every interaction is effectively free, which hides the central
 * cost of this architecture: interaction meaning lives on the server, so any
 * routed interaction costs a round trip. This makes that cost adjustable and
 * measurable per tab.
 */

export type LatencyProfile = {
  rttMs: number;
  jitter: boolean;
};

export const LATENCY_PRESETS: ReadonlyArray<{ rttMs: number; label: string }> = [
  { rttMs: 0, label: "off (localhost)" },
  { rttMs: 50, label: "50 ms same region" },
  { rttMs: 150, label: "150 ms cross country" },
  { rttMs: 400, label: "400 ms poor mobile" },
  { rttMs: 800, label: "800 ms satellite" },
];

const STORAGE_KEY = "socklit.latency";

export function readLatencyProfile(search: string): LatencyProfile {
  const params = new URLSearchParams(search);
  const requested = params.get("latency");

  if (requested !== null) {
    const rttMs = Number(requested);
    if (Number.isFinite(rttMs) && rttMs >= 0) {
      return { rttMs, jitter: params.get("jitter") === "1" };
    }
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<LatencyProfile>;
      if (typeof parsed.rttMs === "number" && parsed.rttMs >= 0) {
        return { rttMs: parsed.rttMs, jitter: parsed.jitter === true };
      }
    }
  } catch {
    // A malformed or unavailable store just means no simulated latency.
  }

  return { rttMs: 0, jitter: false };
}

export function writeLatencyProfile(profile: LatencyProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Persistence is a convenience, not a requirement.
  }
}

/** Half of the round trip, optionally spread by +/-50% to model jitter. */
export function oneWayDelay(profile: LatencyProfile): number {
  const base = profile.rttMs / 2;
  if (base <= 0) return 0;
  return profile.jitter ? base * (0.5 + Math.random()) : base;
}

/**
 * Delays delivery while preserving order.
 *
 * Independent timers would let a jittered message overtake an earlier one, and
 * patches are applied positionally against the replica, so reordering would
 * corrupt it. Each item is therefore clamped to land no earlier than the item
 * queued before it.
 */
export class OrderedDelay<T> {
  private readonly deliver: (item: T) => void;
  private readonly queue: Array<{ item: T; readyAt: number }> = [];
  private timer: number | null = null;

  constructor(deliver: (item: T) => void) {
    this.deliver = deliver;
  }

  push(item: T, delayMs: number): void {
    // With no delay and nothing queued, behave exactly as an undelayed link.
    if (delayMs <= 0 && this.queue.length === 0) {
      this.deliver(item);
      return;
    }

    const previous = this.queue[this.queue.length - 1];
    const readyAt = Math.max(
      performance.now() + delayMs,
      previous?.readyAt ?? 0,
    );

    this.queue.push({ item, readyAt });
    this.schedule();
  }

  /** Drops anything in flight, for example when the socket closes. */
  clear(): void {
    this.queue.length = 0;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  private schedule(): void {
    if (this.timer !== null) return;

    const next = this.queue[0];
    if (!next) return;

    this.timer = window.setTimeout(
      () => {
        this.timer = null;
        this.flush();
      },
      Math.max(0, next.readyAt - performance.now()),
    );
  }

  private flush(): void {
    const now = performance.now();

    while (this.queue.length > 0) {
      const next = this.queue[0];
      if (!next || next.readyAt > now) break;
      this.queue.shift();
      this.deliver(next.item);
    }

    this.schedule();
  }
}
