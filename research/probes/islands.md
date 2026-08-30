# Client islands

The result in one paragraph. An island is a **named hole**, not a second
kind of component. The server writes `<mount .Island=${ColorPicker} …>`.
The browser mounts a real React tree at that address. Opening a Radix select
never touches the socket; choosing a value is an ordinary server closure over
the row. A second element, `<slot>`, lets that React tree *host* a server
region — the island owns the overlay; the replica keeps painting the box.
The boundary is a folder and two tags — `*.island.tsx`, `<mount>`,
`<slot>` — so the two worlds cannot be mistaken for each other the way
React Server Components can.

```
http://localhost:5182/?probe=islands
http://localhost:5182/?probe=islands&latency=400
```

Open two tabs. Open a priority menu: instant, nothing in the protocol panel.
Pick "Urgent": an `island onChange` frame, both tabs update. That is the
whole product.

---

## What the probe does

A ship board. Each row is a server template: checkbox, title, delete. Two
holes on the row are **terminal** islands — a Radix select for priority, a
Radix popover for colour. A third is a **host**: Assign is a Radix popover
whose body is a `<slot>`. Team chips and people rows inside that well are
server templates with server closures. Change the team while the popover is
open and the list swaps; the overlay does not remount.

Cities-in-a-state was the first candidate for that last hole and is the
wrong demo. A city name is a string. Strings are JSON props. A dependent
dropdown of strings is a terminal island whose `options` changed. The
load-bearing case is a dependent *tree* — rich rows, handlers over real
objects — living inside chrome the server cannot draw.

Tailwind classes sit on both sides of the boundary; they are strings. The
dashed outlines are research chrome: purple for the island, green for the
slot, so a reader can see which world owns which box.

The third seeded card is titled "Do not put row actions inside an island"
because that is the mistake this shape invites, and the delete button next
to it is the correction.

---

## The authoring story

Three files, two import graphs, two reserved tags at the call site.

**The contract** — imported by the server, never by the island:

```ts
// islands/color-picker.ts
export const ColorPicker = defineIsland<
  { value: string; swatches: string[] },
  { onChange: (value: string) => void }
>("ColorPicker");
```

**The widget** — imported by the client registry, never by the server:

```tsx
// islands/color-picker.island.tsx
export function ColorPicker(props: {
  value: string;
  swatches: string[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      …
    </Popover.Root>
  );
}
```

**The call site** — a hole in a server template:

```ts
<mount
  .Island=${ColorPicker}
  .value=${card.color}
  .swatches=${[...SWATCHES]}
  .onChange=${(color) => cards.setColor(card.id, color)}
></mount>

<mount .Island=${AssigneePicker} .label=${assignee.name}>
  <slot>
    ${keyed(people, (p) => p.id, (p) => html`
      <button @click=${() => cards.assign(card.id, p.id)}>${p.name}</button>
    `)}
  </slot>
</mount>
```

`onChange` is a server closure over `cards` and `card`. It never becomes a
string. The island receives a stub; calling it sends `{ type: "island", event:
"onChange", args: [color] }`. The handler table is the same idea as `@click`,
keyed by event name instead of hole-as-handler.

`<slot>` is not that. The people list never becomes a prop. The island
places a well; the replica paints the tree; `assign` is an ordinary
`@click` on the slot instance. The tags never reach the browser — they
compile to `mount()` / `slot()` markers, and the interned strings the
replica caches have a single island hole where `<mount>` was.

That is the entire ceremony. There is no `"use client"`. There is no
serializing a function by pretending it is a prop. There is no children
prop through which a server tree is smuggled into a client component.

### The rules that keep it from becoming RSC

RSC's confusion is that both sides are the same JSX, the boundary is a
pragma, and children let a server tree hide inside a client tree. Each of
those is refused here, on purpose.

