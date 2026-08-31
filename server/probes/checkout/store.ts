import { StoreError, createJsonStore, type JsonStore } from "../../json-store";

/**
 * Shared catalog and placed orders, plus an optional per-user draft table.
 *
 * The draft table is the stand-in for the middle tier S4 asks about. Putting a
 * wizard there survives reconnect (the file outlives the socket) and is shared
 * by every tab of that user (there is only one row per user). That collision
 * is the measurement, not a bug to paper over.
 */

export type Step = 1 | 2 | 3 | 4;

export type Address = {
  name: string;
  street: string;
  city: string;
};

export type Payment = {
  last4: string;
};

export type Cart = Record<string, number>;

export type Draft = {
  step: Step;
  cart: Cart;
  address: Address;
  payment: Payment;
};

export type CatalogItem = {
  id: string;
  name: string;
  priceCents: number;
  stock: number;
};

export type Order = {
  id: string;
  user: string;
  lines: Array<{ id: string; name: string; qty: number; priceCents: number }>;
  address: Address;
  last4: string;
  placedAt: number;
};

export type CheckoutState = {
  catalog: CatalogItem[];
  drafts: Record<string, Draft>;
  orders: Order[];
};

export const EMPTY_ADDRESS: Address = { name: "", street: "", city: "" };
export const EMPTY_PAYMENT: Payment = { last4: "" };

export function emptyDraft(): Draft {
  return {
    step: 1,
    cart: {},
    address: { ...EMPTY_ADDRESS },
    payment: { ...EMPTY_PAYMENT },
  };
}

export const CATALOG: CatalogItem[] = [
  { id: "mug", name: "Mug", priceCents: 1400, stock: 20 },
  { id: "tote", name: "Tote", priceCents: 2200, stock: 12 },
  { id: "cap", name: "Cap", priceCents: 1800, stock: 8 },
];

export type CheckoutStore = {
  state: () => CheckoutState;
  item: (id: string) => CatalogItem | undefined;
  draft: (user: string) => Draft;
  ordersFor: (user: string) => Order[];
  setQty: (user: string, sku: string, qty: number) => Promise<void>;
  setStep: (user: string, step: Step) => Promise<void>;
  setAddress: (user: string, address: Address) => Promise<void>;
  setPayment: (user: string, last4: string) => Promise<void>;
  saveDraft: (user: string, draft: Draft) => Promise<void>;
  clearDraft: (user: string) => Promise<void>;
  place: (user: string, draft: Draft) => Promise<Order>;
  onChange: (listener: () => void) => () => void;
};

export async function createCheckoutStore(
  file: string,
): Promise<CheckoutStore> {
  const store = await createJsonStore<CheckoutState>({
    file,
    initial: () => ({ catalog: CATALOG.map((item) => ({ ...item })), drafts: {}, orders: [] }),
    parse: parseState,
  });
  return wrap(store);
}

