# The proposal

What remains to be built, and why each piece earns its place.

Every sketch here is written in terms of components and component-scoped state,
and **those exist** — §0 is a short record of what they are, what they cost once
measured, and which of the arguments made for them in advance turned out to be
wrong. Four further items have since been built: key events and focus, handlers
receiving the acting session, read-scoped invalidation, and `useDurable`.
Each is marked where it appears, and the shortcuts taken to get them shipped
are in [`tech-debt.md`](tech-debt.md). Everything else is unbuilt.

---

## What this is

A web application where the **server owns the running UI**, not the browser.

For every connected user the server keeps a live instance of the application. It
renders that instance to a tree, works out what changed since the last frame, and
sends the browser only the differences. The browser holds no application state
and no business logic. It sends back semantic events — *the control at this
address was clicked, with this value* — and applies whatever patches come back.
The layout of a template crosses the wire once. After that, only values move.

What that deletes is the entire middle of a normal web application: no HTTP
endpoints, no request and response types, no client cache, no cache keys, no
invalidation, no data fetching, no loading and error states, no optimistic
updates with matching rollback paths, and no version skew between a deployed
client and a deployed server, because there is no deployed client.

```ts
html`
  <input
    type="checkbox"
    .checked=${todo.done}
    @change=${(event) => todos.setDone(todo.id, event.checked)}
  />
  <span>${todo.text}</span>
`;
```

That is the whole path from a click to a durable write to every other viewer's
screen updating. Two tabs stay consistent because both render from the same
state; nothing was written to make that happen.

**The bet is ergonomic.** Server-rendered live UI is not a new idea and the cost
profile is broadly favourable, but the reason to build it is that a large
category of work — the API layer, and the client's shadow copy of the server's
data model — stops existing. Everything below is in service of keeping that
property while removing the reasons you could not ship it.

---

## 0. The layer this builds on

Every sketch below is written in terms of components and hooks, so this section
records what those are and what they cost. It is the only part of this document
describing something that exists.

`server/component.ts` provides `component()`, `useState`, `useRef`,
`createContext`/`useContext` and a per-session `HookHost`, wired through
`serialize()` and covered by `test/component.test.ts`. All six probes and the
reference todo app run on it.

It also provides `useStore`, which was a seam and is now load-bearing: it returns
the store it was given, unchanged, and records the read against the session so
that invalidation can be scoped to it. What it still does not do is attribute a
read to anything other than a single session, which is the constraint §3 places
on how scoping has to be built once renders are shared.

```ts
const TodoRow = component((props: { db: Database; todo: Todo }) => {
  const [confirming, setConfirming] = useState(false);
  return html`…`;
});
```

`component()` returns a function producing a **marker** — a branded
`{ fn, props }` object — rather than a `TemplateResult`. Serialization sees the
marker in a hole, assigns the address it was going to assign anyway, pushes a
hook scope, and invokes. Interning, diffing, the wire format and the client were
untouched, and the headline property was asserted rather than assumed:
**extracting a subtree into a component produces byte-identical wire output.**

The reason this mattered is that lit-html has templates but no components. When a
function returns a `TemplateResult`, the runtime never learns a boundary was
crossed — so every primitive proposed below used to carry a hand-written key
string like ``gate(`row-actions:${account.id}`)``, each one an author supplying
identity the runtime already had. Those key strings are now all deletable, and
that is the single largest reason the rest of this document is shorter than it
would otherwise be.

### What the boundary costs

Against a baseline row costing about 0.47 µs to render, serialize and diff:

| Row | Added per instance per render |
| --- | --- |
| Behind a `component()` boundary | 15–33 ns |
| Also holding one `useState` | 45–75 ns |

**The boundary is nearly free and the hook is merely cheap**, which is the
opposite of the rationing rule you would guess. There is no performance reason to
write a row as a bare helper instead of a component.

That figure took four passes to reach, and the same mistake caused every one: the
implementation charged **per instance per render** for things that vary only per
component, or only per instance, or not at all. Three of the four passes were
spent removing bookkeeping the layer had invented — a set of visited addresses, a
freshly allocated scope per component, an end-of-render sweep over every entry the
session had ever held — and the state table is now opened by the first hook that
asks for one, so a component that never calls a hook costs nothing but a marker
and a call.

The largest single win was not in this layer at all. Instance addresses were
rebuilt by concatenation every render, which leaves V8 an unflattened rope: cheap
to make, and expensive for the hook table, the diff and the JSON encoder, each of
which had to flatten and hash it again. Handing back the same string object each
render took **about 2x off the whole serialize-diff-encode pipeline** and dropped
the marginal cost of holding state from 122 to 45 ns per row. It carries the one
real correctness obligation in the layer — an address must be a pure function of
its path — so there is a test that reorders rows, grows and shrinks the list, and
swaps which component occupies an address, asserting the tree and handler table
come out identical either way.

What matters for the rest of this document is only the conclusion: nothing below
needs to be rationed on CPU grounds. `npm run bench` reports the current figures.

`useMemo` is refused on the same evidence. At 45 ns for a hook slot, memoizing
anything cheaper than a few hundred nanoseconds of work is a loss, and almost
everything a render does per node is cheaper than that.

