import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const socklitRoot = fileURLToPath(new URL("..", import.meta.url));

/** Must match `listen()` (8789, or `PORT`, or `{ port }`). */
const protocolPort = 8789;

export default defineConfig({
  server: {
    port: 5175,
    fs: { allow: [socklitRoot] },
    proxy: {
      "/ws": { target: `http://127.0.0.1:${protocolPort}`, ws: true },
      "/session": { target: `http://127.0.0.1:${protocolPort}` },
      "/health": { target: `http://127.0.0.1:${protocolPort}` },
    },
  },
  resolve: {
    dedupe: ["react", "react-dom"],
  },
});
