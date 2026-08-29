# Route divergence

**Session-level render sharing is worth nothing, and the number is exactly zero
rather than approximately zero.** One per-user string in the corner of the shell
takes the measured amortization ratio to 1.00x at every population size tested —
2, 4, 8 and 16 sessions on the same route, same data, same everything else.
Delete that one hole and the ratio is exactly N. There is no middle ground at
session granularity, because a personalized value makes every one of its
ancestors unshareable, and the corner of the shell is a child of the root.

At subtree granularity the same population still shares **91.3% of its nodes and
85.9% of its bytes**. So the answer to S1 is not "sharing does not work" but
"sharing works, and the unit has to be the subtree." That is the protocol change
S1 anticipated, and this probe adds one requirement it does not mention: the
largest shareable subtree is not handler-free. On the tasks route it is 77.5% of
the tree, 2,959 bytes, and **18 event handlers**, which are byte-identical on the
wire and necessarily distinct closures per session.

For S2, a route change is already a subtree swap and should stay one. Making the
shell per-route instead costs 39% more bytes on a first visit, 32% more on a
revisit, four extra templates, and buys nothing.

---

## What the probe does

A five-route console — dashboard, tasks, detail, settings, profile — over one
shared workspace store of 18 tasks, 6 metrics, 8 activity entries and 6 toggles.

The route is per-session state, so navigation is a server-owned route change and
two tabs of the same user sit on different routes without interfering. Content is
deliberately sorted into three kinds:

| Kind | Where | Example |
| --- | --- | --- |
| Shared | the store | task list, metrics, footer counts |
| Per-session | `useState` on the root component | current route, active nav highlight |
| Per-user | `session.params` | the name in the corner, the profile body |

> Originally the route lived in a mutable bag in `createApp` and was published by
> calling `session.invalidate()` by hand. Converting the probe to components moved
> it into two `useState` slots and deleted the bag, the action table around it, the
> hand-written dirty checks and every `invalidate()` call. Every measurement below
> was re-run afterwards and is unchanged to the byte. What the conversion did *not*
> change is where the state sits: both fields are read in one subtree and written
> in another, so they still belong at the root and their setters are still threaded
> down as props.

> Two later changes to the rendering core moved figures here. Template static
> strings are now normalized when a template is first interned — each run of a
> newline and its following indentation collapses to a single space — which cut
> template bytes on the wire by about a quarter. The template-byte figures below
> are lower for that reason and for no other, as are the first-visit totals that
> include them; snapshots, operations, boundary sizes and repeat visits carry hole
> values and instance addresses rather than template text, and came back
> unchanged to the byte. Separately, instance addresses are now reused across
> renders instead of rebuilt by concatenation, which touches only the timing
> figures under *Runtime metrics*. The warm-phase cost per node re-measures
> **higher** than the 0.52 µs it replaced, at 0.67–0.74. That is not address
> reuse failing — measured against a control that genuinely rebuilds, reuse is
> worth about 2x through serialize, diff and encode. It is that this probe was
> also converted to components between the two measurements, and a deeply nested
> route tree pays a component boundary at many of its levels. The boundary cost
> exceeds the reuse gain here; in the flatter, component-sparse trees of
> `clock.md` and `odds.md` it does not, and those figures fell.

Per-tab configuration, all through the query string:

```
?probe=routes&user=alice              the name in the corner
?probe=routes&route=tasks             seeds the initial route
?probe=routes&personalize=0           replaces the corner with a constant
?probe=routes&shell=split             one root template per route
?probe=routes&task=task-04            seeds the detail route's selection
```

### Running it

```bash
npm run dev
# http://localhost:5173/?probe=routes&user=alice&latency=400

npx tsx scripts/routes-measure.ts
npx tsx scripts/routes-measure.ts --json research/probes/routes-measurements.json
npx vitest run test/probes/routes.test.ts
```

