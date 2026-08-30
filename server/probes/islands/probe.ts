import type { Probe, ProbeContext } from "../types";
import { createIslandsApp } from "./app";
import { createCardStore } from "./store";

/**
 * A3: what does an open client island look like to write, and can a
 * real browser library sit behind it without the RSC confusion.
 */
export async function create(context: ProbeContext): Promise<Probe> {
  const cards = await createCardStore(context.dataFile("cards.json"));

  return {
    id: "islands",
    title: "Client islands",
    forces: "A3",
    subscribe: (listener) => cards.onChange(listener),
    createApp: () => ({ app: createIslandsApp(cards) }),
  };
}
