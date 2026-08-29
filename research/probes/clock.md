# Ticking clock

**Forces S3: what is the granularity of invalidation?**

The result in one paragraph. Render plus diff costs **0.055 µs per marginal
node** — roughly fifteen times cheaper than the 0.8 µs `economics.md` assumed,
and ninety times cheaper than the 5 µs its sensitivity analysis warns about. The
assumption holds with room to spare, so the absence of dependency tracking is
not a cost emergency: fifty sessions watching a 2,000-node dashboard tick once
a second cost 0.6% of one core. But the *waste ratio* is not small and grows
linearly with the tree: one changed value re-renders 32,000 nodes at 8,000
rows, a **178x** overpayment, and a session that does not display the clock at
all pays the entire cost to emit **zero bytes**. The recommendation is
therefore not the reactive dependency graph the register asks about, but two
cheaper mechanisms that capture most of the win — read-scoped session
invalidation and author-declared subtree memoization — described at the end. The
first of those has since been built; the clock store does not participate in it,
so no figure here moved.

## What the probe does

A dashboard with one live seconds display and an arbitrary amount of inert
content next to it. The clock is the only value in the tree derived from shared
state, and it occupies exactly one hole, so any operation beyond a single `set`
is work the runtime did because it had no way to know it was unnecessary.

```
http://localhost:5182/?probe=clock                    200 inert rows, 1 Hz
http://localhost:5182/?probe=clock&rows=2000          8,016 nodes
http://localhost:5182/?probe=clock&rows=500&clock=off a session that reads nothing shared
http://localhost:5182/?probe=clock&tickMs=250         four renders per visible change
http://localhost:5182/?probe=clock&counter=on         per-session render count
```

A shared `setInterval` publishes through `probe.subscribe`. It is armed only
while at least one session is attached and ticking is enabled, so the probe
costs nothing when nobody is watching; Start/Pause are shared-state handlers
carrying absolute intent, and `?running=off` leaves the server quiet from a
script.

Load and cost measurements come from `scripts/clock-bench.mjs`, which opens N
WebSocket sessions, lets them sit idle, and reads `/metrics` as a delta around
the measured window:

```bash
node scripts/clock-bench.mjs --rows 500 --sessions 20 --seconds 20 --tick 1000
node scripts/clock-bench.mjs --rows 2000 --sessions 20 --seconds 20 --clock off
```

The baseline sample is taken *after* every snapshot has landed, so each
session's one expensive first render does not contaminate the steady-state
numbers. All figures below are from one Windows dev machine with the ordinary
`npm run dev` server, warm.

## Measurements

> **Re-baselined after two changes to the rendering core.** Templates are now
> interned with source indentation collapsed, which took this probe's layout
> payload from 1,501 to 1,038 bytes and left everything else on the wire exactly
> as it was: the snapshot, the node counts and the 124-byte tick carry addresses
> and hole values, not template strings. Separately, instance addresses are
> interned and handed back by identity on every render, and that is where the CPU
> figures below moved. The gain grows with the tree — a 16-node tree is
> marginally *slower* than it was, a 32,016-node one is 1.75x faster — so every
> per-node and per-second number in this section is re-measured, while every byte
> count except the template payload is unchanged. Each configuration was run at
> least twice and the figures are medians.

### Microseconds per node, measured

Steady-state renders (app + serialize + diff), 20 sessions, one tick per
second, clock visible:

| rows | nodes | µs per render | µs per node |
| --- | --- | --- | --- |
| 0 | 16 | 10.0 | 0.62 |
| 146 | 600 | 53.7 | 0.089 |
| 500 | 2,016 | 152.0 | 0.075 |
| 2,000 | 8,016 | 483.5 | 0.060 |
| 8,000 | 32,016 | 1,768.0 | 0.055 |

Single-session runs at 200 ms ticks, ~98 renders each, two passes, agree within
10%: 0.46–0.51 µs/node at 216 nodes, 0.157–0.166 at 2,016, 0.113–0.120 at
8,016. A single lightly-warmed session is two to three times more expensive per
node than the same tree under twenty of them, and address reuse does not help
it: the saving is in work that repeats, and a session that has rendered a
hundred times has barely started repeating.

