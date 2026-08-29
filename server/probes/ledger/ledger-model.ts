/**
 * The ledger's data shape and the whole of its derivation.
 *
 * Everything below `deriveLedger` is a pure function of stored state. That is
 * the point of the probe: a single stored line item feeds nine separate views,
 * and none of them is stored, so none of them can drift.
 *
 * Three of the derived quantities are deliberately impossible for a browser to
 * predict, and they are marked where they are computed:
 *
 *  - the graduated document levy, whose rate depends on the *document* total
 *    and is then apportioned back across lines, so one line's displayed levy
 *    depends on every other line;
 *  - the base-currency total, which needs a server-held rate table;
 *  - the document number, which needs a gap-free per-period sequence.
 */

export type CurrencyCode = "USD" | "EUR" | "GBP" | "CHF";

export type TaxCodeId = "standard" | "reduced" | "zero" | "exempt";

export type LineItem = {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  /** Chart-of-accounts code; always one of `REVENUE_ACCOUNTS`. */
  account: string;
  taxCode: TaxCodeId;
};

export type DraftDocument = {
  customer: string;
  currency: CurrencyCode;
  issuedOn: string;
  dueInDays: number;
  /** Document-level discount in basis points, apportioned across lines. */
  discountBp: number;
  lines: LineItem[];
};

export type PostedDocument = {
  id: string;
  /** Server-assigned. Never predictable, never reused. */
  number: string;
  customer: string;
  currency: CurrencyCode;
  issuedOn: string;
  dueOn: string;
  totalCents: number;
  baseTotalCents: number;
  settledBaseCents: number;
};

export type Ledger = {
  /** Aging and FX are quoted as of this date, so the probe is deterministic. */
  asOf: string;
  /** Fiscal period -> next document sequence. Gap-free by construction. */
  sequences: Record<string, number>;
  draft: DraftDocument;
  posted: PostedDocument[];
};

export const BASE_CURRENCY: CurrencyCode = "USD";

export const CURRENCIES: readonly CurrencyCode[] = ["USD", "EUR", "GBP", "CHF"];

export const REVENUE_ACCOUNTS: ReadonlyArray<{ code: string; name: string }> = [
  { code: "4000", name: "Product revenue" },
  { code: "4100", name: "Service revenue" },
  { code: "4200", name: "Subscription revenue" },
  { code: "4300", name: "Shipping recovered" },
];

export const RECEIVABLE_ACCOUNT = { code: "1100", name: "Accounts receivable" };
export const VAT_ACCOUNT = { code: "2200", name: "VAT payable" };
export const LEVY_ACCOUNT = { code: "2210", name: "Document levy payable" };

export const TAX_CODES: ReadonlyArray<{
  id: TaxCodeId;
  label: string;
  rateBp: number;
  leviable: boolean;
}> = [
  { id: "standard", label: "Standard 20%", rateBp: 2000, leviable: true },
  { id: "reduced", label: "Reduced 5%", rateBp: 500, leviable: true },
  { id: "zero", label: "Zero rated", rateBp: 0, leviable: true },
  { id: "exempt", label: "Exempt", rateBp: 0, leviable: false },
];

/**
 * Graduated levy on the document's leviable net, in the document currency.
 *
 * Contrived, but not without precedent: graduated stamp duties and document
 * levies work this way. What matters for the probe is the shape — the rate is a
 * property of the whole document, so no line can be priced in isolation.
 */
export const LEVY_BANDS: ReadonlyArray<{ upToCents: number; rateBp: number }> = [
  { upToCents: 100_000, rateBp: 50 },
  { upToCents: 500_000, rateBp: 125 },
  { upToCents: Number.POSITIVE_INFINITY, rateBp: 210 },
];

/**
 * Server-held rates against `BASE_CURRENCY`, in millionths, plus a dealing
 * spread. A browser cannot derive this, which is the A4 point: prediction here
 * is not hard, it is impossible.
 */
const FX_TABLE: Record<CurrencyCode, { midMicros: number; spreadBp: number }> = {
  USD: { midMicros: 1_000_000, spreadBp: 0 },
  EUR: { midMicros: 1_082_400, spreadBp: 35 },
  GBP: { midMicros: 1_268_100, spreadBp: 45 },
  CHF: { midMicros: 1_124_700, spreadBp: 40 },
};

