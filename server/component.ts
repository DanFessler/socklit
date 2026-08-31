import type { TemplateResult } from "lit-html";

import {
  cloneJson,
  durableCellKey,
  type DurableVault,
} from "./durable";
import { bindTag } from "./registry";

/**
 * Component scope, and state that belongs to a component rather than a session.
 *
 * lit-html gives us templates, instances and holes, but no component: when
 * `todoRow(db, todo)` returns a `TemplateResult` it is inlined into the parent's
 * hole and the runtime never learns a function boundary was crossed. That is why
 * per-row state has to be hoisted into a manually keyed map on the app instance,
 * and why anything wanting per-instance identity has to be handed a key string
 * the runtime already computed for the surrounding instance.
 *
 * `component()` makes the boundary explicit. It returns a marker rather than a
 * template, so the function runs during serialization, at the point its address
 * is known. State then hangs off that address.
 *
 * Nothing here reaches the wire. Serialization gives a component the address the
 * template it returns would have received anyway, so a subtree renders to the
 * same bytes whether it was written inline or as a component.
 */

const COMPONENT = Symbol("socklit.component");

/**
 * How many times a component may return another component before we assume a
 * cycle. Delegation is legal (`(props) => props.admin ? Admin({}) : User({})`)
 * but unbounded delegation is a bug.
 */
const MAX_DELEGATION = 10;

export type RenderOutput = TemplateResult | ComponentMarker | ProvidedValue;

/** Anything the serializer can turn into an instance without running a component. */
export type ResolvedOutput = TemplateResult | ProvidedValue;

export type ComponentFn<P> = (props: P) => RenderOutput;

/**
 * What calling a component produces: a description of work, not the work.
 *
 * Creating one is free and has no side effects, which is what lets `keyed()`
 * keep building its list eagerly while the components inside it wait for an
 * address.
 */
export type ComponentMarker = {
  readonly [COMPONENT]: true;
  readonly fn: ComponentFn<never>;
  readonly props: unknown;
  readonly name: string;
  /** Shared by every marker from one `component()` call. */
  readonly site: Site;
};

/**
 * What one `component()` call has been observed to do.
 *
 * `stateful` latches on the first hook any instance of this component ever
 * runs, and never clears. While it is false the host knows the table cannot
 * contain an entry for this component, and can skip looking — which removes an
 * address hash per instance per render, the last per-instance cost that a
 * component holding no state was still paying.
 */
type Site = { stateful: boolean };

export class ComponentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComponentError";
  }
}

const PROVIDED = Symbol("socklit.provided");

/**
 * A subtree rendered with one context value in force.
 *
 * Carries the subtree rather than wrapping it, so it adds no instance and no
 * hole: the value inside occupies the address the provider occupies, and the
 * bytes are the same as if the context were not there.
 */
export type ProvidedValue = {
  readonly [PROVIDED]: true;
  readonly context: ContextHandle;
  readonly value: unknown;
  readonly within: RenderOutput;
};

/** The provider side of a context, as the serializer sees it. */
export type ContextHandle = {
  readonly name: string;
  push(value: unknown): void;
  pop(): void;
};

export function isProvidedValue(value: unknown): value is ProvidedValue {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<ProvidedValue>)[PROVIDED] === true
  );
}

export type Context<T> = ContextHandle & {
  /** Renders `within` with this context set to `value`. */
  provide(value: T, within: RenderOutput): ProvidedValue;
};

/**
 * A value any component in a subtree can read without being handed it.
 *
 * The gap this fills is not exotic: converting the probes produced components
 * four levels deep that declared and forwarded callbacks they never used, and
 * one requirement — "at most one menu open anywhere" — that could not be
 * written at all, because a component cannot reach its siblings and a parent
 * cannot poll its descendants.
 *
 * The stack is module-scoped for the same reason `activeScope` is: a render is
 * synchronous and never interleaves with another. Serialization pushes before
 * walking a provided subtree and pops on the way out, including on failure, so
 * a render that throws cannot leave a value behind.
 */
