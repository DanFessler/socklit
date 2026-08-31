# Tech debt

Shortcuts taken deliberately, with what each one costs and what retires it.

Everything here was a choice made to keep an increment shippable, not something
discovered afterwards. The point of writing them down is that a shortcut whose
retirement condition is recorded stays a shortcut, and one that is not becomes
the design.

Each entry says what was built, why the shortcut is safe *today*, and the
specific event that makes it unsafe. That last part is the useful column: most of
these are fine indefinitely and a few become wrong the moment a particular
feature lands.

---

## Read-scoped invalidation

Built in the increment that added `useStore` read recording, source-tagged
invalidation and the `scopedSkips` metric.

### Read sets are tracked per session, not per cohort

**What was built.** Each session's `HookHost` holds the set of stores its last
committed render declared through `useStore`. When a store announces a change,
sessions whose set excludes it are skipped.

**Why it is safe today.** Every render serves exactly one session, so "the
session that read it" and "the render that read it" are the same thing.

**What makes it wrong.** `shared()`. A shared render has no single session doing
the reading, so a `useStore` call inside a shared body cannot attribute to one.
`proposal.md` §3 states the correct model: track reads per *render*, keyed by
cohort, and union them into each session's set as the subtree is attached. The
current code has no cohort to key on, and the fix is not a patch — it is where
the read set lives.

**Cost of retiring it later rather than now.** Low. `recordRead` is one call
site and `didRead` is one more; the change is to what owns the set.

### Identity agreement between `useStore` and the notifying store is a convention

**What was built.** Scoping matches on object identity: the value passed to
`useStore` must be the same object the store passes as its change source.
Nothing verifies this. One guard exists, for the mistake that is both easy and
completely silent — passing the *record* the stores live in (`useStore(db)`
instead of `useStore(db.todos)`) throws, because a plain object with no callable
property cannot be a change source.

**Why it is safe today.** Getting it wrong makes a session stop updating, which
any probe test that mutates a store and asserts an update will catch. That is how
it was caught while building this: the todo app declared the database rather than
the store, and seven tests failed immediately.

**What makes it wrong.** An app without that test coverage. The failure mode is
a screen that quietly goes stale rather than an error, which is the worst
category of bug this project can ship.

**What retires it.** A registered-source contract: stores declare themselves to
the runtime, and `useStore` rejects anything not registered. Deliberately not
built as a required `onChange` method — a market simulator announcing `onTick` is
as legitimate a source as a table announcing `onChange`, and forcing a shared
method name buys a rename rather than a guarantee.

### Participation is latched per session

**What was built.** A render that declares no reads is treated as reading
*everything*, so an app that never calls `useStore` keeps updating exactly as it
did before scoping existed. That fallback has to be switched off once an app is
known to participate, or a screen that legitimately reads nothing could never be
skipped — so the host latches a flag on the first `useStore` call it ever sees,
and from then on an empty read set means empty.

**Why it is safe today.** Every probe either declares all of its reads through
`useStore` or none of them.

**What makes it wrong.** A mixed app: one component declares its reads, another
reaches a store directly. After the latch, a render containing only the second
kind reports an empty read set and is skipped, and that part of the screen goes
stale. This is the same failure as the identity mismatch above and the same
contract retires it.

### Only one store identifies itself

**What was built.** `TodoStore.onChange` notifies with itself as the source. No
other store does, so every other probe notifies with nothing and the runtime
falls back to re-rendering all of its sessions — the behaviour that predates
this work.

**Why it is safe today.** The fallback is correct, just wasteful, and it is
exactly as wasteful as before.

### The mechanism is inert across every probe, and store tagging is not why

This is the item on this page worth reading. It was found while updating the
probe write-ups, and it is a larger qualification than "adoption is pending".

Converting the remaining stores would not, on its own, save a single render.
**Every probe reads every store it has at the top of its tree, unconditionally.**
`ClockApp` calls `useStore(props.store)` and `store.state()` before it decides
whether the clock is even visible, so a session with the clock hidden declares a
read of the store the tick mutates and cannot be skipped — which is precisely the
100%-quiet case `probes/clock.md` asked for read scoping to fix. `OddsBoard`
calls `useStore` on both the simulator and the ledger in its first two lines, so
a session not showing its own account still declares a read of the ledger a
stranger's fill just changed.

