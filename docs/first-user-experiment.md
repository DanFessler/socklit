# First-user experiment

A blind build against the product surface, before launch.

**Branch.** `experiment/first-user`

**What the stranger is allowed to read.**
[`getting-started.md`](getting-started.md), `starter/`, `apps/feedback/**`,
and types that resolve from `socklit/server`. Not `research/`, not
`server/app`, not `server/probes`, not tests.

**Assigned app.** A shared office fridge: add items with a quantity,
take one, restock, remove empties. Two tabs stay in sync.

**What we are looking for.** Missing exports, missing docs, APIs they
invent because they could not find ours, and anything they had to open
the framework to understand.

Notes from the builder: `apps/feedback/NOTES.md`.

## Result

[Blind fridge app](ff59e282-c6c8-4933-9b20-af1660063379) shipped a working
shared fridge in `apps/feedback` without opening the runtime. Two-tab
sync worked (`useStore` + `listen({ subscribe })`). They split the docs’
one-file store example across `app.ts` / `server.ts` by guess, and it
was the right guess.

That is the good news: the public surface is enough to finish a real
app. The punch list is what they had to invent or sit with.

### They shipped anyway

- `createJsonStore` + `mutate` + `subscribe: (onChange) => store.onChange(() => onChange(store))`
- `useState` for a per-tab validation flash
- `?disabled=${…}` (not in the doc; only `.checked=` was)
- Nested `<form>` per row for restock
- Alternate ports when 5173/8787 were busy

### Holes (from their NOTES, in order of product cost)

1. **Starter is still a per-tab counter.** Shared store + `subscribe`
   exists only as a one-file docs example. Splitting it across
   `app.ts` / `server.ts` is the first real app and it is undocumented.
2. **Forms wipe on re-render.** A rejected submit and a successful one
   both snap inputs back to the template. No public way to keep a draft.
   (The replica already leaves *unbound* inputs alone — the todo add
   field relies on that — but the getting-started never says so, and
   `value="1"` on qty makes the snap visible.)
3. **`mutate`’s `result` is unexplained.** The example always returns
   `undefined`. They cargo-culted it.
4. **Native HTML validation can skip `@submit`.** `min="0"` blocked the
   submit; the server handler never ran; a stale `useState` error stayed
   up. “Do not preventDefault” does not say the handler might not fire.
5. **Store file + ports.** `file` is CWD-relative; `data/` is created
   for you; neither is documented, nor gitignore. Vite’s port is not in
   the `?ws=` story. Health’s `{ sessions }` is not documented.

### Also missing from the surface (they noticed, did not block)

- Typed `SubmitPayload.fields` (numbers arrive as strings)
- Empty `keyed([])` vs omit-the-list
- Concurrent `mutate` (last write wins? lost update?)
- Store-wide / parse-failure UI
- CSS class catalog (`add-form`, `item`, …)
- Boolean attributes other than `.checked`
- “Use `useState` for flash messages”

### What this does *not* say

They did not need islands, `component.tag`, or to read `server/`.
The first-week path held. Those holes are patched in getting-started
and the starter is now a shared list.

## Round 2

New stranger, new folder: `apps/holds`. Task is an equipment loan desk
with a 40-person staff directory. Filtering as you type must feel local
— that is the island door. They may only read getting-started, starter,
and `apps/holds`.

- Holes / missing product: `apps/holds/NOTES.md`
- Notable thinking while building: `apps/holds/JOURNAL.md`

### Result

[Blind equipment holds](44573d82-abc7-4326-b44a-eac9f3d92b1b) used an
island. They read the typeahead sentence, took the sample
`StaffPicker` contract, and wrote a small React filter. Two-tab sync
worked. They called `mount()` (typed) instead of the `<mount>` tag,
and `GearRow({ item })` instead of `component.tag`.

The island path is findable. The install path is not.

### They almost did (JOURNAL)

- Put the staff directory in the store (refused: it is reference data).
- Server-side typeahead with `useState` + an input (refused: that is
  the 400ms keystroke).
- `.value=` on the add field to clear it (refused: it would snap when
  the other tab wrote).
- Close the picker on blur (refused: blur beats the option click; the
  docs name a focus-trapped popover and then stop).
- Rewrite the picker as `<datalist>` to dodge the hook crash (refused).

The model clicked when `ada` filtered in the same keystroke — not on
the shared list, which they already believed.

### Holes

1. **Two Reacts.** `npm install react` as documented + `socklit` as a
   `file:` (or any host that also depends on React) → invalid hook
   call. They added Vite `resolve.dedupe`. The island painted
   `unknown island` never appeared; the row stayed, the widget died.
   Status stayed “connected.”
