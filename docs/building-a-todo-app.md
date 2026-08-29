# Let me build you a todo app

I know how this ends. You will not, three separate times — and the last one is
about the very first line of code I am going to show you, which is the most
ordinary line in the whole document.

This is a staged demonstration and I would rather admit that than pretend to
stumble into my own punchline. But the code is real. Every snippet runs against
the API as it exists today, and the finished version is
`[server/app/todo-app.ts](../server/app/todo-app.ts)`.

```bash
npm install
npm run dev
```

---

## 1. The most boring program in the world

A todo list. State in the component, handlers that update it.

```ts
type Todo = { id: string; text: string; done: boolean };

export const TodoApp = component(function TodoApp() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const remaining = todos.filter((todo) => !todo.done).length;

  return html`
    <h1>Todos</h1>

    <form
      @submit=${(event: SubmitPayload) => {
        const text = event.fields["text"]?.trim();
        if (!text) return;
        setTodos((current) => [
          ...current,
          { id: crypto.randomUUID(), text, done: false },
        ]);
      }}
    >
      <input name="text" placeholder="What needs doing?" required />
      <button type="submit">Add</button>
    </form>

    <ul>
      ${keyed(
        todos,
        (todo) => todo.id,
        (todo) => html`
          <li>
            <input
              type="checkbox"
              .checked=${todo.done}
              @change=${(event: ChangePayload) =>
                setTodos((current) =>
                  current.map((row) =>
                    row.id === todo.id
                      ? { ...row, done: event.checked ?? !row.done }
                      : row,
                  ),
                )}
            />
            <span>${todo.text}</span>
            <button
              @click=${() =>
                setTodos((current) =>
                  current.filter((row) => row.id !== todo.id),
                )}
            >
              &times;
            </button>
          </li>
        `,
      )}
    </ul>

    <footer>${remaining} remaining of ${todos.length}</footer>
  `;
});
```

You have written this. Twice, probably, in an interview.

The only things that are not React are cosmetic. Views are lit-html tagged
templates rather than JSX, so handlers bind with `@click=` instead of `onClick=`,
and `.checked=` carries a leading dot because that sets the DOM property rather
than the attribute. Keys are enforced instead of warned about: a bare
`todos.map(...)` throws, and says so in as many words.

```
hole 1 of instance root is a plain array. Wrap collections in
keyed(items, keyOf, render) so rows keep a stable identity.
```

Cosmetics. `useState`, an updater function, immutable array juggling, derived
values computed in the body. If I showed you only this file you would think you
were reading a React tutorial with an unfamiliar renderer.

Hold that thought for about four minutes.

## 2. It does not survive a refresh

Because of course it does not. The list lives in component state.

So: persistence. You know this shape. An endpoint per operation. A `fetch` per
operation. A loading flag while the first one is in the air, an error branch for
when it is not. And the quiet structural cost, which is that `todos` stops being
the truth and becomes a *copy* of the truth — so now you own the question of
when your copy is wrong.

Every one of those is about to not happen.

```ts
export const TodoApp = component(function TodoApp(props: { db: Database }) {
  const db = props.db;
  const todos = useStore(db.todos).list();
  const remaining = todos.filter((todo) => !todo.done).length;

  return html`
    <h1>Todos</h1>

    <form
      @submit=${(event: SubmitPayload) =>
        db.todos.add(event.fields["text"] ?? "")}
    >
      <input name="text" placeholder="What needs doing?" required />
      <button type="submit">Add</button>
    </form>

    <!-- the list and the footer, unchanged apart from reading `todos` -->
  `;
});
```

The rows have grown enough to deserve their own component, which they get by
being wrapped in the same `component()` call and taking props:

