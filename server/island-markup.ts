import type { TemplateResult } from "lit-html";

import {
  ComponentError,
  isComponentMarker,
  type ComponentMarker,
} from "./component";
import {
  IslandError,
  isIslandHandle,
  mount,
  slot,
  type IslandHandle,
  type IslandEvents,
} from "./island";
import { lookupComponent } from "./registry";

/**
 * Compiles authoring tags in a server template: `<mount>` / `<slot>` into
 * markers, and a registered PascalCase tag into a component call.
 *
 * The tags are authoring, not HTML. They must not reach the replica — the
 * interned strings the client caches are the rewritten ones. The compile
 * plan is keyed by the original `TemplateStringsArray`, so interning still
 * comes from the language: one call site, one rewritten strings array,
 * one template id. Lookup of a component tag happens at apply time, not
 * compile time, so `component.tag()` is not a compile-time directive.
 */

const HTML_RESULT = 1;

const plans = new WeakMap<TemplateStringsArray, Plan | null>();

const HAS_TAG =
  /<(?:mount(?=[\s./>])|slot(?=[\s/>])|\/mount>|\/slot>|[A-Z][A-Za-z0-9]*(?=[\s./>])|\/[A-Z][A-Za-z0-9]*>)/;

type PassHole = { kind: "hole"; index: number };

type IslandHole = {
  kind: "island";
  island: number;
  props: { name: string; index: number }[];
  slotted?: { strings: TemplateStringsArray; holes: number[] };
};

type ComponentHole = {
  kind: "component";
  name: string;
  props: { name: string; index: number }[];
};

type Planned = PassHole | IslandHole | ComponentHole;

type Plan = {
  strings: TemplateStringsArray;
  holes: Planned[];
};

export function compileIslandMarkup(
  result: TemplateResult,
): TemplateResult | ComponentMarker {
  const type = (result as unknown as { _$litType$: unknown })["_$litType$"];
  if (type !== HTML_RESULT) return result;

  const cached = plans.get(result.strings);
  if (cached === null) return result;
  const plan = cached ?? compile(result.strings, result.values.length);
  if (plan === null) {
    plans.set(result.strings, null);
    return result;
  }
  plans.set(result.strings, plan);

  const values = plan.holes.map((hole) => applyHole(hole, result.values));
  if (
    values.length === 1 &&
    plan.strings.every((chunk) => chunk.trim() === "")
  ) {
    const only = values[0];
    if (isComponentMarker(only)) return only;
  }

  return {
    _$litType$: HTML_RESULT,
    strings: plan.strings,
    values,
  } as TemplateResult;
}

function applyHole(hole: Planned, values: readonly unknown[]): unknown {
  if (hole.kind === "hole") return values[hole.index];
  if (hole.kind === "component") return applyComponent(hole, values);

  const handle = values[hole.island];
  if (!isIslandHandle(handle)) {
    throw new IslandError(
      "<mount> expected Island={...} to be a defineIsland() handle",
    );
  }

  const props: Record<string, unknown> = {};
  for (const binding of hole.props) {
    props[binding.name] = values[binding.index];
  }

  const well =
    hole.slotted === undefined
      ? undefined
      : slot({
          _$litType$: HTML_RESULT,
          strings: hole.slotted.strings,
          values: hole.slotted.holes.map((index) => values[index]),
        } as TemplateResult);

  return mount(
    handle as IslandHandle<Record<string, never>, IslandEvents>,
    props as never,
    well,
  );
}

function applyComponent(
  hole: ComponentHole,
  values: readonly unknown[],
): ComponentMarker {
  const factory = lookupComponent(hole.name);
  if (!factory) {
    throw new ComponentError(
      `<${hole.name}> is not registered. Define it with component.tag("${hole.name}", fn), or call ${hole.name}({ … })`,
    );
  }

  const props: Record<string, unknown> = {};
  for (const binding of hole.props) {
    props[binding.name] = values[binding.index];
  }
  return factory(props);
}

function compile(
  strings: TemplateStringsArray,
  holeCount: number,
): Plan | null {
  if (!strings.some((chunk) => HAS_TAG.test(chunk))) return null;

  const scan = new Scan(strings, holeCount);
  const out: string[] = [""];
  const holes: Planned[] = [];

  const emitText = (text: string): void => {
    out[out.length - 1] += text;
  };
  const emitHole = (hole: Planned): void => {
    holes.push(hole);
    out.push("");
  };

  while (!scan.done()) {
    if (scan.atHole()) {
      emitHole({ kind: "hole", index: scan.consumeHole() });
      continue;
    }

    const rest = scan.rest();
    const next = nextTag(rest);
    if (next === null) {
      emitText(rest);
      scan.advance(rest.length);
      continue;
    }

    emitText(rest.slice(0, next.index));
    scan.advance(next.index);

    if (next.kind === "open-mount") {
      emitHole(readMount(scan));
      continue;
    }
    if (next.kind === "open-component") {
      emitHole(readComponent(scan));
      continue;
    }

    if (next.kind === "open-slot") {
      throw new IslandError(
        "<slot> must be the only child of <mount>, not a hole of its own",
      );
    }
    if (next.kind === "close-component") {
      throw new ComponentError(`unexpected </${next.name}>`);
    }
    throw new IslandError(
      `unexpected ${next.kind === "close-mount" ? "</mount>" : "</slot>"}`,
    );
  }

  if (out.length !== holes.length + 1) {
    throw new IslandError("internal error compiling <mount>");
  }

  return { strings: freezeStrings(out), holes };
}

