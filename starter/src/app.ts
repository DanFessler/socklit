import {
  component,
  createJsonStore,
  html,
  keyed,
  StoreError,
  type SubmitPayload,
  useStore,
} from "socklit/server";

export type Item = { id: string; title: string };

function parseItems(raw: unknown): Item[] {
  if (!Array.isArray(raw)) throw new StoreError("expected an array");
  return raw.map((row) => {
    if (!row || typeof row !== "object") throw new StoreError("expected items");
    const { id, title } = row as { id?: unknown; title?: unknown };
    if (typeof id !== "string" || typeof title !== "string") {
      throw new StoreError("invalid item");
    }
    return { id, title };
  });
}

/** Shared with every tab. The path is relative to the process working directory. */
export const store = await createJsonStore<Item[]>({
  file: "data/items.json",
  initial: () => [],
  parse: parseItems,
});

export const App = component(function App(props: { store: typeof store }) {
  const items = useStore(props.store).state;

  return html`
    <header class="app-header">
      <h1>Shared list</h1>
      <p>Open a second tab. Add something. Both tabs should match.</p>
    </header>

    <form
      class="add-form"
      @submit=${(event: SubmitPayload) => {
        const title = event.fields["title"]?.trim() ?? "";
        if (!title) return;
        void props.store.mutate((current) => ({
          next: [...current, { id: crypto.randomUUID(), title }],
          result: undefined,
        }));
      }}
    >
      <input name="title" placeholder="Something shared" required />
      <button class="primary" type="submit">Add</button>
    </form>

    ${items.length === 0
      ? html`<p class="empty">Nothing here yet.</p>`
      : html`<ul class="item-list">
          ${keyed(
            items,
            (item) => item.id,
            (item) => html`<li class="item">${item.title}</li>`,
          )}
        </ul>`}
  `;
});