Two primitives were added because a conversion asked for them rather than because
this document predicted them. `useRef` is a per-instance cell that survives
renders and never schedules one, which is what a component needs to hold a
timestamp or a last-seen value without re-rendering on every write.
`useContext` exists because state that coordinates a subtree — a route, a
selected id, a theme — was otherwise threaded through every component in between;
a provider carries its subtree rather than wrapping it, so it costs nothing on the
wire.

### Hooks, and what they cost sharing

Hooks look like a threat to sharing, and they are one. A single per-user hole
pins the amortization ratio at exactly 1.00x, because a personal value makes
every one of its ancestors unshareable — and a `useState` call is by construction
a per-session value sitting inside a subtree. Scattered freely, hooks would
poison sharing invisibly.

The mitigation is to type them by *ownership*. Two of these are built, one is a
call site with nothing behind it yet, and the rest are proposed below. The table
is the rule all of them have to satisfy.

| Hook | Owned by | Lifetime | Shareable subtree? | Status |
| --- | --- | --- | --- | --- |
| `useState` | Server, this session | Dies with the socket | **No** | Built |
| `useRef` | Server, this session | Dies with the socket | **No** | Built |
| `useStore` | Server, everyone | Durable | Yes | Built; scoped per session, see §3 |
| `useDurable` | Server, this person / this tab | Survives reconnect and deploy | **No** | **Built**, §4 |
| `useEcho` | Client, this browser | Dies with the socket | Yes | Proposed, §1 |
| `useGate` | Client, this browser | Dies with the socket | Yes | Proposed, §2 |
| `useSelection` | Client, this browser | Dies with the socket | Yes | Proposed, §2 |

`useContext` is deliberately absent: it carries no state of its own, so it is
neutral on every column here. A provider is invisible on the wire and takes the
ownership of whatever value is put into it.

#### The slot table is not a shareability index

An earlier draft claimed component scope gives the runtime a general
shareability index. It does not, and the distinction governs §3.

Sharing is decided by canonicalizing a subtree by template id *and hole values*.
Whether a subtree can be shared is therefore a property of the values in it, and
hook state is one contributor among several — in the measurements, not even the
dominant one. What took amortization to 1.00x was `${viewer.name}` in the corner
of a shell: an ordinary prop, in a component that holds no state at all.

This document's own final example is the counterexample. `DispatchQueue` holds
the session state, derives `rows` from it, and passes that down. The child's slot
table is empty, so a hook-based index would call it shareable, while every byte
in it is session-derived. The behaviour is still correct — sharing keys on the
values, so the subtree is rendered once per distinct filter — but it is value
canonicalization producing that answer, which the runtime already does today.

So the boundary that decides shareability is `shared()` with `personal()`, and
component scope does not change it.

#### What ownership typing does buy

It makes the hazard **hooks themselves introduce** enforceable rather than
silent. A `useState` in a shared body is a per-session value that no author
declared and no reviewer is likely to notice, and the ownership column is what
lets `shared()` throw on it at first render. That is a refund on a cost this
layer created rather than a new capability.

Two further things fall out of the same table, and these are unambiguous gains.
Lifetime becomes visible at the call site, where three very different tiers would
otherwise be one undifferentiated bag of closure variables that all silently
evaporate. And the latency cliff becomes visible: `useState` and `useEcho` read
differently, which matters because a server-owned text field is not slow but
*wrong*, and the two cases are indistinguishable if both are spelled `useState`.

**The honest cost.** Hooks make a round trip look free. `useState(false)` for a
disclosure is nothing in React and is a full round trip here. The mitigation is
that the client-owned hooks exist and are the obvious reach for exactly those
cases — which is why §2 is not optional now that this layer has shipped.

### Why this is not a JSX proposal

An earlier draft bundled all of the above with JSX, on the argument that sharing
needs the runtime to know which holes are personal, that you cannot attach
metadata to a `TemplateStringsArray`, and that a compiler is therefore required
regardless. **That argument was wrong.** `personal((s) => s.balance)` marks the
*value*, not the template, and `serializeValue` already dispatches on value kind
— which is exactly how `keyed()` works. Runtime marking is sufficient, so sharing
does not need a compiler.

Removing that argument removes the case for JSX, because the rest of what a
compiler buys here is thin. Mandatory keys are already enforced at runtime by
`keyed()`. A `useState` inside a `shared()` body becomes a runtime throw on first
render rather than a compile error, which is nearly as good, since a hook call is
not a rare conditional path and the first render exercises it. The one genuine
loss is closure capture: a compiler can prove a shared body never reaches an
outer `session` variable and a runtime cannot. That is mitigated by defining
shared components at module scope, where there is no session in lexical scope to
capture — a convention rather than a guarantee, but a legible one.

Set against that, a JSX compiler would have to **reproduce** the template
interning that currently comes free from the language, and reproduce it exactly:

```60:60:server/serialize.ts
  private readonly ids = new WeakMap<TemplateStringsArray, number>();
```

That works because the language guarantees a tagged template hands back the same
strings array per call site. It is the foundation of I3, it already works, and
replacing a working mechanism with a hand-written one is a poor trade for syntax.
JSX remains available later as a pure transform emitting `component()` and `html`
calls — see the appendix.

