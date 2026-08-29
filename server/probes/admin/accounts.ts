import { randomUUID } from "node:crypto";

import { createJsonStore, StoreError, type JsonStore } from "../../json-store";

/**
 * The admin probe's records.
 *
 * The data is deliberately ordinary: the probe is about interaction ownership,
 * not about the domain. What matters here is that every mutation is expressed
 * as an absolute outcome over an explicit set of ids, because a bulk action
 * applied from a stale selection must still mean what the user asked for.
 */

export type Plan = "free" | "team" | "business" | "enterprise";
export type AccountStatus = "active" | "trial" | "suspended" | "churned";

export type Account = {
  id: string;
  name: string;
  owner: string;
  region: string;
  plan: Plan;
  status: AccountStatus;
  seats: number;
  flagged: boolean;
  notes: string;
};

export type AuditEntry = {
  id: string;
  at: number;
  actor: string;
  action: string;
  targets: number;
};

export type AdminData = {
  accounts: Account[];
  audit: AuditEntry[];
};

export const PLANS: readonly Plan[] = ["free", "team", "business", "enterprise"];
export const STATUSES: readonly AccountStatus[] = [
  "active",
  "trial",
  "suspended",
  "churned",
];

/** Monthly price per seat, so the modal has a server-derived total to show. */
export const SEAT_PRICE: Record<Plan, number> = {
  free: 0,
  team: 12,
  business: 28,
  enterprise: 45,
};

export const MAX_SEATS = 5000;
export const MAX_NOTES_LENGTH = 400;
const AUDIT_LIMIT = 40;

/** Fixed rather than generated, so measurements and tests describe one table. */
const SEED: ReadonlyArray<
  [string, string, string, string, Plan, AccountStatus, number, boolean]
> = [
  ["acc-001", "Northwind Freight", "dana@northwind.example", "us-east", "business", "active", 240, false],
  ["acc-002", "Harbourline Media", "kit@harbourline.example", "eu-west", "team", "active", 42, false],
  ["acc-003", "Grayfell Robotics", "amara@grayfell.example", "us-west", "enterprise", "active", 1180, true],
  ["acc-004", "Tessellate Labs", "yuki@tessellate.example", "ap-south", "free", "trial", 6, false],
  ["acc-005", "Ridgeway Clinics", "omar@ridgeway.example", "us-east", "business", "suspended", 310, true],
  ["acc-006", "Kestrel Analytics", "nina@kestrel.example", "eu-west", "team", "active", 58, false],
  ["acc-007", "Alder & Vine", "pete@aldervine.example", "us-east", "free", "churned", 3, false],
  ["acc-008", "Bramblewood Coop", "sara@bramblewood.example", "eu-north", "team", "active", 77, false],
  ["acc-009", "Quarrystone Build", "leo@quarrystone.example", "us-west", "business", "active", 194, false],
  ["acc-010", "Pelagic Shipping", "mira@pelagic.example", "ap-south", "enterprise", "active", 860, false],
  ["acc-011", "Lantern Health", "arjun@lanternhealth.example", "us-east", "business", "trial", 120, false],
  ["acc-012", "Foxglove Studio", "iris@foxglove.example", "eu-west", "free", "trial", 4, false],
  ["acc-013", "Meridian Trucking", "hal@meridian.example", "us-central", "team", "suspended", 65, true],
  ["acc-014", "Saltmarsh Energy", "wren@saltmarsh.example", "eu-north", "enterprise", "active", 640, false],
  ["acc-015", "Copperfield Retail", "juno@copperfield.example", "us-west", "business", "active", 288, false],
  ["acc-016", "Iversen Legal", "erik@iversen.example", "eu-north", "team", "churned", 21, false],
  ["acc-017", "Palegrove Farms", "tia@palegrove.example", "us-central", "free", "trial", 8, false],
  ["acc-018", "Nightjar Security", "roan@nightjar.example", "eu-west", "enterprise", "active", 402, true],
  ["acc-019", "Willowbrook Schools", "faye@willowbrook.example", "us-east", "business", "active", 355, false],
  ["acc-020", "Corvid Logistics", "sam@corvid.example", "ap-south", "team", "active", 91, false],
  ["acc-021", "Halcyon Travel", "bo@halcyon.example", "eu-west", "free", "churned", 2, false],
  ["acc-022", "Ferrous Works", "gita@ferrous.example", "us-central", "business", "trial", 168, false],
  ["acc-023", "Marlowe Publishing", "ade@marlowe.example", "eu-north", "team", "active", 36, false],
  ["acc-024", "Zephyr Instruments", "lena@zephyr.example", "us-west", "enterprise", "suspended", 720, true],
];

