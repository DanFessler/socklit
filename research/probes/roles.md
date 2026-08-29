# Permission-filtered console

**Forces I2, A6, and the amortization/authorization collision named in
`research/design-probes.md`.**

The result in one paragraph. The collision is real but I had the mechanism
backwards. `design-probes.md` predicted that fine-grained field permissions
would "collapse sharing almost entirely" while coarse subtree-level permissions
preserved it, and that the amortization ratio would degrade toward
`sessions / (views × auth_classes)`. Measured over 200 sessions across a 60
record company: gating every sensitive field individually costs **21%** of the
available sharing (node amortization 40.8x versus 52.0x coarse), and adding
roles degrades sharing but **saturates** rather than collapsing — one role gives
100.3x, five give 52.0x, and the fifth of those already costs nothing at coarse
granularity. What actually destroys
sharing is a single **non-privileged personalized field**: adding one
`Opened by ${viewer.name}` span to the one subtree every session was sharing
drops amortization from 52.0x to **3.6x**, a 14x loss, and raises the work of
serving the population from 3.8 session-equivalents to 55.2. Authorization
granularity is close to free. Personalization is the whole cost. That makes this
the third probe to land on personalization as the binding constraint on A6, and
it means the corrected amortization formula is about personalization classes,
not permission classes.

I2 held exactly, on every role, with no exceptions — but only after fixing the
leak metric, which was reporting false positives. That correction is documented
below because the trap generalizes to anyone auditing this architecture.

## What the probe does

An HR console over a seeded 60-person company. Every record carries values at
several sensitivity levels — title and department (public), salary and raise
requests (compensation), performance rating and its note (rating), national
identifier and bank account (identifiers) — and `grantsFor(viewer, employee)`
returns five independent booleans rather than a privilege level, because real
consoles are not a ladder: finance sees pay without ratings, an executive sees
ratings without national identifiers.

```
http://localhost:5182/?probe=roles&user=emp-09                        an ordinary employee
http://localhost:5182/?probe=roles&user=emp-05                        a line manager
http://localhost:5182/?probe=roles&user=emp-14&granularity=coarse     gate at subtree boundaries
http://localhost:5182/?probe=roles&user=emp-14&granularity=fine       gate at every field
http://localhost:5182/?probe=roles&user=emp-14&granularity=personal   coarse, plus one personal field
http://localhost:5182/?probe=roles&user=emp-09&role=hr                a tab trying to promote itself
```

Only the *identity* comes from the query string. The role attached to it is read
from the staff directory on the server, so a tab cannot promote itself by
editing its URL, and `?role=hr` renders a refusal notice instead.

`granularity` is the independent variable, and it is a fair one: it changes
**where in the template tree the authorization decision is taken** and nothing
whatsoever about who may see what. All three settings pass the same exposure
tests and show the same values to the same viewer, which the test suite asserts
directly.

- `coarse` — one gated subtree per sensitivity level. The public block is a
  nested instance whose bytes do not depend on the viewer at all.
- `fine` — one flat row template where every field is its own hole and each hole
  consults the grant.
- `personal` — the coarse tree, plus one field inside the shared public subtree
  whose value is the viewer's own name. Nothing about it is privileged. It is
  the smallest possible change: one hole.

Measurements come from `scripts/roles-amortization.ts`, which attaches N
sessions in-process through the real `Runtime` with capture sockets, reads the
snapshot frames the server actually wrote, and builds a DAG over canonical
subtrees. Full output is checked in at `research/probes/roles-measurements.txt`.

```bash
npx tsx scripts/roles-amortization.ts --sessions=200
```

The sharing census (`server/probes/roles/share.ts`) canonicalizes a subtree by
template id and hole values, **excluding instance ids**, because a shared
subtree cannot carry one session's address (`design-probes.md` S1). It then
reports separately how many distinct addresses each canonical subtree appeared
at, which is how much address rewriting sharing would actually require. Event
holes serialize as `{"kind":"event"}` on the wire and so never split a subtree,
which matters for the conclusion.

> Two later changes to the rendering core landed after this probe was written,
> and everything below was re-measured against them. Template static strings are
> now normalized when a template is first interned, cutting template bytes on the
> wire by about a quarter; no figure in this document is a template byte, and the
> snapshot sizes, node counts, variant censuses and every amortization ratio came
> back identical, because those carry instance addresses and hole values rather
> than template text. Separately, instance addresses are now reused across renders
> instead of rebuilt by concatenation, which touches only *Render cost*. That
> figure re-measures **higher** than the 0.042 it replaced, at 0.050, which reads
> backwards until both changes are counted: address reuse is worth about 2x
> through serialize, diff and encode, but this probe also gained a component
> boundary per rendered row when it was converted to hooks, and at this tree's
> density the boundary costs slightly more than the reuse gives back. The same
> pattern appears in `routes.md` and `admin.md`, and the opposite one in
> `clock.md` and `odds.md`, whose trees have far fewer components per node. The
> conclusion drawn from the figure is unchanged in kind: it is here to be
> compared against an assumption of 0.8, and 0.050 and 0.042 say the same thing
> about that.

