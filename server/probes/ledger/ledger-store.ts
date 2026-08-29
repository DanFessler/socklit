import { randomUUID } from "node:crypto";

import { createJsonStore, JsonStore, StoreError, type StoreListener } from "../../json-store";
import {
  addDays,
  CURRENCIES,
  deriveLedger,
  documentNumber,
  fiscalPeriod,
  fxRate,
  REVENUE_ACCOUNTS,
  TAX_CODES,
  toBaseCurrency,
  type CurrencyCode,
  type Ledger,
  type LineItem,
  type PostedDocument,
  type TaxCodeId,
} from "./ledger-model";

export const MAX_LINES = 1000;
export const MAX_DESCRIPTION_LENGTH = 80;
export const MAX_QUANTITY = 100_000;
export const MAX_UNIT_PRICE_CENTS = 100_000_000;
export const MAX_DISCOUNT_BP = 5_000;

/**
 * Every mutation here states an outcome rather than a change.
 *
 * That is not stylistic. A ledger edit is worth a round trip, and at 400 ms two
 * sessions editing the same document routinely have events in flight at the
 * same time. `setLineQuantity(id, 7)` is safe to apply late, twice, or
 * simultaneously with another session's edit to a different line, because it
 * does not describe a delta relative to the screen the user was looking at.
 *
 * The one method that cannot be expressed that way is `postDraft`, and it is
 * guarded by a precondition re-checked inside the mutex instead.
 */
export class LedgerStore {
  private readonly store: JsonStore<Ledger>;

  constructor(store: JsonStore<Ledger>) {
    this.store = store;
  }

  /** A detached copy, so app code cannot edit authoritative state by accident. */
  read(): Ledger {
    return cloneLedger(this.store.state);
  }

  onChange(listener: StoreListener): () => void {
    return this.store.onChange(listener);
  }

  /*
   * The setters below are `async` even where nothing is awaited.
   *
   * Argument validation runs before the mutex is taken, which is what we want,
   * but a method that returns a promise should signal failure by rejecting
   * rather than by throwing at the call site. `async` gives both.
   */

  async setCustomer(name: string): Promise<void> {
    const customer = normalizeText(name, MAX_DESCRIPTION_LENGTH, "customer");
    return this.editDraft((draft) =>
      draft.customer === customer ? null : { ...draft, customer },
    );
  }

  async setCurrency(currency: string): Promise<void> {
    if (!isCurrency(currency)) {
      throw new StoreError(`unknown currency: ${currency}`);
    }
    return this.editDraft((draft) =>
      draft.currency === currency ? null : { ...draft, currency },
    );
  }

  async setDiscountBp(basisPoints: number): Promise<void> {
    const discountBp = requireInteger(basisPoints, 0, MAX_DISCOUNT_BP, "discount");
    return this.editDraft((draft) =>
      draft.discountBp === discountBp ? null : { ...draft, discountBp },
    );
  }

  async setDueInDays(days: number): Promise<void> {
    const dueInDays = requireInteger(days, 0, 365, "payment terms");
    return this.editDraft((draft) =>
      draft.dueInDays === dueInDays ? null : { ...draft, dueInDays },
    );
  }

  async setLineDescription(id: string, description: string): Promise<void> {
    const text = normalizeText(description, MAX_DESCRIPTION_LENGTH, "description", true);
    return this.editLine(id, (line) =>
      line.description === text ? null : { ...line, description: text },
    );
  }

  async setLineQuantity(id: string, quantity: number): Promise<void> {
    const next = requireInteger(quantity, 0, MAX_QUANTITY, "quantity");
    return this.editLine(id, (line) =>
      line.quantity === next ? null : { ...line, quantity: next },
    );
  }

  async setLineUnitPrice(id: string, unitPriceCents: number): Promise<void> {
    const next = requireInteger(unitPriceCents, 0, MAX_UNIT_PRICE_CENTS, "unit price");
    return this.editLine(id, (line) =>
      line.unitPriceCents === next ? null : { ...line, unitPriceCents: next },
    );
  }

  async setLineAccount(id: string, account: string): Promise<void> {
    if (!REVENUE_ACCOUNTS.some((candidate) => candidate.code === account)) {
      throw new StoreError(`unknown account: ${account}`);
    }
    return this.editLine(id, (line) =>
      line.account === account ? null : { ...line, account },
    );
  }

  async setLineTaxCode(id: string, taxCode: string): Promise<void> {
    if (!isTaxCode(taxCode)) {
      throw new StoreError(`unknown tax code: ${taxCode}`);
    }
    return this.editLine(id, (line) =>
      line.taxCode === taxCode ? null : { ...line, taxCode },
    );
  }