export type LineView = {
  line: LineItem;
  accountName: string;
  taxLabel: string;
  grossCents: number;
  discountCents: number;
  netCents: number;
  vatCents: number;
  levyCents: number;
  totalCents: number;
  issues: readonly string[];
};

export type AccountRollup = {
  code: string;
  name: string;
  lineCount: number;
  netCents: number;
  shareBp: number;
};

export type TaxRollup = {
  id: TaxCodeId;
  label: string;
  lineCount: number;
  netCents: number;
  vatCents: number;
  levyCents: number;
};

export type JournalRow = {
  key: string;
  code: string;
  name: string;
  debitCents: number;
  creditCents: number;
};

export type AgingBucket = {
  key: string;
  label: string;
  documentCount: number;
  baseCents: number;
};

export type BalanceRow = {
  key: string;
  label: string;
  reference: string;
  movementBaseCents: number;
  balanceBaseCents: number;
  draft: boolean;
};

export type LedgerView = {
  asOf: string;
  customer: string;
  currency: CurrencyCode;
  issuedOn: string;
  dueInDays: number;
  dueOn: string;
  discountBp: number;
  fxRateMicros: number;

  lines: readonly LineView[];
  subtotalCents: number;
  discountTotalCents: number;
  netTotalCents: number;
  leviableNetCents: number;
  vatTotalCents: number;
  levyTotalCents: number;
  levyEffectiveBp: number;
  totalCents: number;
  baseTotalCents: number;

  accounts: readonly AccountRollup[];
  taxes: readonly TaxRollup[];

  journal: readonly JournalRow[];
  journalDebitCents: number;
  journalCreditCents: number;
  journalBalanced: boolean;

  aging: readonly AgingBucket[];
  balance: readonly BalanceRow[];
  closingBalanceBaseCents: number;
  outstandingBaseCents: number;

  invalidLineCount: number;
  issueCount: number;
  canPost: boolean;
  postedCount: number;
  /** The period the next document number will be allocated in. */
  fiscalPeriod: string;
};

/**
 * The single derivation. Called once per render, from stored state only.
 *
 * Order matters and is the reason no line is independently computable:
 * discount is apportioned from a document total, the levy rate is chosen from a
 * document total, and the levy is then apportioned back down to lines.
 */
export function deriveLedger(ledger: Ledger): LedgerView {
  const { draft } = ledger;
  const lines = draft.lines;

  const gross = lines.map((line) => line.quantity * line.unitPriceCents);
  const subtotalCents = sum(gross);

  const discountTotalCents = roundHalfEven((subtotalCents * draft.discountBp) / 10_000);
  const discount = allocate(discountTotalCents, gross);
  const net = gross.map((value, index) => value - (discount[index] ?? 0));
  const netTotalCents = subtotalCents - discountTotalCents;

  const taxOf = (line: LineItem) => taxCode(line.taxCode);

  const vat = lines.map((line, index) =>
    roundHalfEven(((net[index] ?? 0) * taxOf(line).rateBp) / 10_000),
  );
  const vatTotalCents = sum(vat);

  const leviableWeights = lines.map((line, index) =>
    taxOf(line).leviable ? (net[index] ?? 0) : 0,
  );
  const leviableNetCents = sum(leviableWeights);
  const levyTotalCents = graduatedLevy(leviableNetCents);
  const levy = allocate(levyTotalCents, leviableWeights);

  const totalCents = netTotalCents + vatTotalCents + levyTotalCents;
  const fxRateMicros = fxRate(draft.currency, draft.issuedOn);
  const baseTotalCents = toBaseCurrency(totalCents, fxRateMicros);

  const lineViews: LineView[] = lines.map((line, index) => ({
    line,
    accountName: accountName(line.account),
    taxLabel: taxOf(line).label,
    grossCents: gross[index] ?? 0,
    discountCents: discount[index] ?? 0,
    netCents: net[index] ?? 0,
    vatCents: vat[index] ?? 0,
    levyCents: levy[index] ?? 0,
    totalCents: (net[index] ?? 0) + (vat[index] ?? 0) + (levy[index] ?? 0),
    issues: lineIssues(line),
  }));

  const accounts = rollUpAccounts(lineViews, netTotalCents);
  const taxes = rollUpTaxes(lineViews);
  const journal = buildJournal(accounts, vatTotalCents, levyTotalCents, totalCents);
  const journalDebitCents = sum(journal.map((row) => row.debitCents));
  const journalCreditCents = sum(journal.map((row) => row.creditCents));

  const invalidLineCount = lineViews.filter((view) => view.issues.length > 0).length;
  const issueCount = sum(lineViews.map((view) => view.issues.length));

  const balance = buildBalance(ledger, baseTotalCents);
  const closingBalanceBaseCents =
    balance[balance.length - 1]?.balanceBaseCents ?? 0;
  const outstandingBaseCents = sum(
    ledger.posted.map((entry) => outstandingOf(entry)),
  );

  return {
    asOf: ledger.asOf,
    customer: draft.customer,
    currency: draft.currency,
    issuedOn: draft.issuedOn,
    dueInDays: draft.dueInDays,
    dueOn: addDays(draft.issuedOn, draft.dueInDays),
    discountBp: draft.discountBp,
    fxRateMicros,

    lines: lineViews,
    subtotalCents,
    discountTotalCents,
    netTotalCents,
    leviableNetCents,
    vatTotalCents,
    levyTotalCents,
    levyEffectiveBp:
      leviableNetCents === 0
        ? 0
        : Math.round((levyTotalCents * 10_000) / leviableNetCents),
    totalCents,
    baseTotalCents,

    accounts,
    taxes,

    journal,
    journalDebitCents,
    journalCreditCents,
    journalBalanced: journalDebitCents === journalCreditCents,

    aging: buildAging(ledger, baseTotalCents),
    balance,
    closingBalanceBaseCents,
    outstandingBaseCents,

    invalidLineCount,
    issueCount,
    canPost: lines.length > 0 && issueCount === 0,
    postedCount: ledger.posted.length,
    fiscalPeriod: fiscalPeriod(draft.issuedOn),
  };
}

