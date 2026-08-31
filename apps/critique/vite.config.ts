import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { firstPaint } from "socklit/vite";

const socklitRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  plugins: [firstPaint({ port: 8788 })],
  server: {
    port: 5174,
    strictPort: true,
    fs: { allow: [socklitRoot] },
  },
  resolve: {
    // The replica and any island you register must share one React.
    dedupe: ["react", "react-dom"],
  },
});