2. **No example `.island.tsx`.** Contract + register are documented.
   The React file is “receives JSON plus `onPick`.”
3. **No island chrome.** Default CSS has `item` / `add-form`, not a
   typeahead. Click-outside and keyboard list nav are named, not shown.
4. **Quiet island failure.** A thrown island does not drop the socket
   or mark status. Easy to think Add failed.
5. **Draft reset vs snap.** After a good add the field stays dirty.
   They will not bind `.value=` because of the last doc pass. No
   `form.reset`.
6. **Ports.** Collision with the lab `npm run dev` is still something
   you notice, not something Socklit warns about.

### What this does *not* say

They did not open `islands/` or `apps/feedback`. The wall held. They
wanted an island for the right reason, and the missing piece was
React identity, not the contract.

## Round 3

New stranger, new folder: `apps/critique`. Task is a shared studio
critique wall: title, a color stamp from a palette popover (not a hex
field), a reviewer typeahead against a ~40-person roster. Filtering
and opening the palette must feel local.

They may only read getting-started, starter, and `apps/critique`.
The journal this time must record **subjective impressions** as they
happen, not only refusals. Notes must end with **Qualitative
conclusions**.

- Holes / missing product: `apps/critique/NOTES.md`
- Inner monologue: `apps/critique/JOURNAL.md`

### Result

[Blind critique wall](43dc26b6-d316-4c59-8d0e-9faad2ae8217) shipped
a studio wall (title, URL, named color, reviewer) in
`apps/critique`. Two islands: a swatch tray and a typeahead against
a 42-person directory. Palette and roster stayed out of the store.
Two-tab sync worked. Ports moved to 5174 / 8788.

The island path, after last round’s dedupe + example component,
mounted on the first try. The new ask (feelings as they happened)
is in the journal; the verdict is in NOTES under Qualitative
conclusions.

### They felt (JOURNAL, in order)

- **Manual:** relief, then suspicion. A one-pager that confident
  is either a product or a lab that has not been asked anything
  ugly. The store sentence they would show a client. Two ports,
  `?ws=`, and the status pill already felt like leftovers.
- **Island vs server:** clear enough they did not hunt. First
  “I would start a real shared tool on this.” Quiet fear the
  island would remount and eat the caret when the other tab wrote.
- **First mount:** exhaled. Cheap delight that the recipe was
  true. Cards looked like a paper mock on someone else’s dark
  theme.
- **Widgets + two tabs:** “this is a real product, not a demo of
  a product.” Slightly giddy, a little watched by the green pill.
- **Remount test:** fear written down before evidence; query
  `ka` survived a color write in the other tab. Trust recovered
  hard. They almost overbuilt to defend a remount that did not
  happen.
- **Stop:** would show the wall to a studio. Would not yet show
  the connected pill to a client. Chrome is what they distrust
  now, not the model.

### Holes

1. **Island state vs store write is undocumented.** Empirically
   React local state survived another tab’s `mutate`. They wanted
   that sentence in the manual and almost designed around its
   absence.
2. **Persist beat after `onPick`.** Local pick, then a moment
   later the stripe/name updates. Status stayed connected. Not
   missing API; not described.
3. **Default theme is dark** and the class catalog does not say
   so. Easy to paint light cards and get thin contrast.
4. **Lit dev-mode console warning.** Harmless, visible, not in
   the first-week surface.
5. **Status pill has no hide switch.** Starter HTML includes it;
   replica writes it; they left it and called it the thing they
   would not show a client.
6. **Ports.** Same collision as rounds 1–2. Documented; still
   two magic numbers and a query string.

### Qualitative verdict (their sentence)

You write the UI next to a JSON file, islands cover the local
widgets, and two tabs stay in sync — it feels like a product
until you notice the two ports and the green badge.

They would start an internal shared tool on this next week.
They would hesitate on auth, a single public URL, or a client
who should not see protocol chrome.

### What this does *not* say

They did not hit two Reacts. Last round’s install hole is no
longer the story. The wall held; they did not open `apps/holds`
or the lab. The remaining distrust is packaging (ports, status,
console), plus one missing guarantee about island local state.

## Round 4

New stranger, new folder: `apps/studio`. Task is a shared review desk
that must **refuse** writes: sign in as a studio member, survive
refresh, a new tab is a different person, only the author unpins,
only the assigned reviewer stamps “looks good.” `?user=` is not
identity.

They may only read getting-started, starter, and `apps/studio`.

- Holes / missing product: `apps/studio/NOTES.md`
- Inner monologue: `apps/studio/JOURNAL.md`

### Result

[Blind studio desk](6f55e55f-4181-4b05-afdf-b8a28e4ab878) shipped
Northline Review Desk in `apps/studio`. Ten members as reference
data; wall in the store. `identify` + `grant`, not `?user=`. Ports
5186 / 8792.

