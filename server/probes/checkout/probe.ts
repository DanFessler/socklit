import type { Probe, ProbeContext, SessionContext } from "../types";
import { CheckoutApp, type DraftHome } from "./app";
import { createCheckoutStore, type CheckoutStore } from "./store";

/**
 * S4 / A8: what is a session, and does anything outlive the socket?
 *
 * Four-step checkout. Catalog and orders are the store. The wizard has three
 * homes:
 *
 *   ?draft=durable  default. `useDurable("wizard")`. This tab survives
 *                   reconnect. A second tab does not share, unless
 *                   `?share=user`.
 *   ?draft=state    `useState`. Dies on disconnect.
 *   ?draft=store    a per-user row in the JSON file. Survives reconnect.
 *                   Every tab of that user shares the row.
 *
 * The help note is always `useState`. `?user=` names the shopper. The
 * replica sends `?socklit_tab=`.
 */

export type CheckoutProbeOptions = {
  store?: CheckoutStore;
};

export function createCheckoutProbe(options: CheckoutProbeOptions = {}): Probe {
  const store = options.store;
  if (!store) {
    throw new Error("createCheckoutProbe requires a store");
  }

  return {
    id: "checkout",
    title: "Checkout wizard",
    forces: "S4, A8",
    subscribe: (listener) => store.onChange(listener),
    createApp: (session: SessionContext) => {
      const user = (session.params.get("user") ?? "guest").slice(0, 40);
      const requested = session.params.get("draft");
      const home: DraftHome =
        requested === "state" || requested === "store" ? requested : "durable";
      const share = session.params.get("share") === "user" ? "user" : "tab";
      return { app: () => CheckoutApp({ store, user, home, share }) };
    },
  };
}

export async function create(context: ProbeContext): Promise<Probe> {
  const store = await createCheckoutStore(context.dataFile("checkout.json"));
  return createCheckoutProbe({ store });
}
