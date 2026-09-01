import { listen, sessionToken, type IdentifyRequest } from "socklit/server";

import { App, store, tickets } from "./app";
import { cursors } from "./cursors";
import type { Person } from "./tickets";

function identify(request: IdentifyRequest): Person | null {
  const token = sessionToken(request);
  if (!token) return null;
  return tickets.get(token) ?? null;
}

await listen({
  port: 8788,
  identify,
  createApp: (session) => () => App({ user: session.user }),
  subscribe: (onChange) => {
    const stopStore = store.onChange(() => onChange(store));
    const stopCursors = cursors.onChange(() => onChange(cursors));
    return () => {
      stopStore();
      stopCursors();
    };
  },
  publicDir: "dist",
});
