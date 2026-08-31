import { html, nothing, render, type TemplateResult } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";

import { focusTarget } from "./focus";
import { finish } from "./island-calls";
import type { IslandBridge } from "./island-host";
import {
  isWireEventValue,
  isWireFocusValue,
  isWireInstanceValue,
  isWireIslandValue,
  isWireListValue,
  type ChangePayload,
  type ClientMessage,
  type EventPayload,
  type PatchOperation,
  type ServerMessage,
  type WireInstance,
  type WireTemplate,
  type WireValue,
} from "../shared/protocol";

export type ServerErrorMessage = Extract<ServerMessage, { type: "error" }>;

export type ClientRuntimeOptions = {
  mount: HTMLElement;
  send: (message: ClientMessage) => void;
  onError?: (message: ServerErrorMessage) => void;
};

/**
 * The browser half of the replica.
 *
 * It holds no application logic. It caches template layouts, keeps a mirror of
 * the server's instance tree, and hands that tree to lit-html for DOM updates.
 * Interaction is forwarded upward as an address plus a sanitized payload.
 */
export class ClientRuntime {
  private readonly mount: HTMLElement;
  private readonly send: (message: ClientMessage) => void;
  private readonly onError: ((message: ServerErrorMessage) => void) | undefined;

  private readonly templates = new Map<number, TemplateStringsArray>();
  private readonly instances = new Map<string, WireInstance>();
  private readonly dispatchers = new Map<string, EventListener>();

  private root: WireInstance | null = null;
  private currentRevision = 0;
  private readonly bridge: IslandBridge;

  constructor(options: ClientRuntimeOptions) {
    this.mount = options.mount;
    this.send = options.send;
    this.onError = options.onError;
    this.bridge = {
      send: options.send,
      revision: () => this.currentRevision,
      paintSlot: (element, instance) => {
        render(this.rehydrate(instance), element);
      },
    };
  }

  get revision(): number {
    return this.currentRevision;
  }

  get templateCount(): number {
    return this.templates.size;
  }

  apply(message: ServerMessage): void {
    switch (message.type) {
      case "templates":
        this.registerTemplates(message.templates);
        return;

      case "snapshot":
        this.currentRevision = message.revision;
        this.setRoot(message.root);
        return;

      case "update":
        this.registerTemplates(message.templates);
        this.currentRevision = message.revision;
        this.applyOperations(message.operations);
        this.reindex();
        this.paint();
        return;

      case "error":
        this.onError?.(message);
        return;

      case "credential":
        return;

      case "island-result":
        finish(message.call, message.result, message.error);
        return;
    }
  }

  /**
   * Caches one template layout forever under a single array identity.
   *
   * lit-html keys its compiled templates on the identity of the strings array,
   * so reusing the same array is what makes later renders update parts in place
   * instead of rebuilding the DOM.
   */
  private registerTemplates(templates: WireTemplate[]): void {
    for (const template of templates) {
      if (this.templates.has(template.id)) continue;

      const strings = [...template.strings];
      Object.defineProperty(strings, "raw", { value: [...template.strings] });
      this.templates.set(template.id, strings as unknown as TemplateStringsArray);
    }
  }

  /**
   * A snapshot is an authoritative resync. Any previously rendered DOM is torn
   * down first so local interaction that the server did not accept, such as a
   * checkbox the browser toggled optimistically, cannot survive as stale state.
   */
  private setRoot(root: WireInstance): void {
    if (this.root) {
      render(nothing, this.mount);
      this.dispatchers.clear();
    }

    this.root = root;
    this.reindex();
    this.paint();
  }

  private applyOperations(operations: PatchOperation[]): void {
    for (const operation of operations) {
      const target = this.instances.get(operation.instanceId);
      if (!target) {
        throw new Error(
          `patch addressed unknown instance ${operation.instanceId}`,
        );
      }

      if (operation.op === "replace") {
        // Mutated in place so the parent hole keeps referencing this instance.
        target.templateId = operation.instance.templateId;
        target.values = operation.instance.values;
        continue;
      }

      if (operation.hole >= target.values.length) {
        throw new Error(
          `patch addressed hole ${operation.hole} outside instance ${operation.instanceId}`,
        );
      }

      // A shell-only island patch omits `slot` so the hosted tree survives
      // a trigger-label change. Merge the existing slot back in.
      if (
        operation.op === "set" &&
        isWireIslandValue(operation.value) &&
        operation.value.slot === undefined
      ) {
        const current = target.values[operation.hole];
        if (
          current !== undefined &&
          isWireIslandValue(current) &&
          current.slot
        ) {
          target.values[operation.hole] = {
            ...operation.value,
            slot: current.slot,
          };
          continue;
        }
      }

      // `set` and `list` differ only in intent: one replaces a hole's value,
      // the other announces that a keyed sequence changed shape.
      target.values[operation.hole] = operation.value;
    }
  }

