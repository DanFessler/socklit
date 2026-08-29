/**
 * Measurements for research/probes/ledger.md.
 *
 *     npx tsx server/probes/ledger/bench.ts
 *
 * Runs the real `Runtime`, the real `serialize`, the real `diff` and the real
 * `RuntimeMetrics` against a temporary data file, so the numbers reported here
 * are the numbers `/metrics` would report for the same traffic. It exists
 * because `/metrics` is cumulative per process: to see how render cost scales
 * with document size, each size needs its own counter.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PatchOperation } from "../../../shared/protocol";
import { countNodes, RuntimeMetrics } from "../../metrics";
import { Runtime } from "../../runtime";
import {
  changedPaths,
  HarnessSocket,
  operationBytes,
  rowInstance,
} from "./harness";
import { createLedgerApp } from "./ledger-app";
import { deriveLedger } from "./ledger-model";
import { createLedgerStore, type LedgerStore } from "./ledger-store";

const SIZES = [10, 100, 500];
const EDIT_SAMPLES = 40;

type SizeResult = {
  lineCount: number;
  nodes: number;
  snapshotBytes: number;
  templateBytes: number;
  editOperations: number;
  editBytes: number;
  setOperations: number;
  listOperations: number;
  replaceOperations: number;
  changedViewPaths: number;
  microsecondsPerNode: number;
  microsecondsPerEdit: number;
  nodesPerRender: number;
  operationsPerEdit: number;
  bytesPerEdit: number;
  wastedNodeFraction: number;
};

async function main(): Promise<void> {
  const results: SizeResult[] = [];

  for (const lineCount of SIZES) {
    results.push(await measure(lineCount));
  }

  await reportFanOutDetail();
  report(results);
}

async function measure(lineCount: number): Promise<SizeResult> {
  const directory = await mkdtemp(join(tmpdir(), "ledger-bench-"));

  try {
    const store = await createLedgerStore(join(directory, "ledger.json"));
    await store.seedLines(lineCount);

    const metrics = new RuntimeMetrics();
    const app = createLedgerApp(store);
    const runtime = new Runtime({
      createApp: () => ({ app }),
      subscribe: (listener) => store.onChange(listener),
      metrics,
    });

    const socket = new HarnessSocket();
    runtime.attach(socket.asWebSocket());
    await runtime.whenIdle();

    const firstRender = metrics.snapshot();
    const snapshot = socket.find("snapshot");
    if (snapshot?.type !== "snapshot") throw new Error("expected a snapshot");
    const nodes = countNodes(snapshot.root);

    // One edit, measured on the wire and in the derivation.
    socket.take();
    const before = deriveLedger(store.read());
    const target = firstLine(store);
    await store.setLineQuantity(target.id, target.quantity + 3);
    await runtime.whenIdle();
    const after = deriveLedger(store.read());

    const update = socket.last("update");
    if (update?.type !== "update") throw new Error("expected an update");

    // Prove the row exists at a stable address before and after the edit.
    rowInstance(snapshot.root, target.id);

    const beforeLoop = metrics.snapshot();
    let loopOperations = 0;
    let loopBytes = 0;

    for (let sample = 0; sample < EDIT_SAMPLES; sample += 1) {
      const line = firstLine(store);
      socket.take();
      await store.setLineQuantity(line.id, 1 + (sample % 9));
      await runtime.whenIdle();

      const patch = socket.last("update");
      if (patch?.type !== "update") continue;
      loopOperations += patch.operations.length;
      loopBytes += operationBytes(patch.operations);
    }

    const afterLoop = metrics.snapshot();

    const loopRenders = afterLoop.renders - beforeLoop.renders;
    const loopNodes = afterLoop.nodes - beforeLoop.nodes;
    const loopMicroseconds =
      afterLoop.renderMicroseconds - beforeLoop.renderMicroseconds;
    const nodesPerRender = loopRenders === 0 ? 0 : loopNodes / loopRenders;
    const operationsPerEdit =
      loopRenders === 0 ? 0 : loopOperations / loopRenders;

    runtime.dispose();

    return {
      lineCount,
      nodes,
      snapshotBytes: firstRender.sentBytes.snapshots,
      templateBytes: firstRender.sentBytes.templates,
      editOperations: update.operations.length,
      editBytes: operationBytes(update.operations),
      setOperations: countOp(update.operations, "set"),
      listOperations: countOp(update.operations, "list"),
      replaceOperations: countOp(update.operations, "replace"),
      changedViewPaths: changedPaths(before, after).length,
      microsecondsPerNode: loopNodes === 0 ? 0 : loopMicroseconds / loopNodes,
      microsecondsPerEdit:
        loopRenders === 0 ? 0 : loopMicroseconds / loopRenders,
      nodesPerRender,
      operationsPerEdit,
      bytesPerEdit: loopRenders === 0 ? 0 : loopBytes / loopRenders,
      // Every node is rebuilt and re-diffed; only the ones that produced an
      // operation did any work the browser needed.
      wastedNodeFraction:
        nodesPerRender === 0 ? 0 : 1 - operationsPerEdit / nodesPerRender,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * The fan-out enumeration, at the seeded six-line size where it can be read.
 *
 * Prints every derived path a single quantity change moves, grouped by the
 * view it belongs to. Each group is one thing an SPA would have to invalidate.
 */
