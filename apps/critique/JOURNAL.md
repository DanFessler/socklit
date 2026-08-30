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

Timestamp or number the entries as they happen. Do not collapse
feelings into the notes document — notes are holes; this is the
inner monologue.

## 1. After reading getting-started, before any app code

I read the whole first-week manual in one sitting. It is short. That
is the first feeling: relief, then a little suspicion. Relief because
I can hold the surface in my head — components return `html`, clicks
are server closures, shared data is a JSON file plus `subscribe`,
local chrome is `useState`, and anything that cannot wait a round
trip is an “island.” Suspicion because a one-pager that confident
usually means either a real product or a lab that has not been
asked to do anything ugly yet.

What I think the product is: a server-authoritative UI runtime. I
do not write a REST handler for “add a piece.” I write a function
next to the markup and the browser ships an address. Two tabs stay
in sync because they share a store, not because I invent a socket.
That part already feels like a product. I would show that sentence
to a client.

What I already trust: the starter split. `app.ts` is the UI and the
store. `server.ts` is three lines of wiring. `client.ts` is “do not
put app logic here.” The store rules are blunt (do not mutate
`.state`, same-reference is a no-op, `useStore` must see the same
object you notify). Blunt is good. I trust blunt.

What I already distrust: two ports and a `?ws=` escape hatch. That
is the first thing that felt like a lab leftover. Also the status
pill in the HTML — “connecting” / “connected” sitting above the
app like a debug badge. A real tool hides that. The manual is
honest that native `required` can skip your handler, that tags are
not type-checked, that a plain array in a hole is an error. Those
are the kind of warnings that make me slightly more confident, not
less — someone has been bitten.

Mood going in: curious, a little braced. The critique wall needs a
color popover and a 40-person typeahead. The manual’s own words
for islands are almost exactly those two widgets. I am going to
take that path. I am also slightly nervous about the React
dedupe warning (“invalid hook call and the page stays connected”).
That sentence does not sound like a product I would ship to a
studio next week. It sounds like a seam.

## 2. Choosing the island vs server path

I almost talked myself into doing the color palette with
`useState` on the server. Open/closed chrome is “this tab only,”
the manual says so. One click opens the swatches, the next click
writes the color. That would work. It would also mean the first
click — just opening the tray — waits for the server. The brief
says opening and picking must feel local, same gesture, no
spinner, no status flicker. A round trip to unfold a tray is not
that. So the palette is an island. The typeahead was never a
question: filtering forty names on each keystroke through the
server would feel like 2009.

I am not putting the directory or the palette in the JSON file.
The manual does not say “reference data goes here,” but it does
say the store is the shared mutable thing. Colors and people are
mine. I will keep them as modules. Only the wall — pieces, a
color id, a reviewer id — goes through `mutate`.

Feeling: the split is clear enough that I did not need to hunt.
That is the first moment I thought “I would start a real shared
tool on this.” Still a quiet distrust around whether an island
will remount and eat the caret when the other tab writes. The
manual does not say. I will find out when I open two tabs.

## 3. Ports already taken, then the first compile

5173 and 8787 were occupied. The manual told me exactly what to
do: change them, open with `?ws=`. I did. It felt slightly
cheap — two magic numbers and a query string instead of one URL
— but it was documented, so I was not angry. I was just aware
that a stranger who skipped that paragraph would stare at
“connecting” forever.

I copied the island recipe almost line-for-line: `defineIsland`
on the server, `<mount .Island=…>` in the template, React file
the server never imports, `registerIsland` in `client.ts` before
the replica boots. The “do not mix the import graphs” rule is
the kind of rule I trust because it is easy to violate and the
manual said so out loud.

I left `required` off the title field on purpose. The manual
warned that native constraint validation can skip the handler. I
want a spaces-only title to hit *my* trim, not the browser’s.

About to start `npm run dev`. Mood: impatient to see whether an
island actually appears or whether I get the invalid-hook-call
doom the manual mentioned. That sentence is still sitting in my
stomach.

## 4. First load, first pin, first island mount

The page came up “connected” on the first try with `?ws=`. Empty
state, pin form, no stack trace. That was a small lift — I
exhaled. It looked like a tool, except for the green “connected”
badge in the corner, which still feels like a lab leftover I
was not invited to hide.

Blank submit and spaces-only submit both hit my trim and showed
“Give the piece a title.” No spinner. The handler ran. Trust went
up a notch. I would show that error to a client.

I pinned “North lobby mural studies.” The card appeared with a
mustard stripe, the URL, a Mustard swatch button, and a “Find a
reviewer…” field. The islands mounted. No invalid hook call. No
“unknown island.” I felt actual delight — cheap, surprised
delight, the kind you get when a documented recipe is true.

The card is cream on a dark shell. The default look is darker
than I assumed from the class names. The card looks like I
brought a paper mock into someone else’s theme. I will fix the
CSS so it does not look like two products stacked. First I want
to pick a color and type a name, because that is the part I
still do not trust.

## 5. Palette, typeahead, two tabs

I opened the mustard trigger. The tray appeared in the same
click — eight named swatches, no spinner, status stayed
“connected.” I clicked Coral. The tray closed immediately. A
beat later the stripe and the trigger said Coral. That beat is
the store write, not the pick. The pick itself felt local. I
would ship that widget.

Typeahead: I typed “pri” and the list collapsed to Priya Nair
on the same keystrokes. No round trip while filtering. I
clicked her name. Placeholder became “Priya Nair,” Clear
appeared. Same small persist beat. Still no status flicker.
This is the first moment I thought “this is a real product,”
not a demo of a product.

Then I opened a second tab. The mural was already there, coral,
Priya. I pinned “Wayfinding sketches, east wing” in tab two.
Tab one grew a second card without a refresh. I cleared the
reviewer in tab one; tab two dropped her. That is the sentence
I would tell another engineer. I felt slightly giddy, and also
a little watched — the “connected” pill is still sitting there
like a TA.

The cream cards are wrong on this dark shell. Title contrast
is thin. I am going to restyle before I call it done. That is
irritation at myself, not at Socklit — I assumed a light
starter theme from the class names. The product has a look. I
should have looked at it first.

## 6. The remount I was afraid of, and then I stopped

I left the typeahead open on tab one with “ka” in the box —
three names showing. In tab two I changed the other card from
Mustard to Slate. I expected the caret to die. I had written
that fear down before I had evidence. Tab one kept “ka.” The
list stayed open. The Slate label arrived on the other card
anyway. Trust recovered hard. The manual never promised this.
I would still want that sentence in the docs, because I almost
built something more complicated to defend against a remount
that did not happen.

I clipped my own dropdown with `overflow: hidden` on the card.
That was me, not them. Irritation, then a one-line fix. The
picker was fine once the tray could escape.

CSS hot-reloaded without dropping the socket. Another small
lift. The console still yells that Lit is in dev mode. I did
not ask for that. It is the last lab leftover I will mention.

I am stopping. The wall pins, labels, assigns, clears, removes,
and two tabs agree. I would show this to a studio. I would not
yet show the green “connected” pill to a client. The product
underneath is real enough that the chrome is what I distrust
now, not the model.
