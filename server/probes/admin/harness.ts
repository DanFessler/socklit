import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";

import type {
  ClientMessage,
  EventPayload,
  ServerMessage,
  WireInstance,
} from "../../../shared/protocol";
import { escapeKey } from "../../keyed";
import { RuntimeMetrics, type MetricsSnapshot } from "../../metrics";
import type { Probe, ProbeContext } from "../types";
import { Runtime } from "../../runtime";
import { create } from "./probe";

/**
 * A scripted browser for the admin probe.
 *
 * It holds the same replica the real client holds — a template cache plus the
 * instance tree — so it can address a control the way a browser does, by
 * instance id and hole. Controls are found through the `data-probe` markers in
 * the templates, which is why every interactive element in `admin-app.ts`
 * carries one.
 *
 * The point of it is the accounting: every interaction reports what it cost on
 * the wire and in server render time, which is what the write-up needs.
 */

export type Address = { instanceId: string; hole: number };

export type Interaction = {
  label: string;
  /** One event message. Every one of these is a round trip. */
  bytesOut: number;
  bytesIn: number;
  /** Server frames produced in reply: usually one `update`. */
  frames: number;
  operations: number;
  templates: number;
  renderMicroseconds: number;
  nodes: number;
};

class HarnessSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  readonly sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close");
  }

  receive(message: ClientMessage): void {
    this.emit("message", JSON.stringify(message), false);
  }

  asWebSocket(): WebSocket {
    return this as unknown as WebSocket;
  }
}

const MARKER = /data-probe(?:-[a-z])?="([^"]*)"/g;

/** The browser half of one connection, plus per-interaction accounting. */
export class HarnessClient {
  private readonly socket: HarnessSocket;
  private readonly runtime: Runtime;
  private readonly metrics: RuntimeMetrics;
  private readonly templates = new Map<number, string[]>();
  private readonly instances = new Map<string, WireInstance>();

  private tree: WireInstance | null = null;
  private currentRevision = 0;

  /** Bytes the server sent to reach the first painted frame. */
  connectBytes = { templates: 0, snapshot: 0 };

  constructor(socket: HarnessSocket, runtime: Runtime, metrics: RuntimeMetrics) {
    this.socket = socket;
    this.runtime = runtime;
    this.metrics = metrics;
  }

  get revision(): number {
    return this.currentRevision;
  }

  get root(): WireInstance {
    if (!this.tree) throw new Error("no snapshot has been received");
    return this.tree;
  }

  /** The markup the browser would paint, rebuilt from templates and holes. */
  markup(): string {
    return this.tree ? this.renderInstance(this.tree) : "";
  }

