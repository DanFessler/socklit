# Coming from React

Everything here describes what the code in this repository actually does today.
Where a feature does not exist, it says so rather than describing a plan.

## The one-sentence version

Your components run on the server, there is exactly one live copy of them per
connected browser, and the browser receives values rather than markup.

That single relocation is the source of every difference below. Nothing about
the model is trying to be clever; the surprises all follow from the fact that
the function you wrote is executing next to the database and several hundred
milliseconds away from the DOM.

---

## What is the same

More than you would expect.

**Components take one props object and return a view.**

```ts
const TodoRow = component(function TodoRow(props: { db: Database; todo: Todo }) {
  const { db, todo } = props;
  return html`<li class="todo">…</li>`;
});
```

**`useState` behaves the way you already know.** It takes a value or a lazy
initializer, returns a `[value, setter]` pair, and the setter accepts either a
value or an updater function:

```565:565:server/component.ts
export function useState<T>(initial: T | (() => T)): [T, StateSetter<T>] {
```

The details you rely on are all there. The initializer runs once. Setting a
value equal by `Object.is` does not schedule a render. Multiple setter calls in
one event handler batch into a single render, because invalidation is queued on
a microtask. And the closure captured by a handler sees the value from the
render that produced it, so calling `bump()` three times with `setCount(count + 1)`
lands on `1`, not `3` — you use the updater form to accumulate, exactly as in
React.

**`useDurable` is the same shape, a different lifetime.** `useState` dies
with the socket. `useDurable("wizard", initial)` survives reconnect and
refresh of this tab. A second tab has its own cell unless you pass
`{ share: "user" }`. Values must be JSON. The name is yours, not a tree
address.

**The rules of hooks are the rules of hooks.** Same order every render, no
conditionals, no loops, no calls after an early return. The runtime checks this
and the error names the likely cause:

```477:479:server/component.ts
        `<${marker.name}> at ${key} ran ${scope.index} hooks this render and ${expected} last render. ` +
          `Hooks must run in the same order every time: do not call them conditionally, ` +
          `in a loop, or after an early return, and wrap any helper that calls hooks in component().`,
```

**Setting state during render is refused**, with the same reasoning React gives:

```599:600:server/component.ts
        `<${entry.name}> at ${entry.key} set state while rendering, which would re-render forever. ` +
          `Derive the value instead, or set it from an event handler.`,
```

**A setter held past its component's removal is a no-op**, not an error — the
same choice React makes, because a handler in flight when a row disappears is
normal rather than exceptional.

**Lists need keys**, conditional rendering with ternaries and `null` works as
you would expect, and a component may return another component (delegation),
which is how you write a router or a role switch.

---

## What is different

### 1. Every re-render is a full re-render

There is one granularity of invalidation, and the runtime says so:

```237:243:server/runtime.ts
  /**
   * One session's own state changed.
   *
   * This is the only granularity of partial invalidation the runtime has. It is
   * enough for per-session UI state but not for the subtree-level dependency
   * tracking question raised in research/design-probes.md (S3).
   */
```

A `setState` anywhere re-runs the whole application function for that session
from the root. There is no subtree-scoped re-render, no `React.memo`, no
`useMemo`, and no dependency array anywhere in the API.

This matters far less than it sounds, because the expensive part of React —
touching the DOM — is not what happens here. The server produces a tree, `diff`
compares it to the last committed one, and only the differences are sent. A
render that produces an identical tree sends nothing at all and does not even
increment the revision. So the waste is server CPU, which was measured at
roughly 0.1 µs per node, rather than user-visible work.

The practical consequence: do not reach for memoization, because it does not
exist. Do notice that your render function runs constantly and should not have
side effects.

### 2. `useState` costs a network round trip

This is the one that will bite you. In React, `useState(false)` for a collapsed
panel is free. Here it is a full round trip: the click travels to the server,
the handler runs, the app re-renders, a diff is computed, and a patch comes
back. The source is blunt about it:

