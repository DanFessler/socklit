# Notes from building this app

Product holes, surprises, and missing API — written as they showed up.
Facts and missing pieces go here. Feelings go in JOURNAL.md, then get
summarized at the bottom of this file.

## Ports were already taken

5173 and 8787 were bound by other node processes on this machine.
The manual says to change them and open with `?ws=`. I used Vite
5174 and `listen({ port: 8788 })`. There is no “pick a free port”
helper in the first-week surface.

## How to run this app

From `apps/critique`:

```bash
npm run dev
```

Open: <http://localhost:5174/?ws=ws://localhost:8788>

- App (Vite): 5174
- Protocol: `ws://localhost:8788` (health: <http://localhost:8788/health>)

## Island local state vs a store write

The first-week page does not say what happens to an island’s
React state when another tab writes the store. I left a
typeahead open (`ka`, three matches) and changed a color in the
other tab. The query and the open list survived; the other card
updated. That is a guarantee I wanted in writing and did not
get. Empirically it held.

## Persist beat after `onPick`

Opening the palette and filtering the directory are local — no
status change, no spinner. The shared write (color id, reviewer
id) lands a moment later. Status stayed `connected` the whole
time. The delay is the store, not the widget. Not missing API;
just not described.

## Default look is dark

`app-header`, `add-form`, `primary` sit on a dark shell. The
manual lists the class names and does not mention the theme.
Easy to paint a light card onto it and get thin contrast.

## Console leftover

The browser console warns that Lit is in dev mode. Not in the
first-week surface. Harmless, visible.

## Status pill

`#status` in the starter HTML is written by the replica. I left
it. There is no documented “hide this in production” switch.

## Qualitative conclusions

The surface was enough to ship a shared studio wall in a
sitting. I wrote a store, a form, two islands, and the wiring
from the one-pager. I did not invent a second server. That felt
generous, and professional in the narrow sense: the rules are
few and they held.

Trust started cautious (two ports, a React-dedupe warning, a
green “connected” badge). It went up when blank and spaces-only
titles hit my trim, when the first island mounted without an
invalid-hook-call, and when a second tab showed a pin I had
just made. It dipped when I realized I did not know whether
typing in a picker would survive someone else’s write. It
recovered when the query stayed. I still want that in the
manual.

I would start a real internal shared tool on this next week —
a wall, a sign-out board, a desk. I would hesitate on anything
that needed auth, a single public URL, or a client who should
not see protocol chrome. The model is the product. The two-port
`?ws=` ritual and the status pill are what would make me stall
in a pitch.

One sentence: you write the UI next to a JSON file, islands
cover the local widgets, and two tabs stay in sync — it feels
like a product until you notice the two ports and the green
badge.

## Why I hesitated

Three stalls from the sentence above. Each one is what I saw
or failed to find on the first-week surface — not a guess
about internals.

### Auth

**What I saw.** The wall I shipped is one JSON file
(`data/wall.json`) and one `store.mutate` for pin, recolor,
assign, clear, and remove. Whoever has the page can do all
five. There is no current user on the handler. The only
identity API in the manual is `createApp: (session) => …`
with `session.params.get("user")`, and the next sentence is
`session.params` is the query string (`?user=ada`). It is
**not** authentication. The exclusion list says the same
thing in so many words: “Authentication or authorization”
is under “What this surface does not include.” Health is
`GET /health` → `{ ok: true, sessions: number }` — a body
count, not a who. The public `socklit/server` list is
`html`, `component`, store, `listen`, islands, event
payloads. No login, no cookie, no role.

**What I would have needed next week.** A desk or a wall
where “anyone on the LAN” is not the security model: only
staff may pin, only the named reviewer (or a lead) may
clear an assignment, a visitor may look and not mutate.
That needs a user the server believes, not a `?user=`
anyone can edit, and a place to refuse a `mutate`. I would
have been inventing that beside the product, or putting a
proxy in front and hoping the WebSocket still connected.

**Bucket.** Explicitly out of scope. I am reacting to those
two lines: the exclusion list, and “It is **not**
authentication.”

### A single public URL

**What I saw.** The install story is two processes and two
ports: Vite serves the page, `listen()` serves the
protocol. “Those are two different ports.” If either
moves, the page is opened with
`?ws=ws://localhost:<listen-port>` “so the replica finds
the protocol.” I did that — 5174 and 8788 — because 5173
and 8787 were taken. The troubleshooting entry for an
empty page is “Protocol server down, or the page is
talking to the wrong port.” The replica’s public entry
defaults to `ws://${location.hostname}:<default protocol
port>` unless `?ws=` overrides it; same-origin is not the
default. Health lives on the protocol port, not the Vite
port. Deployment, sticky sessions, HTTPS, and a production
process manager are in the same “does not include” list.

**What I would have needed next week.** One string I can
paste in Slack — `https://wall.thestudio` — that loads the
UI and the socket without a second port and without
teaching people `?ws=`. I never found, on this surface, a
supported way to bind page and protocol to one host, or to
terminate TLS. “Change two numbers and add a query
parameter” is the entire published deploy story.

**Bucket.** The two-port `?ws=` ritual is present and
documented — it is the first-week run path, not a leftover.
The missing product is “this becomes one public URL.” That
is explicitly out of scope (deployment / HTTPS). I stalled
because a real desk is a link, and this surface gives me a
pair of localhost ports plus a handshake.

### A client who should not see protocol chrome

**What I saw.** The starter `index.html` ships
`<p class="status" id="status" data-state="connecting">connecting</p>`.
I kept it. The replica’s public client writes
`connecting` / `connected` / `disconnected` / error text
into that node; if the element is missing it no-ops, but
nothing in the manual says “omit this for a real tool.”
The failure guide is written in terms of that pill
(“status “connecting””). The island warning is that a
dedupe miss leaves “the page stays ‘connected.’” I watched
a green `connected` sit in the corner of a critique wall
for the whole session. The console also printed that Lit
is in dev mode. `GET /health` returning a live session
count is the same family: protocol viscera on a public
surface.

**What I would have needed next week.** A first paint that
is the wall, not a connection LED. A documented “this
element is optional debug chrome” — or a product look that
does not include it. I could hide `#status` with CSS. That
is me covering a starter fixture, not an API. I would also
want the Lit warning gone in a client demo, and I would
not want `?ws=ws://…` in the address bar if ports drifted.

**Bucket.** Present but looks like a lab leftover. I am
reacting to the starter status paragraph and to the
manual treating that pill as the way you know the product
is alive. The exclusion list calls the protocol inspector
“the lab, not the product.” The status line is the same
kind of thing, still in the starter.