export function createContext<T>(name: string, fallback: T): Context<T> {
  // The fallback is the floor of the stack rather than a special case at read
  // time, so `useContext` is one array access with no branch and the stack can
  // never be empty however badly a render fails.
  const stack: T[] = [fallback];

  const handle: Context<T> = {
    name,
    push: (value) => {
      stack.push(value as T);
    },
    pop: () => {
      if (stack.length > 1) stack.pop();
    },
    provide: (value, within) => ({
      [PROVIDED]: true,
      context: handle,
      value,
      within,
    }),
  };

  contextValues.set(handle, stack);
  return handle;
}

/** Every live context's stack, so `useContext` can read one back. */
const contextValues = new WeakMap<ContextHandle, unknown[]>();

/**
 * Reads the nearest provided value, or the fallback if nothing provided one.
 *
 * Retains nothing, so like `useStore` it is exempt from slot ordering and does
 * not put its component on the stateful path.
 */
export function useContext<T>(context: Context<T>): T {
  const scope = requireScope("useContext");

  const stack = contextValues.get(context);
  if (!stack) {
    throw new ComponentError(
      `<${scope.marker.name}> at ${scope.key} read "${context.name}", which is not a context made by createContext()`,
    );
  }
  return stack[stack.length - 1] as T;
}

export type ComponentOptions = {
  /** Used in diagnostics. Inferred from the function name when omitted. */
  name?: string;
};

const COMPONENT_HANDLE = Symbol("socklit.componentHandle");

/**
 * The function `component()` returns. Calling it is the library spelling.
 * `component.tag("CardRow", fn)` is what lets a template write the same
 * thing as a tag.
 */
export type ComponentFactory<P extends object = Record<string, never>> = ((
  props: P,
) => ComponentMarker) & {
  readonly [COMPONENT_HANDLE]: true;
  readonly tag: string | undefined;
};

export function component<P extends object = Record<string, never>>(
  fn: ComponentFn<P>,
  options: ComponentOptions = {},
): ComponentFactory<P> {
  return createComponent(fn, options, undefined);
}

/**
 * Claims a PascalCase catalog name so a template may write `<CardRow>`.
 * `component(fn)` stays unregistered. The string is the key, not a name
 * scraped off `fn`.
 */
export namespace component {
  export function tag<P extends object>(
    name: string,
    fn: ComponentFn<P>,
    options: ComponentOptions = {},
  ): ComponentFactory<P> {
    return createComponent(fn, options, name);
  }
}

function createComponent<P extends object>(
  fn: ComponentFn<P>,
  options: ComponentOptions,
  tag: string | undefined,
): ComponentFactory<P> {
  const name =
    options.name ?? tag ?? (fn.name.length > 0 ? fn.name : "anonymous");
  const erased = fn as ComponentFn<never>;
  const site: Site = { stateful: false };

  const handle = ((props: P): ComponentMarker => ({
    [COMPONENT]: true,
    fn: erased,
    props,
    name,
    site,
  })) as ComponentFactory<P>;

  Object.defineProperty(handle, COMPONENT_HANDLE, { value: true });
  Object.defineProperty(handle, "tag", { value: tag });
  if (tag !== undefined) bindTag(handle, tag);
  return handle;
}

export function isComponentFactory(
  value: unknown,
): value is ComponentFactory<object> {
  return (
    typeof value === "function" &&
    (value as { [COMPONENT_HANDLE]?: unknown })[COMPONENT_HANDLE] === true
  );
}

export function isComponentMarker(value: unknown): value is ComponentMarker {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<ComponentMarker>)[COMPONENT] === true
  );
}

type RefSlot = {
  kind: "ref";
  cell: { current: unknown };
};

type StateSlot = {
  kind: "state";
  value: unknown;
  /**
   * Built once and reused.
   *
   * The setter reads `value` when it is called rather than when it was made, so
   * nothing about it changes between renders. Rebuilding it each time cost more
   * than everything else `useState` does put together.
   *
   * Untyped because a setter is contravariant in its argument, so no single
   * concrete parameter type can stand in for every `T` the table holds.
   */
  setter: unknown;
};
type DurableSlot = {
  kind: "durable";
  key: string;
  setter: unknown;
};

type Slot = StateSlot | RefSlot | DurableSlot;

export type DurableShare = "tab" | "user";

export type DurableOptions = {
  /**
   * `tab` (default): this window. Reconnect and refresh keep the value.
   * A second tab has its own. `user`: every tab of this person shares it.
   */
  share?: DurableShare;
};

