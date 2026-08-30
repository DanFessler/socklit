# Getting started

Socklit is a server-authoritative UI runtime. You write components that
run next to your data. The browser is a replica: it paints the templates
it is given and sends clicks back as addresses. There is no REST handler
for a button. The click runs the function you wrote on the server.

This page is the whole first-week surface. If something you need is not
here, it is either missing from the product or not yet documented — treat
that as a hole, not as a prompt to read the framework’s internals.

## Install and run

From a copy of the `starter/` directory:

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. That is the only URL. Vite proxies
`/ws`, `/session`, and `/health` to `listen()` on 8787, so the browser
sees one origin. The replica talks `ws://localhost:5173/ws`. You do
not add `?ws=`.

`listen()` still binds 8787 (or `PORT`, or `{ port }`). If you move
that port, change the proxy `target` in `vite.config.ts` to match.
`?ws=ws://localhost:<listen-port>` is the escape hatch when there is
no proxy — cookies will not cross that hop.

Two processes, one command. Edit `src/app.ts`, save, refresh if the
replica does not hot-replace the tree (the server restarts on save; the
client reconnects).

After `npm run build`, `listen({ publicDir: "dist" })` serves the page
and the socket from one port (`npm start`, then that port). HTTPS is
still your reverse proxy, not this process.

You import the framework as `socklit/server`. You do not import files
from inside the Socklit repo.

## Your first files

| File | Role |
| --- | --- |
| `src/app.ts` | The UI and, if you have one, the store |
| `src/server.ts` | `listen({ app, subscribe })` |
| `src/client.ts` | Loads the replica (do not put app logic here) |
| `index.html` | Must contain `<main id="app">` |

The starter is already a **shared list**. `app.ts` creates the store and
the component. `server.ts` is the wiring:

```ts
import { listen } from "socklit/server";
import { App, store } from "./app";

await listen({
  app: () => App({ store }),
  subscribe: (onChange) => store.onChange(() => onChange(store)),
});
```

`useState` is this tab only. Open a second tab on the starter: an add
appears in both. That is the store + `subscribe` line, not `useState`.

## Components

A component takes one props object and returns `html\`…\``.

```ts
import { component, html } from "socklit/server";

export const App = component(function App() {
  return html`<h1>Hello</h1>`;
});
```

Call it as a function: `App({})`. That is the typed spelling.

### Tags (optional)

`html` tags are strings, not identifiers. To write `<TodoRow .todo=${todo}>`
you must claim the name:

```ts
component.tag("TodoRow", (props: { todo: Todo }) => {
  return html`<li>${props.todo.text}</li>`;
});

html`<TodoRow .todo=${todo}></TodoRow>`
```

The string is the catalog key, not a name scraped off the function. A
tag is **not type-checked**. Props must be holes (`.todo=${todo}`). A
tag does not take children. Prefer `TodoRow({ todo })` when you want
the checker.

## Events

Handlers are server closures. The browser sends a small payload.

```ts
import type { ChangePayload, SubmitPayload } from "socklit/server";

html`
  <form
    @submit=${(event: SubmitPayload) => {
      const text = event.fields["title"] ?? "";
    }}
  >
    <input name="title" required />
    <button class="primary" type="submit">Add</button>
  </form>

  <input
    type="checkbox"
    .checked=${item.done}
    @change=${(event: ChangePayload) => {
      const checked = event.checked ?? false;
    }}
  />

  <button type="button" ?disabled=${item.qty <= 0} @click=${() => take(item.id)}>
    Take
  </button>
`
```

- `@submit` → `event.fields`: `Record<string, string>`. Every value is a
  **string**, including `<input type="number">`.
- `@change` → `value` and/or `checked`.
- `@click` → just the click.
- `?disabled=${…}` is a boolean attribute. `.checked=` is a property.
  Use `?` for HTML booleans (`disabled`, `hidden`).

The second argument is the session that acted:

```ts
@click=${(_event, session) => {
  if (!session.user) return;
  remove(item.id, session.user);
}}
```

Do not `preventDefault` — there is no DOM in the handler.

**Native constraint validation can skip your handler.** If the browser
blocks the submit (`required`, `min`, `type="number"`), `@submit` never
runs. A `useState` error from an earlier attempt will stay on screen
until you clear it. Validate again on the server; do not assume the
handler saw the click.

## Forms and drafts

The replica paints the template. It does not own the typing caret.