The measurement rig starts its own protocol server on an ephemeral port and
connects real WebSocket sessions to it, so it needs no dev server and leaves
nothing running. The analysis is in `server/probes/routes/measure.ts` and the
driver in `harness.ts`, so both are typechecked and exercised by the tests;
`scripts/routes-measure.ts` only prints. Raw output is in
[`routes-measurements.json`](routes-measurements.json).

### How "shareable" is defined

Two definitions, because they give different answers and the difference is the
finding.

- **Node identity** — a node's own template id and hole values match across
  sessions, with children referenced by address. Event holes serialize as
  `{"kind":"event"}` in every session, so they always match.
- **Subtree identity** — the node's entire serialized subtree matches byte for
  byte. This is what A6 would actually have to share, since a shared subtree is
  sent and patched as one unit.

A **boundary** is a maximal identical subtree: identical in every session of the
group, with a parent that is not. Boundaries are where a shared/per-session
splice would have to happen.

---

## Measurements

### One route, four distinct users

Every session reads the same store and renders the same view. The only
difference is the name in the corner.

| route | personalized | whole tree | node identity | subtree identity | shared bytes | distinct trees |
| --- | --- | --- | --- | --- | --- | --- |
| dashboard | on | differs | 95.7% | 91.3% | 85.9% | 4 of 4 |
| dashboard | off | **identical** | 100% | 100% | 100% | **1 of 4** |
| tasks | on | differs | 96.3% | 92.6% | 90.6% | 4 of 4 |
| tasks | off | identical | 100% | 100% | 100% | 1 of 4 |
| detail | on | differs | 94.1% | 88.2% | 83.2% | 4 of 4 |
| detail | off | identical | 100% | 100% | 100% | 1 of 4 |
| settings | on | differs | 93.3% | 86.7% | 79.0% | 4 of 4 |
| settings | off | identical | 100% | 100% | 100% | 1 of 4 |
| profile | on | differs | 25.9% | 22.2% | 29.9% | 4 of 4 |
| profile | off | differs | 29.6% | 25.9% | 43.6% | 4 of 4 |

The profile route is per-user by construction — its body filters tasks by owner —
so `personalize=0` does not save it. Four of five routes are perfectly shareable
with the corner removed and perfectly unshareable with it present.

### The effect of one personalized element

`design-probes.md` predicts that one personalized element collapses session-level
sharing entirely. **Confirmed, and the collapse is total and population-independent.**

| sessions on dashboard | personalized | whole tree | node identity | subtree identity | shared bytes | amortization |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | on | differs | 95.7% | 91.3% | 85.8% | **1.00x** |
| 4 | on | differs | 95.7% | 91.3% | 85.8% | **1.00x** |
| 8 | on | differs | 95.7% | 91.3% | 85.8% | **1.00x** |
| 16 | on | differs | 95.7% | 91.3% | 85.8% | **1.00x** |
| 2 | off | identical | 100% | 100% | 100% | 2.00x |
| 4 | off | identical | 100% | 100% | 100% | 4.00x |
| 8 | off | identical | 100% | 100% | 100% | 8.00x |
| 16 | off | identical | 100% | 100% | 100% | 16.00x |

Two things are worth reading off this table. The fractions are flat in
population: the shareable fraction is a property of the content, not of how many
people are looking. And the cost of that one hole is 2 nodes out of 23 — 360
bytes of 2,554 — yet it removes 100% of the session-level benefit, because the
2 nodes are the root and the header, the entire ancestor chain of the name.

### The shareable fraction as sessions spread over routes

A fixed population of 12, cycling over four workspace users, spread in blocks
over the first N routes.