So the two probes that independently asked for this mechanism are both
unaffected by it as written, and the reason is not the store side. Store
granularity is the right unit; reading at the root defeats it. What pays is
pushing each read down to the component that actually needs the data, so that a
component which is not rendered does not declare the read — which is an
**authoring change**, and a real one, not a store annotation.

That reframes what this increment bought. The mechanism is correct, tested, and
free when idle, and it is a prerequisite for the saving. It is not itself the
saving, and no measurement in this repository has moved because of it.

**What retires it.** Converting one probe's reads downward and measuring
`scopedSkips` against `renders`. Odds is the better candidate of the two because
its per-account subtree is already conditional and opt-in, so the read has an
obvious home. It was deliberately not done in the same increment as the
mechanism, because it would move published figures in `probes/odds.md` and those
had just been re-baselined.

**What to be careful about.** Pushing a read downward changes when a component
declares it, so a screen can now legitimately declare fewer reads than before.
That interacts with the latch above: get it wrong and the session is skipped
rather than merely re-rendered too often. The failure direction reverses, which
is why this wants a test that mutates the store and asserts an update, per probe,
before the reads move.

### `scopedSkips` is a count, not an attribution

**What was built.** One counter of renders avoided. It answers "is scoping doing
anything" and nothing else.

**What it cannot answer.** Which store, which session, or whether a source that
never matches anything is mis-declared or genuinely unread. Those look identical
from here, which is why the guard above is a shape check rather than a runtime
warning: falling back when nothing read a source would throw away scoping's best
case.

---

## Keyboard and focus

Built in the same increment: a `key` payload with modifiers, `focus`/`blur`
payloads, and a `focusWhen()` hole the client applies as a transition.

### Key handlers are bound per element, so dismissal depends on where focus is

**What was built.** `@keydown` is an ordinary event hole on an ordinary element.
There is no document-level or capture-phase binding.

**Why it is workable.** Escape-to-dismiss works if the key handler sits on a
subtree that contains the focused element — which is why server-directed focus
shipped in the same increment as the key payload. A menu that takes focus when it
opens can be dismissed from the keyboard; one that does not, cannot.

**What makes it wrong.** Any shortcut that should work regardless of focus. A
global key binding needs a representation with no element to hang off, and that
is a protocol addition rather than an application workaround.

### Focus repeats need an author-supplied nonce

**What was built.** The client focuses the element on the render where `active`
becomes true. To move focus to the same element twice without it becoming
inactive in between — a validation error re-focusing the field the user is
already in — the author bumps `focusWhen(true, n)`.

**Why it is safe today.** Nothing in the probes needs a repeat, and the field is
omitted from the wire entirely when unused.

**What it costs.** An author-managed counter, which is the sort of manual key the
component layer otherwise deleted. If a second use appears, it is worth checking
whether the transition should be derived from something the app already has.

### The server cannot read focus back

**What was built.** `focus` and `blur` payloads report that focus moved, not
where to.

**Why this is a decision rather than a shortcut.** The destination is a DOM
reference, and the authoritative tree has no way to name one. Reporting it would
put a browser-only concept into the model.

**What it costs.** The server cannot restore focus to "wherever it was"; it can
only put focus somewhere it chose. For the known cases — focus the dialog on
open, focus the trigger on close — the server already knows the trigger, so this
has not bitten. A case where it needs to genuinely restore is the signal to
revisit.

### The client half is untested

**What was built.** `client/focus.ts` is a lit directive; `describeEvent` reduces
DOM events to payloads.

**What is covered.** `describeEvent`'s branch ordering, which is the part with a
real bug in it — a keydown falling through to `change` would report the input's
value from before the key was applied, as though the user had typed it.

**What is not.** The directive, and `describeEvent`'s `change` branch, both of
which need a DOM the repository has no test environment for.

**What was done instead, once.** A throwaway probe was built, driven in a real
browser, and deleted. It confirmed the four things worth confirming: the dialog
holds `document.activeElement` on the render where `focusWhen` turns true; a key
press arrives at the server carrying its name and its modifiers; Escape closing a
dialog works with the decision made entirely on the server; and focus is **not**
re-asserted on subsequent frames — click away from an open dialog and focus stays
where it was put. That last one is the property a naive implementation gets
wrong, and it is the one a regression would most plausibly reintroduce.

