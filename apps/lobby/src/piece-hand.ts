import { defineIsland } from "socklit/server";

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
  },
  {
    onMove: (fromRow: number, fromCol: number, toRow: number, toCol: number) => void;
  }
>("PieceHand");
