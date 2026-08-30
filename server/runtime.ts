import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";

import {
  MAX_MESSAGE_BYTES,
  parseClientMessage,
  type EventMessage,
  type IslandMessage,
  type ServerErrorCode,
  type ServerMessage,
  type WireInstance,
  type WireTemplate,
} from "../shared/protocol";
import { HookHost, type RenderOutput } from "./component";
import { diff } from "./diff";
import { RuntimeMetrics } from "./metrics";
import type {
  ChangeListener,
  ProbeInstance,
  SessionContext,
} from "./probes/types";
import {
  AddressBook,
  serialize,
  TemplateRegistry,
  type HandlerTable,
  type IslandHandlerTable,
  type ServerHandler,
} from "./serialize";

const MAX_INVALID_MESSAGES = 10;

export type App = () => RenderOutput;

/**
 * Builds one application instance per connection.
 *
 * A session is a live app instance, so anything a single user can diverge on —
 * their route, an open menu, their identity — belongs to state created here
 * rather than shared across sessions.
 */
export type AppFactory = (session: SessionContext) => ProbeInstance;

export type RuntimeOptions = {
  createApp: AppFactory;
  /** Registers a callback invoked after shared authoritative state changes. */
  subscribe?: (listener: ChangeListener) => () => void;
  onLog?: (message: string) => void;
  metrics?: RuntimeMetrics;
};

type Session = {
  id: string;
  socket: WebSocket;
  instance: ProbeInstance;
  /** Passed to handlers at dispatch so shared closures can resolve the actor. */
  context: SessionContext;
  /** Component state for this connection, addressed structurally. */
  hooks: HookHost;
  revision: number;
  committedRoot: WireInstance | null;
  handlers: HandlerTable;
  islandHandlers: IslandHandlerTable;
  sentTemplateIds: Set<number>;
  queue: Promise<void>;
  invalidMessages: number;
  closed: boolean;
};

/**
 * Owns one live application instance per connection.
 *
 * A session is the retained server-side execution of the app: it holds the
 * committed instance tree, the closures reachable from that tree, and the
 * revision the browser is known to be showing.
 */
export class Runtime {
  private readonly createApp: AppFactory;
  private readonly registry = new TemplateRegistry();

  // Shared across sessions deliberately: two sessions on the same screen
  // produce the same addresses, so they should share the strings too.
  private readonly addresses = new AddressBook();
  private readonly sessions = new Set<Session>();
  private readonly log: (message: string) => void;
  private readonly unsubscribe: () => void;
  private readonly metrics: RuntimeMetrics | undefined;

  private readonly pendingSessions = new Set<Session>();
  private pendingFlush: Promise<void> | null = null;

