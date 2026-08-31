The ordinary web app has a JSON API and a React tree. You know the ceremony
because you have written it. An endpoint. A DTO. A client cache. Pending
state. Invalidation. The same fact lives in four places: the database, a
server cache if you have one, the client cache, and component state. A
well-built real-time SPA adds a fifth — a socket whose messages you reduce
into that cache.

Socklit keeps one. That is the human-complexity argument, not a speed
argument.

## Delete, written both ways

A REST handler cannot see the row. The object did not cross the wire, so
you send an id, look it up, handle not-found, and tell the client to
refetch a list it already thinks it has.

```ts
app.delete("/todos/:id", async (request, response) => {
  const todo = await db.todos.find(request.params.id);
  if (!todo) return response.status(404).end();
  await db.todos.remove(todo.id);
  response.json({ ok: true });
});
```

```ts
async function onDelete(id: string) {
  setPending(id);
  const response = await fetch(`/todos/${id}`, { method: "DELETE" });
  if (!response.ok) {
    setError("could not delete");
    setPending(null);
    return;
  }
  queryClient.invalidateQueries({ queryKey: ["todos"] });
}
```

Four artifacts: a route, a status, a pending flag, a cache key. The button
does not know the row. It knows a string it will ship and hope is still
valid.

A Socklit handler closed over the row. There is no route. The replica
sends an address; the function that already had `todo` runs.

```ts
html`
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
`
```

tRPC makes the call type-safe. This deletes the call.

Two tabs agree because they are two views of one program, not because you
wrote `todo:updated` and a client reducer.

```ts
await listen({
  app: () => App({ store }),
  subscribe: (onChange) => store.onChange(() => onChange(store)),
});
```

That is the whole multiplayer ticket. The SPA version is a message
protocol, an optimistic echo, and a resync path.

## What the SPA is for

The SPA is not a mistake. Continuous pointer interaction — a canvas, a
scrubber, a map you drag — belongs in the browser. The component catalog
belongs in the browser. Recharts, Radix, a date picker from the registry:
those assume state and rendering live where the pointer is.

```tsx
<DatePicker
  value={due}
  onChange={setDue}
  onOpenChange={setOpen}
/>
```

That does not run here. An island is a named client widget for the cases
that cannot wait for the wire. It is not React-as-the-app, and it is not
npm-as-the-UI.

```ts
html`<mount
  .Island=${StaffPicker}
  .people=${STAFF}
  .value=${loan.borrowerId}
  .onPick=${(id: string, session) => assign(loan.id, id, session.user)}
></mount>`
```

If your product *is* the pointer, stay. This is not a conversion pitch.

## Where the SPA still wins

Latency you can hide. Optimistic UI is a SPA specialty: the checkbox
flips before the POST returns.

```ts
onCheckedChange={(done) => {
  setTodos((current) =>
    current.map((row) => (row.id === todo.id ? { ...row, done } : row)),
  );
  void saveDone(todo.id, done);
}}
```

Here the meaning of the tick lives on the server, so the screen waits for
the patch. Localhost hides that. A phone does not.

We modelled this. Against a realistic SPA — one that also hits the server
on most clicks — time-to-first-feedback is 6–15 ms apart, not 6 ms versus
70 ms. On time-to-a-*correct* UI, server authority is faster in some
workloads, because its patch is holistically correct while the SPA’s
optimistic update is locally correct and globally stale until refetch.
That is a ratio, not a slogan. The [numbers](/performance) are in
`research/`.

## The honest split

Use a SPA when the product is a client program that happens to save.
Use this when the product is a shared, pushed view and the handler
should close over the row.

If you wanted HTML over the wire and do not need a live tree,
[htmx](/blog/socklit-vs-htmx) deletes the same ceremony with less
machinery. The SPA is the other pole: keep the tree, keep npm, keep
the second copy, and write the ticket.
