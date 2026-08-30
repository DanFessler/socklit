import { html } from "lit-html";

import { AssigneePicker } from "../../../islands/assignee-picker";
import { ColorPicker, SWATCHES } from "../../../islands/color-picker";
import { PrioritySelect } from "../../../islands/priority-select";
import type { ChangePayload, SubmitPayload } from "../../../shared/protocol";
import { component, useStore, type RenderOutput } from "../../component";
import { keyed } from "../../keyed";
import {
  PRIORITY_OPTIONS,
  TEAM_LABEL,
  TEAMS,
  type Card,
  type CardStore,
} from "./store";

/**
 * The authoring story, as a page.
 *
 * Priority and colour are terminal islands: JSON in, callback out. Assign
 * is the other shape — the island owns the overlay; `<slot>` is a well
 * the replica keeps painting. Team chips and people rows inside that well
 * are ordinary server templates with ordinary closures.
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
          Purple dash is a React island. Green dash is a server tree the island
          is hosting. Open Assign: free. Change team while it is open: the list
          swaps, the popover stays.
        </p>
      </header>

      <aside
        class="rounded-[var(--radius)] border border-dashed border-[var(--accent)]/40 bg-[var(--surface-sunken)] px-4 py-3 text-sm text-[var(--text-muted)]"
      >
        <p class="m-0">
          <strong class="text-[var(--text)]"
            >The well is a second element, not children.</strong
          >
          Terminal islands are
          <code class="text-[var(--accent)]">&lt;mount&gt;</code>. A hosted
          region is <code class="text-[var(--accent)]">&lt;slot&gt;</code>. The
          island cannot map it or branch on it — it can only say where the box
          goes. No children cross. Callbacks stay on the server.
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
            ${keyed(
              cards,
              (card) => card.id,
              (card) =>
                html`<CardRow .cards=${props.cards} .card=${card}></CardRow>`,
            )}
          </ul>`}
    </div>
  `;
});

component.tag("CardRow", (props: { cards: CardStore; card: Card }) => {
    const { cards, card } = props;
    const assignee = cards.person(card.assigneeId);
    const people = cards.peopleOn(card.team);

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
          <span class=${card.done ? "line-through opacity-60" : ""}
            >${card.title}</span
          >
        </label>

        <mount
          .Island=${PrioritySelect}
          .value=${card.priority}
          .options=${PRIORITY_OPTIONS}
          .onChange=${(priority: string) =>
            cards.setPriority(card.id, priority)}
        ></mount>

        <mount
          .Island=${ColorPicker}
          .value=${card.color}
          .swatches=${[...SWATCHES]}
          .onChange=${(color: string) => cards.setColor(card.id, color)}
        ></mount>

        <mount .Island=${AssigneePicker} .label=${assignee?.name ?? "Assign"}>
          <slot>
            <div class="flex flex-col gap-2">
              <p
                class="m-0 px-1 text-[0.65rem] uppercase tracking-[0.14em] text-[var(--text-muted)]"
              >
                Team
              </p>
              <div class="flex flex-wrap gap-1 px-1">
                ${keyed(
                  TEAMS,
                  (team) => team,
                  (team) => html`
                    <button
                      type="button"
                      class=${card.team === team
                        ? "rounded-md border border-[var(--accent)] bg-[var(--surface)] px-2 py-0.5 text-sm text-[var(--text)]"
                        : "rounded-md border border-[var(--border)] bg-transparent px-2 py-0.5 text-sm text-[var(--text-muted)] hover:border-[var(--accent)]"}
                      @click=${() => cards.setTeam(card.id, team)}
                    >
                      ${TEAM_LABEL[team]}
                    </button>
                  `,
                )}
              </div>
              <p
                class="m-0 px-1 text-[0.65rem] uppercase tracking-[0.14em] text-[var(--text-muted)]"
              >
                People
              </p>
              <ul class="m-0 flex list-none flex-col gap-0.5 p-0">
                ${keyed(
                  people,
                  (person) => person.id,
                  (person) => html`
                    <li>
                      <button
                        type="button"
                        class=${person.id === card.assigneeId
                          ? "flex w-full items-baseline justify-between rounded-md bg-[var(--surface)] px-2 py-1.5 text-left text-sm"
                          : "flex w-full items-baseline justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--surface)]"}
                        @click=${() => cards.assign(card.id, person.id)}
                      >
                        <span>${person.name}</span>
                        <span class="text-[var(--text-muted)]"
                          >${person.role}</span
                        >
                      </button>
                    </li>
                  `,
                )}
              </ul>
            </div>
          </slot>
        </mount>

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
