import { component } from "socklit/server";

import { Api } from "./pages/api";
import { BlogIndex, BlogPost, matchPost } from "./pages/blog";
import { Compare } from "./pages/compare";
import { Guide } from "./pages/guide";
import { Home } from "./pages/home";
import { NotFound } from "./pages/not-found";
import { Performance } from "./pages/performance";
import { normalizePath, Shell } from "./shell";

export const App = component(function App(props: { path: string }) {
  const path = normalizePath(props.path);
  const post = matchPost(path);
  const body =
    path === "/"
      ? Home({})
      : path === "/guide"
        ? Guide({})
        : path === "/blog"
          ? BlogIndex({})
          : post
            ? BlogPost({ post })
            : path === "/api"
              ? Api({})
              : path === "/compare"
                ? Compare({})
                : path === "/performance"
                  ? Performance({})
                  : NotFound({ path });

  return Shell({ path, children: body });
});