### The rules this layer added

Three, all of which the sections below assume:

- **Hooks may not be called conditionally.** Slots are positional within a
  component, and the runtime throws when the count changes rather than silently
  handing back the wrong slot.
- **Session state may not be captured from an enclosing scope.** Everything a
  component needs arrives by prop or hook. This is the convention `shared()`
  cannot enforce at runtime, so it has to be visible by inspection.
- **`component()` is opt-in, and forgetting it degrades quietly.** A bare helper
  call inlines into the parent's hole, so its hooks land on positional slots in
  the parent — which corrupts row state inside a `keyed()` list.

One sharp edge is worth stating because it is invisible at the call site.
Components that have never run a hook skip the state table entirely, and the flag
recording that belongs to the *component* rather than to any one instance — so
adding a single `useState` to a row component moves every instance of it, in
every session, onto the stateful path at once.

---

## Where it stands

The core works: templates intern and are sent once, values patch, collections
maintain identity across reorders, events are validated and authorized
server-side, state persists, multiple sessions stay consistent with no
synchronization code, and subtrees can be extracted into components that hold
their own state without changing a byte on the wire. Keyboard and focus are
expressible, handlers receive the session that acted rather than the one they were
rendered for, and a change to one store no longer re-renders sessions that never
read it.

Three things still stand between that and production. Some interactions feel
wrong or are outright incorrect, the cost advantage at scale is unclaimed, and a
few categories of application cannot be built at all.

| Change | Problem it solves | Size | Status |
| --- | --- | --- | --- |
| Key events and focus | Menus and dialogs are mouse-only and fail accessibility review | Small | **Built** |
| Handlers receive the session | Most of a screen cannot be shared between viewers | Small | **Built** |
| Read-scoped invalidation | Every change re-renders every session | Small | **Built**, per session |
| `useEcho` | A server-owned text field drops characters as the user types | Small | Proposed |
| `useGate` | Opening a menu costs a round trip and feels broken | Medium | Proposed |
| `pending()` | Nothing on screen responds to a click until the server answers | Small | Proposed |
| `useSelection` | Ticking a checkbox costs a round trip | Small | Proposed |
| Test resolver | Tests name controls by structural position and are brittle | Small | Proposed |
| Windowed collections | A long list has no upper bound on payload size | Medium | Proposed |
| `shared()` | Identical views are rendered once per viewer instead of once | Large | Proposed |
| `useDurable` | A deployment discards every user's in-progress work | Medium | **Built** |

---

## 1. Make it correct

Two problems here are not about speed. They are defects.

### Typing must belong to the client

A text field whose value is owned by the server **loses characters**. Each
keystroke makes a round trip and a reply carrying an older value overwrites the
letters typed since. Typing `grayfell` at a normal speed produces `gryel` on a
fast connection and `grayl` on a slow one. Nothing errors and nothing retries —
the user simply sees a table filtered by a word they did not type. It is correct
only when the user types slower than the network, which is not a property you can
ship.

```ts
const AccountFilter = component((props: { filters: Filters }) => {
  const query = useEcho(props.filters.query);

  return html`
    <input
      .value=${query}
      @input=${(event) => props.filters.setQuery(event.value)}
    />
    <p>${props.filters.results.length} matching accounts</p>
  `;
});
```

The client keeps the value and the caret and ignores any server value older than
its last keystroke. The count below is still server-rendered and still
authoritative; only the characters in the box are locally owned.

The naming is load-bearing. `useEcho` and `useState` sit next to each other in
the same file and behave differently on purpose, which is the one place this
proposal deliberately spends a word to prevent a defect.

### Keyboard and focus need to exist — **built**

The event vocabulary could express a click, a change and a submission, and
nothing else. A key press arrived with **no indication of which key it was**, so
"Escape closes this dialog" and arrow-key navigation could not be written at all.
Focus had no representation in either direction, so it could not be moved when a
dialog opened or restored when it closed. Every menu and dialog the architecture
could produce was mouse-only and failed accessibility review.

```ts
html`
  <div
    role="menu"
    ${focusWhen(menu.isOpen)}
    @keydown=${(event) => {
      if (event.key === "Escape") menu.close();
      if (event.key === "ArrowDown") menu.moveFocus(1);
    }}
  >
    …
  </div>
`;
```

A `key` payload carries the logical key plus its modifiers — enough for
dismissal and for list navigation, and deliberately not enough for a game.
`focus` and `blur` report that focus moved without saying where to, because the
destination is a DOM reference and the authoritative tree has no way to name one.

Focus stayed a declarative hole rather than becoming `useEffect`, which is the
first place a hook-shaped surface would have invited one and the first place to
decline. The hole sits in element position, which is the only position lit hands
over the element a binding belongs to; the client focuses on the render where the
value turns true and does nothing on the renders either side of it. The earlier
sketch above passed a CSS selector naming a descendant to focus, and that was
dropped: a selector is a second addressing scheme for a tree that already has
one, and putting the hole on the element to be focused says the same thing
without it.