  private reindex(): void {
    this.instances.clear();
    if (this.root) {
      this.indexInstance(this.root);
    }

    for (const key of [...this.dispatchers.keys()]) {
      const instanceId = key.slice(0, key.lastIndexOf("#"));
      if (!this.instances.has(instanceId)) {
        this.dispatchers.delete(key);
      }
    }
  }

  private indexInstance(instance: WireInstance): void {
    this.instances.set(instance.id, instance);

    for (const value of instance.values) {
      if (isWireInstanceValue(value)) {
        this.indexInstance(value.instance);
      } else if (isWireListValue(value)) {
        for (const item of value.items) {
          this.indexInstance(item.instance);
        }
      } else if (isWireIslandValue(value) && value.slot) {
        this.indexInstance(value.slot);
      }
    }
  }

  private paint(): void {
    if (!this.root) return;
    render(this.rehydrate(this.root), this.mount);
  }

  private rehydrate(instance: WireInstance): TemplateResult {
    const strings = this.templates.get(instance.templateId);
    if (!strings) {
      throw new Error(`instance ${instance.id} references an unknown template`);
    }

    const values = instance.values.map((value, hole) =>
      this.rehydrateValue(instance.id, hole, value),
    );

    return html(strings, ...values);
  }

  private rehydrateValue(
    instanceId: string,
    hole: number,
    value: WireValue,
  ): unknown {
    if (isWireEventValue(value)) {
      return this.dispatcher(instanceId, hole);
    }
    if (isWireInstanceValue(value)) {
      return this.rehydrate(value.instance);
    }
    if (isWireListValue(value)) {
      return repeat(
        value.items,
        (item) => item.key,
        (item) => this.rehydrate(item.instance),
      );
    }
    if (isWireFocusValue(value)) {
      return focusTarget(value.active, value.nonce);
    }
    if (isWireIslandValue(value)) {
      return html`<socklit-island
        .bridge=${this.bridge}
        .spec=${{ instanceId, hole, value }}
      ></socklit-island>`;
    }
    return value;
  }

  /** One stable listener per address, so patches never churn DOM listeners. */
  private dispatcher(instanceId: string, hole: number): EventListener {
    const key = `${instanceId}#${hole}`;
    const existing = this.dispatchers.get(key);
    if (existing) return existing;

    const listener: EventListener = (event: Event) => {
      if (event.type === "submit") {
        event.preventDefault();
      }

      this.send({
        type: "event",
        revision: this.currentRevision,
        instanceId,
        hole,
        payload: describeEvent(event),
      });

      // The draft text belongs to the browser, so it is cleared locally rather
      // than being round-tripped through the server.
      if (event.type === "submit" && event.currentTarget instanceof HTMLFormElement) {
        event.currentTarget.reset();
      }
    };

    this.dispatchers.set(key, listener);
    return listener;
  }
}

/**
 * Reduces a DOM event to the small, transport-safe vocabulary of the protocol.
 *
 * Exported for testing. The order of the branches is the whole substance of it,
 * so it is worth asserting somewhere other than in a browser.
 */
export function describeEvent(event: Event): EventPayload {
  // Checked before the fallthrough to `change`, which would otherwise describe
  // a key press as an edit and report the value before the key was applied.
  if (isKeyboardEvent(event)) {
    return {
      kind: "key",
      key: event.key,
      alt: event.altKey,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      shift: event.shiftKey,
      repeat: event.repeat,
    };
  }

  if (event.type === "focus" || event.type === "focusin") {
    return { kind: "focus" };
  }
  if (event.type === "blur" || event.type === "focusout") {
    return { kind: "blur" };
  }

  if (event.type === "submit") {
    const fields: Record<string, string> = {};
    if (event.currentTarget instanceof HTMLFormElement) {
      for (const [name, value] of new FormData(event.currentTarget)) {
        if (typeof value === "string") {
          fields[name] = value;
        }
      }
    }
    return { kind: "submit", fields };
  }

  if (event.type === "click") {
    return { kind: "click" };
  }

  const payload: ChangePayload = { kind: "change" };
  const target = event.currentTarget;

  if (target instanceof HTMLInputElement) {
    payload.value = target.value;
    if (target.type === "checkbox" || target.type === "radio") {
      payload.checked = target.checked;
    }
  } else if (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    payload.value = target.value;
  }

  return payload;
}

/**
 * Structural rather than `instanceof KeyboardEvent`.
 *
 * The constructor is not reachable in every environment this runtime is tested
 * in, and the three properties below are the whole contract we need.
 */
function isKeyboardEvent(event: Event): event is KeyboardEvent {
  return (
    (event.type === "keydown" ||
      event.type === "keyup" ||
      event.type === "keypress") &&
    typeof (event as KeyboardEvent).key === "string"
  );
}