```557:564:server/component.ts
/**
 * State owned by the server, scoped to one component instance in one session.
 *
 * Dies with the socket. Note the cost that has no analogue in React: setting it
 * schedules a render on the server, so the user sees the result one round trip
 * later. Anything that should respond to the gesture itself belongs to a
 * client-owned primitive instead.
 */
```

One of the client-owned primitives that sentence refers to now exists, and it is
the narrowest of them: the browser performs a focus move itself, described in the
next section. There is still no client-owned *state*, so anything you put in
`useState` pays the round trip. Use the latency simulator in the protocol panel
while developing — at 400 ms the difference between "instant" and "server-owned"
is impossible to miss, and at 0 ms it is invisible.

The one case where this is not merely slow but *wrong* is a text input. If the
server owns the value, replies carrying older values overwrite characters typed
since, and typing `grayfell` at normal speed lands as `gryel` on a fast
connection. Leave text inputs uncontrolled and read them on submit, which is
what the todo app does.

### 3. There is no `useEffect`

The hook surface is five functions: `useState`, `useDurable`, `useRef`,
`useStore`, and `useContext`. The absence of `useEffect` is not an omission waiting to be filled
— a server has no DOM, so the most common effect in React
(`useEffect(() => ref.current.focus())`) has nothing to act on. That particular
effect has a replacement, but not as an effect: focus is requested by a value in
element position, and the client is what acts on it.

```ts
html`
  <div
    role="menu"
    ${focusWhen(open)}
    @keydown=${(event: KeyPayload) => {
      if (event.key === "Escape") setOpen(false);
    }}
  >
    …
  </div>
`;
```

The client focuses that element on the render where the value turns true, and
does nothing on the renders either side of it. A second argument —
`focusWhen(true, n)` — forces a repeat for the one case that needs it: focus
landing on the same element twice without becoming inactive in between, such as a
validation error re-focusing the field the user is already in. Nothing else about
that number means anything.

Being a hole rather than a hook is the point:

```10:15:server/focus.ts
 * The alternative was an effect hook, and declining that is deliberate. An
 * effect would let a component focus something as a side effect of rendering,
 * which is the first step toward the lifecycle machinery this project exists
 * without. A hole in element position stays inside the model that already
 * works: the server puts a value in a template, the diff notices it changed,
 * and the client acts on the change.
```

There is still no way to read a DOM node, so nothing can be measured, and the
server cannot ask where focus currently is — only put it somewhere it chose.

For the things effects usually do:

| In React | Here |
| --- | --- |
| Subscribe to a store | `Probe.subscribe`, registered once at boot |
| Clean up on unmount | `ProbeInstance.dispose`, called when the socket closes |
| Fetch data | Just read it — you are already on the server |
| Focus something | `focusWhen(active)`, in element position |
| Measure, scroll | Not expressible today |

`useRef` exists but means something narrower than it does in React. It is never
a handle on a DOM node, because there are none here. It is a per-instance cell
that survives renders and deliberately does not schedule one:

```618:630:server/component.ts
/**
 * A per-instance cell that survives renders and never schedules one.
 *
 * The gap `useState` cannot fill: a value that changes *because* a render
 * happened, such as a diagnostic counter, cannot be written with a setter,
 * because setting state during a render is refused — correctly, since it would
 * render forever. Without this the only way to hold such a value is a `useState`
 * holding a mutable object that the component then mutates in place, which is
 * this hook with the intent hidden.
 *
 * Nothing reads a ref to decide what to render, or should not: a ref changing
 * produces no new frame, so a screen derived from one goes stale.
 */
```

That last paragraph is the gotcha. Writing a ref produces no frame, so anything
you render from one will silently go stale.

`useContext` works the way you expect, but there is no provider *element* to
render, because a hole is a value and never markup. A context is created with a
name and a fallback, and providing a value wraps a subtree by call rather than
by JSX nesting:

