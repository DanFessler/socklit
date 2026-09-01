import { randomUUID } from "node:crypto";

import { createJsonStore, StoreError } from "socklit/server";

import {
  applyMove,
  freshSquares,
  hasLegalMove,
  other,
  pieceCount,
  type Color,
  type Piece,
} from "./rules";

export type Phase = "waiting" | "live" | "frozen" | "dark-wins" | "light-wins";

export type Table = {
  id: string;
  name: string;
  darkId: string | null;
  lightId: string | null;
  squares: (Piece | null)[];
  turn: Color;
  phase: Phase;
};

export type Hall = {
  tables: Table[];
};

const PHASES: readonly Phase[] = [
  "waiting",
  "live",
  "frozen",
  "dark-wins",
  "light-wins",
];

function isColor(value: unknown): value is Color {
  return value === "dark" || value === "light";
}

function isPhase(value: unknown): value is Phase {
  return typeof value === "string" && (PHASES as readonly string[]).includes(value);
}

function parsePiece(raw: unknown): Piece | null {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") throw new StoreError("invalid piece");
  const { color, king } = raw as { color?: unknown; king?: unknown };
  if (!isColor(color) || typeof king !== "boolean") throw new StoreError("invalid piece");
  return { color, king };
}

function parseTable(raw: unknown): Table {
  if (!raw || typeof raw !== "object") throw new StoreError("expected a table");
  const row = raw as {
    id?: unknown;
    name?: unknown;
    darkId?: unknown;
    lightId?: unknown;
    squares?: unknown;
    turn?: unknown;
    phase?: unknown;
  };
  if (typeof row.id !== "string" || typeof row.name !== "string") {
    throw new StoreError("invalid table");
  }
  if (row.darkId !== null && typeof row.darkId !== "string") {
    throw new StoreError("invalid dark seat");
  }
  if (row.lightId !== null && typeof row.lightId !== "string") {
    throw new StoreError("invalid light seat");
  }
  if (!Array.isArray(row.squares) || row.squares.length !== 64) {
    throw new StoreError("invalid board");
  }
  if (!isColor(row.turn) || !isPhase(row.phase)) throw new StoreError("invalid table");
  return {
    id: row.id,
    name: row.name,
    darkId: row.darkId,
    lightId: row.lightId,
    squares: row.squares.map(parsePiece),
    turn: row.turn,
    phase: row.phase,
  };
}

function parseHall(raw: unknown): Hall {
  if (!raw || typeof raw !== "object") throw new StoreError("expected a hall");
  const { tables } = raw as { tables?: unknown };
  if (!Array.isArray(tables)) throw new StoreError("expected tables");
  return { tables: tables.map(parseTable) };
}

function blankTable(id: string, name: string): Table {
  return {
    id,
    name,
    darkId: null,
    lightId: null,
    squares: freshSquares(),
    turn: "dark",
    phase: "waiting",
  };
}

function replaceTable(hall: Hall, nextTable: Table): Hall {
  return {
    tables: hall.tables.map((table) => (table.id === nextTable.id ? nextTable : table)),
  };
}

export function seatedAt(hall: Hall, personId: string): Table | undefined {
  return hall.tables.find((table) => table.darkId === personId || table.lightId === personId);
}

export function colorOf(table: Table, personId: string): Color | null {
  if (table.darkId === personId) return "dark";
  if (table.lightId === personId) return "light";
  return null;
}

function bothSeated(table: Table): boolean {
  return Boolean(table.darkId && table.lightId);
}

export function sit(hall: Hall, tableId: string, seat: Color, personId: string): Hall {
  const already = seatedAt(hall, personId);
  if (already) return hall;
  const table = hall.tables.find((row) => row.id === tableId);
  if (!table || table.phase !== "waiting") return hall;
  const key = seat === "dark" ? "darkId" : "lightId";
  if (table[key]) return hall;
  const next: Table = { ...table, [key]: personId };
  if (bothSeated(next)) next.phase = "live";
  return replaceTable(hall, next);
}

export function stand(hall: Hall, tableId: string, personId: string): Hall {
  const table = hall.tables.find((row) => row.id === tableId);
  if (!table) return hall;
  const seat = colorOf(table, personId);
  if (!seat) return hall;
  const next: Table = {
    ...table,
    darkId: seat === "dark" ? null : table.darkId,
    lightId: seat === "light" ? null : table.lightId,
  };
  if (table.phase === "live") next.phase = "frozen";
  return replaceTable(hall, next);
}

export function standEverywhere(hall: Hall, personId: string): Hall {
  const table = seatedAt(hall, personId);
  if (!table) return hall;
  return stand(hall, table.id, personId);
}

export function clearTable(hall: Hall, tableId: string): Hall {
  const table = hall.tables.find((row) => row.id === tableId);
  if (!table) return hall;
  if (table.phase !== "frozen" && table.phase !== "dark-wins" && table.phase !== "light-wins") {
    return hall;
  }
  return replaceTable(hall, blankTable(table.id, table.name));
}

export function createTable(hall: Hall, name: string): Hall {
  const trimmed = name.trim().slice(0, 40);
  if (
    !trimmed ||
    hall.tables.some((table) => table.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())
  ) {
    return hall;
  }
  return {
    tables: [...hall.tables, blankTable(`table-${randomUUID()}`, trimmed)],
  };
}

export function closeTable(hall: Hall, tableId: string): Hall {
  const table = hall.tables.find((row) => row.id === tableId);
  if (
    !table ||
    (table.phase !== "dark-wins" && table.phase !== "light-wins")
  ) {
    return hall;
  }
  return { tables: hall.tables.filter((row) => row.id !== tableId) };
}

export function play(
  hall: Hall,
  tableId: string,
  personId: string,
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number,
): Hall {
  const table = hall.tables.find((row) => row.id === tableId);
  if (!table || table.phase !== "live") return hall;
  const seat = colorOf(table, personId);
  if (!seat || table.turn !== seat) return hall;
  const piece = table.squares[fromRow * 8 + fromCol];
  if (!piece || piece.color !== seat) return hall;
  const squares = applyMove(table.squares, fromRow, fromCol, toRow, toCol);
  if (!squares) return hall;
  const opponent = other(seat);
  let phase: Phase = "live";
  if (pieceCount(squares, opponent) === 0 || !hasLegalMove(squares, opponent)) {
    phase = seat === "dark" ? "dark-wins" : "light-wins";
  }
  return replaceTable(hall, {
    ...table,
    squares,
    turn: phase === "live" ? opponent : table.turn,
    phase,
  });
}

export const store = await createJsonStore<Hall>({
  file: "data/hall.json",
  initial: () => ({
    tables: [
      blankTable("oak", "The Oak"),
      blankTable("elm", "The Elm"),
      blankTable("maple", "The Maple"),
    ],
  }),
  parse: parseHall,
});