/**
 * How `useDurable` finds the vault and who this connection is.
 *
 * The runtime owns the vault. Identity and tab are read on each call so a
 * `grant` can move the cell without rebuilding the host.
 */
export type DurableBinding = {
  vault: DurableVault;
  identity: () => string | null;
  tab: () => string | null;
};

type Entry = {
  key: string;
  name: string;
  owner: ComponentFn<never>;
  slots: Slot[];
  disposed: boolean;
  /** The render this entry last appeared in. Drives the sweep. */
  lastSeen: number;
};

type Scope = {
  /**
   * Null until a hook asks for it.
   *
   * Most components hold no state — in the probes converted so far, ten of
   * eleven — and a table entry for one of those is an allocation and a map
   * insert bought in exchange for nothing. The entry is therefore created by
   * the first hook rather than by the render, so a component that calls none
   * costs a lookup and nothing else.
   */
  entry: Entry | null;
  host: HookHost;
  /** Kept so a hook can build the entry the render declined to. */
  key: string;
  marker: ComponentMarker;
  index: number;
};

/**
 * The component currently executing.
 *
 * A single mutable global is sound here because a render is synchronous and
 * component invocations never nest: a component returns its template before
 * serialization walks into it and finds the next marker. That also makes "a hook
 * ran after its component returned" trivially detectable.
 */
let activeScope: Scope | null = null;

/**
 * Retains component state for one session, addressed structurally.
 *
 * React had to invent retention on top of a stateless render and settled for
 * positional slots. Here retention is the premise — a session is a live app
 * instance — and instance addresses already carry identity, so a table keyed by
 * `root/h1/k:job-42` survives reorders of the list that produced it.
 */
/** A render that declared its reads and read nothing. Never written to. */
const NO_READS: ReadonlySet<unknown> = new Set();

export class HookHost {
  private readonly entries = new Map<string, Entry>();
  private readonly onInvalidate: () => void;
  private readonly durable: DurableBinding | null;
  private readonly durableUnsubs = new Set<() => void>();
  private readonly durableWatched = new Set<string>();

  /**
   * Which render we are on.
   *
   * Stamping a generation onto each entry replaces the obvious
   * `Set<string>` of addresses visited. That set cost a string hash per
   * component per render, which on a list of otherwise inert rows was most of
   * what the boundary charged for.
   */
  private generation = 0;
  private seenThisRender = 0;

  /**
   * Which shared stores the last successful render read, via `useStore`.
   *
   * Rebuilt from nothing each render and never diffed, which is the whole
   * reason this is affordable: it is a handful of identities per session, not a
   * dependency graph. `null` means the render declared nothing, which is
   * treated as "reads everything" rather than "reads nothing" — see
   * `didRead`.
   */
  private reads: ReadonlySet<unknown> | null = null;
  private pendingReads: Set<unknown> | null = null;

  /**
   * Whether this app has ever declared a read.
   *
   * Latched, because it separates two situations that look identical in a
   * single render: an app that declares nothing because it does not use
   * `useStore` at all, and an app that does use it but is currently showing a
   * screen that reads no shared state. The first has to keep updating; the
   * second is exactly the case read scoping exists to skip.
   */
  private everDeclared = false;

  /** Reused across invocations, which never overlap. */
  private scope: Scope | null = null;

  /** Set on a host that will be discarded after one render. */
  private ephemeral = false;
  /** One HTTP render. Hooks run; the host is discarded after the response. */
  private firstPaint = false;
  private readonly paintLocals = new Map<string, unknown>();

  constructor(
    onInvalidate: () => void = () => {},
    durable: DurableBinding | null = null,
  ) {
    this.onInvalidate = onInvalidate;
    this.durable = durable;
  }

  /** The vault this session writes durable cells through, if any. */
  get durableBinding(): DurableBinding | null {
    return this.durable;
  }

  /**
   * A host for a single render that nobody keeps.
   *
   * Rendering the same tree repeatedly against fresh hosts hands every
   * component its initial state every time, which looks entirely normal in the
   * output. Marking the host lets the first hook that runs say so instead.
   */
  static transient(): HookHost {
    const host = new HookHost();
    host.ephemeral = true;
    return host;
  }