**What that leaves.** A manual check that passed once and cannot fail loudly
again. Retires when there is a browser test environment to move it into.

---

## Handler signature

### `session.params` is standing in for identity — **retired**

**What was built.** `listen({ identify })` returns a user the server
computed. `grant` POSTs `/session`; the host sets an HttpOnly cookie
on the page origin. Vite proxies `/ws` and `/session` so week one is
one origin. `listen({ publicDir })` serves a built page next to the
socket. Handlers still receive the acting session as an argument.

**What remains a shortcut.** The cookie value is the opaque string the
app issued — unsigned, not a users table. `tsx watch` still wipes an
in-memory `Map`. HTTPS is a reverse proxy, not `listen`. Authorization
is still an authoring rule: re-check `session.user` at `mutate`.

**What it is not.** A users product. Durable *sessions* (`proposal.md`
§4) are still unbuilt — a cookie restores the name, not the live tree.

---

## Component tags

Built with the islands authoring increment: `component.tag("CardRow", fn)`
puts a PascalCase name in a process-wide catalog so a lit-html template can
write `<CardRow .card=${card}>`. `component(fn)` stays unregistered. Lookup
happens at apply time. A tag that is the whole template unwraps to the same
marker as the function call, so keyed addresses match. Islands are refused.

### The tag is a string, so the consumer is untyped

**What was built.** The function form is an identifier. `CardRow({ card })`
type-checks props, renames, and go-to-definition. The tag form is markup
inside `html\`…\``. TypeScript type-checks the `${…}` holes and treats the
element as text. A missing `.cards`, a typo `<Cardrow>`, a `.card=${12}` —
the language cannot see them. The unused `const CardRow` some authors will
want to keep does not fix this: the binding is not what the tag closed over.

**Why it is safe today.** The tagged sites are two demo rows (`TodoRow`,
`CardRow`) and a unit file that serializes both spellings and asserts they
are the same tree. A wrong prop still throws at serialize or fails a probe
test. Nobody is consuming a third-party tagged component from a string.

**What makes it wrong.** A catalog other people import. The consumer of
`<CardRow>` is exactly who wants "prop missing or wrong" at the element,
and they are the ones the string cannot help.

**What retires it.** One of two product paths, not a smarter `html` generic
and not `HTMLElementTagNameMap` (CardRow is not a DOM element).

1. **Server JSX.** `<CardRow card={card} />` is an identifier. The
   transform already described in `proposal.md`'s appendix emits
   `CardRow({ card })`. That restores lint without a plugin. It also
   upgrades the older "JSX is marketing" line: once tags exist, JSX is
   how the pretty spelling becomes typed. Keep the wall — `<CardRow>`
   is a server component, `<mount Island={ColorPicker}>` is an island.
2. **A TypeScript language plugin.** Diagnostics on spans *inside* the
   template string, the way `ts-lit-plugin` already underlines an unknown
   attribute on a custom element. Unknown tag, missing required prop,
   wrong hole type, autocomplete after `.`. Stock `ts-lit-plugin` is the
   wrong shape (kebab-case HTMLElement classes). A Socklit plugin would
   walk the same tags `island-markup.ts` walks, with the props type from
   `component.tag("CardRow", fn)`. That is a checker the product then owns.

Until one of those ships, the dual API is **typed versus catalogued**, not
two spellings of the same thing. Call the function when the checker
matters. Do not keep a dummy const to soothe unused-var.

### The catalog is process-wide

**What was built.** One `Map` from tag string to handle. The string is the
one passed to `component.tag()`, not `fn.name`, so two `function AccountRow`s
can coexist until one of them claims `<AccountRow>`. A second claim throws.

**Why it is safe today.** All probes load in one process, and only two
components are tagged, with distinct names. Tests that need a tag pick
names like `TagBox`.

**What makes it wrong.** Two apps, or two packages, that both want
`<Row>`. A product wants the table per app (or per module graph), not per
process.

**Cost of retiring it later rather than now.** Low. `lookupComponent` is
one call site; the change is which map it reads.

---

## First-user product surface

Found by a blind build ([`docs/first-user-experiment.md`](../docs/first-user-experiment.md)).
The public API was enough to ship a shared fridge. These are the holes
that builder hit, not guesses.

### The starter does not contain the product’s actual first app

