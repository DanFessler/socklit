# Odds board

**Forces S1 (can renders be shared?), A6 (shared subtree rendering), A4 (where
prediction is illegal).**

The result in one paragraph. **Finding 3's structural advantage survives
measurement almost exactly, and the argument for A6 gets weaker anyway.** Sharing
would eliminate **99.95%** of render CPU at fan-out 2000 — measured, not
modelled: 2000 sessions emitted byte-identical patches, every tick, at every
fan-out tested, and the whole-tree hash collapsed to one distinct value. Feeding
the measured **0.083 µs/node** (against the assumed 0.8) back into
`cost_model.py` moves the sharing crossover *down* from 335 to **202**, and the
amortized win at fan-out 2000 holds at **3.3x cheaper** than a client SPA against
the predicted 2.9x. What collapses is the urgency: the penalty for *not* sharing
falls from the modelled **9.11x** to a measured **1.20x**. Naive server-driven
rendering is not 9x worse than a client SPA at fan-out 2000; it is 20% worse,
and egress passes half a gigabit while the CPU is still under half a core. The
sharp finding is elsewhere: **77.5% of the byte-identical region
of this board sits inside subtrees carrying event handlers**, and handlers capture
the acting account, so A6 as conceived would be forbidden from sharing exactly
the part worth sharing. The protocol change A6 needs first is not per-subtree
revisions — it is handlers that receive the session as an argument. That change
has since landed; the sharing it unblocks has not been built.

## What the probe does

Forty football match markets with two-sided prices from a shared simulator, plus
a shared 20-row trade tape. Every session sees the same board: no names, no
positions, no per-session formatting. Prices move on a seeded random walk at a
configurable tick rate; each tick may also print to the tape.

```
http://localhost:5182/?probe=odds                       impersonal board, 40 markets, 250 ms ticks
http://localhost:5182/?probe=odds&mine=1&user=alice     adds one per-user panel
http://localhost:5182/?probe=odds&markets=8&tickMs=1000 smaller, slower
http://localhost:5182/?probe=odds&tickMs=0              frozen, for deterministic inspection
```

The contended interaction is **take**: Buy or Sell at the quoted price for a
fixed clip of 40. The handler carries intent — market, side, the price the user
saw, and the quote generation that price belonged to — never a delta and never a
resulting position. The server resolves against the live book into one of four
outcomes: `filled` at the quoted price, `partial` (book had less depth than the
clip), `rejected` (price moved past the limit the user named), or `stale` (the
quote generation no longer exists). Resolutions land in a durable ledger keyed by
`account|market|side|quoteSeq`, so a replayed click is idempotent and returns the
original receipt.

Cost measurements come from `scripts/odds-load.ts`, which spawns its own isolated
server on a dedicated port, opens N WebSocket sessions in batches, waits for
every snapshot to land, then reads `/metrics` as a delta around a fixed window.
It confirms isolation by reporting `otherProbeRenders`, which was 0 in every run
below.

```powershell
# the sweep in the table below (quote the list: PowerShell splits bare commas)
npx tsx scripts/odds-load.ts --sessions "1,10,50,100,250,500,1000,2000" --seconds 10 --warmup 4

# personalization cost, and the two keying strategies
npx tsx scripts/odds-load.ts --sessions 250 --mine --seconds 10
npx tsx scripts/odds-load.ts --sessions 250 --quote-keys --move 0.04
```

Tree identity and the render-stage breakdown come from `scripts/odds-sharing.ts`,
which renders N sessions in-process and compares serialized trees with no socket
in the way. The recomputed crossover comes from `scripts/odds_crossover.py`, which
imports `research/cost_model.py` and substitutes the measured per-node cost for
the assumed one. Raw output is in `research/probes/odds/*.json`.

All figures are from one Windows dev laptop, warm, 10-second windows after a
4-second warmup, on a server hosting only this probe.

