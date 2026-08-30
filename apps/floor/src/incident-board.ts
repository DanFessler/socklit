import { defineIsland } from "socklit/server";

import type { IncidentCard } from "./incident-types";

export type { IncidentCard, IncidentStatus, Severity } from "./incident-types";

export const IncidentBoard = defineIsland<
  { incidents: IncidentCard[]; viewerId: string | null },
  {
    onClaim: (id: string) => void;
    onRelease: (id: string) => void;
    onResolve: (id: string) => void;
  }
>("IncidentBoard");
