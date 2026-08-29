import { html } from "lit-html";

import type { ChangePayload } from "../../../shared/protocol";
import { component, useStore, type RenderOutput } from "../../component";
import { keyed } from "../../keyed";
import {
  addDays,
  deriveLedger,
  formatAmount,
  formatPercent,
  formatRate,
  type AccountRollup,
  type AgingBucket,
  type BalanceRow as BalanceRowData,
  type JournalRow as JournalRowData,
  type LedgerView,
  type LineView,
  type PostedDocument,
  type TaxRollup,
} from "./ledger-model";
import type { LedgerStore } from "./ledger-store";

/**
 * The whole application.
 *
 * Read it as the probe's primary evidence. There are eleven derived views
 * below, every one of them a projection of `deriveLedger`, and there is no
 * endpoint, no response type, no cache key, no invalidation call and no loading
 * state anywhere in the file. A handler names an outcome and returns; the
 * runtime re-renders and diffs.
 *
 * Every panel is a module-scope component taking the slice of the derived view
 * it renders as a prop. Not one of them holds a hook: the ledger is shared
 * authoritative state and there is nothing a single session can diverge on, so
 * the only hook here is the `useStore` that marks where the read happens.
 */
export const LedgerApp = component(function LedgerApp(props: {
  store: LedgerStore;
}) {
  const store = useStore(props.store);
  const ledger = store.read();
  const view = deriveLedger(ledger);

  // Indented one level deeper than this function, and it has to stay that way:
  // everything outside a `${}` is template bytes the browser downloads, so
  // reformatting the literal is a wire change.
  return html`
      <style>
        .ledger { font-variant-numeric: tabular-nums; }
        .ledger h1 { margin: 0; font-size: 1.5rem; letter-spacing: -0.01em; }
        .ledger .lede { margin: 0.35rem 0 1.25rem; color: #93a0b1; font-size: 0.88rem; }
        .ledger section { margin-top: 1.5rem; }
        .ledger h2 {
          margin: 0 0 0.6rem;
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.09em;
          color: #93a0b1;
        }
        .ledger table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
        .ledger th {
          text-align: right;
          font-weight: 600;
          font-size: 0.68rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #93a0b1;
          padding: 0.3rem 0.4rem;
          border-bottom: 1px solid #333c49;
          white-space: nowrap;
        }
        .ledger th.l, .ledger td.l { text-align: left; }
        .ledger td {
          text-align: right;
          padding: 0.25rem 0.4rem;
          border-bottom: 1px solid #262d38;
          white-space: nowrap;
        }
        .ledger tfoot td { border-bottom: none; border-top: 1px solid #333c49; font-weight: 600; }
        .ledger input, .ledger select {
          width: 100%;
          min-width: 3.5rem;
          padding: 0.25rem 0.35rem;
          background: #1a1e26;
          border: 1px solid #333c49;
          border-radius: 5px;
          color: #e7ebf1;
          font: inherit;
          font-size: 0.82rem;
          text-align: right;
        }
        .ledger input.l, .ledger select { text-align: left; }
        .ledger .derived { color: #93a0b1; }
        .ledger .strong { color: #e7ebf1; font-weight: 600; }
        .ledger .warn { color: #e2687f; }
        .ledger .ok { color: #6fc09a; }
        .ledger .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 1.5rem; }
        .ledger .toolbar { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-top: 0.75rem; }
        .ledger button {
          padding: 0.35rem 0.7rem;
          background: #242b35;
          border: 1px solid #333c49;
          border-radius: 6px;
          color: #e7ebf1;
          font: inherit;
          font-size: 0.8rem;
          cursor: pointer;
        }
        .ledger button:hover { border-color: #a86fc0; }
        .ledger button.post { background: #612f76; border-color: #a86fc0; font-weight: 600; }
        .ledger button.post[disabled] { opacity: 0.4; cursor: not-allowed; }
        .ledger .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 0.6rem; }
        .ledger .field { display: flex; flex-direction: column; gap: 0.2rem; }
        .ledger .field span {
          font-size: 0.66rem;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: #93a0b1;
        }
        .ledger .note { margin: 0.5rem 0 0; font-size: 0.76rem; color: #93a0b1; }
        .ledger .badge { font-size: 0.7rem; color: #e2687f; }
      </style>

      <div class="ledger">
        <h1>Accounts receivable</h1>
        <p class="lede">
          One document, eleven derived views. Edit any line and watch every total
          move in the same frame.
        </p>

        ${DocumentHeader({ store, view })} ${LineTable({ store, view })}
        ${TotalsPanel({ view })}

        <div class="grid">
          ${AccountRollupPanel({ view })} ${TaxRollupPanel({ view })}
        </div>

        ${JournalPanel({ view })}

        <div class="grid">
          ${AgingPanel({ store, view })} ${BalancePanel({ view })}
        </div>

        ${PostedPanel({ store, posted: ledger.posted })} ${BenchPanel({ store, view })}
      </div>
    `;
});