Two changes to the rendering core landed after these figures were first taken,
and every table below has been re-measured against them, each configuration run
twice. **Address string reuse** — one address object per instance per session
instead of a fresh concatenation every render — moved the CPU and latency
figures and nothing else. Render cost at the plateau fell from 0.098 to 0.083
µs/node, the burst tail at fan-out 2000 from 261 to 231 ms, and the recomputed
crossover from 205 to 202. The gain is marginal rather than fixed: refitting the
tree-size sweep leaves the ~14 µs per-render constant alone and takes the
per-node term from 0.077 to 0.063 µs. **Template whitespace normalization** moved
nothing measured here, because template strings are sent once on connect and this
probe's figures are all steady state; it makes the closing recommendation to send
the full template table on connect cheaper, not different. Sharing ratios, node
counts, tree bytes, patch bytes and retained memory per session are unchanged, the
first two exactly and the rest within run-to-run noise.

## Measurements

### Cost versus fan-out

40 markets, 671 nodes per session, 250 ms ticks (3.9 effective renders per
session-second).

| sessions | renders/s | µs/s | µs/render | µs/node | share of core | B/s per session |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 3.8 | 791 | 208.2 | 0.310 | 0.08% | 31,939 |
| 10 | 37.9 | 3,894 | 102.7 | 0.153 | 0.39% | 31,934 |
| 50 | 189.8 | 13,642 | 71.9 | 0.107 | 1.36% | 31,942 |
| 100 | 379.7 | 24,780 | 65.3 | 0.097 | 2.48% | 31,956 |
| 250 | 949.0 | 53,653 | 56.5 | 0.084 | 5.37% | 31,947 |
| 500 | 1,897.4 | 104,970 | 55.3 | 0.082 | 10.50% | 31,963 |
| 1000 | 3,900.1 | 216,518 | 55.5 | 0.083 | 21.65% | 33,139 |
| 2000 | 7,800.7 | 435,952 | 55.9 | 0.083 | 43.60% | 32,807 |

**Cost is linear in N from the first session.** Renders/s is 3.80 to 3.90 x N
everywhere; CPU is 210–248 µs/s per session from N=100 up; bytes per session are
flat at 32–33 KB/s across a 2000x range. Per-node cost *falls* from
0.310 to 0.084 between N=1 and N=250 and then stops — that is JIT warmth reaching
its floor, not amortization. Nothing shares anything: 2000 sessions rendering an
identical tree perform 2000 identical renders, and the metric proves it to three
significant figures.

Varying tree size at N=1000 separates the fixed and marginal cost:

| markets | nodes | µs/render | µs/node | share of core | B/s per session | RSS/session |
| --- | --- | --- | --- | --- | --- | --- |
| 4 | 203 | 26.9 | 0.132 | 10.20% | 3,798 | 224 KB |
| 40 | 671 | 55.5 | 0.083 | 21.65% | 32,806 | 350 KB |
| 120 | 1,711 | 123.4 | 0.072 | 48.14% | 89,530 | 722 KB |

A render is **~14 µs fixed plus 0.063 µs/node** (that fit reproduces all three
rows within 2%). Per-node cost looks worse on small trees only because the fixed
part dominates them. Address reuse moved the marginal term and left the fixed one
alone, which is what a change to per-node work should look like.

**Does the model's shape match? Yes exactly; the constant is nearly 10x off.**
Finding 3 models non-amortized `sdui` as strictly linear in fan-out, and it is.
But the model assumes 0.8 µs/node for render plus diff. Measured is **0.083
µs/node**. `clock.md` has since been re-baselined against the same runtime and
reads 0.055. The two no longer need reconciling against different builds, but
they still differ by 1.5x, and that gap is application work rather than runtime
work: `app()` here formats prices and walks market arrays per node, where the
clock's nodes are string interpolations. Every non-amortized
server-driven CPU number in finding 3's table is pessimistic by a factor of
nearly ten.

Two costs the model does not carry:

- **Wall-clock per broadcast is 116 µs/session at N=2000**, twice what
  `renderMicroseconds` reports. Micro-benchmarking the stages of one 671-node
  render accounts for most of the gap:

  | stage | µs | µs/node | share |
  | --- | --- | --- | --- |
  | `app()` + `serialize()` | 41.9 | 0.062 | 55% |
  | `diff()` | 6.9 | 0.010 | 9% |
  | `JSON.stringify(update)` | 25.5 | 0.038 | 33% |
  | `countNodes()` for `/metrics` | 2.1 | 0.003 | 3% |
  | total | 76.4 | 0.114 | |

  `renderMicroseconds` covers the first two and the last. The remaining ~40
  µs/session/broadcast is socket write and event-loop overhead, and it is flat in
  payload size across the range measured — which caps the A6 win below.

