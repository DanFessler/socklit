import { html } from "lit-html";

import type { ChangePayload, SubmitPayload } from "../../shared/protocol";
import { component, useStore, type RenderOutput } from "../component";
import { keyed } from "../keyed";
import type { Database, Todo } from "../store";

/**
 * The whole application.
 *
 * Note what is absent: no fetch, no endpoint, no request or response type, no
 * client cache, no subscription wiring. Handlers call the database directly
 * because they run where the database lives, and the runtime replicates
 * whatever this function returns.
 *
 * Components are defined at module scope and take everything they need as
 * props, which is the convention the rest of the design leans on: a component
 * that reaches an enclosing session variable is the one mistake the runtime
 * cannot detect, so nothing here is allowed to have one in scope.
 */
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

export function createTodoApp(db: Database): () => RenderOutput {
  return () => TodoApp({ db });
}