| routes | sessions/route | personalized | distinct trees | amortization | node identity | shared bytes | node-level dedup | node-level amortization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 12 | on | 4 | 3.00x | 95.7% | 85.9% | 90.6% | 10.62x |
| 2 | 6 | on | 8 | 1.50x | 12.2% | 10.0% | 84.3% | 6.38x |
| 3 | 4 | on | 12 | 1.00x | 8.2% | 8.1% | 78.7% | 4.70x |
| 4 | 3 | on | 12 | 1.00x | 5.5% | 5.4% | 73.6% | 3.79x |
| 5 | 2.4 | on | 12 | **1.00x** | 3.2% | 2.1% | 67.0% | **3.03x** |
| 1 | 12 | off | 1 | 12.00x | 100% | 100% | 91.7% | 12.00x |
| 2 | 6 | off | 2 | 6.00x | 14.6% | 10.0% | 85.3% | 6.82x |
| 3 | 4 | off | 3 | 4.00x | 10.2% | 8.1% | 79.8% | 4.96x |
| 4 | 3 | off | 4 | 3.00x | 7.3% | 5.4% | 74.8% | 3.97x |
| 5 | 2.4 | off | 6 | 2.00x | 4.8% | 2.1% | 68.3% | 3.15x |

The single-route rows are the interesting ones. With 12 sessions on one route and
only four distinct users, session-level sharing still gets 3.00x, because three
sessions happen to coincide on *both* route and user — which is the honest
statement of what session sharing requires. The ratio is
`sessions / (routes x users)`, so with 12 sessions it is 2.40x at five users and,
as the table above shows directly, 1.00x once every session has a distinct name.

Note also that turning personalization off with five routes gives 6 distinct
trees rather than 5. The profile route stays per-user regardless.

The last two columns are the same population measured at node granularity. At
five routes, session sharing is worth 1.00x and node sharing is worth 3.03x on
identical data. That gap is the entire argument for A6.

### Where the shareable boundary falls

Maximal identical subtrees, with the number of event handlers each contains.

**Four sessions on `tasks`, distinct users, personalized** — 90.6% of 3,817 bytes
shareable:

| address | depth | nodes | bytes | handlers |
| --- | --- | --- | --- | --- |
| `root/h1` (the route body) | 1 | 19 | 2,959 | **18** |
| `root/h0/h0/k:dashboard` | 2 | 1 | 94 | 1 |
| `root/h0/h0/k:settings` | 2 | 1 | 92 | 1 |
| `root/h0/h0/k:profile` | 2 | 1 | 90 | 1 |
| `root/h0/h0/k:detail` | 2 | 1 | 88 | 1 |
| `root/h0/h0/k:tasks` | 2 | 1 | 85 | 1 |
| `root/h2` (the footer) | 1 | 1 | 49 | 0 |

Not shareable: `root` and `root/h0`, the header that holds the name.

**Two tabs, same user, different routes** — the contrivance `design-probes.md`
names — 10.0% of 3,187 bytes shareable: three inactive nav links (270 B) and the
footer (49 B). The active nav link differs in both sessions because each has a
different `aria-current`; the body differs entirely.

**Five sessions, one per route** — 2.0% shareable, a single subtree: the footer.
With all five routes represented, *every* nav link is active in exactly one
session, so even the nav bar shares nothing.

So the boundary is at depth 1 and 2, and its shape is: the route body if the
route matches, each nav link that is inactive in every session, and the footer.
Nothing at depth 0 is ever shareable once anything is personalized.

### What a route change costs

Seven navigations from a cold session, in both shell shapes. `fused` is one shell
template with the body in a hole; `split` is one root template per route, which
is what `route === "x" ? html`...` : html`...`` produces at the top level.

| | fused | split |
| --- | --- | --- |
| templates on connect | 7 (1,033 B) | 7 (1,059 B) |
| snapshot on connect | 2,595 B | 2,596 B |
| operations per route change | **3 `set`** | **1 `replace`** |
| whole-tree replace | no | yes |
| four first visits | 8,399 B | 11,647 B (+39%) |
| three repeat visits | 6,409 B | 8,449 B (+32%) |
| templates cached after the tour | 14 | 18 |

In `fused` mode a route change is three `set` operations: one on `root` hole 1
carrying the new body subtree, and one on each of the two nav links whose active
flag changed. The shell itself — 8 nodes, about 860 bytes of nav and footer — is
never re-sent. First visit to a route ships 1–2 templates; a revisit ships none,
confirmed by test.