function readMount(scan: Scan): IslandHole {
  scan.expect(/<mount(?=[\s./>])/);
  let island: number | undefined;
  const props: { name: string; index: number }[] = [];

  for (;;) {
    scan.skipSpaces();
    if (scan.tryConsume(/\/>/)) {
      return finishMount(island, props);
    }
    if (scan.tryConsume(/>/)) break;

    if (scan.atHole()) {
      throw new IslandError(
        "<mount> bindings must be named (.value=${...}, not a bare hole)",
      );
    }
    if (scan.done()) {
      throw new IslandError("unclosed <mount>");
    }

    const binding = scan.match(/^[.?@]?([A-Za-z][A-Za-z0-9]*)\s*=\s*/);
    if (!binding) {
      throw new IslandError(
        `<mount> expected a binding, />, or > (got ${JSON.stringify(scan.rest().slice(0, 24))})`,
      );
    }
    const name = binding[1];
    if (!name) {
      throw new IslandError("<mount> binding is missing a name");
    }
    if (!scan.atHole()) {
      throw new IslandError(
        `<mount> ${name} must be a hole (\${...}), not a static attribute`,
      );
    }
    const index = scan.consumeHole();
    if (name === "Island") {
      if (island !== undefined) {
        throw new IslandError("<mount> has more than one Island");
      }
      island = index;
      continue;
    }
    if (props.some((entry) => entry.name === name)) {
      throw new IslandError(`<mount> binds ${name} more than once`);
    }
    props.push({ name, index });
  }

  const slotted = readMountBody(scan);
  return finishMount(island, props, slotted);
}

function readMountBody(
  scan: Scan,
): { strings: TemplateStringsArray; holes: number[] } | undefined {
  for (;;) {
    scan.skipSpaces();
    if (scan.tryConsume(/<\/mount>/)) return undefined;
    if (scan.tryConsume(/<slot(?=[\s/>])/)) break;
    if (scan.atHole()) {
      throw new IslandError(
        "children of <mount> must be wrapped in <slot>, not passed as a hole",
      );
    }
    if (scan.done()) throw new IslandError("unclosed <mount>");
    throw new IslandError(
      "children of <mount> must be a <slot>, not markup or text",
    );
  }

  scan.skipSpaces();
  if (!scan.tryConsume(/>/)) {
    throw new IslandError("<slot> does not take attributes");
  }

  const slotted = readSlot(scan);
  scan.skipSpaces();
  if (!scan.tryConsume(/<\/mount>/)) {
    throw new IslandError("<mount> must close after </slot>");
  }
  return slotted;
}

function readSlot(scan: Scan): { strings: TemplateStringsArray; holes: number[] } {
  const parts: string[] = [""];
  const holes: number[] = [];

  while (!scan.done()) {
    if (scan.atHole()) {
      holes.push(scan.consumeHole());
      parts.push("");
      continue;
    }

    const rest = scan.rest();
    const close = rest.search(/<\/slot>/);
    const nested = rest.search(/<slot(?=[\s/>])/);
    if (nested !== -1 && (close === -1 || nested < close)) {
      throw new IslandError("<slot> cannot nest");
    }
    if (close === -1) {
      parts[parts.length - 1] += rest;
      scan.advance(rest.length);
      continue;
    }

    parts[parts.length - 1] += rest.slice(0, close);
    scan.advance(close);
    scan.expect(/<\/slot>/);
    return { strings: freezeStrings(parts), holes };
  }

  throw new IslandError("unclosed <slot>");
}

function finishMount(
  island: number | undefined,
  props: { name: string; index: number }[],
  slotted?: { strings: TemplateStringsArray; holes: number[] },
): IslandHole {
  if (island === undefined) {
    throw new IslandError("<mount> requires Island=${...}");
  }
  return slotted === undefined
    ? { kind: "island", island, props }
    : { kind: "island", island, props, slotted };
}

