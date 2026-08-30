/**
 * Measures how much of the odds probe's render work is provably redundant.
 *
 * The load harness measures what the server spends. This measures what it
 * would not have had to spend: it renders the same board for M sessions
 * through the real serializer and one shared template registry — exactly what
 * the runtime does per session — and asks which subtrees came out
 * byte-identical.
 *
 *   npx tsx scripts/odds-sharing.ts
 *   npx tsx scripts/odds-sharing.ts --sessions 8 --markets 40
 *
 * Nothing here changes the runtime. Render sharing (design-probes.md A6) is
 * deliberately not implemented; this quantifies the case for it.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HookHost } from "../server/component";
import { diff } from "../server/diff";
import { countNodes } from "../server/metrics";
import { create } from "../server/probes/odds/probe";
import type { Probe, SessionContext } from "../server/probes/types";
import { serialize, TemplateRegistry } from "../server/serialize";
import type { WireInstance, WireValue } from "../shared/protocol";

type Attribution = {
  total: number;
  shared: number;
  bytes: number;
  sharedBytes: number;
  /** Addresses of the maximal identical subtrees, largest first. */
  sharedRoots: { id: string; nodes: number; bytes: number }[];
  /** Addresses that exist in every session but differ. */
  divergent: string[];
};

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const directory = await mkdtemp(join(tmpdir(), "odds-sharing-"));

  try {
    for (const mine of [false, true]) {
      const trees = await renderSessions(
        directory,
        options.sessions,
        options.markets,
        mine,
      );
      report(mine, trees, options.sessions);
    }
    await stages(directory, options.markets);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Splits one session's cost into the stages the runtime's own metric does and
 * does not cover.
 *
 * /metrics stops its clock after diff, so the JSON encoding of the patch, the
 * socket write, and the metric's own node count all land outside it. The
 * crossover recomputation needs to know how large that remainder is.
 */
async function stages(directory: string, markets: number): Promise<void> {
  const probe = await bootProbe(directory, "stages", markets);
  const registry = new TemplateRegistry();
  const app = session(probe, "bench", false).app;

  // One host for the whole run, because one session is one host: a throwaway
  // per render would charge this stage for component state it never keeps.
  const host = new HookHost();

  const warmup = 400;
  const samples = 2000;
  for (let index = 0; index < warmup; index += 1) serialize(app(), registry, host);

  const render = time(samples, () => {
    serialize(app(), registry, host);
  });

  const before = serialize(app(), registry, host).root;
  await new Promise((resolve) => setTimeout(resolve, 60));
  const after = serialize(app(), registry, host).root;
  const operations = diff(before, after);
  const message = { type: "update", revision: 2, templates: [], operations };

  const difference = time(samples, () => {
    diff(before, after);
  });
  const encode = time(samples, () => {
    JSON.stringify(message);
  });
  const count = time(samples, () => {
    countNodes(after);
  });

  const nodes = countNodes(after);
  const bytes = JSON.stringify(message).length;
  const rows: [string, number][] = [
    ["app() + serialize()", render],
    ["diff()", difference],
    ["JSON.stringify(update)", encode],
    ["countNodes() for /metrics", count],
  ];

  const lines = [
    ``,
    `## render cost by stage (one session, ${nodes} nodes, ${bytes}-byte patch)`,
  ];
  const total = rows.reduce((sum, [, value]) => sum + value, 0);
  for (const [label, value] of rows) {
    lines.push(
      `  ${label.padEnd(28)} ${value.toFixed(2)} µs  ${(value / nodes).toFixed(4)} µs/node  ${((value / total) * 100).toFixed(0)}%`,
    );
  }
  lines.push(`  ${"total".padEnd(28)} ${total.toFixed(2)} µs  ${(total / nodes).toFixed(4)} µs/node`);

  process.stdout.write(`${lines.join("\n")}\n`);
}

/** Mean microseconds per call. */
function time(samples: number, body: () => void): number {
  const startedAt = process.hrtime.bigint();
  for (let index = 0; index < samples; index += 1) body();
  return Number(process.hrtime.bigint() - startedAt) / 1000 / samples;
}

async function bootProbe(
  directory: string,
  namespace: string,
  markets: number,
): Promise<Probe> {
  process.env["ODDS_MARKETS"] = String(markets);
  // Ticked briskly for a moment so the tape is full and the tree is the size a
  // real session would hold.
  process.env["ODDS_TICK_MS"] = "20";
  process.env["ODDS_PRINT_CHANCE"] = "0.08";

  const probe = await create({
    dataFile: (name) => join(directory, `${namespace}-${name}`),
    log: () => {},
  });

  await new Promise((resolve) => setTimeout(resolve, 600));
  return probe;
}

function session(probe: Probe, id: string, mine: boolean) {
  const context: SessionContext = {
    id,
    params: new URLSearchParams(mine ? "probe=odds&mine=1" : "probe=odds"),
    user: null,
    grant() {},
    revoke() {},
    invalidate: () => {},
  };
  return probe.createApp(context);
}

async function renderSessions(
  directory: string,
  sessions: number,
  markets: number,
  mine: boolean,
): Promise<WireInstance[]> {
  const probe = await bootProbe(directory, mine ? "mine" : "plain", markets);
  const registry = new TemplateRegistry();
  const trees: WireInstance[] = [];

  // Synchronous, so no tick can interleave: every session sees one board state.
  for (let index = 0; index < sessions; index += 1) {
    const instance = session(probe, `sess${String(index).padStart(4, "0")}`, mine);
    trees.push(serialize(instance.app(), registry).root);
  }

  return trees;
}

function report(mine: boolean, trees: WireInstance[], sessions: number): void {
  const first = trees[0];
  if (!first) throw new Error("no sessions rendered");

  const distinct = new Set(trees.map((tree) => JSON.stringify(tree)));
  const attribution = attribute(trees);

  const label = mine ? "?mine=1 (one per-user subtree)" : "default (impersonal)";
  const lines = [
    ``,
    `## ${label}`,
    `sessions rendered            ${sessions}`,
    `nodes per tree               ${attribution.total}`,
    `bytes per tree               ${attribution.bytes}`,
    `distinct whole trees         ${distinct.size}`,
    `session-level redundancy     ${percent(distinct.size === 1 ? (sessions - 1) / sessions : 0)}`,
    `subtree-level shared nodes   ${attribution.shared} of ${attribution.total} (${percent(attribution.shared / attribution.total)})`,
    `subtree-level shared bytes   ${attribution.sharedBytes} of ${attribution.bytes} (${percent(attribution.sharedBytes / attribution.bytes)})`,
    `redundant render work        ${percent(((sessions - 1) / sessions) * (attribution.shared / attribution.total))} of total`,
  ];

  lines.push(`shared subtrees (top 6)`);
  for (const entry of attribution.sharedRoots.slice(0, 6)) {
    lines.push(`  ${entry.id.padEnd(28)} ${entry.nodes} nodes, ${entry.bytes} bytes`);
  }
  if (attribution.divergent.length > 0) {
    lines.push(`divergent addresses`);
    for (const id of attribution.divergent.slice(0, 8)) {
      lines.push(`  ${id}`);
    }
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

/**
 * Splits a tree into the largest subtrees every session agreed on, and the
 * nodes above them that no session shares.
 *
 * A node counts as shared only if its whole serialized subtree matches in every
 * session, which is the same test the client would need to pass to splice one
 * patch stream into many trees.
 */
function attribute(trees: WireInstance[]): Attribution {
  const attribution: Attribution = {
    total: 0,
    shared: 0,
    bytes: 0,
    sharedBytes: 0,
    sharedRoots: [],
    divergent: [],
  };

  const first = trees[0];
  if (!first) return attribution;

  attribution.bytes = JSON.stringify(first).length;
  walk(
    trees.map((tree) => tree),
    attribution,
  );

  attribution.sharedRoots.sort((left, right) => right.nodes - left.nodes);
  return attribution;
}

function walk(nodes: WireInstance[], attribution: Attribution): void {
  const first = nodes[0];
  if (!first) return;

  const serialized = nodes.map((node) => JSON.stringify(node));
  const identical = serialized.every((text) => text === serialized[0]);
  const nodeCount = countNodes(first);

  attribution.total += nodeCount;

  if (identical) {
    attribution.shared += nodeCount;
    attribution.sharedBytes += serialized[0]?.length ?? 0;
    attribution.sharedRoots.push({
      id: first.id,
      nodes: nodeCount,
      bytes: serialized[0]?.length ?? 0,
    });
    return;
  }

  attribution.divergent.push(first.id);
  // The instance itself and every hole slot are charged to this session.
  attribution.total -= nodeCount;
  attribution.total += 1 + first.values.length;

  for (let hole = 0; hole < first.values.length; hole += 1) {
    const values = nodes.map((node) => node.values[hole] ?? null);
    descend(values, attribution);
  }
}

function descend(values: (WireValue | null)[], attribution: Attribution): void {
  const first = values[0];
  if (typeof first !== "object" || first === null) return;

  if (first.kind === "instance") {
    const children: WireInstance[] = [];
    for (const value of values) {
      if (typeof value === "object" && value !== null && value.kind === "instance") {
        children.push(value.instance);
      }
    }
    if (children.length === values.length) walk(children, attribution);
    return;
  }

  if (first.kind !== "list") return;

  const lists = values.filter(
    (value): value is Extract<WireValue, { kind: "list" }> =>
      typeof value === "object" && value !== null && value.kind === "list",
  );
  if (lists.length !== values.length) return;

  const keys = first.items.map((item) => item.key).join("\u0000");
  const alignable = lists.every(
    (list) => list.items.map((item) => item.key).join("\u0000") === keys,
  );
  if (!alignable) {
    // Key sequences differ, so no row has a counterpart to be shared with.
    for (const list of [first]) {
      for (const item of list.items) {
        attribution.total += countNodes(item.instance);
      }
    }
    return;
  }

  for (let index = 0; index < first.items.length; index += 1) {
    const row: WireInstance[] = [];
    for (const list of lists) {
      const item = list.items[index];
      if (item) row.push(item.instance);
    }
    if (row.length === lists.length) walk(row, attribution);
  }
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(2)}%`;
}

function parseOptions(argv: string[]): { sessions: number; markets: number } {
  const options = { sessions: 8, markets: 40 };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--sessions" && value !== undefined) {
      options.sessions = Number(value);
      index += 1;
    } else if (argument === "--markets" && value !== undefined) {
      options.markets = Number(value);
      index += 1;
    }
  }

  return options;
}

await main();