```78:102:server/app/todo-app.ts
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

Read those handlers again. They call the database. Not an endpoint that calls the
database — the database, inside the submit handler, inside the click handler, on
the line where you decided what should happen.

And notice what direction the diff went. Adding durability made the application
**smaller**. The uuid generation, the spread-and-map immutable updates, the
`setTodos` plumbing: gone, all of it, replaced by the sentence you would have
used to describe the feature out loud. `todos` is no longer a copy of anything.
It is what the database says, re-read every time the function runs.

At this point the honest reaction is *"fine — server actions."* You have seen a
framework put a function on the server and let you call it. That is a fair read,
it is roughly correct, and it is the last moment in this document where a fair
read is available.

Before we go on, though, look at those handlers one more time, because there is
something in them that does not fit.

```ts
@click=${() => db.todos.remove(todo.id)}
```

That is the whole handler. One expression. No `await`, no `.then`, no `catch`,
and — this is the part to notice, because it is an absence — nothing after it
that updates anything. The row is deleted and the handler is over.

The read at the top of the component is stranger still:

```ts
const todos = useStore(db.todos).list();
const remaining = todos.filter((todo) => !todo.done).length;
```

A durable store is asked for its contents, and the answer is an array, in hand,
filtered on the very next line. Not awaited. Not a promise waiting to be
unwrapped.

Sit with what that rules out. Nothing across a network answers you on the next
line. And if the delete were a request in disguise — the reasonable guess, and
the one I would make — then its response would have to matter to somebody.
Something would have to wait on it to learn the delete had happened, and then
flip a loading flag, or write to a cache, or trigger a refetch, because that is
the only way a screen ever finds out that the server's answer has changed.

There is nothing after that handler. It deletes, and it ends. And the screen is
still right.

I am not going to tell you why yet.

One more thing while we are here. The store offers both `toggle(id)` and
`setDone(id, done)`, and I used `setDone`.

A flip and an absolute are the same thing when one person is clicking. They stop
being the same thing the moment two people are.

Keep that in your pocket.

## 3. Now make it multiplayer

Which was always the requirement, because it always is. Two people, one list.

You have scoped this ticket before:

- stand up a WebSocket server
- design a message protocol — `todo:added`, `todo:updated`, `todo:removed`
- broadcast from every mutation path
- write a client reducer that applies those messages to local state
- reconcile them against your own optimistic updates so your echo does not
double-apply
- handle out-of-order arrival
- write a resync path for reconnect, because you will drop messages
- then live with the bugs where two tabs act inside the same round trip

A week. And that last line is not a task, it is a tenancy.

Before you write any of it, open a second tab.

Tick a checkbox in one. It moves in the other. Delete a row; it leaves both. The
count in the footer updates in both. Add a todo and watch it appear in a window
you were not looking at.

Let me be precise about what I am claiming, because the interesting version is
also the true one. Something is doing work here — I am not going to pretend the
bytes moved themselves, and we will get to what did. What contains no
synchronization code is the *application*, the file we have been writing. Scroll
up. There is no socket in it, no subscription, no message type, no reducer, no
cache, and nothing in it that knows a second user exists.

## 4. All right — let me tell you what this is

Look at that ticket again. Every line of it is a *reconciliation* problem: two
copies of the truth, and code to keep them agreeing. The assumption is so
load-bearing that nobody writing the ticket ever says it out loud.

There is only one copy here.

That is because you have been writing this application on the server. Every
function in this document runs in Node. Not one of them has ever been shipped to
a browser or executed inside one — not the submit handler, not the checkbox, not
the delete button.

Now go back over the last three steps and watch them stop being impressive.

Of course the handler could call the database; it was standing next to it. Of
course nothing needed awaiting; there was no network between the click and the
data. Of course two tabs agree; they are two views of one program in one process,
and it never occurred to either of them to disagree.

None of that is clever. On a server those things are free, and they have always
been free. It is most of the reason people enjoyed writing PHP.

The unusual part is the one you did not notice you were getting.

Server code has always been allowed to sit next to the data and be trusted with
it. What server code has never been able to do is the thing you spent three steps
doing: a checkbox that responds, a row that vanishes when you click it, a field
you can type into, a screen that changes while you are looking at it.
Interactivity is the entire reason anyone goes to the client. Going to the client
is what creates the second copy. The second copy is what wrote that ticket.

You just built live, interactive, multi-user UI, and you never went to the
client.

That is what this is. It is called **Socklit**, and the idea is one sentence:

> Treat a web app like an authoritative multiplayer simulation whose replicated
> world is a UI tree.

The lineage is not web architecture, it is game networking. Multiplayer games hit
this problem first — many clients, one shared world, an unreliable network — and
the answer was never better reconciliation. It was to refuse the second copy. One
authoritative simulation runs on the server; the clients are replicas that draw
what they are told and send input back, trusted with nothing, because they are
holding nothing.

Here the replicated world is a UI tree. The server keeps a live instance of your
application per connection, your component function is the simulation step, and
`lit-html` templates are what that world is made of.

Which makes the rest of it consequences rather than features.

The browser has no todos — no store, no reducer, no array, just values sitting in
template holes and a socket. There is no second copy to disagree with the first,
so there is nothing to reconcile, and that is why step three was empty.

The application is a function of the database, and every session runs the same
function. The whole of the wiring is one line, registered once when the process
starts:

```20:20:server/probes/todo/probe.ts
    subscribe: (listener) => store.onChange(listener),
