import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { createCheckoutProbe } from "../../server/probes/checkout/probe";
import { createCheckoutStore } from "../../server/probes/checkout/store";
import { Runtime } from "../../server/runtime";
import type {
  ClientMessage,
  EventPayload,
  ServerMessage,
  WireInstance,
} from "../../shared/protocol";

class FakeSocket extends EventEmitter {
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

const MARKER = /data-probe="([^"]*)"/g;

class Tab {
  private readonly socket: FakeSocket;
  private readonly runtime: Runtime;
  private readonly templates = new Map<number, string[]>();
  private readonly instances = new Map<string, WireInstance>();
  private tree: WireInstance | null = null;
  private revision = 0;

  constructor(socket: FakeSocket, runtime: Runtime) {
    this.socket = socket;
    this.runtime = runtime;
  }

  async absorb(): Promise<void> {
    for (const raw of this.socket.sent.splice(0, this.socket.sent.length)) {
      const message = JSON.parse(raw) as ServerMessage;
      if (message.type === "templates") {
        for (const template of message.templates) {
          if (!this.templates.has(template.id)) {
            this.templates.set(template.id, template.strings);
          }
        }
      } else if (message.type === "snapshot") {
        this.revision = message.revision;
        this.tree = message.root;
        this.reindex();
      } else if (message.type === "update") {
        for (const template of message.templates) {
          if (!this.templates.has(template.id)) {
            this.templates.set(template.id, template.strings);
          }
        }
        this.revision = message.revision;
        for (const operation of message.operations) {
          const target = this.instances.get(operation.instanceId);
          if (!target) {
            throw new Error(`unknown ${operation.instanceId}`);
          }
          if (operation.op === "replace") {
            target.templateId = operation.instance.templateId;
            target.values = operation.instance.values;
          } else {
            target.values[operation.hole] = operation.value;
          }
        }
        this.reindex();
      } else if (message.type === "error") {
        throw new Error(message.message);
      }
    }
  }

