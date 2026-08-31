Phoenix LiveView shipped in 2018. Its template layer is this one: HEEx
splits a template into static segments and dynamic parts, sends the
statics once with an identifier, and thereafter transmits only the
changed dynamics keyed by index. Template interning plus hole
patching, reached independently, seven years earlier.

It is the best system in this space. It has run in production for
years. It has already answered questions this project is still writing
research notes about. Blazor Server, Vaadin Flow, and a lineage
running back through Seaside and ASP.NET WebForms all made versions
of the same bet.

None of the architecture here is new.

## A name versus an address

LiveView sends an event *name* — `phx-click="delete"` plus params —
which the server pattern-matches in `handle_event`. The template
cannot close over the record. It ships an id, and the module looks
the row back up, exactly as a REST endpoint would.

```html
<button type="button" phx-click="delete" phx-value-id={todo.id}>
  ×
</button>
```

```elixir
def handle_event("delete", %{"id" => id}, socket) do
  todo = Todos.get!(id)
  {:ok, _} = Todos.delete(todo)
  {:noreply, stream_delete(socket, :todos, todo)}
end
```

Socklit sends an *address* into a table of live closures. The
template holds the function. The row is already in scope.

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
    ×
  </button>
`
```

A name is stable across renders, survives a reconnect without
coordination, and is trivially serializable for logging or replay. An
address means nothing except against a currently committed handler
table. That is why this runtime needs stale-event recovery and
LiveView does not.

The ergonomic win and the recovery burden are one decision seen from
two sides.

## `assign` versus `useState`

LiveView’s function components are stateless. The moment one needs
state you move to a module. State travels through `assign`.

```elixir
def mount(_params, _session, socket) do
  {:ok, assign(socket, open: false)}
end

def handle_event("toggle", _params, socket) do
  {:noreply, assign(socket, open: not socket.assigns.open)}
end
```

```html
<button phx-click="toggle">{@open && "Close" || "Open"}</button>
```

Step one of [the todo essay](/blog/building-a-todo-app) is a function
with `useState` in it. That was the whole point.

```ts
const [open, setOpen] = useState(false);

html`
  <button type="button" @click=${() => setOpen((current) => !current)}>
    ${open ? "Close" : "Open"}
  </button>
`
```

TypeScript, the type checker, the shape you already write. Not
Elixir. Not `assign`. The ask for LiveView is learn the language
*and* learn a lifecycle-callback component model.

Rich capture is not uniquely ours. **Blazor Server** keeps C# lambdas
on the circuit. **Solara** does this in Python:

```python
@solara.component
def Page():
    clicks, set_clicks = solara.use_state(0)
    solara.Button("Click", on_click=lambda: set_clicks(clicks + 1))
```

Hooks on a server are not our idea. Solara got there first. What it
diffs is ipywidget models, not interned templates.

The honest one-line version: **Solara’s programming model on
LiveView’s wire**, in TypeScript, pointed at the DOM. Both halves are
borrowed. I would rather label it that way than dress it up.

## The substrate is not incidental

The BEAM gives LiveView cheap isolated processes, per-process garbage
collection, preemptive scheduling, and supervision trees. Node gives
this runtime none of that. Sessions share one heap and one event
loop. A single expensive render blocks every session in the process.
Fan-out is a Node problem in a way it is not a BEAM problem, and it
is not fixable here.

LiveView succeeded completely inside Elixir and barely traveled. That
is the gap this project is actually in — not a claim that we
out-engineered Phoenix.

## What they already answered

Automatic form recovery on reconnect. Hooks for client primitives.
Streams for windowed collections. `push_patch` with `handle_params`
for navigation as server state. Any of those we later build should be
designed knowing what LiveView already concluded.

What LiveView does not do, as far as we can tell, is share a render
across sessions. Each process renders alone. Cross-session subtree
sharing is the one claim no predecessor has attempted. It is
[measured](/performance) and unbuilt. Without it, this is a
nicer-typed LiveView for TypeScript. That is a respectable thing to
be.
