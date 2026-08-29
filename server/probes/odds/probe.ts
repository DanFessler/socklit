import type { Probe, ProbeContext } from "../types";
import { createOddsBoard, type QuoteBinding } from "./board";
import { createOddsLedger } from "./ledger";
import { MarketSimulator } from "./market";

/**
 * Odds board: high fan-out over one identical view, plus an interaction whose
 * outcome a client is not allowed to guess.
 *
 * Forces S1 and A6 because every session renders the same tree, so the entire
 * render cost above one session is provably redundant — and forces A4 because
 * no client can predict whether a take fills, partially fills, or is rejected.
 *
 * Configured from the environment rather than the query string, since the
 * simulator is shared: ODDS_TICK_MS, ODDS_MARKETS, ODDS_TAPE, ODDS_SEED,
 * ODDS_PRINT_CHANCE, ODDS_MOVE_CHANCE, ODDS_QUOTE_BINDING.
 */
export async function create(context: ProbeContext): Promise<Probe> {
  const tickMs = readNumber(process.env["ODDS_TICK_MS"], 250, 10, 60_000);
  const markets = readNumber(process.env["ODDS_MARKETS"], 40, 1, 400);
  const tapeSize = readNumber(process.env["ODDS_TAPE"], 20, 0, 200);
  const seed = readNumber(process.env["ODDS_SEED"], 7, 1, 2 ** 31 - 1);
  const printChance = readNumber(process.env["ODDS_PRINT_CHANCE"], 0.006, 0, 1);
  const moveChance = readNumber(process.env["ODDS_MOVE_CHANCE"], 0.4, 0, 1);
  const quoteBinding: QuoteBinding =
    process.env["ODDS_QUOTE_BINDING"] === "key" ? "key" : "value";

  const simulator = new MarketSimulator({
    markets,
    tapeSize,
    seed,
    printChance,
    moveChance,
  });
  const ledger = await createOddsLedger(context.dataFile("ledger.json"));

  simulator.start(tickMs);
  context.log(
    `${markets} markets ticking every ${tickMs}ms, quotes bound by ${quoteBinding}`,
  );

  return {
    id: "odds",
    title: "Odds board",
    forces: "S1, A6, A4",
    subscribe: (listener) => {
      // Both are shared state, so both re-render every session. The ledger is
      // the interesting one: a fill belonging to one account invalidates every
      // session on the board, which is S3 in miniature.
      const stopTicks = simulator.onTick(listener);
      const stopLedger = ledger.onChange(listener);
      return () => {
        stopTicks();
        stopLedger();
      };
    },
    createApp: (session) => {
      const requested = session.params.get("user")?.trim();
      const account =
        requested !== undefined && requested.length > 0
          ? requested.slice(0, 40)
          : `acct-${session.id}`;

      return {
        app: createOddsBoard({
          simulator,
          ledger,
          account,
          showAccount: session.params.get("mine") === "1",
          tickMs,
          quoteBinding,
        }),
      };
    },
  };
}

function readNumber(
  raw: string | undefined,
  fallback: number,
  low: number,
  high: number,
): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < low || parsed > high) return fallback;
  return parsed;
}
