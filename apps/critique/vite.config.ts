import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const socklitRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  server: {
    port: 5174,
    fs: { allow: [socklitRoot] },
  },
  resolve: {
    // The replica and any island you register must share one React.
    dedupe: ["react", "react-dom"],
  },
});