  /**
   * A host for the HTTP first paint.
   *
   * Unlike `transient()`, hooks are legal: the tree may call `useState`
   * and `useDurable`. The host is discarded after the response, so those
   * cells do not outlive the GET. Tab-scoped durable has no tab and
   * returns the initial without writing the vault.
   */
  static firstPaint(durable: DurableBinding | null = null): HookHost {
    const host = new HookHost(() => {}, durable);
    host.firstPaint = true;
    return host;
  }

  get isFirstPaint(): boolean {
    return this.firstPaint;
  }

  /** One-render value for a durable name that has no tab or person on GET. */
  paintLocal<T>(name: string, initial: T | (() => T)): T {
    const existing = this.paintLocals.get(name);
    if (existing !== undefined) return existing as T;
    const value = cloneJson(resolveInitial(initial));
    this.paintLocals.set(name, value);
    return value;
  }

  /** Live component instances holding state. */
  get size(): number {
    return this.entries.size;
  }

  beginRender(): void {
    this.generation += 1;
    this.seenThisRender = 0;
    this.pendingReads = null;
  }

  /**
   * Records that the render in progress read `source`.
   *
   * Allocated lazily because most components read nothing, and collected on the
   * host rather than per component: the question this answers is whether the
   * *session* needs re-rendering, and no finer granularity exists to act on.
   */
  recordRead(source: unknown): void {
    this.everDeclared = true;

    let reads = this.pendingReads;
    if (!reads) {
      reads = new Set();
      this.pendingReads = reads;
    }
    reads.add(source);
  }

  /**
   * Whether a change to `source` can affect what this session last rendered.
   *
   * Deliberately answers "yes" when the render declared no reads at all. An app
   * that reaches its state directly instead of through `useStore` is invisible
   * here, and treating invisible as independent would silently stop updating
   * it. So the safe answer is the conservative one, and read scoping only ever
   * *removes* work from sessions that opted in by declaring what they read.
   */
  didRead(source: unknown): boolean {
    if (!this.reads) return true;
    return this.reads.has(source);
  }

  /** True when the last render declared its reads and so can be scoped. */
  get declaresReads(): boolean {
    return this.reads !== null;
  }

  /**
   * Drops state for components absent from the render that just succeeded.
   *
   * Only called after serialization commits, so a failed render leaves every
   * slot intact rather than garbage-collecting a tree that was never replaced.
   */
  commitRender(): void {
    // Only promoted on commit, so a render that threw leaves the previous read
    // set in force rather than replacing it with a partial one.
    this.reads =
      this.pendingReads ?? (this.everDeclared ? NO_READS : null);

    // Nothing left the tree, which is the overwhelmingly common case. Without
    // this the sweep walks every component on every render.
    if (this.seenThisRender === this.entries.size) return;

    for (const [key, entry] of this.entries) {
      if (entry.lastSeen === this.generation) continue;
      entry.disposed = true;
      this.entries.delete(key);
    }
  }

  disposeAll(): void {
    for (const stop of this.durableUnsubs) stop();
    this.durableUnsubs.clear();
    this.durableWatched.clear();
    for (const entry of this.entries.values()) {
      entry.disposed = true;
    }
    this.entries.clear();
  }

  invalidate(): void {
    this.onInvalidate();
  }

  /** Watch a vault key for the life of this session. */
  watchDurable(key: string): void {
    if (!this.durable || this.durableWatched.has(key)) return;
    this.durableWatched.add(key);
    const stop = this.durable.vault.watch(key, () => this.onInvalidate());
    this.durableUnsubs.add(stop);
  }

  /**
   * Runs a component at `address`, following delegation.
   *
   * Stops at anything that is not another component. A provider is handed back
   * rather than unwrapped here, because its value has to stay in force for the
   * whole subtree walk and only the serializer knows when that ends.
   */
  render(marker: ComponentMarker, address: string): ResolvedOutput {
    let current = marker;

    for (let depth = 0; depth <= MAX_DELEGATION; depth += 1) {
      // A component that returns another component is one component instance
      // per step, so each step needs its own slot table.
      const key = depth === 0 ? address : `${address}~d${depth}`;
      const output = this.runOnce(current, key);
      if (!isComponentMarker(output)) return output;
      current = output;
    }

    throw new ComponentError(
      `<${marker.name}> at ${address} delegated to another component more than ${MAX_DELEGATION} times`,
    );
  }