1. **Different wrappers.** A server component is a function call, or a
   PascalCase tag after `component.tag("CardRow", fn)`: `CardRow({ card })`
   and `<CardRow .card=${card}>` are the same handle. An island is still
   `<mount .Island=${ColorPicker} …>`. The catalog key is the string you
   wrote, not a name scraped off the function. `component(fn)` stays
   unregistered. Islands do not go in that table — a tag is never
   ambiguous.
2. **Different files, different graphs.** `*.island.tsx` is the only place
   `react` is imported. The server graph cannot reach those files. The
   island graph cannot reach `useStore`, `html`, or `component()`. The
   import graph *is* the architecture. A pragma is a wish; a folder is a
   wall.
3. **No children. A slot is a second tag.** An island's *props* are JSON
   and callbacks. A template passed as a prop still throws. The hosted
   region is `<slot>`, not children of `<mount>`, not `body: html\`…\``.
   Markup or a hole directly inside `<mount>` throws. The island can only
   place `<Slot />` on the React side, a well the replica paints. That is
   loud at the call site on purpose:
   `<mount .Island=${AssigneePicker}><slot>…</slot></mount>` cannot be
   mistaken for `<AssigneePicker>{people}</AssigneePicker>`. The RSC power
   move — `<Client>{<Server/>}</Client>` — is the thing that made the two
   worlds look like one. A well the host cannot read is a different shape.
4. **Callbacks are top-level.** `onChange` is a prop on the mount, not a
   function buried in a config object. The event table is flat. A nested
   function throws at serialize time with a path.
5. **Props are JSON, and the runtime says so.** A `Date`, a class instance,
   a template result — each is a named error, not a silent `{}`. The type
   parameter on `defineIsland` is the first line of defence; serialize is
   the second.

What a developer has to learn is one sentence: **if it needs a DOM, it is
an island; if it needs the database, it is not.**

---

## How Radix works from here

The island file is an ordinary React component. It imports
`@radix-ui/react-select` the way any Vite app would. Radix portals to
`document.body`, traps focus, handles arrow keys, and dismisses on Escape.
None of that is expressible in the replica vocabulary, and none of it needs
to be: the island owns its DOM.

