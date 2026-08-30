import { html } from "lit-html";

import { ColorPicker, SWATCHES } from "../../../islands/color-picker";
import { PrioritySelect } from "../../../islands/priority-select";
import type { ChangePayload, SubmitPayload } from "../../../shared/protocol";
import { component, useStore, type RenderOutput } from "../../component";
import { keyed } from "../../keyed";
import {
  PRIORITY_OPTIONS,
  type Card,
  type CardStore,
} from "./store";

/**
 * The authoring story, as a page.
 *
 * Look at the two `.mount()` calls. They are not components. They do not
 * return markup. They place a named client widget in a hole and hand it
 * JSON plus closures. The closures are the same kind that sit on `@click`.
 *
 * Contrast the delete button: that is a server handler on a server
 * template, because a destructive action is not a widget.
 */
export const IslandsApp = component(function IslandsApp(props: {
  cards: CardStore;
}) {
  const cards = useStore(props.cards).list();

  return html`
    <div class="flex flex-col gap-6">
      <header class="flex flex-col gap-2">
        <p class="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">
          A3 · islands
        </p>
        <h1 class="m-0 text-2xl font-semibold tracking-tight">Ship board</h1>
        <p class="m-0 text-[var(--text-muted)]">
          Dashed outline means a React island. Opening one is free. Choosing a
          value is a server write — watch the protocol panel, and a second tab.
        </p>
      </header>

      <aside
        class="rounded-[var(--radius)] border border-dashed border-[var(--accent)]/40 bg-[var(--surface-sunken)] px-4 py-3 text-sm text-[var(--text-muted)]"
      >
        <p class="m-0">
          <strong class="text-[var(--text)]">The boundary is a word, not a pragma.</strong>
          Server templates call <code class="text-[var(--accent)]">.mount()</code>.
          Island files end in <code class="text-[var(--accent)]">.island.tsx</code>
          and are the only files that import React. No children cross. Callbacks
          stay on the server.
        </p>
      </aside>

      <form
        class="add-form"
        @submit=${(event: SubmitPayload) =>
          props.cards.add(event.fields["title"] ?? "")}
      >
        <input
          name="title"
          placeholder="Something to ship"
          autocomplete="off"
          maxlength="120"
          required
        />
        <button class="primary" type="submit">Add</button>
      </form>

      ${cards.length === 0
        ? html`<p class="empty">Nothing on the board.</p>`
        : html`<ul class="m-0 flex list-none flex-col gap-2 p-0">
            ${keyed(cards, (card) => card.id, (card) =>
              CardRow({ cards: props.cards, card }),
            )}
          </ul>`}
    </div>
  `;
});

const CardRow = component(function CardRow(props: {
  cards: CardStore;
  card: Card;
}) {
  const { cards, card } = props;

  return html`
    <li
      class="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5"
    >
      <span
        class="h-2.5 w-2.5 shrink-0 rounded-full"
        style="background:${card.color}"
        title=${card.color}
      ></span>

      <label class="todo-label min-w-0 flex-1">
        <input
          type="checkbox"
          .checked=${card.done}
          @change=${(event: ChangePayload) =>
            cards.setDone(card.id, event.checked ?? !card.done)}
        />
        <span class=${card.done ? "line-through opacity-60" : ""}>${card.title}</span>
      </label>

      ${PrioritySelect.mount({
        value: card.priority,
        options: PRIORITY_OPTIONS,
        onChange: (priority) => cards.setPriority(card.id, priority),
      })}

      ${ColorPicker.mount({
        value: card.color,
        swatches: [...SWATCHES],
        onChange: (color) => cards.setColor(card.id, color),
      })}

      <button
        class="remove"
        type="button"
        title="Delete"
        @click=${() => cards.remove(card.id)}
      >
        &times;
      </button>
    </li>
  `;
});

export function createIslandsApp(cards: CardStore): () => RenderOutput {
  return () => IslandsApp({ cards });
}
