import type { Probe, ProbeContext } from "../types";
import { createAccountStore } from "./accounts";
import { createAdminApp } from "./admin-app";
import { AdminUiState } from "./ui-state";

/**
 * Menu-heavy admin console.
 *
 * The records are shared and durable; everything else — the open menu, the
 * hovered tooltip, the selected rows, the dialog, the tab, the sort, the
 * filters — is per-session state built in `createApp` and published with
 * `session.invalidate()`, because every one of them is read by a component
 * other than the one that writes it. The disclosure panels are the exception
 * and keep their collapsed flag in a `useState` of their own.
 *
 * `?user=` names the operator, so two tabs can be compared side by side and the
 * audit log shows who did what.
 */
export async function create(context: ProbeContext): Promise<Probe> {
  const store = await createAccountStore(context.dataFile("accounts.json"));

  return {
    id: "admin",
    title: "Menu-heavy admin",
    forces: "A1, A2, A3",
    subscribe: (listener) => store.onChange(listener),
    createApp: (session) => {
      const ui = new AdminUiState(session.params.get("user") ?? "operator");
      return { app: createAdminApp(store, ui, () => session.invalidate()) };
    },
  };
}
