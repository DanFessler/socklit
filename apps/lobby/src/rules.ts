export type Color = "dark" | "light";

export type Piece = {
  color: Color;
  king: boolean;
};

export const BOARD = 8;

export function isDarkSquare(row: number, col: number): boolean {
  return (row + col) % 2 === 1;
}

export function idx(row: number, col: number): number {
  return row * BOARD + col;
}

export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD && col >= 0 && col < BOARD;
}

/** Dark sits at the bottom and walks toward row 0. Light walks toward row 7. */
const MAN_STEP: Record<Color, number> = { dark: -1, light: 1 };
const LAST_RANK: Record<Color, number> = { dark: 0, light: 7 };

export function freshSquares(): (Piece | null)[] {
  const squares: (Piece | null)[] = Array.from({ length: BOARD * BOARD }, () => null);
  for (let row = 0; row < BOARD; row++) {
    for (let col = 0; col < BOARD; col++) {
      if (!isDarkSquare(row, col)) continue;
      if (row <= 2) squares[idx(row, col)] = { color: "light", king: false };
      if (row >= 5) squares[idx(row, col)] = { color: "dark", king: false };
    }
  }
  return squares;
}

export function isLegalMove(
  squares: readonly (Piece | null)[],
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number,
): boolean {
  if (!inBounds(fromRow, fromCol) || !inBounds(toRow, toCol)) return false;
  if (!isDarkSquare(toRow, toCol)) return false;
  const piece = squares[idx(fromRow, fromCol)];
  if (!piece) return false;
  const dest = squares[idx(toRow, toCol)];
  if (dest) return false;
  const dr = toRow - fromRow;
  const dc = toCol - fromCol;
  if (Math.abs(dr) !== Math.abs(dc)) return false;
  const steps = Math.abs(dr);
  if (steps === 1) {
    return piece.king || dr === MAN_STEP[piece.color];
  }
  if (steps === 2) {
    if (!piece.king && Math.sign(dr) !== MAN_STEP[piece.color]) return false;
    const mid = squares[idx(fromRow + dr / 2, fromCol + dc / 2)];
    return Boolean(mid && mid.color !== piece.color);
  }
  return false;
}

export function applyMove(
  squares: readonly (Piece | null)[],
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number,
): (Piece | null)[] | null {
  if (!isLegalMove(squares, fromRow, fromCol, toRow, toCol)) return null;
  const piece = squares[idx(fromRow, fromCol)];
  if (!piece) return null;
  const next = squares.slice();
  next[idx(fromRow, fromCol)] = null;
  if (Math.abs(toRow - fromRow) === 2) {
    next[idx((fromRow + toRow) / 2, (fromCol + toCol) / 2)] = null;
  }
  const crowned = !piece.king && toRow === LAST_RANK[piece.color];
  next[idx(toRow, toCol)] = crowned ? { color: piece.color, king: true } : piece;
  return next;
}

export function pieceCount(squares: readonly (Piece | null)[], color: Color): number {
  return squares.reduce((n, cell) => (cell?.color === color ? n + 1 : n), 0);
}

export function hasLegalMove(squares: readonly (Piece | null)[], color: Color): boolean {
  for (let row = 0; row < BOARD; row++) {
    for (let col = 0; col < BOARD; col++) {
      const piece = squares[idx(row, col)];
      if (!piece || piece.color !== color) continue;
      for (const dr of [-2, -1, 1, 2]) {
        for (const dc of [-2, -1, 1, 2]) {
          if (Math.abs(dr) !== Math.abs(dc)) continue;
          if (isLegalMove(squares, row, col, row + dr, col + dc)) return true;
        }
      }
    }
  }
  return false;
}

export function other(color: Color): Color {
  return color === "dark" ? "light" : "dark";
}
