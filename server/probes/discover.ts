import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Probe, ProbeContext, ProbeModule } from "./types";

const PROBES_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = fileURLToPath(new URL("../../data/", import.meta.url));

/**
 * Loads every `server/probes/<id>/probe.ts` found on disk.
 *
 * Discovery is by convention rather than by a registry file on purpose: probes
 * are developed independently, and a shared list would be the one file every
 * author has to edit and therefore the one file that always conflicts.
 */
export async function discoverProbes(
  log: (message: string) => void,
): Promise<Probe[]> {
  const entries = await readdir(PROBES_DIRECTORY, { withFileTypes: true });
  const probes: Probe[] = [];

  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const module = pathToFileURL(
      join(PROBES_DIRECTORY, entry.name, "probe.ts"),
    ).href;

    let loaded: ProbeModule;
    try {
      loaded = (await import(module)) as ProbeModule;
    } catch (error) {
      log(`probe ${entry.name} failed to load: ${describe(error)}`);
      continue;
    }

    if (typeof loaded.create !== "function") {
      log(`probe ${entry.name} does not export create()`);
      continue;
    }

    const context: ProbeContext = {
      dataFile: (name) => join(DATA_ROOT, entry.name, name),
      log: (message) => log(`${entry.name}: ${message}`),
    };

    try {
      const probe = await loaded.create(context);
      if (probe.id !== entry.name) {
        log(`probe ${entry.name} declares mismatched id "${probe.id}"`);
        continue;
      }
      probes.push(probe);
    } catch (error) {
      log(`probe ${entry.name} failed to initialize: ${describe(error)}`);
    }
  }

  return probes.sort((left, right) => left.id.localeCompare(right.id));
}

function describe(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
