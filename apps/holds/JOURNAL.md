# Journal

Not a changelog and not a bug list. Notable thinking while building:
what you almost did, what you refused, when the model clicked or
didn’t, when you wanted a capability the docs only hinted at.
Timestamp or order them as they happen.

## 1. After reading getting-started, before any app code

The programming model is unusually blunt: the server owns the tree,
the browser is a replica, a click is an address not a REST call. The
starter already is a shared list. So the “two tabs see the same loans”
requirement is not a feature I invent — it is `createJsonStore` plus
the `subscribe` line I already have.

The split that actually matters is `useState` (this tab) vs the store
(everyone). I almost started by putting the staff directory in the
store. That would be wrong: the directory is reference data I invent
and keep in the app. Only the gear list is shared mutable state.

The person picker is the part the docs are clearly aiming at. The
Islands section’s first example of “browser DOM that cannot wait for a
round trip” is typeahead. The sample contract is even named
`StaffPicker`. I am going to take that path rather than fight it.

What I refused, still before writing code:

- A native `<select>` of 40 names. The assignment says that is not the
  intended UX, and it would not feel searchable.
- Filtering the directory with `useState` + a server `@input` (if that
  even exists — getting-started only documents `@submit`, `@change`,
  `@click`). A keystroke that crosses the WebSocket is the 400ms thing
  they told me not to do.
- Opening `apps/feedback` or any todo/islands demo to copy a widget.
  If the island path is under-documented I will write that in NOTES
  and keep the React side dumb.

The hole I already feel: getting-started shows `defineIsland`, the
`<mount>` tag, `registerIsland`, and “the React component receives the
JSON props plus `onPick`”. It does not show a `.island.tsx` file. I
will invent a small typeahead and hope the callback wiring is as
literal as it reads.

## 2. Types from the imports

`defineIsland` / `mount` types say props are JSON and callbacks are
top-level. `mount(handle, props)` is the type-checked spelling; the
HTML `<mount>` tag is the untyped one. I will call `mount()` so the
checker actually sees `onPick`.

`registerIsland` wants a React `ComponentType`. So the island really
is a React component I register by the same string. That is the whole
client API I am allowed to know.

`listen` takes `{ port }`. The replica, from the `socklit/client`
entry, talks to a default protocol port unless the page has `?ws=`.
The lab is already bound to 5173/8787, so I will move this app and
open it with the query the docs mention.

`mutate` returns `{ next, result }`. Same replacement dance as the
starter. No merge. Fine for a loan desk.

## 3. What I almost built for “searchable”

A combobox in the server template: an `<input>` without `.value=`
(so the caret survives other people’s mutations) and a filtered
`<ul>` driven by `useState`. That would *look* like typeahead and
would be a round trip per keystroke. I am not doing that. The docs
called this out by name.

The island will own the query string in React `useState`. Picking a
person is the only thing that goes back to the server.

## 4. While writing the row

I almost made `GearRow` a `component.tag("GearRow", …)` because the
docs lead with tags. Then I remembered tags are not type-checked and
the checker is the reason to call `GearRow({ item })`. Same instinct
for the picker: I used `mount(StaffPicker, { … })` instead of the
`<mount>` tag.

The default stylesheet has `item` and `empty` and nothing that looks
like a combobox. I invented `holds.css`. That is not a framework hole
so much as “you are on your own for island chrome.”

I also almost put the directory in the JSON file. Kept it as a module
constant. The store is only gear + who has it.

## 5. The island file felt like a guess

`staff-picker.island.tsx` is ordinary React. Filter in `useMemo`,
open the list on focus, `onPick(id)` on click. If that callback is
not a plain function prop, I will find out when I click a name, not
from the types. The contract file and the React file share a string
and a shape. Nothing in the repo-as-product checks that they match
beyond “unknown island: Name” if I typo the string.

## 6. The island crashed the first time it mounted

I added a laptop. The store write worked. Then the replica tried to
paint `StaffPicker` and React screamed: invalid hook call, two copies
of React. The stack is my `useState` in the island and `react-dom`
from `../../node_modules` — the Socklit package, not my app.

I installed `react` / `react-dom` exactly as getting-started says. I
did not go looking for how the host mounts islands. A competent React
person knows this error: the widget and the host resolved different
Reacts. I am going to `resolve.dedupe` in Vite. That is not in the
manual. I almost rewrote the picker without hooks (a `<datalist>`)
just to dodge the crash. That would have been cowardice. The product
told me to install React and register an island; the install step
fights the host.

This is the moment the island path stopped feeling documented and
started feeling like a lab leftover.

## 7. After the picker actually worked

Typing `ada` filtered to Ada Lovelace in the same keystroke. No
status flicker. That is the thing the docs promised: the query lives
in the browser, `onPick` is the only message home. The programming
model clicked *here*, not in the shared list — I already believed
the store. I did not believe the island until a name appeared
without a spinner.

`dedupe` was the whole difference between “islands are how you do
this” and “islands are broken.” I am slightly angry that the sample
contract is named `StaffPicker` and the install steps still leave
you with two Reacts.

## 8. After two tabs and a blank name

Second tab opened already showing Ada’s laptop. Adding an HDMI cable
in that tab appeared in the first without a refresh. Check-in did
the same. I stopped wanting a REST client. The store line is the
product.

I almost bound `.value=` on the add field so a success would clear
it. The manual told me that would also wipe the field when the other
tab mutated. I left it dirty. That is the first time I felt the
replica steal a form behavior I take for granted.

I also almost closed the picker on `blur`. Classic: blur fires
before the option click. The docs mention a focus-trapped popover
and then stop. I refused to invent one. Open on focus, pick a name,
done.

Spaces-only “name” got through `required` and died on `trim()`. If
I had skipped the server check, the list would have grown a ghost
row. That warning in the events section is the one I will remember.