  constructor(options: RuntimeOptions) {
    this.createApp = options.createApp;
    this.log = options.onLog ?? (() => {});
    this.metrics = options.metrics;
    this.unsubscribe =
      options.subscribe?.((source) => this.invalidate(source)) ?? (() => {});
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  attach(
    socket: WebSocket,
    params = new URLSearchParams(),
    user: unknown | null = null,
  ): void {
    const id = randomUUID().slice(0, 8);

    // The host needs the session to invalidate it, and the session needs the
    // host to render. One of them has to be late.
    let self: Session | null = null;
    const hooks = new HookHost(() => {
      if (self) this.invalidateSession(self);
    });

    const context: SessionContext = {
      id,
      params,
      user,
      grant: (token: string) => {
        if (self) this.send(self, { type: "credential", token });
      },
      revoke: () => {
        if (self) this.send(self, { type: "credential", token: null });
      },
      invalidate: () => {
        if (self) this.invalidateSession(self);
      },
    };

    const session: Session = {
      id,
      socket,
      instance: { app: () => { throw new Error("app not initialized"); } },
      context,
      hooks,
      revision: 0,
      committedRoot: null,
      handlers: new Map(),
      islandHandlers: new Map(),
      sentTemplateIds: new Set(),
      queue: Promise.resolve(),
      invalidMessages: 0,
      closed: false,
    };
    self = session;

    try {
      session.instance = this.createApp(context);
    } catch (error) {
      this.log(`session ${id} failed to start: ${describeError(error)}`);
      socket.close(1011, "session could not be created");
      return;
    }

    this.sessions.add(session);
    this.metrics?.setSessions(this.sessions.size);
    this.log(`session ${session.id} connected (${this.sessions.size} live)`);

    socket.on("message", (data: unknown, isBinary: boolean) => {
      if (isBinary) {
        this.rejectMessage(session, "binary frames are not supported");
        return;
      }
      this.enqueue(session, () => this.receive(session, String(data)));
    });

    socket.on("close", () => {
      session.closed = true;
      this.sessions.delete(session);
      this.pendingSessions.delete(session);
      this.metrics?.setSessions(this.sessions.size);

      session.hooks.disposeAll();

      try {
        session.instance.dispose?.();
      } catch (error) {
        this.log(`session ${session.id} dispose failed: ${describeError(error)}`);
      }

      this.log(`session ${session.id} closed (${this.sessions.size} live)`);
    });

    socket.on("error", (error: Error) => {
      this.log(`session ${session.id} socket error: ${error.message}`);
    });

    this.enqueue(session, async () => {
      this.renderSession(session);
    });
  }

  dispose(): void {
    this.unsubscribe();
    for (const session of this.sessions) {
      session.socket.close(1001, "server shutting down");
    }
    this.sessions.clear();
  }

  /** Resolves once every render scheduled by a state change has been sent. */
  async flush(): Promise<void> {
    while (this.pendingFlush) {
      await this.pendingFlush;
    }
  }

  /**
   * Resolves once no session has queued work left and no render is pending.
   *
   * Each pass waits on the current tail of every session queue; if a task
   * appended more work while we waited, the tails changed and we go again.
   */
  async whenIdle(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const sessions = [...this.sessions];
      const tails = sessions.map((session) => session.queue);

      await Promise.all(tails);
      await this.flush();

      const unchanged = sessions.every(
        (session, index) => session.queue === tails[index],
      );
      if (unchanged && !this.pendingFlush) return;
    }
  }

  /**
   * Shared state changed. Only sessions that read it need a new frame.
   *
   * A store that identifies itself lets every session which declared its reads
   * through `useStore` be skipped outright — no render, no diff, no bytes. A
   * store that does not, or a session that never declared anything, falls back
   * to the old behaviour of re-rendering unconditionally, so this is a pure
   * subtraction from the work the runtime used to do.
   */
  private invalidate(source?: unknown): void {
    for (const session of this.sessions) {
      if (source !== undefined && !session.hooks.didRead(source)) {
        this.metrics?.recordScopedSkip();
        continue;
      }
      this.pendingSessions.add(session);
    }
    this.scheduleFlush();
  }

  /**
   * One session's own state changed.
   *
   * This is the only granularity of partial invalidation the runtime has. It is
   * enough for per-session UI state but not for the subtree-level dependency
   * tracking question raised in research/design-probes.md (S3).
   */
  private invalidateSession(session: Session): void {
    if (session.closed) return;
    this.pendingSessions.add(session);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.pendingFlush) return;

