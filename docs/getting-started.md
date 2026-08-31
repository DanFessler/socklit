# Getting started

Socklit is a server-authoritative UI runtime. You write components that
run next to your data. The browser is a replica: it paints the templates
it is given and sends clicks back as addresses. There is no REST handler
for a button. The click runs the function you wrote on the server.

This page is the whole first-week surface. If something you need is not
here, it is missing from the product or not yet documented — not a prompt
to read the framework’s internals.

## Install and run

From a copy of the `starter/` directory:

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. That is the only URL. Vite serves
modules; the HTML is a `listen()` render (`firstPaint` in
`vite.config.ts`). Disable JavaScript and the page is still there.

If you change `listen({ port })`, change the Vite proxy `target` and
`firstPaint({ port })` in `vite.config.ts` to match. After `npm run build`,
`listen({ publicDir: "dist" })` serves the page and the socket from one
process (`npm start`). HTTPS is still your reverse proxy, not this
process.

You import the framework as `socklit/server`. You do not import files
from inside the Socklit repo.

Edit `src/app.ts`, save, refresh if the replica does not hot-replace
the tree (the server restarts on save; the client reconnects).

## Your first files

| File | Role |
| --- | --- |
| `src/app.ts` | The UI and, if you have one, the store |
| `src/server.ts` | `listen({ app, subscribe })` |
| `src/client.ts` | Loads the replica (do not put app logic or CSS here) |
| `src/styles.css` | The document’s look. `@import` `socklit/client/styles.css` |
| `index.html` | Must contain `<main id="app">` and `<link>` the stylesheet |

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

## The URL

The replica puts the page path on the socket as
`session.params.get("path")`. Vite (and `listen({ publicDir })` after a
build) serves `index.html` for paths that are not a real file, so a
reload of `/compare` still boots the replica. The HTML is already a
`listen()` render of that path. Your app switches on it:

```ts
await listen({
  createApp: (session) => () => App({ path: session.params.get("path") ?? "/" }),
});
```

That is not a router. `<a href="/compare">` is a real navigation: new
page, new socket, same bootstrap, different path.

`session.params` is the rest of the URL query (`?mine=1` is a filter
you chose). Anyone can edit it. It is not how you know who is connected
— that is `session.user`, below.

## Components

A component takes one props object and returns `html\`…\``.

```ts
import { component, html } from "socklit/server";

export const App = component(function App() {
  return html`<h1>Hello</h1>`;
});
```

Call it as a function: `App({})`. That is the typed spelling. A
function call can pass another template as a **named** prop
(`TodoRow({ todo, extra: html\`<span>…</span>\` })`).

### Templates

