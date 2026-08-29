import { html } from "lit-html";

import { component, HookHost, useState } from "../server/component";
import { diff } from "../server/diff";
import { keyed } from "../server/keyed";
import { escapeKey } from "../server/keyed";
import { AddressBook, serialize, TemplateRegistry } from "../server/serialize";
import type { RenderOutput } from "../server/component";
import type { AddressNode } from "../server/serialize";

/**
 * What the hook table's address lookup really costs, end to end.
 *
 * Measured in isolation it looks alarming: the lookup has to flatten and hash a
 * key string that serialization built by concatenation, which is 161 ns against
 * 7 ns for a string V8 has already hashed. But the same string is the wire
 * `id`, and both the diff and the JSON encoder touch it too. If they flatten it
 * anyway then the lookup is only paying for the hash, and the honest marginal
 * cost is far smaller than the isolated figure suggests.
 *
 * So this measures the whole pipeline a real render goes through — serialize,
 * diff against the previous tree, encode the operations — rather than
 * serialization alone.
 */

type Row = { id: string; label: string; value: number };

const ROWS = Number(
  process.argv.find((arg) => arg.startsWith("--rows="))?.slice(7) ?? 2000,
);
const WARMUP = 100;
const MEASURED = 300;

/** Set by the caller so both arms can be measured in one process. */
const REUSE_ADDRESSES = process.argv.includes("--reuse");

/**
 * The control: what serialization did before the book existed.
 *
 * It has to be a book that refuses to remember rather than an absent one,
 * because `serialize`'s default parameter is the process-wide book — passing
 * `undefined` opts *into* reuse. It also cannot be a fresh `AddressBook` per
 * render, which would pay to populate a map it then throws away and so measure
 * something worse than either real alternative. Building the string and
 * caching nothing is the honest baseline.
 */
class RebuiltAddresses extends AddressBook {
  override hole(parent: AddressNode, hole: number): AddressNode {
    return { id: `${parent.id}/h${hole}`, children: null };
  }

  override row(parent: AddressNode, hole: number, key: string): AddressNode {
    return {
      id: `${parent.id}/h${hole}/k:${escapeKey(key)}`,
      children: null,
    };
  }
}

function buildRows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    label: `Item ${index}`,
    value: index,
  }));
}

const rowView = (row: Row) =>
  html`<li><span>${row.label}</span><b>${row.value}</b></li>`;

const InertRow = component(function InertRow(props: { row: Row }) {
  return rowView(props.row);
});

const StatefulRow = component(function StatefulRow(props: { row: Row }) {
  useState(0);
  return rowView(props.row);
});

const view = (rows: Row[], render: (row: Row) => RenderOutput) =>
  html`<main>
    <ul>
      ${keyed(
        rows,
        (row) => row.id,
        (row) => render(row),
      )}
    </ul>
  </main>`;

type Stage = "serialize" | "andDiff" | "andEncode";

function measure(
  render: (row: Row) => RenderOutput,
  stage: Stage,
): { perRender: number; bytes: number } {
  const registry = new TemplateRegistry();
  const host = new HookHost();
  const addresses = REUSE_ADDRESSES
    ? new AddressBook()
    : new RebuiltAddresses();
  const rows = buildRows(ROWS);

  const render1 = () => serialize(view(rows, render), registry, host, addresses);

  let previous = render1().root;
  let bytes = 0;

  const pass = (index: number): void => {
    const target = rows[index % rows.length];
    if (target) target.value += 1;

    const next = render1().root;
    if (stage === "serialize") {
      previous = next;
      return;
    }

    const operations = diff(previous, next);
    previous = next;
    if (stage === "andEncode") bytes = JSON.stringify(operations).length;
  };

  for (let index = 0; index < WARMUP; index += 1) pass(index);

  const start = process.hrtime.bigint();
  for (let index = 0; index < MEASURED; index += 1) pass(index);
  const perRender = Number(process.hrtime.bigint() - start) / 1000 / MEASURED;

  return { perRender, bytes };
}

const stages: Stage[] = ["serialize", "andDiff", "andEncode"];

console.log(
  `address cost through the real pipeline, ${ROWS} rows, ` +
    `${REUSE_ADDRESSES ? "reusing address strings" : "rebuilding addresses each render"}\n`,
);
console.log("pipeline                       inert |  stateful |  Δ ns/row");
console.log("---------------------------+---------+-----------+----------");

for (const stage of stages) {
  const inert = measure((row) => InertRow({ row }), stage);
  const stateful = measure((row) => StatefulRow({ row }), stage);
  const perRow = ((stateful.perRender - inert.perRender) * 1000) / ROWS;

  const label =
    stage === "serialize"
      ? "serialize only"
      : stage === "andDiff"
        ? "+ diff"
        : "+ diff + JSON encode";

  console.log(
    `${label.padEnd(27)}|` +
      `${inert.perRender.toFixed(1).padStart(8)} |` +
      `${stateful.perRender.toFixed(1).padStart(10)} |` +
      `${perRow.toFixed(0).padStart(9)}`,
  );
}

console.log(
  "\nIf the delta shrinks as later stages are added, those stages were\n" +
    "flattening the address anyway and the lookup only pays for the hash.",
);