    this.pendingFlush = Promise.resolve().then(() => {
      this.pendingFlush = null;
      const batch = [...this.pendingSessions];
      this.pendingSessions.clear();
      for (const session of batch) {
        this.renderSession(session);
      }
    });
  }

  /** Per-session serialization: one event is fully handled before the next. */
  private enqueue(session: Session, task: () => Promise<void>): void {
    session.queue = session.queue.then(task, task).catch((error: unknown) => {
      // Reaching here means the runtime itself misbehaved: handler and render
      // failures are reported to the browser rather than thrown.
      console.error(`[runtime] session ${session.id} task failed`, error);
      this.log(`session ${session.id} task failed: ${describeError(error)}`);
    });
  }

  private async receive(session: Session, raw: string): Promise<void> {
    if (session.closed) return;

    if (raw.length > MAX_MESSAGE_BYTES) {
      this.rejectMessage(session, "message too large");
      return;
    }

    const message = parseClientMessage(raw);
    if (!message) {
      this.rejectMessage(session, "malformed event message");
      return;
    }

    if (message.type === "island") {
      await this.handleIsland(session, message);
      return;
    }

    await this.handleEvent(session, message);
  }

  private async handleEvent(
    session: Session,
    message: EventMessage,
  ): Promise<void> {
    // Validity is decided by the address, not by a session-wide revision. The
    // address names the exact node and hole the user acted on, so an unrelated
    // change elsewhere on the screen does not invalidate it. A global revision
    // check would: any two interactions performed within one round trip carry
    // the same revision, so the second would be discarded even though the user
    // acted on something that is still there.
    //
    // Nothing is lost by dropping it. Ordering is already guaranteed by the
    // socket and by the per-session queue, so events are applied in the order
    // they were performed, and handlers close over freshly read state.
    const handler = this.lookupHandler(session, message);

    if (!handler) {
      this.metrics?.recordEvent(false);

      // The target is genuinely gone. If the browser was describing an earlier
      // revision, it acted on a control that has since disappeared and only
      // needs to resync. If it claims to be current, the address was never
      // real and the message is treated as hostile.
      if (message.revision !== session.revision) {
        this.sendError(
          session,
          "stale_event",
          `event target ${message.instanceId}#${message.hole} no longer exists at revision ${session.revision}`,
          true,
        );
        this.sendSnapshot(session);
        return;
      }

      this.rejectMessage(
        session,
        `no handler at ${message.instanceId}#${message.hole}`,
      );
      return;
    }

    this.metrics?.recordEvent(true);

    try {
      await handler(message.payload, session.context);
    } catch (error) {
      this.log(
        `session ${session.id} handler failed: ${describeError(error)}`,
      );
      this.sendError(session, "handler_failed", describeError(error), true);
    }

    // Renders triggered by this handler are flushed before the next event so
    // the browser's revision cannot fall behind mid-queue.
    await this.flush();
  }

  private lookupHandler(
    session: Session,
    message: EventMessage,
  ): ServerHandler | undefined {
    return session.handlers.get(message.instanceId)?.get(message.hole);
  }

  private async handleIsland(
    session: Session,
    message: IslandMessage,
  ): Promise<void> {
    const handler = session.islandHandlers
      .get(message.instanceId)
      ?.get(message.hole)
      ?.get(message.event);

    if (!handler) {
      this.metrics?.recordEvent(false);

      if (message.revision !== session.revision) {
        this.sendError(
          session,
          "stale_event",
          `island ${message.instanceId}#${message.hole}.${message.event} no longer exists at revision ${session.revision}`,
          true,
        );
        this.sendSnapshot(session);
        return;
      }

      this.rejectMessage(
        session,
        `no island handler at ${message.instanceId}#${message.hole}.${message.event}`,
      );
      return;
    }

    this.metrics?.recordEvent(true);

    try {
      await handler(...message.args, session.context);
    } catch (error) {
      this.log(
        `session ${session.id} island handler failed: ${describeError(error)}`,
      );
      this.sendError(session, "handler_failed", describeError(error), true);
    }

    await this.flush();
  }

  /**
   * Renders the app for one session and sends the smallest correct update.
   *
   * Nothing is committed until serialization succeeds, so a failing render
   * leaves the browser on the last known-good tree.
   */
  private renderSession(session: Session): void {
    if (session.closed) return;

    let root: WireInstance;
    let handlers: HandlerTable;
    let islandHandlers: IslandHandlerTable;
    let usedTemplateIds: Set<number>;
    const startedAt = process.hrtime.bigint();

    try {
      ({ root, handlers, islandHandlers, usedTemplateIds } = serialize(
        session.instance.app(),
        this.registry,
        session.hooks,
        this.addresses,
      ));
    } catch (error) {
      this.log(`session ${session.id} render failed: ${describeError(error)}`);
      this.sendError(session, "render_failed", describeError(error), true);
      return;
    }

    const templates = this.pendingTemplates(session, usedTemplateIds);
    const previous = session.committedRoot;

    if (!previous) {
      this.recordRender(root, startedAt, false);
      session.committedRoot = root;
      session.handlers = handlers;
      session.islandHandlers = islandHandlers;
      session.revision += 1;
      this.markTemplatesSent(session, templates);

      if (templates.length > 0) {
        this.send(session, { type: "templates", templates });
      }
      this.send(session, {
        type: "snapshot",
        revision: session.revision,
        root,
      });
      return;
    }

    const operations = diff(previous, root);
    const quiet = operations.length === 0 && templates.length === 0;
    this.recordRender(root, startedAt, quiet);

    // Closures are recommitted even when the wire stays quiet: the tree is
    // identical, but the handlers now close over freshly read state.
    session.committedRoot = root;
    session.handlers = handlers;
    session.islandHandlers = islandHandlers;

    if (quiet) return;

    session.revision += 1;
    this.markTemplatesSent(session, templates);
    this.send(session, {
      type: "update",
      revision: session.revision,
      templates,
      operations,
    });
  }

  /** Timed across app(), serialize(), and diff() — the full server-side cost. */
  private recordRender(
    root: WireInstance,
    startedAt: bigint,
    quiet: boolean,
  ): void {
    if (!this.metrics) return;

    const nanoseconds = Number(process.hrtime.bigint() - startedAt);
    this.metrics.recordRender({
      root,
      microseconds: nanoseconds / 1000,
      quiet,
    });
  }

  /** Re-sends the committed tree, for example after rejecting a stale event. */
  private sendSnapshot(session: Session): void {
    if (!session.committedRoot) return;
    this.send(session, {
      type: "snapshot",
      revision: session.revision,
      root: session.committedRoot,
    });
  }

  private pendingTemplates(
    session: Session,
    usedTemplateIds: Set<number>,
  ): WireTemplate[] {
    const templates: WireTemplate[] = [];
    for (const id of usedTemplateIds) {
      if (!session.sentTemplateIds.has(id)) {
        templates.push(this.registry.definition(id));
      }
    }
    return templates;
  }

  private markTemplatesSent(
    session: Session,
    templates: WireTemplate[],
  ): void {
    for (const template of templates) {
      session.sentTemplateIds.add(template.id);
    }
  }

  private rejectMessage(session: Session, reason: string): void {
    session.invalidMessages += 1;
    this.log(`session ${session.id} rejected message: ${reason}`);
    this.sendError(session, "bad_event", reason, true);

    if (session.invalidMessages >= MAX_INVALID_MESSAGES) {
      this.log(`session ${session.id} closed after repeated invalid messages`);
      session.socket.close(1008, "too many invalid messages");
    }
  }

  private sendError(
    session: Session,
    code: ServerErrorCode,
    message: string,
    recoverable: boolean,
  ): void {
    this.send(session, { type: "error", code, message, recoverable });
  }

  private send(session: Session, message: ServerMessage): void {
    if (session.closed || session.socket.readyState !== session.socket.OPEN) {
      return;
    }

    const encoded = JSON.stringify(message);
    session.socket.send(encoded);

    if (message.type === "templates") {
      this.metrics?.recordSend("templates", encoded.length);
    } else if (message.type === "snapshot") {
      this.metrics?.recordSend("snapshots", encoded.length);
    } else if (message.type === "update") {
      this.metrics?.recordSend("updates", encoded.length);
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
