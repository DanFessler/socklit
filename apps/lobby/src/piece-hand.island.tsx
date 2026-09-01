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
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { BoardCursor } from "./cursors";
import type { HandMan } from "./piece-hand";

type Square = { row: number; col: number };
type CursorPoint = { x: number; y: number; durationMs: number };

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

function hermitePoint(
  previous: CursorPoint,
  from: CursorPoint,
  to: CursorPoint,
  next: CursorPoint,
  t: number,
): { x: number; y: number } {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const segmentMs = Math.max(1, to.durationMs);
  const fromScale =
    previous === from ? 1 : segmentMs / (Math.max(1, from.durationMs) + segmentMs);
  const toScale = segmentMs / (segmentMs + Math.max(1, next.durationMs));
  const fromTangent = {
    x: (to.x - previous.x) * fromScale,
    y: (to.y - previous.y) * fromScale,
  };
  const toTangent = {
    x: (next.x - from.x) * toScale,
    y: (next.y - from.y) * toScale,
  };
  return {
    x: h00 * from.x + h10 * fromTangent.x + h01 * to.x + h11 * toTangent.x,
    y: h00 * from.y + h10 * fromTangent.y + h01 * to.y + h11 * toTangent.y,
  };
}

function useHermiteCursor(cursor: BoardCursor | null): { x: number; y: number } | null {
  const points = useRef<CursorPoint[]>([]);
  const segment = useRef(0);
  const segmentStartedAt = useRef<number | null>(null);
  const lastReceivedAt = useRef<number | null>(null);
  const cursorColor = useRef<BoardCursor["color"] | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!cursor) {
      points.current = [];
      segment.current = 0;
      segmentStartedAt.current = null;
      lastReceivedAt.current = null;
      cursorColor.current = null;
      setPosition(null);
      return;
    }

    if (cursorColor.current !== cursor.color) {
      points.current = [];
      segment.current = 0;
      segmentStartedAt.current = null;
      lastReceivedAt.current = null;
      cursorColor.current = cursor.color;
    }

    const now = performance.now();
    const elapsed = lastReceivedAt.current === null ? 50 : now - lastReceivedAt.current;
    lastReceivedAt.current = now;
    const point = {
      x: cursor.x,
      y: cursor.y,
      durationMs: elapsed > 150 ? 50 : Math.max(16, elapsed),
    };
    points.current.push(point);
    if (points.current.length === 1) setPosition({ x: point.x, y: point.y });
  }, [cursor]);

  useEffect(() => {
    if (!cursor) return;
    let frame = 0;

    const draw = () => {
      const samples = points.current;
      let currentSegment = segment.current;
      let interpolated: { x: number; y: number } | null = null;

      while (samples.length >= currentSegment + 3) {
        const now = performance.now();
        const startedAt = segmentStartedAt.current ?? now;
        segmentStartedAt.current = startedAt;
        const from = samples[currentSegment];
        const to = samples[currentSegment + 1];
        const duration = Math.max(1, to.durationMs);
        const t = Math.min(1, Math.max(0, (now - startedAt) / duration));
        interpolated = hermitePoint(
          samples[Math.max(0, currentSegment - 1)],
          from,
          to,
          samples[currentSegment + 2],
          t,
        );
        if (t < 1) break;

        currentSegment += 1;
        segment.current = currentSegment;
        if (samples.length >= currentSegment + 3) {
          segmentStartedAt.current = startedAt + duration;
          continue;
        }
        segmentStartedAt.current = null;
        break;
      }

      if (interpolated) {
        const nextPosition = interpolated;
        setPosition((current) =>
          current &&
          Math.abs(current.x - nextPosition.x) < 0.0001 &&
          Math.abs(current.y - nextPosition.y) < 0.0001
            ? current
            : nextPosition,
        );
      }

      if (currentSegment > 4) {
        const remove = currentSegment - 1;
        samples.splice(0, remove);
        segment.current = 1;
      }
      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [cursor?.color, Boolean(cursor)]);

  return position;
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
  activeCursor: BoardCursor | null;
  onMove: (fromRow: number, fromCol: number, toRow: number, toCol: number) => void;
  onCursorMove: (
    x: number,
    y: number,
    pressed: boolean,
    holdingRow: number | null,
    holdingCol: number | null,
  ) => void;
  onCursorLeave: () => void;
}) {
  const canPlay = Boolean(props.live && props.you && props.you === props.turn);
  const [paint, setPaint] = useState<HandMan[]>(props.men);
  const [held, setHeld] = useState<Square | null>(null);
  const cursorPosition = useHermiteCursor(props.activeCursor);
  const menRef = useRef(props.men);
  const pending = useRef(0);
  const cursorTimer = useRef<number | null>(null);
  const latestCursor = useRef<{
    x: number;
    y: number;
    pressed: boolean;
    holding: Square | null;
  } | null>(null);
  const lastPosition = useRef<{ x: number; y: number } | null>(null);
  const pointerPressed = useRef(false);
  const heldRef = useRef<Square | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const dragPointerStart = useRef<{ x: number; y: number } | null>(null);
  menRef.current = props.men;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const serverKey = menKey(props.men);
  useEffect(() => {
    pending.current += 1;
    setPaint(menRef.current);
    setHeld(null);
    heldRef.current = null;
  }, [serverKey]);

  useEffect(
    () => () => {
      if (cursorTimer.current !== null) window.clearTimeout(cursorTimer.current);
    },
    [],
  );

  function sendLatestCursor() {
    cursorTimer.current = null;
    const next = latestCursor.current;
    latestCursor.current = null;
    if (next) {
      props.onCursorMove(
        next.x,
        next.y,
        next.pressed,
        next.holding?.row ?? null,
        next.holding?.col ?? null,
      );
    }
  }

  function boardBounds(board: HTMLDivElement) {
    const cells = board.querySelectorAll<HTMLElement>(".sq");
    const first = cells.item(0).getBoundingClientRect();
    const last = cells.item(cells.length - 1).getBoundingClientRect();
    return {
      left: first.left,
      top: first.top,
      right: last.right,
      bottom: last.bottom,
    };
  }

  function positionOnBoard(clientX: number, clientY: number) {
    const board = boardRef.current;
    if (!board) return null;
    const bounds = boardBounds(board);
    return {
      x: (clientX - bounds.left) / (bounds.right - bounds.left),
      y: (clientY - bounds.top) / (bounds.bottom - bounds.top),
    };
  }

  function queueCursor(position = lastPosition.current) {
    if (!position) return;
    lastPosition.current = position;
    latestCursor.current = {
      ...position,
      pressed: pointerPressed.current,
      holding: heldRef.current,
    };
    if (cursorTimer.current === null) {
      cursorTimer.current = window.setTimeout(sendLatestCursor, 50);
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canPlay) return;
    pointerPressed.current = true;
    queueCursor(positionOnBoard(event.clientX, event.clientY));
  }

  function clearCursor() {
    latestCursor.current = null;
    lastPosition.current = null;
    pointerPressed.current = false;
    heldRef.current = null;
    if (cursorTimer.current !== null) {
      window.clearTimeout(cursorTimer.current);
      cursorTimer.current = null;
    }
    if (canPlay) props.onCursorLeave();
  }

  useEffect(() => {
    if (!canPlay) return;
    const sample = (event: PointerEvent) => {
      queueCursor(positionOnBoard(event.clientX, event.clientY));
    };
    const release = (event: PointerEvent) => {
      pointerPressed.current = false;
      heldRef.current = null;
      queueCursor(positionOnBoard(event.clientX, event.clientY));
    };
    window.addEventListener("pointermove", sample);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", clearCursor);
    window.addEventListener("blur", clearCursor);
    return () => {
      window.removeEventListener("pointermove", sample);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", clearCursor);
      window.removeEventListener("blur", clearCursor);
    };
  }, [canPlay]);

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
    if (square) {
      const activator = event.activatorEvent;
      dragPointerStart.current =
        "clientX" in activator && "clientY" in activator
          ? { x: Number(activator.clientX), y: Number(activator.clientY) }
          : null;
      heldRef.current = square;
      setHeld(square);
      queueCursor();
    }
  }

  function onDragMove(event: DragMoveEvent) {
    const start = dragPointerStart.current;
    if (!start) return;
    queueCursor(positionOnBoard(start.x + event.delta.x, start.y + event.delta.y));
  }

  function onDragEnd(event: DragEndEvent) {
    const from = parseCell(event.active.id);
    const to = event.over ? parseCell(event.over.id) : null;
    dragPointerStart.current = null;
    heldRef.current = null;
    pointerPressed.current = false;
    queueCursor();
    if (from && to) commit(from, to);
    else setHeld(null);
  }

  function onDragCancel() {
    dragPointerStart.current = null;
    heldRef.current = null;
    pointerPressed.current = false;
    queueCursor();
    setHeld(null);
  }

  const remoteHeld = props.activeCursor?.holding ?? null;
  const cells = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const square = { row, col };
      const lifting = Boolean(
        (held && held.row === row && held.col === col) ||
          (remoteHeld && remoteHeld.row === row && remoteHeld.col === col),
      );
      cells.push(
        <Square
          key={cellId(row, col)}
          row={row}
          col={col}
          man={manAt(paint, square)}
          lifting={lifting}
          canDrag={Boolean(canPlay && manAt(paint, square)?.color === props.you)}
        />,
      );
    }
  }

  const ghost = held ? manAt(paint, held) : undefined;
  const remoteGhost = remoteHeld ? manAt(paint, remoteHeld) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div
        ref={boardRef}
        className="board"
        role="grid"
        data-turn={props.turn}
        data-your-turn={canPlay}
        onPointerDown={onPointerDown}
        onPointerCancel={clearCursor}
      >
        {cells}
        {props.activeCursor && cursorPosition ? (
          <span
            className="board-cursor"
            data-color={props.activeCursor.color}
            style={{
              left: `${cursorPosition.x * 100}%`,
              top: `${cursorPosition.y * 100}%`,
            }}
            aria-hidden="true"
          >
            {remoteGhost ? <Man man={remoteGhost} ghost /> : null}
            <span className={`cursor-hand${props.activeCursor.pressed ? " grabbing" : ""}`}>
              {props.activeCursor.pressed ? "✊" : "🖐"}
            </span>
          </span>
        ) : null}
      </div>
      <DragOverlay dropAnimation={null}>{held && ghost ? <Man man={ghost} ghost /> : null}</DragOverlay>
    </DndContext>
  );
}