## Measurements

### I2 on the wire

Per-role snapshot contents, 200 sessions, `fine` gating. The count is other
people's national identifiers and bank accounts found anywhere in the bytes the
server sent:

| role | sessions | avg snapshot bytes | other people's identifiers |
| --- | --- | --- | --- |
| employee | 136 | 10,745 | 0 of 118 |
| manager | 36 | 11,466 | 0 of 118 |
| hr | 10 | 22,969 | 118 of 118 |
| finance | 10 | 11,693 | 0 of 118 |
| exec | 8 | 15,609 | 0 of 118 |
| guest (unknown user) | 1 | 10,687 | 0 of 118 |

I2 holds exactly. Only people operations, the one role holding the
`identifiers` grant, receives identifiers, and it receives all of them. Nothing
is hidden-but-present: a value that was never rendered has no representation on
the wire to leak. This is the architecture's strongest property and it needed no
defending — it falls out of `fn(state) => UI` running server-side.

**But the payload size is a side channel.** An observer who cannot read a single
field can still infer privilege from frame size: HR sessions are 2.1x the bytes
of employee sessions, and the five roles are separable by size alone. The
architecture eliminates content leaks and introduces a volume leak. Nothing in
the current design pads or blinds this.

#### The leak metric was wrong, and the trap generalizes

The original metric searched the serialized tree for other employees'
`ssn`, `bankAccount`, **and `ratingNote`**, and reported apparent leaks of 13 of
177 for employees and 59 of 177 for managers and executives — roles which in
fact hold no `identifiers` grant at all.

Those were false positives. `ratingNote` is seeded as
`Calibrated at ${rating} of 5 in the spring cycle`, so its text is a function of
the rating alone and at most **five distinct note strings exist across the whole
company**. A viewer legitimately seeing their own note therefore substring-matches
the note of every other employee who happens to share a rating, and once all
five variants appear anywhere in a tree the count saturates at "all of them".

Only values unique to one record can be audited by substring search. The metric
now counts identifiers only, and the test suite asserts the property directly
rather than statistically. Two lessons: a wire-level exposure audit needs
per-record unique canaries seeded for the purpose, and a saturating leak count
is a signature of a colliding probe rather than a broad breach.

### Amortization by where authorization is resolved

200 sessions drawn from the role mix over 60 records. `distinct trees` counts
byte-identical whole trees; `node ratio` is the full-tree node count divided by
the nodes a shared-subtree implementation would build; `render mult` is that
shared work expressed in session-equivalents.

| granularity | distinct trees | session ratio | nodes/session | shared nodes | render mult | node ratio |
| --- | --- | --- | --- | --- | --- | --- |
| coarse | 60 | 3.33 | 807 | 3,103 | 3.8 | 52.0 |
| fine | 60 | 3.33 | 802 | 3,931 | 4.9 | 40.8 |
| personal | 60 | 3.33 | 867 | 47,867 | 55.2 | 3.6 |

Three things to read off this.

**Whole-tree sharing is per-user, not per-role.** All three settings give 60
distinct trees, because 200 sessions were drawn from only 60 distinct users and
each user's tree differs (everyone sees their own record specially). The session
ratio of 3.33 is just 200/60. At the granularity `cost_model.py` assumes —
identical whole trees — authorization is irrelevant and the answer is "one
render per distinct user". This is exactly what the routes probe found by a
different route, and it is the number that matters for the naive model.

**Subtree sharing is where the value is, and granularity barely dents it.**
Coarse 52.0x versus fine 40.8x. Gating each field individually costs 21%, not
the predicted collapse. The reason is visible in the row-variant census below.

**One personal field costs 14x.** Coarse to personal is a single added hole in
one subtree, and it takes amortization from 52.0x to 3.6x and the work of
serving 200 sessions from 3.8 session-equivalents to 55.2.

Measured on the roster subtree alone the numbers are identical (52.0 / 40.8 /
3.6), so the roster dominates the tree and none of this is an artifact of
surrounding chrome.

### How many renderings of one record exist