  /** What the operator can actually read on screen. */
  text(): string {
    return this.markup()
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Keys of every rendered row, in render order. */
  rowKeys(): string[] {
    const keys: string[] = [];
    const walk = (instance: WireInstance): void => {
      for (const value of instance.values) {
        if (typeof value !== "object" || value === null) continue;
        if (value.kind === "instance") {
          walk(value.instance);
        } else if (value.kind === "list") {
          for (const item of value.items) {
            if (item.instance.id.includes("/k:acc-")) keys.push(item.key);
            walk(item.instance);
          }
        }
      }
    };
    if (this.tree) walk(this.tree);
    return keys;
  }

  has(name: string, key?: string): boolean {
    return this.find(name, key) !== null;
  }

  control(name: string, key?: string): Address {
    const address = this.find(name, key);
    if (!address) {
      throw new Error(
        `no control "${name}"${key ? ` for ${key}` : ""} in the rendered tree`,
      );
    }
    return address;
  }

  /** How many controls carry this marker, for select-all style assertions. */
  count(name: string): number {
    return this.addresses(name).length;
  }

  async click(name: string, key?: string): Promise<Interaction> {
    return this.fire(name, { kind: "click" }, key);
  }

  async check(
    name: string,
    checked: boolean,
    key?: string,
  ): Promise<Interaction> {
    return this.fire(name, { kind: "change", checked }, key);
  }

  async choose(name: string, value: string, key?: string): Promise<Interaction> {
    return this.fire(name, { kind: "change", value }, key);
  }

  async submit(
    name: string,
    fields: Record<string, string>,
  ): Promise<Interaction> {
    return this.fire(name, { kind: "submit", fields });
  }

  /** Sends one event and waits for the server to finish reacting to it. */
  async fire(
    name: string,
    payload: EventPayload,
    key?: string,
  ): Promise<Interaction> {
    const target = this.control(name, key);
    const message: ClientMessage = {
      type: "event",
      revision: this.currentRevision,
      instanceId: target.instanceId,
      hole: target.hole,
      payload,
    };

    const before = this.metrics.snapshot();
    const bytesOut = JSON.stringify(message).length;

    this.socket.receive(message);
    await this.runtime.whenIdle();

    const received = this.absorb();
    const after = this.metrics.snapshot();

    return {
      label: key ? `${name} (${key})` : name,
      bytesOut,
      bytesIn: received.bytes,
      frames: received.frames,
      operations: received.operations,
      templates: received.templates,
      renderMicroseconds: Math.round(
        after.renderMicroseconds - before.renderMicroseconds,
      ),
      nodes: after.nodes - before.nodes,
    };
  }

  /**
   * Applies whatever the server has sent since the last call.
   *
   * Deliberately the same operations the browser applies, so an address that
   * resolves here resolves there too.
   */
  absorb(): {
    bytes: number;
    frames: number;
    operations: number;
    templates: number;
  } {
    let bytes = 0;
    let frames = 0;
    let operations = 0;
    let templates = 0;

    for (const raw of this.socket.sent.splice(0, this.socket.sent.length)) {
      bytes += raw.length;
      frames += 1;

      const message = JSON.parse(raw) as ServerMessage;
      switch (message.type) {
        case "templates":
          templates += message.templates.length;
          this.registerTemplates(message.templates);
          break;
        case "snapshot":
          this.currentRevision = message.revision;
          this.tree = message.root;
          this.reindex();
          break;
        case "update":
          templates += message.templates.length;
          operations += message.operations.length;
          this.registerTemplates(message.templates);
          this.currentRevision = message.revision;
          this.applyOperations(message);
          this.reindex();
          break;
        case "error":
          throw new Error(`server rejected the interaction: ${message.message}`);
      }
    }

    return { bytes, frames, operations, templates };
  }

  disconnect(): void {
    this.socket.close();
  }

  private renderInstance(instance: WireInstance): string {
    const strings = this.templates.get(instance.templateId);
    if (!strings) {
      throw new Error(`instance ${instance.id} references an unknown template`);
    }

    return strings
      .map((chunk, index) => {
        const value = instance.values[index];
        return value === undefined ? chunk : chunk + this.renderValue(value);
      })
      .join("");
  }

  private renderValue(value: WireInstance["values"][number]): string {
    if (value === null) return "";
    if (typeof value !== "object") return String(value);

    if (value.kind === "event") return "";
    if (value.kind === "focus") return "";
    if (value.kind === "island") return "";
    if (value.kind === "instance") return this.renderInstance(value.instance);
    return value.items
      .map((item) => this.renderInstance(item.instance))
      .join("");
  }

  private registerTemplates(
    templates: ReadonlyArray<{ id: number; strings: string[] }>,
  ): void {
    for (const template of templates) {
      if (!this.templates.has(template.id)) {
        this.templates.set(template.id, template.strings);
      }
    }
  }

  private applyOperations(
    message: Extract<ServerMessage, { type: "update" }>,
  ): void {
    for (const operation of message.operations) {
      const target = this.instances.get(operation.instanceId);
      if (!target) {
        throw new Error(`patch addressed unknown ${operation.instanceId}`);
      }

      if (operation.op === "replace") {
        target.templateId = operation.instance.templateId;
        target.values = operation.instance.values;
        continue;
      }

      target.values[operation.hole] = operation.value;
    }
  }

  private reindex(): void {
    this.instances.clear();
    if (this.tree) this.index(this.tree);
  }

  private index(instance: WireInstance): void {
    this.instances.set(instance.id, instance);
    for (const value of instance.values) {
      if (typeof value !== "object" || value === null) continue;
      if (value.kind === "instance") {
        this.index(value.instance);
      } else if (value.kind === "list") {
        for (const item of value.items) this.index(item.instance);
      }
    }
  }

  private find(name: string, key?: string): Address | null {
    const candidates = this.addresses(name);
    if (key === undefined) return candidates[0] ?? null;

    const segment = `k:${escapeKey(key)}`;
    return (
      candidates.find((address) =>
        address.instanceId.split("/").includes(segment),
      ) ?? null
    );
  }

  private addresses(name: string): Address[] {
    const found: Address[] = [];

    for (const instance of this.instances.values()) {
      instance.values.forEach((value, hole) => {
        if (typeof value !== "object" || value === null) return;
        if (value.kind !== "event") return;
        if (this.marker(instance.templateId, hole) !== name) return;
        found.push({ instanceId: instance.id, hole });
      });
    }

    return found;
  }

  /**
   * The nearest `data-probe` marker before a hole.
   *
   * Everything up to and including the static text in front of the hole is
   * searched, so a marker placed immediately before a handler binding names
   * that handler even when the element carries two of them.
   */
  private marker(templateId: number, hole: number): string | null {
    const strings = this.templates.get(templateId);
    if (!strings) return null;

    const before = strings.slice(0, hole + 1).join("");
    let last: string | null = null;
    for (const match of before.matchAll(MARKER)) {
      last = match[1] ?? null;
    }
    return last;
  }
}

export class AdminHarness {
  readonly probe: Probe;
  readonly runtime: Runtime;
  readonly metrics: RuntimeMetrics;

