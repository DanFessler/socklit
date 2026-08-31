import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { firstPaint } from "socklit/vite";

const socklitRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  plugins: [firstPaint({ port: 8790 })],
  server: {
    port: 5175,
    strictPort: true,
    fs: { allow: [socklitRoot] },
  },
});
