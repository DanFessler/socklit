import { html } from "lit-html";

import { component, useStore, type RenderOutput } from "../../component";
import { keyed } from "../../keyed";
import { quoteKey, type OddsLedger, type Position } from "./ledger";
import {
  formatPrice,
  MarketSimulator,
  type BoardState,
  type Market,
  type Print,
  type Resolution,
  type Side,
} from "./market";

/** Size every button asks for. Book depth is often smaller, hence partial fills. */
export const TAKE_SIZE = 40;

const HISTORY_ROWS = 6;

/**
 * How a rendered quote is bound to the click that accepts it.
 *
 * `value` keys market rows by market, so a price change is a value patch and
 * the address of a button outlives the quote that was on it. That is cheap on
 * the wire and unsafe here: the runtime recommits handlers on every render, so
 * a click that arrives one tick late runs the *current* closure and takes the
 * current price, not the one the user accepted.
 *
 * `key` folds the quote generation into the row key. A moved market is a new
 * address, so a late click finds no handler and is refused as `stale_event`
 * instead of being executed at a price nobody agreed to. It costs the whole
 * value-only patch property: the key sequence changes, so the list is re-sent.
 *
 * Both are measured in research/probes/odds.md. This is a boot-wide setting
 * rather than a query parameter because it changes the shared tree.
 */
export type QuoteBinding = "value" | "key";

export type BoardOptions = {
  simulator: MarketSimulator;
  ledger: OddsLedger;
  /** Identity a fill is booked against. Present even when it is not displayed. */
  account: string;
  /** `?mine=1`. The only thing that can make one session's tree differ. */
  showAccount: boolean;
  tickMs: number;
  quoteBinding?: QuoteBinding;
};

/**
 * Places a take on behalf of one account.
 *
 * The board's only session-dependent prop. Every market row renders characters
 * that depend on shared state alone, then closes over this — which is why the
 * shareable region of the board is almost entirely handler-bearing.
 */
type Submit = (
  marketId: string,
  side: Side,
  limit: number,
  quoteSeq: number,
) => Promise<Resolution>;

/**
 * The odds board.
 *
 * Everything above the account panel is derived from shared state alone, so two
 * sessions on the default view render byte-identical trees. The panel is the
 * whole experiment: one small per-user subtree, opt-in, so the cost of
 * personalisation can be measured rather than argued about.
 *
 * The template below keeps the indentation it had when it lived inside a
 * per-session closure. lit-html's `strings` are replicated verbatim, so
 * reindenting it would be a wire change, and every byte of this probe is a
 * published measurement.
 */
export const OddsBoard = component(function OddsBoard(props: BoardOptions) {
  const simulator = useStore(props.simulator);
  const ledger = useStore(props.ledger);
  const { account, showAccount, tickMs } = props;

  const binding = props.quoteBinding ?? "value";
  const keyOf =
    binding === "key"
      ? (market: Market): string => `${market.id}:${market.quote}`
      : (market: Market): string => market.id;

  const submit: Submit = (marketId, side, limit, quoteSeq) =>
    // Intent, not a delta: the limit is the worst price the user accepted and
    // the quote sequence scopes the idempotency key, so this request means the
    // same thing whether it lands now, twice, or a round trip late.
    ledger.take(
      { account, marketId, side, limit, size: TAKE_SIZE, quoteSeq },
      (request) => simulator.take(request),
    );

  const state = simulator.state;

  return html`
      <header class="app-header" data-tick="${stamp(state)}">
        <h1>Odds board</h1>
        <p>
          ${state.markets.length} markets · tick ${state.seq} every ${tickMs}ms ·
          ${state.prints} prints · ${state.volume} traded
        </p>
      </header>

      <ul class="todo-list">
        ${keyed(state.markets, keyOf, (market) =>
          MarketRow({ market, seq: state.seq, submit }),
        )}
      </ul>

      <footer class="app-footer">
        <span>Tape · last ${state.tape.length} prints</span>
        <span>Prices are simulated. Add ?mine=1 for your own book.</span>
      </footer>

      <ul class="todo-list">
        ${keyed(
          state.tape,
          (print) => print.id,
          (print) => PrintRow({ print }),
        )}
      </ul>

      ${showAccount ? AccountPanel({ ledger, account, state }) : null}
    `;
});

/**
 * `t<seq>@<epoch ms>`, so a load harness can time one tick's fan-out.
 *
 * It rides on an attribute rather than visible text because it is
 * instrumentation, not content — but it is an ordinary hole, so it patches and
 * is identical in every session.
 */
export function stamp(state: BoardState): string {
  return `t${state.seq}@${state.emittedAt.toFixed(3)}`;
}

/**
 * One market.
 *
 * Hole order is part of the test surface: the sell handler is the first event
 * hole in the row and the buy handler the second, which is how a test addresses
 * a button without a browser. Nothing else in the row is a handler.
 */