  private readonly clients: HarnessClient[] = [];

  constructor(probe: Probe, runtime: Runtime, metrics: RuntimeMetrics) {
    this.probe = probe;
    this.runtime = runtime;
    this.metrics = metrics;
  }

  async connect(params: Record<string, string> = {}): Promise<HarnessClient> {
    const socket = new HarnessSocket();
    const client = new HarnessClient(socket, this.runtime, this.metrics);

    this.runtime.attach(socket.asWebSocket(), new URLSearchParams(params));
    await this.runtime.whenIdle();

    const first = socket.sent.map((raw) => JSON.parse(raw) as ServerMessage);
    client.connectBytes = {
      templates: sumBytes(socket.sent, first, "templates"),
      snapshot: sumBytes(socket.sent, first, "snapshot"),
    };
    client.absorb();

    this.clients.push(client);
    return client;
  }

  snapshot(): MetricsSnapshot {
    return this.metrics.snapshot();
  }

  dispose(): void {
    for (const client of this.clients) client.disconnect();
    this.runtime.dispose();
  }
}

/** Boots the real probe against a throwaway data directory. */
export async function createAdminHarness(
  directory: string,
): Promise<AdminHarness> {
  const context: ProbeContext = {
    dataFile: (name) => `${directory}/${name}`,
    log: () => {},
  };

  const probe = await create(context);
  const metrics = new RuntimeMetrics();
  const runtime = new Runtime({
    createApp: (session) => probe.createApp(session),
    ...(probe.subscribe ? { subscribe: probe.subscribe } : {}),
    metrics,
  });

  return new AdminHarness(probe, runtime, metrics);
}

function sumBytes(
  raw: readonly string[],
  parsed: readonly ServerMessage[],
  type: ServerMessage["type"],
): number {
  return parsed.reduce(
    (total, message, index) =>
      message.type === type ? total + (raw[index]?.length ?? 0) : total,
    0,
  );
}
