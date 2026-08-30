# Notes from building this app

Product holes, surprises, and missing API — written as they showed up.

## Getting-started is one page and then you are on your own

That is the deal the manual states. Still:

- There is no example `.island.tsx` file. I got `defineIsland`, `<mount>`,
  and `registerIsland`. The React component itself is “receives the JSON
  props plus `onPick`.” I had to invent a typeahead and hope the callback
  is just a function prop.
- Documented events are `@submit`, `@change`, `@click`. No `@input`, no
  “on type.” If I had tried to filter the directory on the server I would
  have been guessing. The island section is the only sanctioned path for
  keystroke-local UI.
- `component.tag` is untyped; `mount()` is typed. The manual shows both
  spellings for islands. Easy to copy the HTML one and lose the checker.
- Starter never gitignores `data/`. The manual says to. I added one here.

## Ports

The lab (or whatever is already `npm run dev` at the repo root) owns
5173 and 8787. I moved this app to Vite **5183** and `listen({ port: 8783 })`.
Open:

`http://localhost:5183/?ws=ws://localhost:8783`

The `?ws=` rule is in the manual. I still had to discover the collision
by noticing another process, not by any Socklit warning.

## Two Reacts after following the island install steps

I ran the exact `npm install react react-dom` block from
getting-started. The first time the picker mounted:

```
Invalid hook call
Cannot read properties of null (reading 'useState')
StaffPicker src/staff-picker.island.tsx
react-dom from ../../node_modules  (the socklit package, not this app)
```

The replica stayed “connected.” The row still showed the gear name.
The island did not paint. Status never said `unknown island`.

Nothing in the manual about `vite.resolve.dedupe`, a peerDependency,
or “use the same React the host uses.” I added `dedupe: ["react",
"react-dom"]` myself. If that is the intended setup, it belongs next
to the `npm install` snippet.

## Island failure is quiet

A thrown island does not take down the page or the WebSocket. Good
for the rest of the list; bad for a first user who thinks “Add”
failed because the snapshot still looked empty for a beat.

## Flash errors outlive the mistake

`useState` for “Name cannot be blank.” works, and the other tab does
not see it. The same tab still shows it after I remove every item.
Only a later successful add cleared it. The manual already warns
that a leftover `useState` error stays. There is still no
“clear on next render” helper, so a failed add stains the page
until you succeed.

## `required` vs spaces

A field of only spaces is valid to the browser (`required` is happy)
and blank after `trim()`. If I had trusted the native constraint,
the handler would have created a nameless item. The manual’s “validate
again on the server” line is the real rule.

## No draft reset

After a good add, the name field keeps what I typed. I will not put
`.value=${""}` on it — the manual says that snaps the caret on every
shared write. There is no `form.reset` and no draft helper. The
starter lives with this. So do I.

## Island chrome is on you

`socklit/client/styles.css` has `item`, `empty`, `add-form`. It has
nothing for a typeahead. I wrote `holds.css`. Click-outside and
keyboard list navigation are not documented. I opened the list on
focus and left it until a pick. A “focus-trapped popover” is named
in the island section and never shown.

## How to run this app

Vite **5183**, protocol **8783** (5173/8787 were already taken):

`http://localhost:5183/?ws=ws://localhost:8783`