export function seedAccounts(): Account[] {
  return SEED.map(([id, name, owner, region, plan, status, seats, flagged]) => ({
    id,
    name,
    owner,
    region,
    plan,
    status,
    seats,
    flagged,
    notes: "",
  }));
}

export function monthlyValue(account: Account): number {
  return SEAT_PRICE[account.plan] * account.seats;
}

/**
 * Bulk-shaped access to the records.
 *
 * Every mutation takes an explicit list of ids and an absolute target value,
 * which is the I6 rule applied to a selection: the user's intent is "suspend
 * these four accounts", not "suspend whatever is selected right now". A bulk
 * action that read the selection itself would mean something different by the
 * time it arrived.
 */
export class AccountStore {
  private readonly store: JsonStore<AdminData>;

  constructor(store: JsonStore<AdminData>) {
    this.store = store;
  }

  list(): Account[] {
    return this.store.state.accounts.map((account) => ({ ...account }));
  }

  audit(): AuditEntry[] {
    return this.store.state.audit.map((entry) => ({ ...entry }));
  }

  get(id: string): Account | undefined {
    const found = this.store.state.accounts.find(
      (account) => account.id === id,
    );
    return found ? { ...found } : undefined;
  }

  setStatus(
    ids: readonly string[],
    status: AccountStatus,
    actor: string,
  ): Promise<number> {
    if (!STATUSES.includes(status)) {
      throw new StoreError(`unknown status: ${status}`);
    }
    return this.apply(ids, actor, `set status ${status}`, (account) =>
      account.status === status ? account : { ...account, status },
    );
  }

  setPlan(ids: readonly string[], plan: Plan, actor: string): Promise<number> {
    if (!PLANS.includes(plan)) {
      throw new StoreError(`unknown plan: ${plan}`);
    }
    return this.apply(ids, actor, `set plan ${plan}`, (account) =>
      account.plan === plan ? account : { ...account, plan },
    );
  }

  setFlagged(
    ids: readonly string[],
    flagged: boolean,
    actor: string,
  ): Promise<number> {
    return this.apply(
      ids,
      actor,
      flagged ? "flag for review" : "clear review flag",
      (account) => (account.flagged === flagged ? account : { ...account, flagged }),
    );
  }

  /** The modal's save. Absolute values for every field it can edit. */
  save(
    id: string,
    patch: { plan: Plan; status: AccountStatus; seats: number; notes: string },
    actor: string,
  ): Promise<number> {
    const seats = normalizeSeats(patch.seats);
    const notes = normalizeNotes(patch.notes);
    if (!PLANS.includes(patch.plan)) {
      throw new StoreError(`unknown plan: ${patch.plan}`);
    }
    if (!STATUSES.includes(patch.status)) {
      throw new StoreError(`unknown status: ${patch.status}`);
    }

    return this.apply([id], actor, "edit account", (account) => ({
      ...account,
      plan: patch.plan,
      status: patch.status,
      seats,
      notes,
    }));
  }

  remove(ids: readonly string[], actor: string): Promise<number> {
    const wanted = new Set(ids);

    return this.store.mutate((data) => {
      const kept = data.accounts.filter((account) => !wanted.has(account.id));
      const removed = data.accounts.length - kept.length;
      if (removed === 0) return { next: data, result: 0 };

      return {
        next: {
          accounts: kept,
          audit: appendAudit(data.audit, actor, "delete accounts", removed),
        },
        result: removed,
      };
    });
  }

  /**
   * Creates a record with a server-generated id.
   *
   * Unpredictable by construction, which is why the invite dialog is the one
   * interaction in this probe that an SPA would also have to wait for.
   */
  invite(
    input: { name: string; owner: string; plan: Plan; seats: number },
    actor: string,
  ): Promise<Account> {
    const name = normalizeText(input.name, "account name", 80);
    const owner = normalizeText(input.owner, "owner email", 120);
    if (!PLANS.includes(input.plan)) {
      throw new StoreError(`unknown plan: ${input.plan}`);
    }

    const account: Account = {
      id: `acc-${randomUUID().slice(0, 8)}`,
      name,
      owner,
      region: "us-east",
      plan: input.plan,
      status: "trial",
      seats: normalizeSeats(input.seats),
      flagged: false,
      notes: "",
    };

    return this.store.mutate((data) => ({
      next: {
        accounts: [account, ...data.accounts],
        audit: appendAudit(data.audit, actor, `invite ${account.name}`, 1),
      },
      result: account,
    }));
  }

