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

The product reads like a server that owns the UI: I write a template
next to a store, the browser paints it, a click comes back as an
address and runs my function. That part I already trust. The starter
list is almost boring in how little it asks of me.

Identity is the page I lingered on. The manual is blunt: `session.params`
is the query string and the query string is not a person. Anyone can
edit the URL. A desk that has to refuse a write needs `session.user` —
a value *I* computed. Three pieces: `identify` on connect, `grant` from
a sign-in handler, refuse at the mutate. That is the most complete
“real product” passage in the whole first-week surface. It also feels
like the author has been burned by people treating `?user=ada` as
auth, and I am grateful they wrote the warning down.

What I already distrust: the ticket `Map`. Tokens die when the process
restarts. The docs say that is fine on a LAN and that I should sign
the token if it has to survive. Honest. Also cheap. It is a cloakroom
stub, not a session service. `grant` existing *because* two-port Vite
and `listen` do not share an origin is the sentence that made me sit
up — that is a real constraint, not a tutorial convenience, and they
chose a per-tab token instead of pretending cookies would work.

Mood about *who is connected*: cautiously willing. I have not seen
`session.user` light up yet. On paper it is enough to ship a desk
where only the author may pull a piece down. In my stomach it still
might be a lab leftover with a product coat of paint. I will know
after a refresh and a second tab, not after reading.

I am not adding an island. A dozen names in a `<select>` is a form
control. The island chapter is there if I need typeahead; I do not.

Decision I almost made: stuff the signed-in name into `?user=` so I
could skip `grant`. The manual would have failed me on purpose. I
will do it the way they wrote.

## 2. Wiring identify / grant (still have not clicked Sign in)

`createApp: (session) => () => App({ store, user: session.user })`
is a different listen shape than the starter’s `app: () => App({ store })`.
I copied the identity example and hoped the types would accept both
`identify` and `port`. It compiled in my head; I have not run it.

The write refusals felt natural to type. `if (!actor || actor.id !==
piece.authorId) return;` is three seconds of work and the only line
I actually trust. Hiding the button is courtesy. That split — paint
is not permission — is the first moment the framework felt like it
had a spine.

`session.grant(token)` still feels like a magic word. I issue a UUID,
stuff it in a Map, call grant, and I am supposed to believe the
replica will keep it in *this tab only*, reconnect, and the next
`identify` will see `socklit_session`. I have not watched it happen.
Cheap? Yes. Real? I will decide after a refresh. Lab leftover? The
Map definitely is. Enough to ship a LAN desk? Maybe.

Default ports were taken. I moved Vite to 5186 and `listen` to 8792
and I now have to remember `?ws=`. If I forget, this tab will talk
to whoever already owns 8787. That is a first-user footgun and it
irritated me before I had a window open.

Strict TypeScript made me write `SessionHandle<Member>` on every
handler. The manual’s examples leave `session` untyped. Not a
blocker — just a reminder that the first-week page is written for
the happy path, not `noImplicitAny`.

## 3. After the first sign-in

I submitted with nobody picked. Flash: “Pick someone from the studio
directory.” The wall did not change. That was the first time I felt
the server actually *heard* me and said no. Small, but it landed.

Then I picked Ada Chen and hit Sign in. For a beat the page still
looked like a guest — grant reconnects, and the replica flickers.
Then: “Signed in as **Ada Chen**.” Pin form. Sign out. The guest
copy gone. I did not put `?user=ada` anywhere. `session.user` was a
person I issued a ticket for.

How it felt: cheaper than I wanted, more real than I expected. Not
OAuth. Not a costume either. The cloakroom Map suddenly had a coat
on it. I would show this to a studio manager on a LAN. I would not
yet show it to a client who asked “where do users live?”

## 4. After a refresh

Refresh. Still Ada. The poster I pinned is still on the wall with
my name as author. This is the moment the magic word became a
mechanism. Per-tab token, reconnect, `identify` finds it. I trusted
the paragraph in the manual more after this than after reading it.

Still a lab leftover underneath: if I kill the process, Ada is a
ghost and the ticket is gone. The *tab* remembered; the *server*
is a goldfish. Documented. I believe them now in both directions.

## 5. After a refused mutate

Empty title, Pin. Flash: “Give the piece a title.” Nothing on the
wall. Native `required` was not there — I left it off so the
handler would run — and the trim check did the job. That refuse
felt ordinary, like a form. Fine.

The identity refuses I could not click. Jules never saw Remove on
Ada’s piece. Ada never saw Looks good. I wrote `if (!actor ||
actor.id !== piece.authorId) return;` anyway. I am slightly uneasy
I did not watch a stolen click bounce, and also glad the button
was not there to steal. Paint is not permission; I still typed the
guard. That is the product asking me to be an adult. I liked it.

## 6. After two people in two tabs

I opened a second tab on the same URL. It was **not** Ada. Guest.
Wall visible, no pin, no assign, no remove. If both tabs had been
Ada I would have cursed and rewritten storage. They were not. The
per-tab default is the right default. This is the first time today
I thought “I would start a real desk on this next week.”

Signed in as Jules Moreau. Same poster. No Remove. I assigned Jules
as reviewer from Jules’s tab; Ada’s tab updated without a refresh —
reviewer line, Remove still there, no stamp button. Jules stamped
Looks good. Ada’s tab grew the stamp. Then I signed Jules out.
Guest again, wall still there, Sign in offered. Ada still Ada,
still able to pull her own piece down.

`session.user` after all of that: enough to ship this desk. Not
enough to pretend it is a users table. The query string is not a
person — I even opened `?user=ada` and it stayed a guest, which
made me grin. Cheap tickets. Real no. I would hesitate on anything
that needed the user to survive a restart or to come from SSO. I
would not hesitate on “only the author may take this down.”
