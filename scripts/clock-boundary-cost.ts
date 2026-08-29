/**
 * What the component boundary costs to serialize, isolated.
 *
 * Two measurements, both against the clock probe's shape because that probe
 * exists to pin down per-node cost:
 *
 *   rows   2000 inert rows rendered inline as a helper returning a template,
 *          versus the same rows rendered through a stateless component. Same
 *          templates, same keys, same tree, so the only difference is the
 *          boundary. Reported serialize-only and serialize+diff, because diff
 *          is unaffected by the boundary and dilutes it.
 *   app    the whole clock app at 2000 rows, pre-conversion shape (closure
 *          state, plain helper functions) versus the converted component tree.
 *
 * Both arms are measured back to back in one process so machine state is not a
 * variable. Run it on an otherwise idle machine.
 *
 *   npx tsx scripts/clock-boundary-cost.ts
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
import { createClockApp } from "../server/probes/clock/clock-app";
import {
  createClockStore,
  formatClock,
  type ClockStore,
} from "../server/probes/clock/clock-store";
import {
  createRowSource,
  type StaticRow,
} from "../server/probes/clock/dataset";
import { serialize, TemplateRegistry } from "../server/serialize";
import type { ChangePayload } from "../shared/protocol";

const ROWS = 2000;
const WARMUP = 100;
const ITERATIONS = 500;

const rows = createRowSource().take(ROWS);

// ---------------------------------------------------------------------------
// The row A/B: one template, reached two ways.
// ---------------------------------------------------------------------------

function inertRowTemplate(row: StaticRow): TemplateResult {
  return html`
    <li class="todo">
      <span class="todo-text">${row.label}</span>
      <span class="revision">${row.region}</span>
      <span class="revision">${row.value}</span>
    </li>
  `;
}

const InertRow = component(function InertRow(props: { row: StaticRow }) {
  return inertRowTemplate(props.row);
});

/**
 * The same row, but holding one piece of state.
 *
 * Entries are now created on the first hook that needs one, so this is the arm
 * that actually populates the table and therefore the arm that pays for the
 * address lookup.
 */
const StatefulRow = component(function StatefulRow(props: { row: StaticRow }) {
  useState(0);
  return inertRowTemplate(props.row);
});

function list(render: (row: StaticRow) => RenderOutput): TemplateResult {
  return html`<ul class="todo-list">
    ${keyed(
      rows,
      (row) => row.id,
      (row) => render(row),
    )}
  </ul>`;
}

// ---------------------------------------------------------------------------
// The whole-app A/B: the clock probe before and after conversion.
// ---------------------------------------------------------------------------

/** The pre-conversion clock app, reproduced verbatim as the baseline arm. */
function createInlineClockApp(options: {
  store: ClockStore;
  rows: StaticRow[];
  showClock: boolean;
  countRenders: boolean;
  invalidate: () => void;
}): () => TemplateResult {
  const { store, rows: appRows } = options;

  let showClock = options.showClock;
  let renders = 0;

  function setShowClock(next: boolean): void {
    if (next === showClock) return;
    showClock = next;
    options.invalidate();
  }

  return function ClockApp(): TemplateResult {
    renders += 1;
    const state = store.state();

    return html`
      <header class="app-header">
        <h1>Ticking clock</h1>
        <p>
          One value changes on every tick. Everything below it is inert, and is
          re-rendered, re-serialized and diffed anyway.
        </p>
      </header>

      ${showClock
        ? clockFace(formatClock(state.now))
        : html`<p class="empty">
            Clock hidden for this session. Every tick still re-runs the whole
            app here and produces nothing to send.
          </p>`}
      ${controls(store, showClock, setShowClock)}

      <ul class="todo-list">
        ${keyed(
          appRows,
          (row) => row.id,
          (row) => staticRow(row),
        )}
      </ul>

      <footer class="app-footer">
        <span>${appRows.length} inert rows</span>
        <span
          >${options.countRenders
            ? `${renders} renders for this session`
            : "render counter off"}</span
        >
      </footer>
    `;
  };
}

function clockFace(time: string): TemplateResult {
  return html`
    <section class="todo">
      <span class="todo-text">Server time</span>
      <strong>${time}</strong>
    </section>
  `;
}

