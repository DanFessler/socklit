import {
  component,
  createJsonStore,
  html,
  keyed,
  StoreError,
  type SubmitPayload,
  useState,
  useStore,
} from "socklit/server";

import { ColorPalette } from "./color-palette";
import { DEFAULT_COLOR_ID, PALETTE, swatchById } from "./palette";
import { ReviewerPicker } from "./reviewer-picker";
import { personById, STUDIO } from "./studio";

export type Piece = {
  id: string;
  title: string;
  url: string | null;
  colorId: string;
  reviewerId: string | null;
};

function parsePieces(raw: unknown): Piece[] {
  if (!Array.isArray(raw)) throw new StoreError("expected an array");
  return raw.map((row) => {
    if (!row || typeof row !== "object") throw new StoreError("expected pieces");
    const { id, title, url, colorId, reviewerId } = row as {
      id?: unknown;
      title?: unknown;
      url?: unknown;
      colorId?: unknown;
      reviewerId?: unknown;
    };
    if (typeof id !== "string" || typeof title !== "string") {
      throw new StoreError("invalid piece");
    }
    if (typeof colorId !== "string") throw new StoreError("invalid color");
    if (url !== null && typeof url !== "string") throw new StoreError("invalid url");
    if (reviewerId !== null && typeof reviewerId !== "string") {
      throw new StoreError("invalid reviewer");
    }
    return { id, title, url, colorId, reviewerId };
  });
}

/** Shared with every tab. Path is relative to the process working directory. */
export const store = await createJsonStore<Piece[]>({
  file: "data/wall.json",
  initial: () => [],
  parse: parsePieces,
});

function pin(store: typeof store, title: string, url: string | null) {
  void store.mutate((current) => ({
    next: [
      ...current,
      {
        id: crypto.randomUUID(),
        title,
        url,
        colorId: DEFAULT_COLOR_ID,
        reviewerId: null,
      },
    ],
    result: undefined,
  }));
}

function setColor(store: typeof store, id: string, colorId: string) {
  void store.mutate((current) => ({
    next: current.map((piece) =>
      piece.id === id ? { ...piece, colorId } : piece,
    ),
    result: undefined,
  }));
}

function setReviewer(store: typeof store, id: string, reviewerId: string | null) {
  void store.mutate((current) => ({
    next: current.map((piece) =>
      piece.id === id ? { ...piece, reviewerId } : piece,
    ),
    result: undefined,
  }));
}

function unpin(store: typeof store, id: string) {
  void store.mutate((current) => ({
    next: current.filter((piece) => piece.id !== id),
    result: undefined,
  }));
}

export const App = component(function App(props: { store: typeof store }) {
  const pieces = useStore(props.store).state;
  const [error, setError] = useState("");

  return html`
    <header class="app-header">
      <h1>Critique wall</h1>
      <p>Pin a piece. Label it. Hand it to someone. The room sees it.</p>
    </header>

    <form
      class="add-form pin-form"
      @submit=${(event: SubmitPayload) => {
        const title = event.fields["title"]?.trim() ?? "";
        const urlRaw = event.fields["url"]?.trim() ?? "";
        if (!title) {
          setError("Give the piece a title.");
          return;
        }
        setError("");
        pin(props.store, title, urlRaw || null);
      }}
    >
      <input name="title" placeholder="Title of the work" />
      <input name="url" placeholder="URL (optional)" />
      <button class="primary" type="submit">Pin</button>
    </form>

    ${error
      ? html`<p class="pin-error" role="alert">${error}</p>`
      : ""}

    ${pieces.length === 0
      ? html`<p class="empty">The wall is empty. Pin a piece.</p>`
      : html`<ul class="wall">
          ${keyed(
            pieces,
            (piece) => piece.id,
            (piece) => PieceCard({ store: props.store, piece }),
          )}
        </ul>`}
  `;
});

const PieceCard = component(function PieceCard(props: {
  store: typeof store;
  piece: Piece;
}) {
  const { piece } = props;
  const swatch = swatchById(piece.colorId);
  const reviewer = personById(piece.reviewerId);

  return html`
    <li class="piece" data-color=${piece.colorId}>
      <div class="piece-stripe" style=${`background:${swatch.hex}`}></div>
      <div class="piece-body">
        <h2 class="piece-title">${piece.title}</h2>
        ${piece.url
          ? html`<a class="piece-url" href=${piece.url} target="_blank" rel="noreferrer"
              >${piece.url}</a
            >`
          : html`<p class="piece-url is-missing">No link</p>`}

        <div class="piece-field">
          <span class="piece-label">Label</span>
          <mount
            .Island=${ColorPalette}
            .colors=${PALETTE}
            .value=${piece.colorId}
            .onPick=${(colorId: string) => setColor(props.store, piece.id, colorId)}
          ></mount>
        </div>

        <div class="piece-field">
          <span class="piece-label">Reviewer</span>
          <mount
            .Island=${ReviewerPicker}
            .people=${STUDIO}
            .value=${piece.reviewerId}
            .onPick=${(reviewerId: string) =>
              setReviewer(props.store, piece.id, reviewerId)}
          ></mount>
          ${reviewer
            ? html`<button
                class="piece-clear"
                type="button"
                @click=${() => setReviewer(props.store, piece.id, null)}
              >
                Clear
              </button>`
            : ""}
        </div>

        <button
          class="piece-remove"
          type="button"
          @click=${() => unpin(props.store, piece.id)}
        >
          Remove
        </button>
      </div>
    </li>
  `;
});
