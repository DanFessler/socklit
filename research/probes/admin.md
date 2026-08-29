# Menu-heavy admin

**The result: 27 of the 30 interactions in a realistic admin task sequence are
ones an SPA makes instant and this architecture does not. Only 3 are actual
mutations.** That is 34.5 uncovered interactions per minute against the 1.5 that
[`economics.md`](../economics.md) models for Admin/CRM — a factor of twenty, and
well past the threshold of ~20 where its own decision rule says users start to
perceive an architectural difference.

The second result is worse, because it is not about speed. **A server-owned text
input silently loses characters.** Typing `grayfell` into the filter at 110 ms
per character produced `gryel` at a 150 ms round trip and `grayl` at 400 ms. The
field is correct only when the user types slower than the network.

The third result is the encouraging one. The genuinely *ephemeral* state in this
UI — every dropdown, tooltip, popover, collapsible section and dialog
visibility — collapses to **one primitive**: a client-owned boolean that gates a
subtree the server already rendered. `economics.md` finding 5 is right that the
list is bounded and app-independent. It is wrong that covering it is enough:
shipping every ephemeral primitive takes this UI from 34.5 to 20.4 uncovered
interactions per minute, which lands exactly on the threshold rather than
under it.

---

## What the probe does

An operations console over 24 account records, deliberately dense with the
interactions an admin tool is made of: three tabs, a collapsible filter panel
with a live search box, a collapsible summary with hover tooltips, a column
visibility menu, a per-row action menu, a user menu, sortable columns, a
checkbox selection column with a bulk action bar, a confirm dialog, and an edit
dialog with a server-held draft.

All of it is per-session server state built in `createApp` and published with
`session.invalidate()`, because that is the only mechanism the prototype has.
The records live in a `JsonStore` and are the only shared state.

```
npm run dev
http://localhost:5182/?probe=admin
http://localhost:5182/?probe=admin&latency=400&user=dana

npx tsx server/probes/admin/measure.ts   # every table below except the browser readouts
npx vitest run test/probes/admin.test.ts
```

`?user=` names the operator, which the audit log records and the header shows.

---

## Measurements

> **Re-baselined after two changes to the rendering core.** Template interning now
> collapses source indentation, which took the template payload from 13,729 to
> 10,489 bytes — a 24% cut to something sent once per session — and took `bytes
> in` down for the five tasks below that reach markup the session had not been
> sent before. Nothing else on the wire moved: the snapshot, the node count and
> every update carry instance addresses and hole values, not template strings.
> Separately, instance addresses are now interned and reused between renders,
> which A/Bs at roughly 2x through serialize, diff and encode from 50 rows up.
> Despite that, five runs put µs per node between 0.23 and 0.26 against the 0.21
> recorded earlier, so the figure moved the wrong way. The reconciliation is that
> this probe was converted to components in the same interval, and the boundary
> cost per component outweighs the reuse gain on a tree this component-dense —
> the same direction `roles.md` and `routes.md` report, and the opposite of
> `clock.md` and `odds.md`. Every timing column below is the median of the five
> runs.

### Connection

| measure | value |
| --- | --- |
| templates, sent once | 10,489 B across 16 templates |
| first snapshot | 17,739 B |
| nodes in the tree | 719 |
| retained bytes per session | 17,699 B |
| µs per node, first frame (cold) | 14.8 |
| µs per node, after warm-up | 0.25 |
| µs per whole-tree render + diff, after warm-up | 165 |

