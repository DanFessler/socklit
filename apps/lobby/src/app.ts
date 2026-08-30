import {
  component,
  html,
  keyed,
  type SessionHandle,
  type SubmitPayload,
  useState,
  useStore,
} from "socklit/server";

import { clearTable, colorOf, play, seatedAt, sit, stand, standEverywhere, store, type Table } from "./hall";
import { PEOPLE, displayName, personByName, type Person } from "./people";
import { PieceHand, type HandMan } from "./piece-hand";
import { BOARD, idx, type Color } from "./rules";
import { issue, tickets } from "./tickets";

export { store };

const SQUARES = Array.from({ length: BOARD * BOARD }, (_, i) => ({
  row: Math.floor(i / BOARD),
  col: i % BOARD,
}));

function menOn(table: Table): HandMan[] {
  const men: HandMan[] = [];
  for (const sq of SQUARES) {
    const piece = table.squares[idx(sq.row, sq.col)];
    if (piece) men.push({ row: sq.row, col: sq.col, color: piece.color, king: piece.king });
  }
  return men;
}

function phaseLabel(table: Table): string {
  switch (table.phase) {
    case "waiting":
      return "Waiting for players";
    case "live":
      return table.turn === "dark" ? "Live — dark to move" : "Live — light to move";
    case "frozen":
      return "Frozen — a player stood up";
    case "dark-wins":
      return "Dark wins";
    case "light-wins":
      return "Light wins";
  }
}

const Seat = component(function Seat(props: {
  table: Table;
  seat: Color;
  user: Person | null;
  onSat?: () => void;
}) {
  const occupant = props.seat === "dark" ? props.table.darkId : props.table.lightId;
  const mine = Boolean(props.user && occupant === props.user.id);
  const empty = !occupant;
  const canSit = Boolean(props.user && empty && props.table.phase === "waiting");

  return html`
    <div class=${`seat ${props.seat}`}>
      <span class="seat-color">${props.seat === "dark" ? "Dark" : "Light"}</span>
      <span class="seat-who">${occupant ? displayName(occupant) : "—"}</span>
      ${canSit
        ? html`<button
            type="button"
            class="ghost"
            @click=${(_event: unknown, session: SessionHandle) => {
              const actor = session.user as Person | null;
              if (!actor) return;
              void store.mutate((hall) => ({
                next: sit(hall, props.table.id, props.seat, actor.id),
                result: undefined,
              }));
              props.onSat?.();
            }}
          >
            Sit
          </button>`
        : ""}
      ${mine
        ? html`<button
            type="button"
            class="ghost"
            @click=${(_event: unknown, session: SessionHandle) => {
              const actor = session.user as Person | null;
              if (!actor) return;
              void store.mutate((hall) => ({
                next: stand(hall, props.table.id, actor.id),
                result: undefined,
              }));
            }}
          >
            Stand
          </button>`
        : ""}
    </div>
  `;
});

const TableCard = component(function TableCard(props: {
  table: Table;
  user: Person | null;
  onWatch: (id: string) => void;
}) {
  return html`
    <article class="table-card">
      <header>
        <h2>${props.table.name}</h2>
        <p class=${`badge ${props.table.phase}`}>${phaseLabel(props.table)}</p>
      </header>
      ${Seat({ table: props.table, seat: "dark", user: props.user, onSat: () => props.onWatch(props.table.id) })}
      ${Seat({ table: props.table, seat: "light", user: props.user, onSat: () => props.onWatch(props.table.id) })}
      <button type="button" class="primary" @click=${() => props.onWatch(props.table.id)}>
        ${props.user && colorOf(props.table, props.user.id) ? "Open your table" : "Watch"}
      </button>
    </article>
  `;
});