  addLine(): Promise<LineItem> {
    return this.store.mutate((ledger) => {
      if (ledger.draft.lines.length >= MAX_LINES) {
        throw new StoreError(`a document holds at most ${MAX_LINES} lines`);
      }

      const line: LineItem = {
        id: randomUUID(),
        description: "",
        quantity: 1,
        unitPriceCents: 0,
        account: REVENUE_ACCOUNTS[0]?.code ?? "4000",
        taxCode: "standard",
      };

      return {
        next: withDraft(ledger, {
          ...ledger.draft,
          lines: [...ledger.draft.lines, line],
        }),
        result: line,
      };
    });
  }

  removeLine(id: string): Promise<void> {
    return this.store.mutate((ledger) => {
      const remaining = ledger.draft.lines.filter((line) => line.id !== id);
      if (remaining.length === ledger.draft.lines.length) {
        // Already gone: another session removed it while this click was in
        // flight. The user's intent is satisfied, so this is a no-op.
        return { next: ledger, result: undefined };
      }
      return {
        next: withDraft(ledger, { ...ledger.draft, lines: remaining }),
        result: undefined,
      };
    });
  }

  /**
   * Replaces the draft with exactly `count` generated lines.
   *
   * A bench control, and absolute for the same reason everything else is: two
   * clicks on "500 lines" leave 500 lines rather than 1,000.
   */
  async seedLines(count: number): Promise<void> {
    const total = requireInteger(count, 0, MAX_LINES, "line count");
    return this.store.mutate((ledger) => {
      if (ledger.draft.lines.length === total && total !== 0) {
        return { next: ledger, result: undefined };
      }
      return {
        next: withDraft(ledger, {
          ...ledger.draft,
          lines: generateLines(total),
        }),
        result: undefined,
      };
    });
  }

  async setAsOf(isoDate: string): Promise<void> {
    const asOf = requireIsoDate(isoDate);
    return this.store.mutate((ledger) =>
      ledger.asOf === asOf
        ? { next: ledger, result: undefined }
        : { next: { ...ledger, asOf }, result: undefined },
    );
  }

  /** Absolute settled amount in base currency, not a payment delta. */
  async settle(documentId: string, settledBaseCents: number): Promise<void> {
    return this.store.mutate((ledger) => {
      const document = ledger.posted.find((entry) => entry.id === documentId);
      if (!document) throw new StoreError(`unknown document: ${documentId}`);

      const clamped = Math.min(
        Math.max(0, requireInteger(settledBaseCents, 0, Number.MAX_SAFE_INTEGER, "settlement")),
        document.baseTotalCents,
      );
      if (document.settledBaseCents === clamped) {
        return { next: ledger, result: undefined };
      }

      return {
        next: {
          ...ledger,
          posted: ledger.posted.map((entry) =>
            entry.id === documentId
              ? { ...entry, settledBaseCents: clamped }
              : entry,
          ),
        },
        result: undefined,
      };
    });
  }

  /**
   * Posts the draft, assigning a document number under the mutex.
   *
   * Rendering the button is not authorization: the precondition is re-derived
   * from stored state here, so a click that was legal when it was rendered and
   * is not legal when it lands is rejected rather than applied.
   */
  postDraft(): Promise<PostedDocument> {
    return this.store.mutate((ledger) => {
      const view = deriveLedger(ledger);
      if (!view.canPost) {
        throw new StoreError(
          view.lines.length === 0
            ? "cannot post an empty document"
            : `cannot post with ${view.issueCount} unresolved line issue(s)`,
        );
      }

      const period = fiscalPeriod(ledger.draft.issuedOn);
      const sequence = ledger.sequences[period] ?? 1;
      const rate = fxRate(ledger.draft.currency, ledger.draft.issuedOn);

      const document: PostedDocument = {
        id: randomUUID(),
        number: documentNumber(period, sequence),
        customer: ledger.draft.customer,
        currency: ledger.draft.currency,
        issuedOn: ledger.draft.issuedOn,
        dueOn: addDays(ledger.draft.issuedOn, ledger.draft.dueInDays),
        totalCents: view.totalCents,
        baseTotalCents: toBaseCurrency(view.totalCents, rate),
        settledBaseCents: 0,
      };

      return {
        next: {
          ...ledger,
          sequences: { ...ledger.sequences, [period]: sequence + 1 },
          posted: [...ledger.posted, document],
          draft: { ...ledger.draft, lines: [] },
        },
        result: document,
      };
    });
  }