> The snapshot, node count and retained bytes grew by about 1% when the probe was
> converted to components, from 17,562 / 715 / 17,522, and templates grew with
> them, from 13,671 to 13,729. Whitespace normalization has since taken the
> template figure to 10,489, so the conversion's 1% is still there, underneath a
> 24% cut that has nothing to do with it. The 1% had two causes in roughly equal
> measure, and the first is the interesting one — see [the note on owning
> state](#owning-state-costs-a-boundary) below.

The warm number matters: `economics.md`'s sensitivity analysis calls µs-per-node
"the single most important number to measure once the prototype runs" and
assumes 0.8. Measured here it is **0.25 µs steady-state**, and 0.487 in a live
browser session over 79 renders. The cold first render is 60x worse, which is a
statement about JIT warm-up, not about the architecture.

Server render cost is therefore not the problem. Nothing below is CPU-bound.

### Round trips per task

Every event is one round trip; there is no batching anywhere in the protocol.

| task | round trips | bytes out | bytes in | mean bytes in / trip | server µs |
| --- | --- | --- | --- | --- | --- |
| Open a row menu and pick an item | 2 | 209 | 1,677 | 839 | 1,349 |
| Open a menu and dismiss it without choosing | 2 | 176 | 1,326 | 663 | 451 |
| Select five rows and apply a bulk action | 7 | 773 | 4,292 | 613 | 1,557 |
| Open a modal, change two fields, submit | 5 | 573 | 4,461 | 892 | 1,084 |
| Switch tabs and come back | 3 | 305 | 19,852 | 6,617 | 876 |
| Type four characters into the filter | 4 | 438 | 12,074 | 3,019 | 189 |
| Hover one tooltip | 2 | 220 | 463 | 232 | 206 |
| Re-sort the table | 1 | 93 | 15,389 | 15,389 | 74 |
| Show one more column | 3 | 298 | 5,611 | 1,870 | 335 |
| Collapse a section | 1 | 92 | 182 | 182 | 106 |

Two things stand out.

**Dismissing a menu costs a round trip.** There is no document-level event
binding, so "click outside to close" is a full-screen scrim element with a
server handler on it. Opening and closing a menu you decided against is 1,326
bytes and two waits.

**Re-sorting is 15,389 bytes for one click.** `diff.ts` compares keyed lists by
key *sequence*, so any reorder fails `sameKeys` and re-sends the entire list
value. Sorting a table is the cheapest possible client operation and the single
most expensive interaction in this probe. The same mechanism makes each search
keystroke cost ~3 KB, because filtering changes the key set.

By ownership class:

| class | interactions | mean bytes in | mean server µs | max bytes in |
| --- | --- | --- | --- | --- |
| ephemeral | 11 | 773 | 211 | 2,660 |
| render-affecting | 16 | 3,409 | 156 | 17,247 |
| application (real mutations) | 3 | 760 | 447 | 973 |

**Ephemeral interactions cost as much as mutations, and render-affecting ones
cost four times more.** Opening a menu is not cheaper than saving a record.

### How it feels under latency

Measured from the client's own readout, which times from dispatch to the moment
the patch is applied.

| interaction | 0 ms | 150 ms | 400 ms |
| --- | --- | --- | --- |
| open a row menu | 4 | 166 | 405 |
| pick a menu item (mutation) | 4 | 161 | 415 |
| tick a row checkbox | 2 | 152 | 408 |
| hover a tooltip | 2 | 156 | 409 |
| leave the tooltip | 2 | 153 | 417 |
| one keystroke in search | 3 | 161 | 410 |
| reset the filter | 3 | 156 | 417 |
| sort by a column | 2 | 163 | 415 |
| switch tab | 2 | 152 | 410 |
| switch back | 3 | 162 | 415 |

Perceived latency is the round trip, plus 2-4 ms, for everything. The 15 KB sort
and the 182-byte section collapse are indistinguishable. That is the honest
summary of the architecture's cost model: **payload size does not matter, the
number of round trips does.**

Which of these are unacceptable, plainly:

- **At 150 ms**: tooltips and the search box. A tooltip that appears 156 ms after
  the pointer lands and lingers 153 ms after it leaves reads as a rendering bug.
  The search box loses characters (below).
- **At 400 ms**: everything except the three real mutations. Menus feel broken in
  the literal sense — you click, nothing happens, you click again. A 400 ms
  delay on `pick a menu item` is fine, because an SPA hitting an API pays it too.
  A 400 ms delay on `open a menu` is not, because nothing in the world changed.
- **At any latency**: the tooltip. It is the only interaction here that a user
  performs *without deciding to*, so it converts pointer movement into network
  traffic. Two round trips per hover, over 24 rows.

Compound tasks at 400 ms, wall clock:

| task | measured |
| --- | --- |
| tick 5 rows (clicking at 120 ms intervals), until the bulk bar agrees | 906 ms |
| the same, through to the bulk action landing | 1,756 ms |

The checkboxes themselves respond instantly, because the browser toggles a
native checkbox before anyone is asked. Everything *derived* from them — the row
highlight, the count, the bulk bar existing at all — lags by a full round trip.
The operator ticks five boxes and watches a counter chase them.

### The text input actually loses data

Typing `grayfell` one character at a time, with no pause for the echo:

| round trip | typing speed | what ended up in the field | rows shown |
| --- | --- | --- | --- |
| 150 ms | 110 ms/char | `gryel` | 0 |
| 150 ms | 220 ms/char | `grayfell` | 1 |
| 400 ms | 110 ms/char | `grayl` | 0 |

The field is bound with `.value=${ui.query}` and `@input`. Each keystroke sends
the whole current value; the server stores it and echoes it back one round trip
later, by which time the user has typed more. The echo overwrites those
characters. Nothing errors, nothing retries, and the user sees a table filtered
by a string they did not type.

This is not a latency complaint. It is silent corruption of user input, and it
is the direct consequence of `.value` being a hole the server owns. The rule it
implies is unusable as a product constraint: *a server-owned text input is
correct only if the user types slower than the network.*

### Cost of a second session

| interaction | renders on the server | bytes to the other session |
| --- | --- | --- |
| one session collapses a section | 1 | 0 |
| one session flags a record | 3 | 296 |

`invalidateSession` does the right thing: ephemeral state is genuinely private
and costs nobody else anything. This is worth stating because it is the one
place the naive implementation is not wasteful — the cost of a menu is one
render for one session, not fan-out.

It also means the amortization story and the ephemeral-state story are
independent. Menus do not make fan-out worse; they make *this user's* experience
worse.

---

## The state inventory

This is the artifact the probe exists to produce. Every piece of state in the
UI, and who could own it in a design that had client primitives. It is also
asserted in `test/probes/admin.test.ts`, so new session state cannot appear
without being classified.

| state | class | what could own it | note |
| --- | --- | --- | --- |
| `openMenu` | ephemeral | disclosure | Which dropdown is open. Contents are server-rendered. |
| `hoveredTip` | ephemeral | disclosure, hover-triggered | Two round trips per hover today. |
| `collapsed` | ephemeral | disclosure | Identical to a menu once contents are always rendered. |
| modal open/closed | ephemeral | disclosure | Visibility is ephemeral; contents are not. |
| `density` | ephemeral | attribute toggle | Pure presentation, and still a round trip. |
| `toast` | ephemeral | — | Server-produced, so it arrives with the trip that caused it. |
| modal draft fields | render-affecting | text input, for fields nothing derives from | Seats drives a server-computed total. |
| `selection` | render-affecting | selection set | The bulk bar, the count and the enabled actions derive from it. |
| `tab` | render-affecting | — | Selects which subtree exists at all (S2). |
| `columns` | render-affecting | — | Decides which cells are rendered, which is I2 working as designed. |
| `sortColumn` / `sortDirection` | render-affecting | — | The client holds no list to reorder. |
| `filterStatus` / `filterPlan` / `query` | render-affecting | text input with echo suppression, for the field only | The keystroke is ephemeral; the result is a different query. |
| `accounts` / `audit` | application | — | Durable and shared. Not a differentiator. |

**The three-way split is the finding.** The taxonomy everyone reaches for is
binary — ephemeral versus application state, "the client owns mechanics, the
server owns meaning" — and it does not survive contact with a table.

The middle class is state that the *user* experiences as ephemeral and the
*server* experiences as a query parameter. Sorting a table feels exactly like
opening a menu: nothing changed, you just want to look at it differently. But
the server cannot serve the new frame without being told, because the client
does not hold the rows.

It is also the expensive class: 16 of 30 interactions, mean 3,409 bytes, and
every one of the four costliest interactions in the probe.

### Owning state costs a boundary

Converting this probe to the component layer moved exactly one row of the
inventory. `collapsed` was a `Set<string>` on the session with `isCollapsed` and
`setCollapsed` methods and two key strings, `"filters"` and `"summary"`; it is now
a `useState` in each panel, and the toggle went from

```ts
@click=${() => commit(() => ui.setCollapsed("filters", !ui.isCollapsed("filters")))}
```

to

```ts
@click=${() => setCollapsed(!collapsed)}
```

Nothing in the program names a panel any more, so a second Filters panel would
simply work where before it would have silently shared a key. That is the claim
the layer makes, and here it is true.

**It is not free, and the reason generalizes.** The property that makes components
byte-invisible — a component occupies the address the template it returns would
have had — only holds for a subtree that *already occupied a hole*. The collapsed
flag is read by a disclosure arrow and written by a disclosure button, and both
were inline markup in the parent's own template. For a component to own the state,
it has to own everything that reads and writes it, so each `<section>` had to
become its own instance: +1 instance and +2 nodes per panel, and one more segment
in the addresses beneath it, which is why each keystroke into the filter now costs
three more bytes outbound.

So **owning state and being byte-free are in tension whenever the state's readers
are inline markup.** The alternative — hold both flags as two `useState` calls in
the parent — is byte-identical and still deletes the `Set` and its methods, but it
deletes them by replacing a keyed map with two positional booleans, which needed no
components at all. The version measured here is the one that actually demonstrates
the claim.

**Component state has mount lifetime; the session `Set` had session lifetime.**
The panels live inside the accounts tab, so switching to Billing disposes their
hooks and the panels are expanded again on return. This is inherent to component
scope and the layer has no retention escape hatch. It is arguably the better
default — the old `Set` accumulated keys for sections that no longer existed — but
it is a behaviour change, and it means *where a component sits in the tree now
decides how long its state lives*, which was not previously true of anything.

**Two fields refused to move, and they are the same refusal.** `openMenu` and
`hoveredTip` both enforce an "at most one open anywhere" invariant across
unrelated subtrees: opening a row menu must close a header menu, and the scrim is
a sibling of the whole tab rendered on the condition that *something* is open. A
hook in one row cannot clear a hook in another, and a parent cannot poll its
descendants' hooks. Mutual exclusion across a tree is not expressible in component
state, which is the concrete argument for a scoped-store primitive.

---

## What it forced

### A1: uncontrolled escape

Confirmed unusable as policy, with a new symptom the todo app does not show.

The edit dialog has an uncontrolled `<textarea name="notes">` — the A1 pattern,
verbatim. It works, in the sense that typing in it is instant and no render
clobbers it. What it cannot do:

- **Be pre-filled.** There is no way to give an uncontrolled control an initial
  value and then stop owning it. The dialog shows the current note as static
  text next to an empty box, which is not what anyone wants.
- **Be read.** Empty on submit is indistinguishable from cleared, so the handler
  treats empty as "leave it alone" and the note can never be deleted. That is a
  bespoke patch invented for one field, which is exactly A1's failure mode.
- **Participate in anything derived.** The dialog shows a projected monthly
  total from the plan and seats. Those two fields therefore cannot be
  uncontrolled, which is why changing the seats field costs a round trip and
  typing the note does not. **The ownership boundary is drawn by which fields
  something else derives from**, not by any property of the fields themselves.

There is a second, quieter A1 case worth naming: `<details>`/`<summary>` and a
CSS `:hover` tooltip would both work today, cost nothing, and be invisible to
the server. Roughly half of this probe's ephemeral interactions could have been
built out of markup the browser already implements. I did not, because a menu
the server cannot close after an action is not a menu — and that is precisely
the gap A2 has to fill.

### A2: what the minimum viable set actually is

From the inventory, the closed vocabulary is short, and shorter than the
candidate list in `design-probes.md`:

1. **A gated subtree.** A client-owned boolean that controls whether a
   server-rendered subtree is present, with declared triggers (click, hover,
   focus), declared dismissal (outside click, Escape, an event from within), and
   a server-writable override so a handler can close it. This single primitive
   covers menus, dropdowns, popovers, tooltips, disclosure, accordions, modal
   visibility, and the density toggle if the runtime also permits a client-owned
   attribute value. **Five of the thirteen rows in the inventory, and 11 of the
   30 interactions, are this one thing.**
2. **A text input with echo suppression.** The server declares the binding, the
   client owns the value and the caret, and server echoes never overwrite
   characters typed after the event was sent. This does not remove the round trip
   for a search box; it removes the corruption, which is a different and more
   urgent problem.
3. **Selection.** A client-owned set of keys with a server-visible summary. It is
   in the middle class rather than the ephemeral one, and it is the strongest
   candidate for promotion because it is completely generic.

Everything else in the candidate list — scroll position, focus, drag affordance,
virtualized window — did not arise in this UI at all. Notably absent from *my*
list and present in a real admin tool: focus management, which the runtime
cannot express in any form.

**Since built.** Focus is now expressible in one direction — `focusWhen()` moves
it and `focus`/`blur` payloads report that it moved — so it belongs on the
candidate list rather than outside it.

**Testing finding 5's claim.** It says coverage "only has to span the ephemeral
interactions", which is "a bounded and largely app-independent list". Half
right:

- *Bounded and app-independent*: **yes, strongly.** One primitive covers every
  ephemeral interaction in this UI, and it is a primitive the browser already
  half-implements as `<details>`. Nothing about it is domain-specific.
- *Enough*: **no.** The arithmetic is unforgiving. 30 round trips over the
  modelled 47 seconds is 38.3 interactions per minute, of which 34.5 are
  uncovered. Ship every ephemeral primitive and 11 round trips disappear, leaving
  **20.4 uncovered interactions per minute** — the threshold, not a comfortable
  margin under it. To get to `economics.md`'s 1.5/min for Admin/CRM you would
  have to cover sorting, filtering, tab switching, column visibility and
  selection, all of which require the client to hold the rows.

The task-time estimates are the softest input here. At half the assumed pace the
figure is 17/min covered and 10/min after primitives; the ranking of the classes
does not move, and neither does the conclusion that ephemeral coverage alone
gets you to the threshold rather than past it.

**And it is not free.** If open/closed is client-owned, the menu contents must
already be on the client when the user opens it, because there is no round trip
left to fetch them with. Measured:

| measure | bytes |
| --- | --- |
| one row menu subtree | 450 |
| every row menu rendered up front, 24 rows | 10,800 |
| the whole first snapshot today | 17,739 |

Making menus instant costs a **61% larger first payload**. That is a good trade
here and would not be at 500 rows, which is the real argument for A5 and for
making the gate lazy-but-prefetched rather than simply eager.

### A2 versus A3: they are different shapes, and A2 should not be built on A3

`design-probes.md` frames this as one choice: either primitives are ordinary
islands the runtime ships, or A3 is refused so the vocabulary stays auditable.
**The framing is wrong, and this probe is what shows it.**

An island is a *subtree* boundary. It owns its DOM, receives props, and the
server stops rendering inside it. Every one of the primitives above cuts the
other way:

- The dropdown's open/closed flag is client-owned and its menu items are
  server-rendered, with server handlers on them. An island cannot express that.
  An island that owned the dropdown would need the items as props, which means
  the server serialises `[{label, action}]` into a prop, the client renders it,
  and clicking sends an action name back — reinventing the endpoint, the
  request type and the response type the project exists to delete, for a menu.
- The text input's value is client-owned and its `name`, validation state and
  error message are server-rendered siblings.
- Selection is client-owned and every consumer of it — the count, the bulk bar,
  the enabled actions — is server-rendered.

These are not components. **They are modifiers on server-rendered subtrees**, and
the right primitive shape is a new kind of *hole value*, exactly as `keyed()` is
a new kind of hole value today. `keyed()` is the precedent worth following: it
is not a component, it is a tagged value that the serializer understands and the
replica treats specially.

So the position:

- **Adopt A2 as a closed vocabulary of hole kinds, not of components.** Small,
  auditable, and it weakens I1 only in the sense that a boolean nobody can read
  is not application state. I2 is untouched, because the gated subtree is
  rendered by the server exactly as it is today.
- **Adopt A3 separately, for whole-subtree ownership**, and judge it on its own
  merits — charts, maps, editors, video. Nothing in this probe needs one.
- **Do not build A2 on A3.** Not because A3 is dangerous, but because it is the
  wrong shape for every primitive this UI needs. Building the dropdown as an
  island produces a worse dropdown *and* a prop contract to version.

The version-skew objection to a closed vocabulary ("wait for the runtime to add
it") is real and, on this evidence, small: the vocabulary is one primitive plus
two specialisations. An app that needs a primitive the runtime lacks today
mostly needs *selection over collections*, which is a protocol feature (A5), not
an escape hatch.

### Where the boundary falls inside a component

Concretely, for the row menu: the client owns whether it is open, the server
owns what is in it and what the items do, and either side can close it.

Today that is written as a server-held string compared against a per-row key,
and every state change is a round trip:

```ts
// server/probes/admin/admin-app.ts, as built
html`
  <button data-probe="menu:row"
    @click=${() => commit(() => ui.openOnly(menuOpen ? null : `row:${account.id}`))}>⋯</button>
  ${menuOpen ? rowMenu(store, ui, account, commit, run) : null}
`;
```

What I would want instead — a new hole kind, in the shape of `keyed()`:

```ts
// `gate()` returns a tagged value like keyed() does. The subtree inside it is
// rendered and shipped now; the client decides when it is present.
const menu = gate(`row-menu:${account.id}`, {
  openOn: "click",              // bound to the trigger below
  dismissOn: ["outside", "escape", "child-event"],
  // The server may still assert it. This is the piece A1 cannot do and the
  // reason `<details>` is not already the answer.
  force: ui.forceCloseMenus ? "closed" : null,
});

html`
  <div class="menu-anchor">
    <button type="button" ${menu.trigger}>⋯</button>
    ${menu.contains(html`
      <div class="menu">
        <button @click=${() => openEdit(account.id)}>Edit…</button>
        <button @click=${() => store.setStatus([account.id], "suspended", actor)}>
          Suspend
        </button>
      </div>
    `)}
  </div>
`;
```

Three properties are doing the work:

- **`menu.contains(...)` takes a server template.** The items, their labels and
  their handlers are ordinary server-rendered content with ordinary event holes.
  Nothing about I2 or I5 changes: the client still only has what the server
  rendered, and clicking `Suspend` is still a validated event into a live
  session. Only *presence* moved.
- **`dismissOn: "child-event"`** is the interesting one. Picking a menu item is
  two things at once: a client-side dismissal and a server-side mutation. Today
  they are one round trip that does both, which is why picking an item feels
  acceptable and opening the menu does not. Declaring it means the menu closes
  on the click and the mutation lands when it lands.
- **`force`** keeps the server authoritative when it needs to be. This is the
  whole difference between the primitive and A1: `<details>` is already a
  client-owned disclosure, and it is useless here because the server cannot
  close it, cannot address it, and cannot know it is open.

`menu.trigger` in attribute position is the one part that does not fit the
current vocabulary, which rejects anything but a value in a hole. Either the
trigger becomes an ordinary event hole whose handler is a client-side marker
(`@click=${menu.toggle}`, where `menu.toggle` serialises to
`{kind: "client", gate: "row-menu:acc-003", op: "toggle"}` instead of
`{kind: "event"}`), or the runtime learns attribute-position directives. **The
first is strictly better** and needs no new syntax at all: a handler that
resolves to a client-side operation rather than a server closure is a one-word
change to `serialize.ts` and nothing else in the authoring model moves.

---

## Where I hit a wall

Two limits are genuine and neither is about latency.

**The event payload vocabulary cannot express which key was pressed.**
`EventPayload` is `click | change | submit`, and `describeEvent` maps every other
DOM event to `change`. `@keydown` binds and fires, but arrives with no key, so
Escape-to-close, arrow-key menu navigation and type-ahead are all unbuildable —
not slow, unbuildable. Every menu and dialog in this probe is mouse-only and
therefore inaccessible. I did not change `shared/protocol.ts`; a `key` payload
kind is the obvious proposal, and it is a prerequisite for the dismissal
behaviour the gate primitive above declares.

**Since built.** `EventPayload` now carries `key`, with `KeyboardEvent.key` and
its modifiers, and `describeEvent` handles keydown, keyup and keypress before
the `change` fallthrough. All three interactions above are therefore
expressible; none of them is built, and the menus and dialogs in this probe are
unchanged and still mouse-only. One limit shapes what can be built on it: key
handlers bind to elements and there is no document-level or capture-phase
binding, so Escape reaches a menu only while that menu holds focus — see
`research/tech-debt.md`.

**There is no way to express focus.** After a dialog closes, focus should return
to the control that opened it; while a menu is open, focus should be inside it.
The runtime has no representation of focus in either direction, so it cannot be
requested by the server or reported by the client. Any accessible implementation
of the interactions in this probe is currently impossible.

**Since built**, in one direction. `focusWhen(active, nonce?)` sits in an
element-position hole and the client focuses that element on the render where
`active` turns true; `focus`/`blur` payloads report that focus moved without
naming where it moved to. The server still cannot read focus back, so returning
it to the control that opened a dialog works because the server chose that
control, not because it recovered where focus was.

One thing that surprised me by *not* being a wall: hover works. `@mouseenter`
and `@mouseleave` bind and fire, because the client forwards any bound DOM event
and falls through to a `change` payload. That is undocumented and looks
accidental, and it is what let me measure the tooltip case at all. Mouse events
still take that fallthrough; keyboard and focus events no longer do.

---

## What a reader should not conclude

- **Not that admin UIs cost 34.5 uncovered interactions per minute.** This one is
  built to route everything through the server on purpose. A real implementation
  would reach for `<details>` and CSS `:hover` and get several of these for free
  while giving up server control over them. The number is the ceiling for the
  naive version, which is what the probe was asked to measure.
- **Not that the wire cost matters.** It measurably does not: the 15 KB sort and
  the 182-byte collapse feel identical at every latency. Round trip count is the
  only variable that moved the experience.
- **Not that sorting inherently costs 15 KB.** That is `diff.ts` treating a
  reorder as a new list. Real move operations (A5) would make it a handful of
  bytes. At 24 rows nobody notices; the probe says nothing about 500.
- **Not that the modelled task times are measurements.** They are my estimates of
  how long an operator spends per task, and they are the only soft input in the
  interactions-per-minute figure. The class breakdown and the round trip counts
  are exact.
- **Not that the third state class is universal.** It is large here because this
  is a table. A form-heavy admin screen with no grid would have far less
  render-affecting state and would sit much closer to `economics.md`'s numbers.
