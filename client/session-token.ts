import { SESSION_QUERY, TAB_QUERY } from "../shared/protocol";

/** Per-tab. A new tab is a new person; refresh keeps the same one. */
const STORAGE_KEY = "socklit.session";

export function readSessionToken(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeSessionToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(STORAGE_KEY, token);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: the next connect is signed out.
  }
}

const TAB_STORAGE_KEY = "socklit.tab";

export function readTabId(): string {
  try {
    const existing = sessionStorage.getItem(TAB_STORAGE_KEY);
    if (existing) return existing;
    const minted = crypto.randomUUID();
    sessionStorage.setItem(TAB_STORAGE_KEY, minted);
    return minted;
  } catch {
    return crypto.randomUUID();
  }
}

/** Attach this tab's token so `identify` can see it. */
export function attachSessionToken(url: URL): URL {
  const token = readSessionToken();
  if (token) url.searchParams.set(SESSION_QUERY, token);
  else url.searchParams.delete(SESSION_QUERY);
  return url;
}

/** Attach this tab's durable id so `useDurable` can find its cell. */
export function attachTabId(url: URL): URL {
  url.searchParams.set(TAB_QUERY, readTabId());
  return url;
}

export function isCredentialMessage(
  message: unknown,
): message is { type: "credential"; token: string | null } {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "credential"
  );
}
