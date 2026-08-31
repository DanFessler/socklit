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
 *
 * `user` is whatever `listen({ identify })` returned for this connection, or
 * `null` if the tab is signed out. `params` is still the query string — use
 * it for view config (`?mine=1`), not as a person.
 */
export type SessionHandle<User = unknown> = {
  readonly id: string;
  /** Query parameters from the WebSocket URL, for per-session configuration. */
  readonly params: URLSearchParams;
  /** Trusted identity from `identify`. `null` when unsigned or omitted. */
  readonly user: User | null;
  /**
   * Give this browser a token. The replica POSTs `/session` (HttpOnly
   * cookie on the page origin) and re-identifies this connection. `useState`
   * and islands survive. Every tab in that browser is then the same person
   * on the next connect. The `?ws=` fallback still uses sessionStorage.
   */
  grant: (token: string) => void;
  /** Drop the cookie (or the fallback token) and re-identify this connection signed out. */
  revoke: () => void;
};
