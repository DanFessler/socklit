This is a staged demonstration. I would rather admit that than pretend to
stumble into my own punchline. You will think you know what this is, three
times. The last time, it is the first line of the file — the most ordinary
line I am going to show you.

The code is real. Every snippet is the public surface: `socklit/server`, the
starter’s store, `listen`. Copy [`starter/`](/guide) if you want to run it.

```bash
npm install
npm run dev
```

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
              ×
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

Hold that thought.

## 2. It does not survive a refresh

Because of course it does not. The list lives in component state — **this tab
only**. Open a second tab and you have two lists.

So: persistence, and then two people. You know this shape. An endpoint per
operation. A `fetch` per operation. A loading flag while the first one is in the
air, an error branch for when it is not. And the quiet structural cost, which is
that `todos` stops being the truth and becomes a *copy* of the truth — so now
you own the question of when your copy is wrong.

Every one of those is about to not happen.

```ts
export const store = await createJsonStore<Todo[]>({
  file: "data/todos.json",
  initial: () => [],
  parse: parseTodos,
});

export const TodoApp = component(function TodoApp(props: { store: typeof store }) {
  const todos = useStore(props.store).state;
  const remaining = todos.filter((todo) => !todo.done).length;

  return html`
    <h1>Todos</h1>

    <form
      @submit=${(event: SubmitPayload) => {
        const text = event.fields["text"]?.trim() ?? "";
        if (!text) return;
        void props.store.mutate((current) => ({
          next: [...current, { id: crypto.randomUUID(), text, done: false }],
          result: undefined,
        }));
      }}
    >
      <input name="text" placeholder="What needs doing?" required />
      <button type="submit">Add</button>
    </form>

    <!-- the list and the footer, unchanged apart from reading todos -->
  `;
});
```

The rows have grown enough to deserve their own component:

```ts
const TodoRow = component(function TodoRow(props: {
  store: typeof store;
  todo: Todo;
}) {
  const { store, todo } = props;

  return html`
    <li>
      <input
        type="checkbox"
        .checked=${todo.done}
        @change=${(event: ChangePayload) => {
          const done = event.checked ?? false;
          void store.mutate((current) => ({
            next: current.map((row) =>
              row.id === todo.id ? { ...row, done } : row,
            ),
            result: undefined,
          }));
        }}
      />
      <span>${todo.text}</span>
      <button
        type="button"
        @click=${() =>
          void store.mutate((current) => ({
            next: current.filter((row) => row.id !== todo.id),
            result: undefined,
          }))}
      >
        ×
      </button>
    </li>
  `;
});
```

Read those handlers again. They call the store. Not an endpoint that calls the
store — the store, inside the submit handler, inside the click handler, on the
line where you decided what should happen.

And notice what direction the diff went. Adding durability made the application
**smaller**. The uuid generation stays; the spread-and-map immutable updates
move into `mutate`; the `setTodos` plumbing is gone. Replaced by the sentence
you would have used to describe the feature out loud. `todos` is no longer a
copy of anything. It is what the store says, re-read every time the function
runs.

At this point the honest reaction is *"fine — server actions."* You have seen a
framework put a function on the server and let you call it. That is a fair read,
it is roughly correct, and it is the last moment in this document where a fair
read is available.

Before we go on, look at those handlers one more time, because there is
something in them that does not fit.

```ts
@click=${() =>
  void store.mutate((current) => ({
    next: current.filter((row) => row.id !== todo.id),
    result: undefined,
  }))}
```

That is the whole handler. No `await` you have to wire to the screen, no
`.then`, no `catch`, and — this is the part to notice, because it is an
absence — nothing after it that updates anything. The row is deleted and the
handler is over.

The read at the top of the component is stranger still:

