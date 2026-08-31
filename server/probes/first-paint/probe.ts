import type { Probe, ProbeContext, SessionContext } from "../types";
import { BriefApp, type Member } from "./app";
import { createBriefStore, type BriefStore } from "./store";

/**
 * S5: does first paint need a session?
 *
 * A public brief and a signed-in chip. `curl` must see the article.
 * `?paint=shell` is today's empty document. Default is `html`: the GET
 * is the tree. Connect still sends a snapshot (replace). `html+adopt`
 * is the same HTML until the handshake exists.
 */

export type FirstPaintProbeOptions = {
  store?: BriefStore;
};

export type FirstPaintProbe = Probe & {
  /** After an HTTP paint: store moves, so the later snapshot is a different tree. */
  bumpReaders: () => void;
};

export function createFirstPaintProbe(
  options: FirstPaintProbeOptions = {},
): FirstPaintProbe {
  const store = options.store ?? createBriefStore();

  return {
    id: "first-paint",
    title: "First paint",
    forces: "S5",
    subscribe: (listener) => store.onChange(() => listener(store)),
    createApp: (session: SessionContext<Member | string | null>) => {
      const user =
        memberOf(session.user) ?? memberOf(session.params.get("user"));
      return { app: () => BriefApp({ store, user }) };
    },
    bumpReaders: () => store.addReader(),
  };
}

function memberOf(user: Member | string | null | undefined): Member | null {
  if (!user) return null;
  if (typeof user === "string") return { name: user };
  if (typeof user.name === "string" && user.name.length > 0) return user;
  return null;
}

export function create(_context: ProbeContext): Probe {
  return createFirstPaintProbe();
}
