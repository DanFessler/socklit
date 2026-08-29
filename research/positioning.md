# Positioning

[`prior-art.md`](prior-art.md) asks what has been built. This asks a different
question: **how did each of those systems sell itself, and did the market buy
it?**

The history turns out to be unusually consistent. Twenty-odd years of attempts
at server-authoritative UI produce six patterns that hold almost without
exception, and they argue for a different framing than this project currently
uses — and, more usefully, for a different unit of ownership.

---

## What each one sold, and what happened

| System | The pitch | What the market did |
| --- | --- | --- |
| **Vaadin** | Write your web UI in pure Java. Never touch the browser. | Durable, profitable, permanently niche inside enterprise Java. |
| **ASP.NET WebForms** | Desktop event-driven programming for the web. Drag a button, write a click handler. | Enormous adoption, then a backlash so severe that Microsoft repudiated it with MVC. "ViewState" is still a slur. |
| **Seaside** | Continuations. The web as ordinary function calls. Elegance. | Beloved by a few hundred people. No reach. |
| **Meteor** | One language, one data model, real-time by default, working app in ten minutes. Sold as a demo. | Huge hype, then decline. The company survived by extracting Apollo/GraphQL and abandoning the architecture. |
| **Phoenix LiveView** | A latency benchmark, plus the deletion of duplicated client logic. Rich UIs without writing JavaScript. | Complete success inside Elixir. Barely traveled outside it. |
| **Blazor Server** | Write C# instead of JavaScript. Full-stack .NET. | Moderate uptake in .NET shops. Microsoft hedged it down to one of four render modes. |
| **Hotwire / Turbo** | Ideology: HTML over the wire, a return to sanity against the SPA industrial complex. | The *phrase* spread further than the code. |
| **htmx** | An intellectual argument grounded in Fielding's REST. The industry took a wrong turn. | Mindshare wildly disproportionate to production usage. Genuinely changed the conversation. |
| **Mobile SDUI** | One operational pain, sold to management: ship UI changes without an app store release. | Widely adopted internally at large companies. Never productized. |
| **React Server Components** | Zero-bundle components, later reframed around data colocation. | Adopted by force as a Next.js default, with real backlash about boundary confusion. |

---

## Six patterns

**1. The architecture argument has never been the blocker.** Not once. Every
serious implementation was technically validated by the people who evaluated it,
and LiveView's argument in particular is widely accepted as correct by people
who will never write a line of Elixir. What varied across these systems was
addressable market and switching cost, never persuasiveness. There is no
evidence anywhere in this history that the world needs convincing that
server-authoritative UI works.

**2. Ecosystem captivity sets the ceiling, exactly.** Vaadin, WebForms,
LiveView, Blazor, and Livewire each succeeded precisely as far as their host
language and then stopped. The only things that traveled were idea-shaped or
language-agnostic rather than framework-shaped. This is the single most
predictive variable in the table.

**3. Incremental adoptability predicts uptake better than quality does.** Rank
these by "how much do I have to change to try this" and you approximately
recover the adoption ranking. htmx is a script tag in an app you already have.
Turbo is nearly the same. Meteor demanded a rewrite and chose your database.
LiveView demands a language. **The best technology in the list has the highest
switching cost and the smallest reach.**

**4. Winning pitches deleted a specific nameable pain. Losing pitches sold a
worldview.** "No app store release," "no API layer," and "no build pipeline" all
worked. Seaside's elegance and Meteor's magic did not survive contact with their
own edges.

**5. Abstraction leaks are unusually lethal in *this* architecture.** WebForms
and RSC were both punished hardest for boundary confusion, and that is not a
coincidence. When the entire promise is "you do not have to think about the
client/server boundary," every forced encounter with it is a direct violation of
the core value proposition rather than an ordinary annoyance. Three places in
this prototype are exactly such encounters: `stale_event` recovery, the question
of which primitives are client-owned, and the cliff in `economics.md` finding 3
where adding one personal field inside a list silently destroys render sharing.
Each is a moment where the author must suddenly reason about the boundary, and
the history says those moments are where reputations die.

**6. Nobody has ever sold this architecture on cost or performance.** LiveView
sold latency, Hotwire sold happiness, htmx sold correctness, mobile SDUI sold
release velocity. Not one of them sold cheaper servers — which is consistent
with `economics.md` concluding the cost case is roughly a wash.

---

## What this argues for changing

**Lead with the pain, not the worldview.** The authoritative-multiplayer-
simulation framing is the most intellectually interesting thing in the README,
and it is a worldview pitch. Pattern 4 says that is how you lose. Keep it as the
explanation of *how the thing works*; do not make it the reason to care.

**Make the headline a pain, not a property.** The tempting candidate is
end-to-end type safety, and it is the wrong one. tRPC already delivers typed,
codegen-free calls across a *stateless* boundary, it has real adoption, and its
pitch — no endpoint, no DTO, no codegen, no drift — is very nearly word for word
the one this project would make. Opening on a claim an incumbent already won is
the weakest available position.

The claim that survives that comparison is not about types at all. It is that
**arguments never cross the boundary**:

