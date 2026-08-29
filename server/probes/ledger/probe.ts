import type { Probe, ProbeContext } from "../types";
import { createLedgerApp } from "./ledger-app";
import { createLedgerStore } from "./ledger-store";

/**
 * Edit one line, watch every derived total move.
 *
 * research/economics.md finding 4 claims server authority reaches a *correct*
 * screen sooner than an optimistic SPA once refetch probability passes about
 * 50%. A ledger is the limiting case: refetch probability is effectively 100%,
 * because there is no line-item edit that leaves any total alone.
 *
 * The document is shared state, so every session re-renders on every edit and
 * there is no per-session state at all. That is deliberate — it is the S3
 * question in its least flattering form.
 */
export async function create(context: ProbeContext): Promise<Probe> {
  const store = await createLedgerStore(context.dataFile("ledger.json"));
  const app = createLedgerApp(store);

  return {
    id: "ledger",
    title: "Ledger",
    forces: "S3, A4",
    subscribe: (listener) => store.onChange(listener),
    createApp: () => ({ app }),
  };
}
