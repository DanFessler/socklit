import { registerIsland } from "socklit/client";

import { ApiSearch } from "./search.island";
import { Code } from "./code.island";

registerIsland("ApiSearch", ApiSearch as never);
registerIsland("Code", Code as never);

import "highlight.js/styles/atom-one-light.css";
import "./site.css";
import "socklit/client";
