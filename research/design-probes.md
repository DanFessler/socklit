# Design probes

A set of contrived applications chosen to force architectural decisions, and a
register of the decisions they force.

> **Looking for the conclusions rather than the working?**
> [`proposal.md`](proposal.md) is the executive summary of what this document
> settled: the proposed changes, in dependency order, with sketches of the
> authoring API each one implies, and no reference to any of the experiments
> below.

These are instruments, not demos. The [todo app](../README.md) answers one
question — does authoring feel like local UI code — and
[`economics.md`](economics.md) answers where the architecture is affordable. What
neither answers is the harder set: **which constraints do we hold as invariants,
and which affordances do we admit?** Every probe below exists because it makes
one of those decisions unavoidable.

The probes are deliberately unrealistic. A probe is good when it isolates a
single unresolved question and produces an answer that a plausible, balanced app
would blur.

**Several questions below are only open for us.** Phoenix LiveView has shipped
answers to S2 (navigation as server state, via `push_patch` and
`handle_params`), S3 and A2/A3 (client primitives, via hooks), A5 (windowed
collections, via streams), and the reconnect half of A8 (automatic form
recovery). Those are not reasons to skip the probes, but a probe designed
without knowing what LiveView concluded is wasted work. See
[`prior-art.md`](prior-art.md#phoenix-liveview).

---

## Results

Six probes are built, measured and written up: [ticking clock](probes/clock.md),
[route divergence](probes/routes.md), [menu-heavy admin](probes/admin.md),
[ledger](probes/ledger.md), [odds board](probes/odds.md), and
[permission-filtered console](probes/roles.md). Each carries its own findings
document with methodology and caveats. This section records what they settled.

| Question | Verdict | Evidence |
| --- | --- | --- |
| **S1** unit of replication | **Resolved: the subtree.** Session-level sharing is worth exactly nothing | routes, odds, roles |
| **S2** where navigation lives | **Resolved: subtree swap with a stable shell**, which the runtime already does | routes |
| **S3** granularity of invalidation | **Resolved: do not build dependency tracking.** Two narrower mechanisms instead | clock, ledger |
| **S4** what is a session | **Still open.** No probe built; needs the checkout wizard | — |
| **S5** initial state and first paint | **New, unprobed.** No probe needed it because none served a visitor without a socket | — |
| **A1** uncontrolled escape | **Confirmed unusable as policy**, with three new failure modes | admin |
| **A2** client primitives | **Adopt.** The minimum set is one primitive, and it is necessary but not sufficient | admin, ledger |
| **A3** open islands | **Adopt separately, and do not build A2 on it.** Authoring prototype on this branch | admin, islands |
| **A4** declarative prediction | **Close it unbuilt.** Reachable coverage is 20%, not 80%, and A2 plus A9 cover it | ledger, odds |
| **A5** windowed collections | **Promoted.** Now the binding constraint in two probes rather than a future concern | ledger, admin |
| **A6** shared subtree rendering | **Build, per-subtree from the start.** The blocker was the handler signature, which has since been changed | odds, routes, roles |
| **A7** delta mutations | **Still refused.** No probe challenged it | — |
| **A8** durable sessions | **Still open.** Same gap as S4 | — |
| **A9** acknowledgment affordances | **New entry, and it displaces A4.** Legal everywhere prediction is not; [probe specified](#specified-but-not-built-the-claim-queue) | routes, odds |

Four results cut across the whole suite.

**The cost premise was too pessimistic, and CPU is not the binding constraint
anywhere.** Render plus diff was assumed at 0.8 µs per node, and
`economics.md`'s own sensitivity analysis called it the single most important
number to measure. Five probes measured it independently and none came close to
the assumption: **0.050 µs** (roles, flat string-heavy tree), **0.055 µs**
(clock), **0.083 µs** (odds), **0.2 µs** (ledger, dense arithmetic), **0.7 µs**
(routes, deep nesting). The spread is explained by tree density and application
work per node — a fourteenfold range across probes on one machine, which says the
application dominates the runtime — and the assumption was never approached. Every
CPU projection in `economics.md` is therefore between 1.1x and 16x too expensive. What replaces CPU as the constraint is **egress** — the odds
board saturates a gigabit link three times over before its CPU reaches half a
core — and **round trip count**, which is the admin probe's entire story.

**Session-level render sharing is worth exactly zero, and the blocker is not the
one this document predicted.** S1 argued sharing is "close to worthless" at
session granularity; measured, it is precisely worthless. One per-user string in
the corner of a shell takes the amortization ratio to **1.00x** at every
population size (routes); one non-privileged `Opened by ${viewer.name}` span
drops node amortization from 52.0x to **3.6x** (roles); a board with a name in
the corner scores zero at whole-tree granularity while keeping 97.5% of nodes at
subtree granularity (odds). At subtree granularity the same populations share
**85.9–91.3%** of bytes. So sharing works and the unit has to be the subtree,
exactly as S1 anticipated — but the thing standing in the way is not addressing.
Instance ids are derived from structural position and are **already identical
across sessions**: every canonical subtree in the roles probe sat at exactly one
address, and under `mine=1` the odds board diverged at exactly two. Three probes
converged independently on the real blocker: **event handlers close over session
state**, and the handler-bearing region is 77.5% of the shareable tree in both
odds and routes. A6 was therefore downstream of changing the handler signature to
receive the acting session, and that change has since been made — the blocker is
gone and the amortization it was holding back is still unclaimed.

One caveat governs how all of those figures should be read: they measure sharing
of *byte-identical* subtrees, which is the naive strategy. Sharing template
instances with per-session hole bindings is a different and far better one, and the
gap between the two is the central design decision under A6.

**Personalization, not authorization, is what fragments sharing — and the
distinction is about placement, not sensitivity.** The collision section below
predicted that permission-filtered UI would collapse amortization per distinct
permission set. Measured, authorization is nearly free: gating every sensitive
field individually costs 21% of available sharing against coarse subtree gating,
and role diversity *saturates* — one role gives 100.3x, five give 52.0x, and the
sixth costs nothing, because the number of distinct grant tuples is bounded by
the permission model rather than by the population. What actually destroys
sharing is any viewer-dependent value in a shared subtree, whether or not it is
sensitive. An audit stamp, a greeting and a national identifier are identical in
cost. This confirms the `sharing_model.py` correction empirically and retires the
authorization framing.

**Two probes falsified the rationale that commissioned them, which is the best
evidence the exercise was worth running.** Ledger was listed here as "the
strongest argument for S3, because *one edit invalidates every total* is the case
dependency tracking has to handle." It is the opposite: when the dependency graph
is dense, a correct tracker concludes everything must be recomputed and has paid
to reach a conclusion the render-everything-then-diff pipeline reaches for free.
S3's motivating example belongs on the clock, where the graph is sparse and the
tree is large. And the permission-filtered console was commissioned to measure
authorization fragmenting amortization; it measured authorization being cheap and
personalization being catastrophic.

---

## How a probe is chosen

Three axes select probes. The first two come from the decision rule in
[`economics.md`](economics.md#a-decision-rule); the third is a corollary of its
interaction taxonomy.

| Axis | Meaning | Probe is interesting when |
| --- | --- | --- |
| **Uncovered interactions/min** | Interactions instant in an SPA but not under server authority | Near 0, or far above the ~20 threshold |
| **Personal share of the shared subtree** | Fraction of the re-rendered region that differs per session | Near 0, or above the ~8% break-even |
| **Prediction legality** | Whether a client is *allowed* to guess a mutation's outcome | Prediction is impossible, or mandatory |

The third axis is worth stating explicitly because it bounds the only inherent
advantage a client architecture has. The SPA-only edge in `economics.md` assumes
the client may render a guess and reconcile later. In domains built on contention
or authority — auctions, seat booking, inventory, payments, permissions, claiming
a ticket from a shared queue — guessing is not a flicker but a false statement
about a contended resource. Where prediction is illegal, that edge is zero by
construction rather than merely small.

**Corrected: that last sentence is wrong, and the error matters.** Prediction
being illegal does not take the client's edge to zero, because a client app gets
two distinct things from running code on click and only one of them is a
prediction:

- **Acknowledgment** — visible evidence the input was received and work is in
  flight. It asserts nothing about the outcome, so it is **legal everywhere**,
  including in an auction. A venue may honestly say "your take is being placed"
  at the moment of the click while being forbidden to say "you bought 40 at
  1.74".
- **Prediction** — a claim about what the outcome will be. Illegal wherever the
  outcome depends on contended state the client cannot see.

Where prediction is illegal the SPA's remaining edge is the acknowledgment, and
that edge is currently **entirely unclaimed** by this architecture — the routes
probe measured it as nothing moving at all for a full round trip. So the third
axis bounds how much of the gap A4 can close, not how much gap there is. The
acknowledgment half is A9, and it is available at no correctness risk in every
domain on the list above.

---

## Constraints we might hold

Candidate invariants. Each is currently true of the prototype. The question for
each is not whether it is convenient but whether we are willing to give it up,
because most proposed affordances buy their power by weakening one.

| | Invariant | Currently enforced by |
| --- | --- | --- |
| **I1** | Application state has exactly one location, the server | No client cache exists |
| **I2** | The client never receives data the server did not render | Only hole values cross the wire |
| **I3** | Layout crosses the wire once; only values patch | Template interning |
| **I4** | Addresses are structural and identity-bearing | `keyed()` is mandatory for collections |
| **I5** | Events are semantic, validated, and authorized at the handler | `parseClientMessage`, handler-table lookup |
| **I6** | Handlers express intent, never a delta relative to what the user saw | Convention, plus `setDone` over `toggle` |

I1 is the thesis. I2 is the security story. I3 is the wire efficiency story. I4 is
what makes addressing survive change. I5 is the trust boundary. I6 is what makes
late-arriving events safe, and is the newest — it was forced by relaxing the
revision guard.

Note that I1 is already not literally true: the draft text input is client-owned.
That exception was introduced for latency reasons and never generalized, which is
the subject of A1 through A3 below.

**What the probes did to them.** All six survived, and three changed character.

**I1 is not merely slow where it holds, it is incorrect.** The admin probe typed
`grayfell` into a server-owned filter at 110 ms per character and got `gryel` at
a 150 ms round trip and `grayl` at 400 ms. A server-owned text input is correct
only when the user types slower than the network. This reclassifies the A2 text
primitive from a latency optimization to a correctness fix.

**I2 held exactly, and covers less than it appears to.** In the roles probe no
role received a single one of another employee's identifiers unless it held the
grant, and the role that held it received all of them. Unrendered data has no
representation on the wire to leak, and that property needed no defending. But
**payload size is a side channel I2 says nothing about**: per-role frame sizes
are cleanly separable and an HR session is 2.1x an employee's, so an observer who
can read no field can still infer privilege. Nothing in the design pads or blinds
this and no entry below covers it.

**I3 has an authoring cost that was not priced.** Because a template's static
strings cannot be interpolated from a constant, the ledger's `<option>` markup had
to be written longhand and pinned to its constants with a test. This is new
ceremony caused directly by template interning, and it is the one place the
"feels like local UI code" thesis measurably regressed.

**I4 turned out to be an asset rather than a constraint.** Structural,
identity-bearing addresses mean the *same node has the same address in every
session*, which is what makes a shared subtree forwardable byte-for-byte with no
address rewriting — the problem S1 expected to be hardest. I4 was justified as
what makes addressing survive change; its larger payoff is that it makes A6
possible at all.

I5 and I6 were confirmed rather than revised. The roles probe re-derives both
role and grant inside every mutation from the state it is about to change, so a
handler that closed over "you may approve this" when the row was rendered cannot
act on that belief — rendering a control is not authorization. I6's intent-shaped
mutations survived late and duplicate arrival in every probe that tested them.

---

## Structural questions

Five questions that are not affordances to admit or refuse, but design decisions
with no default answer.

### S1. What is the unit of replication and amortization?

`economics.md` finding 3 identifies render sharing as the only structural
advantage the architecture has: 2,000 viewers of one dashboard can be one render
instead of 2,000, and client rendering cannot deduplicate across users at any
price. Above fan-out ~1000 it wins outright.

But sessions almost never match exactly. Two users on the same dashboard are on
different routes, have different unread badges, different permissions, a
different name in the corner. **Session-level sharing is therefore close to
worthless in practice, and the unit has to be the subtree.**

That is a protocol question, not an optimization. A shared subtree needs its own
identity, its own revision, and its own patch stream, and the client has to
splice two or more independently versioned streams into one tree. Instance ids
are currently derived from a single root path per session; sharing means an
address has to be meaningful in more than one session at once. Open: does a
shared subtree get a separate revision counter, and what happens when a
per-session patch and a shared patch describe overlapping frames?

**Resolved: the subtree, and the hard part is not the part expected.** Three
probes measured this from different directions and agree.

Session granularity is worth *exactly* zero, not approximately zero. One
per-user string in the corner of a shell holds the amortization ratio at 1.00x
across populations of 2, 4, 8 and 16 identical sessions (routes); delete the hole
and the ratio is exactly N. A personalized value makes every one of its ancestors
unshareable, and the corner of a shell is a child of the root. Subtree
granularity recovers **85.9–91.3%** of bytes on same-route populations (routes),
**97.5% of nodes and 82.5% of bytes** on a board with a personal panel (odds),
and **52.0x** node amortization on a permission-filtered console (roles). The
capability is real and it is simply at the wrong granularity today.

**Addressing is already solved, by I4.** This is the pleasant surprise. Because
instance ids derive from structural position, `root/h6/k:m12` names the same node
in every session: every canonical subtree in the roles population sat at exactly
one address, and under `mine=1` the odds board's divergent addresses were exactly
`root` and `root/h9`. A shared frame can be forwarded to every subscriber
byte-for-byte with no rewriting. The address-space translation this section
expected to need is unnecessary.

**The blocker was the handler signature, and it has since been removed.**
Serialization replaces every closure with `{"kind":"event"}` and keeps the closure
in a per-session side table, so the *bytes* of a handler-bearing subtree were
already shareable while the *table* was not: two sessions whose rows are
byte-identical held different closures behind the same address, because
`open(taskId)` mutates this session's route and `decide(id)` captured this
session's account. Independently, odds and routes both measured the
handler-bearing region at **77.5%** of everything shareable. Without a change here
A6 could have shared only the handler-free quarter of a tree, and its headline
number would have become almost nothing.

The minimal fix was `(payload, session) => unknown`, resolving who acted at
dispatch time rather than at render time, and that is now the signature: the
runtime calls handlers with the session that sent the event rather than the one
the tree was rendered for. Existing handlers were unaffected. A6 no longer waits
on anything protocol-level; what it waits on is being built.

**And the answer to the revision question is yes.** The evidence is an accident
of the odds harness: comparing patches across sessions required stripping
`"revision":N` before hashing, because sessions on different counters were
receiving operation-for-operation identical patches. The revision is the *sole*
session-specific content in an otherwise shareable frame. A shared subtree
advances on ticks while a session's own panel advances on its own events, and one
monotonic counter cannot describe both. Overlapping frames need a per-session
frame that carries the shared revision it assumes, with the client buffering
shared patches below it. One further wrinkle: template delivery is per-session
state, so shared frames cannot carry templates unconditionally — the cheap answer
is to send the full table on connect and keep shared frames template-free.

The remaining requirement list, in order of how much protocol it moves: a hole
value naming a shared instance; addresses relative to the shared root; a
per-session handler table for a shared render; and an ordering rule between the
two streams. Only the third is capable of changing the recommendation.

### S2. Where does navigation live?

If the route is server state, back/forward and deep links become round trips and
the server owns history. If the route is client state, the server must still be
told about it in order to render, which is nearly the same round trip with worse
semantics.

Either way navigation partitions the amortization space, because two sessions on
different routes share nothing above the subtree they happen to have in common.
Open: is a route change a full tree replacement, which discards the template
cache benefit of I3 at exactly the moment the user is waiting, or a subtree swap
with a stable shell?

**Resolved: a subtree swap with a stable shell, which the runtime already does
correctly.** With the shell as one template and the body in a hole, `diff` emits
a single `set` on that hole and the shell is untouched, so I3's template-cache
benefit is fully preserved at the moment the user is waiting. Choosing the shell
per route instead costs **+38% bytes on a first visit, +32% on a revisit** and
four extra templates, and buys nothing measurable — `diff` has no per-subtree
replace operation, so the whole tree crosses the wire.

Nothing needs to be added to the protocol. What is missing is a *stated authoring
rule* — one root template, route bodies in a hole — because the naive top-level
ternary silently costs a third more bytes forever and nothing warns about it. So
the open question in S2 turned out to be an authoring question, not a protocol
one, and the framework could plausibly enforce it by making the route body a
first-class concept.

The second half is confirmed harshly. Two tabs on different routes share **10.0%**
of bytes; five sessions covering five routes share **2.0%** — a single subtree,
the footer. Even the nav bar is unshareable across a population covering every
route, because the active-link highlight is per-session and sits inside the same
keyed list as the links. **The practical denominator for any amortization estimate
is the number of distinct routes in the population, not the number of distinct
views in the product.**

### S3. What is the granularity of invalidation?

There is currently one granularity: any change re-runs the whole app for every
session and diffs the result. `economics.md` lists the absence of dependency
tracking as its first model limitation, and the `sdui_naive` versus `sdui` gap —
20,000 database reads per second against 10 — is the cost of getting the related
question of query deduplication wrong.

Open: does the runtime need to track which subtree read which data, and if so,
does that reintroduce the reactive-dependency machinery the project set out to
avoid? This is the clearest case where deleting client-framework complexity may
just relocate it.

**Resolved: do not build dependency tracking. Build two narrower mechanisms
instead.** The clock and ledger probes answer this from opposite ends and agree.

The waste is real and grows with the tree: one changed value re-renders 32,000
nodes at 8,000 rows, a **498x** overpayment, and a session that does not display
the changed value at all pays the full cost to emit **zero bytes**. But the
absolute figure is what should drive the decision, and at a measured 0.055 µs per
node the `economics.md` live-ops dashboard — 2,000 concurrent, 600 changes/min,
800 nodes — costs **1.1 cores** to move ten values per second, counting the ~10 µs
fixed cost each render pays before its first node. Affordable, and about 100x more
work than the change required. Ten times more of anything needs 11 cores, which is
a machine bought entirely to discard its own output.

The ledger supplies the other half, and it is the reason full tracking is
refused rather than merely deferred. **A dense dependency graph is the case
dependency tracking cannot help.** Every derived cell in that document genuinely
depends on every input — row 7's levy is `allocate(levyTotal, weights)[6]` and
`weights` includes row 1 — so a *correct* tracker re-renders everything and has
paid bookkeeping to reach the conclusion the current pipeline reaches for free,
while an *incorrect* one ships cents that do not sum. Value-granularity tracking
is precisely what `diff` already computes after the fact, for 0.2 µs per node, and
memoizing each leaf against its inputs would cost more than recomputing it.

So, in order:

1. **Read-scoped session invalidation. Recommended now — since built.** A session
   records which shared stores it read during its last render, and the runtime
   skips sessions whose read set excludes the changed store. This is a set of
   store identities per session, discarded wholesale on every render — no
   incremental bookkeeping and no reactivity. It takes the 100%-quiet case to zero
   and is the same mechanism the `sdui_naive` query-deduplication concern needs.
   Both clock and odds asked for it independently, with odds noting the win is
   smaller where a shared feed makes most invalidations legitimate anyway.

   What shipped is this, and **it saves nothing in any probe** — including this
   one, which asked for it. Adoption is per store, so a store that announces a
   change without identifying itself re-renders everyone exactly as before, and
   only the todo store identifies itself today. But converting the rest would not
   help either, and that is the finding worth recording: every probe reads every
   store it has at the *top* of its tree. `ClockApp` calls `useStore` and
   `store.state()` before it decides whether the clock is visible, so the
   `clock=off` session declares a read of the store the tick mutates and cannot be
   skipped. The 100%-quiet case this section promised to take to zero is not
   reachable by a store annotation.

   Store granularity is the right unit; reading at the root defeats it. What pays
   is pushing each read down to the component that needs the data, so a component
   that is not rendered does not declare the read — an authoring change rather
   than a runtime one. The mechanism is a prerequisite for that saving and is not
   itself the saving. `tech-debt.md` carries the detail, along with the two
   properties that made it safe to land ahead of the authoring work: an
   unidentified store re-renders everyone, and a session that declares no reads is
   treated as reading everything.
2. **Author-declared subtree memoization. When a probe needs it.** A
   `cached(key, deps, render)` hole returning the previous `TemplateResult` and its
   serialized subtree when `deps` are unchanged, letting `diff` skip by reference.
   This turns the 498x overpayment into near 1x without the runtime knowing what
   anything read, and it is the same construct A6 needs — a memoized subtree is
   the natural place to hang a subtree identity and revision.
3. **Full dependency tracking. Refuse until something forces it.** The two
   mechanisms multiply with A6's sharing, and together they cover every case these
   probes produce. If it is ever added it must be sound by default: an unsound
   tracker on the ledger produces a balance sheet that does not balance, which is
   worse than being slow.

**S3's motivating example should move off the ledger and onto the clock.** The
argument for invalidation granularity lives in sparse graphs over large trees, not
dense ones. The ledger's structural finding is evidence for A5 and A6 instead: at
2.0 ms per edit per session, 500 sessions on one 500-line document cost a full
CPU-second per keystroke, and neither number is improved by dependency tracking.

One thing the clock says plainly: **the wire is fine and the CPU was the whole
story.** 124 bytes per tick with layout sent once is the design working exactly as
advertised, and every proposal above is about not building trees rather than
sending fewer bytes.

### S4. What is a session?

A session is a connection. It dies on disconnect, and `economics.md` finding 7
notes every session also dies on deploy. Anything not written to the store is
lost.

Open: do we need three tiers — durable state in the store, session state that
survives reconnect and is keyed by user identity, and connection state that is
allowed to die — and who decides which tier a given piece of state belongs to,
the framework or the app author?

**Still open, and now the largest unanswered question in the document.** No probe
addressed it: the checkout wizard was not built. What the built probes add is
circumstantial pressure. The admin probe's state inventory shows how much
per-session state a realistic screen accumulates — tab, filter text, sort, column
visibility, selection, dialog and draft — all of which lives in `createApp`
closures and all of which dies on disconnect. The odds probe measured **350 KB
retained per session** against a 10.3 KB serialized tree, a 34x retention factor,
which is what a reconnect would have to rebuild. Every probe therefore assumes a
tier that does not exist, and none of them had to say so.

### S5. What is the initial state, and does first paint need a session?

A session is created on connect and the first paint requires the socket:
`templates`, then `snapshot`. Nothing renders before that. So the runtime is
invisible to crawlers, to link-preview fetchers and to any visitor whose
JavaScript fails or is slow, which is the reason `economics.md` writes off
content-shaped applications and the reason the architecture is a poor fit for
anything discovered through search.

The machinery to change that already exists in the chosen primitive.
`@lit-labs/ssr` renders a `TemplateResult` to HTML in Node behind a minimal DOM
shim, embedding `lit-part` and `lit-node` comment markers; `hydrate()` from
`@lit-labs/ssr-client` walks those markers and rebuilds the `ChildPart` and
`AttributePart` structures so ordinary `render()` takes over afterwards.

**It does not overlap with the IR, except in one place.** lit's SSR is one-shot
and one-directional — no diffing, no update path, no wire format for what
changed, and no event story, since a function cannot be serialized into markup.
`serialize.ts` and `diff.ts` answer a question it never asks. The single genuine
overlap is the *initial state*: an SSR'd document and the `templates` +
`snapshot` pair are two answers to how a client obtains its first tree, and only
one is needed. Everything after first paint is unaffected either way.

Three tiers, in increasing cost:

| Tier | What it is | Buys | Costs |
| --- | --- | --- | --- |
| **1. SSR only** | Server-rendered HTML, no socket for this visitor | Crawlers, link previews, no-JS readers, a CDN-cacheable cold load | A second code path for a separate audience |
| **2. SSR, then full client render** | Serve HTML for first paint; on connect, ordinary `render()` into the container, discarding the server DOM | Tier 1 plus a fast first paint, with no digest matching and no revision handshake | A visible re-render, and any DOM state in that window |
| **3. SSR plus `hydrate()`** | Adopt the server DOM properly | No re-render, no lost state | Digest agreement, a revision handshake, and the handler seam |

Two seams stand between tier 2 and tier 3. **Handlers**: lit's hydration assumes
the client holds the real functions, but here they live on the server and the
client binds a dispatcher that sends `(instanceId, holeIndex)`, so attribute
parts are hydrated with something structurally unlike what the server rendered.
**The revision race**: `hydrate()` must be called with the same template *and
data* the server rendered with or it throws, so a document rendered at revision
N against a socket that connects at N+3 fails. The initial HTML would have to
carry its render revision, the client hydrate against those values, and the
runtime then apply N→N+3 as an ordinary patch — a small addition to the connect
handshake, and much cheaper to design now than to discover later.

**This is where S5 presses on S4.** Tier 1 describes a visitor who is served
correctly with *no session at all* — a fourth tier below the three S4 proposes,
and the only one that costs nothing to retain. Every probe assumed a session was
required to render anything, and none had reason to question it.

Open: does a `TemplateResult` synthesized from interned statics produce the same
digest lit SSR embedded in its markers? Everything in tier 3 rests on that and it
is currently an assumption. And if SSR delivers the initial tree, does `snapshot`
survive at all, or does it become reconnect-only?

Not probed. `@lit-labs/ssr` is Lit Labs and explicitly pre-release, and its
server-only `html` tag omits hydration markers and cannot be hydrated, so live
regions would have to use ordinary templates.

---

## Affordances on the table

Each entry states what it buys, which invariant it weakens, and what remains
undecided. A1 through A4 — **and A9, which was added after the probes and belongs
with them** — are the same question at five different levels of ambition and are
best read together, since the choice between them is the largest open design
decision in the project. The short version after six probes is that the answer is
A2 and A9: give the client mechanics and let it acknowledge, and it needs neither
a guess (A4) nor a subtree (A3) for anything these probes produced.

### A1. Uncontrolled escape (status quo)

Server renders an element once and then declines to correct it. This is how the
draft input works today.

Buys instant typing for one case. Weakens I1 quietly and does not compose:
nothing prevents a later render from clobbering the value, there is no way to
read the state back except on submit, and every new case is bespoke. Adequate as
an exception, unusable as a policy.

**Confirmed unusable, with three failure modes the todo app does not show.** The
admin probe built an uncontrolled `<textarea>` — the A1 pattern verbatim — and
found it cannot be *pre-filled* (there is no way to give an uncontrolled control
an initial value and then stop owning it, so the dialog shows the current note as
static text beside an empty box), cannot be *read* (empty on submit is
indistinguishable from cleared, so the note can never be deleted without a
bespoke convention invented for one field), and cannot *participate in anything
derived* (the dialog's projected monthly total means the plan and seats fields
must stay server-owned, which is why editing seats costs a round trip and typing
the note does not).

That last one generalizes into the rule the whole A1–A3 question turns on: **the
ownership boundary is drawn by what else derives from a field**, not by any
property of the field itself.

Worth naming: `<details>`/`<summary>` and a CSS `:hover` tooltip would work today,
cost nothing, and be invisible to the server — roughly half the admin probe's
ephemeral interactions could have been built from markup the browser already
implements. They were not, because a menu the server cannot close after an action
is not a menu, and that gap is exactly what A2 has to fill.

### A2. A closed vocabulary of client primitives

The runtime understands a fixed set of interaction patterns. The server declares
intent and data; the client owns the mechanics. Candidates: text input with echo
suppression, disclosure and menu open/closed, tab selection, scroll position,
selection and focus, drag affordance, virtualized window.

Buys most of the latency win with I1 intact in spirit, because none of these hold
*application* state. `economics.md` finding 5 is the argument for it: coverage
only has to span ephemeral interactions, which is "a bounded and largely
app-independent list," and every point of coverage improves latency and reduces
server load simultaneously.

Weakens nothing structurally, but concedes the project's implicit claim that we
are not rebuilding a client framework. The vocabulary *is* a client framework,
just a small one with a server-defined interface.

Open: what is the minimum viable set, and what is the versioning story when an
app needs a primitive the runtime lacks? A closed vocabulary means the answer is
"wait for the runtime to add it," which is the trade being made.

**Adopt. The minimum set is smaller than the candidate list, and it is necessary
but not sufficient.** The admin probe inventoried every interaction in a dense
operations console and the ephemeral half collapses to essentially one thing:

1. **A gated subtree.** A client-owned boolean controlling whether a
   server-rendered subtree is present, with declared triggers, declared dismissal
   (outside click, Escape, an event from within), and a **server-writable
   override** so a handler can close it. This single primitive covers menus,
   dropdowns, popovers, tooltips, disclosure, accordions and modal visibility —
   five of thirteen inventory rows and 11 of 30 interactions. The server override
   is the whole difference between this and `<details>`.
2. **A text input with echo suppression.** Reclassified by the same probe from a
   latency optimization to a **correctness fix**: it does not remove the round
   trip for a search box, it removes the character corruption described under I1.
3. **Selection.** A client-owned set of keys with a server-visible summary. The
   strongest candidate for promotion because it is completely generic.

Everything else on the candidate list — scroll position, focus, drag affordance,
virtualized window — did not arise in that UI at all. Notably absent from the
probe's own list and required by any real admin tool: **focus management**, which
the runtime cannot express in either direction.

**Finding 5's claim is half right.** It says coverage need only span the ephemeral
interactions, "a bounded and largely app-independent list". Bounded and
app-independent: strongly yes, one primitive covers all of them. *Enough*: no.
The admin task sequence runs at 34.5 uncovered interactions per minute against the
1.5 `economics.md` models for Admin/CRM; shipping every ephemeral primitive
removes 11 round trips and leaves **20.4 per minute** — landing exactly on the
threshold where its own decision rule says users start to perceive an
architectural difference, rather than comfortably under it. Getting to 1.5 would
require covering sort, filter, tab switching, column visibility and selection, all
of which require the client to hold the rows. That is A5 and A3 territory, not A2.

**And it is not free.** If open/closed is client-owned, menu contents must already
be on the client, because there is no round trip left to fetch them with.
Measured: one row menu is 450 bytes, all 24 rows eagerly rendered is 10,800
against a 17,562-byte first snapshot — a **62% larger first payload**. A good trade
at 24 rows and a bad one at 500, which argues for making the gate
lazy-but-prefetched and is a further argument for A5.

The versioning objection to a closed vocabulary turns out to be small on this
evidence: the vocabulary is one primitive plus two specializations, and an app
needing something the runtime lacks mostly needs selection over large collections,
which is a protocol feature rather than an escape hatch.

### A3. Open client islands

An escape hatch: arbitrary client code with a declared prop interface and an
event contract, in the manner of LiveView hooks or islands.

Buys the entire client ecosystem — charts, maps, editors, video, anything with
its own lifecycle — and unblocks A2 by letting the primitive library be authored
in app space rather than runtime space.

Weakens I1 and potentially I2, because an island needs data, and data handed to
an island is data the client now holds in a form the server did not render.
Reintroduces exactly the two-program, prop-contract, version-skew ceremony the
project exists to delete, but confined to a declared boundary.

Open, and the most consequential question here: is A2 built *on* A3, so that
primitives are ordinary islands the runtime happens to ship, or is A3 refused so
that the vocabulary stays closed and auditable? The first is more useful and
admits an unbounded weakening of I1; the second holds the line and accepts that
some applications simply cannot be built.

**That framing is wrong, and the admin probe is what shows it.** The two are not
competing implementations of one idea; they are different shapes, and neither
choice above is the one that has to be made.

An island is a *subtree* boundary: it owns its DOM, receives props, and the server
stops rendering inside it. Every primitive A2 actually needs cuts the other way.
The dropdown's open/closed flag is client-owned while its items are
server-rendered *with server handlers on them* — an island cannot express that,
and an island that owned the dropdown would need the items as props, meaning the
server serializes `[{label, action}]`, the client renders it, and clicking sends
an action name back. That reinvents the endpoint, the request type and the
response type this project exists to delete, for a menu. The same applies to the
text input, whose value is client-owned while its validation state and error
message are server-rendered siblings, and to selection, whose every consumer is
server-rendered.

**These are not components. They are modifiers on server-rendered subtrees**, and
the right shape is a new kind of *hole value* — exactly what `keyed()` already is.
`keyed()` is the precedent worth following: not a component, but a tagged value
the serializer understands and the replica treats specially. The probe's sketch is
a `gate(key, {openOn, dismissOn, force})` returning a tagged value whose
`contains(...)` takes an ordinary server template, so I2 and I5 are untouched —
only *presence* moves to the client. Its `dismissOn: "child-event"` is the
subtle part: picking a menu item is simultaneously a client-side dismissal and a
server-side mutation, which is why picking an item already feels acceptable while
opening the menu does not.

So the position:

- **Adopt A2 as a closed vocabulary of hole kinds, not of components.** Small,
  auditable, and it weakens I1 only in the sense that a boolean nobody can read is
  not application state. I2 is untouched.
- **Adopt A3 separately, for genuine whole-subtree ownership** — charts, maps,
  editors, video — and judge it on those merits. Nothing in the admin probe needed
  one.
- **Do not build A2 on A3.** Not because A3 is dangerous, but because it is the
  wrong shape for every primitive the UI needs. Building the dropdown as an island
  produces a worse dropdown *and* a prop contract to version.

**Authoring is prototyped** on this branch. `defineIsland` / `.mount()` is a
hole kind; `*.island.tsx` is the only React in the repo; Radix and Tailwind
sit behind that wall. The call site cannot be mistaken for a server
component, which is the thing RSC got wrong. See
[`research/probes/islands.md`](probes/islands.md). A chart remains a valid
later island of the same shape — this probe tested the overlay half of npm,
not the canvas half.

One implementation note that keeps the change small: a trigger in attribute
position does not fit the current vocabulary, but it does not need to. A handler
that serializes to `{kind: "client", gate: "...", op: "toggle"}` instead of
`{kind: "event"}` is a one-word change in `serialize.ts` and moves nothing else in
the authoring model.

### A4. Declarative prediction

Optimistic values declared at the binding site rather than hand-written per
mutation. `economics.md` models this at 80% coverage and finds business workloads
land within 1-2 ms of an SPA, with the form-heavy workload winning outright.

Buys the red slice back as one runtime feature instead of N hand-written
implementations with N rollback paths.

Weakens I1 temporarily and I6's spirit: a predicted value is client-held
application state, with a reconciliation and rollback path.

Open: can the framework express that a mutation is *unpredictable*, so that
prediction is refused rather than wrong? The prediction-legality axis says this
matters — an auction must be able to say "never guess this."

**Admit it, but only in a form that refuses by default — and it buys far less
than modelled.** `economics.md` models A4 at 80% coverage of mutations. On the
ledger the reachable coverage is **20%**: three of fifteen mutations are cleanly
predictable, ten are unpredictable because the client lacks *data* rather than
because prediction is hard, and the remaining two are predictable only by
maintaining a second implementation of rollup and journal logic — the two-program
problem returning under a new name. So A4 as modelled is unachievable in that
domain.

Worse for A4's case, **all three predictable mutations are form controls echoing
their own value**, which is A1 today and A2's text primitive tomorrow. The
coverage A4 could reach is coverage A2 already claims, and A2 leaves I1 intact
rather than temporarily weakened. On this evidence A2 is strictly the better
investment.

The answer to the open question is that the framework *must* be able to refuse,
and the polarity matters more than the mechanism:

- **Default to refusing.** In a ledger a wrong total is not a flicker; it is a
  false statement about money, indistinguishable on screen from a true one, and a
  user may act on it. Opt-in prediction is safe, opt-out is not.
- **Only echo bindings are eligible.** Permit prediction where a binding's value
  comes from the event payload; forbid it structurally where the value comes from a
  computation. That is a mechanical, checkable rule rather than a per-binding
  judgement call, and on the ledger it admits exactly the three predictable
  mutations and nothing else.

The odds board supplies the general statement of illegality: **prediction is
illegal when the outcome depends on state the client cannot see at the moment the
server decides.** Every take on that board qualifies, and the failure is not
cosmetic — the client's best guess was wrong on both price and size and would have
been displayed as fact for 412 ms. What A4 must not do is offer a general
optimistic-render facility and trust authors to opt out. The ledger's eleven
derived views would make a good regression test for the refusal path.

**A4 is largely dissolved by A9, and should probably not be built.** This entry
and the probes that tested it all assume the choice is between rendering an
accurate guess and rendering nothing. There is a third option neither considered
as a mechanism: **render an honest placeholder** — a pending marker, a skeleton,
a disabled control, "content will be here" — which gives instantaneous feedback
while asserting nothing, and resolves to real state when the server answers.

Once that option is on the table A4 has almost no constituency left. Its
reachable coverage was already measured at **20%** of mutations, all of them form
controls echoing their own value, which A2's text primitive covers. The remaining
80% are unpredictable, and for those the honest placeholder is not a consolation
prize — it is the *correct* feedback, because there is no true value to show yet.
So the work splits into two much smaller primitives than "declarative
prediction":

- **echo**, for bindings whose value comes from the event payload — already A2.
- **acknowledgment**, for everything else — A9.

Neither is a prediction system, and neither weakens I1 in the way this entry
does. The recommendation is to build A2 and A9 and **close A4 unbuilt**, revisiting
it only if a probe finds a mutation that is genuinely predictable, genuinely worth
predicting, and not an echo. None of the six probes produced one.

Note that the odds board came close to this conclusion and stopped one step short,
calling the pending marker "the only safe prediction — the empty one." Framing it
as an empty prediction is what kept it inside A4 and out of the register.

### A5. Windowed collections

A first-class collection that carries an offset or cursor and a total, which the
client can scroll within, plus real move, insert, and delete operations instead
of the current all-or-nothing list patch.

Buys the large-collection case, which is currently unbuildable. Strengthens I2
rather than weakening it, since less data is rendered at all. Interacts with A2,
because the virtualized window is simultaneously a protocol feature and a client
primitive.

Open: does the server declare the window and the client request ranges, or does
the client own scroll entirely and the server render whatever range it is told?
The second is simpler and gives up server control over what is fetched.

**Promoted from a future concern to a present constraint.** No probe was built for
A5, and two hit it anyway.

The ledger ships a **202,634-byte first snapshot** for a 500-line document and
resends the entire collection in one `list` operation when the list is reseeded.
That is the real ceiling on document size, and the probe is explicit that it is
A5's problem rather than S3's. The admin probe's eager-menu measurement is the
same constraint from the other side: making menus instant costs 62% more first
payload at 24 rows and becomes untenable at 500, so the gate primitive wants to be
lazy-but-prefetched, which is a windowing question.

A5 also turns out to be a prerequisite for closing the gap A2 cannot close alone.
Getting the admin probe's 20.4 uncovered interactions per minute down toward
`economics.md`'s 1.5 requires covering sort, filter and tab switching, and all of
those require the client to hold rows it does not have.

Two mechanical findings for whoever builds it. `diff` treats a reorder as a new
list, which is why sorting 24 rows costs 15 KB — real move operations would make
it a handful of bytes. And `MAX_MESSAGE_BYTES` bounds inbound messages only, so a
500-row list operation goes out as a single ~200 KB frame with no chunking and no
backpressure.

### A6. Shared subtree rendering

The implementation of S1. Discussed there and in the collision section below.

The modeling in `sharing_model.py` adds a requirement that was not visible from
the qualitative argument. A personal value inside a shared subtree is affordable
only if it can be expressed as a *hole* rather than a shape change: the instance
is then built once per cohort and only the binding is evaluated per session,
which is the difference between 1.03x and 3.90x against a real-time SPA on the
dashboard workload. A conditional that returns a different template from inside
a list row destroys sharing; a scalar substituted into a fixed row does not.

Open: is that a rule the authoring API enforces, a lint the author can violate
knowingly, or a silent performance cliff? A `shared()` boundary whose body is
denied access to session identity except through declared parameters would make
it structural, at the cost of a visibly two-tier authoring model — which cuts
against the project's premise that it should feel like writing ordinary client
code.

**Build it, per-subtree from the start — but for different reasons than finding 3
gives.** The redundancy is real and enormous: at fan-out 2000 the odds board's
2,000 sessions emitted byte-identical patches every tick at every fan-out tested,
and **99.95%** of render CPU is provably redundant. The roles probe adds that
serving any number of sessions costs a converging **4 to 5 session-equivalents** of
rendering when nothing is personalized, so the amortization ratio improves without
bound as the audience grows.

What collapsed is the *urgency*. With the measured µs/node fed back in, the penalty
for not sharing at fan-out 2000 falls from the modelled **9.11x to 1.20x**. Naive
server-driven rendering is not 9x worse than a client SPA at that fan-out; it is
20% worse, and egress reaches a gigabit around fan-out 3,800 while CPU reaches a
full core only around 4,600, so the wire runs out first. So the CPU argument for A6
is much weaker than advertised, and the two arguments that survive are different
ones: **burst latency**, where sharing removes the 76 of 116 µs per session that
decides whether a 250 ms tick can drain at all — the odds probe now clears that
tick by 19 ms at 40 markets where it used to miss it, and still misses at 120, so
this is a margin argument rather than a broken-today one — and provable redundancy
on principle, which justifies the work even where the absolute cost is affordable.

**The hole-versus-shape rule is confirmed, and it is more important than it
looked.** There is an apparent contradiction between `sharing_model.py`, which puts
a personalized-but-hole-shaped dashboard at 1.03x, and the roles probe, which
measured one added personal hole costing 14x. They are not in conflict; they
describe two different implementations, and the gap between them is the design
decision:

- **Sharing byte-identical subtrees** is what the probes' census measures, because
  it canonicalizes a subtree by template id *and hole values*. Under that strategy
  any differing hole makes the subtree a distinct object, and one personal name
  takes roles from 52.0x to 3.6x and routes to exactly 1.00x.
- **Sharing template instances with per-session hole bindings** is what
  `sharing_model.py` models: the instance is built once per cohort and only the
  personal binding is evaluated per session.

The measured numbers are therefore the ceiling for the *naive* strategy, and they
say that naive strategy is not worth building. **The unit of sharing must be a
template instance with per-session bindings, not a byte-identical subtree.** That
is the single most consequential thing the suite establishes about A6, and it was
not visible from either the model or any one probe.

Given that, the answer to the open question is that it should be **structural, not
a lint**. A shared boundary whose body reaches session identity only through
declared parameters is precisely what makes per-session binding possible; without
it there is no way to know which holes are the personal ones. The two-tier
authoring model is a real cost and it buys the only structural advantage the
architecture has.

Sequencing was settled by S1: the handler signature came first, because 77.5% of
the shareable region carries handlers and nothing else about A6 mattered until a
shared closure could resolve who acted at dispatch time. That signature has since
shipped, so this entry is next in line rather than blocked.

### A7. Delta-shaped mutations

An exception to I6 for domains where intent genuinely is positional and relative:
collaborative text, and anything else requiring operational transforms or a CRDT.

Open: is this admitted as a narrow escape hatch, or is collaborative text
declared out of scope? Admitting it means the runtime hosts a convergence
algorithm; refusing it means an entire product category is off the table. Refusal
looks like the right answer and should be stated deliberately rather than by
omission.

**Unchallenged.** No probe needed a positional or relative mutation, and every
probe that touched contention — ledger, odds, roles — was served correctly by
I6's absolute intent. That is weak evidence for refusal rather than strong, since
none of them was a text editor, but nothing has emerged to argue against it.

### A8. Durable sessions

The implementation of S4. Session state that survives reconnect and deploy,
keyed by identity rather than by socket.

Weakens nothing, costs a lot, and is the difference between a prototype and
something that can be deployed on a Tuesday afternoon.

**Still open, and every probe silently depends on it.** See S4. The measured
figure that prices it is the odds board's 350 KB retained per session against a
10.3 KB serialized tree — a 34x retention factor and 1.6x the 220 KB
`economics.md` assumes — which is what a reconnect would have to rebuild and what
a deploy destroys.

### A9. Acknowledgment affordances

Instantaneous local feedback that an input was received and work is in flight,
asserting nothing about the outcome: a pending marker, a disabled control, a
skeleton body, a nav highlight that moves on the click. The server's next commit
replaces it with real state.

Numbered last to keep A1–A8 references stable, but it belongs in the A1–A4 group
and should be read with them. It is the fourth answer to the ownership question:
A1 abandons a control to the client, A2 gives the client a mechanic, A3 gives it a
subtree, A4 gives it a guess — and A9 gives it *nothing but the knowledge that it
acted*, which turns out to be most of what the other three were wanted for.

**Buys the one thing an SPA gets for free that this architecture currently does
not claim at all.** The routes probe measured navigation under server authority as
a full round trip in which "nothing acknowledges the click: the active-link
highlight does not move, no loading state appears, and the address bar never
changes." That is not a latency problem, it is a missing affordance, and it is
present in every uncovered interaction in every probe.

**Weakens nothing.** A pending flag makes no claim about application state, so it
sits in the same category as A2's gated boolean — a value nobody can read back is
not application state, and I1 survives in spirit and letter. I2 is untouched
because the placeholder contains no data. Unlike A4 there is no reconciliation
path and no rollback, because there is nothing to roll back: the marker is
replaced by the authoritative render rather than corrected against it.

**Legal everywhere, unlike A4.** This is the property that makes it worth a
register entry of its own. An auction, a seat map, a payment and a permissioned
console may all acknowledge instantly; none of them may guess. The domains where
A4 is forbidden are exactly the domains in this project's advantage column, so the
affordance that works in them is the one worth building.

**And it should reduce server load rather than add to it.** Under latency with no
feedback, users click again. I6 makes the duplicate safe — an absolute intent
applied twice is idempotent — but it still costs an inbound event, a handler run,
a render and a patch. A pending marker that disables its control converts that
into nothing. This is the one part of A9's value that is objectively measurable
rather than perceptual, and it is what the specified probe below is built around.

Open, and the reason this is an entry rather than a decision: **when does the
marker clear?** The protocol makes the cheap answer possible and the correct
answer expensive.

- **Free, approximate.** The client knows the revision it sent at and sees
  `update.revision`, so it can clear on the first commit past that revision, or on
  an `error`. No protocol change, entirely client-side. It is wrong in two cases:
  an outcome that changes nothing visible (a claim that lost a race leaves your row
  identical) clears with no feedback, and a handler still running asynchronously
  when an unrelated commit lands clears early.
- **Correct, costs protocol.** `ClientMessage` carries no event id and
  `ServerMessage` has no ack type, so correlating a specific outcome to a specific
  in-flight action requires adding both to `shared/protocol.ts`. Worth noting that
  `error` messages carry a code but not the address of the event that failed, so
  with two actions outstanding the client cannot tell which marker to clear — the
  ambiguity is not hypothetical.

Deciding between them is an empirical question about how often the free version is
wrong, which is what the probe below measures.

---

## Stress probes

Applications that break something. Each names the questions it forces.

| Probe | Contrivance | Forces | Status |
| --- | --- | --- | --- |
| Ticking clock | A dashboard with a live seconds display | S3 | [built](probes/clock.md) |
| Presence indicator | 50 users, each with a "typing…" state | S3, S1 | — |
| Virtualized log | 100k rows, scrollable | A5, A2, S3 | — |
| Route divergence | Two tabs, same user, different routes | S2, S1 | [built](probes/routes.md) |
| Kanban drag-reorder | Drag a card between columns | A2, A5, I6 | — |
| Chat | Send a message, expect it instantly | A4, I1 | — |
| Claim queue | Two dispatchers, one work item, no guessing allowed | A9, A4 | [specified](#specified-but-not-built-the-claim-queue) |
| Live-validating signup | Username availability plus a masked phone field | A2, A4 | — |
| Menu-heavy admin | Dropdowns, modals, tooltips, popovers | A1-A3, the ownership taxonomy | [built](probes/admin.md) |
| Checkout wizard | Four steps, then the laptop sleeps | S4, A8 | — |
| Chart dashboard | Any real charting library | A3 | — |
| Client islands | Radix + Tailwind behind `.mount()` | A3 authoring | [built](probes/islands.md) |
| Spreadsheet / editor | 10k cells, or collaborative text | A7, A5, A2 | — |

**Ticking clock** was three lines of code and the highest information-per-effort
probe in the document, as predicted. A once-per-second change re-renders and
re-serializes every session's entire tree forever, whether or not anyone is
looking at the clock. It answered S3 immediately and in the opposite direction to
the one implied: the waste is enormous in ratio and affordable in absolute terms,
so the answer is two narrow mechanisms rather than dependency tracking.

**Route divergence** was the probe implied by the observation that started this
document, and it produced the sharpest single number in the suite: session-level
sharing is worth 1.00x, exactly, from one personalized string. S1 duly stopped
being an optimization question and became a protocol requirement.

**Menu-heavy admin** looked trivial and was the most important probe for A1
through A3, as predicted. Every dropdown poses the ownership question in
miniature, and the taxonomy that resolved it — client owns presence, server owns
contents and meaning, either side can close — is now the authoring model. It also
produced the two findings least anticipated anywhere in this document: that a
server-owned text input loses characters, and that the architecture cannot
currently build an accessible menu.

**Kanban** and **spreadsheet** mark the outer boundary. Continuous gesture and
positional text editing are the two things no amount of framework cleverness
fixes; their value is in deciding where to stop rather than what to build.

---

## Advantage probes

Applications where the architecture should win. These are worth building because
an unfalsified advantage is not an advantage, and because each one is also a
design probe: the wins are only available if a specific decision goes a specific
way.

| Probe | Contrivance | Demonstrates | Requires | Status |
| --- | --- | --- | --- | --- |
| Election scoreboard | 100k viewers, one view, no interaction | Amortization at extreme fan-out | A6 | superseded by odds |
| Odds / market board | High fan-out plus contended bids | Amortization *and* illegal prediction | A6, A4 | [built](probes/odds.md) |
| Departure board fleet | Thousands of cheap displays, zero interaction | Weak-device and TTI advantage | — | — |
| Ledger / invoicing | Edit a line, watch every derived total move | Faster to a *correct* screen | S3 | [built](probes/ledger.md) |
| Warehouse / POS | Two pickers, one remaining unit | Contention as a feature | A4 | — |
| Permission-filtered console | Salary fields visible to some roles | I2 as a product feature | ~~Collides with A6~~ barely interacts | [built](probes/roles.md) |
| Kitchen display / dispatch | Shared queue, discrete taps, cheap screens | Real-time was mandatory anyway | A6 | — |
| Ordering kiosk | Deploy once, every terminal is current | No client fleet, no version skew | S4 | — |

**Election scoreboard** saturates both halves of the decision rule at once:
personal share near zero, uncovered interactions near zero. It was described here
as the cleanest possible test of finding 3 and the best place to measure the
hole-substitution cost by adding a single per-viewer field to an impersonal board.
The odds board did both — it *is* that board with contention added, and its
`mine=1` configuration is exactly the single-per-viewer-field experiment. Building
the scoreboard separately would now only be worthwhile as an A6 regression test.

**Odds board** was the one to build, and it was. It sat in both families — extreme
fan-out and a domain where prediction is illegal — and delivered both: 99.95% of
render CPU provably redundant at fan-out 2000, and a client's best guess wrong on
both price and size, which would have been displayed as fact for 412 ms. It also
supplied the finding that reorders A6's whole work plan, which is that 77.5% of
the shareable region carries handlers.

**Ledger** tested the authoring thesis rather than the cost thesis, and the
separation was worth insisting on: the authoring verdict is broadly positive (no
endpoints, no DTOs, no cache keys, no rollback paths, no loading states) while the
cost verdict falsified this document's reason for commissioning it. The claim above
that it is "the strongest argument for S3" is the single largest error the register
contained, and it is corrected under S3.

**Ordering kiosk** surfaces an advantage `economics.md` does not price: there is
no client fleet, so there is no version skew. A client architecture has N app
versions in the wild talking to one API forever, which is the origin of API
versioning, backward compatibility, and staged rollout. Here every session runs
the server's current code and that category disappears. Finding 7 is the honest
counterweight — deploys destroy every session, and at a million sessions a naive
restart needs 48 cores and 23 Gb/s — so the trade is a permanent
backward-compatibility burden for a bounded drain-window problem.

---

## Specified but not built: the claim queue

The probe for A9. Specified here in full because the affordance it tests is new to
the register and because it has one trap that has to be designed around rather
than discovered.

**The trap.** *Probes that would mislead* already names it: "anything measured only
on time-to-first-feedback… will confirm whatever it was built to confirm," because
finding 4 shows the ranking inverts depending on whether "first pixel moves" or
"the screen is correct" is measured. An acknowledgment primitive optimizes the
first metric to near zero and does **nothing whatever** for the second. A probe
that reports only first-feedback would therefore manufacture a spectacular result
that means nothing. **Every latency figure below must be reported as a pair**, and
the expected finding is that the second number does not move at all.

**The app.** A dispatch board over a shared queue of work items, with several
sessions claiming from it. Claiming is the ideal instrument because it is
contended, discrete, and unpredictable in principle: the outcome depends on
whether someone else got there during the flight of your own click, which is
exactly the odds board's definition of illegal prediction, without the odds
board's arithmetic. Four outcomes, chosen so that every branch of the clear rule
is exercised:

1. **`claimed`** — you got it; your row changes visibly.
2. **`lost`** — someone else got it first, and in one configuration this leaves
   your row **visually identical**. This is the case the cheap clear rule cannot
   see, and it is the whole reason the probe exists.
3. **`stale`** — the item was withdrawn and the address is gone, so the runtime
   returns `stale_event`.
4. **`rejected`** — you already hold your concurrent limit, so the handler throws
   and the runtime returns `handler_failed`.

Two routes — the queue and *my items* — so navigation acknowledgment is measured
alongside mutation acknowledgment. Those are different cases: a skeleton body is
adequate for navigation and a pending marker is adequate for a claim, and neither
substitutes for the other.

**Variables.**

- `?ack=off|marker|skeleton` — `off` is the control and current behaviour.
- `?clear=revision|token` — the two candidate clear rules from A9.
- `?loss=visible|silent` — whether losing a race changes your row.

**The `token` rule needs no protocol change, and that is the design finding to
verify.** A correlated acknowledgment looks like it requires an event id on
`ClientMessage` and an ack on `ServerMessage`, both in do-not-edit files. It does
not: the server can render the id of the last action it completed *for this
session* into an ordinary hole, and the client clears the marker when it sees that
id. The correlation is application state, not protocol.

That comes at a price the consolidated findings predict, and the probe should
measure it: **a per-session acknowledgment token is a personalization class**, and
per S1 and the collision section a viewer-dependent hole makes every ancestor
unshareable. So the token must live in **its own leaf region, never inside the
shared collection** — the client owns *where the marker appears*, which can be
inside a shared row, while the server owns only the *clear signal*, which sits in a
leaf. If that separation holds, subtree sharing survives; if the token is placed in
the row, sharing should collapse the way it does in the roles probe. Measuring both
placements turns an authoring rule into evidence.

**What to measure.**

| # | Measurement | Expected |
| --- | --- | --- |
| 1 | Time to first visible change, `ack=off` vs `marker`, at 0/150/400 ms | full RTT vs ~0 |
| 2 | Time to correct screen, same conditions | **identical** — the ack is free and buys nothing here |
| 3 | Duplicate submissions under latency: click, wait under one RTT, click again. Count inbound events, handler runs, renders and patch bytes | measurably fewer with `marker`; this is the objective benefit |
| 4 | Clear-rule accuracy: for each of the four outcomes × both rules, count false-clears and orphaned markers | `revision` fails on `loss=silent`; `token` should not |
| 5 | Bytes and round trips added by the affordance | zero for `marker`, one hole for `token` |
| 6 | Node amortization with the token in a leaf versus inside the row | leaf preserves subtree sharing, row collapses it |

Measurement 3 is the one that matters most, because it is the only part of A9's
value that is not perceptual. If a pending marker measurably reduces duplicate
inbound events under latency, A9 pays for itself in server load regardless of how
it feels, and it connects to finding 7's unsheddable-inbound-events risk.

**What it cannot answer.** Whether acknowledgment actually makes the application
*feel* responsive is a question about human perception, and no script settles it.
The probe can only make the comparison available — the latency dial already exists
for exactly this — and should say so rather than dressing a demonstration up as a
measurement. The claim under test is narrower and worth stating precisely: *that
acknowledgment moves time-to-first-feedback to near zero at no correctness cost, no
wire cost, and reduced server load, in a domain where prediction is illegal.* If
that holds, A9 is justified without ever resolving the perceptual question.

Effort: a day or two, and it can borrow the odds board's contention machinery
rather than reinventing it.

---

## The collision: amortization against authorization

Two of the architecture's claimed advantages are in direct conflict, and no probe
above resolves it alone.

> **Resolved, and the premise was wrong.** This section is preserved as written
> because the correction is more instructive than the claim. In short: there is no
> meaningful collision between amortization and authorization. Authorization
> classes are bounded and cost 21%; *personalization* is what collapses sharing,
> and it does so whether or not the personalized value is sensitive. The
> measurement and the restated conclusion are at the end of this section.

I2 says the client physically cannot receive data the server did not render,
which makes permission-filtered UI safe by construction. A6 says sessions viewing
identical content should share one render, which is the only structural cost
advantage available.

**Sharing a render requires the sharing users to be authorized identically.** The
moment a view contains one field that some viewers may see and others may not,
the shared subtree splits — and it splits per distinct permission set, not per
distinct view. An admin console with ten roles has at best a tenth of the
amortization it appears to have, and a per-user field collapses it to one.

This suggests the amortization ratio in the decision rule is really
`concurrent_sessions / (distinct_views x distinct_authorization_classes)`, which
is a materially worse number than the one modeled.

**Checked, in `sharing_model.py`.** The correction holds but the diagnosis was
incomplete. Partitioning by authorization class costs less than expected —
going from 1 cohort to 40 only takes sharing from 49x down to 25x. The dominant
term is Amdahl, not partitioning: the per-session share of the shared subtree
caps speedup at `1 / personal_share` no matter how large the audience is, and
a view that is 5% personal can never do better than 20x. Break-even against a
real-time SPA lands around 7-9% personal content. So the decision rule's second
number should not be a ratio of sessions to views at all; it should be the
personal share of the shared subtree. It also suggests a design constraint on any app hoping
to benefit: authorization has to be coarse and structural, resolved at subtree
boundaries rather than sprinkled per field. Whether that is an acceptable
constraint to impose on app authors is an open question and probably the deepest
one in this document.

### Measured, in the permission-filtered console

**The model's correction was right and the original framing was wrong. There is no
authorization collision worth the name.** The
[roles probe](probes/roles.md) built the console this section asked for — 60
records, five roles, three interchangeable gating strategies that change *where* in
the tree the decision is taken and nothing about who may see what — and ran 200
sessions through it.

Authorization is close to free. Gating every sensitive field individually against
gating at subtree boundaries costs **21%** of the available sharing, 40.8x against
52.0x, not the predicted collapse. And role diversity **saturates** rather than
decaying: one role gives 100.3x, five give 52.0x, and the sixth costs nothing. The
reason is structural — sharing keys on the *grant tuple*, and the number of
distinct tuples is bounded by the permission model rather than by the population,
so a console with ten roles has at worst a bounded constant fewer sharing
opportunities rather than a tenth of them. The `1 / auth_classes` decay this
section proposed does not exist.

What does exist is far sharper and is not about authorization at all. Adding one
**non-privileged** personalized field — an `Opened by ${viewer.name}` span, inside
the one subtree every session was sharing — drops node amortization from 52.0x to
**3.6x** and raises the work of serving the population from 3.8 session-equivalents
to 55.2. A national identifier and an audit stamp cost exactly the same. So:

> The collision is not between amortization and authorization. It is between
> amortization and **personalization**, and it is a question of *placement* rather
> than of sensitivity: any viewer-dependent value collapses sharing for every one
> of its ancestors.

Three probes reached that conclusion independently — routes by taking session
sharing to 1.00x with one string in a shell corner, odds by finding only `root`
and one hole divergent under `mine=1`, roles by measuring the cost of one span
against the cost of gating every field. It is the same statement `economics.md`
already makes in passing ("a per-user greeting, an unread badge, or a personalized
watchlist splits one shared render into N"), which turns out to have been the whole
of it.

Two corollaries.

**The corrected denominator is personalization classes, not authorization
classes.** For an estimate, `distinct_routes x distinct_personalization_classes`,
where a per-user name is one class per user and a grant tuple is one class per
role. Routes supplies the first term, roles the second.

**And the constraint on app authors is the opposite of the one proposed above.**
This section concluded that authorization must be coarse and structural. Measured,
authorization granularity barely matters and the constraint that does is
*personalization has to live at the leaves* — or, better, be resolved on the client
entirely. `Opened by ${viewer.name}` was known to the client already and never
needed to be in the shared subtree. Recovering 14x for that is the
highest-leverage change the probe found, and it lands on A2 rather than A6.

I2 itself came through untouched: no role received another person's identifiers
without the grant, and enforcement needed nothing beyond rendering. The security
story and the sharing story do not conflict.

---

## What no entry anticipated

Six things the probes hit that no invariant, structural question or affordance
above describes. They are listed here because a register that only tracks its own
predictions is not measuring anything.

**The architecture could not build an accessible menu. Since fixed.** Two gaps
combined. `EventPayload` was `click | change | submit` and every other DOM event
mapped to `change`, so `@keydown` bound and fired but **arrived with no key** —
Escape to close, arrow-key navigation and type-ahead were not slow, they were
unbuildable. And there was no representation of **focus** in either direction, so
focus could not be requested by the server or reported by the client; after a
dialog closed, focus could not return to the control that opened it. Every menu
and dialog in the admin probe was mouse-only, and the missing key payload also
blocked the dismissal behaviour A2's gate primitive declares.

Both are now expressible: a `key` payload with modifiers, `focus`/`blur` payloads
that report movement without naming a destination, and a `focusWhen()` hole in
element position that the client applies as a transition rather than as state.
Fixing the second was a precondition for the first being useful, because key
handlers bind to elements — Escape reaches a menu only if the menu holds focus.
The admin probe has not been rewritten to use any of it.

**The architecture deletes API ceremony and adds test-addressing ceremony.** To
send an event from a test you need an instance address and a hole index, so
`test/probes/ledger.test.ts` carries `ROW_QUANTITY_EVENT_HOLE = 7` and three
siblings, each pinned by an assertion so that reordering a table cell fails loudly
instead of silently re-aiming the test at a different control. The SPA equivalent
is `getByRole('spinbutton', { name: 'Quantity' })`. This is the one place the
architecture is meaningfully worse for a developer than the thing it replaces, and
a `byRole`-style helper resolving a control to an address is missing
infrastructure rather than a research question.

**I2 protects content and leaks volume.** Per-role payload sizes are cleanly
separable — an HR session is 2.1x an employee's — so privilege is inferable
without reading a field. Discussed under I2 above; noted here because no entry
covers wire-volume privacy at all.

**The register was missing an entire affordance class, and two probes brushed
against it without naming it.** A1 through A4 enumerate ways to give the client
ownership — a control, a mechanic, a subtree, a guess — and none of them covers
giving the client *nothing but the knowledge that it acted*. The odds board
implemented exactly that and filed it as "the only safe prediction, the empty one",
which kept it inside A4; the routes probe measured its absence precisely and filed
it under navigation experience. Neither connected the two, and the register had no
slot to connect them in. It is now [A9](#a9-acknowledgment-affordances), it
displaces most of A4, and the lesson is that a probe reporting a workaround as a
domain quirk is a signal that the register is short an entry.

**There is no outbound backpressure.** `MAX_MESSAGE_BYTES` bounds inbound messages
only, so a 500-row list operation leaves as a single ~200 KB frame with no
chunking. It did not break anything at probe scale and it interacts with both A5
and finding 7's burst risk.

**Templates cannot be built from constants.** A template's static strings cannot be
interpolated, which forces option lists to be written longhand and pinned to their
constants by test. This is a direct cost of I3 and the only measured regression
against "feels like writing local UI code".

**The instrumentation the register asked for is not sufficient to answer the
register.** All three of clock, odds and ledger independently asked for the same
thing: `/metrics` cannot be scoped or reset, so measuring one configuration
requires delta arithmetic in every harness, and `retainedBytesPerSession` is a
running average since boot that should be ignored outright. Beyond that,
`renderMicroseconds` excludes `JSON.stringify` (31% of stage cost) and the socket
write (~50 µs per session), which means the A6 ceiling — the number that should
decide whether A6 is built — is currently inferred rather than measured. A
`broadcastMicroseconds` counter, an RSS reading, and `POST /metrics/reset` or
`?since=` would close it.

Two smaller items, recorded rather than raised: a session cannot observe its own
renders without causing one, and `subscribe` cannot tell whether anyone is
connected, so a probe that wants to idle when the room is empty has to count
`createApp` and `dispose` itself.

---

## Probes that would mislead

Worth naming so they are not mistaken for good news.

- **Marketing or content site.** `economics.md` finding 6 shows a 4.5x cost
  advantage, and it is real and irrelevant: static HTML beats every architecture
  in the study. Building it would produce a true number that recommends the wrong
  thing.
- **Consumer social feed.** Cheapest on paper in the model and still a bad idea —
  fan-out 1.2 means no amortization is possible, and 21,300 unsheddable inbound
  events per second is an operational risk the cost figure does not express.
- **Anything measured only on time-to-first-feedback.** Finding 4 shows the
  ranking inverts depending on whether "first pixel moves" or "the screen is
  correct" is measured. A probe that reports one without the other will confirm
  whatever it was built to confirm. This applies most sharply to A9, whose entire
  effect is on the first metric and none of it on the second, which is why the
  [claim queue spec](#specified-but-not-built-the-claim-queue) requires every
  latency figure to be reported as a pair.

---

## Build order

The original order, all six now built and written up:

1. **Ticking clock** — hours. Answers S3 and costs nothing.
2. **Route divergence** — a day. Answers how much of the amortization advantage
   survives personalization, which determines whether S1 is urgent.
3. **Menu-heavy admin** — days. Forces the A1-A3 decision, which determines the
   authoring model and therefore everything downstream.
4. **Ledger** — a week. Tests the authoring thesis and motivates S3 concretely.
5. **Odds board with simulated viewers** — the big one. Requires A6 and is the
   only way to test the one advantage that is structural rather than incidental.
6. **Permission-filtered console** — alongside 5, so the collision is measured
   rather than discovered later.

That order held up. Each of 1, 2, 3 and 4 changed a decision, and 5 and 6 between
them rewrote the collision section. The two that falsified their own rationale
were the most valuable, which argues for keeping the practice of stating the
expected answer before building.

### What to build next

The probes have shifted the bottleneck from research to implementation. Three
items on this list have since been taken, and are struck through rather than
deleted so the ordering argument still reads as it was made. In dependency order
rather than by effort:

1. ~~**A `key` payload kind and a focus representation.**~~ **Done.** A `key`
   payload with modifiers, `focus`/`blur` payloads, and a `focusWhen()` hole the
   client applies as a transition. Two limits remain and are recorded in
   `tech-debt.md`: key handlers bind to elements, so a shortcut that should work
   regardless of focus still cannot be written, and a repeated focus request to
   the same element needs an author-supplied nonce.
2. **The gate primitive (A2), as a hole kind.** The highest-leverage change
   identified: it removes 11 of 30 round trips in a realistic admin screen, it is
   the mechanism that moves personalization off the server and recovers most of the
   14x from the collision section, and it is one primitive plus two
   specializations rather than a framework. Its dismissal semantics are now
   expressible, since item 1 landed.
3. **The acknowledgment affordance (A9).** Cheapest item on this list — the free
   variant is entirely client-side and needs no protocol change — and it claims the
   one advantage an SPA holds in every domain where prediction is illegal, which is
   every domain in this project's advantage column. Build it behind the
   [claim queue probe](#specified-but-not-built-the-claim-queue) so the clear rule
   is decided by measurement rather than by taste.
4. ~~**The handler signature change, `(payload, session)`.**~~ **Done.** Handlers
   receive the session that sent the event rather than the one the tree was
   rendered for, so one closure can serve every viewer of a subtree. Existing
   handlers were unaffected, since a shorter function stays assignable. A6's
   headline number is now reachable; nothing yet claims it.
5. **A `byRole`-style test address helper.** Not research, but it is the only
   measured developer-experience regression and it will get worse with every probe.
6. **A5, windowed collections.** Now a present constraint in two probes rather
   than a future one, and a prerequisite for closing the interaction-rate gap A2
   cannot close alone.
7. **A6, per-subtree, sharing template instances with per-session bindings.** The
   structural advantage, and the design is now specified rather than open.

Read-scoped invalidation, S3's recommendation, was not on this list and has also
been built — it needed no API and no probe to specify it. Two qualifications
belong with that, both detailed under S3. It saves nothing yet, because every
probe reads its stores at the root of its tree and a read declared at the root can
never be scoped out; realising the saving is an authoring change. And what
shipped tracks reads per session, which is exactly the version S3 warned stops
working once a render serves more than one session, so item 7 inherits the job of
moving the read set from the session to the cohort.

Not on the list: **A4**. Six probes produced no mutation worth predicting that was
not already an echo, and A9 covers the rest honestly. It should be closed rather
than scheduled.

### Probes still worth building

Ordered by what they would settle, not by effort:

- **Claim queue** — [specified above](#specified-but-not-built-the-claim-queue).
  The only probe that would settle a *new* register entry rather than refine a
  resolved one, and the cheapest on this list.
- **Checkout wizard** — S4 and A8 are now the largest untouched questions in the
  document, and every built probe silently assumes a session tier that does not
  exist.
- **Virtualized log** — would turn A5's promotion into a specification, and is the
  probe the admin and ledger findings both point at.
- **Presence indicator** — the sparse-graph case that read-scoped invalidation
  exists for, and therefore the only way to validate S3's recommendation rather
  than infer it.
- **Chart dashboard** — the remaining *library* test of A3 (canvas, not
  overlays). The authoring boundary is prototyped in
  [islands](probes/islands.md).
- **Election scoreboard** — largely answered by the odds board, which was the same
  measurement with contention added. Worth building only as an A6 regression once
  A6 exists.
- **Kanban** and **spreadsheet** still mark the outer boundary and are still about
  deciding where to stop.

## What to instrument

The three instruments this section asked for now exist, and two of the three
questions are answered.

- **Microseconds per node**, measured five times independently: **0.050** (roles),
  **0.055** (clock), **0.083** (odds), **0.2** (ledger), **0.7** (routes). Against
  an assumed 0.8 and a 5 µs pessimistic case that would have moved the fan-out
  crossover past any real audience. The assumption was never approached and the
  sensitivity risk it flagged is closed. Note that every one of them measures the
  *runtime's* share: application cost per node — queries, authorization,
  formatting — is unbounded and still unmeasured, and the fourteenfold spread
  between the cheapest probe and the dearest is the clearest evidence that it,
  not the runtime, is what a real deployment will be paying for.
- **Retained bytes per session**, measured at **350 KB** at 671 nodes against a
  10.3 KB serialized tree, a 34x retention factor and 1.6x the modelled 220 KB.
  Economically irrelevant, as `economics.md` predicted, and operationally relevant
  to A8.
- **Personal share of each shared subtree**, measured across three probes and now
  the central number in the document rather than a supporting one. What a hole
  substitution costs relative to a full node render is the one part still open, and
  it is open precisely because it is the difference between the two A6
  implementation strategies described above.

What is still missing is narrower and listed under *What no entry anticipated*:
scoped and resettable metrics, a broadcast timing counter that includes
serialization and socket writes, and an RSS reading. The A6 ceiling is the number
that should decide whether A6 gets built, and it is currently inferred by
subtracting wall clocks rather than read off an instrument.
