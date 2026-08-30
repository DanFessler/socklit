import * as Select from "@radix-ui/react-select";

const TONE: Record<string, string> = {
  low: "text-slate-300",
  medium: "text-amber-300",
  high: "text-orange-300",
  urgent: "text-rose-300",
};

/**
 * A Radix select. Opening it, moving with arrows, and dismissing with
 * Escape never touch the socket. Choosing a value calls `onChange`, which
 * is a stub for a server closure.
 */
export function PrioritySelect(props: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select.Root value={props.value} onValueChange={props.onChange}>
      <Select.Trigger
        className="inline-flex h-8 min-w-[7.5rem] items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 text-sm hover:border-[var(--accent)]"
        aria-label="Priority"
      >
        <Select.Value />
        <Select.Icon className="text-[var(--text-muted)]">▾</Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] shadow-lg"
        >
          <Select.Viewport className="p-1">
            {props.options.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-[var(--surface)] ${TONE[option.value] ?? ""}`}
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="text-[var(--text)]">
                  ✓
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