```ts
const Theme = createContext("Theme", "default");

// React: <Theme.Provider value="high-contrast">{children}</Theme.Provider>
Theme.provide("high-contrast", Leaf({}));

// and inside any component in that subtree
const theme = useContext(Theme);
```

The fallback is returned when nothing above provided a value, so reading an
unprovided context is never an error. Like `useStore`, it retains nothing and is
exempt from the slot-ordering rule.

### 4. `useStore` is how you read shared state

```684:685:server/component.ts
  scope.host.recordRead(store);
  return store;
```

The store comes back unchanged — no wrapper, no proxy — but the call is what
tells the runtime which sessions a change to that store can possibly affect. When
a store announces a change and identifies itself as the source, every session that
declared its reads and did not read that store is skipped outright: no render, no
diff, no bytes. A session that declared no reads at all is treated as reading
everything, which is what makes it safe to adopt one store at a time.

The identity recorded is the object you pass, and it has to be the same object
the store notifies with, so declaring the wrong one leaves the session quietly
stale rather than failing. One wrong thing can be detected, and it is the easy
mistake — naming the record the stores live in instead of a store:

```ts
useStore(db.todos)  // the store
useStore(db)        // throws: a plain object with no methods cannot be a source
```

Call it at the top of any component that reads a store. It retains nothing, so it
is exempt from the slot-ordering rule.

### 5. Component identity is an address, not a position

React identifies a component by its position among siblings plus the referential
identity of the function, which is why defining a component inside another
component destroys its state on every render, and why moving a component in the
tree loses its state.

Here, identity is the structural address the template instance already has —
`root/h1/h0/k:6ae30540-…`. State hangs off that string:

```259:266:server/component.ts
/**
 * Retains component state for one session, addressed structurally.
 *
 * React had to invent retention on top of a stateless render and settled for
 * positional slots. Here retention is the premise — a session is a live app
 * instance — and instance addresses already carry identity, so a table keyed by
 * `root/h1/k:job-42` survives reorders of the list that produced it.
 */
```

This is strictly better behaved than React in one visible way: **component state
follows a row through a reorder.** Move the last row of a keyed list to the
front, and its state moves with it. React's positional slots would hand it to
whichever row now occupies that index.

The rules that follow from address identity:

- A different component arriving at the same address gets fresh state; the
  previous occupant's is discarded.
- A component that leaves the tree has its state released after the render that
  omitted it commits. A row that comes back comes back empty.
- A render that throws releases nothing, so a failed render leaves every slot
  intact.
- Two components claiming one address is an error, not a silent merge.

### 6. Handlers receive a small, closed event vocabulary

Not a `SyntheticEvent`. Five payload shapes, and that is the whole list:

```135:140:shared/protocol.ts
export type EventPayload =
  | ClickPayload
  | ChangePayload
  | SubmitPayload
  | KeyPayload
  | FocusPayload;
```

A click carries nothing at all. A change carries an optional `value` and
`checked`. A submit carries the form's fields. A key press carries `key` — which
is `KeyboardEvent.key`, so the logical key (`"Escape"`, `"ArrowDown"`, `"a"`)
rather than a physical position — along with `alt`, `ctrl`, `meta`, `shift`, and
a `repeat` flag that is true while the OS is auto-repeating. A focus payload is
`{ kind: "focus" }` or `{ kind: "blur" }` and carries nothing else: it reports
that focus moved, not where it moved to, because the destination is a DOM
reference the authoritative tree has no way to name.

So "Escape closes this" is writable, with one limitation to know before relying
on it. A key handler is an ordinary event hole on an ordinary element, and there
is no document-level or capture-phase binding, so a press only reaches a handler
whose element contains the focused one — which is why `focusWhen` arrived in the
same increment. A menu that takes focus when it opens can be dismissed from the
keyboard; one that does not, cannot.

There are still no coordinates, no target, and no `stopPropagation`.
`preventDefault` on submit is handled for you by the client.

Handlers may be `async`, and returning a promise is fine — the runtime awaits it
before processing the next event from that session. They also receive a second
argument, which is the session that sent the event:

```28:31:server/serialize.ts
export type ServerHandler = (
  payload: EventPayload,
  session: SessionHandle,
) => unknown;
```

A `SessionHandle` is `{ id, params }`: the connection's id, and the query
parameters of the WebSocket URL it connected with. It describes whoever acted
rather than whoever the tree was rendered for, which is what would let one
closure serve every viewer of a subtree. Ignoring it costs nothing, since
TypeScript accepts a shorter function wherever a longer signature is expected, so
`() => …` and `(payload) => …` remain valid. Do not read `params` as identity,
though: it is a value the client chose, which makes it per-session configuration
and not an authorization model.

### 7. Handlers close over real objects, which is the point

```96:96:server/app/todo-app.ts
        @click=${() => db.todos.remove(todo.id)}
```

`todo` is the actual row. `db` is the actual store. Nothing about either crosses
the wire; the closure stays on the server in a table keyed by address, and the
browser holds only the address. This is why there is no endpoint, no request
type, no serialization boundary, and no id-plumbing.

Two consequences worth internalizing:

**A rendered control is not authorization.** The closure captured what was true
at render time. Re-derive permission inside the handler from the state you are
about to change, because the row may have changed since it was painted.

**Express intent, not a delta.** Prefer `setDone(id, true)` over `toggle(id)`.
An absolute value is idempotent and order-independent; a relative flip is not
safe once two clients can act within one round trip. The store makes this
explicit:

```59:66:server/store.ts
  /**
   * States the desired outcome rather than flipping the current one.
   *
   * Prefer this over `toggle` for anything driven by a user interaction. A
   * relative flip is not safe once a request can be in flight: two clients that
   * both ask for "done" would cancel each other out, whereas asking for an
   * absolute value is idempotent and order-independent.
   */
```

### 8. Inputs are uncontrolled by default

The server cannot see what is in a text field until a `change` or `submit`
event arrives. There is no way to read the DOM. The todo app leans on this
deliberately: the draft text is client-owned, the form resets locally after
submit, and only the submitted value is ever sent.

---

## The lit-html part

There is no JSX. Views are lit-html tagged templates, and the tag is doing real
work: the static strings of each `html` site are interned once and sent to the
browser once, which is the whole basis of the wire format.

### Binding syntax

| lit-html | JSX equivalent | Notes |
| --- | --- | --- |
| `class="todo"` | `className="todo"` | Plain attribute, static |
| `.checked=${x}` | `checked={x}` | Sets the DOM *property* |
| `?disabled=${x}` | `disabled={x}` | Adds/removes the attribute |
| `@click=${fn}` | `onClick={fn}` | Event binding |
| `${x}` | `{x}` | Child position |

The leading `.`, `?` and `@` are not decoration — `checked=${x}` and
`.checked=${x}` do different things, and a checkbox needs the property form.

### Calling a component

Components are invoked as functions and interpolated into a hole:

```59:59:server/app/todo-app.ts
            (todo) => TodoRow({ db, todo }),
```

`TodoRow({ db, todo })` returns a marker, not a template. Creating one is free
and has no side effects; the function body does not run until serialization
reaches that hole and knows its address. This is why the marker can be built
eagerly inside `keyed()` and still get correct per-row identity.

### What may go in a hole

The supported set, verbatim from the error you will get when you exceed it:

> Supported holes: string, number, boolean, null, nested html template,
> component, keyed list, event handler, focusWhen() request.

The last of those is the only one with a position requirement: a `focusWhen()`
request has to be bound in element position, because the element carrying the
binding is the one that takes focus. Anywhere else it throws.

Things that are rejected, each with a specific message:

- **A plain array.** Use `keyed(items, keyOf, render)`. Identity is mandatory
  rather than advisory, and `keyed` throws on a duplicate or empty key rather
  than warning.
- **A lit-html directive.** Directives run in the browser and are not part of
  the replicated vocabulary.