  private runOnce(marker: ComponentMarker, key: string): RenderOutput {
    if (activeScope) {
      throw new ComponentError(
        `<${marker.name}> at ${key} began rendering while ` +
          `<${activeScope.marker.name}> at ${activeScope.key} was still rendering`,
      );
    }

    // Looked up but not created. The lookup is what keeps "a component that
    // used to call hooks and now calls none" loud rather than silent: without
    // it that component would look to the sweep exactly like one that left the
    // tree, and its state would be dropped without complaint.
    const entry = this.claim(marker, key);

    // Captured before the render, because hooks append to `slots` as they run.
    // An absent entry means no hook has ever run here, so there is no previous
    // count to compare against.
    const expected = entry ? entry.slots.length : -1;

    let scope = this.scope;
    if (scope) {
      scope.entry = entry;
      scope.key = key;
      scope.marker = marker;
      scope.index = 0;
    } else {
      scope = { entry, host: this, key, marker, index: 0 };
      this.scope = scope;
    }

    activeScope = scope;
    let output: RenderOutput;
    try {
      output = marker.fn(marker.props as never);
    } finally {
      activeScope = null;
    }

    if (expected >= 0 && scope.index !== expected) {
      throw new ComponentError(
        `<${marker.name}> at ${key} ran ${scope.index} hooks this render and ${expected} last render. ` +
          `Hooks must run in the same order every time: do not call them conditionally, ` +
          `in a loop, or after an early return, and wrap any helper that calls hooks in component().`,
      );
    }

    return output;
  }

  /** Marks any existing entry at `key` as present in this render. */
  private claim(marker: ComponentMarker, key: string): Entry | null {
    // No instance of this component has ever run a hook, so no entry for it can
    // exist and hashing the address to discover that would be wasted work. If a
    // stale entry from a *different* component sits at this address, leaving it
    // unclaimed is exactly right: the sweep drops it, which is what should
    // happen to state whose component no longer occupies the address.
    if (!marker.site.stateful) return null;

    const existing = this.entries.get(key);
    if (!existing) return null;

    // A different component now occupies this address. Its predecessor's state
    // is not meaningful to it, so the slots start over.
    if (existing.owner !== marker.fn) {
      existing.disposed = true;
      this.entries.delete(key);
      return null;
    }

    if (existing.lastSeen === this.generation) {
      throw new ComponentError(`two components claim the address ${key}`);
    }
    existing.lastSeen = this.generation;
    this.seenThisRender += 1;
    return existing;
  }

  /**
   * Builds the table entry a hook needs, on the first hook that needs one.
   *
   * Public only because the hooks are free functions in this module rather than
   * methods. Nothing outside them should call it.
   */
  openEntry(scope: Scope): Entry {
    if (this.ephemeral) {
      throw new ComponentError(
        `<${scope.marker.name}> at ${scope.key} called a hook during a render with no session to hold its state. ` +
          `serialize() was given no HookHost, so anything this component remembers would be ` +
          `discarded and re-initialized on the next render. Pass a host that outlives the render.`,
      );
    }

    // Latches for the life of the process. From the next render on, every
    // instance of this component is looked up, which is what keeps its state
    // attached and its hook count checked.
    scope.marker.site.stateful = true;

    // A component that skipped the lookup can still land on an address another
    // component vacated. Reaching this point means the occupant was not claimed
    // this render, so it is being displaced and its setters must go inert.
    const displaced = this.entries.get(scope.key);
    if (displaced) displaced.disposed = true;

    const entry: Entry = {
      key: scope.key,
      name: scope.marker.name,
      owner: scope.marker.fn,
      slots: [],
      disposed: false,
      lastSeen: this.generation,
    };
    this.entries.set(scope.key, entry);
    this.seenThisRender += 1;
    scope.entry = entry;
    return entry;
  }
}

export type StateSetter<T> = (next: T | ((previous: T) => T)) => void;

/**
 * State owned by the server, scoped to one component instance in one session.
 *
 * Dies with the socket. Note the cost that has no analogue in React: setting it
 * schedules a render on the server, so the user sees the result one round trip
 * later. Anything that should respond to the gesture itself belongs to a
 * client-owned primitive instead.
 */
