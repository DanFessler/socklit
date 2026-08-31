import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

import { bypassUnlessPath, firstPaint } from "./server/vite-plugin";

const clientRoot = fileURLToPath(new URL("./client", import.meta.url));
const repoRoot = fileURLToPath(new URL(".", import.meta.url));
/** Research listen(). Not 8787 — that default belongs to a product app. */
const protocolPort = Number(process.env["PORT"] ?? 8795);

export default defineConfig({
  root: clientRoot,
  plugins: [tailwindcss(), firstPaint({ port: protocolPort })],
  server: {
    port: 5173,
    strictPort: true,
    // Islands and shared/protocol.ts live outside the client root.
    fs: { allow: [repoRoot] },
    proxy: {
      "/ws": { target: `http://127.0.0.1:${protocolPort}`, ws: true },
      "/session": {
        target: `http://127.0.0.1:${protocolPort}`,
        bypass: bypassUnlessPath("/session"),
      },
      "/health": { target: `http://127.0.0.1:${protocolPort}` },
      "/probes": { target: `http://127.0.0.1:${protocolPort}` },
      "/metrics": { target: `http://127.0.0.1:${protocolPort}` },
    },
  },
  build: {
    outDir: fileURLToPath(new URL("./dist/client", import.meta.url)),
    emptyOutDir: true,
  },
});
