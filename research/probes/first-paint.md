# First paint

**Forces S5: what is the initial state, and does first paint need a session?**

S5 is **specified and partially built.** `listen()` GET is a render.
`?paint=shell` is the old empty document. Default is `html`: the tree
inside `#app`. Connect still sends a full `snapshot` (replace).
`html+adopt` is the same HTML until the handshake exists.

```
curl 'http://127.0.0.1:8795/brief?probe=first-paint'
curl 'http://127.0.0.1:8795/brief?probe=first-paint&user=Ada'
curl 'http://127.0.0.1:8795/brief?probe=first-paint&paint=shell'
```

The lab listen() is **8795**, not 8787. 8787 is the product default;
a first-party app (the incident floor) already owns it.

The product today, for `paint=shell`, is an empty `<main>`, then
JavaScript, then a socket, then `templates` + `snapshot`. That is an SPA
cold load. A server that already owns the tree and still does this will be
rejected for the reason people reject SPAs, not for the reasons this
architecture is actually weak.

The prior-art target is LiveView's dead render, not React `hydrate()`. The
HTTP response should be the page. Connect makes it live. Connect does not
invent the page.

## Why this is not the marketing-site probe

[`design-probes.md`](../design-probes.md#probes-that-would-mislead) already
refuses a content site as a cost study: static HTML wins, and a true number
that recommends the wrong thing is worse than no number. This probe is not
that. It is a **live** page that must also be a **document**.

The docs site is the product wound, not the subject. `site/index.html` is a
shell titled "Socklit". A crawler and a `curl` see no article. That is why
S5 is urgent. Measuring whether Socklit is cheaper than a CDN at serving
`/guide` is still forbidden.

## What the probe does

A public brief and a signed-in chip on the same URL.

```
GET /brief                 → stranger
GET /brief  + cookie       → Ada
GET /brief  + ?paint=shell → today's behaviour (control)
```

The brief has a title, a body, and a byline. Those bytes must appear in the
HTTP response with no JavaScript. Next to them:

- **Readers.** A store number. It ticks, or another tab increments it.
  After connect this is live. In the HTML it is whatever the store was at
  request time.
- **Chip.** "Sign in" with no cookie. "Ada" with one. The cookie is already
  on the GET (`identify` already reads it). The socket is not required to
  know who this is.
- **Star.** One button. No-JS cannot press it. That is allowed, and the
  probe must say so rather than pretend progressive enhancement of every
  control.

`?paint=` is the independent variable:

| Value | What the GET returns | What connect does |
| --- | --- | --- |
| `shell` | today's `index.html` | `templates` + `snapshot` into empty `#app` |
| `html` | the tree as HTML inside the document | `snapshot` replaces `#app` |
| `html+adopt` | the same HTML, with addresses in the markup | connect sends the HTML's revision; patches apply; `snapshot` is reconnect-only |

`html` is S5's tier 2. `html+adopt` is the cheap form of tier 3: adopt the
*addresses*, not lit's comment markers. `@lit-labs/ssr` + `hydrate()` is
out of scope. The replica already paints from a wire tree. HTML is another
encoding of that tree. The checkout harness already walks `WireInstance`
to markup; the probe should not invent a second renderer to prove the
first one exists.

Three fetches, every configuration:

1. **`curl`** — no JS, no socket. Title and body present or not.
2. **Browser, socket delayed 400 ms** — first contentful paint vs the
   shell. Then connect.
3. **Browser, socket never opens** — the document stays. Star does
   nothing.

A fourth, for the revision race: write the store after the HTML is sent
and before the socket is up. `html` will flash to the new tree.
`html+adopt` must patch N→N+k. If it cannot, that is the finding, not a
bug to hide.

## What it has to force

### S5: does first paint need a session?

**The hypothesis.** No. First paint needs a **render**, and a render
needs whoever `identify` can compute from the HTTP request. It does not
need a socket, a `HookHost` that outlives the response, or a tab id.

S4's three tiers stay. This is the audience checkout named and did not
touch: a visitor with no session at all. They are not a fourth lifetime.
They are a request. The only state they can see is the store and whatever
`identify` returned. `useState` has no one to belong to. `useDurable`
with `{ share: "tab" }` has no tab. `{ share: "user" }` can run if
`identify` named a person.

`HookHost.transient()` already exists. `serialize` already defaults to
it. An HTTP render that uses both is not a new primitive. It is the host
calling a function it already calls on connect, and writing HTML instead
of a WebSocket frame.

### The host, not the app

Checkout could fake the missing lifetime with `?draft=store`. First paint
cannot be faked in an app. `listen({ publicDir })` serves a static
`index.html` for every extension-less path. Until that GET runs the app,
every measurement is the control.

**The probe is allowed to change `listen` and the replica boot.** That is
itself a verdict: S5 is a host concern. An author cannot "use SSR" the
way they use `useDurable`. If the probe is built with the runtime frozen,
the only honest result is "curl sees a shell," which we already know.

### Mechanism (to confirm or kill)

1. On GET, `identify` from the request (cookie, `?ws=` token, or nothing).
2. `createApp` as connect does, against a transient host (and the
   process-wide vault, if any).
3. `serialize` as connect does.
4. Encode the committed tree as HTML into `#app`. Carry the revision on
   the document (`data-revision` or a sibling script).
5. The replica, on connect, either replaces `#app` (`html`) or sends that
   revision and applies patches (`html+adopt`).

`snapshot` becomes **reconnect-only** under `html+adopt`. A first visit
that got HTML should not pay for the same tree a second time on the
socket. If the bytes say otherwise, the hypothesis is wrong or the
adopt path is unfinished.

Handlers in the HTML are not functions. They are addresses, the same
ones the replica already binds. No-JS does not fire them. JS that has
not connected does not fire them. That is the event story; it is not a
reason to pull in lit hydration.

Islands are empty wells in the HTML. The article must not live inside
one. If the brief is only reachable through `<mount>`, the probe has
cheated and `curl` will fail.

## Measurements

From `npx vitest run test/probes/first-paint.test.ts`. The harness GETs.
A harness that never speaks HTTP cannot see S5.

| # | Result |
| --- | --- |
| 1 | `html` GET contains title, byline, body. `shell` does not |
| 2 | Vite HTML now contains the brief (`firstPaint` plugin). Disable JS and the paragraph is there. `?paint=shell` is the empty control. First `snapshot` does not blank the mount |
| 3 | cookie `socklit_session=ada` → chip Ada; no cookie → Sign in |
| 4 | not measured (`html+adopt` is unfinished) |
| 5 | not measured (connect still sends `snapshot`) |
| 6 | star is in the HTML; POST `/brief` is 404 |
| 7 | `useState` omitted (initial empty). Tab durable is `initial tab` with no tab. User durable reads the vault when `identify` named someone |

`HookHost.transient()` is **not** the HTTP host. Transient forbids hooks.
GET uses `HookHost.firstPaint()`, which allows hooks and discards the
host after the response.

Still open: 4 and 5 (`html+adopt` handshake). Measurement 2 in
the lab is a shell, not `html` replace of an HTTP tree.
No `/metrics` sweep. Do not report Socklit-versus-CDN.

## What a reader should not conclude

- **That this recommends Socklit for a blog.** Static files still win
  that. The probe asks whether a *live* app can also be fetched as a
  document.
- **That every control must work without JavaScript.** Star does not.
  The brief does. That split is the product, and it is honest.
- **That we need `@lit-labs/ssr`.** We need HTML of the interned tree.
  lit's digest and `hydrate()` are a different, dearer question, and
  they assume the browser holds the functions.
- **That `html+adopt` is required to ship.** `html` already beats the
  shell for crawlers and for first paint. Adopt is whether connect
  pays for the same tree again, and whether a revision race jumps
  the DOM. A first snapshot does not blank the mount; the visible
  cost so far is a layout shift, not a white flash.
- **That the docs site is this probe.** It is the reason to build it.
  Using `/guide` as the subject would recreate the misleading
  marketing-site study.

## Where the wall was

**`listen` served a file.** That wall is crossed: GET runs `createApp`
and writes the tree into `#app`. `?paint=shell` is the control.

Week-one Vite is no longer a shell. `firstPaint()` in `socklit/vite`
asks `listen()` for the tree and writes it into Vite's `#app`. Disable
JavaScript on the dev URL and the brief is there. `?paint=shell` is
the empty document.

The remaining wall is **adopt**. Connect still sends a full `snapshot`.
A durable draft keyed on `socklit_tab` still cannot appear in a `curl`.
That is correct. The brief does not live in that cell.
