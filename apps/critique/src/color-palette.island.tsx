import { useEffect, useRef, useState } from "react";

type Swatch = { id: string; name: string; hex: string };

export function ColorPalette(props: {
  colors: Swatch[];
  value: string;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current =
    props.colors.find((swatch) => swatch.id === props.value) ?? props.colors[0];

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!current) return null;

  return (
    <div className="palette" ref={rootRef}>
      <button
        type="button"
        className="palette-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((next) => !next)}
      >
        <span className="palette-swatch" style={{ background: current.hex }} />
        {current.name}
      </button>
      {open ? (
        <div className="palette-tray" role="listbox" aria-label="Color label">
          {props.colors.map((swatch) => {
            const selected = swatch.id === props.value;
            return (
              <button
                key={swatch.id}
                type="button"
                role="option"
                aria-selected={selected}
                className={selected ? "palette-option is-selected" : "palette-option"}
                onClick={() => {
                  props.onPick(swatch.id);
                  setOpen(false);
                }}
              >
                <span className="palette-swatch" style={{ background: swatch.hex }} />
                {swatch.name}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