```ts
const todos = useStore(props.store).state;
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

One more thing while we are here. I used `event.checked`, an absolute, not a
flip of whatever the last paint said `todo.done` was.

A flip and an absolute are the same thing when one person is clicking. They
stop being the same thing the moment two people are. `mutate` sees `current`,
not the row closed over from the last paint. Painting a checkbox is not
permission, and it is not the write.

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

The whole of the wiring is the `listen` line the starter already has:

```ts
await listen({
  app: () => App({ store }),
  subscribe: (onChange) => store.onChange(() => onChange(store)),
});
```

Three names must agree: `useStore(store)`, `subscribe`, and `onChange(store)` —
the same object in all three. Then open a second tab.

Tick a checkbox in one. It moves in the other. Delete a row; it leaves both.
The count in the footer updates in both. Add a todo and watch it appear in a
window you were not looking at.

Let me be precise about what I am claiming, because the interesting version is
also the true one. Something is doing work here — I am not going to pretend the
bytes moved themselves. What contains no synchronization code is the
*application*, the file we have been writing. Scroll up. There is no socket in
it, no subscription, no message type, no reducer, no cache, and nothing in it
that knows a second user exists.

## 4. All right — let me tell you what this is

Look at that ticket again. Every line of it is a *reconciliation* problem: two
copies of the truth, and code to keep them agreeing. The assumption is so
load-bearing that nobody writing the ticket ever says it out loud.

There is only one copy here.

That is because you have been writing this application on the server. Every
function in this document runs in Node. Not one of them has ever been shipped
to a browser or executed inside one — not the submit handler, not the
checkbox, not the delete button.

Now go back over the last three steps and watch them stop being impressive.

Of course the handler could call the store; it was standing next to it. Of
course nothing needed awaiting; there was no network between the click and the
data. Of course two tabs agree; they are two views of one program in one
process, and it never occurred to either of them to disagree.

None of that is clever. On a server those things are free, and they have
always been free. It is most of the reason people enjoyed writing PHP.

The unusual part is the one you did not notice you were getting.

Server code has always been allowed to sit next to the data and be trusted
with it. What server code has never been able to do is the thing you spent
three steps doing: a checkbox that responds, a row that vanishes when you
click it, a field you can type into, a screen that changes while you are
looking at it. Interactivity is the entire reason anyone goes to the client.
Going to the client is what creates the second copy. The second copy is what
wrote that ticket.

You just built live, interactive, multi-user UI, and you never went to the
client.

That is what this is. It is called **Socklit**, and the idea is one sentence:

> Treat a web app like an authoritative multiplayer simulation whose
> replicated world is a UI tree.

The lineage is not web architecture, it is game networking. Multiplayer games
hit this problem first — many clients, one shared world, an unreliable
network — and the answer was never better reconciliation. It was to refuse
the second copy. One authoritative simulation runs on the server; the
clients are replicas that draw what they are told and send input back,
trusted with nothing, because they are holding nothing.

Here the replicated world is a UI tree. The server keeps a live instance of
your application per connection, your component function is the simulation
step, and `html` templates are what that world is made of.

Which makes the rest of it consequences rather than features.

The browser has no todos — no store, no reducer, no array, just values
sitting in bindings and a socket. There is no second copy to disagree with
the first, so there is nothing to reconcile, and that is why step three was
empty.

The application is a function of the store, and every session that subscribed
runs the same function. When the store changes, the runtime re-renders each
affected session, compares the result against what that browser is known to
be showing, and ships the difference.

`useStore` returns the store it was given, unchanged, so it is easy to read
the call as ceremony. It is not. It is the only moment at which the runtime
can learn that this session read this store. A read that does not announce
itself cannot be observed after the fact.

Two tabs agree because both are derived from the same state by the same
function. Not because a message told them to. Agreement is not a feature that
was implemented — it is what is left over when you delete the copy.

Now take that thing out of your pocket. Once other people are acting on this
list inside your round trip, a flip of the last-painted `todo.done` is a bug
with a fuse on it: two clients that both flip cancel each other out, two that
both write `done: true` do not. That was not a general note about
concurrency. It was about the multi-user application you finished building in
step two, one step before you knew you were writing one. Refuse at the write.
`mutate`’s `current` is the row that exists.

## 5. What is actually on the wire

First connection: the statics of each template, then a snapshot of the values
in the bindings. The row’s `<li>`, the `<label>`, the `<button>` — that
markup crosses **once** and lives in the browser under a template id.

A later tick of a checkbox is a hole patch: a boolean, and maybe a branch
that has never been painted for this connection. No HTML for the row you
already have. The replica paints; the server decides.

## 6. And what goes back up

Clicking delete does not send a method, a route, or a body that says what to
delete. It sends an *address*: this instance, this binding, a click. The uuid
is there as part of a position in a tree, and nowhere else as an API
argument.

There is no `todoId` field for you to design.

## 7. The handler already had the row

Back in step two we wrote the delete and I let it slide by.

When that row rendered, `todo` was the actual record out of the store, and
the arrow function closed over it. The closure never went anywhere. It was
filed on the server under the row’s address. The browser got a marker that
means *there is a function here and you cannot see it*, and it sends back
the coordinates of the one that was clicked.

The browser is holding a reference to a server closure and calling it by
address.

The second argument is the session that *sent* the event. Our handler ignores
it, and is allowed to. A write that must refuse a stranger reads
`session.user` there — a value you computed in `identify` — not the URL, not
whether a button was painted.

So there is no API layer here, and not because one was generated, or inferred
from types, or hidden behind a clever macro. There is no API layer because
**there was never a call site.** Nothing was serialized, so there is no
format to design. Nothing was addressed, so there are no routes. No argument
crossed the network, so nothing had to be flattened into a string and
re-validated at the other end.

This is the part that does not survive translation to any other language, and
it is worth being precise about why. `todo` is a live object on the heap that
the closure captured. Not an id it will look up again, not a row it will
re-fetch — the record itself, still in scope, because the function that will
use it and the function that made it are the same function in the same
process.

## 8. About step one

You know this by now. Go and look at it anyway.

```ts
const [todos, setTodos] = useState<Todo[]>([]);
```

That is the first line I showed you — before the store, before the second
tab, before any of it — and it was already the whole thing. That array was
never in the browser. It lived in a table on the server, in a Node process,
one copy per open tab. `setTodos` did not schedule a re-render in your page;
it scheduled one on the server, which produced a new tree, which was diffed
against what your browser was known to be showing, and the difference was
pushed down a socket.

You read it and thought *React*. So did I when I wrote it, and that is
precisely why it went first. The strangest line in this document is the one
you skipped, because it was the most familiar thing you saw all day.

## 9. The tally

Against the same application built the ordinary way, none of the following
appear anywhere in ours: an endpoint, an HTTP method, a request type, a
response type, a client cache, a cache key, an invalidation, a refetch, a
loading flag, an error branch, an optimistic update, a rollback, a
subscription you wrote, a reconnect resync you wrote, or any possibility of a
deployed client disagreeing with a deployed server — because there is no
deployed client.

The ticket in step three was not finished quickly. It was never a ticket.

And in case you spent this whole document waiting to catch me — assuming
`store` was a proxy, and `mutate` was being turned into a request somewhere
out of sight — `createJsonStore` is a JSON file behind a mutex. A local
default, not the product. `useStore` plus `subscribe` is the product. You
bring the database.

## 10. If you have seen this before

Some of you have been waiting several sections to say *this is LiveView*, and
you are right. [Socklit vs LiveView, a Deep Dive](/blog/socklit-vs-liveview)
takes that seriously rather than selling around it.

The short version: Phoenix LiveView shipped the wire in 2018 — statics once,
dynamics by index. Solara shipped the programming model — hooks, server
closures — in Python, over widgets rather than interned templates. What you
have been reading is roughly **Solara’s programming model on LiveView’s
wire**, in TypeScript, pointed at the DOM. Both halves are borrowed. I would
rather label it that way than dress it up.

The sharpest fork with LiveView is the event. They send a *name*
(`phx-click="delete"`). We send an *address* into a table of live closures.
That is why `store.mutate(...)` can be written inline, and why a reconnect
is a problem they do not have. The ergonomic win and the recovery burden
are one decision.

**And one claim nobody has tested.** No framework in this family renders
*once* for many sessions. The probes say most of a same-route population is
shareable. It is measured and it is still unbuilt. Without it, this is a
nicer-typed LiveView for TypeScript, which is a respectable thing to be, and
should be labeled that way.

## 11. The bill

I would be selling you something if I stopped there. The trade is real and it
is not subtle.

A click whose *meaning* is server-owned costs a round trip. Localhost hides
this completely. A real network does not. Tick a checkbox; nothing moves
until the patch comes back.

Now type in the add field. Instant, at any latency, because the draft text
belongs to the browser — you did not bind `.value=` — and only the submitted
value is ever sent.

Those two facts sitting next to each other are the whole design question. An
interaction whose meaning is server-owned costs a round trip, and should. An
interaction that is pure local mechanics — a caret, typeahead, a drag —
should not. That is what an [island](/guide) is for. `useState` is not an
island. It is this tab’s server state, and setting it is a trip too.

Not the sync code. That turned out not to be work at all.

## Try it

Copy `starter/`. Point `socklit` at this repo. `npm install` and
`npm run dev`. Open two tabs. Use one, watch the other.

- [Getting started](/guide) — the surface, in order
- [API](/api) — every export
- [Compare](/compare) — the scoreboard; the deep dives are on this blog