- An input **without** `.value=` / `value=` keeps whatever the user
  typed across a re-render. That is how the add field stays filled
  while someone else mutates the list.
- An input **with** `value="1"` or `.value=${n}` snaps back to that
  value on every render. After a rejected submit, the field looks
  wiped if you bound it that way.
- There is no public “draft” helper. `useState` on this tab is the
  usual place for a flash message (`const [error, setError] = useState("")`).
  The other tab will not see it.

## Lists

Plain arrays in a hole are refused. Wrap them:

```ts
html`<ul class="item-list">
  ${keyed(
    items,
    (item) => item.id,
    (item) => html`<li class="item">${item.title}</li>`,
  )}
</ul>`
```

`keyed([])` is legal and renders nothing. For an empty state, branch
on `items.length` and omit the list (the starter does this).

The key must be stable. Do not use the array index if the list can
reorder or delete.

## State: one session vs everyone

`useState` is **this browser tab**. Use it for open/closed chrome and
flash messages.

Data everyone should see lives in a **store**. `useStore(store)` records
that this session read it. `listen({ subscribe })` tells the runtime
when to re-render. The starter already does this; copy that split.

```ts
void store.mutate((current) => ({
  next: [...current, item],
  result: undefined,
}));
```

`result` is the value of the Promise (`await store.mutate(…)`). The
replica never reads it. `undefined` is fine when the handler does not
await.

Rules:

- Do not mutate `store.state`. Return a replacement from `mutate`.
- Returning the same reference from `mutate` is a no-op (no write, no notify).
- `useStore(store)` must receive the **same object** you pass to
  `onChange(store)`.
- `file` is relative to the **process working directory** (usually the
  app root when you `npm run dev`). Parent directories are created on
  first write. Gitignore `data/` — it is not in the starter’s repo
  ignore unless you add it.

Two `mutate` calls at once are serialized on the server. Last completed
write wins; there is no automatic merge.

## Who is connected

`session.params` is the query string (`?mine=1`). It is **not** a person.
Anyone can edit the URL. A desk that must refuse a write needs
`session.user` — a value **you** computed on the server.

Three pieces.

**1. Look the token up** when the socket connects:

```ts
import { listen, sessionToken, type IdentifyRequest } from "socklit/server";

type Member = { id: string; name: string };

const tickets = new Map<string, Member>();

function identify(request: IdentifyRequest): Member | null {
  const token = sessionToken(request);
  if (!token) return null;
  return tickets.get(token) ?? null;
}

await listen({
  identify,
  createApp: (session) => () => App({ store, user: session.user }),
  subscribe: (onChange) => store.onChange(() => onChange(store)),
});
```

`session.user` is whatever `identify` returned, or `null` if the tab is
signed out. Throw from `identify` to refuse the socket.

**2. Issue a token** from a sign-in handler. `grant` tells the replica
to `POST /session`. `listen` sets an HttpOnly cookie on the page
origin. Refresh stays signed in. **Every tab in that browser is the
same person.** Two people means two browsers (or a private window).

```ts
const MEMBERS: Member[] = [/* your directory — not the store */];

@submit=${(event: SubmitPayload, session) => {
  const name = event.fields["name"]?.trim() ?? "";
  const member = MEMBERS.find((row) => row.name === name);
  if (!member) return;
  const token = crypto.randomUUID();
  tickets.set(token, member);
  session.grant(token);
}}
```

`session.revoke()` drops the token and reconnects signed out.

**3. Refuse at the write**, not at the button. Painting a control is
not permission. A click can arrive late or from a tab that should not
have the button:

```ts
@click=${(_event, session) => {
  const actor = session.user;
  if (!actor || actor.id !== piece.authorId) return;
  void store.mutate((current) => ({
    next: current.filter((row) => row.id !== piece.id),
    result: undefined,
  }));
}}
```

A `Map` of tickets dies when the process restarts. Sign the token
yourself if it has to survive your process. The cookie is just the
string you passed to `grant`. OAuth, SSO, and a users table are still
your problem. Socklit binds the connection to a user you already trust.

## Look

`socklit/client/styles.css` is the whole default look. Classes the
starter uses: `app-header`, `add-form`, `primary`, `item-list`, `item`,
`empty`. You can write ordinary markup next to them.

## Islands

An ordinary control is a server template. If it needs a **browser DOM
that cannot wait for a round trip** — typeahead that filters as you
type, drag-and-drop, a focus-trapped popover — it is an island.

Three pieces. The name is the same string in all three.