/* ----------------------------------------------------------- document -- */

const DocumentHeader = component(function DocumentHeader(props: {
  store: LedgerStore;
  view: LedgerView;
}) {
  const { store, view } = props;

  return html`
    <section>
      <h2>Document</h2>
      <div class="fields">
        <label class="field">
          <span>Customer</span>
          <input
            class="l"
            type="text"
            maxlength="80"
            .value=${view.customer}
            @change=${(event: ChangePayload) =>
              store.setCustomer(event.value ?? "")}
          />
        </label>
        <label class="field">
          <span>Currency</span>
          <select
            .value=${view.currency}
            @change=${(event: ChangePayload) =>
              store.setCurrency(event.value ?? "USD")}
          >
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
            <option value="CHF">CHF</option>
          </select>
        </label>
        <label class="field">
          <span>Discount %</span>
          <input
            type="number"
            min="0"
            max="50"
            step="0.25"
            .value=${(view.discountBp / 100).toFixed(2)}
            @change=${(event: ChangePayload) =>
              store.setDiscountBp(parsePercentToBp(event.value))}
          />
        </label>
        <label class="field">
          <span>Terms, days</span>
          <input
            type="number"
            min="0"
            max="365"
            step="1"
            .value=${view.dueInDays}
            @change=${(event: ChangePayload) =>
              store.setDueInDays(parseWhole(event.value))}
          />
        </label>
      </div>
      <p class="note">
        Issued ${view.issuedOn}, due ${view.dueOn} &middot; rate
        ${view.currency}/USD ${formatRate(view.fxRateMicros)} &middot; document
        number assigned by the server on posting, period ${view.fiscalPeriod}
      </p>
    </section>
  `;
});

/* --------------------------------------------------------------- lines -- */

const LineTable = component(function LineTable(props: {
  store: LedgerStore;
  view: LedgerView;
}) {
  const { store, view } = props;

  return html`
    <section>
      <h2>Line items (${view.lines.length})</h2>
      <table>
        <thead>
          <tr>
            <th class="l">Description</th>
            <th class="l">Account</th>
            <th class="l">Tax</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Gross</th>
            <th>Disc.</th>
            <th>Net</th>
            <th>VAT</th>
            <th>Levy</th>
            <th>Line total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${keyed(
            view.lines,
            (row) => row.line.id,
            (row) => LineRow({ store, row }),
          )}
        </tbody>
      </table>
      <div class="toolbar">
        <button type="button" @click=${() => store.addLine()}>Add line</button>
      </div>
    </section>
  `;
});

/**
 * One row.
 *
 * Six of the eleven cells are derived and none of them is derivable from this
 * row alone: `Disc.` and `Levy` are apportioned from document totals by largest
 * remainder, so they move when a *different* row changes.
 *
 * Notably it holds no state of its own. There is no draft value to keep while
 * the user types, because the control is bound to the stored value and the
 * change handler states an outcome the store either accepts or rejects.
 */