The shape is a fixed per-render cost of roughly 10 µs plus **0.055 µs per
node**. Per-node cost looks worse on tiny trees only because the fixed part
dominates them.

**Does the `economics.md` assumption hold? Yes, conservatively.** At the 400–800
node views that document models, measured cost is 0.089 µs/node against an
assumed 0.8 — a 9x margin. The pessimistic 5 µs scenario, which would have
moved the fan-out crossover past any real audience, is 90x from the measured
value and can be discarded. Every server-driven CPU projection in
`economics.md` is therefore pessimistic by roughly an order of magnitude.

Diffing is the cheap half, though the server's own counters can no longer show
it: a first render is one cold render per session and now varies from 0.42 to
1.05 ms at 8,016 nodes, which is wider than the difference being measured. In
process and warm (`scripts/clock-boundary-cost.ts`, 8,002 nodes, 500
iterations), serialize alone costs 236 µs and serialize plus diff costs 326 µs,
so diff is a little over a quarter of the total. Making diff faster is still not
the lever; not building the tree is.

### Bytes sent versus bytes that changed

One tick, verbatim, at any tree size:

```json
{"type":"update","revision":2,"templates":[],"operations":[{"op":"set","instanceId":"root/h0","hole":0,"value":"23:20:00"}]}
```

124 bytes to deliver a 10-byte value: **12.4x amplification**, entirely protocol
framing and addressing. It is identical at 50 rows and at 8,000 rows — the
patch does not know how big the tree is — and it never contains layout. Across
every configuration measured the ratio stayed at 12.45–12.46; the only variation
is the digit count of the revision number.

For scale, the initial payload at 500 rows is 1,038 bytes of layout and 60,429
bytes of values, so templates are 1.7% of what a session costs to start and 0%
of what it costs to keep. **I3 is not the problem**, and normalization has made
it less of one. Idle ticking costs 124 B/s per session, about 446 KB per
session-hour; 2,000 sessions watching a clock is roughly 2 Mbit/s of egress
that carries ten characters of information per second.

### Quiet renders: full cost, zero output

`quietRenders` counts renders that produced no operations and no templates.

| configuration | renders | quiet | CPU | bytes sent |
| --- | --- | --- | --- | --- |
| 500 rows, 20 sessions, clock hidden | 400 | 400 (100%) | 2,932 µs/s | **0** |
| 500 rows, 1 session, 200 ms tick | 99 | 78 (78.8%) | 1,527 µs/s | 2,493 |
| 500 rows, 1 session, 250 ms tick, hidden, counter on | 77 | 0 (0%) | 1,067 µs/s | 10,843 |

The first row is the cleanest evidence S3 could ask for: twenty sessions that
display nothing derived from the clock spend 2.9 ms of CPU every second
rendering, serializing and diffing 40,300 nodes, and send nothing at all. The
work is not merely redundant, it has no output.

The second row is the same point without hiding anything: ticking at 4 Hz
against a seconds display means four of every five renders are provably
pointless, and the runtime cannot tell which.

The third row is the observability paradox. The per-session render counter is
the only way an app can see its own render rate, and displaying it requires a
side effect in the render path — which makes every render produce a change,
turning 100% quiet into 0% quiet and 0 bytes into 10.8 KB. **Measuring the
waste from inside the app creates it.**

### The cost of an idle-but-ticking app

Nobody interacting; the only activity is the tick.

| sessions | rows | nodes | renders/s | µs/s | share of one core | µs/s per session |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 500 | 2,016 | 1.0 | 366 | 0.04% | 366 |
| 5 | 500 | 2,016 | 5.0 | 872 | 0.09% | 174 |
| 20 | 500 | 2,016 | 20.0 | 3,030 | 0.30% | 152 |
| 50 | 500 | 2,016 | 50.0 | 6,163 | 0.62% | 123 |
| 20 | 2,000 | 8,016 | 20.0 | 9,667 | 0.97% | 483 |
| 20 | 8,000 | 32,016 | 20.0 | 35,336 | 3.53% | 1,767 |
| 20 | 0 | 16 | 20.0 | 198 | 0.02% | 9.9 |

