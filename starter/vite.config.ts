import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { bypassUnlessPath, firstPaint } from "socklit/vite";

/** Installed `socklit` (`file:..` in this repo, or `file:/ABS/PATH` after a copy). */
const socklitRoot = fileURLToPath(new URL("node_modules/socklit", import.meta.url));

/** Must match `listen()` (8787, or `PORT`, or `{ port }`). */
const protocolPort = 8787;

export default defineConfig({
  plugins: [firstPaint({ port: protocolPort })],
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [socklitRoot] },
    proxy: {
      "/ws": { target: `http://127.0.0.1:${protocolPort}`, ws: true },
      "/session": {
        target: `http://127.0.0.1:${protocolPort}`,
        bypass: bypassUnlessPath("/session"),
      },
      "/health": { target: `http://127.0.0.1:${protocolPort}` },
    },
  },
  resolve: {
    // The replica and any island you register must share one React.
    dedupe: ["react", "react-dom"],
  },
});