  private editDraft(
    apply: (draft: Ledger["draft"]) => Ledger["draft"] | null,
  ): Promise<void> {
    return this.store.mutate((ledger) => {
      const draft = apply(ledger.draft);
      return {
        next: draft === null ? ledger : withDraft(ledger, draft),
        result: undefined,
      };
    });
  }

  private editLine(
    id: string,
    apply: (line: LineItem) => LineItem | null,
  ): Promise<void> {
    return this.store.mutate((ledger) => {
      const current = ledger.draft.lines.find((line) => line.id === id);
      if (!current) throw new StoreError(`unknown line: ${id}`);

      const updated = apply(current);
      if (updated === null) return { next: ledger, result: undefined };

      return {
        next: withDraft(ledger, {
          ...ledger.draft,
          lines: ledger.draft.lines.map((line) =>
            line.id === id ? updated : line,
          ),
        }),
        result: undefined,
      };
    });
  }
}

export async function createLedgerStore(file: string): Promise<LedgerStore> {
  const store = await createJsonStore<Ledger>({
    file,
    initial: () => seedLedger(),
    parse: (raw) => parseLedger(raw, file),
  });
  return new LedgerStore(store);
}

function withDraft(ledger: Ledger, draft: Ledger["draft"]): Ledger {
  return { ...ledger, draft };
}

function cloneLedger(ledger: Ledger): Ledger {
  return {
    asOf: ledger.asOf,
    sequences: { ...ledger.sequences },
    draft: {
      ...ledger.draft,
      lines: ledger.draft.lines.map((line) => ({ ...line })),
    },
    posted: ledger.posted.map((document) => ({ ...document })),
  };
}

/* --------------------------------------------------------------- seeding -- */

const SEED_AS_OF = "2026-08-27";

const SEED_DESCRIPTIONS = [
  "Onboarding workshop",
  "Platform licence, annual",
  "Data migration, per seat",
  "Priority support retainer",
  "Custom integration build",
  "Training seats",
  "Overnight freight",
  "Extended warranty",
];

/**
 * Enough posted history that every aging bucket is occupied on first load, so
 * the aging table is a live derived view rather than a row of zeroes.
 */
export function seedLedger(): Ledger {
  const posted: PostedDocument[] = [
    { offset: -8, total: 486_500, settled: 0, customer: "Halberd Freight" },
    { offset: -47, total: 1_294_000, settled: 400_000, customer: "Norrland Kraft" },
    { offset: -73, total: 218_750, settled: 0, customer: "Vela Diagnostics" },
    { offset: -142, total: 905_200, settled: 0, customer: "Pemberton Mills" },
    { offset: 12, total: 331_400, settled: 0, customer: "Aurex Logistics" },
  ].map((entry, index) => {
    const issuedOn = addDays(SEED_AS_OF, entry.offset - 30);
    const period = fiscalPeriod(issuedOn);
    return {
      id: `seed-${index + 1}`,
      number: documentNumber(period, 900 + index),
      customer: entry.customer,
      currency: "USD" as CurrencyCode,
      issuedOn,
      dueOn: addDays(SEED_AS_OF, entry.offset),
      totalCents: entry.total,
      baseTotalCents: entry.total,
      settledBaseCents: entry.settled,
    };
  });

  return {
    asOf: SEED_AS_OF,
    sequences: { [fiscalPeriod(SEED_AS_OF)]: 1 },
    draft: {
      customer: "Kestrel Instruments",
      currency: "EUR",
      issuedOn: SEED_AS_OF,
      dueInDays: 30,
      discountBp: 750,
      lines: generateLines(6),
    },
    posted,
  };
}

/** Deterministic, so bench numbers at a given line count are reproducible. */
export function generateLines(count: number): LineItem[] {
  const lines: LineItem[] = [];

  for (let index = 0; index < count; index += 1) {
    const account = REVENUE_ACCOUNTS[index % REVENUE_ACCOUNTS.length];
    const taxCode = TAX_CODES[index % TAX_CODES.length];
    lines.push({
      id: `line-${String(index + 1).padStart(4, "0")}`,
      description:
        SEED_DESCRIPTIONS[index % SEED_DESCRIPTIONS.length] ?? "Line item",
      quantity: 1 + ((index * 7) % 12),
      unitPriceCents: 4_500 + ((index * 1_337) % 91_500),
      account: account?.code ?? "4000",
      taxCode: taxCode?.id ?? "standard",
    });
  }

  return lines;
}

/* -------------------------------------------------------------- validation -- */

function isCurrency(value: string): value is CurrencyCode {
  return (CURRENCIES as readonly string[]).includes(value);
}

