import { createJsonStore, type JsonStore } from "../../json-store";
import type { Resolution, TakeRequest } from "./market";

/**
 * The durable half of the probe.
 *
 * Prices are a simulation and are allowed to die with the process. The
 * consequences of a take are not: a fill is the one fact in this app that has
 * to survive, so resolutions and positions are written through JsonStore.
 *
 * The resolution map doubles as an idempotency cache keyed by the quote the
 * user acted on, which is what makes a take safe to apply twice. That matters
 * more here than in the todo app: the runtime deliberately does not check that
 * a browser is on the current revision, so a double-click, a retry, or a
 * duplicated frame must not open a second position.
 */

export type Position = {
  readonly marketId: string;
  readonly name: string;
  /** Signed size: positive is long, negative is short. */
  readonly size: number;
  /** Signed cost in ticks, so profit is `size * mid - cost`. */
  readonly cost: number;
};

export type LedgerState = {
  /** Idempotency keys in insertion order, oldest first. */
  readonly order: readonly string[];
  readonly resolutions: Readonly<Record<string, Resolution>>;
  readonly positions: Readonly<Record<string, Readonly<Record<string, Position>>>>;
};

const MAX_RESOLUTIONS = 400;

export function quoteKey(request: {
  account: string;
  marketId: string;
  side: string;
  quoteSeq: number;
}): string {
  return `${request.account}|${request.marketId}|${request.side}|${request.quoteSeq}`;
}

export class OddsLedger {
  private readonly store: JsonStore<LedgerState>;

  constructor(store: JsonStore<LedgerState>) {
    this.store = store;
  }

  /**
   * Applies a take exactly once.
   *
   * `decide` runs inside the mutation, so it holds the store mutex: two
   * sessions taking the same quote are resolved one after the other against
   * the depth the earlier one left behind. Replaying a key returns the original
   * answer by reference, which JsonStore treats as a no-op — no write, no
   * re-render.
   */
  take(
    request: TakeRequest,
    decide: (request: TakeRequest) => Resolution,
  ): Promise<Resolution> {
    const key = quoteKey(request);

    return this.store.mutate((state) => {
      const existing = state.resolutions[key];
      if (existing) return { next: state, result: existing };

      const resolution = decide(request);
      return { next: apply(state, key, resolution), result: resolution };
    });
  }

  /** Most recent resolutions for one account, newest first. */
  history(account: string, limit: number): readonly Resolution[] {
    const state = this.store.state;
    const found: Resolution[] = [];

    for (let index = state.order.length - 1; index >= 0; index -= 1) {
      const key = state.order[index];
      if (key === undefined) continue;
      const resolution = state.resolutions[key];
      if (resolution && resolution.account === account) found.push(resolution);
      if (found.length >= limit) break;
    }

    return found;
  }

  positions(account: string): readonly Position[] {
    const held = this.store.state.positions[account];
    if (!held) return [];
    return Object.values(held).filter((position) => position.size !== 0);
  }

  onChange(listener: () => void): () => void {
    return this.store.onChange(listener);
  }
}

export async function createOddsLedger(file: string): Promise<OddsLedger> {
  const store = await createJsonStore<LedgerState>({
    file,
    initial: () => ({ order: [], resolutions: {}, positions: {} }),
    parse: parseLedgerFile,
  });
  return new OddsLedger(store);
}

function apply(
  state: LedgerState,
  key: string,
  resolution: Resolution,
): LedgerState {
  const order = [...state.order, key];
  const resolutions: Record<string, Resolution> = {
    ...state.resolutions,
    [key]: resolution,
  };

  // Bounded, or a long-running board would grow the file without limit.
  while (order.length > MAX_RESOLUTIONS) {
    const evicted = order.shift();
    if (evicted !== undefined) delete resolutions[evicted];
  }

  if (resolution.filled === 0 || resolution.price === null) {
    return { order, resolutions, positions: state.positions };
  }

  const signed = resolution.side === "buy" ? resolution.filled : -resolution.filled;
  const account = state.positions[resolution.account] ?? {};
  const current = account[resolution.marketId];

  const position: Position = {
    marketId: resolution.marketId,
    name: resolution.name,
    size: (current?.size ?? 0) + signed,
    cost: (current?.cost ?? 0) + signed * resolution.price,
  };

  return {
    order,
    resolutions,
    positions: {
      ...state.positions,
      [resolution.account]: {
        ...account,
        [resolution.marketId]: position,
      },
    },
  };
}

/** Drops anything that does not match the shape rather than failing to boot. */
function parseLedgerFile(raw: unknown): LedgerState {
  if (!isRecord(raw)) return { order: [], resolutions: {}, positions: {} };

  const resolutions: Record<string, Resolution> = {};
  const rawResolutions = raw["resolutions"];
  if (isRecord(rawResolutions)) {
    for (const [key, value] of Object.entries(rawResolutions)) {
      const resolution = parseResolution(value);
      if (resolution) resolutions[key] = resolution;
    }
  }

  const order = Array.isArray(raw["order"])
    ? raw["order"].filter(
        (key): key is string => typeof key === "string" && key in resolutions,
      )
    : [];

  const positions: Record<string, Record<string, Position>> = {};
  const rawPositions = raw["positions"];
  if (isRecord(rawPositions)) {
    for (const [account, held] of Object.entries(rawPositions)) {
      if (!isRecord(held)) continue;
      const parsed: Record<string, Position> = {};
      for (const [marketId, value] of Object.entries(held)) {
        const position = parsePosition(value);
        if (position) parsed[marketId] = position;
      }
      if (Object.keys(parsed).length > 0) positions[account] = parsed;
    }
  }

  return { order, resolutions, positions };
}

function parseResolution(value: unknown): Resolution | null {
  if (!isRecord(value)) return null;

  const status = value["status"];
  const side = value["side"];
  if (status !== "filled" && status !== "partial" && status !== "rejected") {
    return null;
  }
  if (side !== "buy" && side !== "sell") return null;

  const price = value["price"];
  const reason = value["reason"];

  if (
    typeof value["account"] !== "string" ||
    typeof value["marketId"] !== "string" ||
    typeof value["name"] !== "string" ||
    !Number.isFinite(value["requested"]) ||
    !Number.isFinite(value["filled"]) ||
    !Number.isFinite(value["limit"]) ||
    !Number.isFinite(value["quoteSeq"]) ||
    !Number.isFinite(value["at"]) ||
    (price !== null && !Number.isFinite(price)) ||
    (reason !== null && typeof reason !== "string")
  ) {
    return null;
  }

  return {
    status,
    side,
    account: value["account"],
    marketId: value["marketId"],
    name: value["name"],
    requested: value["requested"] as number,
    filled: value["filled"] as number,
    limit: value["limit"] as number,
    quoteSeq: value["quoteSeq"] as number,
    at: value["at"] as number,
    price: price as number | null,
    reason: reason as string | null,
  };
}

function parsePosition(value: unknown): Position | null {
  if (!isRecord(value)) return null;
  if (
    typeof value["marketId"] !== "string" ||
    typeof value["name"] !== "string" ||
    !Number.isFinite(value["size"]) ||
    !Number.isFinite(value["cost"])
  ) {
    return null;
  }

  return {
    marketId: value["marketId"],
    name: value["name"],
    size: value["size"] as number,
    cost: value["cost"] as number,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
