/**
 * Checks that the built package is what a consumer actually gets.
 *
 *   npm run verify:package
 *
 * The failure this exists to catch is the one that only appears outside this
 * repository: an export map pointing at TypeScript, or at a file the build did
 * not emit, works fine under `tsx` here and breaks the moment plain Node or a
 * Vite config loader resolves it.
 *
 * Run it after `npm run build`. Node entries are imported for real; the browser
 * entries are only checked for existence and shape, because importing them
 * needs a DOM.
 */

import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type ExportTarget = { subpath: string; condition: string; file: string };

const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  ok    ${label}`);
    return;
  }
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  failures.push(label);
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(resolve(root, file));
    return true;
  } catch {
    return false;
  }
}

const manifest = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
) as {
  exports: Record<string, string | Record<string, string>>;
  files: string[];
};

/** Every file the export map can hand a consumer, flattened. */
function exportTargets(): ExportTarget[] {
  const targets: ExportTarget[] = [];
  for (const [subpath, value] of Object.entries(manifest.exports)) {
    if (typeof value === "string") {
      targets.push({ subpath, condition: "default", file: value });
      continue;
    }
    for (const [condition, file] of Object.entries(value)) {
      targets.push({ subpath, condition, file });
    }
  }
  return targets;
}

console.log("export targets exist and are built artifacts");
for (const target of exportTargets()) {
  const label = `${target.subpath} (${target.condition}) -> ${target.file}`;
  const isSource = /\.tsx?$/.test(target.file) && !target.file.endsWith(".d.ts");
  if (isSource) {
    check(label, false, "resolves to TypeScript source");
    continue;
  }
  check(label, await exists(target.file), "missing from the build output");
}

console.log("\npublished files cover the export map");
for (const target of exportTargets()) {
  const covered = manifest.files.some((entry) =>
    target.file.replace(/^\.\//, "").startsWith(entry.replace(/^\.\//, "")),
  );
  check(`${target.file} is inside "files"`, covered);
}

console.log("\nnode entries load without a TypeScript loader");
// A child `node` with no loader flags, resolving through the export map. This
// script runs under tsx, which would happily compile TypeScript and hide the
// exact failure the check is for.
for (const [subpath, expected] of [
  ["socklit/server", ["listen", "component", "html", "keyed"]],
  ["socklit/vite", ["firstPaint", "bypassUnlessPath"]],
] as const) {
  const source = `
    const loaded = await import(${JSON.stringify(subpath)});
    const missing = ${JSON.stringify(expected)}.filter((name) => !(name in loaded));
    if (missing.length > 0) {
      console.error("missing " + missing.join(", "));
      process.exit(1);
    }
  `;
  try {
    await run(process.execPath, ["--input-type=module", "-e", source], {
      cwd: root,
    });
    check(`${subpath} exports ${expected.join(", ")}`, true);
  } catch (error) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String((error as { stderr: unknown }).stderr).trim().split("\n")[0]
        : String(error);
    check(`${subpath} exports ${expected.join(", ")}`, false, stderr);
  }
}

console.log("\nbrowser entry is built but not imported here (needs a DOM)");
const clientBundle = await readFile(
  resolve(root, "dist/package/client.js"),
  "utf8",
);
check(
  "socklit/client keeps import.meta.env.SOCKLIT_NAME unevaluated",
  clientBundle.includes("import.meta.env"),
  "the app's Vite define would have nothing to replace",
);
check(
  "socklit/client leaves react external",
  /from "react"/.test(clientBundle) && !/createRoot\s*=\s*function/.test(clientBundle),
  "react looks bundled, which would mean two copies in a consuming app",
);

if (failures.length > 0) {
  console.error(`\n${failures.length} package check(s) failed`);
  process.exit(1);
}

console.log("\npackage looks consumable");