- **Egress is the real ceiling.** 32.8 KB/s per session means **525 Mbit/s at
  N=2000**, against 44% of one core. Extrapolating both, egress reaches a gigabit
  around fan-out 3,800 while the CPU reaches a full core around 4,600, so the wire
  runs out first — and address reuse widened that gap rather than closing it.
  Finding 3 is a CPU argument, and CPU is not what breaks first here. Dropping the
  move rate from 40% to 4% of ticks cuts
  bytes 5.0x (32,092 to 6,440 B/s per session) with **unchanged CPU** — the
  render happens either way; only the patch shrinks.

### What sharing would save

`scripts/odds-sharing.ts` renders 8 impersonal sessions and hashes the serialized
trees: **1 distinct tree, 671 of 671 nodes and 10,356 of 10,356 bytes shared —
100%, no exceptions.**

The live sweep confirms it end to end. The harness hashes every `update` frame it
receives with the session-specific `revision` stripped, and at every fan-out from
1 to 2000 there was exactly **one distinct patch body** across all sessions
(`identicalFraction: 1` in every run in `odds/*.json`, including the `mine=1` and
quote-key variants).

Extrapolated to the sweep: at fan-out 2000, **1999 of 2000 renders are provably
redundant — 99.95% of 435,952 µs/s, or 436 ms of CPU per wall-clock second spent
recomputing a result the server already has.** That is the strongest form the case
for A6 can take: not "sessions are similar" but "the bytes are equal", measured
at the wire.

**Ceiling on the wall-clock win: 2.9x, not 2000x.** Sharing removes render, diff
and stringify — 76.4 of the 116 µs — but each session still needs its own socket
write, and that write costs ~40 µs regardless of who computed the payload. Shared,
one tick at N=2000 costs `76.4 + 2000 x 40` µs instead of `2000 x 116`. CPU drops
99.95%; total work drops 2.9x; egress does not move at all. The ceiling rose
slightly when address reuse landed, because the part sharing can remove got
cheaper by less than the whole broadcast did.

### The real crossover

`scripts/odds_crossover.py` re-runs `cost_model.py` with the measured constant.
Scenario: 600-node view, 10 renders/s, 5000 sessions. Ratios are server cores
divided by `rt_spa` cores, so **below 1.0 means server-driven is cheaper**.

| per-node cost | sdui plain @2000 | sdui amortized @2000 | crossover with sharing |
| --- | --- | --- | --- |
| 0.800 µs (model assumption) | 9.11x worse | 0.35x — **2.9x cheaper** | 335 |
| 0.083 µs (measured render+diff) | **1.20x worse** | 0.30x — **3.3x cheaper** | **202** |
| 0.172 µs (measured, incl. stringify and send) | 2.19x worse | 0.30x — 3.3x cheaper | 219 |

At the measured constant, across fan-out:

| fan-out | sdui plain | sdui amortized |
| --- | --- | --- |
| 100 | 1.34x worse | 1.16x worse |
| 250 | 1.31x worse | 0.94x cheaper |
| 500 | 1.27x worse | 0.71x cheaper |
| 1000 | 1.23x worse | 0.48x cheaper |
| 2000 | 1.20x worse | 0.30x cheaper |
| 10000 | 1.18x worse | 0.14x cheaper |

And the live-ops dashboard scenario from `economics.md` (2000 concurrent, fan-out
2000, 800-node view):

| per-node cost | rt_spa cores | sdui cores | sdui amortized cores | sdui burst |
| --- | --- | --- | --- | --- |
| assumed 0.800 | 2.34 | 25.67 | 0.09 | 1.280 s |
| measured 0.083 | 2.34 | 2.72 | 0.07 | 0.133 s |
| effective 0.172 | 2.34 | 5.57 | 0.07 | 0.275 s |

**Does finding 3's structural advantage survive measurement? Yes — the advantage
survives nearly unchanged, and the crossover moves down. What does not survive is
the urgency.**

- The mechanism is exactly as described. Amortized server cost is flat in fan-out
  (2.11 to 2.24 cores from fan-out 1 to 10,000); client cost is linear; they must
  cross, and they do. The claim that client rendering cannot deduplicate across
  users at any price is confirmed here in its strongest form — the duplicated
  work is provably byte-identical.
