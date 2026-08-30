import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";

import { Slot } from "./slot";

/**
 * A client-owned overlay that hosts a server tree.
 *
 * `open` is React state. The names inside `<Slot />` are not — they are
 * replica-painted templates with server closures. Changing the team filter
 * (itself in the slot) patches that tree without remounting this popover.
 */
export function AssigneePicker(props: { label: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className="inline-flex h-8 max-w-[9rem] items-center truncate rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 text-sm hover:border-[var(--accent)]"
        aria-label="Assign"
      >
        {props.label}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          align="end"
          className="z-50 w-72 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-2 shadow-lg"
        >
          <Slot />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