export function useState<T>(initial: T | (() => T)): [T, StateSetter<T>] {
  const scope = requireScope("useState");
  const host = scope.host;
  const entry = scope.entry ?? host.openEntry(scope);
  const index = scope.index;
  scope.index += 1;

  if (index >= entry.slots.length) {
    entry.slots.push({
      kind: "state",
      value: resolveInitial(initial),
      setter: null,
    });
  }

  const slot = entry.slots[index];
  if (!slot || slot.kind !== "state") {
    throw new ComponentError(
      `<${entry.name}> at ${entry.key} hook ${index} was not a useState last render`,
    );
  }

  if (slot.setter) {
    return [slot.value as T, slot.setter as StateSetter<T>];
  }

  const set: StateSetter<T> = (next) => {
    // The component has since been removed from the tree. React treats this as
    // a no-op rather than an error and so do we: a handler holding a stale
    // setter is a normal consequence of a row disappearing mid-flight.
    if (entry.disposed) return;

    if (activeScope) {
      throw new ComponentError(
        `<${entry.name}> at ${entry.key} set state while rendering, which would re-render forever. ` +
          `Derive the value instead, or set it from an event handler.`,
      );
    }

    const value =
      typeof next === "function"
        ? (next as (previous: T) => T)(slot.value as T)
        : next;

    if (Object.is(value, slot.value)) return;
    slot.value = value;
    host.invalidate();
  };

  slot.setter = set;
  return [slot.value as T, set];
}

const DURABLE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/**
 * State owned by this person, not this socket.
 *
 * Survives reconnect and, when the runtime was given a file, a deploy.
 * Default scope is this tab: a second window does not share the cell.
 * Pass `{ share: "user" }` when every tab of this person should.
 *
 * The name is the author's key, not a tree address, so the cell is still
 * there if the component moves. Values must be JSON.
 */
export function useDurable<T>(
  name: string,
  initial: T | (() => T),
  options: DurableOptions = {},
): [T, StateSetter<T>] {
  const scope = requireScope("useDurable");
  const host = scope.host;
  const binding = host.durableBinding;
  if (!binding) {
    throw new ComponentError(
      `<${scope.marker.name}> called useDurable("${name}") but this render ` +
        `has no durable vault. The runtime must be constructed with one.`,
    );
  }
  if (!DURABLE_NAME.test(name)) {
    throw new ComponentError(
      `useDurable("${name}") is not a usable name. Use a letter, then letters, digits, _ or -.`,
    );
  }

  const share = options.share ?? "tab";
  const identity = binding.identity();
  const tab = binding.tab();
  if (
    host.isFirstPaint &&
    ((share === "tab" && !tab) || (share === "user" && !identity))
  ) {
    const entry = scope.entry ?? host.openEntry(scope);
    const index = scope.index;
    scope.index += 1;
    if (index >= entry.slots.length) {
      entry.slots.push({
        kind: "durable",
        key: `paint:${name}`,
        setter: () => {},
      });
    }
    const slot = entry.slots[index];
    if (!slot || slot.kind !== "durable") {
      throw new ComponentError(
        `<${entry.name}> at ${entry.key} hook ${index} was not a useDurable last render`,
      );
    }
    return [host.paintLocal(name, initial), slot.setter as StateSetter<T>];
  }

  const key = durableCellKey({
    share,
    name,
    identity,
    tab,
  });

  const entry = scope.entry ?? host.openEntry(scope);
  const index = scope.index;
  scope.index += 1;

  if (index >= entry.slots.length) {
    if (!binding.vault.has(key)) {
      binding.vault.set(key, cloneJson(resolveInitial(initial)));
    }
    host.watchDurable(key);
    entry.slots.push({ kind: "durable", key, setter: null });
  }

  const slot = entry.slots[index];
  if (!slot || slot.kind !== "durable") {
    throw new ComponentError(
      `<${entry.name}> at ${entry.key} hook ${index} was not a useDurable last render`,
    );
  }

  if (slot.key !== key) {
    if (!binding.vault.has(key)) {
      binding.vault.set(key, cloneJson(resolveInitial(initial)));
    }
    host.watchDurable(key);
    slot.key = key;
    slot.setter = null;
  }

  if (slot.setter) {
    return [binding.vault.get(slot.key) as T, slot.setter as StateSetter<T>];
  }

  const set: StateSetter<T> = (next) => {
    if (entry.disposed) return;

    if (activeScope) {
      throw new ComponentError(
        `<${entry.name}> at ${entry.key} set durable state while rendering, ` +
          `which would re-render forever. Set it from an event handler.`,
      );
    }

    const previous = binding.vault.get(slot.key) as T;
    const value =
      typeof next === "function" ? (next as (previous: T) => T)(previous) : next;

    if (Object.is(value, previous)) return;
    if (JSON.stringify(value) === JSON.stringify(previous)) return;
    binding.vault.set(slot.key, value);
  };

  slot.setter = set;
  return [binding.vault.get(slot.key) as T, set];
}

