import type { TemplateResult } from "lit-html";

import type {
  EventPayload,
  WireInstance,
  WireListItem,
  WireTemplate,
  WireValue,
} from "../shared/protocol";
import {
  HookHost,
  isComponentMarker,
  isProvidedValue,
  type RenderOutput,
} from "./component";
import { isFocusRequest } from "./focus";
import { escapeKey, isKeyedList } from "./keyed";
import type { SessionHandle } from "./session";

/**
 * A server closure reachable from the browser through its template hole.
 *
 * The session is an argument rather than something the closure captured, which
 * is what lets one closure serve every viewer of the same subtree. Handlers
 * that do not need it may ignore it; TypeScript allows a shorter function
 * wherever a longer signature is expected, so `() => …` remains valid.
 */
export type ServerHandler = (
  payload: EventPayload,
  session: SessionHandle,
) => unknown;

/** instance address -> hole index -> closure */
export type HandlerTable = Map<string, Map<number, ServerHandler>>;

export type SerializeResult = {
  root: WireInstance;
  handlers: HandlerTable;
  usedTemplateIds: Set<number>;
};

export const ROOT_INSTANCE_ID = "root";

export class SerializeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SerializeError";
  }
}

const HTML_RESULT = 1;

/**
 * Interns every `html` tag site in the process.
 *
 * lit-html hands back the same `strings` array for a given tag site on every
 * evaluation, so array identity is a reliable template key.
 */
export class TemplateRegistry {
  private readonly ids = new WeakMap<TemplateStringsArray, number>();
  private readonly definitions = new Map<number, WireTemplate>();
  private nextId = 1;

  intern(strings: TemplateStringsArray): number {
    const existing = this.ids.get(strings);
    if (existing !== undefined) return existing;

    const id = this.nextId++;
    this.ids.set(strings, id);
    this.definitions.set(id, { id, strings: normalize(strings) });
    return id;
  }

  definition(id: number): WireTemplate {
    const definition = this.definitions.get(id);
    if (!definition) {
      throw new SerializeError(`unknown template id: ${id}`);
    }
    return definition;
  }

  get size(): number {
    return this.definitions.size;
  }
}

/** Elements whose content is rendered exactly as written. */
const WHITESPACE_SENSITIVE = /<\s*(pre|textarea)\b/i;

/**
 * Where in the markup the scanner currently is.
 *
 * Carried across the template's static strings rather than reset at each one,
 * because a hole can sit inside an attribute value: in `class="${x} tall"` the
 * string before the hole ends mid-quote and the one after it begins there.
 */
type Position = { inTag: boolean; quote: string | null };

/**
 * Strips source indentation out of the text that reaches the browser.
 *
 * A template's static strings are shipped verbatim, so the newlines and leading
 * spaces an author uses to lay out a template literal are real bytes on the
 * wire. That makes source formatting part of the protocol: hoisting a template
 * out of a closure re-indents it, and so does running a formatter over the
 * file, with nothing in the type checker or the test suite to notice.
 *
 * Each run of a newline and the indentation after it collapses to a single
 * space rather than to nothing, because whitespace *between* inline elements is
 * meaningful — `<span>a</span> <span>b</span>` reads "a b" — while the number of
 * spaces never is.
 *
 * Two places are left exactly as written: a template containing an element that
 * renders its content literally, and the inside of a quoted attribute value,
 * where a newline is part of the value rather than layout.
 */
function normalize(strings: TemplateStringsArray): string[] {
  const source = Array.from(strings);
  if (source.some((part) => WHITESPACE_SENSITIVE.test(part))) return source;

  const at: Position = { inTag: false, quote: null };
  return source.map((part) => collapseLayout(part, at));
}

function collapseLayout(part: string, at: Position): string {
  let out = "";

  for (let index = 0; index < part.length; index += 1) {
    const character = part[index] as string;

    if (at.quote !== null) {
      if (character === at.quote) at.quote = null;
      out += character;
      continue;
    }

    // Quotes only delimit anything inside a tag. Outside one they are prose,
    // and an apostrophe in "don't" must not be read as opening a value.
    if (at.inTag && (character === '"' || character === "'")) {
      at.quote = character;
      out += character;
      continue;
    }

    if (character === "<") at.inTag = true;
    else if (character === ">") at.inTag = false;

    if (character === "\n") {
      let next = index + 1;
      while (next < part.length) {
        const ahead = part[next];
        if (ahead !== " " && ahead !== "\t") break;
        next += 1;
      }
      out += " ";
      index = next - 1;
      continue;
    }

    out += character;
  }

  return out;
}

