import { defineIsland } from "socklit/server";

import type { CatalogEntry } from "./catalog";

/** Typeahead over the public catalog. Filter cannot wait for the wire. */
export const ApiSearch = defineIsland<{ entries: CatalogEntry[] }>("ApiSearch");