function readComponent(scan: Scan): ComponentHole {
  const open = scan.match(/^<([A-Z][A-Za-z0-9]*)(?=[\s./>])/);
  const name = open?.[1];
  if (!name) {
    throw new ComponentError("expected a component tag");
  }

  const props: { name: string; index: number }[] = [];

  for (;;) {
    scan.skipSpaces();
    if (scan.tryConsume(/\/>/)) {
      return { kind: "component", name, props };
    }
    if (scan.tryConsume(/>/)) break;

    if (scan.atHole()) {
      throw new ComponentError(
        `<${name}> bindings must be named (.value=\${...}, not a bare hole)`,
      );
    }
    if (scan.done()) {
      throw new ComponentError(`unclosed <${name}>`);
    }

    const binding = scan.match(/^[.?@]?([A-Za-z][A-Za-z0-9]*)\s*=\s*/);
    if (!binding) {
      throw new ComponentError(
        `<${name}> expected a binding, />, or > (got ${JSON.stringify(scan.rest().slice(0, 24))})`,
      );
    }
    const prop = binding[1];
    if (!prop) {
      throw new ComponentError(`<${name}> binding is missing a name`);
    }
    if (!scan.atHole()) {
      throw new ComponentError(
        `<${name}> ${prop} must be a hole (\${...}), not a static attribute`,
      );
    }
    const index = scan.consumeHole();
    if (props.some((entry) => entry.name === prop)) {
      throw new ComponentError(`<${name}> binds ${prop} more than once`);
    }
    props.push({ name: prop, index });
  }

  scan.skipSpaces();
  if (scan.tryConsume(new RegExp(`^</${name}>`))) {
    return { kind: "component", name, props };
  }
  if (scan.done()) {
    throw new ComponentError(`unclosed <${name}>`);
  }
  throw new ComponentError(
    `<${name}> does not take children — pass props, or call ${name}({ … })`,
  );
}

type TagKind =
  | "open-mount"
  | "open-slot"
  | "close-mount"
  | "close-slot"
  | "open-component"
  | "close-component";

type NextTag = {
  index: number;
  kind: TagKind;
  name?: string;
};

function nextTag(text: string): NextTag | null {
  const hits: NextTag[] = [];
  const mountOpen = text.search(/<mount(?=[\s./>])/);
  const slotOpen = text.search(/<slot(?=[\s/>])/);
  const mountClose = text.search(/<\/mount>/);
  const slotClose = text.search(/<\/slot>/);
  const componentOpen = text.search(/<[A-Z][A-Za-z0-9]*(?=[\s./>])/);
  const componentClose = text.search(/<\/[A-Z][A-Za-z0-9]*>/);
  if (mountOpen !== -1) hits.push({ index: mountOpen, kind: "open-mount" });
  if (slotOpen !== -1) hits.push({ index: slotOpen, kind: "open-slot" });
  if (mountClose !== -1) hits.push({ index: mountClose, kind: "close-mount" });
  if (slotClose !== -1) hits.push({ index: slotClose, kind: "close-slot" });
  if (componentOpen !== -1) {
    const name = text.slice(componentOpen + 1).match(/^[A-Z][A-Za-z0-9]*/)?.[0];
    hits.push({ index: componentOpen, kind: "open-component", name });
  }
  if (componentClose !== -1) {
    const name = text.slice(componentClose + 2).match(/^[A-Z][A-Za-z0-9]*/)?.[0];
    hits.push({ index: componentClose, kind: "close-component", name });
  }
  if (hits.length === 0) return null;
  hits.sort((left, right) => left.index - right.index);
  return hits[0] ?? null;
}

function freezeStrings(parts: string[]): TemplateStringsArray {
  const strings = parts as unknown as TemplateStringsArray;
  Object.defineProperty(strings, "raw", { value: Object.freeze([...parts]) });
  Object.freeze(strings);
  return strings;
}

class Scan {
  s = 0;
  c = 0;

  constructor(
    private readonly strings: TemplateStringsArray,
    private readonly holeCount: number,
  ) {}

  done(): boolean {
    return this.s >= this.strings.length;
  }

  atHole(): boolean {
    const chunk = this.strings[this.s];
    return (
      this.s < this.holeCount &&
      chunk !== undefined &&
      this.c >= chunk.length
    );
  }

  rest(): string {
    return this.strings[this.s]?.slice(this.c) ?? "";
  }

  advance(count: number): void {
    this.c += count;
    const chunk = this.strings[this.s];
    if (chunk !== undefined && this.c >= chunk.length && this.s >= this.holeCount) {
      this.s += 1;
      this.c = 0;
    }
  }

  consumeHole(): number {
    if (!this.atHole()) {
      throw new IslandError("expected a template hole");
    }
    const index = this.s;
    this.s += 1;
    this.c = 0;
    return index;
  }

  skipSpaces(): void {
    const match = this.rest().match(/^\s+/);
    if (match?.[0]) this.advance(match[0].length);
  }

  tryConsume(pattern: RegExp): boolean {
    const match = this.rest().match(pattern);
    if (!match || match.index !== 0) return false;
    this.advance(match[0].length);
    return true;
  }

  expect(pattern: RegExp): void {
    if (!this.tryConsume(pattern)) {
      throw new IslandError(`expected ${pattern} (got ${JSON.stringify(this.rest().slice(0, 24))})`);
    }
  }

  match(pattern: RegExp): RegExpMatchArray | null {
    const match = this.rest().match(pattern);
    if (!match || match.index !== 0) return null;
    this.advance(match[0].length);
    return match;
  }
}