```

Read what it does not say. It does not mention todos. It does not mention
sessions, or which one acted, or what changed. It says: when the store changes,
tell the runtime. The runtime re-renders each affected session, compares the
result against what that browser is known to be showing, and ships the
difference.

Which raises the question of how it knows which sessions are affected, and that
is the one call in step two I have not explained:

```ts
const todos = useStore(db.todos).list();
```

`useStore` returns the store it was given, unchanged, so it is easy to read the
call as ceremony. It is not. It is the only moment at which the runtime can learn
that this session read this store — because `db.todos.list()` is an ordinary
method call on an ordinary object, invisible to anything watching from outside. A
read that does not announce itself cannot be observed after the fact.

So each render builds a set of the stores that session actually touched, thrown
away and rebuilt on the next one. When a store changes, sessions whose set does
not contain it are skipped without rendering at all. No bookkeeping between
renders, no dependency graph, no reactivity — a set of identities, discarded
wholesale each time.

Which is also why the call names the store and not the database holding it. The
identity declared is what a change gets matched against, and nothing is ever
announced from the plain record the stores sit in, so `useStore(db)` throws
rather than matching nothing for the rest of the session — the one form of that
mistake anything can catch.

Two tabs agree because both are derived from the same state by the same
function. Not because a message told them to. Agreement is not a feature that
was implemented — it is what is left over when you delete the copy.

Now take that thing out of your pocket. Once other people are acting on this
list inside your round trip, `toggle` is a bug with a fuse on it: two clients
that both flip cancel each other out, two that both ask for `done` do not. That
was not a general note about concurrency. It was about the multi-user application
you finished building in step two, one step before you knew you were writing
one.

## 5. What is actually on the wire

Open the Protocol panel to the right of the page.

First connection: a `templates` frame, then a `snapshot`. Here is the row
template — sent **once**, for every row that will ever exist:

```json
[" <li class=\"todo\"> <label class=\"todo-label\"> <input type=\"checkbox\" .checked=", " @change=", " /> <span class=\"todo-text\">", "</span> </label> <button class=\"remove\" type=\"button\" title=\"Delete\" @click=", " > &times; </button> </li> "]
```

And here is a row that uses it:

```json
{
  "key": "2a04289f-8e52-472a-af57-6f47ff510961",
  "instance": {
    "id": "root/h1/h0/k:2a04289f-8e52-472a-af57-6f47ff510961",
    "templateId": 3,
    "values": [false, { "kind": "event" }, "Buy milk", { "kind": "event" }]
  }
}
```

A boolean, a marker, a string, a marker. The `<li>`, the `<label>`, the
`<button>`, the `&times;` — none of it is in the row. It crossed once and lives
in the browser's cache under `templateId: 3`.

Ticking a checkbox produces three operations: **267 bytes**, no HTML. The first
tick of a session costs 459, because it makes the "Clear completed" button
appear and that branch has never been rendered for this connection, so its
layout rides along once and never again.

## 6. And what goes back up

This is the entire message produced by clicking delete:

```json
{
  "type": "event",
  "revision": 3,
  "instanceId": "root/h1/h0/k:2a04289f-8e52-472a-af57-6f47ff510961",
  "hole": 3,
  "payload": { "kind": "click" }
}
```

No method. No route. No body.

And read it once more, because the interesting thing is an absence: **nothing in
that message says what to delete.** There is no `todoId` field. That uuid is
there as part of an address — the position of a node in a tree — and nowhere
else.

## 7. The handler already had the row

Back in step two we wrote this and I let it slide by:

```96:96:server/app/todo-app.ts
        @click=${() => db.todos.remove(todo.id)}
```

When that row rendered, `todo` was the actual record out of the store, and the
arrow function closed over it. The closure never went anywhere. It was filed on
the server under the row's address:

```
root/h1/h0/k:2a04289f-8e52-472a-af57-6f47ff510961   holes: 1, 3
```

Hole 1 is the checkbox. Hole 3 is delete. The browser got `{"kind":"event"}` — a
marker that means *there is a function here and you cannot see it* — and it
sends back the coordinates of the one that was clicked.

The browser is holding a reference to a server closure and calling it by
address.

One mechanical detail while we are down here. The runtime awaits whatever that
closure returns, which is how one event finishes before the next begins, and how
a `StoreError` reaches the browser as a recoverable error rather than taking the
session down:

```333:340:server/runtime.ts
    try {
      await handler(message.payload, session.context);
    } catch (error) {
      this.log(
        `session ${session.id} handler failed: ${describeError(error)}`,
      );
      this.sendError(session, "handler_failed", describeError(error), true);
    }
