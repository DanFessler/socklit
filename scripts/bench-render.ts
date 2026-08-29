/**
 * Measures microseconds per node for render plus diff.
 *
 * research/economics.md assumes 0.8 µs/node and its sensitivity analysis says
 * that if a real implementation lands at 5 µs, every server-driven CPU figure
 * grows sixfold and the fan-out crossover moves from ~500 sessions per distinct
 * view to past most real audiences. It calls this "the single most important
 * number to measure once the prototype runs".
 *
 * This benchmark isolates the server-side cost path — app(), serialize(), diff()
 * — with no sockets, no client, and no I/O, after warm-up. Run it on an
 * otherwise idle machine; concurrent load makes the numbers meaningless.
 *
 *   npm run bench
 *   npm run bench -- 2000
 */

import { html, type TemplateResult } from "lit-html";

import {
  component,
  HookHost,
  useState,
  type RenderOutput,
} from "../server/component";
import { diff } from "../server/diff";
import { keyed } from "../server/keyed";
import { countNodes } from "../server/metrics";
import { serialize, TemplateRegistry } from "../server/serialize";

type Row = { id: string; label: string; value: number; flag: boolean };

const SIZES = [10, 50, 200, 500, 1000, 2000];
const WARMUP_ITERATIONS = 200;
const MEASURED_ITERATIONS = 500;

function buildRows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    label: `Item number ${index}`,
    value: index * 3,
    flag: index % 3 === 0,
  }));
}

function rowView(row: Row): TemplateResult {
  return html`
    <li class="row">
      <span class="label">${row.label}</span>
      <b class="value">${row.value}</b>
      <input type="checkbox" .checked=${row.flag} @change=${() => undefined} />
    </li>
  `;
}

/**
 * Parameterized by how a row is produced so the variants below differ only in
 * the component boundary. Every variant reuses the same two `html` tag sites,
 * so template interning, tree shape and diff work are identical and the delta
 * is the boundary alone.
 */
function viewWith(
  rows: Row[],
  tick: number,
  renderRow: (row: Row) => RenderOutput,
): TemplateResult {
  return html`
    <main>
      <header>
        <h1>Benchmark</h1>
        <p>tick ${tick}</p>
      </header>
      <ul>
        ${keyed(
          rows,
          (row) => row.id,
          (row) => renderRow(row),
        )}
      </ul>
      <footer><span>${rows.length} rows</span></footer>
    </main>
  `;
}

function view(rows: Row[], tick: number): TemplateResult {
  return viewWith(rows, tick, rowView);
}

/** The same row, behind a component boundary. */
const RowComponent = component(function BenchRow(props: { row: Row }) {
  return rowView(props.row);
});

/** The same row again, now retaining one piece of state per instance. */
const StatefulRowComponent = component(function BenchStatefulRow(props: {
  row: Row;
}) {
  useState(0);
  return rowView(props.row);
});

type Result = {
  rows: number;
  nodes: number;
  onePerRender: number;
  onePerNode: number;
  allPerRender: number;
  allPerNode: number;
  operationsForOne: number;
};

function measure(rows: number): Result {
  const registry = new TemplateRegistry();
  const data = buildRows(rows);

  let previous = serialize(view(data, 0), registry).root;
  const nodes = countNodes(previous);

  // Warm up the JIT and the template cache before anything is recorded.
  for (let index = 0; index < WARMUP_ITERATIONS; index += 1) {
    const next = serialize(view(data, index), registry).root;
    diff(previous, next);
    previous = next;
  }

  // The common case: one value changed, everything else identical.
  const oneStart = process.hrtime.bigint();
  let operationsForOne = 0;
  for (let index = 0; index < MEASURED_ITERATIONS; index += 1) {
    const target = data[index % data.length];
    if (target) target.value += 1;

    const next = serialize(view(data, index), registry).root;
    operationsForOne = diff(previous, next).length;
    previous = next;
  }
  const oneTotal = Number(process.hrtime.bigint() - oneStart) / 1000;

  // The worst case: every row changed.
  const allStart = process.hrtime.bigint();
  for (let index = 0; index < MEASURED_ITERATIONS; index += 1) {
    for (const row of data) row.value += 1;

    const next = serialize(view(data, index), registry).root;
    diff(previous, next);
    previous = next;
  }
  const allTotal = Number(process.hrtime.bigint() - allStart) / 1000;

  return {
    rows,
    nodes,
    onePerRender: oneTotal / MEASURED_ITERATIONS,
    onePerNode: oneTotal / MEASURED_ITERATIONS / nodes,
    allPerRender: allTotal / MEASURED_ITERATIONS,
    allPerNode: allTotal / MEASURED_ITERATIONS / nodes,
    operationsForOne,
  };
}

const requested = process.argv.slice(2).map(Number).filter(Number.isFinite);
const sizes = requested.length > 0 ? requested : SIZES;

console.log("render + diff cost, measured after warm-up");
console.log(`node.js ${process.version}, NODE_ENV=${process.env["NODE_ENV"] ?? "unset"}`);
console.log(
  "\n rows | nodes |  1 changed: µs/render  µs/node | all changed: µs/render  µs/node | ops",
);
console.log(
  "------+-------+-------------------------------+---------------------------------+-----",
);