Cost is exactly linear in `sessions x ticks/s x nodes`; per-session cost drifts
*down* with more sessions, which is JIT warmth rather than any sharing. Nothing
in the runtime amortizes anything across sessions — fifty sessions rendering an
identical tree do fifty identical renders.

Extrapolated to one saturated core at 1 Hz: ~18,600 sessions at 600 nodes,
~6,600 at 2,016, ~2,070 at 8,016, ~566 at 32,016. Those are the ceilings for an
application where **no user does anything at all**.

The last row is the useful one. A tree containing only the clock costs 9.9 µs
per session-second, which is what perfect subtree invalidation would
approximately cost. Against that floor:

| view size | overpayment for one changed value |
| --- | --- |
| 600 nodes | 5.4x |
| 2,016 nodes | 15.4x |
| 8,016 nodes | 49x |
| 32,016 nodes | 178x |

The ratios roughly halved, from both ends: address reuse made the large trees
much cheaper while leaving the 16-node floor slightly dearer than it was. The
shape of the finding is unchanged — the overpayment still grows linearly with
the tree, and is still nearly two hundredfold at the top end.

### Latency

The pause control is a shared-state mutation and costs a full round trip: 4 ms
perceived at localhost, **416 ms** at the 400 ms preset. The clock display is
also always one half-trip stale, so at 400 ms the second shown is up to 200 ms
old — which is the correct behaviour for a server-authoritative value and worth
noting only because it is the one place where "the server owns the truth" is
visible as a wrong number on screen.

## What it forced

**S3, restated with numbers.** The runtime has one granularity, and it is
"every session, whole tree." The measured consequence is not that this is
expensive in absolute terms — it is 15x cheaper than the model assumed — but
that the fraction of the work which is useful falls as `changed_nodes /
total_nodes`, and in the honest case (a session that does not display the
changed value at all) that fraction is zero while the cost is unchanged.

Two cost regimes follow from `sessions x changes/s x nodes`:

- The `economics.md` live-ops dashboard — 2,000 concurrent, 600 changes/min,
  800 nodes — costs a measured **1.1 cores** to move ten values per second.
  Affordable, and about 100x more work than the change required.
- Ten times more of anything — 20,000 sessions, or 100 changes/s, or 8,000-node
  views — needs 11 cores to move the same ten values, which is a machine bought
  entirely to discard its own output.

So the answer to "does the runtime need to track which subtree read which data"
is: **not in that form, and not yet.** A read-to-subtree dependency graph is
precisely the reactive machinery the project set out to delete, and it would
have to be maintained across every render of every session to save CPU that is
currently affordable. What the measurements do justify is two narrower
mechanisms, in this order.

**1. Read-scoped session invalidation. Recommended now.** Let a session record
which shared stores it read during its last render, and skip re-rendering
sessions whose read set does not include the store that changed. This is a set
of store identities per session, not a graph of values, and it is invalidated
wholesale on every render, so there is no incremental bookkeeping and no
reactivity. It costs one authoring concept at most — probes already publish
through `subscribe`, so the runtime could pass the changed store's identity to
`invalidate` and let sessions filter. It takes the 100%-quiet case (the largest
and most embarrassing measurement here, 2.9 ms/s for zero bytes) to zero, and
it is the same mechanism the register's related concern about `sdui_naive`
query deduplication needs.

**Since built, essentially as specified.** A session records the stores its last
committed render read through `useStore`; a store that names itself as the
change source lets the runtime skip every session whose read set excludes it;
`scopedSkips` in `/metrics` counts the renders that avoids. A store that names
nothing re-renders everyone as before, and a session that declared no reads is
treated as reading everything, so adoption is per store rather than all at once.
Two things this probe cannot claim from it. The clock store names nothing, so
every measurement above stands unchanged. And the 100%-quiet configuration would
not go to zero on a store change alone: scoping matches on store identity, and
the hidden-clock session still reads the same store for the Start/Pause
controls, so it would have to stop reading it to be skipped.

