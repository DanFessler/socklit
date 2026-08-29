import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const clientRoot = fileURLToPath(new URL("./client", import.meta.url));
const repoRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: clientRoot,
  server: {
    port: 5173,
    // shared/protocol.ts lives outside the client root but is imported by it.
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: fileURLToPath(new URL("./dist/client", import.meta.url)),
    emptyOutDir: true,
  },
});