The irreducible part is the new body. A repeat visit from dashboard to tasks is
3,248 bytes for three operations, of which 2,959 bytes is the tasks body
subtree — 91% of the frame. There is no version of a route change that avoids
sending the content of the route you navigated to.

`split` mode is strictly worse. `diff` only emits `replace` for the root, so a
changed root template means the whole tree crosses the wire, including the shell
that was already there, and each route's shell is a template the browser has
never seen. Repeat visits stay 32% more expensive forever, because the shell is
re-serialized inside every replace.

### How a route change feels

Measured from the client's own readout at `?latency=400`, jitter off, reading
`last action felt N ms` after clicking each nav link:

| navigation | fused | split |
| --- | --- | --- |
| dashboard → tasks (first) | 407 ms | 407 ms |
| tasks → detail (first) | 407 ms | 408 ms |
| detail → settings (first) | 406 ms | 406 ms |
| settings → profile (first) | 406 ms | 407 ms |
| profile → dashboard (repeat) | 402 ms | 406 ms |
| dashboard → tasks (repeat) | 407 ms | 405 ms |

Every navigation costs the full round trip and nothing else: 402–408 ms against a
simulated 400 ms, so server-side render, serialize, diff and the extra kilobytes
are together worth under 8 ms. The byte difference between the two shell shapes
is invisible in time at this scale.

What that means for the experience is unambiguous and not flattering. Navigation
is the most frequent discrete interaction in an application, and under server
authority there is no such thing as a fast one. The old shell stays on screen and
stays clickable, but for a full round trip nothing acknowledges the click: the
active-link highlight does not move, no loading state appears, and the address bar
never changes at all. A client-side router moves the highlight on the same frame
as the click and streams the body behind it. Nothing in the current vocabulary can
do that, because the highlight is part of the same render as the body and both
live on the server.

### Runtime metrics

| | sharing phase | navigation phase | hosted `/metrics` |
| --- | --- | --- | --- |
| renders | 246 | 16 | 16 |
| nodes | 23,216 | 1,542 | 1,643 |
| µs per node, render + serialize + diff | **0.67–0.74** | 0.84–1.45 | 1.33 |
| retained tree bytes per session | 2,852 | 2,555 | 2,555 |
| average nodes per render | 94.4 | 96.4 | 102.7 |

The ranges are across repeated runs, and the spread is warm-up: the phases with 16
renders are dominated by first renders and template interning, the one with 246 is
not. `economics.md` assumes 0.8 µs per node and its sensitivity analysis says
5 µs would move the fan-out crossover past any real audience. At about 0.7 µs
measured on a warm path — inside the assumption rather than outside it —
**render cost is not what moves the crossover.** The amortization ratio is, and
this probe measures that ratio at 1.00x.

Retained bytes per session is 2.6 KB for a ~100-node view, against
`economics.md`'s 220 KB for a 600-node view. That is the serialized tree only —
`JSON.stringify().length` of the committed root — so it is a lower bound on heap,
not a contradiction of the assumption. Handler closures, the template registry
and socket buffers are not in it.

---

## What it forced

### S1: the unit of replication and amortization

**The unit must be the subtree. Session-level sharing should not be built.**

The evidence is that session-level sharing is not merely reduced by
personalization, it is eliminated: 1.00x at every population size, from one
string. Any product with a signed-in user has that string. Meanwhile subtree
sharing recovers 85.9–90.6% of bytes for same-route sessions, so the capability
is real and it is simply at the wrong granularity today.

**What this does to finding 3.** `economics.md` finding 3 puts `sdui_amort` at
2.55 cores against `rt_spa`'s 7.30 at fan-out 2000 — a 0.35x win, and the only
structural advantage the architecture has. That figure assumes sessions render
identical content. Scaling the fan-out-dependent part of the published `sdui`
figures by the measured residual per-session work (8.7% of nodes, for sessions on
the same route with one personalized element):