**1. Contract** (imported by the server only):

```ts
import { defineIsland } from "socklit/server";

export const StaffPicker = defineIsland<
  { people: { id: string; name: string }[]; value: string | null },
  { onPick: (id: string) => void }
>("StaffPicker");
```

Props are JSON. Callbacks are top-level (`onPick`), not nested in a
config object.

**2. Placement** in a server template:

```ts
html`<mount
  .Island=${StaffPicker}
  .people=${STAFF}
  .value=${loan.borrowerId}
  .onPick=${(id: string, session) => assign(loan.id, id, session.user)}
></mount>`
```

Or `mount(StaffPicker, { people, value, onPick })`. Do not write
`<StaffPicker>` — that would look like a server component.

The React side still calls `onPick(id)`. The runtime appends the
acting session, the same second argument `@click` already gets.
A shorter function may ignore it. Do not close over `user` from
the last render — ask `session.user` when the pick arrives.

**3. React implementation**, registered on the client:

```bash
npm install react react-dom
npm install -D @types/react @types/react-dom
```

The replica already depends on React. Install those in the app **and**
keep one copy — the starter Vite config already has
`resolve.dedupe: ["react", "react-dom"]`. If you skip that, the first
mount is an invalid hook call and the page stays “connected.”

Set `"jsx": "react-jsx"` in `tsconfig.json`. A terminal picker is
ordinary React. Example `staff-picker.island.tsx`:

```tsx
import { useMemo, useState } from "react";

export function StaffPicker(props: {
  people: { id: string; name: string }[];
  value: string | null;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return props.people;
    return props.people.filter((p) => p.name.toLowerCase().includes(q));
  }, [props.people, query]);

  return (
    <div>
      <input value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul>
        {shown.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => props.onPick(p.id)}>
              {p.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

In `src/client.ts`:

```ts
import { registerIsland } from "socklit/client";
import { StaffPicker } from "./staff-picker.island";

registerIsland("StaffPicker", StaffPicker);

import "socklit/client/styles.css";
import "socklit/client";
```

The React component receives the JSON props plus `onPick(...args)`.
Calling `onPick` sends those arguments to the server closure. The
server function is `(...args, session)`. Arguments must be JSON.

A hosted server region inside the overlay is `<slot>` on the server and
a well the replica keeps painting. You do not need that for a terminal
picker (JSON in, callback out).

The two import graphs must not mix: the server never imports the
`.island.tsx` file. The island never imports `useStore` or `html`.

## What this surface does not include

- Deployment, sticky sessions, HTTPS, a production process manager
- OAuth, SSO, password hashing, a users table — you issue tokens;
  `identify` binds them to the connection
- File uploads, streaming, raw SQL helpers
- A type-checker for `<TodoRow>` tags
- The research probes and protocol inspector (those are the lab, not the product)

## `socklit/server` exports

`html`, `component`, `component.tag`, `keyed`, `useState`, `useRef`,
`useStore`, `createContext`, `useContext`, `createJsonStore`, `JsonStore`,
`StoreError`, `listen`, `identify` (on `listen`), `sessionToken`, `SESSION_COOKIE`,
`SESSION_QUERY`, `parseCookies`, `defineIsland`, `mount`, `slot`,
`IslandServerEvents`, `SessionHandle`, `SessionContext`,
`IdentifyRequest`, and the event payload types.

`socklit/client` also exports `registerIsland`.

Health is `GET /health` → `{ ok: true, sessions: number }`.

## If something fails

- **Page empty, status “connecting”.** `listen` is down, or the Vite
  proxy `target` does not match `{ port }`. `?ws=` is only for a
  replica that is not same-origin.
- **`missing #app`.** `index.html` must have an element with `id="app"`.
- **`plain array`.** You put a JavaScript array in a hole. Use `keyed`.
- **Screen goes stale after a store write.** `subscribe` is missing, or
  `useStore` was not called with the same store object.
- **Unknown tag `<Foo>`.** Nothing called `component.tag("Foo", …)`, or
  that module was never imported (side-effect import it from `server.ts`).
- **`unknown island: Name`.** The client never called
  `registerIsland("Name", …)`, or the name does not match `defineIsland`.
- **Signed in, refresh is a guest.** `identify` did not find the
  cookie (`sessionToken(request)`). The `Map` died with the process,
  or you are still reading `params.user`.
- **Two tabs are different people.** You opened with `?ws=` (the
  fallback is per-tab). Same origin shares the cookie.