**Retired.** `starter/` is a shared list (`createJsonStore` + `subscribe`).

### `mutate`’s `result` is cargo-culted

**Retired.** Getting-started says `result` is the Promise value for
`await store.mutate(…)`. The replica never reads it.

### An app that installs React gets two copies of it

**What was built.** The replica mounts islands with `react-dom`. The
starter Vite config `resolve.dedupe`s `react` / `react-dom`. Getting-
started says so next to `npm install`.

**Why it is safe today.** A copied starter will not hit two Reacts.

**What makes it wrong.** An app that installs React and skips `dedupe`
(or a published `socklit` that still nests its own React). Invalid hook
call, page stays “connected,” island dead.

**What retires it.** `react` / `react-dom` as `peerDependencies` when
the package is published. Until then the Vite line is the contract.

### Rejected submits wipe the form, and native validation can skip the handler

**What was built.** Getting-started documents the unbound-input rule
and that there is no public draft helper. `@submit` still does not fire
when the browser’s `required` / `min` blocks the submit — that sentence
is still missing.

**Why it is safe today.** The add field in the starter is unbound.

**What makes it wrong.** A multi-field form that binds `.value=` so a
rejected submit looks wiped, or a `min=` that leaves a stale
`useState` error because the handler never ran.

**What retires it.** The missing `@submit` / constraint-validation
sentence. Then decide: “do not bind `value=` on fields you want to
keep” is the product, or there is a public draft helper. Do not do
both.

---

## After first-user and the public-site path

Rounds 2–6 plus the local product prep (`file:` install, `listen({
origin })`, signed tickets, grant-without-reconnect, docs site, Line 47
in `../socklit-demo`). Grant reconnect, quiet island failure, and
“store is Postgres” are **not** on this list — those were shipped or
were stop conditions.

These are the leftovers. Each line is a retirement, not a vibe.

### Path navigation tears the session, so `useState` cannot survive a link

**What was built.** The replica puts `location.pathname` on the socket
as `session.params.get("path")`. Vite and `listen({ publicDir })`
serve `index.html` for extension-less paths, so a reload of
`/compare` still boots. The app switches on that string.
`<a href="/checkout">` is a real document load: new page, new
socket, new session.

**Why it is safe today.** The docs site and the starter have no
per-tab state that must live across a path. Identity is a cookie.
A shared cart can be a source (`useStore`) or a row on
`session.user`. Getting-started says this is not a router.

**What makes it wrong.** The first in-memory cart, wizard step, or
unsaved draft a developer puts in `useState` dies on the next
`<a href>`. They will expect SPA navigation. Reloading `/checkout`
with an empty cart is the bug they file. Putting every draft in a
store makes it everyone’s draft, or forces a user-keyed table
they did not want yet.

**What retires it.** Keep the socket across a path change:
`history.pushState` (and back/forward), a protocol message that
updates `path` on this session, and a re-render. Same
`useState`, same islands, new tree. Reload of `/checkout` still
uses today’s connect-time `path`. Until that exists, a value that
must survive a link is a source or the person, not `useState`.

### Tagged components should take `children`

**What was built.** `component.tag` is a catalog key so you can write
`<TodoRow .todo=${todo}></TodoRow>`. Bindings must be named holes.
A tag does not take children — the compiler throws. The function
call already accepts a `RenderOutput` on any name, including
`children`. The docs site is `Shell({ path, children: body })`.
`<mount>` already scoops a body into a synthetic template (`<slot>`).

**Why it is safe today.** The typed spelling is the function call.
Nobody has to wrap a page in a tag.

**What makes it wrong.** The point of the tag is the visual split:
properties of the thing vs what slots inside it. We supported the
representation and then forbade the split. `<Shell .path=${path}>${page}</Shell>`
is the thing people write. Today they have to leave the template
and call `Shell({ path, children: page })`.

**What retires it.** In the tag compiler only: the body until
`</Name>` becomes `props.children` (one `RenderOutput`, same as
mount’s slot scoop). Refuse `.children=` and a body at once.
Whitespace-only body stays “no children.” Match nested same-name
tags by depth. No protocol, no runtime, no `Children.map`. The
function call does not change. Getting-started: properties are
bindings; the interior is children.

### Vite hops; the replica attaches to whoever owns the protocol port

