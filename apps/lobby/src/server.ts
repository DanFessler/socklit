import { listen, sessionToken, type IdentifyRequest } from "socklit/server";

import { App, store, tickets } from "./app";
import type { Person } from "./people";

function identify(request: IdentifyRequest): Person | null {
  const token = sessionToken(request);
  if (!token) return null;
  return tickets.get(token) ?? null;
}

await listen({
  port: 8788,
  identify,
  createApp: (session) => () => App({ user: session.user }),
  subscribe: (onChange) => store.onChange(() => onChange(store)),
  publicDir: "dist",
});
