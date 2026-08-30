import { defineIsland } from "../server/island";

export type PriorityOption = { value: string; label: string };

/**
 * Contract only. The React implementation is `priority-select.island.tsx`.
 */
export const PrioritySelect = defineIsland<
  { value: string; options: PriorityOption[] },
  { onChange: (value: string) => void }
>("PrioritySelect");