/**
 * One instance address, kept so the next render can reuse the string.
 *
 * Addresses are built by concatenation, which leaves V8 an unflattened rope:
 * cheap to make and expensive for everything downstream, because the hook
 * table, the diff and the JSON encoder each have to flatten and hash it again.
 * Handing back the *same* string object every render makes all three cheap —
 * the hash is cached on the string, and the diff's `previous.id === next.id`
 * becomes a pointer comparison.
 */
export type AddressNode = {
  readonly id: string;
  /** Built on first descent, because most instances are leaves. */
  children: Map<string | number, AddressNode> | null;
};

/**
 * The addresses one runtime has handed out, shaped like the instance tree.
 *
 * Shared across sessions on purpose: two sessions rendering the same screen
 * produce the same addresses, so they should share the strings too.
 *
 * Nothing is pruned as it goes. A tree whose shape churns — a filtered list, a
 * paged table — would otherwise need a mark-and-sweep over every node on every
 * render, which costs more than it saves. Instead the whole book is dropped
 * once it grows past a bound and rebuilt from scratch, which is amortized to
 * nothing and cannot be wrong: a missing entry only means one string gets
 * rebuilt.
 */
export class AddressBook {
  private static readonly LIMIT = 100_000;

  private root: AddressNode = { id: ROOT_INSTANCE_ID, children: null };
  private size = 1;

  begin(): AddressNode {
    if (this.size > AddressBook.LIMIT) {
      this.root = { id: ROOT_INSTANCE_ID, children: null };
      this.size = 1;
    }
    return this.root;
  }

  /** The nested-instance address `${parent}/h${hole}`. */
  hole(parent: AddressNode, hole: number): AddressNode {
    return this.descend(parent, hole, () => `${parent.id}/h${hole}`);
  }

  /** The keyed-row address `${parent}/h${hole}/k:${key}`, one level per part. */
  row(parent: AddressNode, hole: number, key: string): AddressNode {
    const list = this.descend(parent, hole, () => `${parent.id}/h${hole}`);
    return this.descend(list, key, () => `${list.id}/k:${escapeKey(key)}`);
  }

  private descend(
    parent: AddressNode,
    part: string | number,
    build: () => string,
  ): AddressNode {
    let children = parent.children;
    if (!children) {
      children = new Map();
      parent.children = children;
    }

    const existing = children.get(part);
    if (existing) return existing;

    const node: AddressNode = { id: build(), children: null };
    children.set(part, node);
    this.size += 1;
    return node;
  }
}

/**
 * The book used when a caller does not supply one.
 *
 * Process-wide, which is safe because an address is a pure function of its path
 * through the tree: whoever asks for `root/h1/k:a` gets the same string, and
 * sharing it is the whole point. A book built per call would be worse than no
 * book at all, since every node would be allocated and immediately discarded.
 */
const sharedAddresses = new AddressBook();

/** Everything one walk of the tree needs to carry. */
type Walk = {
  registry: TemplateRegistry;
  handlers: HandlerTable;
  usedTemplateIds: Set<number>;
  host: HookHost;
  addresses: AddressBook;
};

/**
 * Walks a render result into transport-safe values, assigning each template
 * instance a deterministic address and pulling every closure into a handler
 * table. Functions are replaced by `{ kind: "event" }`; no closure is ever
 * serialized.
 *
 * This is also where components run. A component occupies the address the
 * template it returns would have occupied anyway, so a subtree serializes to
 * identical bytes whether it was written inline or extracted into a component.
 *
 * One call is one render: state for components that did not appear is released
 * on the way out, and only if the walk succeeded.
 *
 * Passing no `host` gives the render a throwaway one, which is right for
 * one-shot serialization of a tree that holds no state. If a component in that
 * tree does call a hook, the throwaway host refuses: silently handing back
 * initial state on every render produces a plausible-looking tree and a wrong
 * measurement, which is worse than an error.
 */
export function serialize(
  result: RenderOutput,
  registry: TemplateRegistry,
  host: HookHost = HookHost.transient(),
  addresses: AddressBook = sharedAddresses,
): SerializeResult {
  const walk: Walk = {
    registry,
    handlers: new Map(),
    usedTemplateIds: new Set(),
    host,
    addresses,
  };

  host.beginRender();
  const root = serializeRenderable(result, addresses.begin(), walk);
  host.commitRender();

  return {
    root,
    handlers: walk.handlers,
    usedTemplateIds: walk.usedTemplateIds,
  };
}

