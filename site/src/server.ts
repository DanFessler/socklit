import { listen } from "socklit/server";

import { App } from "./app";

await listen({
  port: 8789,
  createApp: (session) => () => App({ path: session.params.get("path") ?? "/" }),
  publicDir: "dist",
});
