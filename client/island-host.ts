import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { islandComponents } from "../islands/registry";
import type {
  ClientMessage,
  WireIslandValue,
  WireJson,
} from "../shared/protocol";

export type IslandBridge = {
  send: (message: ClientMessage) => void;
  revision: () => number;
};

export type IslandSpec = {
  instanceId: string;
  hole: number;
  value: WireIslandValue;
};

/**
 * The DOM host for one island hole.
 *
 * lit-html owns this element the way it owns any other hole. React owns
 * everything *inside* it. Disconnecting the element (a snapshot resync, a
 * keyed row leaving) unmounts the React tree, so island state dies with the
 * hole — which is what "the server still owns the tree" means here.
 *
 * No shadow root: Tailwind classes on the island and Radix portals on
 * `document.body` both need the document stylesheet.
 */
class SocklitIsland extends HTMLElement {
  #bridge: IslandBridge | null = null;
  #spec: IslandSpec | null = null;
  #root: Root | null = null;

  get bridge(): IslandBridge | null {
    return this.#bridge;
  }

  set bridge(value: IslandBridge | null) {
    this.#bridge = value;
    this.#sync();
  }

  get spec(): IslandSpec | null {
    return this.#spec;
  }

  set spec(value: IslandSpec | null) {
    this.#spec = value;
    this.#sync();
  }

  connectedCallback(): void {
    this.#sync();
  }

  disconnectedCallback(): void {
    this.#root?.unmount();
    this.#root = null;
  }

  #sync(): void {
    if (!this.isConnected || !this.#bridge || !this.#spec) return;

    const { value } = this.#spec;
    const Component = islandComponents[value.name];
    if (!Component) {
      this.textContent = `unknown island: ${value.name}`;
      return;
    }

    const props: Record<string, unknown> = { ...value.props };
    for (const name of value.events) {
      const bridge = this.#bridge;
      const spec = this.#spec;
      props[name] = (...args: unknown[]) => {
        const encoded = encodeArgs(args);
        if (!encoded) {
          console.error(`island ${value.name}.${name} received a non-JSON argument`);
          return;
        }
        bridge.send({
          type: "island",
          revision: bridge.revision(),
          instanceId: spec.instanceId,
          hole: spec.hole,
          event: name,
          args: encoded,
        });
      };
    }

    this.#root ??= createRoot(this);
    this.#root.render(createElement(Component, props));
  }
}

function encodeArgs(args: unknown[]): WireJson[] | null {
  try {
    const encoded: unknown = JSON.parse(JSON.stringify(args));
    return Array.isArray(encoded) ? (encoded as WireJson[]) : null;
  } catch {
    return null;
  }
}

if (!customElements.get("socklit-island")) {
  customElements.define("socklit-island", SocklitIsland);
}
