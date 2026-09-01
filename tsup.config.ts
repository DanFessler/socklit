import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineConfig, type Options } from "tsup";

const OUT_DIR = "dist/package";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * The package build.
 *
 * Consumers resolve JavaScript and declarations, never this repository's
 * TypeScript. That is what makes `socklit` loadable by plain Node and by a
 * Vite config loader that does not compile its dependencies.
 *
 * Entries are self-contained rather than code-split: `./server` runs in Node
 * and `./client` runs in a browser, and a chunk shared between the two would be
 * a runtime hazard for the sake of a few hundred duplicated lines. For the same
 * reason the two halves are separate builds — `platform` decides whether
 * `node:` import prefixes survive, and they must.
 *
 * Declarations come from `tsc -p tsconfig.build.json`, not from tsup: the
 * bundled rollup-plugin-dts cannot drive this repository's TypeScript.
 *
 * Neither build cleans. tsup runs the two concurrently, so a `clean` here is a
 * race against the other one's output; `build:clean` owns the directory.
 */
const shared = {
  outDir: OUT_DIR,
  format: ["esm"],
  tsconfig: "tsconfig.build.json",
  dts: false,
  sourcemap: true,
  splitting: false,
  external: ["lit-html", "ws", "react", "react-dom", "vite"],
} satisfies Options;

export default defineConfig([
  {
    ...shared,
    entry: { server: "server/public.ts", vite: "server/vite-plugin.ts" },
    platform: "node",
    target: "node20",
    // tsup v8 still rewrites `node:fs/promises` to `fs/promises` by default.
    // Keep the prefix so nothing downstream can resolve a builtin from
    // node_modules.
    removeNodeProtocol: false,
  },
  {
    ...shared,
    entry: {
      client: "client/product.ts",
      "client-islands": "client/island-catalog.ts",
    },
    platform: "browser",
    target: "es2022",
    // `firstPaint()` defines `import.meta.env.SOCKLIT_NAME` in the consuming
    // app's Vite build, so the reference has to survive this build unevaluated.
    env: {},
    async onSuccess() {
      await copyFile(
        `${root}client/product.css`,
        `${root}${OUT_DIR}/client-styles.css`,
      );
    },
  },
]);
