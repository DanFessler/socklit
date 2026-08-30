import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useEffect, useRef, useState } from "react";

import type { HandMan } from "./piece-hand";

type Square = { row: number; col: number };

function cellId(row: number, col: number): string {
  return `${row}-${col}`;
}

function parseCell(id: string | number): Square | null {
  const [row, col] = String(id).split("-").map(Number);
  if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
  return { row, col };
}

function manAt(men: readonly HandMan[], square: Square): HandMan | undefined {
  return men.find((man) => man.row === square.row && man.col === square.col);
}

function menKey(men: readonly HandMan[]): string {
  return men
    .map((man) => `${man.row},${man.col},${man.color},${man.king ? "k" : "m"}`)
    .sort()
    .join("|");
}

/** Paint only. Not a rules engine — captures the usual jump shape so the disc stays put. */
function paintMove(men: HandMan[], from: Square, to: Square): HandMan[] {
  const piece = manAt(men, from);
  if (!piece) return men;
  const next = men.filter((man) => man !== piece);
  if (Math.abs(to.row - from.row) === 2 && Math.abs(to.col - from.col) === 2) {
    const mid = { row: (from.row + to.row) / 2, col: (from.col + to.col) / 2 };
    const jumped = manAt(next, mid);
    if (jumped) next.splice(next.indexOf(jumped), 1);
  }
  const last = piece.color === "dark" ? 0 : 7;
  next.push({
    ...piece,
    row: to.row,
    col: to.col,
    king: piece.king || to.row === last,
  });
  return next;
}

function Man(props: { man: HandMan; ghost?: boolean }) {
  return (
    <span
      className={`man ${props.man.color}${props.man.king ? " king" : ""}${props.ghost ? " hand-ghost" : ""}`}
    />
  );
}

function Square(props: {
  row: number;
  col: number;
  man: HandMan | undefined;
  lifting: boolean;
  canDrag: boolean;
}) {
  const id = cellId(props.row, props.col);
  const drag = useDraggable({
    id,
    data: { row: props.row, col: props.col },
    disabled: !props.canDrag || !props.man,
  });
  const drop = useDroppable({ id, data: { row: props.row, col: props.col } });
  const dark = (props.row + props.col) % 2 === 1;
  const className = [
    "sq",
    dark ? "dark" : "light",
    props.lifting ? "lifting" : "",
    drop.isOver && !props.lifting ? "over" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const label = props.lifting
    ? `Piece in hand at ${props.row},${props.col}`
    : `Square ${props.row},${props.col}`;
  const bind = (node: HTMLElement | null) => {
    drag.setNodeRef(node);
    drop.setNodeRef(node);
  };
  const disc = props.man && !props.lifting ? <Man man={props.man} /> : null;

  if (!props.canDrag) {
    return (
      <div ref={bind} className={className} aria-label={label}>
        {disc}
      </div>
    );
  }

  return (
    <button
      ref={bind}
      type="button"
      className={className}
      aria-label={label}
      {...drag.listeners}
      {...drag.attributes}
    >
      {disc}
    </button>
  );
}

export function PieceHand(props: {
  you: "dark" | "light" | null;
  turn: "dark" | "light";
  live: boolean;
  men: HandMan[];
  onMove: (fromRow: number, fromCol: number, toRow: number, toCol: number) => void;
}) {
  const canPlay = Boolean(props.live && props.you);
  const [paint, setPaint] = useState<HandMan[]>(props.men);
  const [held, setHeld] = useState<Square | null>(null);
  const menRef = useRef(props.men);
  const pending = useRef(0);
  menRef.current = props.men;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const serverKey = menKey(props.men);
  useEffect(() => {
    pending.current += 1;
    setPaint(menRef.current);
    setHeld(null);
  }, [serverKey]);

  function commit(from: Square, to: Square) {
    setHeld(null);
    if (from.row === to.row && from.col === to.col) return;
    setPaint((current) => paintMove(current, from, to));
    const ticket = ++pending.current;
    const snapshot = menKey(menRef.current);
    props.onMove(from.row, from.col, to.row, to.col);
    window.setTimeout(() => {
      if (pending.current !== ticket) return;
      if (menKey(menRef.current) === snapshot) setPaint(menRef.current);
    }, 280);
  }

  function onDragStart(event: DragStartEvent) {
    const square = parseCell(event.active.id);
    if (square) setHeld(square);
  }

  function onDragEnd(event: DragEndEvent) {
    const from = parseCell(event.active.id);
    const to = event.over ? parseCell(event.over.id) : null;
    if (from && to) commit(from, to);
    else setHeld(null);
  }

  const cells = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const square = { row, col };
      const lifting = Boolean(held && held.row === row && held.col === col);
      cells.push(
        <Square
          key={cellId(row, col)}
          row={row}
          col={col}
          man={manAt(paint, square)}
          lifting={lifting}
          canDrag={canPlay}
        />,
      );
    }
  }

  const ghost = held ? manAt(paint, held) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setHeld(null)}
    >
      <div className="board" role="grid" data-turn={props.turn}>
        {cells}
      </div>
      <DragOverlay dropAnimation={null}>{held && ghost ? <Man man={ghost} ghost /> : null}</DragOverlay>
    </DndContext>
  );
}
