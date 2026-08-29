# A todo app you have seen a thousand times

Then a second tab, and the wire, and the part that is hard to unsee.

Everything below is real output from the code in this repository. The byte
counts were measured, not estimated.

```bash
npm install
npm run dev
```

Open the URL Vite prints, usually <http://localhost:5173>.

---

## 1. Here is the whole application

Not the interesting part of it. All of it.

```21:102:server/app/todo-app.ts
export const TodoApp = component(function TodoApp(props: { db: Database }) {
  const db = props.db;

  // Declared on the store rather than on the database holding it, because the
  // identity recorded here is what a change is matched against: this is the
  // object the runtime is subscribed to. Sessions that read no store at all are
  // re-rendered by anything, so this call is what buys the scoping.
  const todos = useStore(db.todos).list();
  const remaining = todos.filter((todo) => !todo.done).length;
  const completed = todos.length - remaining;

  return html`
    <header class="app-header">
      <h1>Todos</h1>
      <p>Rendered on the server, replicated as template holes.</p>
    </header>

    <form
      class="add-form"
      @submit=${(event: SubmitPayload) =>
        db.todos.add(event.fields["text"] ?? "")}
    >
      <input
        name="text"
        placeholder="What needs doing?"
        autocomplete="off"
        maxlength="200"
        required
      />
      <button class="primary" type="submit">Add</button>
    </form>

    ${todos.length === 0
      ? html`<p class="empty">Nothing here yet. Add the first todo.</p>`
      : html`<ul class="todo-list">
          ${keyed(
            todos,
            (todo) => todo.id,
            (todo) => TodoRow({ db, todo }),
          )}
        </ul>`}

    <footer class="app-footer">
      <span>${remaining} remaining of ${todos.length}</span>
      ${completed > 0
        ? html`<button
            class="link"
            type="button"
            @click=${() => db.todos.clearCompleted()}
          >
            Clear ${completed} completed
          </button>`
        : null}
    </footer>
  `;
});

const TodoRow = component(function TodoRow(props: { db: Database; todo: Todo }) {
  const { db, todo } = props;

  return html`
    <li class="todo">
      <label class="todo-label">
        <input
          type="checkbox"
          .checked=${todo.done}
          @change=${(event: ChangePayload) =>
            db.todos.setDone(todo.id, event.checked ?? !todo.done)}
        />
        <span class="todo-text">${todo.text}</span>
      </label>
      <button
        class="remove"
        type="button"
        title="Delete"
        @click=${() => db.todos.remove(todo.id)}
      >
        &times;
      </button>
    </li>
  `;
});
```

Components. Props. Keyed rows. A checkbox bound to a value and a change
handler. You have written this file. The only thing that might catch your eye is
that the handler calls the database directly, with no `fetch` and no endpoint —
and you have seen that too, near enough, in every server-actions framework of
the last few years.

So far: nothing.

## 2. Open a second tab

Tick a checkbox in one. The other updates.

Not on a poll. Not after a refetch. Immediately, and with the count in the
footer updated too.

The reasonable assumption is that somebody wired up a socket and a subscription.
So go looking for it.

## 3. There is no synchronization code

The file above is the entire application, and it contains no socket, no
subscription, no query key, no cache, no invalidation call, and no notion that
another user exists. The only wiring anywhere is one line, registered once when
the process boots:

```20:20:server/probes/todo/probe.ts
    subscribe: (listener) => store.onChange(listener),
```

That line does not mention todos, or sessions, or what changed. It says "when
the store changes, tell the runtime." The runtime re-renders each affected
session, diffs the result against what that browser is known to be showing, and
sends the difference.

Both tabs agree because both are derived from the same state by the same
function. Consistency is not a feature that was implemented. It is what is left
when you delete the copy.

## 4. Watch the wire

Open the Protocol panel on the right. On first connection you get a `templates`
frame followed by a `snapshot` — with two todos in the list, that is three
templates. Here is template 3, the row, sent **once** for every row that will
ever exist:

```json
["\n    <li class=\"todo\">\n      <label class=\"todo-label\">\n        <input\n          type=\"checkbox\"\n          .checked=", "\n          @change=", "\n        />\n        <span class=\"todo-text\">", "</span>\n      </label>\n      <button\n        class=\"remove\"\n        type=\"button\"\n        title=\"Delete\"\n        @click=", "\n      >\n        &times;\n      </button>\n    </li>\n  "]
```

And here is a row in the snapshot:

```json
{
  "key": "6ae30540-8278-4a8e-97ac-930223b80799",
  "instance": {
    "id": "root/h1/h0/k:6ae30540-8278-4a8e-97ac-930223b80799",
    "templateId": 3,
    "values": [false, { "kind": "event" }, "Buy milk", { "kind": "event" }]
  }
}
```

Four values. A boolean, a marker, a string, a marker. The `<li>`, the `<label>`,
the `<button>`, the `&times;` — none of it is here, because it went across once
and is cached under `templateId: 3`.

Now tick a checkbox. The operations that produces:

```json
[
  { "op": "set", "instanceId": "root/h1/h0/k:6ae30540-…", "hole": 0, "value": true },
  { "op": "set", "instanceId": "root", "hole": 2, "value": 1 },
  { "op": "set", "instanceId": "root", "hole": 4,
    "value": { "kind": "instance",
               "instance": { "id": "root/h4", "templateId": 4,
                             "values": [{ "kind": "event" }, 1] } } }
]
```

Three operations. As an `update` frame carrying no new layout that is **355
bytes**, and not one character of HTML in it.

Note what the third one is. Ticking a box made the "Clear completed" button
appear, and nobody wrote code to make that happen — it is a ternary in the
footer that just became true. Because that branch had never been rendered for
this connection, its layout rides along in the same frame, bringing this
particular update to 533 bytes.

Tick a second box and you get this instead:

```json
[
  { "op": "set", "instanceId": "root/h1/h0/k:afc4a6e7-…", "hole": 0, "value": true },
  { "op": "set", "instanceId": "root", "hole": 2, "value": 0 },
  { "op": "set", "instanceId": "root/h4", "hole": 1, "value": 2 }
]
```

**267 bytes.** The button's layout is already cached, so only the count inside
it moves. A branch of the UI you have never seen costs nothing until the moment
you see it, and nothing again afterwards.

## 5. Now look at what the browser sent back

Click the delete button. This is the entire outbound message:

```json
{
  "type": "event",
  "revision": 3,
  "instanceId": "root/h1/h0/k:6ae30540-8278-4a8e-97ac-930223b80799",
  "hole": 3,
  "payload": { "kind": "click" }
}
```

No method. No route. No body. No DTO.

Read it again, because the interesting thing is what is *missing*: there is
nothing in that message that says what to delete. No `todoId` field. The uuid
appears only as part of an address — the position of a node in a tree — not as
an argument.

## 6. The handler already had the row

```96:96:server/app/todo-app.ts
        @click=${() => db.todos.remove(todo.id)}
```

When that row was rendered, `todo` was the actual object from the store, and the
arrow function closed over it. The closure never went anywhere. It was put in a
table on the server:

```
root/h1/h0/k:6ae30540-8278-4a8e-97ac-930223b80799   holes: 1, 3
```

Hole 1 is the checkbox handler. Hole 3 is delete. The browser was handed
`{"kind":"event"}` — a marker meaning "there is a function here that you cannot
see" — and it sends back the coordinates of the marker it just clicked.

So the browser is holding a **reference to a server closure**, and calling it by
address.

This is why there is no API layer to write. Not because it was hidden behind a
code generator or inferred from types, but because the call site never existed.
There is nothing to serialize, so there is no serialization format; nothing to
address, so there are no routes; nothing to validate on arrival, so there is no
schema. The argument never crossed the network, so it never had to be a string.