const results: Result[] = [];
for (const size of sizes) {
  const result = measure(size);
  results.push(result);
  console.log(
    `${String(result.rows).padStart(5)} |` +
      `${String(result.nodes).padStart(6)} |` +
      `${result.onePerRender.toFixed(1).padStart(14)}` +
      `${result.onePerNode.toFixed(3).padStart(10)} |` +
      `${result.allPerRender.toFixed(1).padStart(16)}` +
      `${result.allPerNode.toFixed(3).padStart(10)} |` +
      `${String(result.operationsForOne).padStart(4)}`,
  );
}

/**
 * Cost per render is fixed + marginal x nodes, and the two must not be
 * conflated: dividing a small tree's total by its node count reports mostly
 * fixed overhead and badly overstates the per-node figure. economics.md models
 * cost as linear in nodes, so the slope is the number to compare against its
 * 0.8 µs assumption.
 */
function fit(points: Array<{ nodes: number; perRender: number }>): {
  fixed: number;
  marginal: number;
} | null {
  if (points.length < 2) return null;

  const n = points.length;
  const sumX = points.reduce((total, point) => total + point.nodes, 0);
  const sumY = points.reduce((total, point) => total + point.perRender, 0);
  const sumXY = points.reduce(
    (total, point) => total + point.nodes * point.perRender,
    0,
  );
  const sumXX = points.reduce(
    (total, point) => total + point.nodes * point.nodes,
    0,
  );

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return null;

  const marginal = (n * sumXY - sumX * sumY) / denominator;
  return { marginal, fixed: (sumY - marginal * sumX) / n };
}

const ASSUMED_MICROSECONDS_PER_NODE = 0.8;
const SENSITIVITY_THRESHOLD = 5;

const oneChanged = fit(
  results.map((result) => ({ nodes: result.nodes, perRender: result.onePerRender })),
);

if (oneChanged) {
  const { fixed, marginal } = oneChanged;
  console.log(
    `\nfitted: ${fixed.toFixed(1)} µs fixed per render + ` +
      `${marginal.toFixed(4)} µs per node`,
  );
  console.log(
    `marginal cost is ${(marginal / ASSUMED_MICROSECONDS_PER_NODE).toFixed(2)}x ` +
      `the ${ASSUMED_MICROSECONDS_PER_NODE} µs assumed in research/economics.md`,
  );

  if (marginal < ASSUMED_MICROSECONDS_PER_NODE) {
    console.log(
      "the assumption is conservative, so its server-driven CPU projections are " +
        "pessimistic and its fan-out crossover is a lower bound",
    );
  } else if (marginal >= SENSITIVITY_THRESHOLD) {
    console.log(
      `at or above the ${SENSITIVITY_THRESHOLD} µs sensitivity case, the ` +
        "fan-out crossover moves past most real audiences",
    );
  }

  // A 600-node view is the size economics.md models for collaboration and
  // dashboard workloads, so it is the directly comparable figure.
  const modelled = fixed + marginal * 600;
  console.log(
    `at the 600-node view economics.md models: ${modelled.toFixed(1)} µs/render ` +
      `measured against ${(ASSUMED_MICROSECONDS_PER_NODE * 600).toFixed(0)} µs assumed`,
  );
}

/**
 * What the component boundary costs.
 *
 * A component is invoked during serialization and its state is looked up by
 * address, so it adds a map lookup and a call per instance per render. Whether
 * that is affordable decides whether the boundary can be the default way to
 * write a row rather than something reserved for rows that need state.
 */
function measureVariant(
  rows: number,
  renderRow: (row: Row) => RenderOutput,
): number {
  const registry = new TemplateRegistry();
  const data = buildRows(rows);
  // One host for the whole run, as a live session has.
  const host = new HookHost();

  let previous = serialize(viewWith(data, 0, renderRow), registry, host).root;

  for (let index = 0; index < WARMUP_ITERATIONS; index += 1) {
    const next = serialize(viewWith(data, index, renderRow), registry, host).root;
    diff(previous, next);
    previous = next;
  }

  const start = process.hrtime.bigint();
  for (let index = 0; index < MEASURED_ITERATIONS; index += 1) {
    const target = data[index % data.length];
    if (target) target.value += 1;

    const next = serialize(viewWith(data, index, renderRow), registry, host).root;
    diff(previous, next);
    previous = next;
  }

  return Number(process.hrtime.bigint() - start) / 1000 / MEASURED_ITERATIONS;
}

console.log("\n\ncomponent boundary cost, one value changed per render");
console.log(
  "\n rows |    plain |  component  (Δ ns/row) |  + useState  (Δ ns/row)",
);
console.log(
  "------+----------+------------------------+------------------------",
);

for (const size of [200, 1000, 2000]) {
  const plain = measureVariant(size, (row) => rowView(row));
  const boxed = measureVariant(size, (row) => RowComponent({ row }));
  const stateful = measureVariant(size, (row) => StatefulRowComponent({ row }));

  const perRow = (variant: number) => ((variant - plain) * 1000) / size;

  console.log(
    `${String(size).padStart(5)} |` +
      `${plain.toFixed(1).padStart(9)} |` +
      `${boxed.toFixed(1).padStart(11)}${perRow(boxed).toFixed(0).padStart(11)} |` +
      `${stateful.toFixed(1).padStart(12)}${perRow(stateful).toFixed(0).padStart(11)}`,
  );
}