  text(): string {
    return this.markup()
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  async click(name: string, key?: string): Promise<void> {
    await this.fire(name, { kind: "click" }, key);
  }

  async submit(name: string, fields: Record<string, string>): Promise<void> {
    await this.fire(name, { kind: "submit", fields });
  }

  disconnect(): void {
    this.socket.close();
  }

  private async fire(
    name: string,
    payload: EventPayload,
    key?: string,
  ): Promise<void> {
    const target = this.control(name, key);
    this.socket.receive({
      type: "event",
      revision: this.revision,
      instanceId: target.instanceId,
      hole: target.hole,
      payload,
    });
    await this.runtime.whenIdle();
    await this.absorb();
  }

  private control(
    name: string,
    key?: string,
  ): { instanceId: string; hole: number } {
    const found: Array<{ instanceId: string; hole: number }> = [];
    for (const instance of this.instances.values()) {
      const strings = this.templates.get(instance.templateId);
      if (!strings) continue;
      for (let hole = 0; hole < instance.values.length; hole += 1) {
        const value = instance.values[hole];
        if (typeof value !== "object" || value === null) continue;
        if (value.kind !== "event") continue;
        const before = strings.slice(0, hole + 1).join("");
        let last: string | null = null;
        for (const match of before.matchAll(MARKER)) last = match[1] ?? null;
        if (last === name) found.push({ instanceId: instance.id, hole });
      }
    }
    const match =
      key === undefined
        ? found[0]
        : found.find((address) =>
            address.instanceId.split("/").includes(`k:${key}`),
          );
    if (!match) {
      throw new Error(
        `no control "${name}"${key ? ` (${key})` : ""} in ${this.text()}`,
      );
    }
    return match;
  }

  private markup(): string {
    if (!this.tree) return "";
    const render = (instance: WireInstance): string => {
      const strings = this.templates.get(instance.templateId) ?? [""];
      return strings
        .map((chunk, index) => {
          const value = instance.values[index];
          if (value === undefined || value === null) return chunk;
          if (typeof value !== "object") return chunk + String(value);
          if (value.kind === "instance") return chunk + render(value.instance);
          if (value.kind === "list") {
            return (
              chunk +
              value.items.map((item) => render(item.instance)).join("")
            );
          }
          return chunk;
        })
        .join("");
    };
    return render(this.tree);
  }

  private reindex(): void {
    this.instances.clear();
    const walk = (instance: WireInstance): void => {
      this.instances.set(instance.id, instance);
      for (const value of instance.values) {
        if (typeof value !== "object" || value === null) continue;
        if (value.kind === "instance") walk(value.instance);
        else if (value.kind === "list") {
          for (const item of value.items) walk(item.instance);
        }
      }
    };
    if (this.tree) walk(this.tree);
  }
}

type Live = {
  connect: (params: string) => Promise<Tab>;
  dispose: () => Promise<void>;
};

async function live(): Promise<Live> {
  const directory = await mkdtemp(join(tmpdir(), "socklit-checkout-"));
  const store = await createCheckoutStore(join(directory, "checkout.json"));
  const probe = createCheckoutProbe({ store });
  const runtime = new Runtime({
    createApp: probe.createApp,
    ...(probe.subscribe ? { subscribe: probe.subscribe } : {}),
  });

  return {
    async connect(params) {
      const socket = new FakeSocket();
      runtime.attach(socket.asWebSocket(), new URLSearchParams(params));
      await runtime.whenIdle();
      const tab = new Tab(socket, runtime);
      await tab.absorb();
      return tab;
    },
    async dispose() {
      runtime.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function q(params: string, tab: string): string {
  return `${params}&socklit_tab=${tab}`;
}

describe("checkout probe", () => {
  let session: Live | null = null;

  afterEach(async () => {
    await session?.dispose();
    session = null;
  });

  it("drops a useState draft when the socket dies", async () => {
    session = await live();
    const first = await session.connect(q("user=ada&draft=state", "t1"));
    await first.click("add", "mug");
    expect(first.text()).toMatch(/1 in cart/);
    first.disconnect();

    const again = await session.connect(q("user=ada&draft=state", "t1"));
    expect(again.text()).toMatch(/0 in cart/);
    expect(again.text()).toMatch(/Step 1 of 4/);
  });

  it("restores a useDurable draft on reconnect of the same tab", async () => {
    session = await live();
    const first = await session.connect(q("user=ada", "t1"));
    await first.click("add", "mug");
    await first.click("add", "mug");
    await first.click("next");
    expect(first.text()).toMatch(/Step 2 of 4/);
    first.disconnect();

    const again = await session.connect(q("user=ada", "t1"));
    expect(again.text()).toMatch(/2 in cart/);
    expect(again.text()).toMatch(/Step 2 of 4/);
  });

  it("does not share a useDurable draft with a second tab", async () => {
    session = await live();
    const ada = await session.connect(q("user=ada", "t1"));
    const other = await session.connect(q("user=ada", "t2"));
    await ada.click("add", "tote");
    await ada.click("next");
    await other.absorb();
    expect(ada.text()).toMatch(/Step 2 of 4/);
    expect(other.text()).toMatch(/Step 1 of 4/);
    expect(other.text()).toMatch(/0 in cart/);
  });

  it("shares a useDurable draft across tabs when asked", async () => {
    session = await live();
    const ada = await session.connect(q("user=ada&share=user", "t1"));
    const other = await session.connect(q("user=ada&share=user", "t2"));
    await ada.click("add", "tote");
    await ada.click("next");
    await other.absorb();
    expect(other.text()).toMatch(/Step 2 of 4/);
    expect(other.text()).toMatch(/1 in cart/);
  });

  it("restores a store draft on reconnect", async () => {
    session = await live();
    const first = await session.connect(q("user=ada&draft=store", "t1"));
    await first.click("add", "mug");
    await first.click("add", "mug");
    await first.click("next");
    expect(first.text()).toMatch(/Step 2 of 4/);
    first.disconnect();

    const again = await session.connect(q("user=ada&draft=store", "t1"));
    expect(again.text()).toMatch(/2 in cart/);
    expect(again.text()).toMatch(/Step 2 of 4/);
  });

  it("shares a store draft across two tabs of the same user", async () => {
    session = await live();
    const ada = await session.connect(q("user=ada&draft=store", "t1"));
    const other = await session.connect(q("user=ada&draft=store", "t2"));
    await ada.click("add", "tote");
    await ada.click("next");
    await other.absorb();
    expect(other.text()).toMatch(/Step 2 of 4/);
    expect(other.text()).toMatch(/1 in cart/);
  });

  it("keeps two useState tabs independent", async () => {
    session = await live();
    const ada = await session.connect(q("user=ada&draft=state", "t1"));
    const other = await session.connect(q("user=ada&draft=state", "t2"));
    await ada.click("add", "cap");
    await ada.click("next");
    await other.absorb();
    expect(ada.text()).toMatch(/Step 2 of 4/);
    expect(other.text()).toMatch(/Step 1 of 4/);
    expect(other.text()).toMatch(/0 in cart/);
  });

  it("does not share a store draft with another user", async () => {
    session = await live();
    const ada = await session.connect(q("user=ada&draft=store", "t1"));
    const ben = await session.connect(q("user=ben&draft=store", "t2"));
    await ada.click("add", "mug");
    await ben.absorb();
    expect(ben.text()).toMatch(/0 in cart/);
  });

  it("always drops the help flag, even when the draft is durable", async () => {
    session = await live();
    const first = await session.connect(q("user=ada", "t1"));
    await first.click("add", "mug");
    await first.click("help");
    expect(first.text()).toMatch(/laptop sleeping/);
    first.disconnect();

    const again = await session.connect(q("user=ada", "t1"));
    expect(again.text()).toMatch(/1 in cart/);
    expect(again.text()).not.toMatch(/laptop sleeping/);
  });

  it("keeps a placed order after reconnect when the draft was useState", async () => {
    session = await live();
    await placeOne(session, "state");
  });

  it("keeps a placed order after reconnect when the draft was durable", async () => {
    session = await live();
    await placeOne(session, "durable");
  });

  it("keeps a placed order after reconnect when the draft was stored", async () => {
    session = await live();
    await placeOne(session, "store");
  });
});

async function placeOne(
  session: Live,
  home: "state" | "store" | "durable",
): Promise<void> {
  const tab = await session.connect(q(`user=ada&draft=${home}`, "t1"));
  await tab.click("add", "mug");
  await tab.click("next");
  await tab.submit("address", {
    name: "Ada",
    street: "1 Main",
    city: "Portland",
  });
  expect(tab.text()).toMatch(/Step 3 of 4/);
  await tab.submit("pay", { last4: "4242" });
  expect(tab.text()).toMatch(/Step 4 of 4/);
  await tab.click("place");
  expect(tab.text()).toMatch(/ord-/);
  expect(tab.text()).toMatch(/ending 4242/);
  tab.disconnect();

  const again = await session.connect(q(`user=ada&draft=${home}`, "t1"));
  expect(again.text()).toMatch(/ending 4242/);
  expect(again.text()).toMatch(/0 in cart/);
}