Count what that removes from the todo app: no endpoint, no HTTP method, no
request type, no response type, no client-side cache, no cache key, no
invalidation, no refetch, no loading flag, no error branch, no optimistic
update, no rollback, no subscription, no reconnect resync logic, and no
possibility of the deployed client disagreeing with the deployed server, because
there is no deployed client.

## 7. And it is not a trick — state works

You might reasonably assume this only holds for a stateless render. It does not.
Components have real, retained state:

```373:373:server/probes/admin/admin-app.ts
  const [collapsed, setCollapsed] = useState(false);
```

That is on the server, one copy per connected browser, and it survives across
renders in the ordinary way.

It is also identified better than React's is. React keys state by position among
siblings, so if you move the last row of a list to the front, the state at that
index stays behind. Here, state is keyed by the row's structural address, so it
travels with the row:

```288:295:test/component.test.ts
    // The row that was last is now first. Positional slots would hand its
    // count to `a`; addresses hand it back to `c`.
    order = ["c", "a", "b"];
    const root = view.render().root;

    expect(rowText(root, "c")).toBe(3);
    expect(rowText(root, "a")).toBe(0);
    expect(rowText(root, "b")).toBe(0);
```

## 8. The bill

Every demo like this one has a catch, and hiding it would be the wrong move,
because it is the entire design trade.

Set the Latency control in the Protocol panel to **400 ms poor mobile** and use
the app again.

Ticking a checkbox now takes 400 ms to visibly settle, because the meaning of
that tick lives on the server and nothing can resolve until the round trip
completes. On localhost this is invisible; over a real network it is the
governing fact of the architecture. The panel reports what your last action
actually felt like, so you can stop guessing.

Then type in the "What needs doing?" field. It is instant, at any latency,
because the draft text belongs to the browser and only the submitted value is
ever sent.

That contrast is the whole design question in one screen. Interactions whose
*meaning* is server-owned cost a round trip. Interactions that are purely local
mechanics should not, and the ones that have been made local — the draft field,
the form reset — do not. Moving focus happens in the browser too now, but the
server is what decides when, so asking for it costs the same round trip as
anything else. Which mechanics get to be client-owned, and how you declare them,
is the open work; today the list is short.

The latency dial is not decoration. It found a real bug: the event guard
originally required each event to cite the session's current revision, so any
two clicks within one round trip carried the same revision and the second was
silently discarded. At 0 ms that window is about two milliseconds and
unreachable by hand. At 400 ms you hit it constantly. Validity is now decided by
the address rather than a global revision.

## 9. Try the rest

The probe picker in the panel switches applications against the same runtime.

| Probe | What to look for |
| --- | --- |
| `todo` | The baseline above |
| `odds` | A live market ticking on a timer. Open several tabs — every one renders byte-identical trees, which is the case where one render could serve all of them |
| `admin` | The largest tree, and the honest one: count how many interactions cost a round trip that should not |
| `routes` | `useState` holding a route, so navigation is server-owned |
| `ledger` | A dense spreadsheet where every cell depends on every input |
| `roles` | Permission-filtered rendering — a session is never sent data its role cannot see |

`?mine=1` on the odds board adds a personal panel. Watch what that one small
per-user subtree does to how much of the page is identical between tabs.

---

## What this is

A prototype, and the interesting questions are still open. There is no
reconnect survival, no server-side rendering for a first paint, no windowing for
long lists, and the only client-owned interaction today is the draft text
field — everything else costs a round trip. The
measurements behind each of those are in
[`research/design-probes.md`](../research/design-probes.md), and the argument
about where it is affordable is in
[`research/economics.md`](../research/economics.md).

But the thing in section 6 is real, it works today, and it is the reason to
care: **the click handler already has the row.** Everything you normally write
between those two facts is ceremony that exists only because the function and
the data ended up on opposite sides of a network.

If you want the API surface rather than the pitch, read
[`coming-from-react.md`](coming-from-react.md).