Two limitations are worth knowing and are recorded in
[`tech-debt.md`](tech-debt.md). Key handlers are ordinary event holes on ordinary
elements, so Escape works when focus is inside the subtree that bound it — which
is why server-directed focus had to ship alongside, and why a shortcut that
should work regardless of focus still cannot be written. And moving focus to the
same element twice without it becoming inactive in between needs an
author-supplied nonce.

---

## 2. Make it feel instant

Two hooks and one handler wrapper cover essentially every interaction that
currently costs a round trip and should not. The unifying rule:

> The client owns **mechanics** — whether something is open, what the caret is
> doing, which rows are ticked, whether an action is in flight. The server keeps
> owning **meaning** — what is in the menu, what the rows are, what the action
> does.

None of these hold application state, and none of them make a subtree
unshareable, because each browser resolves them independently from identical
bytes.

### Presence belongs to the client

Every dropdown, popover, tooltip, disclosure, accordion and dialog is the same
thing: a subtree the server already rendered, which the client decides whether to
show.

```ts
const RowActions = component((props: {
  account: Account;
  closeAll: boolean;
  onEdit: (id: string) => void;
}) => {
  const accounts = useStore(stores.accounts);
  const menu = useGate({
    openOn: "click",
    dismissOn: ["outside", "escape", "child-event"],
    // The server can still assert it, which is what makes this more
    // than a <details> element.
    force: props.closeAll ? "closed" : null,
  });

  return html`
    <div class="menu-anchor">
      <button type="button" @click=${menu.toggle}>⋯</button>

      ${menu.contains(html`
        <div role="menu">
          <button role="menuitem" @click=${() => accounts.suspend(props.account.id)}>
            Suspend
          </button>
          <button role="menuitem" @click=${() => props.onEdit(props.account.id)}>
            Edit…
          </button>
        </div>
      `)}
    </div>
  `;
});
```

The menu items are ordinary server code with real handlers against real state.
Only *whether the subtree is on screen* moved to the browser, and
`dismissOn: "child-event"` closes the menu on the click while the mutation lands
whenever it lands.

Everything this component needs arrives through a prop or a hook, and nothing is
reached from an enclosing scope. That is deliberate, and it is the convention the
whole scheme leans on: closure capture of session state is the one violation
`shared()` cannot detect at runtime, so it has to be visible by inspection
instead. Writing components this way from the start is what makes the later rule
enforceable by reading a function signature.

Note what is absent: there is no ``gate(`row-actions:${account.id}`)``. Earlier
drafts of this primitive carried a key string like that, and it existed only
because there was no per-component identity to hang the state on. Every instance
of `RowActions` gets its own gate with nothing declared. The same deletion
applies to `useSelection` and to the render cache in §3, and it is the concrete
payoff §0 describes.

### Every action should acknowledge itself immediately

When a user clicks something contended — claim this ticket, approve this raise,
take this price — the honest thing to show is not a guess at the outcome. It is
evidence that the click registered.

This is worth being precise about, because it is where most client-side
complexity comes from. A client app typically *predicts* the result and paints
it, then reconciles. That is a false statement whenever the outcome depends on
something the browser cannot see — whether someone else claimed it first, whether
the price moved in flight — and in those domains a wrong guess displayed as fact
is a defect rather than a flicker.

```ts
html`
  <button
    class="primary"
    @click=${pending(() => queue.claim(item.id), { label: "Claiming…" })}
  >
    Claim
  </button>
`;
```

The control enters its in-flight state on the click and is replaced by the
authoritative render when the server answers. There is no predicted state to
correct, because none was invented.

`pending` stays a handler wrapper rather than becoming a hook, and the
distinction is the rule worth holding: **things that retain state across renders
are hooks; things that only modify a binding are wrappers.** In-flight status is
tracked by the client against the binding's address, so there is nothing to
retain.

The same applies to navigation, the most frequent interaction in any application
and currently the one with the least feedback:

```ts
html`
  <nav>${navLinks(route)}</nav>
  ${routeBody(route, {
    dashboard: () => Dashboard({ metrics }),
    tasks: () => TaskList({ tasks }),
    settings: () => Settings({ account }),
  }, {
    // Painted immediately; the highlight moves on the click.
    skeleton: (route) => skeletonFor(route),
  })}
`;
```

A side effect worth having: a control that visibly acknowledges itself does not
get clicked three times, so this reduces duplicate inbound work.

### Selection is generic enough to be free

Ticking rows is client-owned, but everything consuming the selection — the count,
the bulk bar, which actions are enabled — is server-rendered.

```ts
const AccountList = component((props: { accounts: Account[] }) => {
  const picked = useSelection();

  return html`
    <ul>
      ${keyed(props.accounts, (a) => a.id, (a) => html`
        <li>
          <input type="checkbox" @change=${picked.toggle(a.id)} />
          <span>${a.name}</span>
        </li>
      `)}
    </ul>

    <div class="bulk-bar" ?hidden=${picked.isEmpty}>
      ${picked.count} selected
      <button @click=${pending((event) => accounts.suspend(event.selection))}>
        Suspend
      </button>
    </div>
  `;
});
```

