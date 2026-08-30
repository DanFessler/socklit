# Notes from building this app

Product holes, surprises, and missing API — written as they showed up.
Facts and missing pieces go here. Feelings go in JOURNAL.md, then get
summarized at the bottom of this file.

## (holes as they appear)

- **Ports 5173 and 8787 were already taken** on this machine. The
  manual says change both `listen({ port })` and the Vite `proxy`
  target. I moved the page to **5174** and the socket to **8788**.
  Easy to miss if you only change one.

- **`grant` reconnects the socket.** `useState` (which table I was
  watching) dies with that reconnect. I land back in the hall. The
  manual said useState is this tab — it did not say the tab gets a
  new life when you sign in.

- **Tickets are a `Map`.** The manual says it dies with the process.
  `tsx watch` follows imports into `socklit/server`, so an edit in
  the framework package restarted me, the cookie was still there,
  and I was a guest sitting in Ada’s chair. I wrote the tickets to
  `data/tickets.json` so a restart does not evict the book. I also
  pointed `tsx watch` at `src/` only.

- **`<select>` sign-in.** A tool click on Sign in looked like a
  no-op until the reconnect finished. A real submit did work. I
  left the select; the book is a form, not a row of buttons.

- **dnd-kit drop does not hit a server square.** The island is an
  overlay of cells. `pointerWithin` hits those cells, then
  `onMove` goes to the server. The `html` squares never see the
  pointer. I passed `men` as JSON only so the overlay disc can
  look like the piece I lifted. React still does not decide
  legality. `@dnd-kit/utilities` was not needed — `DragOverlay`
  carries the transform.

- **HTML5 drag is the wrong motion.** A browser “drag this ref”
  helper failed (`Drag start was prevented`). dnd-kit wants
  pointer events, not `draggable`. Two Reacts did not show up;
  the starter’s `dedupe` held.

- **Overlay-hand is obsolete (revision).** The board is the
  island now. `men` / `turn` / `you` / `onMove` are the props.
  Drop hits a real cell. Optimistic paint holds the man on the
  destination until `men` agrees; if `men` does not change the
  paint walks back. The old “drop does not hit a server square”
  hole is gone because there is no server square. Spectators
  get the same island so they see `men` update. Still no move
  route.

## How to run this app

From `apps/lobby`:

```bash
npm run dev
```

Open **http://localhost:5174** — that is the only URL. Do not add
`?ws=`. Vite proxies `/ws`, `/session`, and `/health` to `listen()`
on 8788.

Two people means two browsers, or one window and one private window.
A second tab in the same browser is the same person.

## Qualitative conclusions

The runtime is a UI runtime that happens to be a fine place to put a
referee. I did not write a move route. I wrote `play()` and called it
from `mutate`. The spectator’s board is not a second client of a game
server — it is the same template, painted again, because the hall
changed. That distinction mattered the first time a piece moved and
three windows agreed without me wiring them.

The referee clicked when an illegal drop did nothing. Not an error
toast. Not a revert animation. The store returned the same hall, so
nobody was told a story that was not true. Painting a highlighted
square was not permission. I had to feel that to believe the manual.

I would start a real lobby on this. I would hesitate on identity
(tickets are your problem, and `tsx watch` will evict the book if you
leave them in memory) and on the reconnect that wipes tab chrome after
`grant`. Neither is a reason to go back to a REST handlers file.

Why is this not just React and a WebSocket? Because the board is not a
client object we sync. It is server markup, and the only React I wrote
is the hand that holds a piece until the referee speaks.

**After the board moved into the island:** I would now say the hall is
the server UI and the board is a replica of `men`. Still not a REST
move handler. Still not a rules engine in the browser. Closer to
React-plus-a-store than I claimed above. The sentence I would keep:
the referee is `mutate`, not the drag library.
