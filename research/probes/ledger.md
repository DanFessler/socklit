# Ledger

**Forces: S3, A4.**

The headline is that this probe falsifies the reason it was commissioned.
[`design-probes.md`](../design-probes.md) lists Ledger as "the strongest argument
for S3, because *one edit invalidates every total* is the case dependency
tracking has to handle." Measured, it is the opposite. When one edit really does
invalidate every total, a dependency tracker correctly concludes that everything
must be recomputed, and it has cost something to reach a conclusion the current
render-everything-then-diff pipeline reaches for free. **A dense dependency graph
is the case dependency tracking cannot help.** The argument for S3 lives in
sparse graphs over large trees, which is the ticking clock, not the ledger.

The secondary result is that finding 4 in [`economics.md`](../economics.md) is
right in direction and conservative in magnitude, and that its magnitude depends
entirely on one modelling choice it does not state explicitly: whether the SPA's
invalidate-then-refetch is serial with the mutation.

The third result is that A4 is close to worthless here. Ten of the fifteen
mutations in this app are unpredictable because the client lacks *data*, not
because prediction is hard, so the ceiling on the advantage a declarative
prediction feature could recover is 20% of the mutation surface — and all three
of those cases are already covered by A2.

---

## What the probe does

An accounts-receivable screen: one draft invoice being edited, plus the posted
history it rolls into. Eleven derived views, none of them stored:

1. per-line gross, discount, net, VAT, levy and line total
2. document subtotal, discount, net, VAT, levy, total
3. the same total converted to the base currency
4. a per-account revenue rollup with percentage shares
5. a per-tax-code rollup
6. a double-entry journal preview
7. the journal's debit/credit balance check
8. a line-validity panel and a postability flag
9. an aging table bucketed against an "as of" date
10. a running balance across posted documents plus the draft
11. the posted-document register with settlement state

Three derived quantities are deliberately impossible for a browser to predict,
and they are what make the probe an A4 instrument rather than a demo:

- **A graduated document levy.** The rate is banded on the *document's* leviable
  net, then apportioned back across lines by largest remainder. One line's
  displayed levy therefore depends on every other line's amount.
- **Currency conversion.** The rate lives in a server-side table with a dealing
  spread and a deterministic per-date drift.
- **The document number.** `INV-2026Q3-0001-11` — a gap-free per-period sequence
  allocated under the store's mutex, with ISO 7064 MOD 97-10 check digits.

Discount is also apportioned by largest remainder, and per-line VAT uses
round-half-to-even. Together these mean **editing line 1 moves the cents
displayed against line 7**, which is the specific thing an optimistic row patch
cannot get right.

### Running it

```bash
npm run dev
# http://localhost:5173/?probe=ledger
# http://localhost:5173/?probe=ledger&latency=400
```

The "Seed 10 / 100 / 500 lines" buttons set document size for the S3
measurements. Per-size render cost is also reproducible without a browser:

```bash
npx tsx server/probes/ledger/bench.ts
```

