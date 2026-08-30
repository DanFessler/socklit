import { listen, sessionToken, type IdentifyRequest } from "socklit/server";

import { App, store, tickets } from "./app";
import type { Member } from "./staff";

function identify(request: IdentifyRequest): Member | null {
  const token = sessionToken(request);
  if (!token) return null;
  return tickets.get(token) ?? null;
}

await listen({
  identify,
  createApp: (session) => () => App({ store, user: session.user }),
  subscribe: (onChange) => store.onChange(() => onChange(store)),
  publicDir: "dist",
});
