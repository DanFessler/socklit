import {
  component,
  createJsonStore,
  html,
  keyed,
  mount,
  StoreError,
  useState,
  useStore,
  type SubmitPayload,
} from "socklit/server";

import { personName, STAFF } from "./staff";
import { StaffPicker } from "./staff-picker";

export type Item = {
  id: string;
  name: string;
  holderId: string | null;
};

function parseItems(raw: unknown): Item[] {
  if (!Array.isArray(raw)) throw new StoreError("expected an array");
  return raw.map((row) => {
    if (!row || typeof row !== "object") throw new StoreError("expected items");
    const { id, name, holderId } = row as {
      id?: unknown;
      name?: unknown;
      holderId?: unknown;
    };
    if (typeof id !== "string" || typeof name !== "string") {
      throw new StoreError("invalid item");
    }
    if (holderId !== null && typeof holderId !== "string") {
      throw new StoreError("invalid holder");
    }
    return { id, name, holderId };
  });
}

/** Shared with every tab. Path is relative to the process working directory. */
export const store = await createJsonStore<Item[]>({
  file: "data/holds.json",
  initial: () => [],
  parse: parseItems,
});

function addItem(name: string): void {
  void store.mutate((current) => ({
    next: [...current, { id: crypto.randomUUID(), name, holderId: null }],
    result: undefined,
  }));
}

function removeItem(id: string): void {
  void store.mutate((current) => ({
    next: current.filter((item) => item.id !== id),
    result: undefined,
  }));
}

function checkOut(id: string, holderId: string): void {
  void store.mutate((current) => ({
    next: current.map((item) =>
      item.id === id ? { ...item, holderId } : item,
    ),
    result: undefined,
  }));
}

function checkIn(id: string): void {
  void store.mutate((current) => ({
    next: current.map((item) =>
      item.id === id ? { ...item, holderId: null } : item,
    ),
    result: undefined,
  }));
}

export const App = component(function App(props: { store: typeof store }) {
  const items = useStore(props.store).state;
  const [error, setError] = useState("");

  return html`
    <header class="app-header">
      <h1>Loan desk</h1>
      <p>Shared office gear. Check something out to a person, or bring it back.</p>
    </header>

    <form
      class="add-form"
      @submit=${(event: SubmitPayload) => {
        const name = event.fields["name"]?.trim() ?? "";
        if (!name) {
          setError("Name cannot be blank.");
          return;
        }
        setError("");
        addItem(name);
      }}
    >
      <input name="name" placeholder="Laptop, camera, HDMI cable…" required />
      <button class="primary" type="submit">Add gear</button>
    </form>

    ${error ? html`<p class="flash">${error}</p>` : ""}

    ${items.length === 0
      ? html`<p class="empty">Nothing on the shelf yet. Add a piece of gear.</p>`
      : html`<ul class="item-list">
          ${keyed(items, (item) => item.id, (item) => GearRow({ item }))}
        </ul>`}
  `;
});

const GearRow = component(function GearRow(props: { item: Item }) {
  const { item } = props;
  const holder = personName(item.holderId);

  return html`
    <li class="item">
      <div class="item-main">
        <div class="item-name">${item.name}</div>
        <p class="item-status">
          ${holder ? `Out with ${holder}` : "On the shelf"}
        </p>
      </div>
      <div class="item-actions">
        ${item.holderId
          ? html`
              <button type="button" @click=${() => checkIn(item.id)}>
                Check in
              </button>
            `
          : mount(StaffPicker, {
              people: STAFF,
              value: item.holderId,
              onPick: (id: string) => checkOut(item.id, id),
            })}
        <button type="button" @click=${() => removeItem(item.id)}>
          Remove
        </button>
      </div>
    </li>
  `;
});
