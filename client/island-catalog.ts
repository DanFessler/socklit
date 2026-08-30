import type { ComponentType } from "react";

/**
 * Name → React component. The replica looks up `defineIsland("Name")`
 * here. Apps call `registerIsland` from their client entry. The lab
 * registers its probe islands at boot.
 */
const catalog = new Map<string, ComponentType<Record<string, unknown>>>();

export function registerIsland(
  name: string,
  component: ComponentType<Record<string, unknown>>,
): void {
  catalog.set(name, component);
}

export function lookupIsland(
  name: string,
): ComponentType<Record<string, unknown>> | undefined {
  return catalog.get(name);
}