`/metrics` is cumulative for the process lifetime, so the numbers below were
taken as deltas around each phase rather than read off directly. See
[Where I hit a wall](#where-i-hit-a-wall).

---

## Measurements

Two changes to the rendering core landed after these figures were first taken.
Everything `bench.ts` produces has been re-measured against them; the live
`/metrics` and latency readouts still need a browser and were not. **Template
whitespace normalization** collapses a template's source layout when it is
interned, and moved exactly one number here: template bytes, from 14,161 B to
9,062 B, a 36% saving at every document size. Snapshot bytes, node counts,
operation counts and per-edit bytes are untouched, because those carry instance
addresses and hole values rather than template strings. **Address string reuse**
moved nothing here that survives run-to-run noise: over ten consecutive runs the
bench's µs/node and µs/render straddle the figures already recorded, which is
consistent with a change that pays for itself across many concurrent sessions
rather than within one. This probe is a single session.

### Fan-out of a single edit

One quantity change on line 1 of the seeded six-line document, measured by
diffing the derived view before and after:

**44 derived leaf values move, spread across 18 distinct derived groups.**

| Derived view | Leaves moved | Why |
| --- | --- | --- |
| `lines` | 15 | the edited row's 6 cells, plus levy and total on 4 *other* rows |
| `accounts` | 5 | one row's net, and the percentage share of all four |
| `taxes` | 5 | net/VAT/levy for the edited code, levy for two others |
| `journal` | 4 | the receivable debit and three credits |
| `balance` | 2 | the draft row's movement and the closing balance |
| `aging` | 1 | the draft bucket |
| 12 document scalars | 12 | subtotal, discount, net, leviable net, VAT, levy, effective levy rate, total, base total, journal debit, journal credit, closing balance |

On the wire that arrives as a **single frame of 49 `set` operations, 3,560
bytes, zero templates, zero `list` operations and zero `replace` operations**.
The event that caused it was 116 bytes.

The four untouched rows are the important part. Their own data did not change;
their *displayed* levy and line total did, because the levy residual was
reallocated. Any client that patched the edited row and stopped would be
showing four wrong numbers that still summed to the old total.

### The SPA invalidations this replaces

Grouping the 18 changed derived groups into the query boundaries a React Query
codebase would plausibly draw, one line edit requires **ten cache
invalidations**, seven scoped to the document and three ledger-wide:

| # | Query key | What goes stale |
| --- | --- | --- |
| 1 | `['invoice', id]` | subtotal, discount, net, VAT, levy, total |
| 2 | `['invoice', id, 'lines']` | *every* row's derived cells, not just the edited one |
| 3 | `['invoice', id, 'fx']` | the base-currency total; the rate is server-held |
| 4 | `['invoice', id, 'rollup', 'accounts']` | per-account net and shares |
| 5 | `['invoice', id, 'rollup', 'tax']` | per-code net, VAT, levy |
| 6 | `['invoice', id, 'journal']` | debit, credits, and the balance check |
| 7 | `['invoice', id, 'validation']` | issue count and postability |
| 8 | `['ar', 'aging', asOf]` | the draft bucket |
| 9 | `['ar', 'balance']` | running and closing balance |
| 10 | `['ar', 'summary']` | outstanding total |

Key 2 is the one that hurts. It is not enough to invalidate the edited line;
the whole collection is stale, because the apportionment moved cents onto rows
whose own fields are untouched. An SPA that models lines as individually
cacheable entities is *structurally* unable to be correct here, and the fix is
to stop caching lines individually — which is to say, to stop having a client
cache for this screen.

This is the concrete form of the "one state location versus four" claim in
`economics.md`. Here it is one location versus ten.

### Correctness by construction

Two tests carry this.

`keeps the journal balanced by construction` asserts that debits equal credits.
It cannot fail, and that is the point: the receivable debit is *defined* as
`net + VAT + levy`, and every credit is one of those three components. There is
no reconciliation step to get wrong and no ordering in which a reader could
observe an unbalanced journal.

`never sends a patch that leaves the replica inconsistent` is the stronger one.
It builds an actual replica, applies each frame the way the browser does, then
reads the *rendered strings* back out and checks that the document total equals
the sum of the rendered line totals — after every frame. It holds across four
consecutive edits. Because a frame is computed from one consistent snapshot of
stored state and applied atomically, there is no window in which the screen is
internally wrong.

`stays consistent with the line items after every mutation` runs 120
deterministic mutations across the whole mutation surface and re-checks
nineteen invariants after each one, including that per-line allocations sum
exactly to their document totals.

**How an optimistic SPA shows a wrong total transiently.** Concretely, on the
seeded document: raise line 1's quantity and an optimistic handler updates line
1's gross, then must choose. If it recomputes the total from the lines it holds,
it gets the discount apportionment wrong (the residual cent moves) and the levy
band wrong (the rate is a function of the new document total, which it does not
know), so the total is wrong by a few cents and the journal no longer balances.
If instead it shows a spinner on the totals, it has admitted it cannot predict
them, which is this architecture's position with extra steps. If it shows the
old total next to the new line, the screen states that a sum is equal to
something it is not. All three are visible for the duration of the refetch.

### Latency, both metrics

Eight samples per setting, from the client's own readout, on the six-line
document. The readout measures dispatch to applied patch.

| Simulated RTT | Mean | Min | Max | Overhead above RTT |
| --- | --- | --- | --- | --- |
| 0 ms | **3.0 ms** | 3 | 3 | 3.0 ms |
| 150 ms | **165.1 ms** | 154 | 172 | 15.1 ms |
| 400 ms | **413.5 ms** | 407 | 418 | 13.5 ms |

Document size moves the 0 ms figure, since it is pure server-plus-client work:

| Lines | Felt, 0 ms simulated RTT |
| --- | --- |
| 10 | 3.0 ms |
| 100 | 8.5 ms |
| 500 | 20.9 ms |

**The two metrics are the same number here, and that is the finding.** This
architecture has exactly one event per interaction. There is no earlier moment
at which a pixel moves and no later moment at which the screen becomes correct.
Time-to-first-feedback and time-to-a-correct-screen are both 165 ms at 150 ms
RTT. An SPA has two events and they are far apart.

Against finding 4's framing, at 150 ms RTT:

| | SPA | this probe |
| --- | --- | --- |
| First feedback | ~5 ms, optimistic paint | 165 ms |
| Correct screen | ~315 ms, if the refetch is serial | 165 ms |

So the architecture **loses first-feedback by about one RTT and wins
correct-screen by about one RTT**, on a workload whose refetch probability is
100% by construction.

**Does this support finding 4?** In direction, yes, and this is the strongest
case for it in the register: finding 4's crossover is 50% refetch probability
and this workload sits at 100%, so the prediction is that server authority wins
time-to-consistent outright. It does.

In magnitude, finding 4 is conservative, and the gap is worth naming. Its
100%-refetch row reports 47.3 ms against 32.6 ms — a 14.7 ms advantage at an
assumed 60 ms RTT. But a genuine serial second round trip would cost the SPA a
further 60 ms, not 14.7. So `latency_model.py` is either overlapping the refetch
with the mutation response or charging it a fraction of a round trip. Which is
right depends on the codebase: React Query's default `invalidateQueries` in
`onSuccess` is serial, and then the gap is roughly one whole RTT — 150 ms here,
400 ms at the poor-mobile setting, an order of magnitude more than 6-12 ms.

The honest caveat cuts the other way too. An SPA whose mutation endpoint returns
every one of the ten views above pays no second round trip and wins on both
metrics. That endpoint is exactly the API ceremony this architecture deletes, so
the trade is real rather than illusory — but it is a trade against an achievable
design, not against an impossible one. **`economics.md`'s conclusion that
server authority reaches a correct screen sooner should be stated as conditional
on the SPA not returning full state from its mutations.**

I did not build an SPA. The SPA column above is arithmetic on a stated latency
model, not a measurement.

### Render cost, and how much of it is wasted

From `http://localhost:8787/metrics`, as deltas around 20 edits at each size,
one session:

| Lines | Nodes/render | µs/node | µs/render | Ops/edit | Bytes/edit | Wasted nodes | Retained B/session |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | 474 | 0.521 | 247 | 52.0 | 4,176 | **89.0%** | 9,315 |
| 100 | 2,274 | 0.310 | 705 | 43.9 | 3,640 | **98.1%** | 18,418 |
| 500 | 10,274 | 0.197 | 2,020 | 90.5 | 7,389 | **99.1%** | 55,253 |

Corroborated in-process by `bench.ts`, which runs the same `Runtime`,
`serialize`, `diff` and `RuntimeMetrics` against a temporary file:

| Lines | Nodes/render | µs/node | µs/render | Ops/edit | Bytes/edit | First snapshot | Templates |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | 474 | 0.394 | 187 | 54.8 | 3,962 | 10,399 B | 9,062 B |
| 100 | 2,274 | 0.202 | 460 | 46.5 | 3,417 | 45,764 B | 9,062 B |
| 500 | 10,274 | 0.162 | 1,664 | 96.0 | 7,398 | 202,634 B | 9,062 B |

Node counts agree exactly; µs/node runs 20-30% higher live, which is the
retained-bytes sampling and the socket write. Take the live column as the
number.

Four things in that table matter.

**µs/node is 0.16-0.52, against the 0.8 µs assumed in `economics.md`.** Its
sensitivity analysis calls this "the single most important number to measure
once the prototype runs" and warns that 5 µs would move the fan-out crossover
past any real audience. Measured, it is 1.5x to 5x *better* than assumed, so the
crossover moves the favourable way. This is a dense, table-heavy view with 20
templates, not a flattering case.

**µs/node falls as the document grows** — 0.52 at 10 lines, 0.20 at 500 —
because per-render fixed costs amortize over more nodes. Cost per *render*
scales linearly and cleanly: 247 µs, 705 µs, 2,020 µs.

**Wasted work rises to 99%.** At 500 lines, 10,274 nodes are rebuilt and
re-diffed to discover 90 operations. Every node not producing an operation was
work the browser did not need.

**Payload does not scale with document size.** 3.6-7.4 KB per edit regardless,
and layout is 9,062 bytes once, forever. The keyed-list address is what does
this: a row keeps `root/h1/h1/k:line-0001` across renders, so its cells patch
as values.

That last point required an authoring decision worth recording. The tax rollup
renders all four codes and the aging table all six buckets, **including the
empty ones**, so the key sets are fixed. Rendering rows of zeroes looks
wasteful and is the opposite: a stable key set turns what would be a structural
`list` patch into value-only `set` patches. That is why the composition table
above shows zero `list` operations for any edit at any size.

### A4 evidence: the predictable/unpredictable ratio

Every mutation in the app, classified by whether a client could paint a correct
guess without a round trip.

**Predictable — 3 of 15 (20%).** The new value is an echo of the event payload
and nothing derived depends on it.

| Mutation | Why predictable |
| --- | --- |
| `setCustomer` | text echo; feeds only a label |
| `setLineDescription` | text echo; the validity rule is local and already rendered |
| `setDueInDays` | date arithmetic on a value already on screen |

**Predictable only by shadowing server logic — 2 of 15 (13%).** The client holds
enough data, but would have to reimplement the derivation.

| Mutation | What the client would have to reimplement |
| --- | --- |
| `setLineAccount` | rollup regrouping, share percentages, journal credit rows |
| `settle` | outstanding clamp, aging bucket membership, running balance |

**Structurally unpredictable — 10 of 15 (67%).** The client lacks data, not
logic. No amount of client code fixes these.

| Mutation | Missing input |
| --- | --- |
| `setLineQuantity` | levy band selection, largest-remainder residuals |
| `setLineUnitPrice` | same |
| `setLineTaxCode` | VAT rate table, leviable flag, levy reallocation |
| `setDiscountBp` | apportionment residuals, banker's rounding |
| `removeLine` | residual reallocation across survivors |
| `addLine` | server-generated row id |
| `setCurrency` | FX table and dealing spread |
| `setAsOf` | dated FX table |
| `postDraft` | document sequence, check digits, frozen rate, precondition |
| `seedLines` | server-generated content |

`economics.md` states that the SPA's only inherent advantage lives entirely in
the predictable class. **So on this workload the ceiling on SPA latency
advantage is 20% of the mutation surface, or 33% if you are willing to maintain
a second implementation of the domain on the client.** Weighted by how often
each is used — quantity, price and tax-code edits dominate ledger work — the
unpredictable share by interaction count is higher than 67%.

---

## Does the authoring experience deliver on "no API ceremony"?

Mostly yes, and the exceptions are not the ones I expected.

Here is the entire quantity control from
[`ledger-app.ts`](../../server/probes/ledger/ledger-app.ts), the interaction
whose fan-out is measured above:

```ts
<input
  type="number"
  min="0"
  max="100000"
  step="1"
  .value=${line.quantity}
  @change=${(event: ChangePayload) =>
    store.setLineQuantity(line.id, parseWhole(event.value))}
/>
```

And the method behind it, from
[`ledger-store.ts`](../../server/probes/ledger/ledger-store.ts):

```ts
async setLineQuantity(id: string, quantity: number): Promise<void> {
  const next = requireInteger(quantity, 0, MAX_QUANTITY, "quantity");
  return this.editLine(id, (line) =>
    line.quantity === next ? null : { ...line, quantity: next },
  );
}
```

That is the whole path from a keystroke to ten consistent views.

### What I did not have to write

- **Ten HTTP endpoints.** A REST version needs at minimum: get document, patch
  document, post line, patch line, delete line, post document, post settlement,
  get aging, get balance, get journal.
- **Request and response DTOs for each**, plus their validation, plus the
  versioning story when a derived field changes shape.
- **Ten cache keys** and the invalidation calls that go with them, enumerated
  above. Not one `invalidateQueries` appears in this probe.
- **Ten optimistic update functions and ten rollback paths**, which is what an
  SPA would need to compete on first-feedback, and which — per the ratio above —
  it could not write correctly for ten of the fifteen mutations anyway.
- **Loading, pending, refetching and error states.** There is no `isLoading`
  anywhere. A frame is either the old one or the new one.
- **Subscription plumbing.** Two tabs stay in sync because both read the same
  store and both re-render. `subscribe: (listener) => store.onChange(listener)`
  is the whole of it — one line in `probe.ts`.

### What I did have to write, honestly

- **~120 lines of parse-and-repair for the JSON file.** This is the durability
  boundary and would exist as a schema plus migrations in any architecture. Not
  a cost of this design.
- **The intent-shaped setter layer.** Also architecture-independent; it is a
  service layer.
- **Option lists written out longhand.** A template's static strings cannot be
  interpolated from a constant, so the account and tax-code `<option>` markup is
  duplicated from `REVENUE_ACCOUNTS` and `TAX_CODES`. I pinned the two together
  with a test that fails if they diverge. This is new ceremony, caused directly
  by I3.
- **Hole-index constants in the tests.** This is the real surprise, and the one
  genuine authoring regression. To send an event in a test you need an instance
  address and a hole index, so `test/probes/ledger.test.ts` carries
  `ROW_QUANTITY_EVENT_HOLE = 7` and three siblings, each pinned by an assertion
  so that reordering a table cell fails loudly instead of silently re-aiming the
  test at a different control. An SPA test would say
  `getByRole('spinbutton', { name: 'Quantity' })`. **The architecture deletes
  API ceremony and adds test-addressing ceremony**, and nothing in the register
  anticipates that. A `byRole`-style test helper that resolves a control to an
  address would be a real piece of missing infrastructure.

One authoring hazard I navigated rather than hit: `<select>` is bound with
`.value=${...}` and static `<option>` children. That works — the browser
snapshot shows every row's account and tax code correct — and it works because
the options are static markup already present in the cloned template when the
property part commits. With *dynamic* options the property would commit before
the children existed and the binding would silently do nothing. I did not test
that case, but any probe that needs a data-driven `<select>` should expect to.

---

## S3: what would dependency tracking need to know, and is it worth it here?

**It would need to know that everything depends on everything, and it is not
worth it. This probe argues against S3, not for it.**

The derivation is one pure function of the stored document. To avoid
re-rendering row 7 when row 1 changes, a tracker would have to establish that
row 7's levy cell does not depend on row 1's quantity. It does. The cell is
`allocate(levyTotal, weights)[6]`, `levyTotal` is a banded function of the sum
of all `weights`, and `weights` includes row 1. A correct tracker re-renders row
7. An incorrect tracker ships a wrong number.

So the granularity question has no useful answer here:

- **Store granularity** ("the document changed") is what the runtime already
  does. Tracking adds bookkeeping and concludes the same thing.
- **Record granularity** ("line 1 changed") is wrong, and wrong in the specific
  way that produces cents that do not sum.
- **Value granularity** ("this leaf's inputs changed") is correct, and is
  precisely what `diff` already computes — after the fact, for 0.2 µs per node,
  by comparing two trees. Memoizing each leaf against its inputs would cost more
  than recomputing it.

The measured numbers say the same thing from the other side. The pipeline pays
`O(nodes)` to discover an `O(ops)` patch, which looks bad at 99% waste, but the
constant is 0.2 µs. A 500-line document costs 2.0 ms per edit per session. The
absolute figure, not the ratio, is what should drive the decision.

**What I would decide.** Do not add dependency tracking on the strength of this
workload. Revisit it only for the sparse-graph case — a large tree where a
change genuinely touches one subtree, which is what the ticking clock and
presence probes are for. If tracking is added, it must be sound by default:
an unsound tracker on this app produces a balance sheet that does not balance,
which is worse than being slow.

**The constraint this workload actually hits is not S3.** At 2.0 ms per edit per
session, 500 sessions on one 500-line document cost a full CPU-second per
keystroke. The fixes are A6 (share the render across sessions viewing the same
document) and A5 (do not render 500 rows at all — window them, which would also
cut the 202 KB first snapshot). Dependency tracking addresses neither. I would
reorder the register accordingly: **S3's motivating example should be moved off
Ledger and onto Ticking clock, and Ledger's structural finding recorded as
evidence for A5.**

---

## A4: should declarative prediction be admitted?

**Admit it, but only in a form that can refuse — and note that it would buy
almost nothing on this workload.**

The ratio bounds the prize. Three of fifteen mutations are cleanly predictable,
and all three are text or number echoes into a form control. That case is
already handled by A1 today and belongs to A2's text-input primitive tomorrow.
`economics.md` models A4 at 80% coverage of mutations; on this app the reachable
coverage is 20%, and the 20% is not where the coverage would come from. **A4 as
modelled is unachievable in this domain and its value here is approximately
zero.**

The two "shadow implementation" cases are the interesting boundary. A client
*could* predict `setLineAccount` correctly, but only by maintaining a second
implementation of rollup and journal logic. That is not a runtime feature with a
declarative opt-in; it is the two-program problem returning under a new name.
A4 should not try to cover them.

So the answer to the open question in the register — *can the framework express
that a mutation is unpredictable, so prediction is refused rather than wrong?* —
is that it must, and the polarity matters:

- **Default to refusing.** In a ledger a wrong total is not a flicker. It is a
  false statement about money that a user may act on, and it is
  indistinguishable on screen from a true one. Opt-in prediction is safe;
  opt-out is not.
- **Only echo bindings are eligible.** Distinguish a binding whose value comes
  from the event payload (`.value=${line.quantity}` fed by
  `@change`) from one whose value comes from a computation
  (`${formatAmount(row.levyCents)}`). Permit prediction on the first, forbid it
  structurally on the second. That is a mechanical, checkable rule rather than a
  judgement call per binding, and on this app it admits exactly the three
  predictable mutations and nothing else.
- **Which means A2 is the better investment.** Every eligible binding here is a
  form control echoing its own value. That is a client primitive, not a
  prediction system, and it leaves I1 intact rather than temporarily weakened.

If A4 is built, this probe would be a good regression test for the refusal path:
none of its eleven derived views may ever be predicted, and a framework that
lets an author mark them optimistic has got the default wrong.

---

## Where I hit a wall

Nothing forced an edit to a protected file. Four things came close and are
reported rather than worked around.

1. **`/metrics` is cumulative with no reset and no per-probe scoping by phase.**
   Measuring render cost at three document sizes needs three independent
   counters. I got there with delta arithmetic across phases and an in-process
   bench, but the natural affordance is missing. **Proposal:** a
   `POST /metrics/reset` or a `?since=<label>` parameter on `/metrics`. Not
   implemented — `server/index.ts` and `server/metrics.ts` are owned by the
   coordinator.

2. **Template static strings cannot be interpolated from a constant**, which is
   what forces the longhand `<option>` markup. **Proposal:** something in the
   shape of lit-html's `static-html`, where a value marked static participates
   in the template identity. The cost is that each distinct static value
   produces a distinct interned template, which could multiply template
   identities badly; it may not be worth it. Not implemented.

3. **No windowed collections (A5).** A 500-line document ships a 202,634-byte
   first snapshot, and reseeding the list sends the whole collection in one
   `list` operation. The probe works, but this is the real ceiling on document
   size and it is A5's problem, not S3's.

4. **No way to address a control by role or label from a test.** Covered under
   authoring above. This is the one place the architecture is meaningfully worse
   than an SPA for a developer, and it is not in the register at all.

One smaller observation. `MAX_MESSAGE_BYTES` (16 KB) bounds inbound messages
only, so a 500-row `list` operation goes out as a single ~200 KB frame with no
chunking or backpressure. Not a wall here, and it interacts with A5.

---

## What a reader should not conclude

- **The cross-line coupling is contrived, and it is the whole engine of the
  fan-out numbers.** Real VAT is per-line and per-line-independent. Real invoices
  do not reallocate cents across lines when one line changes. The graduated levy
  and largest-remainder apportionment exist to drive refetch probability to 100%
  so that finding 4's crossover could be tested at its limit. A realistic
  invoice has a sparser graph, fewer than 18 changed derived groups, and would
  admit a partially correct optimistic patch. **This probe measures the ceiling
  of the effect, not its typical value.**
- **The S3 conclusion is workload-specific and deliberately so.** "Dependency
  tracking cannot help" is true when the dependency graph is complete. It says
  nothing about a dashboard, a clock, or a presence list, where the whole point
  is that most of the tree does not depend on the change. Do not generalize this
  into "S3 is closed."
- **The SPA columns are arithmetic, not measurement.** No SPA was built. The
  ten enumerated cache keys are a reasonable reading of how React Query code is
  normally organized, not an observation of a real codebase, and a team that
  returned full state from every mutation would not pay them.
- **Every number is one session, one process, localhost, warm.** Nothing here
  touches fan-out, amortization, GC pressure across many retained trees, or
  finding 3. The retained figure of 55 KB per session at 500 lines is a single
  sample from `/metrics`, not a distribution.
- **500 line items is unusual.** Ten to fifty is typical, which is the cheap end
  of every table above — 247 µs and 4 KB per edit.
- **The latency readout is a simulated link.** Ordered delivery, no jitter unless
  asked, no TCP, no TLS, no packet loss, no competing traffic. It measures the
  architecture's overhead above a round trip (13-15 ms) reliably, and models a
  real network badly.
- **Aging is quoted "as of" a stored date rather than the clock**, so the probe
  is deterministic and testable. A real system would tick, and would then
  discover that advancing the date re-buckets every document — which is the
  ticking-clock probe's problem, not this one's.