**What was built.** Starter Vite is 5173 → listen 8787. Site is 5175 →
8789. Experiment apps and Line 47 took the next free ports. Vite
prints `Local:` and moves on. Forget `?ws=` and the replica talks to
whoever is already on 8787. Health is `{ ok, sessions, protocol }` and
the replica does not ask it.

**Why it is safe today.** One app on a quiet machine.

**What makes it wrong.** Lobby held 5175; the docs site was told as
5175; the page said connecting and never painted. Studio already hit
“silent wrong server.”

**What retires it.**

1. `strictPort: true` on starter and site so a collision is an error,
   not a lie.
2. Replica handshake: before applying a snapshot, confirm
   `protocol` (already on the frame) and that this listen is the app
   this page thought it was — a name the server advertises on
   `/health` and the client was built with.
3. One printed URL. Stop treating 5175 as exclusive in the README.

`?ws=` stays the escape hatch when there is no proxy. Cookies will
not cross that hop.

### `tsx watch` follows into the host and evicts in-memory tickets

**What was built.** Starter watch excludes `../server/**` (this repo
next door). A copied app with `"socklit": "file:/ABS/PATH"` does not
hit those paths; `tsx` will follow into `node_modules/socklit` and
restart `listen`. A `Map` of tickets dies. The cookie does not.

**Why it is safe today.** Signed tickets survive a restart. The in-repo
starter exclude is enough for `starter/` inside this repo.

**What makes it wrong.** Lobby’s book was a `Map`. Watch restarted,
Ada’s cookie still sat her in a chair the process no longer knew.
They wrote `data/tickets.json` and narrowed the watcher by hand.

**What retires it.** Exclude `node_modules/socklit/**` in the starter
(and site) watch. Getting-started: if identity is a `Map`, do not let
the watcher follow the host; if it must survive a restart, use
`signTicket`. Signed tickets remain the app’s job.

### A no-op `mutate` is silence to the island

**What was built.** Same-reference `mutate` does not write and does
not notify. Island callbacks return a Promise (`island-result`). The
Promise value is whatever the server function returned, not “did the
store change.”

**Why it is safe today.** A server button that no-ops is already
silence. Checkers illegal-drop “nothing happens” felt honest when
the square was server markup.

**What makes it wrong.** The island already painted the destination
(optimistic board, optimistic claim). The store did not move. There
is no public “the write did nothing” signal. The island has to notice
that `men` / `ownerId` is unchanged and walk home.

**What retires it.** Pick one and write it down:

- **Snap-back is the contract.** Document it next to the island
  board sentence. The island diffs the next props. No new API.
- **An ack.** `mutate` (or the island Promise) reports `{ wrote:
  boolean }` so a gesture does not have to infer.

Do not leave both in the air. Line 47 and floor hid the illegal
button and still refused in the write; they never needed the ack.
Lobby after the board-as-island revision did.

### `createApp` can close over a dead `user`; `revoke` docs still say reconnect

**What was built.** `grant` / `revoke` send `{ type: "credential" }`
and reidentify on the same socket. `tokenIdentifyRequest` writes the
new token into both `cookies` and `params`. `createApp` runs once;
`context.user` is updated in place. Getting-started’s
`() => App({ user: session.user })` reads at render and is correct.
`session.revoke()` is still documented as “reconnects signed out.”

**Why it is safe today.** An `identify` that uses `sessionToken(request)`
sees the synthetic cookie. A render function that reads `session.user`
sees the new person.

**What makes it wrong.**

- `identify` that only reads `params.get("user")` misses the cookie
  on reidentify and after refresh.
- `createApp: (session) => { const user = session.user; return () =>
  App({ user }); }` keeps the connect-time guest after `grant`.
- Anyone who still believes revoke tears the tab down will reintroduce
  the lobby hall-dump.

**What retires it.** Fix the revoke sentence. Every identity example
uses `sessionToken`. Add the closed-over-`user` anti-example next to
`createApp`. Do not add a second listen shape.

### `app` vs `createApp` is two listen shapes for one product

**What was built.** Starter uses `app`. Identity needs `createApp`
so the render can see `session`. Both are public.

**Why it is safe today.** Getting-started shows both. A shared list
does not need a person.

**What makes it wrong.** Studio had to discover the second shape to
put a member on the socket. Two recipes, one page.