`picked.count` reads like server state and resolves on the client; the bulk
action receives the selected keys with the event. The author never writes the
synchronization.

`keyed()` is unchanged, and deliberately so. I4 already makes identity mandatory
rather than advisory, and the runtime already throws on a bare array. There is
nothing here component scope improves.

---

## 3. Make it cheap at scale

This is the one genuine structural advantage the architecture has over a
client-side application, and it is currently unclaimed. When many people look at
the same thing — a scoreboard, a market, a dispatch queue — a client-side
architecture must render it once per browser and can never do otherwise. A server
that owns the UI can render it **once**. At a thousand viewers of a live view,
upwards of 99% of current rendering work is provably redundant.

### Handlers should receive the session — **built**

A handler used to have no choice but to close over the session it was rendered
for:

```ts
// Captures this viewer's account, so this subtree can only serve this viewer.
@click=${() => market.take(market.id, viewer.account)}
```

The bytes of that row are identical for every viewer; the closure is what
differs, and the handler-bearing region was measured at 77.5% of everything
otherwise shareable. The acting session is now an argument, so one closure serves
everybody and the actor is resolved at the moment of the click:

```ts
@click=${(event, session) => market.take(market.id, session.params.get("user"))}
```

The handler is called with the session that sent the event rather than the one
the tree was rendered for, which is what makes the closure correct for a subtree
serving more than one viewer. Handlers that do not need it are unaffected: a
shorter function remains assignable, so no existing handler changed.

What arrives is `{ id, params }` and nothing more. `params` is standing in for
identity — it is a value the client chose, so nothing here is an authorization
model, and the question of what a session actually is stays open in §4.

Without this the majority of a typical screen could not have been shared no
matter what else was built. With it, `shared()` below is unblocked.

### A shared component is an ordinary component

Sharing needs no new shape. An earlier design gave it a dedicated form with a
`data`/`personal` split and a `render` callback, because without a component
boundary there was no other way for an author to declare a subtree's inputs. Now
that the boundary exists, inputs are already declared — they are props — and
`shared()` is a component that enforces two extra rules:

```ts
const MarketBoard = shared((props: {
  markets: Market[];
  lastTrade: Trade;
  balance: Money;
  canTrade: boolean;
}) => html`
  <header>Your balance: ${props.balance}</header>
  <ul>
    ${keyed(props.markets, (m) => m.id, (m) =>
      MarketRow({ market: m, canTrade: props.canTrade }),
    )}
  </ul>
`);
```

Called with personal inputs marked at the call site:

```ts
${MarketBoard({
  markets,
  lastTrade,
  balance: personal((s) => s.balance),
  canTrade: personal((s) => s.limits.enabled),
})}
```

The two rules, of which the first is what §0's ownership column exists to make
checkable:

1. **No server-owned hooks in the body.** A `useState` inside a shared component
   throws on first render with a real message, because it would silently make the
   subtree per-session. Client-owned hooks are fine — `MarketRow` may call
   `useGate` freely, since every browser resolves it from identical bytes.
2. **Session is not in scope.** The render simply is not passed one, and a shared
   component is defined at module scope so there is none to capture. This is the
   rule the runtime cannot enforce, which is why the convention in §2 — everything
   arrives by prop or hook — is load-bearing rather than stylistic.

Props into a shared component come in three kinds, and it is worth naming the
third because it is easy to mistake for a violation:

| Kind | Example | Why it is allowed |
| --- | --- | --- |
| Shared data | `markets` | Same value for every viewer in the cohort |
| Personal value | `personal((s) => s.balance)` | Marked, and slots into a hole without changing tree shape |
| Client-owned handle | a `useSelection()` result | Resolves to a structural address, so it is byte-identical across sessions even though a session created it |

The third looks like session state crossing a boundary that forbids it. It is not,
because the handle carries no session identity — only the address its hook was
called at, which is the same address in every session rendering that subtree. The
browser resolves it locally. A server-owned handle passed the same way would be a
genuine violation, and is caught by rule 1 at the point the hook is called.

The distinction that matters is between a personal value that slots into an
existing hole and one that changes the *shape* of the tree. The first is nearly
free — build the structure once, evaluate a handful of bindings per viewer. The
second forces a render per viewer and gives up the entire advantage. `personal()`
marks the first; anything that branches on a personal value is the second.

This also refunds most of the price A6 expected to pay. Making the boundary
structural was accepted there "at the cost of a visibly two-tier authoring
model — which cuts against the project's premise that it should feel like writing
ordinary client code." With components the two tiers are `component()` and
`shared()`, taking the same props and returning the same templates. The tier is a
line of enforcement, not a second way to write UI.

The practical authoring rule, worth knowing before any of it is built:
**anything that differs per user should sit as close to a leaf as possible.** A
single per-user string high in a tree makes everything above it unshareable. A
name in the corner of a shell takes a perfectly shareable dashboard to zero.

### Do not re-render sessions that cannot have changed — **first mechanism built**

Any change used to re-render every session's whole tree. Two mechanisms fix the
bulk of that without a reactive dependency graph, which would relocate the
client-framework complexity this project exists to delete. `design-probes.md`
ranks these options against each other and puts the first of them first; that
ranking is within this topic, and is independent of where this whole topic sits in
the sequencing below.

