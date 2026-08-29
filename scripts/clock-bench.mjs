/**
 * Load and cost harness for the `clock` probe.
 *
 * Opens N WebSocket sessions, lets the probe tick with nobody interacting, and
 * reports what that idle second cost the server. Metrics are read from
 * /metrics as deltas around the measured window, and the baseline is taken
 * *after* every snapshot has landed so the one expensive first render of each
 * session does not contaminate the steady-state numbers.
 *
 *   node scripts/clock-bench.mjs --rows 500 --sessions 4 --seconds 20
 *   node scripts/clock-bench.mjs --rows 2000 --tick 250 --seconds 12 --json
 *
 * Flags: --rows --sessions --seconds --tick --port --clock on|off
 *        --counter on|off --json
 */

import { WebSocket } from "ws";

const options = parseArgs(process.argv.slice(2));
const origin = `http://localhost:${options.port}`;

const before = await readMetrics();
if (before.sessions > 0) {
  warn(`${before.sessions} clock session(s) already connected; numbers include them`);
}

const sessions = [];
for (let index = 0; index < options.sessions; index += 1) {
  sessions.push(await openSession(index));
}

// Let the connection burst settle, then start measuring from a clean line.
await sleep(500);
for (const session of sessions) session.reset();
const started = process.hrtime.bigint();
const base = await readMetrics();

await sleep(options.seconds * 1000);

const after = await readMetrics();
const elapsedSeconds = Number(process.hrtime.bigint() - started) / 1e9;
for (const session of sessions) session.close();
await sleep(150);

report(buildReport());

function buildReport() {
  const renders = after.renders - base.renders;
  const quiet = after.quietRenders - base.quietRenders;
  const nodes = after.nodes - base.nodes;
  const microseconds = after.renderMicroseconds - base.renderMicroseconds;

  const updateBytes = after.sentBytes.updates - base.sentBytes.updates;
  const frames = sum(sessions, (session) => session.updates);
  const clientBytes = sum(sessions, (session) => session.updateBytes);
  const changedBytes = sum(sessions, (session) => session.changedBytes);
  const operations = sum(sessions, (session) => session.operations);

  const connect = {
    renders: base.renders - before.renders,
    microseconds: base.renderMicroseconds - before.renderMicroseconds,
    nodes: base.nodes - before.nodes,
    bytes:
      base.sentBytes.snapshots -
      before.sentBytes.snapshots +
      (base.sentBytes.templates - before.sentBytes.templates),
  };

  return {
    configuration: {
      rows: options.rows,
      sessions: options.sessions,
      tickMs: options.tick,
      clock: options.clock,
      counter: options.counter,
      seconds: round(elapsedSeconds, 2),
    },
    firstRender: {
      renders: connect.renders,
      nodesPerRender: ratio(connect.nodes, connect.renders),
      msPerRender: round(connect.microseconds / Math.max(1, connect.renders) / 1000, 3),
      microsecondsPerNode: ratio(connect.microseconds, connect.nodes, 3),
      bytesPerSession: ratio(connect.bytes, options.sessions),
    },
    steadyState: {
      renders,
      quietRenders: quiet,
      quietShare: ratio(quiet, renders, 3),
      nodesPerRender: ratio(nodes, renders),
      microsecondsPerNode: ratio(microseconds, nodes, 3),
      msPerRender: round(microseconds / Math.max(1, renders) / 1000, 3),
      rendersPerSecond: round(renders / elapsedSeconds, 2),
      microsecondsPerSecond: Math.round(microseconds / elapsedSeconds),
      coreFraction: round(microseconds / elapsedSeconds / 1e6, 4),
      microsecondsPerSessionSecond: round(
        microseconds / elapsedSeconds / Math.max(1, options.sessions),
        1,
      ),
    },
    wire: {
      updateFrames: frames,
      operations,
      serverUpdateBytes: updateBytes,
      clientUpdateBytes: clientBytes,
      changedValueBytes: changedBytes,
      bytesPerFrame: ratio(clientBytes, frames),
      amplification: ratio(clientBytes, changedBytes, 2),
      bytesPerSessionSecond: round(clientBytes / elapsedSeconds / Math.max(1, options.sessions), 1),
    },
    retainedBytesPerSession: after.retainedBytesPerSession,
  };
}