**What retires it.** One listen recipe in the starter comment: `app`
until you have `identify`, then `createApp`. Or make `app` receive
`session` and delete the fork.

### Island local state vs a store notify is undocumented

**What was built.** A patch of the same island hole does not remount
React. Critique’s `ka` and floor’s `nginx` survived another tab’s
write. A snapshot resync or a keyed row leaving unmounts the tree.

**Why it is safe today.** It is the correct model and it already
works.

**What makes it wrong.** Builders design around a remount that does
not happen (critique almost did). Or they assume the caret always
survives a full snapshot.

**What retires it.** One paragraph in the island section: local React
state lives with the hole; a patch keeps it; a remount does not.
The persist beat after `onPick` (local pick, then the stripe) is the
same paragraph, not a new API.

### The board-as-island rule is still the overlay sermon

**What was built.** Getting-started says an island is the gesture
that cannot wait for the wire. Lobby first painted squares as server
`html` and hid the stale man with a CSS felt cover so the overlay
death would not flash. That is a cover-up. The revision put the
whole board in the island, driven by `men` / `onMove`. `play()`
stayed the referee.

**Why it is safe today.** Typeahead and a swatch tray are not a
board. They do not need this sentence.

**What makes it wrong.** The next drag app repeats the overlay split
and the one-frame lie.

**What retires it.** Write the sentence: if the gesture owns the
cells, the cells are the island. The hall stays server UI. The
referee is `mutate`, not the drag library. Optimistic paint;
snap-back when the props do not change (see no-op `mutate` above).

### `registerIsland` types reject a real component

**What was built.** `registerIsland(name, ComponentType<Record<string,
unknown>>)`. Floor and the docs site cast (`as never`). The runtime
accepts the component.

**Why it is safe today.** A cast is one line.

**What makes it wrong.** It looks like the island is the wrong shape.
Builders will “fix” a working widget.

**What retires it.** `registerIsland<P>(name, ComponentType<P>)`.

### App `tsc` follows imports into Socklit

**What was built.** App tsconfigs resolve `socklit/server` to this
repo’s `.ts`. Floor scored `src/` only because the host reported
errors in `island-host.ts` / `runtime.ts` / `component.ts`.

**Why it is safe today.** We typecheck the host in this repo.

**What makes it wrong.** A first user’s `tsc` is red for files they
did not write. They will think they broke the install.

**What retires it.** Published (or `file:`) types that do not pull
the host sources into the app program — `types` / emitted `.d.ts`,
and `skipLibCheck` in the starter.

### Island callbacks vs `@click` still teach two spellings

**What was built.** `mount()` types the server closure as
`(...args, session)`. Getting-started says do not close over `user`.
Floor started before that sentence and closed over it anyway.

**Why it is safe today.** The type is there. Refuse in `mutate`
either way.

**What makes it wrong.** A closed-over `user` is the person from the
last render, not the person who picked. After `grant` without
reconnect that can be stale in a different way than it used to be.

**What retires it.** The anti-example stays in getting-started (done).
Handlers that need `SessionHandle<Member>` still want an explicit
annotation — strict TS does not infer it from `html`. Document the
annotation; do not invent a typed `html` for this.

### Protocol chrome is still in the starter

**What was built.** Starter `index.html` has the connecting pill.
The replica writes it. Critique would not show it to a client. The
docs site uses `#app:empty::before` instead.

**Why it is safe today.** It is how you see a dead listen.

**What makes it wrong.** Every journal called the pill leftover.
A public page that ships the starter HTML ships “connecting.”

**What retires it.** Hide it by default (CSS or omit the node). Keep
a documented way to turn it on for local debugging.

### Session handlers do not infer `session`

**What was built.** `@click=${(_event, session) => …}` is untyped
unless the app writes `SessionHandle<Member>`.

**Why it is safe today.** Runtime passes the live session regardless.

**What makes it wrong.** Strict apps annotate every handler (studio).
Easy to skip and close over `user` instead.

**What retires it.** Same as the island-callback annotation: show
`SessionHandle<Member>` once in getting-started. A typed `html` is
not this ticket.

---

*Design rationale for the research increments is in [`proposal.md`](proposal.md).
Measurements are in [`design-probes.md`](design-probes.md) and the per-probe
documents under [`probes/`](probes/). First-user evidence is
[`docs/first-user-experiment.md`](../docs/first-user-experiment.md).*
