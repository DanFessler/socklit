/**
 * Measures how much of the routes probe is shareable across sessions.
 *
 *   npx tsx scripts/routes-measure.ts
 *   npx tsx scripts/routes-measure.ts --json research/probes/routes-measurements.json
 *
 * The rig starts its own protocol server on an ephemeral port and connects real
 * WebSocket sessions to it, so it needs no dev server and leaves nothing behind.
 * All of the analysis lives in server/probes/routes/{measure,harness,report}.ts
 * so that it is typechecked and testable; this file only prints.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { runMeasurements } from "../server/probes/routes/harness";
import { formatMeasurements } from "../server/probes/routes/report";

const jsonFlag = process.argv.indexOf("--json");
const jsonPath = jsonFlag >= 0 ? process.argv[jsonFlag + 1] : undefined;

const measurements = await runMeasurements();
console.log(formatMeasurements(measurements));

if (jsonPath) {
  const target = resolve(process.cwd(), jsonPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(measurements, null, 2)}\n`, "utf8");
  console.log(`\nwrote ${target}`);
}