/** Soft problems: allowed to exist in stored state, but they block posting. */
function lineIssues(line: LineItem): readonly string[] {
  const issues: string[] = [];
  if (line.description.trim().length === 0) issues.push("no description");
  if (line.quantity === 0) issues.push("zero quantity");
  if (line.unitPriceCents === 0) issues.push("zero unit price");
  return issues;
}

function rollUpAccounts(
  lines: readonly LineView[],
  netTotalCents: number,
): AccountRollup[] {
  const totals = new Map<string, { lineCount: number; netCents: number }>();

  for (const view of lines) {
    const existing = totals.get(view.line.account) ?? {
      lineCount: 0,
      netCents: 0,
    };
    existing.lineCount += 1;
    existing.netCents += view.netCents;
    totals.set(view.line.account, existing);
  }

  return REVENUE_ACCOUNTS.filter((account) => totals.has(account.code)).map(
    (account) => {
      const entry = totals.get(account.code) ?? { lineCount: 0, netCents: 0 };
      return {
        code: account.code,
        name: account.name,
        lineCount: entry.lineCount,
        netCents: entry.netCents,
        shareBp:
          netTotalCents === 0
            ? 0
            : Math.round((entry.netCents * 10_000) / netTotalCents),
      };
    },
  );
}

/**
 * Always emits all four tax codes, including empty ones.
 *
 * That is an authoring decision with a protocol consequence: a stable key set
 * turns what would be a structural `list` patch into value-only `set` patches.
 */
function rollUpTaxes(lines: readonly LineView[]): TaxRollup[] {
  return TAX_CODES.map((code) => {
    const matching = lines.filter((view) => view.line.taxCode === code.id);
    return {
      id: code.id,
      label: code.label,
      lineCount: matching.length,
      netCents: sum(matching.map((view) => view.netCents)),
      vatCents: sum(matching.map((view) => view.vatCents)),
      levyCents: sum(matching.map((view) => view.levyCents)),
    };
  });
}

/**
 * The double entry.
 *
 * The receivable debit is defined as net + VAT + levy, and every credit is one
 * of those three components, so debits equal credits by construction rather
 * than by a reconciliation step. There is no ordering of operations in which a
 * reader could observe an unbalanced journal.
 */