/**
 * Turns anything a component may hand back into one instance.
 *
 * A provider is unwrapped here rather than where components run, because its
 * value has to stay in force for the whole subtree beneath it — and this is the
 * only place that knows when that subtree is finished. It adds no instance of
 * its own: what it wraps takes the address it would have had anyway.
 */
function serializeRenderable(
  value: RenderOutput,
  at: AddressNode,
  walk: Walk,
): WireInstance {
  if (isProvidedValue(value)) {
    value.context.push(value.value);
    try {
      return serializeRenderable(value.within, at, walk);
    } finally {
      value.context.pop();
    }
  }

  const resolved = isComponentMarker(value)
    ? walk.host.render(value, at.id)
    : value;

  // A component is free to return a provider, which is the natural way to write
  // one, so resolving may have produced something that needs unwrapping.
  if (isProvidedValue(resolved)) {
    return serializeRenderable(resolved, at, walk);
  }
  return serializeInstance(resolved, at, walk);
}

function serializeInstance(
  result: TemplateResult,
  at: AddressNode,
  walk: Walk,
): WireInstance {
  assertHtmlResult(result, at.id);

  const templateId = walk.registry.intern(result.strings);
  walk.usedTemplateIds.add(templateId);

  const values = result.values.map((value, hole) =>
    serializeValue(value, at, hole, walk),
  );

  return { id: at.id, templateId, values };
}

function serializeValue(
  value: unknown,
  at: AddressNode,
  hole: number,
  walk: Walk,
): WireValue {
  if (typeof value === "function") {
    let holes = walk.handlers.get(at.id);
    if (!holes) {
      holes = new Map();
      walk.handlers.set(at.id, holes);
    }
    holes.set(hole, value as ServerHandler);
    return { kind: "event" };
  }

  if (
    isComponentMarker(value) ||
    isProvidedValue(value) ||
    isTemplateResult(value)
  ) {
    return {
      kind: "instance",
      instance: serializeRenderable(value, walk.addresses.hole(at, hole), walk),
    };
  }

  if (isKeyedList(value)) {
    const items: WireListItem[] = value.items.map((item) => ({
      key: item.key,
      instance: serializeRenderable(
        item.result,
        walk.addresses.row(at, hole, item.key),
        walk,
      ),
    }));
    return { kind: "list", items };
  }

  if (isFocusRequest(value)) {
    return value.nonce === undefined
      ? { kind: "focus", active: value.active }
      : { kind: "focus", active: value.active, nonce: value.nonce };
  }

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new SerializeError(
        `${describeHole(at.id, hole)} is a non-finite number, which cannot be replicated`,
      );
    }
    return value;
  }

  if (Array.isArray(value)) {
    throw new SerializeError(
      `${describeHole(at.id, hole)} is a plain array. Wrap collections in keyed(items, keyOf, render) so rows keep a stable identity.`,
    );
  }

  if (isDirectiveResult(value)) {
    throw new SerializeError(
      `${describeHole(at.id, hole)} is a lit-html directive. Directives run in the browser and are not part of the replicated vocabulary.`,
    );
  }

  throw new SerializeError(
    `${describeHole(at.id, hole)} is an unsupported ${typeof value} value. Supported holes: string, number, boolean, null, nested html template, component, keyed list, event handler, focusWhen() request.`,
  );
}

export function isTemplateResult(value: unknown): value is TemplateResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "_$litType$" in (value as Record<string, unknown>) &&
    Array.isArray((value as TemplateResult).strings) &&
    Array.isArray((value as TemplateResult).values)
  );
}

function isDirectiveResult(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "_$litDirective$" in (value as Record<string, unknown>)
  );
}

function assertHtmlResult(result: TemplateResult, id: string): void {
  const type = (result as unknown as Record<string, unknown>)["_$litType$"];
  if (type !== HTML_RESULT) {
    throw new SerializeError(
      `instance ${id} is not an html template result. svg and mathml templates are outside the v0 vocabulary.`,
    );
  }
  if (result.values.length !== result.strings.length - 1) {
    throw new SerializeError(`instance ${id} has a malformed template result`);
  }
}

function describeHole(instanceId: string, hole: number): string {
  return `hole ${hole} of instance ${instanceId}`;
}
