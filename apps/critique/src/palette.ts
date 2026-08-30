/** Studio color labels. Reference data — not stored. */

export type Swatch = { id: string; name: string; hex: string };

export const PALETTE: Swatch[] = [
  { id: "mustard", name: "Mustard", hex: "#c9a227" },
  { id: "slate", name: "Slate", hex: "#5c6b7a" },
  { id: "coral", name: "Coral", hex: "#e07a5f" },
  { id: "sage", name: "Sage", hex: "#7d9b76" },
  { id: "indigo", name: "Indigo", hex: "#4a5d9e" },
  { id: "clay", name: "Clay", hex: "#b56b4f" },
  { id: "ink", name: "Ink", hex: "#2c3338" },
  { id: "blush", name: "Blush", hex: "#d4a0a8" },
];

export const DEFAULT_COLOR_ID = PALETTE[0]!.id;

export function swatchById(id: string): Swatch {
  return PALETTE.find((swatch) => swatch.id === id) ?? PALETTE[0]!;
}