function controls(
  store: ClockStore,
  showClock: boolean,
  setShowClock: (next: boolean) => void,
): TemplateResult {
  const state = store.state();

  return html`
    <div class="add-form">
      <button
        class="primary"
        type="button"
        .disabled=${state.running}
        @click=${() => store.setRunning(true)}
      >
        Start
      </button>
      <button
        class="primary"
        type="button"
        .disabled=${!state.running}
        @click=${() => store.setRunning(false)}
      >
        Pause
      </button>
      <label class="control-inline">
        <input
          type="checkbox"
          .checked=${showClock}
          @change=${(event: ChangePayload) =>
            setShowClock(event.checked ?? !showClock)}
        />
        Show clock
      </label>
      <span class="revision"
        >${state.running
          ? `ticking every ${state.intervalMs} ms`
          : "paused"}</span
      >
    </div>
  `;
}

function staticRow(row: StaticRow): TemplateResult {
  return html`
    <li class="todo">
      <span class="todo-text">${row.label}</span>
      <span class="revision">${row.region}</span>
      <span class="revision">${row.value}</span>
    </li>
  `;
}

// ---------------------------------------------------------------------------
// Harness.
// ---------------------------------------------------------------------------

type Reading = {
  label: string;
  nodes: number;
  perRender: number;
  perNode: number;
  hooks: number;
};

const readings: Reading[] = [];

function record(
  label: string,
  nodes: number,
  total: number,
  hooks: number,
): void {
  const perRender = total / ITERATIONS;
  readings.push({
    label,
    nodes,
    perRender,
    perNode: perRender / nodes,
    hooks,
  });

  console.log(
    `${label.padEnd(24)} ${String(nodes).padStart(5)} nodes, ` +
      `${perRender.toFixed(1).padStart(7)} us/render, ` +
      `${perNode(perRender, nodes)} us/node, hooks=${hooks}`,
  );
}

function perNode(perRender: number, nodes: number): string {
  return (perRender / nodes).toFixed(4);
}

function measureSerialize(
  label: string,
  build: () => RenderOutput,
  before: () => void = () => {},
): void {
  const registry = new TemplateRegistry();
  const host = new HookHost();

  for (let index = 0; index < WARMUP; index += 1) {
    before();
    serialize(build(), registry, host);
  }

  const nodes = countNodes(serialize(build(), registry, host).root);

  const started = process.hrtime.bigint();
  for (let index = 0; index < ITERATIONS; index += 1) {
    before();
    serialize(build(), registry, host);
  }
  const total = Number(process.hrtime.bigint() - started) / 1000;

  record(label, nodes, total, host.size);
}

function measureSerializeAndDiff(label: string, build: () => RenderOutput): void {
  const registry = new TemplateRegistry();
  const host = new HookHost();

  for (let index = 0; index < WARMUP; index += 1) {
    serialize(build(), registry, host);
  }

  const nodes = countNodes(serialize(build(), registry, host).root);

  let previous = serialize(build(), registry, host).root;
  const started = process.hrtime.bigint();
  for (let index = 0; index < ITERATIONS; index += 1) {
    const next = serialize(build(), registry, host).root;
    diff(previous, next);
    previous = next;
  }
  const total = Number(process.hrtime.bigint() - started) / 1000;

  record(label, nodes, total, host.size);
}

const store = createClockStore({ autoTick: false });

const inlineApp = createInlineClockApp({
  store,
  rows,
  showClock: true,
  countRenders: false,
  invalidate: () => {},
});

const componentApp = createClockApp({
  store,
  rows,
  showClock: true,
  countRenders: false,
});

console.log(`node.js ${process.version}, ${ROWS} rows, ${ITERATIONS} iterations\n`);

for (let pass = 0; pass < 2; pass += 1) {
  console.log(`pass ${pass + 1}`);

  console.log("  rows, serialize only");
  measureSerialize("    inline", () => list((row) => inertRowTemplate(row)));
  measureSerialize("    component", () => list((row) => InertRow({ row })));
  measureSerialize("    component + useState", () =>
    list((row) => StatefulRow({ row })),
  );

  console.log("  rows, serialize + diff");
  measureSerializeAndDiff("    inline", () => list((row) => inertRowTemplate(row)));
  measureSerializeAndDiff("    component", () => list((row) => InertRow({ row })));
  measureSerializeAndDiff("    component + useState", () =>
    list((row) => StatefulRow({ row })),
  );

  console.log("  whole app, serialize only");
  measureSerialize("    inline", inlineApp, () => store.tick());
  measureSerialize("    component", componentApp, () => store.tick());

  console.log("");
}

