# Notes from building this app

Recorded as I hit each thing — not a recap.

## First read of getting-started.md

- Starter app is still a per-tab counter. Shared list is only in the docs example, not in `starter/`. I have to splice the store + `subscribe` wiring myself and guess how to split it across `app.ts` / `server.ts` (the example is one file).
- `mutate` always returns `{ next, result }`. `result` is always `undefined` in the example. No explanation of when `result` is useful.
- `event.fields` is not typed in the doc. I am assuming `string | undefined` per name and that number inputs arrive as strings.
- `file: "data/items.json"` — relative to what? CWD of `npm run dev`? The package root? Unstated.
- No API for flashing a validation error to the replica. I am using `useState` (per-tab) for that and hoping it is the intended hole.
- Empty list: doc only shows `keyed(...)` inside `<ul>`. Unclear whether an empty array in `keyed` is ok, or whether I should omit the list and show copy instead.
- CSS class names (`add-form`, `item-list`, `item`, `primary`, `app-header`) are mentioned but not documented as a set. I do not know what they actually look like without opening the stylesheet (which is not in the allowed reading list).
- No mention of whether a submitted `<form>` clears its inputs after the server re-renders. Will find out.

## Implementing

Starting from the getting-started store example: `createJsonStore` + `useStore` + `listen({ subscribe })`. Item shape is `{ id, name, qty }`.

## Ports

5173 and 8787 are already taken (something else in this repo is running `npm run dev`). Docs say pass `{ port }` to `listen()` and open `?ws=ws://localhost:<port>`. Vite’s port is not documented there — I changed `vite.config.ts` to 5175 and `listen({ port: 8790 })`. Will open `http://localhost:5175/?ws=ws://localhost:8790`.

`?disabled=` on the Take button is a guess. Getting-started only shows `.checked=` for boolean-ish props. If it blows up I will drop it.

## First run

- `npm run dev` from `apps/feedback` came up: `[socklit] session protocol on ws://localhost:8790` and Vite on 5175. `curl http://localhost:8790/health` → `{"ok":true,"sessions":1}`. Health shape (`sessions`) is not documented.
- Page painted empty state and status `connected`. No errors.
- Clicking Add for “Oat milk” / 1 wrote `apps/feedback/data/fridge.json` (pretty-printed JSON array). So `file` is relative to the process CWD, and the `data/` directory was created for me. Neither fact is in the doc. There is also no mention of gitignoring that file.
- After Add, the accessibility tree lagged; the DOM already had the row. Not a product bug, but I briefly thought the mutate had failed.
- Add form name field reset to empty / qty back to `1` after a successful submit. That is the re-render snapping inputs to the template’s static `value` / missing `value`. Fine when the add succeeded.

## Two tabs

- Opened a second tab at the same `?ws=` URL. Health went to `sessions: 2`. Take in tab 1 dropped qty 1 → 0; tab 2 already showed 0 with Take disabled. Restock +3 in tab 2 wrote qty 3; tab 1 updated to 3 without a refresh. Shared store + `subscribe` actually works as documented.
- `?disabled=${item.qty <= 0}` worked (Take is disabled at 0). Still not in the getting-started event/attr list.

## Validation

- Spaces-only name: HTML `required` let it through (spaces count as a value). Server trim rejected it and `useState` showed “Name cannot be blank.” Good.
- After that failed submit, the name field was empty again. There is no documented way to keep the user’s input after a rejected submit — the replica just paints the template. So a validation error and a wiped field happen together.
- Qty `-1`: the browser’s `min="0"` blocked the submit. The Socklit `@submit` handler never ran; the old “Name cannot be blank.” message stayed on screen. Native constraint validation is invisible to the server. The doc says `@submit` gives you `event.fields` and “Do not preventDefault” — it does not say the handler might not fire at all.
- That leftover per-tab error is another hole: `useState` errors do not clear unless I clear them. The other tab never saw the error (correct for `useState`, but the doc never says “use this for flash messages”).

## Row actions

- Nested `<form>` per row for Restock + an `@click` Take/Remove outside it worked. Nothing in the doc describes “a field that belongs to one row.” I guessed a nested form. No mention of whether nested forms are supported or cursed.
- Restock amount `0` is blocked by `min="1"` the same way as negative qty — server code for that path is untested if the browser cooperates.

## CSS / layout

- `add-form` / `item-list` / `item` / `primary` / `app-header` produced a usable dark card. Qty fields in the add row and in each item row are unlabeled spinbuttons that just say “1”. The class list does not include a label or hint pattern. I added `placeholder="Qty"` after seeing it.
- No documented way to put a visible label on the starting-quantity field without inventing markup the stylesheet may not style.

## What I never found in the public surface

- What `mutate`’s `result` is for.
- A typed `SubmitPayload.fields` (I treated everything as `string`).
- How to keep form state across a render.
- How to show a store-wide (all tabs) error, or a load/parse failure from `createJsonStore`.
- Whether `createJsonStore` creates parent directories (it did).
- Vite port vs protocol port pairing, besides `?ws=`.
- Boolean attributes other than `.checked`.
- A catalog of CSS classes, or that `socklit/client/styles.css` is the whole look.
- What happens if two tabs `mutate` at the same time (lost update? last write wins?). I did not try a race.

## After a server restart (placeholder edit)

`tsx watch` restarted twice on one save. Both browser tabs reconnected (`sessions: 2`) and still showed Oat milk / Coffee from `data/fridge.json`. File persistence across restart works; the doc only says “the file is created on first write.”

## How to open this app right now

Ports 5173/8787 were busy, so:

- App: http://localhost:5175/?ws=ws://localhost:8790
- Health: http://localhost:8790/health