const MarketRow = component(function MarketRow(props: {
  market: Market;
  seq: number;
  submit: Submit;
}) {
  const { market, seq, submit } = props;

  return html`
    <li class="todo" data-move="${direction(market.move)}">
      <span class="todo-text">${market.name}</span>
      <span class="revision">${arrow(market.move)} ${formatPrice(market.mid)}</span>
      <button
        class="remove"
        type="button"
        title="Sell at the bid"
        @click=${() => submit(market.id, "sell", market.bid, seq)}
      >
        ${formatPrice(market.bid)} × ${market.bidSize}
      </button>
      <button
        class="primary"
        type="button"
        title="Buy at the offer"
        @click=${() => submit(market.id, "buy", market.ask, seq)}
      >
        ${formatPrice(market.ask)} × ${market.askSize}
      </button>
      <span class="revision">last ${formatPrice(market.last)} · vol ${market.volume}</span>
    </li>
  `;
});

const PrintRow = component(function PrintRow(props: { print: Print }) {
  const { print } = props;

  return html`
    <li class="todo">
      <span class="revision">${clockOf(print.at)}</span>
      <span class="todo-text">${print.name}</span>
      <span class="revision">
        ${print.side === "buy" ? "TAKEN" : "GIVEN"} ${formatPrice(print.price)} ×
        ${print.size}${print.origin === "taken" ? " ·" : ""}
      </span>
    </li>
  `;
});

/**
 * The per-user subtree, and the reason `?mine=1` exists.
 *
 * The account label alone guarantees this session's tree differs from every
 * other session's, which is exactly the case design-probes.md predicts collapses
 * session-level sharing.
 *
 * Its two row templates stay inline rather than becoming components of their
 * own. Hoisting them to module scope would reindent them, and their leading
 * whitespace is on the wire.
 */
const AccountPanel = component(function AccountPanel(props: {
  ledger: OddsLedger;
  account: string;
  state: BoardState;
}) {
  const ledger = useStore(props.ledger);
  const { account, state } = props;

  const positions = ledger.positions(account);
  const history = ledger.history(account, HISTORY_ROWS);
  const open = positions.reduce((total, position) => total + profit(position, state), 0);

  return html`
    <section class="inspector">
      <div class="inspector-header">
        <h2>Your book · ${account}</h2>
        <p class="inspector-summary">
          ${positions.length} open · ${formatSigned(open)} unrealised
        </p>
      </div>

      <ul class="todo-list">
        ${keyed(
          positions,
          (position) => position.marketId,
          (position) => html`
            <li class="todo">
              <span class="todo-text">${position.name}</span>
              <span class="revision">
                ${position.size > 0 ? "long" : "short"} ${Math.abs(position.size)} @
                ${formatPrice(Math.round(position.cost / position.size))}
              </span>
              <span class="revision">${formatSigned(profit(position, state))}</span>
            </li>
          `,
        )}
      </ul>

      <ul class="protocol-entries">
        ${keyed(
          history,
          (resolution) => quoteKey(resolution),
          (resolution) => html`
            <li data-direction="${resolution.status === "rejected" ? "in" : "out"}">
              <span class="protocol-label">
                ${resolution.status} · ${resolution.side} ${resolution.name} ·
                ${resolution.price === null
                  ? `limit ${formatPrice(resolution.limit)}`
                  : `${resolution.filled} @ ${formatPrice(resolution.price)}`}
                ${resolution.reason === null ? "" : `· ${resolution.reason}`}
              </span>
              <span class="protocol-size">${clockOf(resolution.at)}</span>
            </li>
          `,
        )}
      </ul>
    </section>
  `;
});

/**
 * One session's view of the board.
 *
 * Nothing here is retained: the board holds no per-session UI state, so the
 * session is the options bag and the component tree is rebuilt from shared
 * state on every render.
 */
export function createOddsBoard(options: BoardOptions): () => RenderOutput {
  return () => OddsBoard(options);
}

function profit(position: Position, state: BoardState): number {
  const market = state.markets.find(
    (candidate) => candidate.id === position.marketId,
  );
  if (!market) return 0;
  return position.size * market.mid - position.cost;
}

function formatSigned(ticks: number): string {
  const sign = ticks > 0 ? "+" : ticks < 0 ? "−" : "";
  return `${sign}${formatPrice(Math.abs(ticks))}`;
}

function direction(move: number): string {
  return move > 0 ? "up" : move < 0 ? "down" : "flat";
}

function arrow(move: number): string {
  return move > 0 ? "▲" : move < 0 ? "▼" : "·";
}

/** UTC clock, so every session renders the same characters. */
function clockOf(at: number): string {
  return new Date(at).toISOString().slice(11, 19);
}