All four checks passed: guest can see and cannot write; Ada
survives refresh; a second tab starts as a guest and Jules cannot
remove Ada’s piece; sign-out in one tab leaves the other unchanged.
They opened `?user=ada` and stayed a guest.

They used `createApp`, hid the illegal buttons, and still wrote the
mutate guards. No island.

### They felt (JOURNAL, in order)

- **Manual:** identity is the most complete “real product” passage
  on the page. Grateful they burned `?user=`. Ticket `Map` is honest
  and cheap — a cloakroom, not a session service. `grant` exists
  *because* two ports do not share cookies. Stomach: still might be
  a lab leftover with a coat of paint.
- **Wiring:** write refusals felt like a spine. `grant` still felt
  like a magic word. Ports + `?ws=` irritated them before a window
  was open. Strict TS wants `SessionHandle<Member>` on every
  handler; the manual leaves `session` untyped.
- **First sign-in:** empty pick said no — first time the server
  *heard* them. Then Ada, a reconnect flicker, pin form. Cheaper
  than they wanted, more real than they expected. Would show a
  studio manager on a LAN. Would not show a client who asked
  “where do users live?”
- **Refresh:** still Ada. Magic word became a mechanism. Tab
  remembered; server is a goldfish. They believe the docs in both
  directions now.
- **Refused mutate:** they never saw a stolen click bounce because
  the button was hidden. They typed the guard anyway. “The product
  asking me to be an adult. I liked it.”
- **Two tabs:** second tab was a guest. First “I would start a real
  desk on this next week.” Cheap tickets. Real no. Would hesitate
  on restart survival and SSO. Would not hesitate on “only the
  author may take this down.”

### Holes

1. **Occupied defaults, silent wrong server.** Forget `?ws=` and
   the replica connects to whoever owns 8787. No “is this my
   listen?” check.
2. **`app` vs `createApp`.** Starter is `app`. Identity needs
   `createApp`. Two listen shapes, one page.
3. **Tickets die with the process.** Documented. `tsx watch`
   restart → guest until you sign in again.
4. **No way to publish the protocol port to the page** except
   `?ws=` or the 8787 default.
5. **Handlers do not infer `session`.** Strict mode wants an
   explicit `SessionHandle<Member>`.
6. **`grant` reconnect flicker.** Old tree paints for a beat on
   sign-in and sign-out.

### Qualitative verdict (their sentence)

A server-owned wall with a person on the socket, and yes — if you
refuse in the write, not just hide the button.

They would start a LAN desk with a directory they already trust.
They would hesitate on SSO or a user that survives a restart.

### What this does *not* say

The previous round’s “I would hesitate on auth” is no longer the
story for a LAN desk. The wall held; they did not open
`apps/critique` or treat `?user=` as a person. What remains is
packaging (ports) and the cloakroom they were told they were
getting.

## Round 5

New stranger, new folder: `apps/floor`. Task is a live incident
floor: guests watch, signed-in staff file and claim, a claim is
exclusive and refused at the write, filter-as-you-type must feel
local. Two people means two browsers (cookie is per-browser). The
load-bearing check is both of them hitting Claim on the same row.

They may only read getting-started, starter, and `apps/floor`.

- Holes / missing product: `apps/floor/NOTES.md`
- Inner monologue: `apps/floor/JOURNAL.md`

### Result

[Blind incident floor](63a8ddd4-c350-4eb8-9e1f-4b406d5102df) shipped
a live ops board in `apps/floor`. Guest watch, cookie sign-in, file /
claim / release / resolve. The board is one island (search + rows).
Open `http://localhost:5173` — no `?ws=`. Proxy held.

Claim race: Maya and Priya both clicked Claim on the same fresh row
in the same tick. One `ownerId` (Priya). Maya’s button gone, not
lying. Filter: `nginx` on the same keystroke; Owen filed while the
box was still `nginx`; query survived, count `1 of 5` → `1 of 6`.

### They felt (JOURNAL, in order)

- **Manual:** waiting for the REST chapter. There isn’t one. Almost
  reached for `?user=`. Would not show a client the page. Would show
  them a board that moves.
- **Wiring:** the lock was “return the same array if owned.” Felt
  too small. Wanted compare-and-swap. Did not add it. Island for
  the shrinking list: “the slow truth is a template, the fast lie
  is local.”
- **First file:** cheaper than the SPA. No POST, no socket they
  wrote. “I do not trust it yet — two people have not fought.”
- **Guest watching:** Maya filed, guest list grew. **The moment
  they would show a skeptic.** Not the cookie, not the island.
  The other screen moving because they pushed onto an array.
  Waited for a toast. The row is the toast.