**2. Author-declared subtree memoization. Recommended when a probe needs it.**
A `cached(key, deps, render)` hole that returns the previous `TemplateResult`,
and its already-serialized subtree, when `deps` are unchanged. Diff can then
skip an identical subtree by reference instead of walking it. This collapses
the 2,000 inert rows to one pointer comparison and turns the 178x overpayment
into something near 1x, without the runtime ever knowing what data anything
read — the author declares the boundary, exactly as they already declare
`keyed()` boundaries. It is the same construct S1/A6 needs for shared subtree
rendering, since a memoized subtree is the natural place to hang a subtree
identity and revision. The risk is the ordinary stale-memo bug class, which is
why it should wait for a probe that actually needs it rather than being added
speculatively.

**3. Full dependency tracking. Refuse until something forces it.** The two
mechanisms above multiply with S1's sharing (sharing divides by sessions,
memoization divides by tree fraction), and together they cover every case this
probe can produce. Adopting a reactive graph would relocate client-framework
complexity into the runtime for a constant factor that measurement shows is
already 15x better than budgeted.

One more thing the numbers say plainly: **the wire is fine and the CPU is the
whole story.** 124 bytes per tick with layout sent once is the design working as
advertised. Every proposal above is about not building trees, not about sending
fewer bytes.

## Where I hit a wall

No file on the do-not-edit list needed changing. Three smaller limits, none
blocking:

1. **A session cannot observe its own renders without causing them.** There is
   no per-session render hook or read-only counter, so the render count has to
   be incremented inside `app()`, which makes every render produce a patch —
   the third row of the quiet-render table. I would propose a read-only
   `session.renderCount`, or an `onRender` callback on `ProbeInstance` that
   fires after commit and cannot itself invalidate. Not implemented: it is in
   `server/runtime.ts` and `server/probes/types.ts`.

2. **`subscribe` cannot tell whether anyone is connected.** The runtime
   subscribes once at boot regardless of session count, so a probe that wants
   to stop a timer when the last viewer leaves has to count `createApp` and
   `dispose` itself, as this one does. Passing the live session count to the
   subscribe listener, or subscribing lazily on the first session, would make
   the common "don't simulate anything for an empty room" case free.

3. **`/metrics` cannot be scoped or reset.** Every counter is cumulative per
   probe since boot, so measuring one configuration requires delta arithmetic
   in the harness. `retainedBytesPerSession` is a running average and cannot be
   attributed to a configuration at all — the numbers it reports here (72–100
   KB) are an average across every tree size I ran and should be ignored in
   favour of the measured serialized tree: 7.3 KB at 50 rows, 18.8 KB at 146,
   61.5 KB at 500, 244.3 KB at 2,000, 980 KB at 8,000.

One authoring smell worth recording rather than fixing: `?tickMs=` and
`?running=` write *shared* state from a per-session query parameter, so the
last connection wins. It exists so a load script can leave the server quiet,
and it is not a pattern to copy.

## What a reader should not conclude

- **That 0.055 µs/node is what a real app costs.** These nodes are string
  interpolations over a pre-built array. The measurement covers `app()`,
  `serialize()` and `diff()`, and in this probe `app()` does nothing an
  application would recognise as work — no queries, no formatting, no
  authorization checks. The *runtime's* share of per-node cost is what is
  measured here; application cost per node is unbounded and unmeasured.
- **That the waste ratios transfer.** A dashboard where one value changes and
  8,000 rows do not is the extreme end on purpose. A real view where a mutation
  moves a counter, a badge, three totals and a row has a much better ratio, and
  the case for dependency tracking is correspondingly weaker.
- **That the session ceilings are capacity numbers.** They are one warm Node
  process on a developer laptop, measured against a shared dev server that was
  hosting two other probes with three live sessions. They are the right order of
  magnitude and not a benchmark; they also assume every session is idle, which
  is the least interesting workload a server can have.
- **That quiet renders are free to eliminate.** The 100%-quiet configuration is
  produced by a session electing not to display the clock. A real session that
  reads a store and renders nothing from it *today* may render something from it
  tomorrow, and read-scoped invalidation has to be recomputed per render for
  exactly that reason.
- **That this probe says anything about S1.** Fifty sessions rendering an
  identical tree here do fifty identical renders, and nothing in the numbers
  above shows what sharing would save. That is the scoreboard probe's job.
