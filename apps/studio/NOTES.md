# Notes from building this app

Product holes, surprises, and missing API — written as they showed up.
Facts and missing pieces go here. Feelings go in JOURNAL.md, then get
summarized at the bottom of this file.

## (holes as they appear)

- **Occupied defaults, silent wrong server.** 5173 and 8787 were already
  taken. The manual says to change ports and open with `?ws=`. If you
  forget the query string, the replica still connects — to whoever
  already owns 8787. There is no “is this *my* listen?” check. First-user
  footgun.

- **`app` vs `createApp`.** The starter uses `app: () => App({ store })`.
  Identity needs `createApp: (session) => () => App({ store, user: session.user })`.
  Two listen shapes, one page. I copied the identity example and did not
  look for a third.

- **Tickets die with the process.** Documented. After `tsx watch`
  restarts the server, a refresh is a guest until you sign in again.
  Fine on a LAN; I would not call it a session.

- **No public way to tell the replica the protocol port** except `?ws=`
  or the hardcoded 8787 default. I did not find a listen option that
  publishes the port to the page.

- **Event handlers do not infer `session`.** Under `strict`, every
  `@click` / `@submit` needs an explicit `SessionHandle<Member>` (or
  you get implicit `any`). The manual’s snippets omit it.

- **`grant` reconnects.** The tab briefly still paints the old tree.
  Not broken — just a flicker. Sign-in and sign-out both do it.

## How to run this app

From `apps/studio`:

```bash
npm run dev
```

- App: <http://localhost:5186>
- Protocol (proxied): `ws://localhost:5186/ws` → listen on 8792
- Health: <http://localhost:5186/health>

Vite is 5186. `listen` is 8792. The page origin proxies `/ws` and
`/session`. Do not add `?ws=` — a cookie will not follow that hop.

## Qualitative conclusions

It felt like a small, finished surface that is honest about what it
is not. I wrote a desk in one pass from the first-week page. The
store plus `subscribe` made two tabs the same wall without me
inventing a route. Identity was the part I expected to be a lab
leftover; `grant` / `identify` / `session.user` were cheaper than a
real session service and more real than `?user=ada`. Trust went down
when I had to move ports and remember `?ws=`, then back up after a
refresh kept Ada and a new tab did not. It recovered.

I would start a real shared studio desk on this next week — on a
LAN, with a directory I already trust. I would hesitate the moment
someone asked for SSO, or for the signed-in person to survive a
process restart. The ticket `Map` is a cloakroom, not an account.

What’s it like, and can it say no? A server-owned wall with a person
on the socket, and yes — if you refuse in the write, not just hide
the button.
