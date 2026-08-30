import { defineIsland } from "../server/island";

export const SWATCHES = [
  "#7dd3fc",
  "#a78bfa",
  "#fb7185",
  "#fbbf24",
  "#34d399",
  "#f472b6",
  "#94a3b8",
  "#e7ebf1",
] as const;

/**
 * Contract only. The React implementation is `color-picker.island.tsx`.
 *
 * Server code imports this file. Client code never does. That split is the
 * boundary — not a `"use client"` pragma, not the same JSX in two runtimes.
 */
export const ColorPicker = defineIsland<
  { value: string; swatches: string[] },
  { onChange: (value: string) => void }
>("ColorPicker");
