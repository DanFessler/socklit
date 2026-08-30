import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createOddsBoard,
  TAKE_SIZE,
  type QuoteBinding,
} from "../../server/probes/odds/board";
import {
  createOddsLedger,
  quoteKey,
  type OddsLedger,
} from "../../server/probes/odds/ledger";
import {
  MarketSimulator,
  formatPrice,
  MAX_TAKE_SIZE,
  type Resolution,
} from "../../server/probes/odds/market";
import { create } from "../../server/probes/odds/probe";
import { Runtime } from "../../server/runtime";
import { serialize, TemplateRegistry } from "../../server/serialize";
import type {
  ClientMessage,
  ServerMessage,
  WireInstance,
} from "../../shared/protocol";

/** Stands in for a `ws` socket, capturing everything the session sends. */
class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  readonly sent: ServerMessage[] = [];

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerMessage);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close");
  }

  receive(message: ClientMessage): void {
    this.emit("message", JSON.stringify(message), false);
  }

  take(): ServerMessage[] {
    return this.sent.splice(0, this.sent.length);
  }

  find<T extends ServerMessage["type"]>(
    type: T,
  ): Extract<ServerMessage, { type: T }> | undefined {
    return this.sent.find((message) => message.type === type) as
      | Extract<ServerMessage, { type: T }>
      | undefined;
  }
}

function findInstance(
  instance: WireInstance,
  predicate: (candidate: WireInstance) => boolean,
): WireInstance | undefined {
  if (predicate(instance)) return instance;

  for (const value of instance.values) {
    if (typeof value !== "object" || value === null) continue;
    if (value.kind === "instance") {
      const found = findInstance(value.instance, predicate);
      if (found) return found;
    } else if (value.kind === "list") {
      for (const item of value.items) {
        const found = findInstance(item.instance, predicate);
        if (found) return found;
      }
    }
  }
  return undefined;
}

function eventHoles(instance: WireInstance): number[] {
  return instance.values.flatMap((value, hole) =>
    typeof value === "object" && value !== null && value.kind === "event"
      ? [hole]
      : [],
  );
}

/** Matches a row address whether or not the quote generation seeds its key. */
function rowPattern(marketId: string): RegExp {
  return new RegExp(`k:${marketId}(%3A\\d+)?$`);
}

/** Addresses a market's buy or sell button the way the browser would. */
function takeAddress(
  root: WireInstance,
  marketId: string,
  side: "buy" | "sell",
): { instanceId: string; hole: number } {
  const pattern = rowPattern(marketId);
  const row = findInstance(root, (candidate) => pattern.test(candidate.id));
  if (!row) throw new Error(`no row for ${marketId}`);

  // Template order: the sell handler precedes the buy handler.
  const holes = eventHoles(row);
  const hole = side === "sell" ? holes[0] : holes[1];
  if (hole === undefined) throw new Error(`no ${side} handler on ${marketId}`);

  return { instanceId: row.id, hole };
}

function snapshotOf(socket: FakeSocket): WireInstance {
  const snapshot = socket.find("snapshot");
  if (snapshot?.type !== "snapshot") throw new Error("expected a snapshot");
  return snapshot.root;
}