function buildJournal(
  accounts: readonly AccountRollup[],
  vatTotalCents: number,
  levyTotalCents: number,
  totalCents: number,
): JournalRow[] {
  const rows: JournalRow[] = [
    {
      key: "dr:receivable",
      code: RECEIVABLE_ACCOUNT.code,
      name: RECEIVABLE_ACCOUNT.name,
      debitCents: totalCents,
      creditCents: 0,
    },
  ];

  for (const account of accounts) {
    rows.push({
      key: `cr:${account.code}`,
      code: account.code,
      name: account.name,
      debitCents: 0,
      creditCents: account.netCents,
    });
  }

  rows.push({
    key: "cr:vat",
    code: VAT_ACCOUNT.code,
    name: VAT_ACCOUNT.name,
    debitCents: 0,
    creditCents: vatTotalCents,
  });
  rows.push({
    key: "cr:levy",
    code: LEVY_ACCOUNT.code,
    name: LEVY_ACCOUNT.name,
    debitCents: 0,
    creditCents: levyTotalCents,
  });

  return rows;
}

const AGING_BUCKETS: ReadonlyArray<{
  key: string;
  label: string;
  minDays: number;
  maxDays: number;
}> = [
  { key: "current", label: "Not yet due", minDays: Number.NEGATIVE_INFINITY, maxDays: 0 },
  { key: "d1", label: "1-30 days", minDays: 1, maxDays: 30 },
  { key: "d31", label: "31-60 days", minDays: 31, maxDays: 60 },
  { key: "d61", label: "61-90 days", minDays: 61, maxDays: 90 },
  { key: "d91", label: "Over 90 days", minDays: 91, maxDays: Number.POSITIVE_INFINITY },
];

function buildAging(ledger: Ledger, draftBaseCents: number): AgingBucket[] {
  const buckets: AgingBucket[] = AGING_BUCKETS.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    documentCount: 0,
    baseCents: 0,
  }));

  for (const entry of ledger.posted) {
    const outstanding = outstandingOf(entry);
    if (outstanding === 0) continue;

    const overdueDays = daysBetween(entry.dueOn, ledger.asOf);
    const index = AGING_BUCKETS.findIndex(
      (bucket) => overdueDays >= bucket.minDays && overdueDays <= bucket.maxDays,
    );
    const bucket = buckets[index === -1 ? 0 : index];
    if (!bucket) continue;

    bucket.documentCount += 1;
    bucket.baseCents += outstanding;
  }

  buckets.push({
    key: "draft",
    label: "Draft, unposted",
    documentCount: ledger.draft.lines.length === 0 ? 0 : 1,
    baseCents: draftBaseCents,
  });

  return buckets;
}

function buildBalance(ledger: Ledger, draftBaseCents: number): BalanceRow[] {
  const rows: BalanceRow[] = [];
  let running = 0;

  for (const entry of ledger.posted) {
    const movement = outstandingOf(entry);
    running += movement;
    rows.push({
      key: entry.id,
      label: entry.customer,
      reference: entry.number,
      movementBaseCents: movement,
      balanceBaseCents: running,
      draft: false,
    });
  }

  running += draftBaseCents;
  rows.push({
    key: "draft",
    label: `${ledger.draft.customer} (draft)`,
    reference: "not yet numbered",
    movementBaseCents: draftBaseCents,
    balanceBaseCents: running,
    draft: true,
  });

  return rows;
}

export function outstandingOf(entry: PostedDocument): number {
  return Math.max(0, entry.baseTotalCents - entry.settledBaseCents);
}

/* ------------------------------------------------------------------ money -- */

/**
 * Round half to even, on non-negative values.
 *
 * Half-up would be simpler and would also make every rounding step guessable
 * from a single line. Banker's rounding is what accounting systems actually do
 * and it is the first of three reasons a client cannot reproduce these numbers.
 */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;

  // Tolerance, because the inputs arrive as a product of a rate and an integer.
  if (Math.abs(fraction - 0.5) < 1e-9) {
    return floor % 2 === 0 ? floor : floor + 1;
  }
  return fraction > 0.5 ? floor + 1 : floor;
}

