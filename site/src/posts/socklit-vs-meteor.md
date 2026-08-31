Meteor (2012) attacked the same ceremony we did, and chose the other
fork.

The ceremony is the JSON API: endpoints, DTOs, a client cache, the
question of when your copy is wrong. Meteor’s answer was to
replicate the *database* to the browser — mini-mongo, publications,
optimistic methods — and let the UI be an ordinary client program
over a local replica of the data.

Socklit’s answer is to keep the *UI* on the server and replicate a
tree. The browser holds interned templates and values in bindings.
It does not hold the rows.

Those are opposite postures on what the client is allowed to have.

## The collection on both sides

Meteor’s demo was one JavaScript. The same collection existed in
Node and in the browser. A write on either side was a method; the
client applied it optimistically to mini-mongo.

```ts
Todos = new Mongo.Collection("todos");

if (Meteor.isServer) {
  Meteor.publish("todos", function () {
    if (!this.userId) return this.ready();
    return Todos.find({ owner: this.userId });
  });

  Meteor.methods({
    "todos.remove"(id: string) {
      const todo = Todos.findOne(id);
      if (!todo || todo.owner !== this.userId) {
        throw new Meteor.Error("denied");
      }
      Todos.remove(id);
    },
  });
}
```

```ts
// client — a real collection, on the laptop
Meteor.subscribe("todos");

Template.todo.events({
  "click .remove"() {
    Meteor.call("todos.remove", this._id);
  },
});
```

Authorization is a publication. If the publication is wrong, the
document is on the laptop. Mini-mongo is a second database with a
second query language and a second consistency story. The sync
protocol *is* the product, and it is the ticket.

The company survived by extracting Apollo and abandoning the
architecture. That is not a dunk. It is what happened when the
worldview met production.

## The row never leaves

A Socklit replica cannot `Todos.find()`. There are no todos there.
There are strings in holes. A role that cannot see a row does not
get a JSON blob with a field stripped. It gets a tree that does not
contain the row.

```ts
function identify(request: IdentifyRequest): Member | null {
  const token = sessionToken(request);
  if (!token) return null;
  return verifyTicket<Member>(token, secret);
}

export const App = component(function App(props: { store: typeof store }) {
  const todos = useStore(props.store).state;
  return html`
    <ul>
      ${keyed(
        todos,
        (todo) => todo.id,
        (todo) => TodoRow({ store: props.store, todo }),
      )}
    </ul>
  `;
});
```

```ts
html`
  <button
    type="button"
    @click=${(_event, session) => {
      const actor = session.user;
      if (!actor) return;
      void store.mutate((current) => ({
        next: current.filter((row) => row.id !== todo.id),
        result: undefined,
      }));
    }}
  >
    Delete
  </button>
`
```

Authorization is not a publication. It is `identify`, `session.user`,
and a write that reads the actor inside the handler. Painting the
button is not permission.

The cost of that refusal is the catalog. Meteor kept npm, because the
UI was still a client program.

```ts
import DatePicker from "react-datepicker";
<DatePicker selected={todo.due} onChange={setDue} />
```

That assumes the data is in the browser. We do not. An island is a
named widget for mechanics that cannot wait, not a second copy of
the list.

## The road not taken

If you want one language on both sides and a database in the
browser, you are looking at Meteor’s descendants — or at a SPA plus
a sync engine — not at a thinner Socklit. We are not going to grow
a client store and meet you in the middle. That would reintroduce
the second copy, which is the thing the runtime exists to delete.

```ts
await listen({
  identify,
  createApp: (session) => () => App({ store, user: session.user }),
  subscribe: (onChange) => store.onChange(() => onChange(store)),
});
```

The store is yours. The JSON file is a default. The replica is a
replica. Two tabs agree because they are two views of one program,
not because a collection followed them home.
