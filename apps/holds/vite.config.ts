import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const socklitRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  server: {
    port: 5183,
    fs: { allow: [socklitRoot] },
  },
  resolve: {
    // Host React lives in the socklit package; the island's React is
    // this app's. Without this, the first mount is an invalid hook call.
    dedupe: ["react", "react-dom"],
  },
});