> Pass the object, not its id. A click handler is a server closure that captured
> the actual row — its methods, its dates, its identity — so nothing is
> serialized, nothing is validated, and there is no id to plumb through and look
> back up.

tRPC makes the call type-safe. This deletes the call. With tRPC you still write
the procedure, the mutation hook, the pending state, the error branch, and the
cache invalidation. Here there is no client call site to write.

And the pain it names is one every backend developer feels weekly: `doThing(id)`
followed by looking the thing back up, handling not-found, and revalidating an
id that the server itself produced ten seconds earlier. That pattern exists in
every serialized API for exactly one reason — the object could not cross the
wire. It also explains why schema validation sits on every procedure in a normal
codebase: it is a tax on having a boundary with an untrusted party, and for
arguments there is no boundary here.

**Demote economics to a defense.** Pattern 6 plus the model's own findings mean
cost is the answer to "won't this be expensive," not a reason to adopt. Leading
with it invites a fight that cannot be won and does not need to be.

---

## Where to build from: three lines converge on the subtree

The most useful result here is that three independent arguments point at the
same design decision.

- **Adoption history** (pattern 3) says optimize ruthlessly for incremental
  adoption. The unit should be something added to an existing application
  without a rewrite.
- **The cost model** (`economics.md` finding 3) says the unit of render sharing
  must be the subtree, because whole sessions are never identical.
- **Blazor** arrived from a third direction at per-component render modes,
  after starting with a whole-application choice and retreating from it.

All three say: **this should mount and own a subtree inside an app you already
have, not own the page.**

That reframing pays for itself four times over.

**It resolves the adoption risk.** A team can put one live region into an
existing React or server-rendered app and keep everything else. Nothing in the
table above that required a rewrite ever achieved broad adoption.

**It dissolves the SEO problem.** The surrounding page stays ordinary
server-rendered HTML, crawlable and cacheable, which is what made blogs, forums,
and storefronts bad fits. Only the live region is server-owned.

**It structurally fixes the personalization ceiling, which is the elegant
part.** Finding 3 says amortization dies as the per-session share of the shared
subtree rises past roughly 8%, and that personal content is usually chrome —
your name, your avatar, your unread badge, your permissions. If the host
application owns the chrome and the mounted region owns only the shared,
impersonal, high-fan-out content, then `personal_share` of the server-owned
region falls toward zero **by construction rather than by discipline.** The
architecture's largest economic constraint and its largest adoption constraint
turn out to have the same solution.

**It sharpens what the prototype should demonstrate.** Not a todo app that owns
the page, but a shared live region — a ticker, a board, a queue — mounted inside
an otherwise ordinary page, with many viewers.

### What it would require

The runtime currently assumes it owns the session and the page: one root
template per session, structural ids rooted at `root`, and a client that renders
the whole replica. A mount-shaped version needs a public mount API taking a host
element, instance addressing rooted per mount rather than per session, several
independently versioned regions coexisting in one connection, and a defined
answer for what happens when the host app navigates or unmounts. That last one
is `design-probes.md` S2 in a new form, and it is easier in this shape than in
the current one, because the route belongs to the host app rather than to the
server.

---

## What would change these conclusions

**If the headline's own limits swallow it.** "Pass the object" has four, and the
pitch is only honest stated with them. The captured object is a snapshot at
render time, so anything needing current state re-reads anyway — which is why
the README already mandates intent-shaped handlers like `setDone(id, true)` over
`toggle(id)`. Captures are retained in the handler table until the next render,
so a large graph captured per row multiplies by row count and lands on the
bytes-per-session budget. A richly captured subtree is a *less shareable* one,
because closing over per-session objects is precisely the purity violation that
kills amortization. And none of it survives a reconnect, since the table is in
memory.

Separately, the pitch still assumes an audience willing to give up the npm
component ecosystem inside the mounted region. That trade is real and unproven,
and pattern 5 warns the client-primitive gap is where it will be felt. The
cheapest test is to describe the whole trade to ten React developers and watch
which half they react to.

**If "a subtree you mount" is too close to what islands and RSC already
promise.** The differentiation is narrow and has to be stated precisely: not a
server-rendered fragment, but a *live server-owned* region with a retained tree,
push updates, and — uniquely — one render shared across many viewers. If that
distinction does not land in a sentence, the positioning is too subtle to
survive contact with an audience.

**If cross-session sharing turns out not to work.** The case above leans on it,
and it is the one claim in `prior-art.md` no other framework has attempted. The
probes have since measured the opportunity — 99.95% of render CPU is provably
redundant at fan-out 2000 — but also collapsed its urgency, since the penalty
for not sharing is 1.20x rather than 9.11x once the real render constant is used.
It remains unbuilt, though no longer blocked: handlers now receive the session
that sent the event as an argument, so a closure that resolves who acted at
dispatch time is correct for every viewer rather than for one. Without it, this
is a nicer-typed LiveView for the TypeScript ecosystem, which is a perfectly
respectable thing to be, but the pitch becomes pattern 2 with a friendlier
language rather than something new.
