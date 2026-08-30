import { defineIsland } from "socklit/server";

import type { Person } from "./staff";

/** Server-side contract only. The React file is registered on the client. */
export const StaffPicker = defineIsland<
  { people: Person[]; value: string | null },
  { onPick: (id: string) => void }
>("StaffPicker");
