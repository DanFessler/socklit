import type { WireInstance, WireValue } from "../../../shared/protocol";

/**
 * Node-by-node comparison of serialized trees from several sessions.
 *
 * The question is how much of one render could have been shared with another
 * session's render, which is finding 3 of economics.md restated as something
 * measurable. Two granularities matter and they give very different answers:
 *
 * - **local identity** — a node's own template and hole values match, with
 *   children referenced by address. This is the ceiling for sharing individual
 *   nodes, and it is what a DAG-shaped replica could deduplicate.
 * - **subtree identity** — the node's entire serialized subtree matches. This is
 *   what A6 would actually have to share, because a shared subtree is sent and
 *   patched as one unit.
 *
 * Addresses are structural, so the same address means the same place in the UI
 * in every session, and comparing by address is comparing like with like.
 */

export type TreeNode = {
  id: string;
  templateId: number;
  parentId: string | null;
  childIds: string[];
  depth: number;
  /** This node's own content; children appear only as addresses. */
  local: string;
  /** Canonical serialization of the whole subtree rooted here. */
  subtree: string;
  subtreeBytes: number;
  /** Subtree bytes minus the children's, so bytes are attributed exactly once. */
  ownBytes: number;
  instances: number;
  /**
   * Event holes in the subtree.
   *
   * They serialize identically in every session, so they never block sharing —
   * but each one needs a live closure in the acting session's handler table,
   * which a shared render would not have produced.
   */
  events: number;
};

export type TreeIndex = {
  rootId: string;
  nodes: Map<string, TreeNode>;
  instances: number;
  bytes: number;
};

export function indexTree(root: WireInstance): TreeIndex {
  const nodes = new Map<string, TreeNode>();
  const rootNode = visit(root, null, 0, nodes);
  return {
    rootId: root.id,
    nodes,
    instances: rootNode.instances,
    bytes: rootNode.subtreeBytes,
  };
}

function visit(
  instance: WireInstance,
  parentId: string | null,
  depth: number,
  nodes: Map<string, TreeNode>,
): TreeNode {
  const childIds: string[] = [];
  let instances = 1;
  let childBytes = 0;
  let events = 0;

  for (const value of instance.values) {
    if (typeof value === "object" && value !== null && value.kind === "event") {
      events += 1;
    }
    for (const child of childInstances(value)) {
      const node = visit(child, instance.id, depth + 1, nodes);
      childIds.push(node.id);
      instances += node.instances;
      childBytes += node.subtreeBytes;
      events += node.events;
    }
  }

  const subtree = JSON.stringify(instance);
  const node: TreeNode = {
    id: instance.id,
    templateId: instance.templateId,
    parentId,
    childIds,
    depth,
    local: localSignature(instance),
    subtree,
    subtreeBytes: subtree.length,
    ownBytes: subtree.length - childBytes,
    instances,
    events,
  };

  nodes.set(instance.id, node);
  return node;
}

function childInstances(value: WireValue): WireInstance[] {
  if (typeof value !== "object" || value === null) return [];
  if (value.kind === "instance") return [value.instance];
  if (value.kind === "list") return value.items.map((item) => item.instance);
  return [];
}

/**
 * A node's own content.
 *
 * Nested instances and list items collapse to their addresses and keys, so two
 * nodes match locally when their template and their own hole values match, even
 * if something deeper inside them differs. Event holes are indistinguishable on
 * the wire, so they compare equal.
 */
function localSignature(instance: WireInstance): string {
  return JSON.stringify([
    instance.templateId,
    instance.values.map((value) => {
      if (typeof value !== "object" || value === null) return value;
      if (value.kind === "event") return "@";
      if (value.kind === "focus") return { f: value.active, n: value.nonce };
      if (value.kind === "instance") return { i: value.instance.id };
      if (value.kind === "island") return { island: value.name };
      return { k: value.items.map((item) => item.key) };
    }),
  ]);
}

/** A maximal identical subtree: identical in every session, parent is not. */
export type Boundary = {
  id: string;
  depth: number;
  instances: number;
  bytes: number;
  events: number;
};

export type GroupReport = {
  label: string;
  sessions: number;
  /** Union of addresses across the group. */
  addresses: number;
  identicalNodes: number;
  nodeIdentityFraction: number;
  identicalSubtreeNodes: number;
  subtreeIdentityFraction: number;
  wholeTreeIdentical: boolean;
  boundaries: Boundary[];
  bytes: number;
  sharedBytes: number;
  sharedByteFraction: number;
  /** Addresses whose own content differs, or that some session does not have. */
  divergent: string[];
};

