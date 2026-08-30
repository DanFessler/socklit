import { listen } from "socklit/server";

import { App, store } from "./app";

await listen({
  app: () => App({ store }),
  subscribe: (onChange) => store.onChange(() => onChange(store)),
  port: 8783,
});
