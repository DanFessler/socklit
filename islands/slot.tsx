import { createContext, createElement, useContext } from "react";

export type IslandAddress = {
  instanceId: string;
  hole: number;
};

export const IslandAddressContext = createContext<IslandAddress | null>(null);

/**
 * A well. The island places it; the replica paints a server tree into it.
 *
 * This is not `children`. The island cannot map it, clone it, or branch
 * on it. It can only say where the box goes. If you render this outside
 * an island, it throws — the well has no meaning without a host.
 */
export function Slot() {
  const address = useContext(IslandAddressContext);
  if (!address) {
    throw new Error(
      "Slot() was rendered outside an island. It marks where the server tree goes.",
    );
  }

  return createElement("socklit-slot", {
    "data-instance": address.instanceId,
    "data-hole": String(address.hole),
  });
}
