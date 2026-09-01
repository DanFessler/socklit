import type { Color } from "./rules";

export type BoardCursor = {
  color: Color;
  x: number;
  y: number;
  pressed: boolean;
  holding: { row: number; col: number } | null;
};

type Listener = () => void;

class CursorRelay {
  private readonly byTable = new Map<string, BoardCursor>();
  private readonly listeners = new Set<Listener>();

  cursorFor(tableId: string): BoardCursor | null {
    return this.byTable.get(tableId) ?? null;
  }

  move(
    tableId: string,
    color: Color,
    x: number,
    y: number,
    pressed: boolean,
    holding: { row: number; col: number } | null,
  ): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.byTable.set(tableId, {
      color,
      x,
      y,
      pressed,
      holding,
    });
    this.notify();
  }

  clear(tableId: string, color: Color): void {
    if (this.byTable.get(tableId)?.color !== color) return;
    this.byTable.delete(tableId);
    this.notify();
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export const cursors = new CursorRelay();
