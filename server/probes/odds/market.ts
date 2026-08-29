/**
 * The shared market simulator.
 *
 * Every session reads this one object, so the board is impersonal by
 * construction: there is no per-user input to the prices at all. That is
 * deliberate. research/economics.md finding 3 claims the architecture is
 * structurally superior when many sessions view an identical tree, and this is
 * the most favourable possible shape for that claim.
 *
 * Prices are in integer ticks (hundredths) rather than floats so a replay of
 * the same seed produces exactly the same board, which is what lets tests
 * assert on fills.
 *
 * Nothing here is durable. Prices are a simulation and are allowed to die with
 * the process; only the consequences of a take are written to disk, in
 * ledger.ts.
 */

export const PRICE_SCALE = 100;
export const MAX_TAKE_SIZE = 500;

export type Side = "buy" | "sell";

export type Market = {
  readonly id: string;
  readonly name: string;
  /** Mid price in ticks. */
  readonly mid: number;
  readonly bid: number;
  readonly ask: number;
  readonly bidSize: number;
  readonly askSize: number;
  /**
   * Increments whenever the quoted price changes.
   *
   * A generation rather than the price itself, so it can seed a list key
   * without putting a number the user cares about into an address.
   */
  readonly quote: number;
  /** Last printed price in ticks. */
  readonly last: number;
  /** Mid movement on the most recent tick, in ticks. */
  readonly move: number;
  readonly volume: number;
};

export type PrintOrigin = "flow" | "taken";

/** One line of the public tape. Deliberately carries no account. */
export type Print = {
  readonly id: string;
  readonly marketId: string;
  readonly name: string;
  readonly side: Side;
  readonly price: number;
  readonly size: number;
  readonly at: number;
  readonly origin: PrintOrigin;
};

export type BoardState = {
  readonly seq: number;
  readonly emittedAt: number;
  readonly markets: readonly Market[];
  readonly tape: readonly Print[];
  readonly prints: number;
  readonly volume: number;
};

export type TakeRequest = {
  readonly account: string;
  readonly marketId: string;
  readonly side: Side;
  /**
   * The price the user was looking at, in ticks. A buy fills at or below it, a
   * sell at or above it.
   *
   * This is what makes the interaction intent-shaped rather than a delta: the
   * request stays meaningful however late it arrives, because it names the
   * worst price the user is willing to accept instead of saying "take whatever
   * is there now".
   */
  readonly limit: number;
  readonly size: number;
  /** Tick the quote was rendered from. Scopes the idempotency key. */
  readonly quoteSeq: number;
};

export type ResolutionStatus = "filled" | "partial" | "rejected";

export type Resolution = {
  readonly status: ResolutionStatus;
  readonly account: string;
  readonly marketId: string;
  readonly name: string;
  readonly side: Side;
  readonly requested: number;
  readonly filled: number;
  /** Average fill price in ticks, or null when nothing filled. */
  readonly price: number | null;
  readonly limit: number;
  readonly reason: string | null;
  readonly quoteSeq: number;
  readonly at: number;
};

export type SimulatorOptions = {
  markets?: number;
  seed?: number;
  tapeSize?: number;
  /** Probability per market per tick of a synthetic print from other flow. */
  printChance?: number;
  /** Probability per market per tick that its price moves at all. */
  moveChance?: number;
  now?: () => number;
};

/**
 * Epoch milliseconds with sub-millisecond resolution.
 *
 * `Date.now()` is quantised to about a millisecond on Windows, which is the
 * same order as the thing a fan-out measurement is trying to see. Tying the
 * monotonic clock to `timeOrigin` keeps the value comparable across processes,
 * so a load harness can subtract it from its own arrival timestamps.
 */
export function epochMicros(): number {
  return performance.timeOrigin + performance.now();
}

const MIN_MID = 105;
const MAX_MID = 4000;
const MIN_DEPTH = 12;
const MAX_DEPTH = 110;