store.dispose();

// ---------------------------------------------------------------------------
// Where the residual goes. Each loop does 2000 units of one suspected cost, so
// the numbers are directly comparable to the per-render delta above.
// ---------------------------------------------------------------------------

function measureLoop(label: string, body: () => void): void {
  for (let index = 0; index < WARMUP; index += 1) body();

  const started = process.hrtime.bigint();
  for (let index = 0; index < ITERATIONS; index += 1) body();
  const total = Number(process.hrtime.bigint() - started) / 1000;

  const perRender = total / ITERATIONS;
  console.log(
    `${label.padEnd(30)} ${perRender.toFixed(1).padStart(7)} us per 2000, ` +
      `${((perRender / ROWS) * 1000).toFixed(0).padStart(4)} ns each`,
  );
}

const addresses = rows.map((row) => `root/h0/k:${row.id}`);
const table = new Map(addresses.map((key) => [key, { slots: [] }]));
let sink: unknown = null;

console.log("residual breakdown");
measureLoop("  map.get, fresh key string", () => {
  for (const row of rows) sink = table.get(`root/h0/k:${row.id}`);
});
measureLoop("  key string construction only", () => {
  for (const row of rows) sink = `root/h0/k:${row.id}`;
});
measureLoop("  map.get, reused key string", () => {
  for (const key of addresses) sink = table.get(key);
});
measureLoop("  marker + props allocation", () => {
  for (const row of rows) sink = InertRow({ row });
});
measureLoop("  template allocation", () => {
  for (const row of rows) sink = inertRowTemplate(row);
});
if (sink === undefined) console.log("");

// ---------------------------------------------------------------------------
// Is the boundary cost flat, or does it grow with the size of the hook table?
// ---------------------------------------------------------------------------

function listOf(
  source: StaticRow[],
  render: (row: StaticRow) => RenderOutput,
): TemplateResult {
  return html`<ul class="todo-list">
    ${keyed(
      source,
      (row) => row.id,
      (row) => render(row),
    )}
  </ul>`;
}

function timeSerialize(build: () => RenderOutput, iterations: number): number {
  const registry = new TemplateRegistry();
  const host = new HookHost();

  for (let index = 0; index < WARMUP; index += 1) {
    serialize(build(), registry, host);
  }

  const started = process.hrtime.bigint();
  for (let index = 0; index < iterations; index += 1) {
    serialize(build(), registry, host);
  }
  return Number(process.hrtime.bigint() - started) / 1000 / iterations;
}

console.log("\nboundary cost by list length (serialize only), ns per instance");
console.log("  rows |  inline us | stateless us |    ns | stateful us |    ns");

for (const count of [10, 50, 200, 500, 1000, 2000, 5000]) {
  const source = createRowSource().take(count);
  const iterations = Math.max(50, Math.round(1_000_000 / (count * 4)));

  const inline = timeSerialize(
    () => listOf(source, (row) => inertRowTemplate(row)),
    iterations,
  );
  const stateless = timeSerialize(
    () => listOf(source, (row) => InertRow({ row })),
    iterations,
  );
  const stateful = timeSerialize(
    () => listOf(source, (row) => StatefulRow({ row })),
    iterations,
  );

  const perInstance = (value: number): string =>
    (((value - inline) / count) * 1000).toFixed(0).padStart(6);

  console.log(
    `${String(count).padStart(6)} |` +
      `${inline.toFixed(1).padStart(11)} |` +
      `${stateless.toFixed(1).padStart(13)} |` +
      `${perInstance(stateless)} |` +
      `${stateful.toFixed(1).padStart(12)} |` +
      `${perInstance(stateful)}`,
  );
}

// Per-instance costs come from the sweep below, which pairs each arm against
// the inline baseline at the same list length. `readings` is kept only so the
// table above stays machine-readable if this ever needs to emit JSON.
void readings;