const TableRoom = component(function TableRoom(props: {
  table: Table;
  user: Person | null;
  onBack: () => void;
}) {
  const you = props.user ? colorOf(props.table, props.user.id) : null;
  const canClear =
    Boolean(props.user) &&
    (props.table.phase === "frozen" ||
      props.table.phase === "dark-wins" ||
      props.table.phase === "light-wins");

  return html`
    <section class="room">
      <div class="room-bar">
        <button type="button" class="ghost" @click=${() => props.onBack()}>Back to the hall</button>
        <h2>${props.table.name}</h2>
        <p class=${`badge ${props.table.phase}`}>${phaseLabel(props.table)}</p>
      </div>

      ${props.table.phase === "frozen"
        ? html`<p class="banner frozen">
            This table is frozen. A seated player stood up mid-game. Pieces stay where they
            are. Nobody may sit or move until someone signed in clears the cloth.
          </p>`
        : ""}
      ${props.table.phase === "dark-wins"
        ? html`<p class="banner over">Dark wins. Light has no pieces left, or no legal move.</p>`
        : ""}
      ${props.table.phase === "light-wins"
        ? html`<p class="banner over">Light wins. Dark has no pieces left, or no legal move.</p>`
        : ""}

      <div class="room-seats">
        ${Seat({ table: props.table, seat: "dark", user: props.user })}
        ${Seat({ table: props.table, seat: "light", user: props.user })}
      </div>

      <div class="board-stage">
        <mount
          .Island=${PieceHand}
          .you=${you}
          .turn=${props.table.turn}
          .live=${props.table.phase === "live"}
          .men=${menOn(props.table)}
          .onMove=${(fromRow: number, fromCol: number, toRow: number, toCol: number) => {
            const actor = props.user;
            if (!actor) return;
            void store.mutate((hall) => ({
              next: play(hall, props.table.id, actor.id, fromRow, fromCol, toRow, toCol),
              result: undefined,
            }));
          }}
        ></mount>
      </div>

      <p class="hint">
        Dark squares only. Men walk diagonally forward. Reach the last rank and you are a
        king. Jump an adjacent opponent onto the empty square beyond — no double jump, and
        you do not have to take. The hall decides what is legal.
      </p>

      ${canClear
        ? html`<button
            type="button"
            class="primary"
            @click=${(_event: unknown, session: SessionHandle) => {
              if (!session.user) return;
              void store.mutate((hall) => ({
                next: clearTable(hall, props.table.id),
                result: undefined,
              }));
            }}
          >
            Clear the table
          </button>`
        : ""}
    </section>
  `;
});

export const App = component(function App(props: { user: Person | null }) {
  const hall = useStore(store).state;
  const [view, setView] = useState<string | null>(null);
  const [flash, setFlash] = useState("");
  const table = view ? hall.tables.find((row) => row.id === view) : undefined;
  const sitting = props.user ? seatedAt(hall, props.user.id) : undefined;

  return html`
    <header class="hall-header">
      <div>
        <p class="eyebrow">Evening play</p>
        <h1>The Hall</h1>
      </div>
      ${props.user
        ? html`<div class="who">
            <p>Signed in as <strong>${props.user.name}</strong></p>
            ${sitting ? html`<p class="quiet">Seated at ${sitting.name}</p>` : ""}
            <button
              type="button"
              class="ghost"
              @click=${(_event: unknown, session: SessionHandle) => {
                const actor = session.user as Person | null;
                if (!actor) {
                  session.revoke();
                  return;
                }
                void store
                  .mutate((current) => ({
                    next: standEverywhere(current, actor.id),
                    result: undefined,
                  }))
                  .then(() => session.revoke());
              }}
            >
              Sign out
            </button>
          </div>`
        : html`<form
            class="sign-book"
            @submit=${(event: SubmitPayload, session: SessionHandle) => {
              const name = event.fields["name"]?.trim() ?? "";
              const member = personByName(name);
              if (!member) {
                setFlash("That name is not in the book.");
                return;
              }
              setFlash("");
              session.grant(issue(member));
            }}
          >
            <label>
              Sign the book
              <select name="name" required>
                <option value="">Who are you?</option>
                ${keyed(
                  PEOPLE,
                  (person) => person.id,
                  (person) => html`<option value=${person.name}>${person.name}</option>`,
                )}
              </select>
            </label>
            <button class="primary" type="submit">Sign in</button>
          </form>`}
    </header>

    ${flash ? html`<p class="banner">${flash}</p>` : ""}

    ${props.user
      ? ""
      : html`<p class="guest-note">
          Guests may walk the hall and watch a table. Sitting and moving are for people in
          the book.
        </p>`}

    ${table
      ? TableRoom({ table, user: props.user, onBack: () => setView(null) })
      : html`<section class="hall">
          ${keyed(
            hall.tables,
            (row) => row.id,
            (row) =>
              TableCard({
                table: row,
                user: props.user,
                onWatch: (id) => setView(id),
              }),
          )}
        </section>`}
  `;
});

export { tickets };
