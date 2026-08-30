import {
  component,
  createJsonStore,
  html,
  keyed,
  StoreError,
  type SessionHandle,
  type SubmitPayload,
  useState,
  useStore,
} from "socklit/server";

import { MEMBERS, memberById, type Member } from "./directory";

export type Piece = {
  id: string;
  title: string;
  authorId: string;
  reviewerId: string | null;
  reviewed: boolean;
};

function parsePieces(raw: unknown): Piece[] {
  if (!Array.isArray(raw)) throw new StoreError("expected an array");
  return raw.map((row) => {
    if (!row || typeof row !== "object") throw new StoreError("expected pieces");
    const { id, title, authorId, reviewerId, reviewed } = row as {
      id?: unknown;
      title?: unknown;
      authorId?: unknown;
      reviewerId?: unknown;
      reviewed?: unknown;
    };
    if (
      typeof id !== "string" ||
      typeof title !== "string" ||
      typeof authorId !== "string" ||
      (reviewerId !== null && typeof reviewerId !== "string") ||
      typeof reviewed !== "boolean"
    ) {
      throw new StoreError("invalid piece");
    }
    return { id, title, authorId, reviewerId, reviewed };
  });
}

/** Shared wall. Path is relative to the process working directory. */
export const store = await createJsonStore<Piece[]>({
  file: "data/wall.json",
  initial: () => [],
  parse: parsePieces,
});

function displayName(id: string): string {
  return memberById(id)?.name ?? id;
}

export const App = component(function App(props: {
  store: typeof store;
  user: Member | null;
}) {
  const pieces = useStore(props.store).state;
  const [flash, setFlash] = useState("");
  const user = props.user;

  return html`
    <header class="app-header">
      <h1>Northline Review Desk</h1>
      <p>Pin work to the wall. Assign a reviewer. Stamp it when it looks good.</p>
      ${user
        ? html`<div class="desk-who">
            <p class="desk-signed">Signed in as <strong>${user.name}</strong></p>
            <button type="button" @click=${(_event: unknown, session: SessionHandle<Member>) => session.revoke()}>
              Sign out
            </button>
          </div>`
        : html`<form
            class="add-form desk-signin"
            @submit=${(event: SubmitPayload, session: SessionHandle<Member>) => {
              const id = event.fields["member"]?.trim() ?? "";
              const member = MEMBERS.find((row) => row.id === id);
              if (!member) {
                setFlash("Pick someone from the studio directory.");
                return;
              }
              setFlash("");
              const token = crypto.randomUUID();
              tickets.set(token, member);
              session.grant(token);
            }}
          >
            <label>
              <span class="desk-label">Member</span>
              <select name="member">
                <option value="">Sign in as…</option>
                ${keyed(
                  MEMBERS,
                  (member) => member.id,
                  (member) => html`<option value=${member.id}>${member.name}</option>`,
                )}
              </select>
            </label>
            <button class="primary" type="submit">Sign in</button>
          </form>`}
    </header>

    ${flash ? html`<p class="desk-flash" role="status">${flash}</p>` : ""}
    ${user
      ? html`<form
          class="add-form"
          @submit=${(event: SubmitPayload, session: SessionHandle<Member>) => {
            const actor = session.user;
            if (!actor) return;
            const title = event.fields["title"]?.trim() ?? "";
            if (!title) {
              setFlash("Give the piece a title.");
              return;
            }
            setFlash("");
            void props.store.mutate((current) => ({
              next: [
                ...current,
                {
                  id: crypto.randomUUID(),
                  title,
                  authorId: actor.id,
                  reviewerId: null,
                  reviewed: false,
                },
              ],
              result: undefined,
            }));
          }}
        >
          <input name="title" placeholder="Title of the piece" />
          <button class="primary" type="submit">Pin to the wall</button>
        </form>`
      : html`<p class="desk-guest">The wall is open to look at. Sign in to pin, assign, or stamp.</p>`}

    ${pieces.length === 0
      ? html`<p class="empty">Nothing on the wall yet.</p>`
      : html`<ul class="item-list">
          ${keyed(
            pieces,
            (piece) => piece.id,
            (piece) => PieceCard({ piece, store: props.store, user }),
          )}
        </ul>`}
  `;
});

const PieceCard = component(function PieceCard(props: {
  piece: Piece;
  store: typeof store;
  user: Member | null;
}) {
  const { piece, user } = props;
  const author = displayName(piece.authorId);
  const reviewer = piece.reviewerId ? displayName(piece.reviewerId) : null;
  const canRemove = Boolean(user && user.id === piece.authorId);
  const canAssign = Boolean(user && !piece.reviewerId);
  const canStamp = Boolean(user && user.id === piece.reviewerId && !piece.reviewed);

  return html`<li class="item desk-piece">
    <div class="desk-piece-head">
      <strong>${piece.title}</strong>
      ${piece.reviewed ? html`<span class="desk-stamp">Looks good</span>` : ""}
    </div>
    <p class="desk-meta">
      ${author}
      ${reviewer
        ? html` · reviewer ${reviewer}`
        : html` · no reviewer yet`}
    </p>
    ${canAssign
      ? html`<form
          class="add-form desk-assign"
          @submit=${(event: SubmitPayload, session: SessionHandle<Member>) => {
            const actor = session.user;
            if (!actor) return;
            const reviewerId = event.fields["reviewer"]?.trim() ?? "";
            const reviewerMember = MEMBERS.find((row) => row.id === reviewerId);
            if (!reviewerMember) return;
            void props.store.mutate((current) => {
              const index = current.findIndex((row) => row.id === piece.id);
              if (index < 0) return { next: current, result: undefined };
              const row = current[index]!;
              if (row.reviewerId) return { next: current, result: undefined };
              const next = current.slice();
              next[index] = { ...row, reviewerId };
              return { next, result: undefined };
            });
          }}
        >
          <select name="reviewer">
            <option value="">Assign a reviewer…</option>
            ${keyed(
              MEMBERS,
              (member) => member.id,
              (member) => html`<option value=${member.id}>${member.name}</option>`,
            )}
          </select>
          <button type="submit">Assign</button>
        </form>`
      : ""}
    ${canStamp
      ? html`<button
          class="primary"
          type="button"
          @click=${(_event: unknown, session: SessionHandle<Member>) => {
            const actor = session.user;
            if (!actor || actor.id !== piece.reviewerId) return;
            void props.store.mutate((current) => {
              const index = current.findIndex((row) => row.id === piece.id);
              if (index < 0) return { next: current, result: undefined };
              const row = current[index]!;
              if (row.reviewerId !== actor.id || row.reviewed) {
                return { next: current, result: undefined };
              }
              const next = current.slice();
              next[index] = { ...row, reviewed: true };
              return { next, result: undefined };
            });
          }}
        >
          Looks good
        </button>`
      : ""}
    ${canRemove
      ? html`<button
          type="button"
          @click=${(_event: unknown, session: SessionHandle<Member>) => {
            const actor = session.user;
            if (!actor || actor.id !== piece.authorId) return;
            void props.store.mutate((current) => ({
              next: current.filter((row) => row.id !== piece.id),
              result: undefined,
            }));
          }}
        >
          Remove
        </button>`
      : ""}
  </li>`;
});

/** Issued on sign-in; looked up by `identify` on the socket. */
export const tickets = new Map<string, Member>();
