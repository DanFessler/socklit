import { createHash } from "node:crypto";

import type { WireInstance, WireValue } from "../../../shared/protocol";

/**
 * Counts how much of a population of rendered trees is genuinely shareable.
 *
 * A6 says sessions viewing identical content should share one render. The
 * measurable form of that claim is: if every byte-identical subtree were
 * rendered once and referenced N times, how many nodes would the server
 * actually have to build? That is a DAG over canonical subtrees, and this
 * builds it.
 *
 * Instance ids are deliberately excluded from the canonical key, because a
 * shared subtree cannot carry one session's address (design-probes.md S1). The
 * census also reports how many distinct addresses each canonical subtree
 * appeared at, which is how much address rewriting sharing would actually need.
 */

type Entry = {
  templateId: number;
  localNodes: number;
  occurrences: number;
  addresses: Set<string>;
};

export type SubtreeCensus = {
  templateId: number;
  /** Distinct byte-identical variants of this template across the population. */
  variants: number;
  occurrences: number;
  localNodes: number;
  /** Variants whose occurrences all sat at the same instance address. */
  addressStableVariants: number;
};

export type ShareCensus = {
  sessions: number;
  /** Nodes the server builds today: one full tree per session. */
  naiveNodes: number;
  /** Nodes it would build if every identical subtree were built once. */
  sharedNodes: number;
  /** naiveNodes / sharedNodes: the amortization actually available. */
  nodeRatio: number;
  /** sharedNodes / (naiveNodes / sessions): session-equivalents of work. */
  renderMultiplier: number;
  nodesPerSession: number;
  distinctRoots: number;
  /** sessions / distinctRoots: amortization at the granularity cost_model.py assumes. */
  sessionRatio: number;
  distinctSubtrees: number;
  subtreeOccurrences: number;
  /** Canonical subtrees that appeared at more than one instance address. */
  addressAmbiguousSubtrees: number;
  byTemplate: SubtreeCensus[];
};

export class ShareCensusBuilder {
  private readonly entries = new Map<string, Entry>();
  private readonly roots = new Map<string, number>();
  private sessions = 0;
  private naiveNodes = 0;

  add(root: WireInstance): void {
    this.sessions += 1;
    const { key, nodes } = this.walk(root);
    this.naiveNodes += nodes;
    this.roots.set(key, (this.roots.get(key) ?? 0) + 1);
  }

  census(): ShareCensus {
    let sharedNodes = 0;
    let occurrences = 0;
    let ambiguous = 0;
    const templates = new Map<number, SubtreeCensus>();

    for (const entry of this.entries.values()) {
      sharedNodes += entry.localNodes;
      occurrences += entry.occurrences;
      if (entry.addresses.size > 1) ambiguous += 1;

      const summary = templates.get(entry.templateId) ?? {
        templateId: entry.templateId,
        variants: 0,
        occurrences: 0,
        localNodes: 0,
        addressStableVariants: 0,
      };
      summary.variants += 1;
      summary.occurrences += entry.occurrences;
      summary.localNodes += entry.localNodes;
      if (entry.addresses.size === 1) summary.addressStableVariants += 1;
      templates.set(entry.templateId, summary);
    }

    const nodesPerSession =
      this.sessions === 0 ? 0 : this.naiveNodes / this.sessions;

    return {
      sessions: this.sessions,
      naiveNodes: this.naiveNodes,
      sharedNodes,
      nodeRatio: sharedNodes === 0 ? 0 : this.naiveNodes / sharedNodes,
      renderMultiplier: nodesPerSession === 0 ? 0 : sharedNodes / nodesPerSession,
      nodesPerSession,
      distinctRoots: this.roots.size,
      sessionRatio:
        this.roots.size === 0 ? 0 : this.sessions / this.roots.size,
      distinctSubtrees: this.entries.size,
      subtreeOccurrences: occurrences,
      addressAmbiguousSubtrees: ambiguous,
      byTemplate: [...templates.values()].sort(
        (left, right) => right.occurrences - left.occurrences,
      ),
    };
  }

  private walk(instance: WireInstance): { key: string; nodes: number } {
    const parts: string[] = [`t${instance.templateId}`];
    const localNodes = 1 + instance.values.length;
    let nodes = localNodes;

    for (const value of instance.values) {
      const child = this.walkValue(value);
      parts.push(child.key);
      nodes += child.nodes;
    }

    const key = digest(parts.join("\u0001"));
    const existing = this.entries.get(key);
    if (existing) {
      existing.occurrences += 1;
      existing.addresses.add(instance.id);
    } else {
      this.entries.set(key, {
        templateId: instance.templateId,
        localNodes,
        occurrences: 1,
        addresses: new Set([instance.id]),
      });
    }

    return { key, nodes };
  }

  private walkValue(value: WireValue): { key: string; nodes: number } {
    if (value === null) return { key: "n", nodes: 0 };

    if (typeof value !== "object") {
      return { key: `p${typeof value}:${String(value)}`, nodes: 0 };
    }

    if (value.kind === "event") {
      // Every event hole is `{"kind":"event"}` on the wire; the closure behind
      // it differs per session and never crosses, so it cannot split sharing.
      return { key: "e", nodes: 0 };
    }

    if (value.kind === "focus") {
      // A focus transition is a per-browser instruction, not content, so it
      // participates in the key like any other scalar but adds no nodes.
      return { key: `f${value.active ? 1 : 0}:${value.nonce ?? ""}`, nodes: 0 };
    }

    if (value.kind === "instance") {
      const child = this.walk(value.instance);
      return { key: `i${child.key}`, nodes: child.nodes };
    }

    if (value.kind === "island") {
      return { key: `g${value.name}:${JSON.stringify(value.props)}`, nodes: 0 };
    }

    const keys: string[] = [];
    let nodes = 0;
    for (const item of value.items) {
      const child = this.walk(item.instance);
      keys.push(`${item.key}=${child.key}`);
      nodes += child.nodes;
    }
    return { key: `l${digest(keys.join("\u0002"))}`, nodes };
  }
}

function digest(input: string): string {
  return createHash("sha1").update(input).digest("base64");
}

/** The instance that hosts the keyed collection, for subtree-level reporting. */
export function findListHost(instance: WireInstance): WireInstance | undefined {
  for (const value of instance.values) {
    if (typeof value !== "object" || value === null) continue;
    if (value.kind === "list") return instance;
    if (value.kind === "instance") {
      const found = findListHost(value.instance);
      if (found) return found;
    }
  }
  return undefined;
}

/** Every value that crossed the wire, flattened, for leak checks. */
export function collectPrimitives(instance: WireInstance): string[] {
  const out: string[] = [];

  const visit = (node: WireInstance): void => {
    for (const value of node.values) {
      if (value === null) continue;
      if (typeof value !== "object") {
        out.push(String(value));
        continue;
      }
      if (value.kind === "instance") visit(value.instance);
      else if (value.kind === "list") {
        for (const item of value.items) visit(item.instance);
      }
    }
  };

  visit(instance);
  return out;
}