describe("odds board", () => {
  let directory: string;
  let simulator: MarketSimulator;
  let ledger: OddsLedger;
  let runtime: Runtime;
  let clock: number;
  let started: Runtime[];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "socklit-odds-"));
    clock = 1_700_000_000_000;
    simulator = new MarketSimulator({
      markets: 6,
      tapeSize: 4,
      seed: 11,
      // Synthetic flow is off so a tick only moves prices: the structure of the
      // tree is then fixed and any patch must be a value.
      printChance: 0,
      moveChance: 1,
      now: () => clock,
    });
    ledger = await createOddsLedger(join(directory, "ledger.json"));
    started = [];
    runtime = buildRuntime("value");
  });

  afterEach(async () => {
    for (const live of started) live.dispose();
    simulator.stop();
    await rm(directory, { recursive: true, force: true });
  });

  function buildRuntime(quoteBinding: QuoteBinding): Runtime {
    const built = new Runtime({
      createApp: (session) => ({
        app: createOddsBoard({
          simulator,
          ledger,
          account: session.params.get("user") ?? `acct-${session.id}`,
          showAccount: session.params.get("mine") === "1",
          tickMs: 250,
          quoteBinding,
        }),
      }),
      subscribe: (listener) => {
        const stopTicks = simulator.onTick(listener);
        const stopLedger = ledger.onChange(listener);
        return () => {
          stopTicks();
          stopLedger();
        };
      },
    });

    started.push(built);
    return built;
  }

  async function connect(query = "", host = runtime): Promise<FakeSocket> {
    const socket = new FakeSocket();
    host.attach(socket as unknown as WebSocket, new URLSearchParams(query));
    await host.whenIdle();
    return socket;
  }

  /** Ticks until one market's offer actually changes, and reports the new one. */
  function advanceUntilPriceMoves(marketId: string, from: number): number {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      clock += 250;
      simulator.tick();
      const current = simulator.state.markets.find(
        (candidate) => candidate.id === marketId,
      );
      if (current && current.ask !== from) return current.ask;
    }
    throw new Error(`market ${marketId} never moved`);
  }

  it("replicates a price tick as hole values only", async () => {
    const socket = await connect();
    socket.take();

    clock += 250;
    simulator.tick();
    await runtime.whenIdle();

    const update = socket.find("update");
    if (update?.type !== "update") throw new Error("expected an update");

    // Layout was already cached, the key sequence did not move, and no subtree
    // was replaced: prices are pure value replication.
    expect(update.templates).toEqual([]);
    expect(update.operations.length).toBeGreaterThan(0);
    expect(update.operations.every((operation) => operation.op === "set")).toBe(
      true,
    );
    expect(JSON.stringify(update)).not.toContain("<");
  });

  it("carries a tick stamp every session can be timed against", async () => {
    const first = await connect();
    const second = await connect();
    first.take();
    second.take();

    clock += 250;
    simulator.tick();
    await runtime.whenIdle();

    const stamps = [first, second].map((socket) => {
      const update = socket.find("update");
      if (update?.type !== "update") throw new Error("expected an update");
      const operation = update.operations.find(
        (candidate) =>
          candidate.op === "set" &&
          typeof candidate.value === "string" &&
          candidate.value.startsWith("t"),
      );
      return operation && operation.op === "set" ? operation.value : null;
    });

    expect(stamps[0]).toBe(`t1@${clock.toFixed(3)}`);
    expect(stamps[1]).toBe(stamps[0]);
  });

  it("renders byte-identical trees for every session by default", async () => {
    const registry = new TemplateRegistry();
    const app = (id: string, query: string): WireInstance =>
      serialize(
        createOddsBoard({
          simulator,
          ledger,
          account: `acct-${id}`,
          showAccount: query.includes("mine=1"),
          tickMs: 250,
        })(),
        registry,
      ).root;

    const plain = [app("a", ""), app("b", ""), app("c", "")];
    expect(new Set(plain.map((tree) => JSON.stringify(tree))).size).toBe(1);

    const personalized = [app("a", "mine=1"), app("b", "mine=1")];
    expect(
      new Set(personalized.map((tree) => JSON.stringify(tree))).size,
    ).toBe(2);

    // The divergence is confined to the account subtree: the market rows are
    // still identical, which is the whole argument for sharing per subtree.
    const rowOf = (tree: WireInstance): string =>
      JSON.stringify(
        findInstance(tree, (candidate) => candidate.id.endsWith("k:m1")),
      );
    expect(rowOf(personalized[0] as WireInstance)).toBe(
      rowOf(personalized[1] as WireInstance),
    );
  });

  it("fills a take at the quoted price and books the position", async () => {
    const socket = await connect("mine=1&user=ann");
    const root = snapshotOf(socket);
    const market = simulator.state.markets[0];
    if (!market) throw new Error("expected a market");

    const quotedAsk = market.ask;
    const available = market.askSize;
    socket.take();

    socket.receive({
      type: "event",
      revision: 1,
      ...takeAddress(root, market.id, "buy"),
      payload: { kind: "click" },
    });
    await runtime.whenIdle();

    const expected = Math.min(TAKE_SIZE, available);
    const [resolution] = ledger.history("ann", 1);
    expect(resolution).toMatchObject({
      status: expected === TAKE_SIZE ? "filled" : "partial",
      side: "buy",
      filled: expected,
      price: quotedAsk,
    });

    expect(ledger.positions("ann")).toEqual([
      {
        marketId: market.id,
        name: market.name,
        size: expected,
        cost: expected * quotedAsk,
      },
    ]);

    // Depth was consumed, and the fill printed on the public tape.
    expect(simulator.state.markets[0]?.askSize).toBe(available - expected);
    expect(simulator.state.tape[0]).toMatchObject({
      marketId: market.id,
      origin: "taken",
      price: quotedAsk,
      size: expected,
    });
    expect(socket.find("error")).toBeUndefined();
  });

  it("resolves two sessions contending for the same quote deterministically", async () => {
    const first = await connect("user=ann");
    const second = await connect("user=bob");
    const market = simulator.state.markets[0];
    if (!market) throw new Error("expected a market");

    const available = market.askSize;
    const address = takeAddress(snapshotOf(first), market.id, "buy");
    first.take();
    second.take();

    for (const socket of [first, second]) {
      socket.receive({
        type: "event",
        revision: 1,
        ...address,
        payload: { kind: "click" },
      });
    }
    await runtime.whenIdle();

    const [ann] = ledger.history("ann", 1);
    const [bob] = ledger.history("bob", 1);
    if (!ann || !bob) throw new Error("expected both takes to resolve");

    // The book is conserved: nobody was filled out of thin air, and the second
    // taker sees only what the first left.
    expect(ann.filled + bob.filled).toBe(Math.min(available, 2 * TAKE_SIZE));
    expect(simulator.state.markets[0]?.askSize).toBe(
      available - ann.filled - bob.filled,
    );
    expect(bob.filled).toBeLessThanOrEqual(ann.filled);
    if (bob.filled < bob.requested) {
      expect(bob.status).not.toBe("filled");
    }
  });

  it("treats a repeated take of one quote as a single order", async () => {
    const socket = await connect("user=ann");
    const market = simulator.state.markets[0];
    if (!market) throw new Error("expected a market");

    const available = market.askSize;
    const address = takeAddress(snapshotOf(socket), market.id, "buy");
    socket.take();

    // Same address, same quote, twice within one round trip.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      socket.receive({
        type: "event",
        revision: 1,
        ...address,
        payload: { kind: "click" },
      });
    }
    await runtime.whenIdle();

    const history = ledger.history("ann", 10);
    expect(history).toHaveLength(1);

    const filled = history[0]?.filled ?? 0;
    expect(simulator.state.markets[0]?.askSize).toBe(available - filled);
    expect(ledger.positions("ann")[0]?.size).toBe(filled);
  });

  it("rejects a request whose price moved past the limit it named", () => {
    const market = simulator.state.markets[0];
    if (!market) throw new Error("expected a market");

    // The request states the worst price the user accepted, so it stays
    // meaningful however late it arrives: the store refuses rather than filling
    // at a price nobody agreed to.
    const stale = market.ask - 5;
    const resolution = simulator.take({
      account: "ann",
      marketId: market.id,
      side: "buy",
      limit: stale,
      size: TAKE_SIZE,
      quoteSeq: simulator.state.seq,
    });

    expect(resolution).toMatchObject({ status: "rejected", filled: 0, price: null });
    expect(resolution.reason).toContain(formatPrice(market.ask));
    expect(simulator.state.markets[0]?.askSize).toBe(market.askSize);
  });

  it("takes the current price when a stale click reaches a live address", async () => {
    const socket = await connect("mine=1&user=ann");
    const market = simulator.state.markets[0];
    if (!market) throw new Error("expected a market");

    const address = takeAddress(snapshotOf(socket), market.id, "buy");

    const moved = advanceUntilPriceMoves(market.id, market.ask);
    await runtime.whenIdle();
    socket.take();

    socket.receive({
      type: "event",
      revision: 1,
      ...address,
      payload: { kind: "click" },
    });
    await runtime.whenIdle();

    // This is the hazard, asserted rather than hidden. Addresses are stable and
    // handlers are recommitted on every render, so the click reaches a closure
    // that quotes the *new* price. A click payload has no field to carry the
    // price the user saw, so the limit cannot survive the round trip. The next
    // test is the mitigation available inside the current protocol.
    const [resolution] = ledger.history("ann", 1);
    expect(resolution?.status).not.toBe("rejected");
    expect(resolution?.price).toBe(moved);
    expect(resolution?.price).not.toBe(market.ask);
    expect(socket.find("error")).toBeUndefined();
  });

  it("refuses a stale click when the quote seeds the row key", async () => {
    const keyed = buildRuntime("key");
    const socket = await connect("mine=1&user=bob", keyed);
    const market = simulator.state.markets[0];
    if (!market) throw new Error("expected a market");

    const address = takeAddress(snapshotOf(socket), market.id, "buy");
    advanceUntilPriceMoves(market.id, market.ask);
    await keyed.whenIdle();
    socket.take();

    socket.receive({
      type: "event",
      revision: 1,
      ...address,
      payload: { kind: "click" },
    });
    await keyed.whenIdle();

    // The moved market is a new address, so the quote the user accepted is no
    // longer reachable and the take is refused instead of executed at a price
    // they never saw. It is recoverable: the browser gets a fresh snapshot.
    expect(socket.find("error")).toMatchObject({
      code: "stale_event",
      recoverable: true,
    });
    expect(socket.find("snapshot")).toBeDefined();
    expect(ledger.history("bob", 5)).toEqual([]);
    expect(ledger.positions("bob")).toEqual([]);
  });

  it("shows a rejection only to the session that caused it", async () => {
    const mine = await connect("mine=1&user=ann");
    const spectator = await connect();
    const market = simulator.state.markets[0];
    if (!market) throw new Error("expected a market");

    const address = takeAddress(snapshotOf(mine), market.id, "buy");
    mine.take();
    spectator.take();

    mine.receive({
      type: "event",
      revision: 1,
      ...address,
      payload: { kind: "click" },
    });
    await runtime.whenIdle();

    const [resolution] = ledger.history("ann", 1);
    if (!resolution) throw new Error("expected a resolution");

    const personal = JSON.stringify(mine.find("update"));
    const shared = JSON.stringify(spectator.find("update"));

    // The spectator sees the print on the public tape but learns nothing about
    // whose order it was, which is I2 holding: the outcome was never rendered
    // for them, so it cannot reach them.
    expect(personal).toContain("ann");
    expect(personal).toContain(resolution.status);
    expect(shared).not.toContain("ann");
    expect(shared).not.toContain(resolution.status);
  });

  it("re-checks its own preconditions rather than trusting the quote", () => {
    const market = simulator.state.markets[0];
    if (!market) throw new Error("expected a market");

    const base = {
      account: "ann",
      marketId: market.id,
      side: "buy" as const,
      limit: market.ask,
      quoteSeq: simulator.state.seq,
    };

    const rejects: Resolution[] = [
      simulator.take({ ...base, marketId: "nope", size: 1 }),
      simulator.take({ ...base, size: 0 }),
      simulator.take({ ...base, size: MAX_TAKE_SIZE + 1 }),
      simulator.take({ ...base, size: 1.5 }),
    ];

    for (const resolution of rejects) {
      expect(resolution.status).toBe("rejected");
      expect(resolution.filled).toBe(0);
    }
    expect(simulator.state.markets[0]?.askSize).toBe(market.askSize);
  });

  it("keeps a fill after the ledger is reloaded from disk", async () => {
    const file = join(directory, "reload.json");
    const first = await createOddsLedger(file);
    const market = simulator.state.markets[1];
    if (!market) throw new Error("expected a market");

    const request = {
      account: "ann",
      marketId: market.id,
      side: "buy" as const,
      limit: market.ask,
      size: 5,
      quoteSeq: simulator.state.seq,
    };
    const resolution = await first.take(request, (input) =>
      simulator.take(input),
    );
    expect(resolution.status).toBe("filled");

    const reloaded = await createOddsLedger(file);
    expect(reloaded.positions("ann")).toEqual(first.positions("ann"));
    expect(reloaded.history("ann", 1)[0]).toEqual(resolution);

    // The idempotency key survives the restart, so a retry cannot double-fill.
    const replay = await reloaded.take(request, () => {
      throw new Error("must not re-decide a resolved quote");
    });
    expect(replay).toEqual(resolution);
    expect(quoteKey(request)).toContain("ann");
  });

  it("prints a fill onto the shared tape as a keyed list change", async () => {
    const socket = await connect();
    const market = simulator.state.markets[2];
    if (!market) throw new Error("expected a market");

    const address = takeAddress(snapshotOf(socket), market.id, "sell");
    socket.take();

    socket.receive({
      type: "event",
      revision: 1,
      ...address,
      payload: { kind: "click" },
    });
    await runtime.whenIdle();

    const update = socket.find("update");
    if (update?.type !== "update") throw new Error("expected an update");

    // A new tape row changes a key sequence, which is the one structural
    // operation this board can produce.
    expect(
      update.operations.filter((operation) => operation.op === "list"),
    ).toHaveLength(1);
  });

  it("declares the register entries it forces and honours its parameters", async () => {
    const probe = await create({
      dataFile: (name) => join(directory, `probe-${name}`),
      log: () => {},
    });

    expect(probe.id).toBe("odds");
    expect(probe.title).toBe("Odds board");
    expect(probe.forces).toBe("S1, A6, A4");

    const render = (query: string): string => {
      const instance = probe.createApp({
        id: "sess1",
        params: new URLSearchParams(query),
        user: null,
        grant() {},
        revoke() {},
        invalidate: () => {},
      });
      return JSON.stringify(serialize(instance.app(), new TemplateRegistry()).root);
    };

    expect(render("")).not.toContain("Your book");
    expect(render("mine=1&user=ann")).toContain("ann");
  });
});