The first needed no API and is built: a store that identifies itself when it
changes lets the runtime skip every session whose last render did not read it. A
session displaying an invoice is not re-rendered because prices moved. `useStore`
is the call site — it returns the store unchanged and records the read — which is
what that hook existed for.

Two properties made it safe to adopt gradually. A store that announces a change
without identifying itself re-renders everything, exactly as before, so stores
can be converted one at a time. And a session whose render declared no reads at
all is treated as reading *everything*, so an app that reaches its stores
directly keeps working. The saving is visible in the `scopedSkips` metric, which
sits at zero for an app that has not opted in.

It sits at zero for every probe today, and the reason is worth stating because it
is the real remaining work rather than a missing annotation. **A read declared at
the root of a tree can never be scoped out**, and every probe reads every store it
has in its first few lines — before it decides which of them the current screen
actually shows. So the mechanism is a prerequisite for the saving and not the
saving itself; collecting it means pushing each read down to the component that
needs the data, which is an authoring change. `tech-debt.md` carries the detail.

The interaction with sharing is the constraint that matters, and it has not been
resolved so much as deferred. A shared render has no single session doing the
reading, so a `useStore` call inside a shared body cannot attribute to one. The
reads of a shared subtree attribute to every session currently mounting it, which
means the two compose as long as read sets are tracked per *render*, keyed by the
cohort, and unioned into each session's set when the subtree is attached. What
was built tracks them per session, which works today and stops working the moment
a render serves more than one — so this is a constraint on where the read set
lives when `shared()` is built, and it is recorded as such in
[`tech-debt.md`](tech-debt.md) along with the convention this rests on: scoping
matches on object identity, and declaring the wrong object makes a session go
quietly stale rather than fail.

The second mechanism is an author-declared boundary, which with component scope
is an option on the component rather than a separate wrapper with its own key:

```ts
const AccountRow = component((props: { account: Account }) => html`…`, {
  deps: (props) => [props.account.updatedAt],
});
```

When the dependencies are unchanged the previous subtree is reused by reference
and skipped entirely. The author declares the boundary; the framework never has
to discover it. As with `useGate`, the explicit cache key disappears — the
component's address is the key.

---

## 4. Make it survive production

Two categories of application cannot be built today. Both are protocol gaps
rather than design questions.

### Collections need a window

A collection is all-or-nothing: every row is rendered and shipped, and reordering
re-sends the whole thing. A long table produces a first payload measured in
hundreds of kilobytes with no upper bound.

```ts
${windowed({
  count: () => logs.count,
  rows: (from, to) => logs.slice(from, to),
  key: (row) => row.id,
  render: (row) => LogRow({ row }),
})}
```

The client scrolls and requests ranges; the server renders only what is asked
for. This *strengthens* the security property that makes the architecture
attractive for sensitive data — the browser physically cannot hold what was never
sent. It also needs real move, insert and delete operations on the wire, so
reordering costs a few bytes rather than a resend.

### Sessions need to outlive their socket

A session is a connection. It dies on disconnect, every session dies on deploy,
and anything not written to a store dies with it — a half-filled form, a
multi-step wizard, an unsaved draft. That makes a routine afternoon deployment
user-visible in a way most teams will not accept.

Shipping the component layer made this **worse**, and that is now a fact rather
than a forecast. Component state is easy to reach for, so more state is
per-session than before: converting the probes moved routes, selected ids and
disclosure flags out of app-level closures and into `useState` slots, and all of
it evaporates on a socket drop that — unlike a page reload — is invisible and not
user-initiated. If a user's route lives in a `useState`, a deploy sends everyone
to the home page. That is why the sequencing below ranks this second rather than
last: the layer that makes it urgent has already landed.

The answer is to make the tier part of the hook name:

```ts
const Checkout = component(() => {
  const accounts = useStore(stores.accounts);          // shared, durable, everyone
  const [wizard, setWizard] = useDurable("checkout",   // this user; survives deploy
                                         { step: 1, address: null });
  const [sort, setSort] = useState("name");            // this connection; may die
  …
});
```

Three lines that read differently and behave differently, at the point of use
rather than in an app-level bag of closure variables.

---

## 5. Make it testable

Because controls are addressed structurally, sending an event from a test means
naming an address and a hole index:

```ts
// Today. The 7 is the position of the event binding in the row template.
socket.send({ instanceId: "root/h1/k:line-03", hole: 7, payload: click() });
```

That is brittle in a way the equivalent client-side test is not, and a test can
silently re-aim at a different control when a template changes.

```ts
await page.find({ role: "spinbutton", name: "Quantity", within: "line-03" }).set(4);
await page.find({ role: "button", name: "Post invoice" }).click();
```

Component boundaries give this a second axis for free — `within: InvoiceLine` is
available once subtrees have names — but the accessibility-shaped resolver is the
one that matters, since it is what makes the test assert the same thing the user
sees.

---

## What it adds up to

A dispatch queue with a filter, a row menu, bulk selection, contended claims and
live shared data, written with all of the above. `component`, `useState`,
`useDurable`, `useStore`, `focusWhen` and the two-argument handler signature
are callable today; `useEcho`, `useSelection`, `pending`, `personal` and
`shared` are what remains.