| fan-out | rt_spa | sdui | sdui_amort as modelled | with the measured 8.7% residual | ratio to rt_spa |
| --- | --- | --- | --- | --- | --- |
| 500 | 2.98 | 18.47 | 2.51 | ~3.9 | 1.30x |
| 1000 | 4.42 | 34.49 | 2.52 | ~5.3 | 1.19x |
| 2000 | 7.30 | 66.51 | 2.55 | ~8.1 | **1.10x** |

The 0.35x win becomes a 1.10x loss. The crossover does not vanish — the residual
slope is slightly below `rt_spa`'s, so they converge — but it moves from ~500 to
somewhere past 2,000. A linear extrapolation of the published rows puts it near
10,000, which should be checked by re-running `cost_model.py` with a residual
term rather than trusted from here. Either way the honest summary is that
**finding 3's crossover is off by more than an order of magnitude once
personalization is priced, and the fix is a protocol change rather than a
constant.**

The corollary is a constraint on app authors, not just on the runtime.
Personalization has to live at the leaves. Anything per-user rendered above a
shared subtree makes the whole ancestor chain per-session, and in this probe that
was enough to take an otherwise perfectly shareable dashboard to zero. That is
the same shape as the amortization-versus-authorization collision, and it
generalizes: the denominator is `distinct_views x distinct_personalization_classes`,
where a per-user name is a personalization class per user.

**Four requirements A6 would have to satisfy**, in order of how much they change
the protocol:

1. **A hole value that names a shared instance.** Something like
   `{"kind":"shared","sharedId":"tasks-body","revision":7}`, so the client can
   splice an independently versioned stream into a per-session tree. This is the
   splice S1 anticipates.
2. **Addresses relative to the shared root.** Instance ids are derived from a
   single per-session root path, so `root/h1/h2/k:task-01` is only meaningful in
   a session whose body sits at `root/h1`. A shared subtree needs its own address
   space, `tasks-body/h2/k:task-01`, resolved to a session at splice time.
3. **A per-session handler table for a shared render.** This is the requirement
   S1 does not list, and the measurement makes it concrete: the largest shareable
   subtree on the tasks route contains **18 event handlers**. They are
   byte-identical on the wire — `serialize` replaces every closure with
   `{"kind":"event"}` and keeps the closure in a side table — but the closures
   are not shareable, because `open(taskId)` mutates *this* session's route and
   calls *this* session's `invalidate`. So a shared render gives you the wire
   form for free and gives you nothing for the handler table, and if a session
   re-runs the app function to rebuild its handlers, the CPU saving A6 exists for
   is gone. The way out is that handlers inside a shared subtree must be
   `(session, payload) => …` rather than closures over session state, resolved
   against the acting session at dispatch. That is an authoring rule A6 has to
   impose and enforce, and it is a second-order weakening of the "write it like
   local UI code" thesis.

   **Since built**, with the arguments the other way round: a handler is
   `(payload, session) => …`, and the runtime calls it with the session that sent
   the event rather than the one the tree was rendered for. So the requirement is
   met at the protocol level, and the authoring rule stands exactly as stated —
   every handler in this probe still captures its session, and a handler that
   captures is still unshareable. Requirements 1, 2 and 4 are unbuilt, and so is
   sharing.
4. **Ordering between the two streams.** A per-session frame that repoints a hole
   at shared subtree S can race a patch for S. The per-session frame has to carry
   the shared revision it assumes, and the client has to buffer shared patches
   below it. The existing revision counter is per session and cannot express
   this.

Requirement 3 is the one that would change my recommendation if it turned out to
be unworkable. Requirements 1, 2 and 4 are wire format and bookkeeping.

### S2: where navigation lives

**A route change should be a subtree swap with a stable shell, and the runtime
already does this correctly. The open question in S2 turns out to be an authoring
question rather than a protocol one.**

If the shell is one template with the body in a hole, `diff` emits a `set` on
that hole and the shell is untouched: I3's template-cache benefit is fully
preserved at exactly the moment the user is waiting. If the shell is chosen per
route, `diff` has no per-subtree replace operation — `replace` is only ever
emitted for the root — so the whole tree crosses the wire and each shell is a new
template. Measured: +39% bytes on first visits, +32% on revisits, four extra
templates, no perceptible latency difference.