`html` is [lit-html](https://lit.dev/docs/templates/expressions/). Three
prefixes, plus an interpolation:

| You write | Meaning |
| --- | --- |
| `${value}` | A value (text, a nested template, a component, a handler) |
| `@click=${fn}` | An event. Also `@change`, `@submit`. |
| `.checked=${bool}` | A DOM property. |
| `?disabled=${bool}` | A boolean HTML attribute (`disabled`, `hidden`). |

Do not put `.value=` on a text field you want the user to keep typing
into — that is a property, and every render will snap it back. See
Forms below.

### Tags (optional)

`html` tags are strings, not identifiers. To write
`<TodoRow .todo=${todo}>` you must claim the name:

```ts
component.tag("TodoRow", (props: { todo: Todo }) => {
  return html`<li>${props.todo.text}</li>`;
});

html`<TodoRow .todo=${todo}></TodoRow>`
```

The string is the catalog key, not a name scraped off the function. A
tag is **not type-checked**. Every prop must be a named binding
(`.todo=${todo}`), not a static attribute. A tag does not take
children — there is no unnamed slot between the tags. Nest through a
named prop on the function call instead. Prefer `TodoRow({ todo })`
when you want the checker.

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

A list needs a stable identity per row. A plain JavaScript array in
`${…}` is refused so a insert or delete cannot reuse the wrong
`useState` or the wrong closures. Wrap the collection:

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

## Shared state

Three different things, not a binary:

- **This connection.** `useState` — open/closed chrome, flash messages.
  Dies with the socket.
- **This person, this task.** `useDurable("wizard", initial)` —
  reconnect and refresh keep it. A second tab has its own cell unless
  you pass `{ share: "user" }`. `listen({ durableFile })` writes the
  cells so a restart keeps them.
- **This source.** `useStore(source)` — every connected replica that
  read that object re-renders when it changes. Not “the internet”;
  the sessions on this process that subscribed.
- **A person you computed.** `session.user` — see below. A guest and a
  member can share a source and still paint different trees.

Socklit does not own the database. Three names must agree:

- `useStore(source)` records that this session read `source`.
- `listen({ subscribe })` is how you tell the runtime something moved.
- `onChange(source)` names **the same object** `useStore` saw.

The starter is the whole recipe. The store *is* the source:

```ts
// app.ts
export const store = await createJsonStore<Item[]>({
  file: "data/items.json",
  initial: () => [],
  parse: parseItems,
});

export const App = component(function App(props: { store: typeof store }) {
  const items = useStore(props.store).state;
  return html`… ${keyed(items, (item) => item.id, (item) => html`<li>${item.title}</li>`)} …`;
});

void props.store.mutate((current) => ({
  next: [...current, item],
  result: undefined,
}));
```

```ts
// server.ts
await listen({
  app: () => App({ store }),
  subscribe: (onChange) => store.onChange(() => onChange(store)),
});
```

`createJsonStore` is a **local default** — a JSON file behind a mutex —
not the product database. `file` is relative to the process working
directory. Parent directories are created on first write. Gitignore
`data/`.

`result` is the value of the Promise (`await store.mutate(…)`). The
replica never reads it. `undefined` is fine when the handler does not
await.

- Do not mutate `store.state`. Return a replacement from `mutate`.
- Returning the same reference from `mutate` is a no-op (no write, no notify).
- Two `mutate` calls at once are serialized. Last completed write wins;
  there is no automatic merge.

If you already have a listener (your database, a mutex you wrote), you
do not need `createJsonStore`. Hold a `changeSource()`, call
`useStore(source)` when you read, and notify with that same object:

```ts
import { changeSource } from "socklit/server";

export const source = changeSource();

export function watch(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

await listen({
  app: () => App({}),
  subscribe: (onChange) => watch(() => onChange(source)),
});
```

## Who is connected

`session.user` is a value **you** computed on the server, or `null` if
the tab is signed out. An app that refuses a write reads that value
inside the handler — not the URL, not whether a button was painted.

Three pieces.

**1. Look the token up** when the socket connects. `signTicket` /
`verifyTicket` is the path that survives a process restart. A `Map` is
a demo that dies.

```ts
import {
  listen,
  sessionToken,
  signTicket,
  verifyTicket,
  type IdentifyRequest,
} from "socklit/server";

type Member = { id: string; name: string };

const secret = process.env.SOCKLIT_SECRET ?? "";

function identify(request: IdentifyRequest): Member | null {
  const token = sessionToken(request);
  if (!token) return null;
  return verifyTicket<Member>(token, secret);
}

await listen({
  identify,
  origin: "https://your.site",
  createApp: (session) => () => App({ store, user: session.user }),
  subscribe: (onChange) => store.onChange(() => onChange(store)),
});
```

Read `session.user` **inside** the render function
(`() => App({ user: session.user })`). Do not close over `user` once
in `createApp` — that value is who connected, not who just signed in.

Throw from `identify` to refuse the socket.

`listen({ origin })` is for production: other origins get 403 on the
socket and on `POST /session`. Omit it locally.

**2. Issue a token** from a sign-in handler. `grant` tells the replica
to `POST /session`. `listen` sets an HttpOnly cookie on the page
origin. The socket stays up; `useState` is not wiped. Refresh stays
signed in. **Every tab in that browser is the same person.** Two
people means two browsers (or a private window).

```ts
const MEMBERS: Member[] = [/* your directory — not the store */];

@submit=${(event: SubmitPayload, session) => {
  const name = event.fields["name"]?.trim() ?? "";
  const member = MEMBERS.find((row) => row.name === name);
  if (!member) return;
  session.grant(signTicket({ id: member.id, name: member.name }, secret));
}}
```

`session.revoke()` drops the token and reidentifies on the same
socket, signed out.

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

The cookie is just the string you passed to `grant`. OAuth, SSO, and a
users table are still your problem. Socklit binds the connection to a
user you already trust.

## Look

`socklit/client/styles.css` is the whole default look. Link it from
`index.html` — do not import it from `client.ts`. After a build,
`listen({ publicDir })` serves that same `<link>` next to the painted
tree. Disable JavaScript and the page is still dressed.

Classes the starter uses: `app-header`, `add-form`, `primary`,
`item-list`, `item`, `empty`. You can write ordinary markup next to
them.

## Islands

An ordinary control is a server template. If it needs a **browser DOM
that cannot wait for a round trip** — typeahead that filters as you
type, drag-and-drop, a focus-trapped popover — it is an island.

The contract is hand-written. Three pieces; the name is the same
string in all three.

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

`html`, `component`, `component.tag`, `keyed`, `useState`, `useDurable`,
`useRef`, `useStore`, `createContext`, `useContext`, `changeSource`, `ChangeSource`,
`createJsonStore`, `JsonStore`, `StoreError`, `signTicket`, `verifyTicket`,
`listen`, `identify` (on `listen`), `origin` (on `listen`), `name` (on `listen`),
`Health`, `PROTOCOL_VERSION`,
`sessionToken`, `SESSION_COOKIE`, `SESSION_QUERY`, `TAB_QUERY`, `parseCookies`,
`defineIsland`, `mount`, `slot`, `IslandServerEvents`, `SessionHandle`,
`SessionContext`, `IdentifyRequest`, and the event payload types.

`socklit/client` also exports `registerIsland`. `socklit/vite` exports
`firstPaint`.

Health is `GET /health` →
`{ ok, name, sessions, protocol }`. `name` is `listen({ name })` or
`package.json` `"name"`. The replica and `firstPaint()` refuse a
different name, so a leftover process on the protocol port cannot
become the app.

## If something fails

- **Page empty, status “connecting”.** `listen` is down, or the Vite
  proxy `target` does not match `{ port }`. Same-origin is the product
  path. `?ws=ws://localhost:<listen-port>` is only for a replica that
  is not behind that proxy — cookies will not cross that hop.
- **Status names two apps.** The page’s `package.json` name (or
  `firstPaint({ name })`) does not match `listen({ name })` on that
  port. You are talking to a leftover process. Kill it, or change
  the port pair. Vite `strictPort` means a taken 5173 is an error,
  not a hop to 5174.
- **`missing #app`.** `index.html` must have an element with `id="app"`.
- **`plain array`.** You put a JavaScript array in `${…}`. Use `keyed`
  so each row keeps a stable identity.
- **Screen goes stale after a store write.** `subscribe` is missing, or
  `useStore` was not called with the same store object.
- **Unknown tag `<Foo>`.** Nothing called `component.tag("Foo", …)`, or
  that module was never imported (side-effect import it from `server.ts`).
- **`unknown island: Name`.** The client never called
  `registerIsland("Name", …)`, or the name does not match `defineIsland`.
- **Signed in, refresh is a guest.** `identify` did not find the
  cookie (`sessionToken(request)`). The `Map` died with the process,
  or you are still reading `params.user` instead of the cookie.
- **Two tabs are different people.** You opened with `?ws=` (the
  fallback is per-tab). Same origin shares the cookie.
