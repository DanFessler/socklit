import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const socklitRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  server: {
    port: 5175,
    fs: { allow: [socklitRoot] },
  },
});