function report(summary) {
  if (options.json) {
    console.log(JSON.stringify(summary));
    return;
  }

  const { configuration: config, firstRender, steadyState, wire } = summary;
  console.log(
    `\nclock: ${config.rows} rows x ${config.sessions} session(s), tick ${config.tickMs} ms, ${config.seconds} s, clock=${config.clock} counter=${config.counter}`,
  );
  console.log("  first render (per session)");
  console.log(`    nodes                     ${firstRender.nodesPerRender}`);
  console.log(`    render+serialize          ${firstRender.msPerRender} ms`);
  console.log(`    us/node                   ${firstRender.microsecondsPerNode}`);
  console.log(`    snapshot+templates        ${firstRender.bytesPerSession} bytes`);
  console.log("  steady state (idle, ticking)");
  console.log(`    renders                   ${steadyState.renders} (${steadyState.quietRenders} quiet, ${pct(steadyState.quietShare)})`);
  console.log(`    nodes/render              ${steadyState.nodesPerRender}`);
  console.log(`    us/node (render+diff)     ${steadyState.microsecondsPerNode}`);
  console.log(`    ms/render                 ${steadyState.msPerRender}`);
  console.log(`    renders/s                 ${steadyState.rendersPerSecond}`);
  console.log(`    us/s of server CPU        ${steadyState.microsecondsPerSecond} (${pct(steadyState.coreFraction)} of one core)`);
  console.log(`    us/s per session          ${steadyState.microsecondsPerSessionSecond}`);
  console.log("  wire");
  console.log(`    update frames             ${wire.updateFrames} carrying ${wire.operations} ops`);
  console.log(`    bytes sent (client seen)  ${wire.clientUpdateBytes} (${wire.bytesPerFrame} per frame)`);
  console.log(`    bytes that changed        ${wire.changedValueBytes}`);
  console.log(`    amplification             ${wire.amplification}x`);
  console.log(`  retained bytes/session      ${summary.retainedBytesPerSession}\n`);
}

function openSession(index) {
  const params = new URLSearchParams({
    probe: "clock",
    rows: String(options.rows),
    clock: options.clock,
    counter: options.counter,
  });

  // Only the first connection sets shared state, so the others cannot fight
  // over the tick rate mid-run.
  if (index === 0) {
    params.set("tickMs", String(options.tick));
    params.set("running", "on");
  }

  const socket = new WebSocket(`ws://localhost:${options.port}/?${params}`);
  const state = {
    updates: 0,
    updateBytes: 0,
    changedBytes: 0,
    operations: 0,
    reset() {
      state.updates = 0;
      state.updateBytes = 0;
      state.changedBytes = 0;
      state.operations = 0;
    },
    close() {
      socket.close();
    },
  };

  return new Promise((resolve, reject) => {
    socket.on("error", reject);
    socket.on("message", (data) => {
      const raw = data.toString();
      const message = JSON.parse(raw);

      if (message.type === "snapshot") {
        resolve(state);
        return;
      }

      if (message.type === "update") {
        state.updates += 1;
        state.updateBytes += raw.length;
        state.operations += message.operations.length;
        for (const operation of message.operations) {
          // What the browser did not already know: the new value only.
          state.changedBytes += JSON.stringify(
            operation.op === "replace" ? operation.instance : operation.value,
          ).length;
        }
        return;
      }

      if (message.type === "error") {
        warn(`server error: ${message.code} ${message.message}`);
      }
    });
  });
}

async function readMetrics() {
  const response = await fetch(`${origin}/metrics`);
  if (!response.ok) throw new Error(`GET /metrics failed: ${response.status}`);

  const body = await response.json();
  const clock = body["clock"];
  if (!clock) {
    throw new Error("the clock probe is not hosted by this server");
  }
  return clock;
}

function parseArgs(argv) {
  const parsed = {
    rows: 500,
    sessions: 1,
    seconds: 15,
    tick: 1000,
    port: 8787,
    clock: "on",
    counter: "off",
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--json") {
      parsed.json = true;
      continue;
    }

    const value = argv[index + 1];
    index += 1;
    switch (flag) {
      case "--rows": parsed.rows = Number(value); break;
      case "--sessions": parsed.sessions = Number(value); break;
      case "--seconds": parsed.seconds = Number(value); break;
      case "--tick": parsed.tick = Number(value); break;
      case "--port": parsed.port = Number(value); break;
      case "--clock": parsed.clock = value; break;
      case "--counter": parsed.counter = value; break;
      default: throw new Error(`unknown flag: ${flag}`);
    }
  }

  return parsed;
}

function sum(items, pick) {
  return items.reduce((total, item) => total + pick(item), 0);
}

function ratio(numerator, denominator, places = 1) {
  if (!denominator) return 0;
  return round(numerator / denominator, places);
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function pct(fraction) {
  return `${round(fraction * 100, 1)}%`;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function warn(message) {
  if (!options.json) console.warn(`! ${message}`);
}