const LineRow = component(function LineRow(props: {
  store: LedgerStore;
  row: LineView;
}) {
  const { store, row } = props;
  const { line } = row;

  return html`
    <tr>
      <td class="l">
        <input
          class="l"
          type="text"
          maxlength="80"
          placeholder="Description required"
          .value=${line.description}
          @change=${(event: ChangePayload) =>
            store.setLineDescription(line.id, event.value ?? "")}
        />
      </td>
      <td class="l">
        <select
          .value=${line.account}
          @change=${(event: ChangePayload) =>
            store.setLineAccount(line.id, event.value ?? "4000")}
        >
          <option value="4000">4000 Product revenue</option>
          <option value="4100">4100 Service revenue</option>
          <option value="4200">4200 Subscription revenue</option>
          <option value="4300">4300 Shipping recovered</option>
        </select>
      </td>
      <td class="l">
        <select
          .value=${line.taxCode}
          @change=${(event: ChangePayload) =>
            store.setLineTaxCode(line.id, event.value ?? "standard")}
        >
          <option value="standard">Standard 20%</option>
          <option value="reduced">Reduced 5%</option>
          <option value="zero">Zero rated</option>
          <option value="exempt">Exempt</option>
        </select>
      </td>
      <td>
        <input
          type="number"
          min="0"
          max="100000"
          step="1"
          .value=${line.quantity}
          @change=${(event: ChangePayload) =>
            store.setLineQuantity(line.id, parseWhole(event.value))}
        />
      </td>
      <td>
        <input
          type="number"
          min="0"
          step="0.01"
          .value=${majorUnits(line.unitPriceCents)}
          @change=${(event: ChangePayload) =>
            store.setLineUnitPrice(line.id, parseCents(event.value))}
        />
      </td>
      <td class="derived">${formatAmount(row.grossCents)}</td>
      <td class="derived">${formatAmount(-row.discountCents)}</td>
      <td class="derived">${formatAmount(row.netCents)}</td>
      <td class="derived">${formatAmount(row.vatCents)}</td>
      <td class="derived">${formatAmount(row.levyCents)}</td>
      <td class="strong">${formatAmount(row.totalCents)}</td>
      <td>
        ${row.issues.length === 0
          ? html`<button
              type="button"
              title="Remove line"
              @click=${() => store.removeLine(line.id)}
            >
              &times;
            </button>`
          : html`<span class="badge" title=${row.issues.join(", ")}
              >${row.issues.length} issue${row.issues.length === 1 ? "" : "s"}</span
            >`}
      </td>
    </tr>
  `;
});

/* -------------------------------------------------------------- totals -- */

const TotalsPanel = component(function TotalsPanel(props: {
  view: LedgerView;
}) {
  const { view } = props;

  return html`
    <section>
      <h2>Document totals (${view.currency})</h2>
      <table>
        <tbody>
          <tr>
            <td class="l">Subtotal</td>
            <td>${formatAmount(view.subtotalCents)}</td>
          </tr>
          <tr>
            <td class="l">
              Discount, apportioned across lines by largest remainder
            </td>
            <td>${formatAmount(-view.discountTotalCents)}</td>
          </tr>
          <tr>
            <td class="l">Net</td>
            <td>${formatAmount(view.netTotalCents)}</td>
          </tr>
          <tr>
            <td class="l">VAT, per line</td>
            <td>${formatAmount(view.vatTotalCents)}</td>
          </tr>
          <tr>
            <td class="l">
              Graduated levy on ${formatAmount(view.leviableNetCents)} leviable
              net, effective ${formatPercent(view.levyEffectiveBp)}
            </td>
            <td>${formatAmount(view.levyTotalCents)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td class="l">Total, ${view.currency}</td>
            <td>${formatAmount(view.totalCents)}</td>
          </tr>
          <tr>
            <td class="l">
              Total, USD at ${formatRate(view.fxRateMicros)}
            </td>
            <td>${formatAmount(view.baseTotalCents)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  `;
});

/* ------------------------------------------------------------ rollups -- */

const AccountRollupPanel = component(function AccountRollupPanel(props: {
  view: LedgerView;
}) {
  const { view } = props;

  return html`
    <section>
      <h2>By account</h2>
      <table>
        <thead>
          <tr>
            <th class="l">Account</th>
            <th>Lines</th>
            <th>Net</th>
            <th>Share</th>
          </tr>
        </thead>
        <tbody>
          ${keyed(
            view.accounts,
            (account) => account.code,
            (account) => AccountRow({ account }),
          )}
        </tbody>
        <tfoot>
          <tr>
            <td class="l">Total</td>
            <td>${view.lines.length}</td>
            <td>${formatAmount(view.netTotalCents)}</td>
            <td>100.00%</td>
          </tr>
        </tfoot>
      </table>
    </section>
  `;
});

const AccountRow = component(function AccountRow(props: {
  account: AccountRollup;
}) {
  const { account } = props;

  return html`
    <tr>
      <td class="l">${account.code} ${account.name}</td>
      <td>${account.lineCount}</td>
      <td>${formatAmount(account.netCents)}</td>
      <td class="derived">${formatPercent(account.shareBp)}</td>
    </tr>
  `;
});

/**
 * Every tax code, including the empty ones.
 *
 * Rendering rows that are zero looks wasteful and is the opposite: a fixed key
 * set means an edit patches values instead of replacing the list.
 */