  onChange(listener: () => void): () => void {
    return this.store.onChange(listener);
  }

  /**
   * Applies an idempotent transform to the named records.
   *
   * Ids that no longer exist are skipped rather than rejected: a bulk action is
   * a statement about a set, and the set having shrunk under the user is normal
   * once anything can be in flight.
   */
  private apply(
    ids: readonly string[],
    actor: string,
    action: string,
    transform: (account: Account) => Account,
  ): Promise<number> {
    const wanted = new Set(ids);
    if (wanted.size === 0) {
      throw new StoreError("no accounts were named for this action");
    }

    return this.store.mutate((data) => {
      let changed = 0;
      const accounts = data.accounts.map((account) => {
        if (!wanted.has(account.id)) return account;
        const next = transform(account);
        if (next !== account) changed += 1;
        return next;
      });

      if (changed === 0) return { next: data, result: 0 };

      return {
        next: {
          accounts,
          audit: appendAudit(data.audit, actor, action, changed),
        },
        result: changed,
      };
    });
  }
}

export async function createAccountStore(file: string): Promise<AccountStore> {
  const store = await createJsonStore<AdminData>({
    file,
    initial: () => ({ accounts: seedAccounts(), audit: [] }),
    parse: (raw) => parseAdminData(raw, file),
  });
  return new AccountStore(store);
}

function appendAudit(
  audit: readonly AuditEntry[],
  actor: string,
  action: string,
  targets: number,
): AuditEntry[] {
  const entry: AuditEntry = {
    id: randomUUID(),
    at: Date.now(),
    actor,
    action,
    targets,
  };
  return [entry, ...audit].slice(0, AUDIT_LIMIT);
}

function normalizeSeats(value: number): number {
  if (!Number.isFinite(value)) {
    throw new StoreError("seats must be a number");
  }
  const seats = Math.trunc(value);
  if (seats < 1) {
    throw new StoreError("seats must be at least 1");
  }
  if (seats > MAX_SEATS) {
    throw new StoreError(`seats must be at most ${MAX_SEATS}`);
  }
  return seats;
}

function normalizeNotes(value: string): string {
  if (typeof value !== "string") {
    throw new StoreError("notes must be a string");
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_NOTES_LENGTH) {
    throw new StoreError(`notes must be at most ${MAX_NOTES_LENGTH} characters`);
  }
  return trimmed;
}

function normalizeText(value: string, label: string, limit: number): string {
  if (typeof value !== "string") {
    throw new StoreError(`${label} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new StoreError(`${label} must not be empty`);
  }
  if (trimmed.length > limit) {
    throw new StoreError(`${label} must be at most ${limit} characters`);
  }
  return trimmed;
}

function parseAdminData(raw: unknown, file: string): AdminData {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`malformed admin data file: ${file}`);
  }

  const candidate = raw as Partial<AdminData>;
  if (!Array.isArray(candidate.accounts)) {
    throw new Error(`malformed admin data file: ${file}`);
  }

  return {
    accounts: candidate.accounts.filter(isAccount).map((account) => ({
      ...account,
    })),
    audit: Array.isArray(candidate.audit)
      ? candidate.audit.filter(isAuditEntry).slice(0, AUDIT_LIMIT)
      : [],
  };
}

function isAccount(value: unknown): value is Account {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Account>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.owner === "string" &&
    typeof candidate.region === "string" &&
    typeof candidate.seats === "number" &&
    typeof candidate.flagged === "boolean" &&
    typeof candidate.notes === "string" &&
    PLANS.includes(candidate.plan as Plan) &&
    STATUSES.includes(candidate.status as AccountStatus)
  );
}

function isAuditEntry(value: unknown): value is AuditEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AuditEntry>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.at === "number" &&
    typeof candidate.actor === "string" &&
    typeof candidate.action === "string" &&
    typeof candidate.targets === "number"
  );
}