- The crossover **falls from 335 to 202**, because the server got cheaper relative
  to the model. Note also that the model as coded crosses at 335, not the "roughly
  500" the prose says.
- The amortized win at fan-out 2000 is **3.3x cheaper**, slightly *better* than the
  2.9x the assumed constant predicted. It barely moves with the render constant,
  because amortized server cost is dominated by per-session socket and session
  overhead rather than rendering — which is the same reason the 2.9x wall-clock
  ceiling exists.
- **The penalty for not sharing collapses from 9.11x to 1.20x at fan-out 2000.**
  This is the real correction, and unlike the modelled penalty it now shrinks as
  fan-out grows, from 1.34x at 100 to 1.18x at 10,000, because per-node render
  cost has stopped being what dominates. The model said naive server-driven
  rendering at fan-out 2000 costs 25.7 cores against a client SPA's 2.3;
  measured, it costs 2.7 (5.6 all-in). A 9x CPU penalty is an emergency. A 20%
  penalty is a line item, and it buys the entire server-authoritative property.

So finding 3's headline is safe and its supporting narrative is not. A6 is still
the thing that makes server-driven *cheaper* than a client at scale, but the
runtime without A6 is not in the cost trouble the model implies.

### Burst fan-out

One price change, timestamped in the simulator before the tick publishes,
measured to arrival at every session (`emittedAt` rides in the tree as a data
attribute, so the timestamp survives serialization).

| sessions | p50 | p95 | max | spread first→last |
| --- | --- | --- | --- | --- |
| 1 | 0.2 ms | 0.4 ms | 0.6 ms | 0 ms |
| 10 | 1.7 ms | 2.9 ms | 3.3 ms | 2.6 ms |
| 50 | 5.4 ms | 8.1 ms | 9.2 ms | 8.8 ms |
| 100 | 10.2 ms | 12.7 ms | 13.4 ms | 12.9 ms |
| 250 | 24.8 ms | 29.9 ms | 30.1 ms | 29.0 ms |
| 500 | 48.5 ms | 58.6 ms | 60.3 ms | 59.3 ms |
| 1000 | 100.3 ms | 112.2 ms | 116.0 ms | 115.8 ms |
| 2000 | 200.1 ms | 220.0 ms | 231.4 ms | 230.7 ms |

**Finding 7 reports 1.28 s at fan-out 2000; measured is 231 ms — about 5.5x
better**, for the same reason the CPU numbers are nearly 10x better. Reassuringly,
my measured 231 ms sits between the recomputed model's render-only estimate (133
ms) and its all-in estimate (275 ms), so the model's burst formula is sound once
the constant is right.

Finding 7's *structure* is confirmed exactly: the last session served waits for
every other, so the tail equals `N x per-session-broadcast-cost` and is linear in
fan-out. At N=2000 the spread (230.7 ms) is 99.7% of the max — queueing is the
entire latency.

The operational risk is real at a different threshold, and address reuse moved
that threshold rather than removing it. **A 250 ms tick against a 231 ms tail now
drains, with 8% of the budget to spare; at the 261 ms tail recorded before the
change it did not.** Nineteen milliseconds is not margin. Grow the tree instead of
the population and it fails again: at 120 markets and N=1000 the tail is 257 ms,
down from 322 ms and still over the tick. That is the actual capacity limit of
this probe, and it is a latency limit while the CPU sits at 44%.

### Cost of one personalized element

`?mine=1` adds one panel: the account's open position and last three receipts.

| configuration | identical trees | node identity | byte identity | distinct patch bodies |
| --- | --- | --- | --- | --- |
| impersonal, 8 sessions | 8 of 8 (1 group) | 671/671 = **100%** | 10,356/10,356 = **100%** | 1 |
| `mine=1`, 8 sessions | **0 of 8** (8 groups) | 660/677 = **97.49%** | 8,665/10,504 = **82.49%** | 1 |

**`design-probes.md`'s prediction is confirmed at the level it was made and
refuted one level down.** Session-level sharing collapses completely: one per-user
element makes every tree unique, so a whole-tree cache scores exactly zero. But
the divergence is confined to **two addresses** — `root` (whose hole set now
includes the panel) and `root/h9` (the panel itself). Every one of the 40 market
rows and every tape row hashes identically in all 8 sessions.

