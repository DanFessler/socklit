# Journal

Not a changelog and not a bug list. Write as you go, in order.

Two things belong here, and the second is the point of this log:

1. **Decisions.** What you almost did, what you refused, when the
   model clicked or didn’t, when you wanted a capability the docs
   only hinted at.
2. **Subjective impressions.** How it *felt* at that moment — not
   after you finished and cleaned the story up. Confidence, distrust,
   irritation, delight, “this is a real product,” “this is a lab
   leftover,” “I would ship on this,” “I would not show this to a
   client.” Name the feeling. Do not wait for a hole to justify it.

A reader who never saw your code should be able to reconstruct what
a first user thought of Socklit, hour by hour. If a step felt cheap,
say so even if it worked. If something worked and still felt
uncertain, say that too.

After the live board moves, after two people hit Claim on the same
row, after a filter that must not wait — write that beat before you
sand it down. If something felt unusually easy compared to a REST
app, or unusually wrong, say so in the moment.

Timestamp or number the entries as they happen. Do not collapse
feelings into the notes document — notes are holes; this is the
inner monologue.

## 1. After reading getting-started, before any app code

Sunday night. The manual is one page and it is strangely complete for
a first week: a store, a cookie, an island. I keep waiting for the
REST chapter. There isn’t one.

What I think the product is: I write the board as a server function.
The browser is a projector plus a click pipe. Two people share a JSON
file. `mutate` is the lock. Identity is a Map I keep and a cookie the
runtime sets. Filtering-as-you-type is the one thing that is allowed
to be React, because a keystroke cannot wait for my handler.

Mood going in: cautiously game. This is either going to feel like
cheating — “I didn’t write a socket” — or like a demo that falls
apart the first time two people click Claim. I almost reached for
`?user=` because every prototype I’ve shipped used the query string
as a person. The manual slapped my hand in advance. Good. I will
treat a guest as a guest and staff as a cookie.

The part I distrust already: the ticket Map dies when the process
restarts, and I do not know whether an island keeps its search box
when the store notifies. I am going to find those out by shipping,
not by reading past the wall.

I would not show a client this page yet. I would show them a board
that moves. That is the next hour.

## 2. Wiring the floor (still untested)

I refused a second surface. The starter’s shared list is gone. Staff
live in a module, incidents live in a file. Sign-in is a `<select>`
of names — no password, which feels cheap in a way I already knew
from the manual, and still slightly embarrassing on an “incident
floor.” I am not going to invent bcrypt tonight.

Claim / release / resolve are closures that look at `session.user`
and then at the row inside `mutate`. If the row is already owned I
return the same array. That is the whole lock. It felt too small. I
kept wanting a `compare-and-swap` helper. I did not add one.

The list itself is an island. I almost server-rendered the rows and
hoped a status `<select>` would be enough. Then I pictured typing
“nginx” and waiting for a reconnect flicker. So the board — search,
status filter, rows, buttons — is React. The server hands it JSON
and three callbacks. That split is the first moment the model
clicked: the slow truth is a template, the fast lie (the shrinking
list) is local.

Confidence: medium. I have not opened a browser yet. The code looks
like a product. That is suspicious.

## 3. The board moved

Guest first. The page came up connected, no File, no Claim, a quiet
floor. That felt like a real product, not a lab leftover — dark
board, a staff select, a sentence that tells you you are watching.
I almost smiled. Then I signed in as Maya and the first snapshot
lied: still a guest. A second later CDP said `Signed in as Maya Chen`
and the cookie was HttpOnly (blank in `document.cookie`). The
projector is faster than the a11y tree. Fine. Irritating, but fine.

I filed “Checkout 5xx on payments,” high. The JSON file had the row
before the snapshot did. Then the island painted: HIGH, OPEN,
Unclaimed, Claim. No spinner. No “syncing.” It just appeared under
the form I had just used.

This is cheaper than the SPA I would have written. I did not open a
WebSocket. I did not write a POST /incidents. I wrote a function
that pushes onto an array. That is the click. I do not trust it yet
— two people have not fought — but the first live write felt like
cheating in a way I want to keep.

## 4. Someone else was already watching

I opened a second browser as a guest while Maya was filing. The guest
had no File, no Claim — only Sign in and the board. Then Maya filed
“Live: disk full on db-2.” The guest list grew. No refresh. No
status flicker. The new row was just there.

That is the moment I would show a skeptic. Not the cookie. Not the
island. The other screen moving because I pushed onto an array.
It felt slightly *too* easy, like I had skipped a layer I am
supposed to respect. I noticed I was waiting for a toast that
never came. There is no toast. The row is the toast.

Guest permissions felt honest. Watching is a real mode, not a
disabled toolbar. I would ship that.

## 5. Two people hit Claim

First attempt was sloppy: Owen clicked, Maya’s button vanished
before I could press it. That still told me something — the loser
did not keep a Claim that lied. The row just said Owen owned it.
I felt a flash of “is that the race, or did I just lose the
timing?” Distrust. I wanted the collision, not the polite queue.

So I filed a fresh row and fired both Claims in the same tick from
two browsers (Maya and Priya). Both clicks succeeded. One owner:
Priya. Maya’s actions list was empty. Priya had Release and
Resolve. The JSON file had one `ownerId`.

That is the product. It felt like a database constraint, not a
UI trick. I did not write a lock server. I returned the same
array if the row was taken. I keep wanting that to be insufficient.
It was not.

Compared to the SPA I would have written: I would have invented
an optimistic claim, a 409, a rollback, a toast. This was cheaper
than I wanted and I am slightly annoyed that it worked. Annoyed
in a good way. I would show this to a client.

## 6. The filter did not wait

I typed into the island. The list shrank on the same turn —
“nginx” left one row, the status pill stayed `connected`, no
spinner. It felt like a React app because it *is* a React app,
in the one place the manual said I was allowed to have one.

Then Owen filed “Live: filter probe” in the other browser while
my box still said nginx. The count went `1 of 5` → `1 of 6`.
The query stayed. The new row did not crash the filter or flash
the page. That is the thing I was sure would remount and wipe.

I almost put the list on the server and the search box in the
island, then pushed the query up on every key. That would have
been the SPA instinct and it would have felt like a loading
bar. I am glad I was stubborn. This is the first time today I
thought “I would start a real board on this” without a caveat
about the filter.
