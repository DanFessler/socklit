import { registerIsland } from "socklit/client";

import { ColorPalette } from "./color-palette.island";
import { ReviewerPicker } from "./reviewer-picker.island";

registerIsland("ColorPalette", ColorPalette);
registerIsland("ReviewerPicker", ReviewerPicker);

import "socklit/client";