```

The second argument is the session that *sent* the event rather than the one the
tree was rendered for, which is the difference that matters the moment a subtree
is rendered once for several viewers. Our handler ignores it, and is allowed to: a
shorter function is valid wherever a longer signature is expected.

So there is no API layer here, and not because one was generated, or inferred
from types, or hidden behind a clever macro. There is no API layer because
**there was never a call site.** Nothing was serialized, so there is no format to
design. Nothing was addressed, so there are no routes. No argument crossed the
network, so nothing had to be flattened into a string and re-validated at the
other end.

This is the part that does not survive translation to any other language, and it
is worth being precise about why. `todo` is a live object on the heap that the
closure captured. Not an id it will look up again, not a row it will re-fetch —
the record itself, still in scope, because the function that will use it and the
function that made it are the same function in the same process.

## 8. About step one

You know this by now. Go and look at it anyway.

```ts
  const [todos, setTodos] = useState<Todo[]>([]);
```

That is the first line I showed you — before the database, before the second tab,
before any of it — and it was already the whole thing. That array was never in
the browser. It lived in a table on the server keyed by the string `root`, in a
Node process, one copy per open tab. `setTodos` did not schedule a re-render in
your page; it scheduled one several hundred milliseconds away, which produced a
new tree, which was diffed against what your browser was known to be showing, and
the difference was pushed down a socket.

You read it and thought *React*. So did I when I wrote it, and that is precisely
why it went first. The strangest line in this document is the one you skipped,
because it was the most familiar thing you saw all day.

## 9. The tally

Against the same application built the ordinary way, none of the following
appear anywhere in ours: an endpoint, an HTTP method, a request type, a response
type, a client cache, a cache key, an invalidation, a refetch, a loading flag,
an error branch, an optimistic update, a rollback, a subscription, a reconnect
resync, or any possibility of a deployed client disagreeing with a deployed
server — because there is no deployed client.

The ticket in step three was not finished quickly. It was never a ticket.

And in case you spent this whole document waiting to catch me — assuming `db`
was a proxy, and the property access was being turned into a request somewhere
out of sight — here is the entire data access layer:

```135:142:server/store.ts
/** What the todo application sees. There is no other data access layer. */
export type Database = {
  todos: TodoStore;
};

