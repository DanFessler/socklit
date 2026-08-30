import {
  component,
  createJsonStore,
  html,
  keyed,
  StoreError,
  useState,
  useStore,
  type SubmitPayload,
} from "socklit/server";

export type FridgeItem = {
  id: string;
  name: string;
  qty: number;
};

function parseItems(raw: unknown): FridgeItem[] {
  if (!Array.isArray(raw)) throw new StoreError("expected an array");
  return raw.map((row) => {
    if (!row || typeof row !== "object") throw new StoreError("expected items");
    const { id, name, qty } = row as {
      id?: unknown;
      name?: unknown;
      qty?: unknown;
    };
    if (typeof id !== "string" || typeof name !== "string") {
      throw new StoreError("invalid item");
    }
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 0) {
      throw new StoreError("invalid quantity");
    }
    return { id, name, qty };
  });
}

export const store = await createJsonStore<FridgeItem[]>({
  file: "data/fridge.json",
  initial: () => [],
  parse: parseItems,
});

function parseNonNegativeInt(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

export const App = component(function App(props: { store: typeof store }) {
  const items = useStore(props.store).state;
  const [error, setError] = useState("");

  return html`
    <header class="app-header">
      <h1>Office fridge</h1>
      <p>What is in the fridge. Shared with everyone.</p>
    </header>

    <form
      class="add-form"
      @submit=${(event: SubmitPayload) => {
        const name = event.fields["name"]?.trim() ?? "";
        const qty = parseNonNegativeInt(event.fields["qty"]);
        if (!name) {
          setError("Name cannot be blank.");
          return;
        }
        if (qty === null) {
          setError("Quantity must be a non-negative integer.");
          return;
        }
        setError("");
        void props.store.mutate((current) => ({
          next: [...current, { id: crypto.randomUUID(), name, qty }],
          result: undefined,
        }));
      }}
    >
      <input name="name" placeholder="Item name" required />
      <input
        name="qty"
        type="number"
        min="0"
        step="1"
        value="1"
        placeholder="Qty"
        required
      />
      <button class="primary" type="submit">Add</button>
    </form>

    ${error ? html`<p>${error}</p>` : ""}

    ${items.length === 0
      ? html`<p>The fridge is empty. Add something above.</p>`
      : html`<ul class="item-list">
          ${keyed(
            items,
            (item) => item.id,
            (item) => html`
              <li class="item">
                <span>${item.name}</span>
                <span>${item.qty}</span>
                <button
                  type="button"
                  ?disabled=${item.qty <= 0}
                  @click=${() => {
                    void props.store.mutate((current) => {
                      const found = current.find((row) => row.id === item.id);
                      if (!found || found.qty <= 0) {
                        return { next: current, result: undefined };
                      }
                      return {
                        next: current.map((row) =>
                          row.id === item.id
                            ? { ...row, qty: row.qty - 1 }
                            : row,
                        ),
                        result: undefined,
                      };
                    });
                  }}
                >
                  Take
                </button>
                <form
                  @submit=${(event: SubmitPayload) => {
                    const amount = parseNonNegativeInt(event.fields["amount"]);
                    if (amount === null || amount === 0) {
                      setError("Restock amount must be a positive integer.");
                      return;
                    }
                    setError("");
                    void props.store.mutate((current) => {
                      const found = current.find((row) => row.id === item.id);
                      if (!found) {
                        return { next: current, result: undefined };
                      }
                      return {
                        next: current.map((row) =>
                          row.id === item.id
                            ? { ...row, qty: row.qty + amount }
                            : row,
                        ),
                        result: undefined,
                      };
                    });
                  }}
                >
                  <input
                    name="amount"
                    type="number"
                    min="1"
                    step="1"
                    value="1"
                    placeholder="Qty"
                    required
                  />
                  <button type="submit">Restock</button>
                </form>
                <button
                  type="button"
                  @click=${() => {
                    void props.store.mutate((current) => ({
                      next: current.filter((row) => row.id !== item.id),
                      result: undefined,
                    }));
                  }}
                >
                  Remove
                </button>
              </li>
            `,
          )}
        </ul>`}
  `;
});