/**
 * A per-instance cell that survives renders and never schedules one.
 *
 * The gap `useState` cannot fill: a value that changes *because* a render
 * happened, such as a diagnostic counter, cannot be written with a setter,
 * because setting state during a render is refused — correctly, since it would
 * render forever. Without this the only way to hold such a value is a `useState`
 * holding a mutable object that the component then mutates in place, which is
 * this hook with the intent hidden.
 *
 * Nothing reads a ref to decide what to render, or should not: a ref changing
 * produces no new frame, so a screen derived from one goes stale.
 */
export function useRef<T>(initial: T | (() => T)): { current: T } {
  const scope = requireScope("useRef");
  const entry = scope.entry ?? scope.host.openEntry(scope);
  const index = scope.index;
  scope.index += 1;

  if (index >= entry.slots.length) {
    entry.slots.push({ kind: "ref", cell: { current: resolveInitial(initial) } });
  }

  const slot = entry.slots[index];
  if (!slot || slot.kind !== "ref") {
    throw new ComponentError(
      `<${entry.name}> at ${entry.key} hook ${index} was not a useRef last render`,
    );
  }
  return slot.cell as { current: T };
}

/**
 * Reads shared, durable state, and records that this session read it.
 *
 * The returned value is the store itself — no wrapper, no proxy — but the call
 * is what tells the runtime which sessions a change to that store can possibly
 * affect. A session that reads only the invoice store is not re-rendered
 * because prices moved.
 *
 * The identity registered is the object passed, and it has to be the same object
 * the store notifies with. That is the sharp edge of this design: declare the
 * wrong thing and no change will ever match, so the session goes quietly stale
 * instead of failing. Nothing about an object proves it is the right one, so the
 * agreement is a convention that probe tests are expected to hold up — see
 * research/tech-debt.md.
 *
 * The one case that can be caught is the one worth catching, because it is both
 * the easy mistake and completely silent: declaring the *container* the stores
 * live in rather than a store.
 *
 * It retains nothing, so unlike `useState` it is exempt from slot ordering.
 */
export function useStore<T>(store: T): T {
  const scope = requireScope("useStore");

  if (isInertRecord(store)) {
    throw new ComponentError(
      `<${scope.marker.name}> called useStore() with a plain object that has no methods, ` +
        `which cannot be the thing a change is announced from. ` +
        `Pass the store itself rather than a record holding several of them: ` +
        `useStore(db.todos), not useStore(db). ` +
        `Read scoping matches on that identity, so declaring the wrong one stops this session updating.`,
    );
  }

  scope.host.recordRead(store);
  return store;
}

/**
 * A bare record of data or of other stores.
 *
 * A store is an object with behaviour — it can at minimum be read and
 * subscribed to — so a plain object with no callable property is never one.
 * Deliberately not a check for a particular method name: a market simulator
 * announcing `onTick` is as legitimate a source as a table announcing
 * `onChange`, and forcing them to agree on a name buys nothing.
 */
function isInertRecord(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;

  for (const key of Object.keys(value)) {
    if (typeof (value as Record<string, unknown>)[key] === "function") {
      return false;
    }
  }
  return true;
}

function requireScope(hook: string): Scope {
  if (!activeScope) {
    throw new ComponentError(
      `${hook}() was called outside a component. Hooks only run while a function wrapped in component() is rendering.`,
    );
  }
  return activeScope;
}

function resolveInitial<T>(initial: T | (() => T)): T {
  return typeof initial === "function" ? (initial as () => T)() : initial;
}
