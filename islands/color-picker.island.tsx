import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";

/**
 * A colour swatch that opens a Radix popover.
 *
 * `open` is React state. Clicking a swatch is instant dismissal plus a
 * server write. The server never learns the popover existed.
 */
export function ColorPicker(props: {
  value: string;
  swatches: string[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-raised)] hover:border-[var(--accent)]"
        aria-label="Label colour"
        style={{ boxShadow: `inset 0 0 0 3px ${props.value}` }}
      />
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          align="start"
          className="z-50 grid grid-cols-4 gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-2 shadow-lg"
        >
          {props.swatches.map((color) => {
            const selected = color === props.value;
            return (
              <button
                key={color}
                type="button"
                aria-label={color}
                aria-pressed={selected}
                onClick={() => {
                  props.onChange(color);
                  setOpen(false);
                }}
                className={`h-7 w-7 rounded-md border ${
                  selected
                    ? "border-[var(--text)]"
                    : "border-transparent hover:border-[var(--text-muted)]"
                }`}
                style={{ background: color }}
              />
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