/**
 * Splits `total` across `weights` so the parts sum to `total` exactly.
 *
 * Largest remainder: floor everything, then hand the leftover minor units to
 * the largest fractional parts. This is why an SPA cannot patch one row and
 * stop — changing line 1's quantity can move line 7's displayed levy by a cent
 * without touching line 7's own data.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  const parts = weights.map(() => 0);
  if (weights.length === 0) return parts;

  const weightTotal = sum(weights);
  if (weightTotal <= 0) {
    // Nothing to weight by; keep the invariant that the parts sum to the total.
    parts[0] = total;
    return parts;
  }

  const exact = weights.map((weight) => (total * weight) / weightTotal);
  for (let index = 0; index < exact.length; index += 1) {
    parts[index] = Math.floor(exact[index] ?? 0);
  }

  let leftover = total - sum(parts);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);

  for (const candidate of order) {
    if (leftover <= 0) break;
    parts[candidate.index] = (parts[candidate.index] ?? 0) + 1;
    leftover -= 1;
  }

  return parts;
}

/** Banded rate on the document total, rounded once at the end. */
export function graduatedLevy(leviableNetCents: number): number {
  if (leviableNetCents <= 0) return 0;

  let exact = 0;
  let floor = 0;

  for (const band of LEVY_BANDS) {
    const ceiling = Math.min(leviableNetCents, band.upToCents);
    const portion = Math.max(0, ceiling - floor);
    exact += (portion * band.rateBp) / 10_000;
    floor = band.upToCents;
    if (floor >= leviableNetCents) break;
  }

  return roundHalfEven(exact);
}

/**
 * Rate against the base currency as of a date.
 *
 * The daily drift is deterministic so the probe is reproducible, and it is
 * derived from a server-side table so it is unreachable from the browser.
 */
export function fxRate(currency: CurrencyCode, isoDate: string): number {
  if (currency === BASE_CURRENCY) return 1_000_000;

  const entry = FX_TABLE[currency];
  const drift = ((hash(`${currency}:${isoDate}`) % 801) - 400) / 100_000;
  const mid = entry.midMicros * (1 + drift);
  return Math.round(mid * (1 - entry.spreadBp / 10_000));
}

export function toBaseCurrency(cents: number, rateMicros: number): number {
  return roundHalfEven((cents * rateMicros) / 1_000_000);
}

/* ------------------------------------------------------------- numbering -- */

export function fiscalPeriod(isoDate: string): string {
  const year = isoDate.slice(0, 4);
  const month = Number(isoDate.slice(5, 7));
  return `${year}Q${Math.floor((month - 1) / 3) + 1}`;
}

/**
 * `INV-2026Q3-0004-71`, with ISO 7064 MOD 97-10 check digits.
 *
 * Unpredictable on three counts: the sequence is allocated under the store's
 * mutex so two concurrent posts cannot both guess it, the period comes from the
 * document date rather than the clock, and the check digits are a function of
 * the whole string.
 */
export function documentNumber(period: string, sequence: number): string {
  const body = `INV-${period}-${String(sequence).padStart(4, "0")}`;
  return `${body}-${checkDigits(body)}`;
}

function checkDigits(payload: string): string {
  return String(98 - mod97(`${payload}00`)).padStart(2, "0");
}

function mod97(text: string): number {
  let remainder = 0;

  for (const character of text.toUpperCase()) {
    let digits: string;
    if (character >= "0" && character <= "9") {
      digits = character;
    } else if (character >= "A" && character <= "Z") {
      digits = String(character.charCodeAt(0) - 55);
    } else {
      continue;
    }

    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }

  return remainder;
}

/* ------------------------------------------------------------ formatting -- */

export function formatAmount(cents: number): string {
  const abs = Math.abs(cents);
  const units = String(Math.floor(abs / 100)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ",",
  );
  const fraction = String(abs % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}${units}.${fraction}`;
}

export function formatRate(rateMicros: number): string {
  return (rateMicros / 1_000_000).toFixed(4);
}

export function formatPercent(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(2)}%`;
}

/* ------------------------------------------------------------------ dates -- */

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/* ------------------------------------------------------------------ small -- */

export function taxCode(id: TaxCodeId): (typeof TAX_CODES)[number] {
  const found = TAX_CODES.find((code) => code.id === id);
  return found ?? TAX_CODES[0]!;
}

export function accountName(code: string): string {
  return REVENUE_ACCOUNTS.find((account) => account.code === code)?.name ?? code;
}

function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function hash(text: string): number {
  let value = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16_777_619);
  }
  return Math.abs(value);
}