const FIXTURES = [
  "Aldergrove v Barrow",
  "Camberwell v Dunmore",
  "Eastleigh v Fairholme",
  "Garrowby v Hexham",
  "Ilkley v Jarrow",
  "Kelvedon v Lorton",
  "Marsden v Northwich",
  "Oakworth v Pendlebury",
];

const OUTCOMES = ["Home", "Draw", "Away", "Over 2.5", "Both to score"];

/**
 * Deterministic PRNG, so the same seed replays the same market.
 *
 * Math.random would make every fill assertion in the tests a coin flip.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export class MarketSimulator {
  private current: BoardState;
  private readonly listeners = new Set<() => void>();
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly tapeSize: number;
  private readonly printChance: number;
  private readonly moveChance: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private printCounter = 0;

  constructor(options: SimulatorOptions = {}) {
    this.random = mulberry32(options.seed ?? 7);
    this.now = options.now ?? epochMicros;
    this.tapeSize = options.tapeSize ?? 20;
    this.printChance = options.printChance ?? 0.006;
    this.moveChance = options.moveChance ?? 0.4;

    const count = options.markets ?? 40;
    const markets: Market[] = [];
    for (let index = 0; index < count; index += 1) {
      const fixture = FIXTURES[index % FIXTURES.length] ?? "Fixture";
      const outcome =
        OUTCOMES[Math.floor(index / FIXTURES.length) % OUTCOMES.length] ??
        "Home";
      const mid = clamp(
        Math.round(120 + this.random() * 900),
        MIN_MID,
        MAX_MID,
      );
      const spread = 1 + Math.floor(this.random() * 3);

      markets.push({
        id: `m${index + 1}`,
        name: `${fixture} · ${outcome}`,
        mid,
        bid: mid - Math.ceil(spread / 2),
        ask: mid - Math.ceil(spread / 2) + spread,
        bidSize: this.depth(),
        askSize: this.depth(),
        quote: 1,
        last: mid,
        move: 0,
        volume: 0,
      });
    }

    // The tape starts full. A board that has just opened still shows recent
    // prints, and it keeps the tree the same size from the first render, which
    // matters when the tree size is the thing being measured.
    const at = this.now();
    const tape: Print[] = [];
    let volume = 0;
    for (let index = 0; index < this.tapeSize && markets.length > 0; index += 1) {
      const market = markets[Math.floor(this.random() * markets.length)];
      if (!market) continue;
      const side: Side = this.random() < 0.5 ? "buy" : "sell";
      const size = 5 + Math.floor(this.random() * 45);
      tape.push(
        this.print(
          market,
          side,
          side === "buy" ? market.ask : market.bid,
          size,
          at - (this.tapeSize - index) * 1000,
          "flow",
        ),
      );
      volume += size;
    }

    this.current = {
      seq: 0,
      emittedAt: at,
      markets,
      tape: tape.reverse(),
      prints: tape.length,
      volume,
    };
  }

  get state(): BoardState {
    return this.current;
  }

  onTick(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(tickMs: number): void {
    this.stop();
    this.timer = setInterval(() => this.tick(), tickMs);
    // The simulator must not be the reason the process stays alive.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Advances the whole board once.
   *
   * Only a fraction of markets move on any given tick, which is realistic and
   * also makes a point worth measuring: the wire cost of a tick scales with
   * what changed, while render and diff cost scales with the size of the tree
   * regardless.
   */
  tick(): void {
    const previous = this.current;
    const at = this.now();
    const markets: Market[] = [];
    const prints: Print[] = [];
    let volume = previous.volume;

    for (const market of previous.markets) {
      let next = market;

      if (this.random() < this.moveChance) {
        const drift = Math.round((this.random() * 2 - 1) * 3);
        const mid = clamp(market.mid + drift, MIN_MID, MAX_MID);
        const spread = 1 + Math.floor(this.random() * 3);
        const bid = mid - Math.ceil(spread / 2);

        next = {
          ...market,
          mid,
          bid,
          ask: bid + spread,
          bidSize: this.depth(),
          askSize: this.depth(),
          quote: market.quote + 1,
          move: mid - market.mid,
        };
      } else if (market.move !== 0) {
        next = { ...market, move: 0 };
      }

      if (this.random() < this.printChance) {
        const side: Side = this.random() < 0.5 ? "buy" : "sell";
        const size = 5 + Math.floor(this.random() * 45);
        const price = side === "buy" ? next.ask : next.bid;

        prints.push(this.print(next, side, price, size, at, "flow"));
        volume += size;
        next = { ...next, last: price, volume: next.volume + size };
      }

      markets.push(next);
    }

    this.current = {
      seq: previous.seq + 1,
      emittedAt: at,
      markets,
      tape: prints.length === 0 ? previous.tape : this.extendTape(previous.tape, prints),
      prints: previous.prints + prints.length,
      volume,
    };

    this.notify();
  }

  /**
   * Resolves a take against the live book.
   *
   * The rendered quote is not trusted: the current level is re-read here and
   * the request is refused if the market has moved past the price the user
   * accepted. Depth is consumed, so two sessions citing the same quote get
   * different answers — the first may fill, the second partially fill or be
   * rejected. That is the point of the probe.
   *
   * Callers must serialize this behind the ledger mutex; see ledger.take.
   */
  take(request: TakeRequest): Resolution {
    const at = this.now();
    const market = this.current.markets.find(
      (candidate) => candidate.id === request.marketId,
    );

    const base = {
      account: request.account,
      marketId: request.marketId,
      name: market?.name ?? request.marketId,
      side: request.side,
      requested: request.size,
      limit: request.limit,
      quoteSeq: request.quoteSeq,
      at,
    } as const;

    const reject = (reason: string): Resolution => ({
      ...base,
      status: "rejected",
      filled: 0,
      price: null,
      reason,
    });

    if (!market) return reject("that market is no longer listed");
    if (
      !Number.isSafeInteger(request.size) ||
      request.size <= 0 ||
      request.size > MAX_TAKE_SIZE
    ) {
      return reject(`size must be between 1 and ${MAX_TAKE_SIZE}`);
    }

    const level = request.side === "buy" ? market.ask : market.bid;
    const available = request.side === "buy" ? market.askSize : market.bidSize;
    const acceptable =
      request.side === "buy" ? level <= request.limit : level >= request.limit;

    if (!acceptable) {
      return reject(
        `price moved to ${formatPrice(level)}, past your ${formatPrice(request.limit)}`,
      );
    }
    if (available <= 0) {
      return reject(`no size left at ${formatPrice(level)}`);
    }

    const filled = Math.min(request.size, available);
    const updated: Market = {
      ...market,
      bidSize: request.side === "sell" ? market.bidSize - filled : market.bidSize,
      askSize: request.side === "buy" ? market.askSize - filled : market.askSize,
      last: level,
      volume: market.volume + filled,
    };

    const print = this.print(updated, request.side, level, filled, at, "taken");

    this.current = {
      ...this.current,
      markets: this.current.markets.map((candidate) =>
        candidate.id === market.id ? updated : candidate,
      ),
      tape: this.extendTape(this.current.tape, [print]),
      prints: this.current.prints + 1,
      volume: this.current.volume + filled,
    };

    return {
      ...base,
      status: filled === request.size ? "filled" : "partial",
      filled,
      price: level,
      reason:
        filled === request.size
          ? null
          : `only ${filled} of ${request.size} available at ${formatPrice(level)}`,
    };
  }

  private print(
    market: Market,
    side: Side,
    price: number,
    size: number,
    at: number,
    origin: PrintOrigin,
  ): Print {
    this.printCounter += 1;
    return {
      id: `p${this.printCounter}`,
      marketId: market.id,
      name: market.name,
      side,
      price,
      size,
      at,
      origin,
    };
  }

  private extendTape(
    tape: readonly Print[],
    prints: readonly Print[],
  ): readonly Print[] {
    return [...prints].reverse().concat(tape).slice(0, this.tapeSize);
  }

  private depth(): number {
    return MIN_DEPTH + Math.floor(this.random() * (MAX_DEPTH - MIN_DEPTH));
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export function formatPrice(ticks: number): string {
  return (ticks / PRICE_SCALE).toFixed(2);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
