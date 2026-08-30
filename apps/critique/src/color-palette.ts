import { defineIsland } from "socklit/server";

import type { Swatch } from "./palette";

export const ColorPalette = defineIsland<
  { colors: Swatch[]; value: string },
  { onPick: (id: string) => void }
>("ColorPalette");