Note the gap between the two identity columns: the panel is 17 nodes (2.5%) but
1,839 bytes (17.5%). Per-user content here is byte-heavy relative to its node
count, so node-based and byte-based estimates of what sharing saves are not
interchangeable.

Live at N=250, the panel is **free**: 56,778 µs/s against 57,406 impersonal and
7.96 MB/s against 8.02 MB/s, both marginally *lower* and inside run-to-run noise,
for +6 nodes per tree. What one personalized element destroys is not throughput —
it is only the coarsest possible sharing strategy.

The design consequence: **A6 must be per-subtree or it is worthless.** Whole-tree
sharing works for an impersonal board and breaks the moment anyone puts a name in
the header. Per-subtree sharing survives personalization with 97.5% of the nodes
and 82.5% of the bytes still shared.

### A4: which interactions cannot be predicted

Measured in the browser at the 400 ms latency preset. Three consecutive takes,
each clicked on a visibly quoted price:

| button showed | server returned | settled |
| --- | --- | --- |
| `1.74 x 57` | **partial · 18 @ 1.76** — only 18 of 40 available at 1.76 | 412 ms |
| `7.55 x 43` | filled · 40 @ 7.55 | 417 ms |
| `2.99 x 26` | **partial · 26 @ 2.99** | 414 ms |

The first row is the whole argument. The client had `1.74 x 57` on screen. An
optimistic renderer, using the only information the client has, would have drawn
"bought 40 @ 1.74". The truth was **18 @ 1.76** — wrong size, wrong price, wrong
notional. That is not a flicker that resolves; it is a **false statement about a
financial obligation**, displayed for 412 ms, and a user who acts on it (takes a
second clip, hedges, stops watching) has been misled by their own UI.

Four outcomes, none client-derivable:

1. **`filled`** — needs current depth at the quoted price. Depth is shared,
   contended, and moves between render and click.
2. **`partial`** — same, and its magnitude is arbitrary (18 of 40, 26 of 40).
3. **`rejected`** — needs to know whether the price moved past the user's limit
   *during the flight of their own click*. Unknowable in principle: the deciding
   event happens after the client stops having information.
4. **`stale`** — needs to know whether the quote generation still exists.

The only safe prediction is the empty one: mark the button pending. This probe
does that, and it is the correct A4 answer for the domain — the honest optimistic
render of a contended trade contains no information.

**The stale-click hazard, and where the address boundary has to go.** Two tests in
`test/probes/odds.test.ts` are the same click under two keying strategies, and
they resolve differently:

- Rows keyed by `market.id` (default): a click that left at 1.74 arrives at a live
  handler which has since re-bound to 1.76, and **executes at 1.76**. The user's
  intent named 1.74 and was honoured only because the limit check happened to
  pass. This is the browser measurement above.
- Rows keyed by `market.id:market.quote` (`ODDS_QUOTE_BINDING=key`): the price
  change destroys the address, the click lands nowhere, and the runtime returns
  `stale_event`. The user is told their click was too late, which is true.

So **the safety of a discrete action against a moving price is decided by list
keying** — an authoring choice that looks like a rendering detail. Key-binding
costs +3.0% bytes at a 40% move rate (every price change replaces the row instead
of patching two values) and **4.25x** at 4%, where row churn dominates an
otherwise quiet patch. It is the right default for a real trading surface and the
wrong one for a spectator board; the probe supports both and neither is free.

Independent of keying, the ledger's idempotency key contains `quoteSeq`, so a
replayed click can never double-fill — the second delivery returns the first
receipt. Rejections are visible only to the session that caused them, which the
tests assert.

## What it forced

**S1: can renders be shared? Yes, and this probe is the maximal case — which is
why its limits are the informative part.** Trees are byte-identical, patches are
byte-identical, and 99.95% of the CPU at fan-out 2000 is provably redundant. If
sharing is ever worth building, it is worth building here. Three requirements fall
out of *which* subtrees were identical, ordered by how much they block.

