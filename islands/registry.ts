import type { ComponentType } from "react";

import { ColorPicker } from "./color-picker.island";
import { PrioritySelect } from "./priority-select.island";

/**
 * The only file that imports `*.island.tsx`.
 *
 * Adding an island is: write the contract, write the React file, register
 * it here. The server never appears in this graph.
 */
export const islandComponents: Record<
  string,
  ComponentType<Record<string, unknown>>
> = {
  ColorPicker: ColorPicker as ComponentType<Record<string, unknown>>,
  PrioritySelect: PrioritySelect as ComponentType<Record<string, unknown>>,
};
