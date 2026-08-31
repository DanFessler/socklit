import { registerIsland } from "socklit/client";

import { ApiSearch } from "./search.island";
import { Code } from "./code.island";

registerIsland("ApiSearch", ApiSearch as never);
registerIsland("Code", Code as never);

import "socklit/client";