**1. Handlers must take the session as an argument. This is the blocker.**
Serialization already interns identical templates and produces identical instance
addresses across sessions, so the tree *bytes* are shareable today. The handler
*table* is not: every market row closes over `account`, so two sessions whose rows
are byte-identical hold different closures behind the same address. And the
handler-bearing region is not a corner of the tree — the 40 market rows are **520
of 671 nodes, 77.5%** of everything shareable; the tape, header and chrome are the
other 151. Without a change here, A6 could share only the handler-free 22.5%, and
its headline number becomes almost nothing. The minimal fix is to give the server
handler signature the acting session (`(payload, session) => unknown`) so a shared
closure resolves who clicked at dispatch time rather than at render time. That
lives in `shared/protocol.ts` and `server/serialize.ts` (do-not-edit), so it is a
proposal — but every other part of A6 is downstream of it.

**Since built.** The handler signature is now
`(payload: EventPayload, session: SessionHandle) => unknown`, and the runtime
calls it with the session that *sent* the event rather than the one the tree was
rendered for, which is what makes one closure correct for every viewer. No
handler in this probe changed, because a shorter function stays assignable. What
that removes is the reason A6 could not start: requirements 2 and 3 below are
untouched, nothing in the runtime shares a render, and the 99.95% above is still
a measurement of redundancy rather than of a saving. `session.params` is also
standing in for identity and is a client-chosen value, so a shared closure
resolving the acting account from it is not doing authorization.

**2. Per-subtree revision, because the session revision is already the only thing
blocking reuse.** The clearest evidence is an accident of the harness: to compare
patches across sessions I had to strip `"revision":N` before hashing, because
sessions on different revision counters were receiving operation-for-operation
identical patches. The revision is the *sole* session-specific content in an
otherwise shareable frame. A shared subtree advances on ticks while a session's own
panel advances on its own events, and one monotonic counter per session cannot
describe both. A6 needs a revision per independently-versioned stream and a client
that tracks them separately.

**3. Splicing needs no new address scheme — I4 already gave one.** I expected
address translation to be the hard part; it is not. Instance ids are derived from
structural position, so `root/h6/k:m12` names the same node in every session, and
under `mine=1` the divergent addresses were exactly `root` and `root/h9`. A shared
frame can be forwarded to every subscriber byte-for-byte with no rewriting. What
splicing *does* need is a per-subtree committed tree on the server (diff currently
runs against a per-session previous tree) and an ordering rule between a shared
frame and a personal one.

One thing that will bite: **template delivery is per-session state**
(`sentTemplateIds`), so a shared frame cannot carry `templates` unconditionally — a
late joiner needs them and an established session does not. Templates are a small
fraction of startup cost and none of steady state, so the cheap answer is to send
the full template table on connect and keep shared frames template-free.

**What I would do with these numbers.** Build A6, but not for the reason finding 3
gives. The CPU argument is much weaker than advertised — the penalty for not
sharing is 1.20x, not 9.11x — and the wire saturates first regardless. The
compelling arguments are the other two measurements: **burst latency**, where
sharing removes the 76 of 116 µs per session that decides whether a 250 ms tick can
drain at all, which this probe now clears by 19 ms at N=2000 and still misses at
120 markets, and is exactly finding 7's operational risk; and **99.95% provable
redundancy**, which justifies the work on
principle even when the absolute cost is affordable. Build it per-subtree from the
start: the `mine=1` measurement shows whole-tree sharing scores zero on any board
with a name in the corner, while per-subtree keeps 97.5% of nodes.

**A4, stated as a rule.** Prediction is illegal when the outcome depends on state
the client cannot see at the moment the server decides. Every take in this probe
qualifies, and the measurement shows the failure is not cosmetic: the client's best
guess was wrong on price *and* size, and would have been displayed as fact for 412
ms. A4 needs a way for an app to declare an action unpredictable and get
pending-state machinery instead of a guess. What it must not do is offer a general
optimistic-render facility and trust authors to opt out.

## Where I hit a wall

No do-not-edit file needed changing. Four limits worth recording:

1. **The handler signature blocks the interesting half of A6** — item 1 above.
   This is the one real wall: I can measure that 77.5% of the shareable tree
   carries handlers, but I cannot demonstrate sharing it without changing
   `shared/protocol.ts`. **The signature has since changed, so the wall is gone
   and the demonstration is still missing.**
