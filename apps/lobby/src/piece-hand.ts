import { defineIsland } from "socklit/server";

import type { BoardCursor } from "./cursors";

export type HandMan = {
  row: number;
  col: number;
  color: "dark" | "light";
  king: boolean;
};

/** The table. Server owns positions via `men`. The island paints and drags. */
export const PieceHand = defineIsland<
  {
    you: "dark" | "light" | null;
    turn: "dark" | "light";
    live: boolean;
    men: HandMan[];
    activeCursor: BoardCursor | null;
  },
  {
    onMove: (fromRow: number, fromCol: number, toRow: number, toCol: number) => void;
    onCursorMove: (
      x: number,
      y: number,
      pressed: boolean,
      holdingRow: number | null,
      holdingCol: number | null,
    ) => void;
    onCursorLeave: () => void;
  }
>("PieceHand");