- **`svg` or `mathml` templates.** Outside the current vocabulary.
- **`NaN` or `Infinity`.** Cannot be replicated.
- **Any other object.** Including dates — format them yourself.

### Two gotchas with no React analogue

**Whitespace inside a template is bytes on the wire.** The static strings are
replicated verbatim, including your indentation. Reindenting a template changes
what is transmitted. Several probes carry comments pinning their formatting for
exactly this reason:

```44:47:server/probes/ledger/ledger-app.ts
  // Indented one level deeper than this function, and it has to stay that way:
  // everything outside a `${}` is template bytes the browser downloads, so
  // reformatting the literal is a wire change.
  return html`
```

**You cannot interpolate into the static part.** A hole is a value, never
markup. You cannot build `<option>` tags by joining a constant into the
template string, because the strings must be fixed per call site — that is what
makes the template internable. Write the markup longhand, and pin it to its
constants with a test if it matters.

---

## Error messages, and what causes them

| Message | Cause |
| --- | --- |
| `useState() was called outside a component` | A helper that calls hooks was not wrapped in `component()`, or a hook ran inside a handler rather than during render |
| `ran N hooks this render and M last render` | Conditional hook, hook in a loop, hook after an early return, or an unwrapped helper whose slots landed in the parent |
| `set state while rendering` | A setter called in the component body instead of in a handler |
| `hook N was not a useState last render` | Slot order changed between renders |
| `called useStore() with a plain object that has no methods` | The container was declared instead of a store — `useStore(db)` rather than `useStore(db.todos)` |
| `focusWhen() must be bound in element position` | A focus request placed in a child or attribute hole instead of on the element itself |
| `delegated to another component more than 10 times` | A component returning a component in a cycle |
| `two components claim the address …` | Two components rendered at one address in a single pass |
| `is a plain array` | Missing `keyed()` |
| `patch addressed unknown instance` | Client-side; the replica and the server disagree, so the client closes the socket and reconnects with a fresh replica |

The "unwrapped helper" case is worth calling out because it is the one footgun
the boundary introduces. A function that calls hooks but was never passed to
`component()` puts its slots in the *parent's* table. It works until the number
of calls changes, then the parent's hook count shifts and the error fires. This
is why the message mentions `component()` explicitly.

---

## A quick translation

React:

```tsx
function TodoRow({ todo }) {
  const { mutate } = useMutation({
    mutationFn: (done) => fetch(`/api/todos/${todo.id}`, {
      method: "PATCH",
      body: JSON.stringify({ done }),
    }),
    onSuccess: () => queryClient.invalidateQueries(["todos"]),
  });

  return (
    <li>
      <input type="checkbox" checked={todo.done}
             onChange={(e) => mutate(e.target.checked)} />
      <span>{todo.text}</span>
    </li>
  );
}
```

Here:

```ts
const TodoRow = component(function TodoRow(props: { db: Database; todo: Todo }) {
  const { db, todo } = props;

  return html`
    <li>
      <input
        type="checkbox"
        .checked=${todo.done}
        @change=${(event: ChangePayload) =>
          db.todos.setDone(todo.id, event.checked ?? !todo.done)}
      />
      <span>${todo.text}</span>
    </li>
  `;
});
```

The endpoint, the method, the URL, the body, the mutation hook, the query key
and the invalidation are all gone, and every other browser viewing the same list
updates without any of them being replaced by something else.

---

## Where to look next

- [`server/app/todo-app.ts`](../server/app/todo-app.ts) — the smallest complete
  application, and the only one with no per-session state.
- [`server/probes/routes/app.ts`](../server/probes/routes/app.ts) — `useState`
  holding a route and a selection, with setters passed down as props.
- [`server/probes/admin/admin-app.ts`](../server/probes/admin/admin-app.ts) — the
  largest tree, and the contrast between panel-local `useState` and the
  cross-component `AdminUiState` object.
- [`test/component.test.ts`](../test/component.test.ts) — every semantic above,
  asserted.
- [`docs/demo.md`](demo.md) — the guided walkthrough.
