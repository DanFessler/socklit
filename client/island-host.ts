import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { lookupIsland } from "./island-catalog";
import { IslandAddressContext } from "../islands/slot";
import type {
  ClientMessage,
  WireInstance,
  WireIslandValue,
  WireJson,
} from "../shared/protocol";

export type IslandBridge = {
  send: (message: ClientMessage) => void;
  revision: () => number;
  paintSlot: (element: HTMLElement, instance: WireInstance) => void;
};

export type IslandSpec = {
  instanceId: string;
  hole: number;
  value: WireIslandValue;
};

const painters = new Map<string, (element: HTMLElement) => void>();

function slotKey(instanceId: string, hole: number): string {
  return `${instanceId}#${hole}`;
}

/**
 * The DOM host for one island hole.
 *
 * lit-html owns this element the way it owns any other hole. React owns
 * everything *inside* it. A `<socklit-slot>` placed by the React tree is
 * claimed back by the replica — including when Radix portals it to
 * `document.body`.
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
    if (this.#spec) {
      painters.delete(slotKey(this.#spec.instanceId, this.#spec.hole));
    }
    this.#root?.unmount();
    this.#root = null;
  }

  #sync(): void {
    if (!this.isConnected || !this.#bridge || !this.#spec) return;

    const { instanceId, hole, value } = this.#spec;
    const Component = lookupIsland(value.name);
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

    const key = slotKey(instanceId, hole);
    if (value.slot && this.#bridge) {
      const bridge = this.#bridge;
      const instance = value.slot;
      painters.set(key, (element) => bridge.paintSlot(element, instance));
    } else {
      painters.delete(key);
    }

    // Register the painter before render so a slot that mounts during this
    // commit can claim itself from connectedCallback. Paint afterwards so
    // a React update cannot leave the well empty — React owns the custom
    // element, the replica owns what is inside it.
    this.#root ??= createRoot(this);
    this.#root.render(
      createElement(
        IslandAddressContext.Provider,
        { value: { instanceId, hole } },
        createElement(Component, props),
      ),
    );

    const paint = painters.get(key);
    if (paint) {
      for (const element of document.querySelectorAll("socklit-slot")) {
        if (
          element instanceof HTMLElement &&
          element.dataset["instance"] === instanceId &&
          element.dataset["hole"] === String(hole)
        ) {
          paint(element);
        }
      }
    }
  }
}

class SocklitSlot extends HTMLElement {
  connectedCallback(): void {
    const instanceId = this.dataset["instance"];
    const hole = this.dataset["hole"];
    if (instanceId === undefined || hole === undefined) return;
    painters.get(slotKey(instanceId, Number(hole)))?.(this);
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
if (!customElements.get("socklit-slot")) {
  customElements.define("socklit-slot", SocklitSlot);
}
