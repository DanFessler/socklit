import { listen } from "socklit/server";

import { App, store } from "./app";

await listen({
  app: () => App({ store }),
  subscribe: (onChange) => store.onChange(() => onChange(store)),
  // After `vite build`, this process is the page and the socket.
  publicDir: "dist",
  durableFile: "data/durable.json",
});