export function analyzeGroup(label: string, trees: TreeIndex[]): GroupReport {
  if (trees.length === 0) {
    throw new Error("analyzeGroup needs at least one tree");
  }

  const first = requireTree(trees, 0);
  const addresses = new Set<string>();
  for (const tree of trees) {
    for (const id of tree.nodes.keys()) addresses.add(id);
  }

  const localMatches = new Set<string>();
  const subtreeMatches = new Set<string>();
  const divergent: string[] = [];

  for (const address of addresses) {
    const nodes = trees.map((tree) => tree.nodes.get(address));
    if (nodes.some((node) => node === undefined)) {
      divergent.push(address);
      continue;
    }

    const present = nodes as TreeNode[];
    const reference = requireNode(present, 0);

    if (present.every((node) => node.local === reference.local)) {
      localMatches.add(address);
    } else {
      divergent.push(address);
    }

    if (present.every((node) => node.subtree === reference.subtree)) {
      subtreeMatches.add(address);
    }
  }

  const boundaries: Boundary[] = [];
  const stack = [first.rootId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) continue;

    const node = first.nodes.get(id);
    if (!node) continue;

    if (subtreeMatches.has(id)) {
      boundaries.push({
        id,
        depth: node.depth,
        instances: node.instances,
        bytes: node.subtreeBytes,
        events: node.events,
      });
      continue;
    }

    stack.push(...node.childIds);
  }

  const bytes = Math.round(
    trees.reduce((total, tree) => total + tree.bytes, 0) / trees.length,
  );
  const sharedBytes = boundaries.reduce(
    (total, boundary) => total + boundary.bytes,
    0,
  );

  return {
    label,
    sessions: trees.length,
    addresses: addresses.size,
    identicalNodes: localMatches.size,
    nodeIdentityFraction: fraction(localMatches.size, addresses.size),
    identicalSubtreeNodes: subtreeMatches.size,
    subtreeIdentityFraction: fraction(subtreeMatches.size, addresses.size),
    wholeTreeIdentical: subtreeMatches.has(first.rootId),
    boundaries: boundaries.sort((left, right) => right.bytes - left.bytes),
    bytes,
    sharedBytes,
    sharedByteFraction: fraction(sharedBytes, bytes),
    divergent: divergent.sort(),
  };
}

export type PopulationReport = {
  sessions: number;
  /** Renders that would actually have to happen under session-level sharing. */
  distinctTrees: number;
  sessionAmortization: number;
  totalInstances: number;
  /** Renders that would have to happen if any identical node could be shared. */
  distinctInstances: number;
  instanceDedupFraction: number;
  totalBytes: number;
  distinctBytes: number;
  byteDedupFraction: number;
};

/**
 * The whole population at once, including sessions on different routes.
 *
 * `sessionAmortization` is the amortization ratio from the decision rule in
 * economics.md — concurrent sessions over distinct rendered views — measured
 * rather than assumed. `instanceDedupFraction` is the same quantity if the unit
 * of sharing were the node instead of the session.
 */
export function analyzePopulation(trees: TreeIndex[]): PopulationReport {
  const distinctTrees = new Set<string>();
  const distinctNodes = new Map<string, number>();
  let totalInstances = 0;
  let totalBytes = 0;

  for (const tree of trees) {
    const root = tree.nodes.get(tree.rootId);
    if (root) distinctTrees.add(root.subtree);
    totalInstances += tree.instances;
    totalBytes += tree.bytes;

    for (const node of tree.nodes.values()) {
      const key = `${node.id}\u0000${node.local}`;
      if (!distinctNodes.has(key)) distinctNodes.set(key, node.ownBytes);
    }
  }

  const distinctBytes = [...distinctNodes.values()].reduce(
    (total, bytes) => total + bytes,
    0,
  );

  return {
    sessions: trees.length,
    distinctTrees: distinctTrees.size,
    sessionAmortization:
      distinctTrees.size === 0
        ? 0
        : round(trees.length / distinctTrees.size, 2),
    totalInstances,
    distinctInstances: distinctNodes.size,
    instanceDedupFraction: fraction(
      totalInstances - distinctNodes.size,
      totalInstances,
    ),
    totalBytes,
    distinctBytes,
    byteDedupFraction: fraction(totalBytes - distinctBytes, totalBytes),
  };
}

function requireTree(trees: TreeIndex[], index: number): TreeIndex {
  const tree = trees[index];
  if (!tree) throw new Error(`missing tree at ${index}`);
  return tree;
}

function requireNode(nodes: TreeNode[], index: number): TreeNode {
  const node = nodes[index];
  if (!node) throw new Error(`missing node at ${index}`);
  return node;
}

function fraction(part: number, whole: number): number {
  if (whole === 0) return 0;
  return round(part / whole, 4);
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
