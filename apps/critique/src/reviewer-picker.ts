import { defineIsland } from "socklit/server";

import type { Person } from "./studio";

export const ReviewerPicker = defineIsland<
  { people: Person[]; value: string | null },
  { onPick: (id: string) => void }
>("ReviewerPicker");
