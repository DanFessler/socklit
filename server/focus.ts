/**
 * Moving focus, declaratively, from a server that cannot hold it.
 *
 * Focus is the one piece of UI state that genuinely lives in the browser and
 * cannot be mirrored: there is no correct value for the server to render,
 * because between deciding and painting the user may have moved it. So this
 * does not describe focus, it describes a *transition* — "focus should be here
 * now" — and the client applies it once.
 *
 * The alternative was an effect hook, and declining that is deliberate. An
 * effect would let a component focus something as a side effect of rendering,
 * which is the first step toward the lifecycle machinery this project exists
 * without. A hole in element position stays inside the model that already
 * works: the server puts a value in a template, the diff notices it changed,
 * and the client acts on the change.
 *
 *   html`<div role="dialog" ${focusWhen(open)}>…</div>`
 */

const FOCUS = Symbol("react-socket.focus");

export type FocusRequest = {
  readonly [FOCUS]: true;
  readonly active: boolean;
  readonly nonce: number | undefined;
};

export function isFocusRequest(value: unknown): value is FocusRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { [FOCUS]?: unknown })[FOCUS] === true
  );
}

/**
 * Focuses the element carrying this hole on the render where `active` turns
 * true.
 *
 * Pass `nonce` when focus has to land on the same element twice without
 * becoming inactive in between — a validation error re-focusing the same field,
 * for instance. Any change to it re-fires; its value is otherwise meaningless.
 */
export function focusWhen(active: boolean, nonce?: number): FocusRequest {
  return { [FOCUS]: true, active, nonce };
}
