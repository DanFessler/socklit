import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { bypassUnlessPath, firstPaint } from "socklit/vite";

const socklitRoot = fileURLToPath(new URL("..", import.meta.url));

/** Must match `listen()` (8789, or `PORT`, or `{ port }`). */
const protocolPort = 8789;

export default defineConfig({
  plugins: [firstPaint({ port: protocolPort })],
  server: {
    port: 5175,
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
    dedupe: ["react", "react-dom"],
  },
});