The server sent `{ value: "high", options: […] }`. It did not send menu
markup. Opening the menu is React state (`useState` inside the island
file — React's, not ours). Choosing "Urgent" calls `props.onChange("urgent")`,
which is the stub, which is the closure `cards.setPriority(card.id, priority)`,
which is a durable write. The next frame patches the island's `value` prop.
Radix re-renders with the new value. The popover never existed as far as
the session is concerned.

Two things that would have been a mistake, and that the shape prevents:

- **Putting "Delete" in the Radix menu.** That would mean the island
  renders the action and sends a name back — `onAction("delete")` — and
  someone looks up an id. That is the endpoint this architecture deleted,
  reinvented for a menu. The delete button stays a server `@click` over
  `card` itself.
- **Building the row menu from A3 instead of A2.** A dropdown whose items
  are server-rendered with server handlers is a gated subtree, not an
  island. See the admin probe. Assign uses a slot because the *chrome*
  needs Radix (portal, focus trap) and the *body* is a live server region.
  A menu that does not need a library overlay is still `gate().contains()`.
  Those are different jobs.

---

## How a slot works from here

The island file renders `<Slot />`. That is a custom element,
`<socklit-slot data-instance data-hole>`, not a React child. The replica
keeps a painter keyed by that address and calls `render(rehydrate(slot), el)`
when the element connects — including after Radix portals it to
`document.body`, where `island.querySelector` would miss it.

A team-filter click is a normal `{ type: "event" }` on the slot instance,
not `{ type: "island" }`. Diff treats the shell and the slot separately: a
label change is a `set` on the island hole *without* `slot`; a list change
is a patch on `${parent}/h${hole}/s`. The React tree is not remounted. Local
`open` survives. That is the whole claim this increment exists to test.

---

## How Tailwind works from here

Tailwind is class names. Class names are strings. Strings are valid in
server templates and in island props and in island JSX.

One stylesheet is loaded by the client document. `@source` tells Tailwind
to scan `islands/` and `server/probes/islands/`. Preflight is off, so the
existing probes keep their CSS. Utilities apply on both sides of the
boundary because there is no shadow root on `socklit-island` — Radix
portals to `document.body` and would miss a shadow tree anyway.

There is no "Tailwind for the server" and "Tailwind for React." There is
one utility language and two renderers. That is the honest version of
"familiar tech stack" for styling: the ecosystem that is *strings* crosses
for free; the ecosystem that is *components* crosses only at `<mount>`.

---

## What this costs

**I1 and I2 take a declared hit.** Data handed to an island is data the
client now holds in a form the server did not render. `options` for the
priority select, `swatches` for the picker — small, and visible at the
call site. A chart island that received a 10,000-point series would be a
different conversation; this probe does not pretend otherwise.

**A prop contract appears.** The one thing the rest of the system deleted,
confined to a hole. Version the island name if the props change shape.
The registry is the list of names the client will mount; an unknown name
renders as an error in the host, not as a crash of the replica.

**Island state dies with the hole.** A snapshot resync, a keyed row
leaving, a reconnect — the React tree unmounts. That is correct. Local
open/closed is not application state. If it needed to survive, it was not
an island concern.

**Args are attacker-controlled JSON.** `setPriority` re-validates the
enum. `setColor` re-validates the hex. Rendering a control is still not
authorization.

---

## What it forced

**A3's shape was right, and the authoring was the missing piece.** The
admin probe said islands are a subtree boundary and must not be how A2 is
built. This probe accepts that and asks the next question: can a developer
write one without thinking they are writing RSC? The answer is yes, if the
call site does not look like a component call and the files cannot see
each other.

**Radix is the right first library, not Recharts.** A chart would have
tested "can we pass a lot of numbers." Radix tests "can we use the
overlay/focus/portal half of npm," which is what people actually mean by
the React ecosystem, and which is the half that cannot run on the server
at any price. The chart remains a valid later island of the same shape.

**The visual badge is load-bearing for a research probe and would be
wrong in a product.** It exists so the boundary is teachable. Shipping it
would make every date picker look like a warning label.

---

## What a reader should not conclude

- **That the app is written in React.** Two files are. The board is
  lit-html on the server. `<mount>` is the admission.
- **That any npm component can be dropped into a server template.** Only
  ones registered as islands, with a JSON prop contract. MUI's `DatePicker`
  works the moment someone writes `DatePicker.island.tsx` and a contract;
  it does not work as `<DatePicker>` in a server file.
- **That this replaces A2.** A gated menu whose items are server handlers
  is still the wrong thing to build as an island. This probe puts a closed
  enum in Radix, puts a Radix-hosted server list in a slot, and leaves
  delete on the server to keep that distinction visible.
- **That `<slot>` is children.** It is a well. The island does not receive
  the tree as a value it can read. If the next person to touch this writes
  `<mount .Island=${Picker}>${people}</mount>`, they have undone the point.
- **That we measured cost.** This probe is about authoring. Bytes and
  CPU are the other probes' job; an island's first payload is the JSON
  props, which here is tens of bytes.

---

## Files

| File | Role |
| --- | --- |
| `server/island.ts` | `defineIsland` / `mount()` / `slot()` IR |
| `server/island-markup.ts` | `<mount>` / `<slot>` / PascalCase compile |
| `server/registry.ts` | `component.tag("Name", fn)` catalog for component tags |
| `islands/*.ts` | contracts the server imports |
| `islands/*.island.tsx` | React the client imports |
| `islands/slot.tsx` | `<Slot />` well, client only |
| `islands/registry.ts` | name → component, client only |
| `client/island-host.ts` | `<socklit-island>` / `<socklit-slot>` |
| `server/probes/islands/` | this board |