async function reportFanOutDetail(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "ledger-fanout-"));

  try {
    const store = await createLedgerStore(join(directory, "ledger.json"));
    const before = deriveLedger(store.read());
    const target = firstLine(store);
    await store.setLineQuantity(target.id, target.quantity + 3);
    const after = deriveLedger(store.read());

    const groups = new Map<string, string[]>();
    for (const path of changedPaths(before, after)) {
      const group = path.split(/[.[]/)[0] ?? path;
      const list = groups.get(group) ?? [];
      list.push(path);
      groups.set(group, list);
    }

    console.log("## Fan-out of one quantity edit (6-line seeded document)\n");
    console.log(`Lines in document: ${before.lines.length}`);
    console.log(`Changed derived leaf values: ${changedPaths(before, after).length}\n`);
    console.log("| Derived view | Leaf values moved |");
    console.log("| --- | --- |");
    for (const [group, paths] of [...groups].sort()) {
      console.log(`| ${group} | ${paths.length} |`);
    }
    console.log("");
    for (const [group, paths] of [...groups].sort()) {
      console.log(`- **${group}**: ${paths.join(", ")}`);
    }
    console.log("");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function report(results: readonly SizeResult[]): void {
  console.log("## Render cost by document size\n");
  console.log(
    "| lines | nodes | snapshot bytes | template bytes | us/node | us/render | ops/edit | bytes/edit | bytes/op | wasted nodes |",
  );
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");

  for (const result of results) {
    console.log(
      `| ${result.lineCount} | ${result.nodes} | ${result.snapshotBytes} | ` +
        `${result.templateBytes} | ${result.microsecondsPerNode.toFixed(3)} | ` +
        `${result.microsecondsPerEdit.toFixed(0)} | ` +
        `${result.operationsPerEdit.toFixed(1)} | ` +
        `${result.bytesPerEdit.toFixed(0)} | ` +
        `${(result.bytesPerEdit / Math.max(1, result.operationsPerEdit)).toFixed(1)} | ` +
        `${(result.wastedNodeFraction * 100).toFixed(2)}% |`,
    );
  }

  console.log("\n## Patch composition per edit\n");
  console.log("| lines | set | list | replace | changed derived leaves |");
  console.log("| --- | --- | --- | --- | --- |");
  for (const result of results) {
    console.log(
      `| ${result.lineCount} | ${result.setOperations} | ` +
        `${result.listOperations} | ${result.replaceOperations} | ` +
        `${result.changedViewPaths} |`,
    );
  }
  console.log("");
}

function firstLine(store: LedgerStore): { id: string; quantity: number } {
  const line = store.read().draft.lines[0];
  if (!line) throw new Error("expected at least one line");
  return { id: line.id, quantity: line.quantity };
}

function countOp(
  operations: readonly PatchOperation[],
  op: PatchOperation["op"],
): number {
  return operations.filter((operation) => operation.op === op).length;
}

await main();
