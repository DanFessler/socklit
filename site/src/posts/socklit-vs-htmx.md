htmx is the most serious competitor, and not because it is similar.

htmx is **stateless**. There is no server-side session, no retained
tree, no replica. Every interaction is an ordinary HTTP request whose
response is an HTML fragment swapped into a target. The server never
knows what your screen looks like, and does not need to.

That one decision erases the operational bill this architecture
pays: no memory per session, no sticky sessions, no reconnect
storms, no session to migrate, no burst fan-out, and a deploy that
kills nothing because there is nothing to kill.

It also shares the thesis. JSON APIs, DTOs, duplicated client state,
synchronization bugs — htmx’s complaint too, and htmx deletes all of
it.

## Delete, written both ways

htmx keeps the server in charge of HTML. The button names a verb, a
URL, and a swap. The server looks the row up and returns a fragment —
or nothing.

```html
<li id="todo-{{ todo.id }}">
  {{ todo.text }}
  <button
    type="button"
    hx-delete="/todos/{{ todo.id }}"
    hx-target="closest li"
    hx-swap="outerHTML"
  >
    ×
  </button>
</li>
```

```ts
app.delete("/todos/:id", async (request, response) => {
  const todo = await db.todos.find(request.params.id);
  if (!todo) return response.status(404).end();
  await db.todos.remove(todo.id);
  response.status(200).end();
});
```

There is no client cache. There is still an id on the wire, a route,
and a lookup. The unit of update is a chunk of markup.

Socklit has no route. The handler closed over the row. The unit of
update is a hole.

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
      ×
    </button>
  </li>
`
```

Because the server owns rendering, htmx owns authorization by
construction. It is real HTML from a real server, so crawlers and
link previews work. We still ship an empty `#app` until the socket
paints. That failing is why this architecture is a poor fit for
blogs, forums, and storefronts — a joke we are aware of, writing
this on a Socklit site.

## For most internal tools, use htmx

Internal tools were the strongest economic fit we measured, and htmx
delivers most of the operational win with a fraction of the
machinery. HTTP caching amortizes an impersonal fragment for free.

```
Cache-Control: public, max-age=30
```

We have not beaten a CDN on cost. Freshness is the only difference: a
cache TTL versus an instant push.

If you wanted HTML over the wire and do not need a live tree, stop
here. This document is not a reason to switch.

## What is left

A short list, not a manifesto.

**Multiplayer push.** htmx has no native story for another user’s
action changing your screen. The extensions exist, but you are back
to a protocol and a swap.

```html
<body hx-ext="sse" sse-connect="/events">
  <ul sse-swap="todo-changed" hx-swap="innerHTML">
    <!-- refetch the list when anyone acts -->
  </ul>
</body>
```

Here, `subscribe` plus `useStore` is the whole ticket.

```ts
await listen({
  app: () => App({ store }),
  subscribe: (onChange) => store.onChange(() => onChange(store)),
});
```

**Update granularity.** One changed number is one scalar, not a
re-rendered fragment. That matters when the update rate is high —
odds, tickers, a board that ticks.

```html
<div hx-get="/odds/oak" hx-trigger="every 1s" hx-swap="innerHTML">
  3.40
</div>
```

```ts
html`<span>${price.toFixed(2)}</span>`
```

The htmx request replaces the node. The Socklit patch is the new
string in a hole the replica already has.

**Local DOM state.** Fragment swapping destroys an unbound input
unless you are careful. Hole patches leave it alone by construction.
The starter’s add field relies on that — no `.value=`, so a store
notify from the other tab does not wipe what you are typing.

**Authoring.** htmx asks you to think in hypermedia. For a developer
whose model is typed function components with props, that is a
different paradigm, not a lighter one. No types across the boundary,
no component composition in the sense they mean. Simpler for the
operator is not the same as familiar to the author.

## The structural advantage, narrowed

Render amortization is not something “only we can do.” An impersonal
htmx fragment can sit behind a CDN. The remaining case is impersonal
shared views that need sub-second freshness — scoreboards, live ops,
a market board. The competitor to beat there is a cache, not React.

Use htmx when the screen is a document that updates in chunks. Use
this when the screen is a shared, pushed view and the handler should
close over the row.