```ts
export const DispatchQueue = component(() => {
  const jobs = useStore(stores.jobs);
  const [filters, setFilters] = useDurable("queue-filters", { query: "" });
  const [sort] = useState("age");
  const picked = useSelection();
  const query = useEcho(filters.query);

  const rows = jobs.matching(filters.query, sort);

  return html`
    <header>
      <input
        placeholder="Filter jobs"
        .value=${query}
        @input=${(event) => setFilters({ query: event.value })}
      />
      <span>${rows.length} of ${jobs.count} jobs</span>
    </header>

    ${QueueBody({
      rows,
      selection: picked,
      canClaim: personal((s) => s.shift.active),
    })}

    <div class="bulk-bar" ?hidden=${picked.isEmpty}>
      ${picked.count} selected
      <button @click=${pending((event) => jobs.hold(event.selection))}>
        Hold selected
      </button>
    </div>
  `;
});

const QueueBody = shared((props: {
  rows: Job[];
  selection: Selection;
  canClaim: boolean;
}) => html`
  <ul>
    ${keyed(props.rows, (job) => job.id, (job) =>
      JobRow({ job, selection: props.selection, canClaim: props.canClaim }),
    )}
  </ul>
`);

const JobRow = component((props: {
  job: Job;
  selection: Selection;
  canClaim: boolean;
}) => {
  const jobs = useStore(stores.jobs);
  const menu = useGate({
    openOn: "click",
    dismissOn: ["outside", "escape", "child-event"],
  });

  return html`
    <li>
      <input type="checkbox" @change=${props.selection.toggle(props.job.id)} />
      <span>${props.job.reference}</span>
      <span>${props.job.waitingFor}</span>

      <button
        ?disabled=${!props.canClaim}
        @click=${pending((event, s) => jobs.claim(props.job.id, s.userId), {
          label: "Claiming…",
        })}
      >
        Claim
      </button>

      <button type="button" @click=${menu.toggle}>⋯</button>
      ${menu.contains(html`
        <div role="menu">
          <button role="menuitem" @click=${() => jobs.escalate(props.job.id)}>
            Escalate
          </button>
          <button role="menuitem" @click=${() => jobs.hold(props.job.id)}>
            Put on hold
          </button>
        </div>
      `)}
    </li>
  `;
});
```

Read what is *not* there. No endpoint. No fetch. No query key, no invalidation,
no refetch. No loading flag, no error branch, no optimistic update, no rollback.
No subscription or socket handling to keep two dispatchers consistent. No
serialized data contract between two codebases. Every handler is a direct call
against authoritative state, and every value on screen is derived from that state
by a function.

`JobRow` is worth a second look, because it is where the whole scheme either
holds or does not. It sits inside a shared boundary, so its bytes are rendered
once for every dispatcher on the unfiltered queue. It still has a working per-row
menu, because `useGate` is client-owned and each browser resolves it
independently. It reaches the store through `useStore`, which is shared and
therefore costs nothing. It still has a working claim button, because the handler
takes the session at dispatch rather than capturing it at render. And it is
guaranteed not to have quietly opted out of sharing, because a `useState` in its
body would throw the first time it rendered.

The filter is the honest part: the list is rendered once per distinct filter
rather than once per dispatcher. Every dispatcher on the unfiltered queue shares
one render, and a dispatcher who types pays for their own. Nothing breaks — the
screen is correct either way — but the cost advantage is proportional to how much
of the view is genuinely the same for everybody, and that is now a decision the
author makes visibly rather than a property the framework quietly loses.

---

## Sequencing

The component boundary is done, which removes the ordering constraint that used to
dominate this list — the client-owned primitives no longer have to wait for a
surface to be built on, and none of them will be built twice.

The three protocol items that had no authoring surface have been taken, in the
order they were listed:

| | Change | Why it came here | |
| --- | --- | --- | --- |
| — | Key events and focus | Protocol-level, surface-independent, and everything interactive is inaccessible without it | **Built** |
| — | Handlers receive the session | Protocol-level, small, and all sharing work was blocked behind it | **Built** |
| — | Read-scoped invalidation | No authoring surface at all; removes the most obviously wasted work | **Built**, per session |
| — | `useDurable` | The component layer moved state into places a socket drop destroys | **Built** |

What is left, in order:

| | Change | Why it comes here |
| --- | --- | --- |
| 1 | First paint (S5) | A server-authoritative framework that cold-loads like an SPA is a non-starter. [Specified](probes/first-paint.md) |
| 2 | `useEcho` | A correctness defect, not an optimization |
| 3 | `useGate` | The largest single improvement to how the product feels |
| 4 | `pending()` | Cheapest item on the list, and reduces server load rather than adding to it |
| 5 | `useSelection` | Same mechanism as `useGate`, so nearly free once it exists |
| 6 | `shared()` | The structural cost advantage; design settled, work not small |
| 7 | Test resolver | Not user-facing, but the cost of skipping it compounds with every screen |
| 8 | Windowed collections | Sets the ceiling on how large a screen can be |

