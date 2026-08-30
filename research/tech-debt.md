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

**What was built.** `starter/` is a per-tab `useState` counter.
`listen({ subscribe })` + `createJsonStore` lives only as a one-file
example in `getting-started.md`.

**Why it is safe today.** This is an experiment branch. The lab still
boots the todo probe.

**What makes it wrong.** A first user whose second tab does not match,
because they never found the store split across `app.ts` / `server.ts`.

**What retires it.** Put a tiny shared list in the starter. Keep the
counter as a comment pointing at `useState` = this tab.

### Rejected submits wipe the form, and native validation can skip the handler

**What was built.** The replica paints the template. Unbound inputs keep
their DOM value across a render (the todo add field). An input with
`value="1"` snaps back. `@submit` never fires if the browser’s
`required` / `min` blocks the submit.

**Why it is safe today.** The fridge builder worked around it with
`useState` flash messages and discovered the snap by using `value=`.

**What makes it wrong.** Any form that validates on the server after the
user has typed more than one field.

**What retires it.** Document the unbound-input rule in getting-started.
Decide whether rejected submits need a public draft helper, or whether
“do not put `value=` on fields you want to keep” is the product. Say
that `@submit` does not run when native constraint validation fails.

### `mutate`’s `result` is cargo-culted

**What was built.** `mutate` returns `{ next, result }`. The getting-
started example always uses `result: undefined`.

**Why it is safe today.** Ignoring `result` is correct for fire-and-forget
handlers.

**What retires it.** One sentence: `result` is the Promise value for the
caller (`await store.mutate(…)`), not something the replica reads.

### An app that installs React gets two copies of it

**What was built.** The replica mounts islands with `react-dom`. The
getting-started island path says `npm install react react-dom`. The
starter depends on `socklit` via `file:`, so Vite resolves the host’s
React from the package and the island’s React from the app.

**Why it is safe today.** The lab client registers islands inside the
same package as the host. First-user apps do not.

**What makes it wrong.** The first `<mount>` is an invalid hook call.
The page stays “connected.” The row still shows. The widget does not
paint. A first user who followed the manual exactly hits this.

**What retires it.** `react` / `react-dom` as peers of `socklit`, and
the starter Vite config already `resolve.dedupe`s them. Put that next
to the `npm install` snippet. A one-file example island would have
caught this in the template instead of in anger.

---

*Design rationale for all of the above is in [`proposal.md`](proposal.md).
Measurements are in [`design-probes.md`](design-probes.md) and the per-probe
documents under [`probes/`](probes/).*
