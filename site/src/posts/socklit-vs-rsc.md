React Server Components solved serializing a tree that is partly
server-rendered and partly client-hydrated. That is a real problem and
they spent years on the IR. It is still request/response. There is no
live session. A navigation is a new request. A click that needs fresh
data is a new request. `"use client"` is a file suffix and a mental
model the market has already punished for confusion.

Socklit is not RSC with a socket glued on.

## Two different boundaries

RSC’s tell is a mixed JSX tree. Some components run on the server.
Some hydrate. The same syntax, a directive to split the worlds, and a
bundle that has to respect the split. Props that cross the boundary
must be serializable. A function does not.

```tsx
// app/page.tsx — server
export default async function Page() {
  const todos = await db.todos.list();
  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo.id}>
          {todo.text}
          <Delete id={todo.id} />
        </li>
      ))}
    </ul>
  );
}
```

```tsx
// app/delete.tsx
"use client";

import { removeTodo } from "./actions";

export function Delete({ id }: { id: string }) {
  return (
    <button type="button" onClick={() => removeTodo(id)}>
      Delete
    </button>
  );
}
```

```ts
// app/actions.ts
"use server";

export async function removeTodo(id: string) {
  const todo = await db.todos.find(id);
  if (!todo) throw new Error("not found");
  await db.todos.remove(id);
  revalidatePath("/");
}
```

Three files. An id across the boundary. A lookup. `revalidatePath` so
the next request sees the truth. The button cannot close over `todo` —
that object is not allowed on the client.

Socklit’s tell is the opposite. A server component is a function you
call. An island is a `<mount>`. They are not the same JSX.

```ts
html`
  <li>
    ${todo.text}
    <button
      type="button"
      @click=${() =>
        void store.mutate((current) => ({
          next: current.filter((row) => row.id !== todo.id),
          result: undefined,
        }))}
    >
      Delete
    </button>
  </li>
`
```

The handler is in the template. It captured `todo`. You cannot
accidentally import `useStore` into a `.island.tsx` file and have it
“just work” — the two graphs must not mix, and that is a contract, not
a compiler surprise.

```ts
html`<mount
  .Island=${StaffPicker}
  .people=${STAFF}
  .onPick=${(id: string, session) => assign(loan.id, id, session.user)}
></mount>`
```

RSC is trying to let you write one React app that happens to run in
two places. We are not. The app runs next to the data. The replica
paints. The island is a hole with a name.

## No session

The load-bearing absence: RSC does not keep your tree. The server
renders, serializes, hangs up. The next interaction starts again. That
is why server actions look like POST handlers with nicer types, and
why the client still owns a lot of the interactive tree.

A filter that should last the visit is client state, or a searchParam
you round-trip.

```tsx
"use client";

export function Filter({ todos }: { todos: Todo[] }) {
  const [query, setQuery] = useState("");
  const shown = todos.filter((todo) => todo.text.includes(query));
  return (
    <>
      <input value={query} onChange={(event) => setQuery(event.target.value)} />
      <List todos={shown} />
    </>
  );
}
```

A Socklit session is a JS object that lasts as long as the socket.
`useState` lives there. Closures live there.

```ts
const [query, setQuery] = useState("");
const shown = todos.filter((todo) => todo.text.includes(query));
```

That `useState` is this tab, on the server. Setting it is a round trip
— which is the bill, and also why typeahead that cannot wait is an
island, not a suffix.

`session.user` is a value you computed when the socket connected, or
after `grant`, not a JWT you re-parse on every action.

```ts
@click=${(_event, session) => {
  if (!session.user) return;
  void store.mutate((current) => ({
    next: current.filter((row) => row.id !== todo.id),
    result: undefined,
  }));
}}
```

`revoke` reidentifies on the same socket; it does not reconnect.

You pay for that. Memory per session. Sticky processes. A deploy that
drops the tree. RSC does not have that bill, because it never opened
the tab.

## Distribution

Next has Vercel, the docs, the jobs, the component catalog that still
works on the client half. We have a `file:` install and a starter.
That is not a temporary humility paragraph. It is the current product.

If you need the Next ecosystem, use Next. If you need a live tree and
a handler that closed over the row, you are not choosing a rendering
strategy inside an RSC app. You are choosing a different runtime.

## What we are not claiming

We are not faster than the App Router at delivering a blog post. We
do not have streaming RSC, static generation, or a CDN story for the
first HTML. First paint still needs the socket; the page is an empty
`#app` until `templates` and a snapshot arrive. That is a real hole —
crawlers, link previews, no-JS — and it is not patched by calling
ourselves “server components.”

RSC is the most recent serious thinking about a mixed tree. It is not
this architecture. A mount is not `"use client"`.