function wrap(store: JsonStore<CheckoutState>): CheckoutStore {
  return {
    state: () => store.state,

    item: (id) => store.state.catalog.find((item) => item.id === id),

    draft: (user) => store.state.drafts[user] ?? emptyDraft(),

    ordersFor: (user) => store.state.orders.filter((order) => order.user === user),

    setQty: (user, sku, qty) =>
      store.mutate((state) => {
        const item = state.catalog.find((entry) => entry.id === sku);
        if (!item) throw new StoreError(`unknown item ${sku}`);
        const nextQty = clampQty(qty, item.stock);
        const current = state.drafts[user] ?? emptyDraft();
        const cart = { ...current.cart };
        if (nextQty <= 0) delete cart[sku];
        else cart[sku] = nextQty;
        return {
          next: withDraft(state, user, { ...current, cart }),
          result: undefined,
        };
      }),

    setStep: (user, step) =>
      store.mutate((state) => {
        const current = state.drafts[user] ?? emptyDraft();
        if (current.step === step) return { next: state, result: undefined };
        return {
          next: withDraft(state, user, { ...current, step }),
          result: undefined,
        };
      }),

    setAddress: (user, address) =>
      store.mutate((state) => {
        const current = state.drafts[user] ?? emptyDraft();
        return {
          next: withDraft(state, user, {
            ...current,
            address: normalizeAddress(address),
          }),
          result: undefined,
        };
      }),

    setPayment: (user, last4) =>
      store.mutate((state) => {
        const current = state.drafts[user] ?? emptyDraft();
        return {
          next: withDraft(state, user, {
            ...current,
            payment: { last4: normalizeLast4(last4) },
          }),
          result: undefined,
        };
      }),

    saveDraft: (user, draft) =>
      store.mutate((state) => ({
        next: withDraft(state, user, {
          step: draft.step,
          cart: { ...draft.cart },
          address: normalizeAddress(draft.address),
          payment: { last4: normalizeLast4(draft.payment.last4) },
        }),
        result: undefined,
      })),

    clearDraft: (user) =>
      store.mutate((state) => {
        if (!(user in state.drafts)) return { next: state, result: undefined };
        const drafts = { ...state.drafts };
        delete drafts[user];
        return { next: { ...state, drafts }, result: undefined };
      }),

    place: (user, draft) =>
      store.mutate((state) => {
        const lines = linesOf(state.catalog, draft.cart);
        if (lines.length === 0) throw new StoreError("cart is empty");
        if (!isCompleteAddress(draft.address)) {
          throw new StoreError("address is incomplete");
        }
        if (!isLast4(draft.payment.last4)) {
          throw new StoreError("card is incomplete");
        }
        const catalog = state.catalog.map((item) => {
          const qty = draft.cart[item.id] ?? 0;
          if (qty > item.stock) {
            throw new StoreError(`${item.name} is gone`);
          }
          return qty === 0 ? item : { ...item, stock: item.stock - qty };
        });
        const order: Order = {
          id: `ord-${state.orders.length + 1}`,
          user,
          lines,
          address: draft.address,
          last4: draft.payment.last4,
          placedAt: Date.now(),
        };
        const drafts = { ...state.drafts };
        delete drafts[user];
        return {
          next: {
            ...state,
            catalog,
            drafts,
            orders: [...state.orders, order],
          },
          result: order,
        };
      }),

    onChange: (listener) => store.onChange(listener),
  };
}

function withDraft(
  state: CheckoutState,
  user: string,
  draft: Draft,
): CheckoutState {
  return { ...state, drafts: { ...state.drafts, [user]: draft } };
}

export function linesOf(
  catalog: CatalogItem[],
  cart: Cart,
): Array<{ id: string; name: string; qty: number; priceCents: number }> {
  return catalog
    .map((item) => ({
      id: item.id,
      name: item.name,
      qty: cart[item.id] ?? 0,
      priceCents: item.priceCents,
    }))
    .filter((line) => line.qty > 0);
}

export function cartCount(cart: Cart): number {
  return Object.values(cart).reduce((sum, qty) => sum + qty, 0);
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function clampQty(qty: number, stock: number): number {
  if (!Number.isFinite(qty)) return 0;
  return Math.max(0, Math.min(stock, Math.round(qty)));
}

export function normalizeAddress(address: Address): Address {
  return {
    name: address.name.trim().slice(0, 80),
    street: address.street.trim().slice(0, 120),
    city: address.city.trim().slice(0, 80),
  };
}

export function normalizeLast4(raw: string): string {
  return raw.replace(/\D/g, "").slice(-4);
}

export function isCompleteAddress(address: Address): boolean {
  return (
    address.name.length > 0 &&
    address.street.length > 0 &&
    address.city.length > 0
  );
}

export function isLast4(value: string): boolean {
  return /^\d{4}$/.test(value);
}

export function isStep(value: number): value is Step {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function parseState(raw: unknown): CheckoutState {
  if (typeof raw !== "object" || raw === null) {
    throw new StoreError("checkout state is not an object");
  }
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.catalog) || !Array.isArray(record.orders)) {
    throw new StoreError("checkout state is missing catalog or orders");
  }
  return {
    catalog: record.catalog as CatalogItem[],
    drafts:
      typeof record.drafts === "object" && record.drafts !== null
        ? (record.drafts as Record<string, Draft>)
        : {},
    orders: record.orders as Order[],
  };
}