export function createDatabase(todos: TodoStore): Database {
  return { todos };
}
```

`return { todos }`. It was a plain object holding a class with methods on it, the
whole time.

## 10. If you have seen this before

Some of you have been waiting several sections to say *this is LiveView*, and you
are right, so let me take that seriously rather than sell around it.

Phoenix LiveView shipped in 2018, and its template layer is this one: HEEx splits
a template into static segments and dynamic parts, sends the statics once with an
identifier, and thereafter transmits only the changed dynamics keyed by index.
Template interning plus hole patching, reached independently, seven years
earlier. It is the best system in this space, it has run in production for years,
and it has already answered open questions this project is still writing research
notes about. Blazor Server, Vaadin Flow, and a lineage running back through
Seaside and ASP.NET WebForms all made versions of the same bet.

So none of the architecture here is new. The sharpest divergence is the part I
made the most noise about, and it cuts both ways. LiveView sends an event *name*
— `phx-click="delete"` plus params — which the server pattern-matches. This sends
an *address* into a table of live closures. The address is why
`db.todos.remove(todo.id)` can be written inline with no endpoint and no
event-name registry. But a name is stable across renders, survives a reconnect
without coordination, and is trivially serializable for logging or replay, while
an address means nothing except against a currently committed handler table —
which is precisely why this repo needs stale-event recovery and LiveView does
not. The ergonomic win and the recovery burden are one decision seen from two
sides.

That fork is also what allows rich objects as handler arguments, and even there
the property is not ours. A LiveView handler receives `phx-value-id` as a string
and looks the record back up, exactly as a REST endpoint would, so LiveView
authors plumb ids in every `handle_event`. A handler here closed over the record
itself — but so does **Blazor Server**, for the same reason, since a C# lambda
captures the real object on the server.

What is actually left is narrow, and worth stating precisely rather than
inflating:

**This model, in TypeScript, written the way you already write components.**
Every mature implementation is trapped inside Elixir, C#, PHP, or Java, and the
language is only half the toll. LiveView's function components are stateless; the
moment one needs state you move to a module with `mount`, `update`, and
`handle_event`, and state that travels through `assign(socket, :count, n)`.
Blazor is a class with parameters and lifecycle methods. So the ask is learn
Elixir *and* learn a lifecycle-callback component model, and dropping only the
first would leave half the barrier standing. Step one of this document was a
function with `useState` in it, and that was the whole point.

Credit where it is owed: **Solara**, built on Reacton, is a pure Python port of
React — `use_state`, `use_effect`, `use_context`, hook-order rules and all —
running server-side over a WebSocket, with handlers that are ordinary server
closures. Hooks on a server are not my idea and Solara got there first. What it
does differently is the wire: it synchronizes ipywidget models rather than
interned templates, and it serves notebooks and data apps rather than web
products.

Which gives the honest one-line version of this whole section. What you have been
reading is roughly **Solara's programming model on LiveView's wire**, in
TypeScript, pointed at the DOM. Both halves are borrowed, I do not think anyone
has put them together, and that is a distribution argument rather than a
technical one. I would rather label it that way than dress it up.

**And one claim nobody has tested.** As far as I can tell, no framework in this
family renders *once* for many sessions. Three probes here took a census of what
is shareable: at fan-out 2000, 99.95% of render CPU is provably redundant, and
populations share 85.9–91.3% of their bytes at subtree granularity. It is
measured and it is still unbuilt, but the blocker was not what anyone expected —
addressing was already identical across sessions; what stood in the way was that
event handlers closed over their session, which accounts for 77.5% of the
shareable region. Handlers now take the acting session as an argument, so a
closure that reads the actor from there is the same closure for every viewer. The
blocker is gone; the saving it was holding back is still unclaimed.

The honest cost of all of it: you keep the component model, the props-down
decomposition, the language, the type system, and the tooling. What you give up
is npm. A server-authoritative runtime cannot host a React date picker, a React
charting library, or `react-query`, because every one of them assumes state and
rendering live in the browser.

## 11. The bill

I would be selling you something if I stopped there. The trade is real and it is
not subtle.

Set the Latency control in the Protocol panel to **400 ms poor mobile**.

Now tick a checkbox. Four hundred milliseconds before anything moves. The
meaning of that tick lives on the server, so nothing can resolve until the round
trip completes. Localhost hides this completely, which is exactly why the dial
exists; a real network does not.

Now type in the add field. Instant, at any latency, because the draft text
belongs to the browser and only the submitted value is ever sent.

Those two facts sitting next to each other are the whole design question. An
interaction whose *meaning* is server-owned costs a round trip, and should. An
interaction that is pure local mechanics — a caret, an open menu, a hover —
should not, and that draft field is still the only interaction whose meaning is
local. One mechanic has been handed to the browser since: `focusWhen(active)` in
element position asks it to move focus and it does so itself, but the server is
what decides when, so the request rides down with a frame like everything else.

Step eight is also the explanation for the bill, which is why I saved it. Reach
for `useState` to add a filter and it will cost a round trip too, because it was
always server state:

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

One of the client-owned primitives that comment points at now exists, and focus
is the narrowest one there is: no state is held in the browser, only an
instruction acted on once. Deciding which interactions get to be local, and how
you say so without giving up everything above, is the real unfinished work here.

Not the sync code. That turned out not to be work at all.

---



## Try it

```bash
npm install
npm run dev
```

Open two tabs. Use one, watch the other. Then open the Protocol panel, turn the
latency dial up, and use it again with the cost visible.

The probe picker switches between larger applications on the same runtime: an
odds board, a menu-heavy admin console, a ledger, a permission-filtered console,
a router. Open `odds` in four tabs at once; every session renders byte-identical
trees, which is the case where one render could in principle serve all of them.

- [`coming-from-react.md`](coming-from-react.md) — the API surface, and the
  gotchas with no React analogue
- [`demo.md`](demo.md) — the same story told from the wire inward rather than
  from the code outward
- [`research/prior-art.md`](../research/prior-art.md) — the full survey, including
  where Solara has gone further than this has
- [`research/design-probes.md`](../research/design-probes.md) — what is still
  open, and the measurements behind every answer

