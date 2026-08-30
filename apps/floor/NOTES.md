# Notes from building this app

Product holes, surprises, and missing API — written as they showed up.
Facts and missing pieces go here. Feelings go in JOURNAL.md, then get
summarized at the bottom of this file.

## (holes as they appear)

- **Island callbacks do not mention `session`.** Regular `@click` gets
  `(event, session)`. `defineIsland` callbacks are typed as the args
  the React side sends. I closed over `user` from the last render and
  still refuse inside `mutate`. That is probably fine (revoke
  reconnects) and still not the same spelling as a button.
- **`registerIsland` types reject a real component.** The React board
  is not a `ComponentType<Record<string, unknown>>`. I cast. The
  runtime accepts it.
- **`tsc` in the app follows imports into Socklit** and reports
  errors in `island-host.ts`, `runtime.ts`, and `component.ts`. Not
  my code. I only treated `src/` as the scoreboard.
- **Tickets are a process Map.** Documented. Restart = everyone is a
  guest until they sign in again. The incidents file survives. The
  badge does not. For a real desk I would sign the cookie myself;
  the manual says that is still my problem.
- **No password, no SSO.** The staff `<select>` is the whole
  identity story. Anyone who can load the page can become Elena.
- **Island state survived a store notify.** I typed `nginx`, Owen
  filed in another browser, the box still said `nginx` and the
  count went `1 of 5` → `1 of 6`. Not a hole — a relief. I had
  expected a remount. Write it down so I do not “fix” it later.

## How to run this app

http://localhost:5173

`listen()` is on 8787. Vite proxies `/ws`, `/session`, and `/health`
there. Open the page URL only — do not add `?ws=`.

```bash
cd apps/floor
npm run dev
```

## Qualitative conclusions

The programming model clicked when I stopped looking for an API
and treated `mutate` as both the write and the lock. Filing from
one browser and watching the row appear in a guest window felt
easier than the SPA I would have written — no route, no reducer,
no socket handler. The claim race was the same cheapness: two
clicks, one `ownerId`, the loser’s button gone. I kept wanting a
more serious primitive. I did not need one.

What would make me hesitate on a real desk: the ticket Map dies
with the process, sign-in is a name in a list, and I still do not
have a public way to pass `session` into an island callback. Those
are week-two problems. Week one shipped a live floor.

Would I start a real live board on this? Yes, for an internal
ops surface. I would not sell the sign-in as-is.

Why would I use this instead of React and a WebSocket? Because
the click is already the write — I only open React when a
keystroke cannot wait for the server.