function isTaxCode(value: string): value is TaxCodeId {
  return TAX_CODES.some((code) => code.id === value);
}

function normalizeText(
  value: unknown,
  maxLength: number,
  field: string,
  allowEmpty = false,
): string {
  if (typeof value !== "string") {
    throw new StoreError(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    throw new StoreError(`${field} must not be empty`);
  }
  if (trimmed.length > maxLength) {
    throw new StoreError(`${field} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

function requireInteger(
  value: unknown,
  min: number,
  max: number,
  field: string,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new StoreError(`${field} must be a whole number`);
  }
  if (value < min || value > max) {
    throw new StoreError(`${field} must be between ${min} and ${max}`);
  }
  return value;
}

function requireIsoDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new StoreError("date must be formatted YYYY-MM-DD");
  }
  if (Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new StoreError(`not a real date: ${value}`);
  }
  return value;
}

/**
 * Repairs rather than trusts.
 *
 * The file is the only thing that survives a restart, so a malformed line is
 * dropped instead of being allowed to reach the derivation, where a NaN would
 * be rejected by the serializer as a non-finite hole value.
 */
function parseLedger(raw: unknown, file: string): Ledger {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`malformed ledger file: ${file}`);
  }

  const candidate = raw as Partial<Ledger>;
  const seed = seedLedger();

  const draft = candidate.draft;
  if (typeof draft !== "object" || draft === null) {
    throw new Error(`malformed ledger file: ${file}`);
  }

  return {
    asOf: isIsoDate(candidate.asOf) ? candidate.asOf : seed.asOf,
    sequences: parseSequences(candidate.sequences),
    draft: {
      customer:
        typeof draft.customer === "string" && draft.customer.length > 0
          ? draft.customer.slice(0, MAX_DESCRIPTION_LENGTH)
          : seed.draft.customer,
      currency:
        typeof draft.currency === "string" && isCurrency(draft.currency)
          ? draft.currency
          : seed.draft.currency,
      issuedOn: isIsoDate(draft.issuedOn) ? draft.issuedOn : seed.draft.issuedOn,
      dueInDays: clampInteger(draft.dueInDays, 0, 365, seed.draft.dueInDays),
      discountBp: clampInteger(draft.discountBp, 0, MAX_DISCOUNT_BP, 0),
      lines: Array.isArray(draft.lines)
        ? draft.lines.filter(isLineItem).slice(0, MAX_LINES).map(cleanLine)
        : [],
    },
    posted: Array.isArray(candidate.posted)
      ? candidate.posted.filter(isPostedDocument)
      : [],
  };
}

function parseSequences(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null) return {};

  const sequences: Record<string, number> = {};
  for (const [period, sequence] of Object.entries(value)) {
    if (typeof sequence === "number" && Number.isSafeInteger(sequence) && sequence > 0) {
      sequences[period] = sequence;
    }
  }
  return sequences;
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function isLineItem(value: unknown): value is LineItem {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<LineItem>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.description === "string" &&
    typeof candidate.quantity === "number" &&
    Number.isSafeInteger(candidate.quantity) &&
    typeof candidate.unitPriceCents === "number" &&
    Number.isSafeInteger(candidate.unitPriceCents) &&
    typeof candidate.account === "string" &&
    typeof candidate.taxCode === "string" &&
    isTaxCode(candidate.taxCode)
  );
}

function cleanLine(line: LineItem): LineItem {
  return {
    id: line.id,
    description: line.description.slice(0, MAX_DESCRIPTION_LENGTH),
    quantity: Math.min(MAX_QUANTITY, Math.max(0, line.quantity)),
    unitPriceCents: Math.min(
      MAX_UNIT_PRICE_CENTS,
      Math.max(0, line.unitPriceCents),
    ),
    account: REVENUE_ACCOUNTS.some((account) => account.code === line.account)
      ? line.account
      : (REVENUE_ACCOUNTS[0]?.code ?? "4000"),
    taxCode: line.taxCode,
  };
}

function isPostedDocument(value: unknown): value is PostedDocument {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PostedDocument>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.number === "string" &&
    typeof candidate.customer === "string" &&
    typeof candidate.currency === "string" &&
    isCurrency(candidate.currency) &&
    isIsoDate(candidate.issuedOn) &&
    isIsoDate(candidate.dueOn) &&
    typeof candidate.totalCents === "number" &&
    Number.isFinite(candidate.totalCents) &&
    typeof candidate.baseTotalCents === "number" &&
    Number.isFinite(candidate.baseTotalCents) &&
    typeof candidate.settledBaseCents === "number" &&
    Number.isFinite(candidate.settledBaseCents)
  );
}
