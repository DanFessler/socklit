/**
 * What a handler learns about the session that acted.
 *
 * This exists as its own type so `serialize.ts` can type the handler signature
 * without importing the probe surface, and so the thing handed to a handler at
 * dispatch is narrower than the thing an app is built with: a handler has no
 * business re-rendering the session that called it, because whatever it changed
 * will do that on its own.
 *
 * The point of passing this at dispatch rather than capturing it at render is
 * sharing. A closure that reads the acting account from its arguments is
 * identical for every viewer and can be rendered once; a closure that captured
 * the account can only ever serve one.
 */
export type SessionHandle = {
  readonly id: string;
  /** Query parameters from the WebSocket URL, for per-session configuration. */
  readonly params: URLSearchParams;
};