**`useDurable` has shipped.** Default is this tab: reconnect and refresh keep
the cell, a second tab has its own. `{ share: "user" }` is every tab of this
person. `listen({ durableFile })` writes the vault so a deploy keeps
in-flight work. Identity is `session.user` (string, number, or `{ id }`)
or `?user=`. The replica sends `?socklit_tab=`.

**First paint is specified, not built.** The HTTP response should be the
page; connect makes it live. That is LiveView's dead render, not React
`hydrate()`. The probe is allowed to change `listen`. See
[`probes/first-paint.md`](probes/first-paint.md).

One item on this list is still genuinely undecided. Windowed collections
need an answer to who owns scroll position, and the wire needs move, insert and
delete operations before reordering can cost less than a resend. Everything
else is specified well enough to start.

---

## What this costs, stated plainly

The component layer has already been paid for, and this is what it bought and
charged. It is on the ledger because the remaining items inherit both sides.

Charged:

- **A boundary the author has to remember.** `component()` is opt-in, and
  forgetting it puts a helper's hooks on positional slots in the parent, which
  corrupts row state inside a `keyed()` list.
- **Two rules that did not exist.** Hooks may not be called conditionally, and
  session state may not be captured from an enclosing scope.
- **A way to write the slow thing by accident.** `useState` for a disclosure is
  free in React and is a round trip here. §2 is the mitigation, which is why it
  is no longer optional.
- **A larger blast radius for a dropped socket**, in proportion to how much state
  moved into components — which is why reconnect survival is now item 2.
- **A boundary in the serializer that has to defer.** `keyed()` stores a
  `RenderOutput` per row and serialization runs the component body, which touches
  the one piece of the serializer that was already subtle.

Bought:

- **Every manual key string, deleted** — `gate(…)`, `selection(…)`, `cached(…)` —
  because component addresses already supply identity. This is the largest single
  simplification to the primitives below.
- **The `shared()` special form, deleted.** A shared region is an ordinary
  component with ordinary props, so the two-tier authoring cost sharing was
  expected to impose mostly refunds itself.
- **State lifetime visible at the call site**, where three tiers would otherwise
  be one undifferentiated bag of closure variables.
- **One class of sharing mistake made loud.** A server-owned hook in a shared body
  can throw instead of silently costing the subtree its amortization — a guard on
  a hazard the same layer introduced, so it belongs on both lists.
- **Byte-identical output**, asserted rather than assumed, which is what makes all
  of the above safe to adopt incrementally.

It does **not** give the runtime a general shareability index, and an earlier
draft claimed it did. Shareability is a property of hole values, decided by
canonicalization, and most per-session divergence arrives as props rather than
hook state. `shared()` and `personal()` remain the boundary.

Notably it also did **not** add a build step, touch the wire format, or replace
template interning with a hand-written equivalent — and none of the work below
requires any of those either.

---

## Appendix: JSX, later and optionally

Nothing above depends on the syntax, which is the point of having done it in this
order. Now that components exist, JSX is a transform with no architectural
content:
`<JobRow job={job} />` emits `JobRow({ job })`, and element syntax emits the
`html` tagged templates that already work. Every hook and every ownership rule
carries over untouched.

What it would buy at that point is a static version of the rules the runtime
enforces dynamically or not at all — a `useState` inside a `shared()` body, a
conditional hook, and closure capture of an outer session, which is the one a
runtime genuinely cannot catch — plus the familiarity that matters if the goal is
the TypeScript-ecosystem gap `prior-art.md` identifies. Both are real. Neither is
worth taking before the sharing claim is proven, because the sequencing above
delivers that claim without any of the risk of reimplementing interning.

The honest summary is that JSX is a marketing decision with a modest safety
bonus, and it can be made once there is something to market.

---

## The one thing to hold on to

Every proposal above was checked against a single test: **does it keep the
authoring model looking like ordinary UI code?**

That is why none of these introduce a client component with a prop contract, and
why the client-owned pieces are all modifiers on server-rendered content rather
than boundaries the server cannot see into. The moment an author has to serialize
data into a component, render it somewhere else, and send an action name back,
the API layer this architecture deleted has been reinvented in miniature — and
the reason to choose it in the first place is gone.

Component scope makes that test easier to pass in one respect and harder in
another. Easier, because the borrowed thing — components with props and local
state — is the part every author already knows, and the resulting code is nearly
indistinguishable from a client-side application until you notice the handlers
are touching the database. Harder, because the closer the surface looks to
React's, the more the remaining differences have to be *made* visible rather than
left implicit. That is why `useEcho` is not spelled `useState`, why `shared()`
refuses rather than warns, and why the lifetime tiers are three different words.

**Take the mental model. Do not inherit the runtime, and do not pay for the
syntax until the model has earned it.**

---

*The reasoning, the measurements and the alternatives considered and dropped are
in [`design-probes.md`](design-probes.md). The shortcuts taken to ship the items
marked built above, and what retires each one, are in
[`tech-debt.md`](tech-debt.md). The cost and latency model is in
[`economics.md`](economics.md). How this compares to LiveView, Hotwire and the
rest is in [`prior-art.md`](prior-art.md).*