- **Claim race:** first try they lost the timing and still saw
  the loser lose the button. Second try, same tick, one owner.
  “A database constraint, not a UI trick.” Annoyed it worked.
  Would show a client.
- **Filter:** felt like React because it is, in the one allowed
  place. Remount they feared did not happen. First “I would start
  a real board on this” without a filter caveat.

### Holes

1. **Island callbacks do not take `session`.** They closed over
   `user` and still refuse in `mutate`. Different spelling from
   `@click`.
2. **`registerIsland` types reject a real component.** They cast.
3. **App `tsc` follows imports into Socklit** and reports errors
   in host files. They scored `src/` only.
4. **Ticket Map / no password.** Documented. Anyone on the page
   can become Elena.

### Qualitative verdict (their sentence)

The click is already the write — I only open React when a
keystroke cannot wait for the server.

They would start an internal ops board. They would not sell the
sign-in as-is.

### What this does *not* say

The unique bet landed in the journal: no API, `mutate` is the
lock, the other screen is the toast. They did not open
`apps/studio`. Same-origin cookie meant two browsers, not two
tabs, for two people — they followed it.

## Round 6

New stranger, new folder: `apps/lobby`. Task is a checkers lobby:
sign in, sit at a table, spectators watch, the **server** is the
referee. Squares are server markup. An island may only be the piece
in hand. Slim English draughts. Two people means two browsers.

They may only read getting-started, starter, and `apps/lobby`.

- Holes / missing product: `apps/lobby/NOTES.md`
- Inner monologue: `apps/lobby/JOURNAL.md`

### Result

[Blind checkers lobby](b146262a-a900-4849-bd56-e8128308e0c6) shipped
a hall of tables in `apps/lobby`. Squares are server `html`. The
island is an overlay for the piece in hand. Ports 5174 / 8788
(defaults taken). Page URL only.

Referee held: illegal drops no-op, no lying highlight. Spectator and
opponent saw a legal move and a capture without a refresh. They
wrote tickets to `data/tickets.json` themselves after `tsx watch`
evicted an in-memory `Map`. They closed over user on the island
callback — this agent started before `mount()` typed `session`.

### They felt (JOURNAL, in order)

- **Manual:** waiting for the REST chapter. It does not come. If
  the server cannot be the referee, the product is a lie and they
  want that in writing.
- **Sit:** `grant` reconnect wiped `useState` (which table they
  were watching). Alone at The Oak, slightly ceremonial. Did not
  move. “I am not the referee.”
- **Other seat:** Ben sat. Badge flipped to live. Second tab still
  Ada. “Someone sat down across from me. Not a presence API.”
  Would show a client.
- **Spectator:** gold ring local. Drop, three windows agree. Smug.
  “The spectator never had a chance to disagree.”
- **Illegal:** cream square, non-diagonal, Ben clicking Ada’s
  piece — nothing. Destination is a hope. `mutate` is the law.
  Product stopped feeling like a demo of templates.
- **Capture:** eleven cream pieces, three screens. “A little mean.
  A little perfect.” Would ship a club night. Not a rated ladder.

### Holes

1. **`grant` reconnect kills `useState`.** Sign in lands you back
   in the hall. Manual never says the tab gets a new life.
2. **In-memory tickets vs `tsx watch`.** Cookie still there, guest
   in Ada’s chair. They persisted the book to JSON and narrowed
   the watcher to `src/`.
3. **Island callbacks / session.** They closed over user (docs at
   the time). We typed `session` on `mount()` after they started.
4. **Ports.** Change both listen and the proxy target.

### Qualitative verdict (their sentence)

The board is not a client object we sync. It is server markup, and
the only React I wrote is the hand that holds a piece until the
referee speaks.

They would start a real lobby. They would hesitate on identity and
the reconnect wipe. Neither is a reason to go back to REST.

### What this does *not* say

They did not canvas the board. They did not open `apps/floor`. The
unique bet landed again: three windows, one template, illegal is
silence. They also answered the earlier question — when the `Map`
hurt, they put tickets in a file without us telling them to.

### Revision: board as island

Reviewer feedback: the overlay-hand flashed the source square on
drop (dnd-kit overlay dies before the patch). We sent
[Blind checkers lobby](b146262a-a900-4849-bd56-e8128308e0c6) back
to put the **whole board** in the island, driven by `men` / `turn`
/ `you` / `onMove`. `play()` stays the referee. No hybrid slot.

They did it. Overlay-hand gone. Optimistic paint holds the man on
the destination; illegal paint walks home when `men` does not
change. New sentence: the hall is server UI; the board is a replica
of `men`; the referee is `mutate`, not the drag library. JOURNAL §9.
