import { listen } from "socklit/server";

import { App, store } from "./app";

await listen({
  port: 8788,
  app: () => App({ store }),
  subscribe: (onChange) => store.onChange(() => onChange(store)),
});
