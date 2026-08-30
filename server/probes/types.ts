import type { RenderOutput } from "../component";
import type { SessionHandle } from "../session";

/**
 * Notified when shared state changes.
 *
 * `source` identifies *what* changed, so the runtime can skip sessions that did
 * not read it. A store that passes nothing is saying "I cannot tell you", and
 * every session is re-rendered — which is what the runtime did unconditionally
 * before, so omitting it is safe rather than merely permitted.
 */
export type ChangeListener = (source?: unknown) => void;

/**
 * What a probe receives once, at boot.
 *
 * Anything expensive or durable — loading a store, seeding data, starting a
 * simulator — belongs here rather than in `createApp`, which runs per session.
 */
export type ProbeContext = {
  /** Namespaced path under `data/`, so probes cannot collide on disk. */
  dataFile: (name: string) => string;
  log: (message: string) => void;
};

/**
 * What a probe receives per connection.
 *
 * `invalidate` re-renders only this session, which is how per-session state
 * (a route, an open menu, a selected tab) becomes visible without disturbing
 * anyone else. Probes that hold no per-session state never need to call it.
 */
export type SessionContext<User = unknown> = SessionHandle<User> & {
  invalidate: () => void;
};

export type ProbeInstance = {
  /** Renders this session's view. Called on every invalidation. */
  app: () => RenderOutput;
  /** Released when the connection closes. */
  dispose?: () => void;
};

export type Probe = {
  /** Stable identifier, used in `?probe=` and as the data namespace. */
  id: string;
  title: string;
  /** Which entries in research/design-probes.md this probe exists to answer. */
  forces: string;
  /**
   * Registers a callback invoked when shared, authoritative state changes.
   * Returns an unsubscribe function. Probes with no shared state may omit it.
   */
  subscribe?: (listener: ChangeListener) => () => void;
  createApp: (session: SessionContext) => ProbeInstance;
};

export type ProbeModule = {
  create: (context: ProbeContext) => Promise<Probe> | Probe;
};