| granularity | templates | canonical variants | occurrences | address-stable |
| --- | --- | --- | --- | --- |
| coarse | 3 | 60 | 12,000 | 60/60 |
| fine | 2 | 248 | 12,000 | 248/248 |
| personal | 3 | 3,600 | 12,000 | 3,600/3,600 |

12,000 occurrences is 60 records × 200 sessions. Coarse collapses them to 60
canonical subtrees, fine to 248, personal to 3,600 — which is exactly
60 records × 60 viewers, i.e. no sharing across viewers at all.

**Every canonical variant sat at exactly one instance address**, in all three
settings. This is the load-bearing observation for A6. Because the roster is
keyed by employee id, a record's address is the same string in every session
that renders it, so a shared subtree could carry its address unchanged. The S1
objection — that a shared subtree cannot carry one session's address — does not
bite when lists are keyed by domain identity. Addressing is not what blocks
sharing here.

### Effect of the number of roles

Node amortization ratio at equal session count, adding one role at a time:

| roles in the population | coarse | fine | personal |
| --- | --- | --- | --- |
| employee | 100.3 | 97.7 | 5.7 |
| + manager | 81.9 | 75.8 | 5.0 |
| + hr | 62.0 | 53.6 | 4.3 |
| + finance | 52.0 | 41.4 | 3.7 |
| + exec | 52.0 | 40.8 | 3.6 |

Sharing degrades with role diversity and then stops. The fifth role costs
nothing at coarse granularity and 1.4% at fine. This is not the
`1 / auth_classes` decay the register predicted; it is a curve that flattens,
because the number of *grant tuples* is bounded by the permission model rather
than by the population. `grantKey` in `server/probes/roles/directory.ts` makes
this explicit: two viewers holding the same five-bit tuple produce byte-identical
output for a record, and there are at most a handful of tuples however many
users exist. The test suite asserts the class count stays bounded while the
population grows.

Note also that a single-role population gives 100.3x rather than unbounded
sharing, because each employee sees their own record with compensation and
rating visible. Even one role contains a per-viewer divergence, for the same
reason `personal` is expensive: self-reference is personalization.

### Does the multiplier saturate?

| sessions | coarse mult / ratio | fine mult / ratio | personal mult / ratio |
| --- | --- | --- | --- |
| 25 | 3.4 / 7.5 | 4.3 / 5.8 | 23.5 / 1.1 |
| 50 | 3.6 / 13.8 | 4.7 / 10.6 | 43.1 / 1.2 |
| 100 | 3.7 / 26.7 | 4.8 / 20.9 | 48.8 / 2.0 |
| 200 | 3.8 / 52.0 | 4.9 / 40.8 | 55.2 / 3.6 |
| 400 | 3.8 / 104.0 | 4.9 / 81.6 | 55.2 / 7.2 |
| 800 | 3.8 / 208.1 | 4.9 / 163.3 | 55.2 / 14.5 |

The render multiplier converges to a constant while the amortization ratio grows
linearly with the population. That is the favourable direction and the strongest
argument for A6 in this document: at coarse or fine granularity, serving any
number of sessions costs about **4 to 5 session-equivalents of rendering**, so
the ratio improves without bound as the audience grows.

Personal saturates at 55.2, which is approximately the 60 distinct users. The
rule is clean:

- gate coarsely or finely, and work scales with the number of **grant classes** — a constant
- personalize, and work scales with the number of **distinct users** — sharing only across a user's own tabs

### Render cost

Over all populations above: 8,526 renders, 6,964,925 nodes.

| metric | value |
| --- | --- |
| µs per node | 0.050 |
| nodes per render | 816.9 |
| retained bytes per session | 16,459 |

0.050 µs/node is the fourth independent measurement well under the 0.8 µs
`economics.md` assumed, and the lowest yet — roughly 16x cheaper. Across the
probe suite the figure now spans 0.050 to 0.74 µs depending on tree density, and
the 0.8 µs assumption has not been exceeded on a warm path.

## What it forced

**The collision in `design-probes.md` should be restated.** It is not
"authorization fragments identical content". Authorization classes are bounded
and cheap: five roles cost 48% of coarse sharing and then stop. The real
statement is that **any viewer-dependent value in a shared subtree collapses
sharing to per-user, regardless of whether that value is sensitive**. An audit
stamp, a greeting, a "you are here" marker, and a national identifier are
identical in cost. `economics.md`'s caveat — "a per-user greeting, an unread
badge, or a personalized watchlist splits one shared render into N" — is the
correct framing, and the authorization discussion built on top of it was a red
herring.