Nothing needs to be added to the protocol for this. What is needed is a stated
authoring rule — *one root template, route bodies in a hole* — because the naive
top-level ternary silently costs a third more bytes forever and there is nothing
in the runtime that warns about it. The framework could plausibly enforce it by
making the route body a first-class concept.

The second half of S2 is that navigation partitions the amortization space, and
that is confirmed harshly. Two tabs on different routes share 10.0% of bytes;
five sessions covering five routes share 2.0%, a single subtree, the footer. Even
the nav bar is unshareable across a population that covers every route, because
the active-link highlight is per-session and lives in the same keyed list as the
links. So sharing has to be *within* a route, and the practical denominator for
any amortization estimate is the number of distinct routes in the population, not
the number of distinct "views" in the product.

---

## Where I hit a wall

**Server-owned routing has no history integration, and it cannot get one without
editing `client/**`.** The route is genuinely server state — deep links work
through `?route=tasks`, and two tabs hold different routes correctly — but the
browser's address bar never changes when you navigate, so back and forward do
nothing and a refresh returns to whatever the query string said. That is
`S2`'s "the server owns history" claim failing in the most basic way.

Fixing it needs a client primitive, not application code: the server declares the
current route as part of its render, and the client mechanically syncs it to
`history.pushState`, forwarding `popstate` back as an event. That is exactly the
shape of an A2 primitive — the server owns meaning, the client owns the
mechanics — and it belongs on the candidate list in A2 alongside text input and
disclosure state, where it currently is not. I did not implement it, because it
requires `client/runtime.ts` and `client/main.ts`.

**Two smaller notes.**

`scripts/` is outside the `include` list in `tsconfig.json`, so anything there is
not typechecked by `npm run typecheck`. I worked around it by putting all of the
analysis and driver code under `server/probes/routes/` and leaving the script as
a six-line printer, which is probably the right pattern for other probes too, but
the gap is worth knowing about.

The measurement compares nodes by absolute address, which is **optimistic**. Two
sessions' bodies match partly because both mount at `root/h1`. If one route
rendered its body at a different hole, or a shared subtree appeared at two
different depths, nothing would match even though the content is identical. The
real shareable fraction under an address scheme that is not relative would be
lower than reported here; under a relative one, potentially higher.

---

## What a reader should not conclude

- **That 85.9% is the shareable fraction of a real application.** This probe's
  bodies read only from a shared store, so four of five routes are perfectly
  shareable by construction once the corner is removed. A real app has unread
  badges, per-user sort orders, permission-filtered columns and draft state, each
  of which adds an unshareable hole, and each of which is unshareable at whatever
  depth it appears. The direction of the finding is robust; the magnitude is the
  best case.
- **That the route change byte figures generalize.** The tree is ~100 nodes and
  2.6 KB. A real route body is larger, which makes the "you must send the new
  body" cost bigger in absolute terms and makes the fused-versus-split ratio
  smaller, since the duplicated shell is a fixed overhead.
- **That the extrapolated crossover of ~10,000 is a measurement.** It is a
  linear extrapolation of three published rows of someone else's model, scaled by
  one measured residual. The measured parts are the 8.7% residual and the 1.00x
  ratio. Re-running `cost_model.py` with a residual term is the way to get a real
  number, and it may well move again.
- **That personalization is the only thing that breaks sharing.** It is the
  cheapest thing that breaks it. Route divergence breaks it harder — 2.0% shared
  across five routes against 85.9% within one — and this probe deliberately holds
  permissions constant, which the permission-filtered console probe does not.
- **That 0.7 µs per node is a production number.** It is one process, one
  machine, small trees that fit in cache, no GC pressure, and no concurrent load
  beyond the probe itself.
- **That the split shell is a straw man.** It is what a top-level ternary
  produces, which is the first thing most authors write. Its 32% permanent
  overhead is the argument for stating the rule, not evidence that anyone is
  careless.
