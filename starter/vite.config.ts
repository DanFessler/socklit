import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const socklitRoot = fileURLToPath(new URL("..", import.meta.url));

/** Must match `listen()` (8787, or `PORT`, or `{ port }`). */
const protocolPort = 8787;

export default defineConfig({
  server: {
    port: 5173,
    fs: { allow: [socklitRoot] },
    proxy: {
      "/ws": { target: `http://127.0.0.1:${protocolPort}`, ws: true },
      "/session": { target: `http://127.0.0.1:${protocolPort}` },
      "/health": { target: `http://127.0.0.1:${protocolPort}` },
    },
  },
  resolve: {
    // The replica and any island you register must share one React.
    dedupe: ["react", "react-dom"],
  },
});