const TaxRollupPanel = component(function TaxRollupPanel(props: {
  view: LedgerView;
}) {
  const { view } = props;

  return html`
    <section>
      <h2>By tax code</h2>
      <table>
        <thead>
          <tr>
            <th class="l">Code</th>
            <th>Lines</th>
            <th>Net</th>
            <th>VAT</th>
            <th>Levy</th>
          </tr>
        </thead>
        <tbody>
          ${keyed(
            view.taxes,
            (tax) => tax.id,
            (tax) => TaxRow({ tax }),
          )}
        </tbody>
        <tfoot>
          <tr>
            <td class="l">Total</td>
            <td>${view.lines.length}</td>
            <td>${formatAmount(view.netTotalCents)}</td>
            <td>${formatAmount(view.vatTotalCents)}</td>
            <td>${formatAmount(view.levyTotalCents)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  `;
});

const TaxRow = component(function TaxRow(props: { tax: TaxRollup }) {
  const { tax } = props;

  return html`
    <tr>
      <td class="l">${tax.label}</td>
      <td>${tax.lineCount}</td>
      <td>${formatAmount(tax.netCents)}</td>
      <td>${formatAmount(tax.vatCents)}</td>
      <td>${formatAmount(tax.levyCents)}</td>
    </tr>
  `;
});

/* ------------------------------------------------------------ journal -- */

const JournalPanel = component(function JournalPanel(props: {
  view: LedgerView;
}) {
  const { view } = props;

  return html`
    <section>
      <h2>Journal preview, double entry</h2>
      <table>
        <thead>
          <tr>
            <th class="l">Account</th>
            <th>Debit</th>
            <th>Credit</th>
          </tr>
        </thead>
        <tbody>
          ${keyed(
            view.journal,
            (row) => row.key,
            (row) => JournalRow({ row }),
          )}
        </tbody>
        <tfoot>
          <tr>
            <td class="l">
              ${view.journalBalanced ? "Balanced" : "OUT OF BALANCE"}
            </td>
            <td class=${view.journalBalanced ? "ok" : "warn"}>
              ${formatAmount(view.journalDebitCents)}
            </td>
            <td class=${view.journalBalanced ? "ok" : "warn"}>
              ${formatAmount(view.journalCreditCents)}
            </td>
          </tr>
        </tfoot>
      </table>
      <p class="note">
        ${view.invalidLineCount === 0
          ? "No line issues. This document can be posted."
          : `${view.invalidLineCount} line(s) carry ${view.issueCount} issue(s); posting is blocked.`}
      </p>
    </section>
  `;
});

const JournalRow = component(function JournalRow(props: {
  row: JournalRowData;
}) {
  const { row } = props;

  return html`
    <tr>
      <td class="l">${row.code} ${row.name}</td>
      <td>${row.debitCents === 0 ? "" : formatAmount(row.debitCents)}</td>
      <td>${row.creditCents === 0 ? "" : formatAmount(row.creditCents)}</td>
    </tr>
  `;
});

/* --------------------------------------------------------------- aging -- */

const AgingPanel = component(function AgingPanel(props: {
  store: LedgerStore;
  view: LedgerView;
}) {
  const { store, view } = props;

  return html`
    <section>
      <h2>Aging as of ${view.asOf}, USD</h2>
      <table>
        <thead>
          <tr>
            <th class="l">Bucket</th>
            <th>Docs</th>
            <th>Outstanding</th>
          </tr>
        </thead>
        <tbody>
          ${keyed(
            view.aging,
            (bucket) => bucket.key,
            (bucket) => AgingRow({ bucket }),
          )}
        </tbody>
        <tfoot>
          <tr>
            <td class="l">Closing</td>
            <td>${view.postedCount + 1}</td>
            <td>${formatAmount(view.closingBalanceBaseCents)}</td>
          </tr>
        </tfoot>
      </table>
      <div class="toolbar">
        <button type="button" @click=${() => store.setAsOf(addDays(view.asOf, -30))}>
          &minus;30 days
        </button>
        <button type="button" @click=${() => store.setAsOf(addDays(view.asOf, 30))}>
          +30 days
        </button>
      </div>
    </section>
  `;
});

const AgingRow = component(function AgingRow(props: { bucket: AgingBucket }) {
  const { bucket } = props;

  return html`
    <tr>
      <td class="l">${bucket.label}</td>
      <td>${bucket.documentCount}</td>
      <td>${formatAmount(bucket.baseCents)}</td>
    </tr>
  `;
});