**A6 needs a way to isolate personalization, not a way to model permissions.**
Since grant classes are bounded, a shared-render implementation can key on the
grant tuple and get 40-52x on this workload. What it cannot survive is one
personal hole in a shared subtree. That points at the affordance the register
lists as a client primitive: personal values that are not secret should be
resolved on the client, leaving the server tree viewer-independent. Here,
`Opened by ${viewer.name}` is known to the client already and never needed to be
in the shared subtree at all. Recovering 14x for that is the highest-leverage
change this probe found.

**Addressing is not the blocker; closures are.** Every canonical subtree in
every configuration sat at exactly one address, because the roster is keyed by
employee id. What is genuinely per-session is the handler closure behind each
event hole — `@click=${() => actions.decide(employee.id, "approved")}` captures
that session's `actions`, which captures its `userId`. On the wire the hole is
`{"kind":"event"}` and shareable; in memory it is not. Two other probes reached
this conclusion independently, and this one confirms it from the authorization
side: sharing a subtree requires a way to bind handlers per session after the
fact, and nothing else about the subtree stands in the way. That way now exists —
handlers receive the acting session as an argument, so one closure can serve
every viewer — though the handlers in this probe still capture theirs.

**Rendering a control is not authorization, and the store must assume it.**
Every mutation takes the caller's user id rather than a resolved viewer, and
re-derives both role and grant from the state it is about to change. A handler
that closed over "you may approve this" when the row was rendered therefore
cannot act on that belief: if the record was reassigned while the click was in
flight, the check fails at commit time. Combined with the intent-based mutation
rule established by the todo work — `decideRaise` states the outcome rather than
flipping the current one — a decision that arrives twice or late cannot mean the
opposite of what the user clicked. Both properties are asserted in
`test/probes/roles.test.ts`.

**Wire volume needs a privacy story.** I2 covers content and says nothing about
size. If the threat model includes a passive observer, per-role frame sizes
being separable is a real finding and the register has no entry for it.

## Where I hit a wall

**The exposure audit cannot be done by substring search**, as described above. I
fixed the metric but the deeper problem stands: proving I2 for a real app needs
either per-record unique canaries seeded deliberately, or a rendering pass that
tracks provenance of each hole value back to a grant decision. The latter is the
real mechanism and it does not exist.

**I could not measure shared rendering, only its ceiling.** Every number here is
what a shared-subtree implementation *would* save, computed from a census of the
trees the server really produced. Nothing in the runtime shares anything today.
The handler-binding problem above is the reason it would be hard, and until it is
solved the 52.0x is an upper bound with an unknown constant factor.

**Since built.** Handlers now take the acting session as a second argument, so a
closure can resolve the viewer at dispatch instead of capturing it at render, and
the binding problem no longer stands in the way. Nothing shares a render yet, so
the 52.0x is still an upper bound and its constant factor is still unknown.

**The population is 60 users, so per-user sharing and per-role sharing are only
3.33x apart at the whole-tree level.** A realistic deployment has far more
sessions than users, and the interesting regime — thousands of sessions over
hundreds of users — was out of reach in-process. The saturation table is the best
available evidence that the trends continue, but it varies sessions at fixed
headcount, not both.

**Authorization is uniform in time.** Grants never change mid-session in this
probe, apart from the reassignment path exercised in tests. Revocation while a
session is live — the case where a shared subtree must be torn out of N sessions
at once — is untested and is where a real implementation would be most likely to
leak.

## What a reader should not conclude

**Not that authorization is free.** It is cheap *for sharing*. It costs a
`grantsFor` call per record per render, which is inside the 0.050 µs/node, and it
costs the ability to send one payload to many sessions, which is what the 4 to 5
session-equivalents represent. "Nearly free" is relative to the collapse that was
predicted, not to zero.

**Not that fine-grained permissions are as good as coarse.** 21% is small next to
14x but it is not nothing, and it grows with the number of gated fields — this
row has four. A record with thirty independently-gated fields was not measured.

**Not that I2 makes the app secure.** I2 makes *the wire* safe: unrendered data
cannot leak because it does not exist in the payload. It says nothing about the
mutation path, which is defended separately by re-deriving grants at commit time,
and nothing about payload size.

**Not that 0.050 µs/node generalizes.** It is the cheapest figure in the suite
and this tree is unusually flat and string-heavy: 817 nodes of mostly short text
holes, with `—` placeholders in the fine configuration that cost a node and
almost no bytes. Denser trees in other probes measured up to an order of
magnitude more.

**Not that the 3.6x for `personal` condemns personalized apps.** It condemns
personalizing *inside a subtree that would otherwise be shared*. The same value
rendered in a separate per-session region, or resolved on the client, costs
nothing in sharing. The finding is about placement, not about personalization as
a product decision.