2. **`/metrics` has no RSS and cannot be scoped or reset.** Memory per session
   comes from `tasklist`/`ps` around the load window, and the delta is only
   meaningful at high fan-out — at N=1 and N=10 it comes out *negative*, because
   GC noise in a ~99 MB baseline swamps a few hundred KB. It converges to **350
   KB/session** at 671 nodes (224 KB at 203 nodes, 722 KB at 1,711), against a
   10.3 KB serialized tree: a **34x retention factor**, and 1.6x the model's
   assumed 220 KB. `retainedBytesPerSession` is a running average since boot and
   should be ignored.
3. **No per-broadcast timing.** `renderMicroseconds` excludes `JSON.stringify`
   (33% of stage cost) and the socket write (~40 µs/session), so both are invisible
   to `/metrics` and had to be recovered by micro-benchmark plus wall-clock
   subtraction. A `broadcastMicroseconds` counter would make the A6 ceiling
   directly measurable instead of inferred — and the 2.9x ceiling is the number
   that should decide whether A6 gets built. Re-measuring after address reuse
   showed how weak the subtraction is: the residual it attributes to the socket
   write fell from ~50 to ~40 µs/session, which no part of that change should
   touch, so some of it was never socket write to begin with.
4. **`subscribe` fires for every session on any shared change.** A fill by one
   account invalidates all N sessions through `ledger.onChange`, including sessions
   without `mine=1` that cannot display a receipt. Same read-scoped invalidation
   `clock.md` recommends; this probe adds the observation that with the tape present
   the invalidation is *usually* legitimate, so the win is smaller here than in the
   clock case.

   **Read-scoped invalidation has since been built, and this is the first probe
   where it would pay.** Taking it needs an application change as well as a store
   change: `OddsBoard` calls `useStore(props.ledger)` at the top of the tree in
   every session, because the take handler closes over the ledger, so a
   self-identifying ledger would still match every session's read set and skip
   nothing. Confining that read to the sessions rendering their own book is a
   change to what this probe renders and would move the figures published above,
   which is why it was deliberately not made. The ledger notifies without naming
   itself today, so the probe behaves exactly as measured. Worth knowing before
   building on this: what shipped records reads per session, which is the right
   model only while one render serves one session, so A6 is the thing that makes
   it wrong. `research/tech-debt.md` carries it.

## What a reader should not conclude

- **That 99.95% redundancy is what a real dashboard offers.** This board is
  impersonal by construction — no names, no localization, no currency, no
  authorization-dependent rows. It is the ceiling, chosen to be the ceiling. The
  `mine=1` numbers are the realistic ones, and the honest headline from them is
  97.5% of *nodes* and 82.5% of *bytes*, not 99.95% of *renders*.
- **That the crossover at 202 is a measurement.** It is `cost_model.py`'s scenario
  with one constant replaced. The client side of that comparison is entirely
  modelled — no browser was benchmarked — so 202 is "where the model puts the
  crossover once the server number is real", not an observed crossing. Note also
  that `scripts/odds_crossover.py` still carries the pre-change constants; the
  figures above come from running its model with 0.083 and 0.172 substituted.
- **That 0.083 µs/node is application cost.** `app()` here formats prices and walks
  pre-built arrays: no queries, no authorization, no I/O. This is the runtime's
  floor. A real market app's per-node cost is unbounded and unmeasured.
- **That 2000 sessions is a capacity claim.** One warm Node process, one laptop,
  loopback sockets, no TLS, no proxy, clients that only parse. At N=2000 the
  broadcast drains inside the 250 ms tick with 19 ms to spare, so the last rows of
  these tables describe a server with no margin rather than one with capacity in
  hand — and they described one that was already behind until address reuse landed.
- **That the burst numbers are comparable to finding 7's.** Mine are localhost with
  no network; finding 7's 1.28 s presumably includes transit. What transfers is the
  structure — tail linear in fan-out, queueing dominant — not the 5.5x.
- **That `stale_event` is a solved problem.** Key-binding quotes makes stale clicks
  fail safely, and it costs bytes (up to 4.25x on a quiet board) and turns every
  price change into a row replacement. I made value-binding the default and the
  tests document both. A real venue needs the safe mode and should expect to pay
  for it.