/* ------------------------------------------------------------- balance -- */

const BalancePanel = component(function BalancePanel(props: {
  view: LedgerView;
}) {
  const { view } = props;

  return html`
    <section>
      <h2>Running balance, USD</h2>
      <table>
        <thead>
          <tr>
            <th class="l">Document</th>
            <th>Movement</th>
            <th>Balance</th>
          </tr>
        </thead>
        <tbody>
          ${keyed(
            view.balance,
            (row) => row.key,
            (row) => BalanceRow({ row }),
          )}
        </tbody>
        <tfoot>
          <tr>
            <td class="l">Posted outstanding</td>
            <td>${formatAmount(view.outstandingBaseCents)}</td>
            <td>${formatAmount(view.closingBalanceBaseCents)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  `;
});

const BalanceRow = component(function BalanceRow(props: {
  row: BalanceRowData;
}) {
  const { row } = props;

  return html`
    <tr>
      <td class="l">
        <span class=${row.draft ? "derived" : "strong"}>${row.label}</span>
        <br /><span class="derived">${row.reference}</span>
      </td>
      <td>${formatAmount(row.movementBaseCents)}</td>
      <td class="strong">${formatAmount(row.balanceBaseCents)}</td>
    </tr>
  `;
});

/* -------------------------------------------------------------- posted -- */

const PostedPanel = component(function PostedPanel(props: {
  store: LedgerStore;
  posted: readonly PostedDocument[];
}) {
  const { store, posted } = props;

  return html`
    <section>
      <h2>Posted documents (${posted.length})</h2>
      <table>
        <thead>
          <tr>
            <th class="l">Number</th>
            <th class="l">Customer</th>
            <th class="l">Due</th>
            <th>Total, USD</th>
            <th>Settled</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${keyed(
            posted,
            (entry) => entry.id,
            (entry) => PostedRow({ store, entry }),
          )}
        </tbody>
      </table>
    </section>
  `;
});

const PostedRow = component(function PostedRow(props: {
  store: LedgerStore;
  entry: PostedDocument;
}) {
  const { store, entry } = props;
  const settled = entry.settledBaseCents >= entry.baseTotalCents;

  return html`
    <tr>
      <td class="l">${entry.number}</td>
      <td class="l">${entry.customer}</td>
      <td class="l">${entry.dueOn}</td>
      <td>${formatAmount(entry.baseTotalCents)}</td>
      <td class=${settled ? "ok" : "derived"}>
        ${formatAmount(entry.settledBaseCents)}
      </td>
      <td>
        ${settled
          ? html`<span class="ok">settled</span>`
          : html`<button
              type="button"
              @click=${() => store.settle(entry.id, entry.baseTotalCents)}
            >
              Settle in full
            </button>`}
      </td>
    </tr>
  `;
});

/* --------------------------------------------------------------- bench -- */

/**
 * Posting plus the document-size controls used to take the S3 measurements.
 *
 * The seed buttons are absolute rather than additive, which is the same
 * intent-not-delta rule the line editors follow.
 */
const BenchPanel = component(function BenchPanel(props: {
  store: LedgerStore;
  view: LedgerView;
}) {
  const { store, view } = props;

  return html`
    <section>
      <h2>Post and measure</h2>
      <div class="toolbar">
        <button
          class="post"
          type="button"
          .disabled=${!view.canPost}
          @click=${() => store.postDraft()}
        >
          Post document
        </button>
        <button type="button" @click=${() => store.seedLines(10)}>
          Seed 10 lines
        </button>
        <button type="button" @click=${() => store.seedLines(100)}>
          Seed 100 lines
        </button>
        <button type="button" @click=${() => store.seedLines(500)}>
          Seed 500 lines
        </button>
      </div>
      <p class="note">
        ${view.canPost
          ? "Posting allocates the next gap-free number in the period and freezes the rate."
          : "Posting is blocked until every line has a description, a quantity and a price."}
      </p>
    </section>
  `;
});

export function createLedgerApp(store: LedgerStore): () => RenderOutput {
  return () => LedgerApp({ store });
}

/* ------------------------------------------------------------- parsing -- */

function majorUnits(cents: number): string {
  return (cents / 100).toFixed(2);
}

function parseWhole(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) return 0;
  return Math.round(Number(value));
}

function parseCents(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) return 0;
  return Math.round(Number(value) * 100);
}

function parsePercentToBp(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) return 0;
  return Math.round(Number(value) * 100);
}
