# Prior art

Nothing in this repository is new. The server-authoritative UI has been built in
at least three separate decades, and the closest living relative independently
arrived at almost exactly the wire format this prototype uses.

That is worth knowing early rather than late. The useful question is not whether
the idea has been tried — it has, repeatedly, and some of it is in production at
scale — but what those attempts learned, which of this project's open questions
they already answered, and what is genuinely left.

The short version of the answer: the architecture is thoroughly explored, but
every mature implementation of it is trapped inside an ecosystem most web
developers will not move to, and the one technical claim no other framework has
attempted is cross-session render sharing.

---

## Phoenix LiveView

Elixir, 2018, currently 1.2. The closest relative *on the wire* by a wide margin,
and the one whose source is most worth reading against `server/serialize.ts` and
`server/diff.ts`. An earlier draft of this document called it the closest
relative outright, which was a single ranking over what turned out to be two
independent axes — see [Solara and Reacton](#solara-and-reacton), which is the
closer relative of the programming model.

A per-connection BEAM process holds the state. Events arrive over a WebSocket as
semantic bindings, the server re-renders, and only a minimal diff goes back. The
template layer is the striking part: HEEx splits a template into **static
segments** and **dynamic parts**, sends the statics once with an identifier, and
thereafter transmits only changed dynamics as a map keyed by index. That is
template interning plus hole patching, reached independently and shipped seven
years earlier.

| Concern | LiveView | This prototype |
| --- | --- | --- |
| Layout | Statics sent once per template, cached by id | Template interning, cached by id |
| Values | Changed dynamics as a map keyed by index | Hole patches keyed by hole index |
| Addressing | Component id plus DOM id, reconciled with morphdom | Structural path, `root/h1/k:<id>` |
| Lists | `phx-update="stream"` | `keyed(items, keyOf, render)` |
| Events | A named event plus params, pattern-matched in `handle_event` | An address into a handler table: instance id plus hole index |
| Client escape hatch | Hooks, a documented JS lifecycle | Deliberately absent so far |
| Session | A supervised BEAM process | A JS object in the Node process |

**The sharpest divergence is the event model.** LiveView sends a *name* —
`phx-click="delete"` with params — which the server pattern-matches. This
prototype sends an *address* into a table of live closures. The address model is
why `db.todos.remove(todo.id)` can be written inline with no endpoint and no
event-name registry, which is the whole ergonomic pitch. But a name is stable
across renders, survives a reconnect without coordination, and is trivially
serializable for logging or replay, while an address is only meaningful against
a committed handler table. That is precisely why this repo needs `stale_event`
recovery and LiveView does not need an equivalent. The ergonomic win and the
recovery burden are the same design decision seen from two sides.

That fork has a second consequence, larger than the first: **the address model
is what permits rich objects as handler arguments.** A LiveView handler receives
`phx-value-id` as a string and looks the record back up, exactly as a REST
endpoint would, so LiveView authors do id-plumbing in every `handle_event`.
A handler here closes over the record itself, with its methods and identity
intact. Blazor Server, which also retains live closures, gets the same benefit.
Id-plumbing is the price LiveView pays for an event name that is stable,
serializable, and reconnect-proof — and rich capture is what this project buys
with `stale_event` recovery. See item 2 in "What is actually left."

**LiveView has already answered several questions `design-probes.md` lists as
open.** Automatic form recovery on reconnect addresses the reconnect storm.
Hooks are an answer to client primitive coverage (S3 and A2/A3). Streams are an
answer to windowed collections (A5). `push_patch` with `handle_params` is an
answer to S2, "where does navigation live": the route is server state and the
URL is kept in sync, with a documented cost for full remounts. Any probe in that
document should be designed knowing what LiveView already concluded.

**The substrate is not incidental.** The BEAM gives LiveView cheap isolated
processes, per-process garbage collection, preemptive scheduling, and
supervision trees. Node gives this prototype none of that: sessions share one
heap and one event loop, so a single expensive render blocks *every* session in
the process. The burst fan-out numbers in `economics.md` (12 seconds to reach
50,000 sessions on the content workload) are a Node problem in a way they are
not a BEAM problem. This is the most important structural disadvantage the
prototype has, and it is not fixable within the runtime.

**What LiveView does not do**, as far as I can determine, is share renders
across sessions. Each process renders alone. So the subtree amortization
question in `economics.md` finding 3 is not a re-tread of LiveView.

## Solara and Reacton

Python, 2022–2023. Missed entirely by the first two drafts of this document,
which searched for server-rendered *web frameworks* and therefore never looked
at the Jupyter data-app ecosystem. It is the closest relative of the programming
model, and on several rows it is not merely similar but the same design.

**Reacton is a port of React, not an homage.** `@reacton.component` decorates a
function; `use_state` returns a value and a setter; `use_effect` runs after
commit and may return a cleanup; `use_context` and `provide_context` are the
context pair; hooks are order-dependent and enforced with an internal counter,
with the documentation giving the same no-conditionals rule for the same reason.
Re-renders are triggered by a `use_state` setter or a `provide_context` call —
which is, exactly, this runtime's "a setter or `session.invalidate()`."

**Solara runs it server-side.** A browser page gets a "virtual kernel" with an
id, running in its own thread, and many kernels share a single OS process
specifically so that memory and dataframes can be shared between them. Updates
go to the browser over a WebSocket. `solara.use_state` *is* `reacton.use_state`.

| Concern | Solara / Reacton | This prototype |
| --- | --- | --- |
| Component | `@component` on a function | `component()` wrapping a function |
| State | `use_state`, order-checked hooks | `useState`, order-checked hooks |
| Context | `use_context` / `provide_context` | `useContext` / `provide` |
| Escape hatch | `get_widget(el)` inside `use_effect` | `useRef`, no DOM handle |
| Re-render trigger | Setter or `provide_context` | Setter or `session.invalidate()` |
| Events | Server-side closure, rich capture | Server-side closure, rich capture |
| Session | Virtual kernel, thread, shared process | JS object in the Node process |
| Reconnect | Resume by kernel id, 24h cull timeout | Drop replica, reconnect fresh |
| Diff target | Real ipywidget objects, changed traits | Instance tree, hole patches |
| Wire | ipywidgets comm, per-model state updates | Interned templates, hole indices |

**The event model is the row that matters.** LiveView's named events with
serialized params are, per the section above, the sharpest divergence between
this project and its nearest wire-relative. Solara does not diverge there at
all: `on_click=lambda: set_clicks(clicks + 1)` is a server-side Python closure
over live values, so it gets rich handler capture for the same reason Blazor
does. The property this document spent item 2 carefully narrowing is, in
Solara, ordinary.

**Where it is genuinely different is the render target, and that difference is
larger than it first looks.** Reacton reconciles its element tree against *real
ipywidget objects* and writes changed traits; ipywidgets then syncs those traits
to the frontend. So there are two diffs in series, and neither is a template
diff — there are no templates, and therefore nothing to intern. The reason
Solara does not need statics-sent-once is that its statics are **npm packages
already installed in the browser**: every widget is a JS view with a server-side
model proxy.

That last point deserves more than a footnote, because it inverts a caveat this
document makes below. Solara's authors did not give up their component
ecosystem — ipyvuetify, bqplot, ipyleaflet, threejs all work — precisely
*because* the unit of replication is a widget proxy rather than a template. A
widget is a client island by construction, so client primitive coverage (A2/A3)
is not an open problem there; it is the architecture. The npm sacrifice in "Two
honest caveats" is a consequence of choosing templates and the DOM, not of
server authority, and Solara is the proof.

**It has also built the lifetime tiers S4 says do not exist here.** A kernel
survives WebSocket loss and resumes by id, with a 24-hour cull timeout tunable
by environment variable, so hibernating a laptop does not lose the app. A
`solara-session-id` cookie carries identity across page refreshes and pages.
Selected reactive variables can be persisted to Redis so a *different* worker
can restore them after a crash or a rolling deploy. Multiple workers otherwise
require sticky sessions, since a kernel is pinned to the worker that created it
— the same constraint this prototype would inherit. There is also a `/resourcez`
endpoint reporting thread and kernel counts, which is the `/metrics` endpoint
item 5 asks for, already specified by someone else.

**What Solara does not do** is share renders across sessions, and its audience
is data applications and notebooks rather than web products. The default
renderer also walks the whole tree on every state update; an opt-in fast
renderer that prunes to dirty subtrees exists as an unmerged pull request, which
is worth reading against S3 but should not be cited as shipped behavior.

## Blazor Server

.NET, 2018. Since .NET 8 it is no longer a separate hosting model but the
"Interactive Server" render mode inside a unified Blazor app.

This is Option B from the original design exploration, actually built: a real
server-side component tree, diffed as a *render tree* rather than a DOM, shipped
as binary diffs over SignalR. It is the strongest evidence that the React-shaped
version of this idea works, and simultaneously the cautionary tale for
everything the cost model flagged — memory per circuit, latency sensitivity,
sticky sessions, and a UI that goes inert the moment the connection drops.
Microsoft's own guidance steers it toward internal, employee-facing
applications, which is where `economics.md` independently landed.

The .NET 8 change is itself an idea this project has not considered. Making the
render mode a **per-component** choice rather than a per-application one means
an app can put its shared, impersonal, high-fan-out subtree under server
authority and leave a latency-sensitive widget on the client, without two
codebases. Given how sharply finding 3 depends on the personal share of a
subtree, a mixed mode may be a better answer than picking a side.

## Vaadin Flow

Java, with roots in the early 2000s. The elder of the family: a complete
server-side UI object graph with the browser as a thin renderer. It proved the
model viable for enterprise software long before the current generation, and it
also demonstrated the ceiling — memory per session and chattiness are old news
here, not novel discoveries.

## The HTML-over-the-wire family

Rails **Hotwire/Turbo Streams**, **Laravel Livewire**, **Symfony UX Live
Components**, **StimulusReflex/CableReady**, and the recent **Datastar** (1.0 in
April 2026, roughly 11 KB, over SSE rather than WebSockets).

All of these keep the server in charge of rendering but retain no live tree. The
server re-renders a fragment and ships markup; the client splices or morphs it
in. That is coarser than hole patching — more bytes per update, and DOM state
inside a swapped region is lost unless explicitly preserved — but it is far
simpler and has no per-session memory. The trade this project makes is spending
a retained server-side tree to buy scalar-sized updates and structural identity.

## htmx

The most serious competitor to this project, and not for the reason one might
expect.

htmx is **stateless**. There is no server-side session, no retained tree, no
replica. Every interaction is an ordinary HTTP request whose response is an HTML
fragment swapped into a target. The server never knows what your screen looks
like, and does not need to. That one decision erases the entire operational risk
register in `economics.md` finding 7: no memory per session, no sticky sessions,
no reconnect storms, no session migration, no burst fan-out, and a deploy that
kills nothing because there is nothing to kill.

It also shares this project's actual thesis. The complaint that motivates the
whole repository — JSON APIs, DTOs, duplicated client state, synchronization
bugs — is htmx's complaint too, and htmx deletes all of it. Because the server
owns rendering, it owns authorization by construction, which is the same
security property described in the README's trust notes, obtained far more
cheaply. It is real HTML from a real server, so SEO and link previews work,
which is the failing that makes this architecture a bad fit for blogs, forums,
and storefronts.

**For most of the audiences `economics.md` recommends, htmx is the better
answer**, and the document should say so. Internal tools were the strongest fit
identified, and htmx delivers most of the operational win with a fraction of the
machinery and none of the stateful burden.

It is not, however, the same *authoring* experience done more simply, and that
distinction matters for the last section of this document. htmx asks you to
think in hypermedia and write server-side HTML templates. For a developer whose
mental model is typed, composable components with props, that is a different
paradigm rather than a lighter one — no types across the boundary, no component
composition in the sense they mean it, and a template language in place of the
one they use. Simpler for the operator is not the same as familiar to the
author.

What is left for this architecture is a short list:

- **Multiplayer push.** htmx has no native story for another user's action
  changing your screen. The SSE and WebSocket extensions exist, but the
  application ends up re-fetching fragments and hand-managing invalidation,
  which is the synchronization work the premise set out to delete, reappearing
  in a new costume.
- **Update granularity.** One changed number is one scalar, not a re-rendered
  fragment. This matters when the update rate is high.
- **Local DOM state.** Fragment swapping destroys it without discipline;
  structural instance ids and hole patching preserve it by construction.

**And one correction that belongs in the cost model.** Finding 3 claims render
amortization is the one thing a client architecture "cannot do at any price."
That is true of *client rendering*, but htmx is not client rendering — an
impersonal shared fragment can sit behind a CDN. HTTP caching achieves the same
amortization with decades-old infrastructure, for free, geographically
distributed, and with no stateful server at all. The only difference is
freshness: a cache TTL versus an instant push.

So the structural advantage narrows once more, to **impersonal shared views that
need sub-second freshness** — scoreboards, tickers, odds and market boards, live
ops. The shortlist is unchanged but the reason is sharper, and the competitor to
beat there is a CDN, not React. `cost_model.py` currently has no cached
server-rendered HTML baseline, and it should; that is an open gap, not a
resolved question.

## Adjacent ideas worth borrowing from

**React Server Components** solved the problem of serializing a tree that is
partly server-rendered and partly client-hydrated. It is request/response with
no live session, so it is not the same architecture, but it is the most recent
serious thinking about the IR question.

**Meteor** (2012) is the road not taken. It attacked the same API-ceremony
problem by replicating the *database* to the client rather than keeping the *UI*
on the server. Its difficulties — the volume of data on the client, and
authorization pushed into publication rules — are ones this architecture avoids
by construction, which is a useful argument in its favor.

**ASP.NET WebForms ViewState** is the cautionary ancestor: a server-side control
tree whose state was smuggled through the client in an opaque blob. Its failure
modes were unpredictable lifecycle and state nobody could reason about. The
lesson for this repo is that structural, inspectable addressing
(`root/h1/k:<id>`) is not a detail; it is the difference between this idea and
the last time it went wrong.

**Seaside** (Smalltalk) held UI state on the server using continuations, which
is a genuinely different answer to "what is a session."

## The older lineage

The README's framing — an authoritative simulation with a replicated world —
comes from **networked games**, and that literature is the right place to look
for the prediction problem. Quake 3 and Source engine netcode, snapshot delta
compression, client-side prediction with server reconciliation, and rollback
are all mature answers to exactly the question A4 in `design-probes.md` raises.
Games concluded that prediction plus reconciliation is mandatory, not optional,
which is worth weighing against this project's current position.

**X11** is the original display server, and **NeWS** is the more interesting
sibling: it shipped PostScript *programs* down to the display so interactions
could be handled locally without a round trip. That is the client-primitive
coverage problem, with a 1986 answer that looks a great deal like A3's client
islands.

**Opera Mini** rendered pages server-side and shipped a compact representation
to the handset, proving the weak-device argument at a scale nothing here will
reach.

## Mobile server-driven UI

The term "server-driven UI" comes from this world: Airbnb's Ghost Platform,
Meta's Bloks, Lyft's Plex, and Hyperview. Bloks is the most extreme, shipping
what amounts to a UI virtual machine. These are mostly request/response layout
delivery rather than a live diffed session, so they are a naming ancestor more
than an architectural one — but they are the reason the phrase carries
connotations of remote layout configuration, which is not what this is.

## The JavaScript attempts

Worth separating out, because the pattern in them is the whole argument of the
next section. Searching the current landscape turns up a steady trickle of
TypeScript projects in this space, all small and early, and they divide cleanly
into two camps that are *both different from this one*.

**Sync the state, let the client render.** Zocket (typed actors, Immer patches
over a WebSocket, React hooks on the client), rxfy (typed models and normalized
stores with RxJS, serialized into the HTML and resumed on hydration), and
LuckyStack (socket-first React with Socket.io) all keep rendering in the
browser and replicate *data* instead. That is the Meteor lineage, and it does
not give you the authorization-by-construction property or any render sharing,
because the client still assembles the view.

**Sync the HTML, let the server render.** Hyperstar is the closest in spirit to
this project — server-side JSX in TypeScript, explicitly inspired by LiveView,
Datastar, and htmx — but it streams re-rendered HTML over SSE and morphs the
DOM, which is the Hotwire wire format rather than template interning with hole
patches. t-sui goes further and ships JavaScript strings that perform DOM
mutations directly.

None of them retains a server-side instance tree and diffs it at hole
granularity, and none has meaningful adoption. The idea keeps being attempted in
TypeScript and keeps not maturing.

## The authoring axis

Everything above compares wire formats, addressing, and event models. How you
*write* a component is a separate axis, it was missing from this document
entirely, and the family divides differently along it.

**LiveView splits the difference.** Since `Phoenix.Component` it does have
function components — a function taking `assigns` and returning a `~H` template,
with declared `attr` and `slot` — and the vocabulary is openly React-influenced.
But those are *stateless* by construction. State means reaching for
`LiveComponent`, a module implementing `mount/1`, `update/2`, and
`handle_event/3`, whose state lives in `socket.assigns` and moves through
`assign(socket, :count, n)`. Two tiers, and neither colocates state inside the
render function.

**The rest are class or imperative models.** Blazor is a `.razor` class with
`[Parameter]` properties, an `@code` block, lifecycle methods, and
`StateHasChanged()` — a real component tree with diffing, authored as a class.
Livewire is a PHP class whose public properties are the state. Vaadin Flow is
imperative Java widget construction, essentially Swing. Seaside and WebForms are
object trees. The htmx/Hotwire/Datastar family has no component model at all,
only attributes and server-rendered fragments.

**Solara and Reacton are the exception, and they have their own section above.**
Hooks in server-executed function components are occupied territory, in Python.
That narrows the claim below considerably: what is unoccupied is not the
authoring model but its combination with a template-interning wire, in
TypeScript, aimed at the DOM.

**Two consequences for item 1.** The switching cost LiveView charges is two
tolls, not one — learn Elixir and the BEAM, *and* learn a lifecycle-callback
component model — so removing only the language would leave half the barrier
standing. But the familiarity is also partly a disguise, and that is not free.
`assign(socket, :count, n)` is uglier than `useState`, and it is also more
honest: the socket is named right there in the call. A `useState` that looks
exactly like React's while costing a round trip actively conceals where its
state lives, which is a debt this project takes on deliberately and should not
pretend is a pure win.

---

## What is actually left

**1. A server-authoritative runtime a TypeScript team can actually adopt.** This
is the largest practical gap, and the first version of this document missed it
entirely by treating "the authoring experience" as one solved problem. It is
solved — inside Elixir, C#, PHP, and Java. Every *mature* implementation of this
architecture is trapped in an ecosystem that most web developers will not move
to. LiveView is the best system in this space and asks you to learn Elixir, OTP,
and the BEAM first, which is a switching cost far larger than the problem it
solves for most teams. The population that would benefit from the model and will
never adopt the runtime is enormous, and as the section above shows, the
TypeScript attempts to serve it are early and mostly solving a different
problem. Familiarity is not a soft concern; it is the dominant force in adoption,
and "the model you want, in the language you already use" is a real gap rather
than a sentimental one.

The authoring axis sharpens this in both directions. The barrier LiveView puts
up is two tolls rather than one — the language *and* a lifecycle-callback
component model — so removing only the language would leave half of it standing,
and the target is more specific than "in TypeScript." But Solara occupies more
of this item than the paragraph above admits: it has the hooks, the server-side
closures with rich capture, the sessions-sharing-a-process model, and lifetime
tiers this repo has not built. What is left is the conjunction — that authoring
model, on a template-interning wire, in TypeScript, aimed at the DOM and at web
product teams rather than notebooks. Stated plainly, this project is roughly
**Solara's programming model on LiveView's wire**, and it should be argued that
way rather than as a novelty.

**2. Rich objects as handler arguments, in TypeScript.** The temptation is to
call this end-to-end type safety, and that would be wrong: **tRPC already
delivers typed, codegen-free calls across a stateless boundary**, with real
adoption. Claiming types as the novelty picks a fight with an incumbent that has
already won it.

The actual property is that **arguments never cross the wire.** A handler here
is a closure that captured the row itself on the server — its prototype, its
methods, its `Date` and `Map` fields, its object identity, potentially other
closures — none of which survives `JSON.stringify`. That deletes the pattern
every serialized API is built around: send an id, look the object back up,
handle not-found, revalidate the id's shape, re-establish the relationships. It
is also why schema validation sits on every procedure in an ordinary codebase —
that is a tax on having a boundary with an untrusted party, and for arguments
there is no boundary here.

Note the scope honestly. **Blazor Server has this property**, for the same
reason: a C# lambda closes over the real object on the server. **LiveView does
not**, because it chose named events carrying serialized params. So this is a
property of the stateful closure-address model generally, not an invention here,
and the novelty is narrow and precise — *this property, in TypeScript*. Which is
item 1 again, and is why the two belong together rather than as separate claims.

**3. A shared template language across the boundary.** A consequence of the
above: `lit-html` runs on both sides, so in principle the same template could
render on the server or the client, chosen per subtree. Nothing here exploits
that yet, and Blazor's per-component render modes suggest it is the most
promising unexplored direction.

**4. Cross-session subtree sharing.** As far as I can tell, no framework in this
family renders once for many sessions.

**Now measured, though still unbuilt.** Three probes took a census of what is
actually shareable: 99.95% of render CPU is provably redundant at fan-out 2000,
populations share 85.9–91.3% of bytes at subtree granularity, and serving any
number of sessions costs a converging 4 to 5 session-equivalents when nothing is
personalized. So the opportunity is real and larger than modelled. Two things
changed, both away from the original framing. The *urgency* collapsed — with the
measured render constant the penalty for not sharing at fan-out 2000 is 1.20x,
not 9.11x, and egress saturates long before CPU does — so the surviving
arguments are burst drain latency and provable redundancy rather than steady-state
cost. And the blocker turned out not to be addressing, which was already
identical across sessions, but that **event handlers close over their session**,
which is 77.5% of the shareable region. That blocker has since been removed:
handlers are passed the session that sent the event rather than capturing it, so
one closure is correct for every viewer of the same subtree. That makes the
77.5% shareable in principle; nothing shares it yet. See A6 and S1 in
[`design-probes.md`](design-probes.md).

The prize is also narrower than it looks, because for impersonal shared content
the competitor is a CDN rather than a client framework.

**5. Measured numbers.** Every projection rests on estimated microseconds per
node and bytes per session. Nobody publishes these. The `/metrics` endpoint and
`npm run bench` exist to replace the estimates, and that data would be a real
contribution regardless of whether the architecture wins.

### Two honest caveats on the first item

**React syntax is not React.** Adopting a JSX-shaped authoring surface is cheap
and probably correct — it is the vocabulary the target audience already thinks
in, and nothing about it conflicts with template interning. Adopting *React
itself* is a different bet, and it is Option B from the original exploration,
which was rejected for reasons that still hold: the reconciler's internals are
private, the fiber tree is not a stable serialization target, and you would
spend the project fighting a framework built on the assumption that rendering
and the DOM are colocated. Keep the syntax and the mental model; do not inherit
the runtime.

**You keep the model, but you lose the ecosystem.** This is the part that makes
"keep using what you love" only half true. A server-authoritative runtime cannot
run a React date picker, a React charting library, or `react-query`, because
those assume component state and rendering live in the browser. What a React
developer keeps is the component decomposition, the props-down mental model, the
language, the type system, and the tooling. What they give up is npm. That
tension is exactly what LiveView hooks and the client islands in A3 exist to
resolve, and it makes the client primitive library — already identified in
`economics.md` finding 5 as the highest-leverage work in the system — the thing
that decides whether this audience is reachable at all.

Solara sharpens this caveat by showing it is not inherent. Its authors kept
their entire component ecosystem under full server authority, because their unit
of replication is a widget with a browser-side view and a server-side model
proxy, which makes every component an island by construction. The ecosystem loss
here is the price of choosing templates and the DOM, not the price of running on
the server — so A3 is not a gap to be patched but the one architectural decision
this project has deferred and Solara did not.

### So what is the case for continuing

Not "the authoring experience is unsolved," which was too strong. The case is
that the authoring experience is solved *somewhere you cannot get to*, and that
items 1 through 3 describe a version reachable from TypeScript, in which a
handler captures the row itself instead of plumbing an id through a serialized
boundary. That is a legitimate reason to build, and it is largely a distribution
argument rather than a capability one — which is fine, as long as it is labeled
honestly and not mistaken for a technical novelty.

Item 4 remains the only claim no predecessor has attempted. It has now been
measured but not built, and the handler signature it was blocked on — one that
resolves who acted at dispatch time — exists. What is left is building it.

[`positioning.md`](positioning.md) takes this further by asking how each system
above *sold* itself and whether the market bought it. Its conclusion bears
directly on item 4: adoption history and the cost model independently arrive at
the same unit of ownership, and it is not the page.
