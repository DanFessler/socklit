import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HookHost } from "../../server/component";
import { StoreError } from "../../server/json-store";
import { RuntimeMetrics } from "../../server/metrics";
import {
  changedPaths,
  eventHoles,
  HarnessSocket,
  rowInstance,
} from "../../server/probes/ledger/harness";
import { createLedgerApp } from "../../server/probes/ledger/ledger-app";
import {
  allocate,
  deriveLedger,
  documentNumber,
  formatAmount,
  graduatedLevy,
  REVENUE_ACCOUNTS,
  roundHalfEven,
  TAX_CODES,
  type Ledger,
  type LedgerView,
} from "../../server/probes/ledger/ledger-model";
import {
  createLedgerStore,
  type LedgerStore,
} from "../../server/probes/ledger/ledger-store";
import { Runtime } from "../../server/runtime";
import { serialize, TemplateRegistry } from "../../server/serialize";
import type { WireInstance, WireTemplate } from "../../shared/protocol";

/**
 * Hole positions inside the line-item row template.
 *
 * Asserted rather than discovered, so that reordering the row's cells breaks a
 * test with a clear message instead of silently re-aiming the event tests at a
 * different control.
 */
const ROW_QUANTITY_VALUE_HOLE = 6;
const ROW_QUANTITY_EVENT_HOLE = 7;
const ROW_LINE_TOTAL_HOLE = 15;
const TOTALS_DOCUMENT_TOTAL_HOLE = 9;

describe("ledger probe", () => {
  let directory: string;
  let store: LedgerStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "socklit-ledger-"));
    store = await createLedgerStore(join(directory, "ledger.json"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  /* ------------------------------------------------- correctness by shape -- */

  describe("derived totals", () => {
    /**
     * The core claim of the probe.
     *
     * Every derived total is checked against the line items it came from, after
     * every mutation in a long deterministic sequence. There is no state in
     * which the screen is internally inconsistent, because there is no state:
     * the totals do not exist until a render asks for them.
     */
    it("stay consistent with the line items after every mutation", async () => {
      const random = seededRandom(20260827);
      assertConsistent(deriveLedger(store.read()));

      for (let step = 0; step < 120; step += 1) {
        await applyRandomMutation(store, random);
        assertConsistent(deriveLedger(store.read()));
      }

      const view = deriveLedger(store.read());
      expect(view.lines.length).toBeGreaterThan(0);
    });

    it("keeps the journal balanced by construction", async () => {
      await store.seedLines(25);
      const view = deriveLedger(store.read());

      const debits = view.journal.reduce((total, row) => total + row.debitCents, 0);
      const credits = view.journal.reduce(
        (total, row) => total + row.creditCents,
        0,
      );

      expect(debits).toBe(credits);
      expect(debits).toBe(view.totalCents);
      expect(view.journalBalanced).toBe(true);
    });

    it("apportions the discount and levy with no lost or invented cents", async () => {
      // 7 lines against a 7.5% discount is chosen to force a residual: the
      // exact per-line shares do not land on whole cents.
      await store.seedLines(7);
      await store.setDiscountBp(750);
      const view = deriveLedger(store.read());

      expect(sumOf(view.lines, (line) => line.discountCents)).toBe(
        view.discountTotalCents,
      );
      expect(sumOf(view.lines, (line) => line.levyCents)).toBe(
        view.levyTotalCents,
      );
      expect(view.discountTotalCents).toBeGreaterThan(0);
      expect(view.levyTotalCents).toBeGreaterThan(0);
    });

    /**
     * The reason an optimistic patch of one row cannot be correct.
     *
     * Editing line 1 moves the levy shown against lines it never touched,
     * because the levy is apportioned from a document total by largest
     * remainder. A client that patched only the edited row would leave the
     * other rows displaying stale cents that still sum to the old total.
     */
    it("moves other lines' derived cents when one line changes", async () => {
      await store.seedLines(9);
      const before = deriveLedger(store.read());
      const target = before.lines[0];
      if (!target) throw new Error("expected a line");

      await store.setLineQuantity(target.line.id, target.line.quantity + 5);
      const after = deriveLedger(store.read());

      const untouched = after.lines
        .slice(1)
        .filter(
          (line, index) => line.levyCents !== before.lines[index + 1]?.levyCents,
        );

      expect(untouched.length).toBeGreaterThan(0);
      assertConsistent(after);
    });

    it("charges a graduated levy, so the effective rate depends on the document", async () => {
      const small = graduatedLevy(50_000);
      const large = graduatedLevy(2_000_000);

      expect(small / 50_000).toBeLessThan(large / 2_000_000);
      expect(graduatedLevy(0)).toBe(0);
    });

    it("allocates exactly, whatever the weights", () => {
      const cases: Array<[number, number[]]> = [
        [100, [1, 1, 1]],
        [7, [5, 5, 5, 5, 5, 5, 5]],
        [1, [0, 0, 3]],
        [0, [4, 9]],
        [999, []],
        [55, [0, 0, 0]],
      ];

      for (const [total, weights] of cases) {
        const parts = allocate(total, weights);
        if (weights.length === 0) {
          expect(parts).toEqual([]);
          continue;
        }
        expect(parts.reduce((sum, part) => sum + part, 0)).toBe(total);
        expect(parts.every((part) => Number.isSafeInteger(part))).toBe(true);
      }
    });

    it("rounds halves to even", () => {
      expect(roundHalfEven(2.5)).toBe(2);
      expect(roundHalfEven(3.5)).toBe(4);
      expect(roundHalfEven(2.4)).toBe(2);
      expect(roundHalfEven(2.6)).toBe(3);
    });
  });

  /* ------------------------------------------------------------ numbering -- */

  describe("document numbering", () => {
    it("allocates a gap-free sequence with valid check digits", async () => {
      await store.seedLines(4);
      const first = await store.postDraft();

      await store.seedLines(3);
      const second = await store.postDraft();

      expect(first.number).not.toBe(second.number);
      expect(first.number).toMatch(/^INV-\d{4}Q[1-4]-\d{4}-\d{2}$/);
      expect(sequenceOf(second.number)).toBe(sequenceOf(first.number) + 1);

      // The check digits are a function of the whole string, so they are not
      // reconstructible from the sequence alone.
      const body = first.number.slice(0, first.number.lastIndexOf("-"));
      expect(documentNumber(periodOf(body), sequenceOf(first.number))).toBe(
        first.number,
      );
    });

    it("refuses to post a document with unresolved line issues", async () => {
      await store.seedLines(3);
      const line = store.read().draft.lines[1];
      if (!line) throw new Error("expected a line");

      await store.setLineQuantity(line.id, 0);

      await expect(store.postDraft()).rejects.toThrow(StoreError);
      expect(store.read().posted).toHaveLength(5);
    });

    it("refuses to post an empty document", async () => {
      await store.seedLines(0);
      await expect(store.postDraft()).rejects.toThrow(/empty/);
    });
  });

  /* ------------------------------------------------------------- protocol -- */

  describe("replication", () => {
    let runtime: Runtime;
    let metrics: RuntimeMetrics;

    beforeEach(() => {
      metrics = new RuntimeMetrics();
      const app = createLedgerApp(store);
      runtime = new Runtime({
        createApp: () => ({ app }),
        subscribe: (listener) => store.onChange(listener),
        metrics,
      });
    });

    afterEach(() => {
      runtime.dispose();
    });

    async function connect(): Promise<HarnessSocket> {
      const socket = new HarnessSocket();
      runtime.attach(socket.asWebSocket());
      await runtime.whenIdle();
      return socket;
    }

    it("addresses the quantity control at the documented hole", async () => {
      const socket = await connect();
      const snapshot = socket.find("snapshot");
      if (snapshot?.type !== "snapshot") throw new Error("expected a snapshot");

      const line = store.read().draft.lines[0];
      if (!line) throw new Error("expected a line");
      const row = rowInstance(snapshot.root, line.id);

      expect(row.values[ROW_QUANTITY_VALUE_HOLE]).toBe(line.quantity);
      expect(eventHoles(row)).toContain(ROW_QUANTITY_EVENT_HOLE);
    });

    /**
     * The S3 evidence, stated as an assertion rather than a measurement: a
     * one-line edit replicates as values only. No layout, no list reshuffle,
     * and no subtree replacement, despite touching nine separate views.
     */
    it("replicates a line edit as value-only patches", async () => {
      const socket = await connect();
      const snapshot = socket.find("snapshot");
      if (snapshot?.type !== "snapshot") throw new Error("expected a snapshot");

      const line = store.read().draft.lines[0];
      if (!line) throw new Error("expected a line");
      const row = rowInstance(snapshot.root, line.id);
      socket.take();

      socket.receive({
        type: "event",
        revision: 1,
        instanceId: row.id,
        hole: ROW_QUANTITY_EVENT_HOLE,
        payload: { kind: "change", value: String(line.quantity + 4) },
      });
      await runtime.whenIdle();

      const update = socket.last("update");
      if (update?.type !== "update") throw new Error("expected an update");

      expect(socket.find("error")).toBeUndefined();
      expect(update.templates).toEqual([]);
      expect(update.operations.every((operation) => operation.op === "set")).toBe(
        true,
      );
      expect(JSON.stringify(update)).not.toContain("<");
      expect(store.read().draft.lines[0]?.quantity).toBe(line.quantity + 4);
    });

    /**
     * The fan-out claim. One edit, many separate addresses.
     *
     * Counting distinct instance ids rather than operations is what makes this
     * the "one state location versus four" number: each distinct instance is a
     * place in the UI that an SPA would have to arrange to be correct.
     */
    it("fans one edit out across many distinct instances", async () => {
      const socket = await connect();
      const snapshot = socket.find("snapshot");
      if (snapshot?.type !== "snapshot") throw new Error("expected a snapshot");

      const line = store.read().draft.lines[0];
      if (!line) throw new Error("expected a line");
      const row = rowInstance(snapshot.root, line.id);
      const before = deriveLedger(store.read());
      socket.take();

      socket.receive({
        type: "event",
        revision: 1,
        instanceId: row.id,
        hole: ROW_QUANTITY_EVENT_HOLE,
        payload: { kind: "change", value: String(line.quantity + 7) },
      });
      await runtime.whenIdle();

      const update = socket.last("update");
      if (update?.type !== "update") throw new Error("expected an update");

      const instances = new Set(
        update.operations.map((operation) => operation.instanceId),
      );

      // The edited row, other rows, both rollups, the journal, the aging table,
      // the running balance and the totals panel.
      expect(instances.size).toBeGreaterThanOrEqual(10);
      expect(update.operations.length).toBeGreaterThanOrEqual(30);
      expect(
        changedPaths(before, deriveLedger(store.read())).length,
      ).toBeGreaterThanOrEqual(30);
    });

    it("never sends a patch that leaves the replica inconsistent", async () => {
      const socket = await connect();
      const snapshot = socket.find("snapshot");
      const templates = socket.find("templates");
      if (snapshot?.type !== "snapshot" || templates?.type !== "templates") {
        throw new Error("expected a first frame");
      }

      const line = store.read().draft.lines[2];
      if (!line) throw new Error("expected a line");
      const row = rowInstance(snapshot.root, line.id);
      const totals = findByTemplateText(
        snapshot.root,
        templates.templates,
        "Document totals",
      );

      // Pins the hole mapping, so moving a cell fails here with a clear reason
      // rather than quietly reading the wrong number for the rest of the test.
      expect(totals.values[TOTALS_DOCUMENT_TOTAL_HOLE]).toBe(
        formatAmount(deriveLedger(store.read()).totalCents),
      );

      const replica: WireInstance = structuredClone(snapshot.root);
      const screenTotal = (): number =>
        parseMoney(
          holeText(
            instanceIn(replica, totals.id),
            TOTALS_DOCUMENT_TOTAL_HOLE,
          ),
        );
      const screenLineSum = (): number =>
        collectInstances(replica)
          .filter((instance) => /\/k:line-\d+$/.test(instance.id))
          .reduce(
            (total, candidate) =>
              total + parseMoney(holeText(candidate, ROW_LINE_TOTAL_HOLE)),
            0,
          );

      socket.take();
      expect(screenTotal()).toBe(screenLineSum());

      for (const quantity of [11, 1, 40, 7]) {
        expect(store.read().draft.lines[2]?.quantity).not.toBe(quantity);

        socket.receive({
          type: "event",
          revision: 1,
          instanceId: row.id,
          hole: ROW_QUANTITY_EVENT_HOLE,
          payload: { kind: "change", value: String(quantity) },
        });
        await runtime.whenIdle();

        const update = socket.last("update");
        if (update?.type !== "update") throw new Error("expected an update");
        applyPatch(replica, update);
        socket.take();

        // After each frame the replica's own total equals the sum of its own
        // line rows. There is no intermediate frame in which it does not,
        // because a frame carries every consequence of the edit or none of it.
        expect(screenTotal()).toBe(screenLineSum());
      }
    });

    it("ships layout once, then only values", async () => {
      const socket = await connect();
      const templates = socket.find("templates");
      if (templates?.type !== "templates") throw new Error("expected templates");

      socket.take();
      await store.setDiscountBp(1_250);
      await runtime.whenIdle();

      const update = socket.last("update");
      if (update?.type !== "update") throw new Error("expected an update");
      expect(update.templates).toEqual([]);
      expect(metrics.snapshot().sentBytes.templates).toBeGreaterThan(0);
    });

    /**
     * Rendering a control is not authorization.
     *
     * The post button is captured while the document is postable, the document
     * is then broken by another session, and the click lands afterwards. The
     * handler re-derives the precondition and refuses.
     */
    it("re-checks the post precondition when the click lands", async () => {
      const socket = await connect();
      const snapshot = socket.find("snapshot");
      const templates = socket.find("templates");
      if (snapshot?.type !== "snapshot" || templates?.type !== "templates") {
        throw new Error("expected a first frame");
      }

      const button = findByTemplateText(
        snapshot.root,
        templates.templates,
        "Post document",
      );
      const hole = eventHoles(button)[0];
      if (hole === undefined) throw new Error("expected a click hole");

      const line = store.read().draft.lines[0];
      if (!line) throw new Error("expected a line");
      await store.setLineDescription(line.id, "");
      await runtime.whenIdle();
      socket.take();

      socket.receive({
        type: "event",
        revision: socket.last("update")?.revision ?? 2,
        instanceId: button.id,
        hole,
        payload: { kind: "click" },
      });
      await runtime.whenIdle();

      expect(socket.find("error")).toMatchObject({
        code: "handler_failed",
        recoverable: true,
      });
      expect(store.read().posted).toHaveLength(5);
    });

    /* ---------------------------------------------------------- concurrency -- */

    /**
     * Two sessions, one document, both events issued before either reply lands.
     *
     * This is the case the intent rule exists for. At 400 ms it is ordinary
     * behaviour rather than a race worth engineering around.
     */
    it("converges when two sessions edit different lines at once", async () => {
      const first = await connect();
      const second = await connect();

      const snapshot = first.find("snapshot");
      if (snapshot?.type !== "snapshot") throw new Error("expected a snapshot");

      const [lineA, lineB] = store.read().draft.lines;
      if (!lineA || !lineB) throw new Error("expected two lines");

      const rowA = rowInstance(snapshot.root, lineA.id);
      const rowB = rowInstance(snapshot.root, lineB.id);
      first.take();
      second.take();

      first.receive({
        type: "event",
        revision: 1,
        instanceId: rowA.id,
        hole: ROW_QUANTITY_EVENT_HOLE,
        payload: { kind: "change", value: "9" },
      });
      second.receive({
        type: "event",
        revision: 1,
        instanceId: rowB.id,
        hole: ROW_QUANTITY_EVENT_HOLE,
        payload: { kind: "change", value: "4" },
      });
      await runtime.whenIdle();

      const lines = store.read().draft.lines;
      expect(lines[0]?.quantity).toBe(9);
      expect(lines[1]?.quantity).toBe(4);
      expect(first.find("error")).toBeUndefined();
      expect(second.find("error")).toBeUndefined();
      assertConsistent(deriveLedger(store.read()));

      // Both sessions end on the same tree, so both show the same totals.
      expect(first.last("update")?.revision).toBe(
        second.last("update")?.revision,
      );
    });

    /**
     * The same test with both sessions aiming at the same line.
     *
     * With a delta-shaped handler (`increment(id)`) this would land on a
     * different answer depending on arrival order. Stating the outcome makes it
     * order-independent, which is what I6 buys.
     */
    it("is order-independent when two sessions set the same line", async () => {
      const first = await connect();
      const second = await connect();

      const snapshot = first.find("snapshot");
      if (snapshot?.type !== "snapshot") throw new Error("expected a snapshot");

      const line = store.read().draft.lines[0];
      if (!line) throw new Error("expected a line");
      const row = rowInstance(snapshot.root, line.id);

      for (const socket of [first, second, first, second]) {
        socket.receive({
          type: "event",
          revision: 1,
          instanceId: row.id,
          hole: ROW_QUANTITY_EVENT_HOLE,
          payload: { kind: "change", value: "12" },
        });
      }
      await runtime.whenIdle();

      expect(store.read().draft.lines[0]?.quantity).toBe(12);
      expect(first.find("error")).toBeUndefined();
      expect(second.find("error")).toBeUndefined();
    });

    it("treats a second delete of the same line as satisfied intent", async () => {
      const before = store.read().draft.lines.length;
      const line = store.read().draft.lines[0];
      if (!line) throw new Error("expected a line");

      await Promise.all([
        store.removeLine(line.id),
        store.removeLine(line.id),
      ]);

      expect(store.read().draft.lines).toHaveLength(before - 1);
      assertConsistent(deriveLedger(store.read()));
    });
  });

  /* -------------------------------------------------------------- authoring -- */

  describe("authoring", () => {
    /**
     * The option markup is written out longhand in the templates, because a
     * template's static strings cannot be interpolated from a constant. This
     * pins the two representations together.
     */
    it("renders every account and tax code the model knows about", async () => {
      const metrics = new RuntimeMetrics();
      const app = createLedgerApp(store);
      const runtime = new Runtime({ createApp: () => ({ app }), metrics });
      const socket = new HarnessSocket();
      runtime.attach(socket.asWebSocket());
      await runtime.whenIdle();

      const templates = socket.find("templates");
      if (templates?.type !== "templates") throw new Error("expected templates");
      const markup = templates.templates
        .flatMap((template) => template.strings)
        .join("");

      for (const account of REVENUE_ACCOUNTS) {
        expect(markup).toContain(`value="${account.code}"`);
      }
      for (const code of TAX_CODES) {
        expect(markup).toContain(`value="${code.id}"`);
      }

      runtime.dispose();
    });

    it("rejects values the store cannot represent", async () => {
      const line = store.read().draft.lines[0];
      if (!line) throw new Error("expected a line");

      await expect(store.setLineQuantity(line.id, -1)).rejects.toThrow(StoreError);
      await expect(store.setLineQuantity(line.id, 1.5)).rejects.toThrow(StoreError);
      await expect(store.setCurrency("XBT")).rejects.toThrow(StoreError);
      await expect(store.setLineAccount(line.id, "9999")).rejects.toThrow(
        StoreError,
      );
      await expect(store.setLineTaxCode(line.id, "made-up")).rejects.toThrow(
        StoreError,
      );
      await expect(store.setLineQuantity("no-such-line", 1)).rejects.toThrow(
        StoreError,
      );
    });

    it("survives a reload from disk", async () => {
      await store.seedLines(12);
      await store.setDiscountBp(325);
      await store.setCurrency("GBP");
      const expected = deriveLedger(store.read());

      const reloaded = await createLedgerStore(join(directory, "ledger.json"));
      expect(deriveLedger(reloaded.read())).toEqual(expected);
    });
  });

  /* ------------------------------------------------------------ components -- */

  describe("component structure", () => {
    /**
     * The probe is built entirely from components and holds no `useState`.
     *
     * That is the whole point of it: the ledger is shared authoritative state,
     * every control is bound straight to the stored value, and there is nothing
     * a single session can diverge on. So a render against a host that
     * remembers the previous one is indistinguishable from a render against a
     * throwaway host, and no component ever asks for its own session back.
     */
    it("keeps no per-session state, so renders do not depend on the host", async () => {
      await store.seedLines(9);
      const app = createLedgerApp(store);
      const registry = new TemplateRegistry();
      const invalidated = vi.fn();
      const host = new HookHost(invalidated);

      const first = serialize(app(), registry, host).root;
      const second = serialize(app(), registry, host).root;
      const throwaway = serialize(app(), registry).root;

      expect(second).toEqual(first);
      expect(throwaway).toEqual(first);
      expect(invalidated).not.toHaveBeenCalled();
    });

    /**
     * The hook table is sized by state, not by structure.
     *
     * This probe renders eleven panels plus one component per row of seven
     * keyed lists — 52 instances at nine lines — and holds no state in any of
     * them. An earlier version of the layer allocated a table entry per
     * instance regardless, so a session paid for fifty-two slot tables that
     * were empty for its whole life. Entries are now opened by the first hook
     * that needs one, so a render layer that keeps no state costs no table.
     *
     * Stated against the instance count rather than as `toBe(0)` so that the
     * arithmetic stays visible: the number this is *not* paying is the point.
     */
    it("keeps no hook entries for components that hold no state", async () => {
      await store.seedLines(9);
      const app = createLedgerApp(store);
      const host = new HookHost();
      serialize(app(), new TemplateRegistry(), host);

      const view = deriveLedger(store.read());
      const instances =
        11 +
        view.lines.length +
        view.accounts.length +
        view.taxes.length +
        view.journal.length +
        view.aging.length +
        view.balance.length +
        store.read().posted.length;

      expect(instances).toBeGreaterThan(50);
      expect(host.size).toBe(0);
    });
  });
});

/* ------------------------------------------------------------------ helpers -- */

/** Every invariant that ties a derived total back to the stored lines. */
function assertConsistent(view: LedgerView): void {
  expect(sumOf(view.lines, (line) => line.grossCents)).toBe(view.subtotalCents);
  expect(sumOf(view.lines, (line) => line.discountCents)).toBe(
    view.discountTotalCents,
  );
  expect(sumOf(view.lines, (line) => line.netCents)).toBe(view.netTotalCents);
  expect(sumOf(view.lines, (line) => line.vatCents)).toBe(view.vatTotalCents);
  expect(sumOf(view.lines, (line) => line.levyCents)).toBe(view.levyTotalCents);
  expect(sumOf(view.lines, (line) => line.totalCents)).toBe(view.totalCents);
  expect(view.netTotalCents + view.vatTotalCents + view.levyTotalCents).toBe(
    view.totalCents,
  );

  expect(sumOf(view.accounts, (account) => account.netCents)).toBe(
    view.netTotalCents,
  );
  expect(sumOf(view.taxes, (tax) => tax.netCents)).toBe(view.netTotalCents);
  expect(sumOf(view.taxes, (tax) => tax.vatCents)).toBe(view.vatTotalCents);
  expect(sumOf(view.taxes, (tax) => tax.levyCents)).toBe(view.levyTotalCents);

  expect(view.journalDebitCents).toBe(view.journalCreditCents);
  expect(view.journalDebitCents).toBe(view.totalCents);
  expect(view.journalBalanced).toBe(true);

  const draftBucket = view.aging.find((bucket) => bucket.key === "draft");
  expect(draftBucket?.baseCents).toBe(view.baseTotalCents);

  const draftRow = view.balance.find((row) => row.draft);
  expect(draftRow?.movementBaseCents).toBe(view.baseTotalCents);
  expect(view.closingBalanceBaseCents).toBe(
    view.outstandingBaseCents + view.baseTotalCents,
  );

  expect(view.invalidLineCount).toBe(
    view.lines.filter((line) => line.issues.length > 0).length,
  );
  expect(view.canPost).toBe(view.lines.length > 0 && view.issueCount === 0);
}

function sumOf<T>(items: readonly T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}

/**
 * A deterministic walk over the whole mutation surface.
 *
 * Every branch is an intent, so the sequence can be replayed and produces the
 * same ledger every time.
 */
async function applyRandomMutation(
  store: LedgerStore,
  random: () => number,
): Promise<void> {
  const ledger: Ledger = store.read();
  const lines = ledger.draft.lines;
  const pick = <T>(items: readonly T[]): T | undefined =>
    items[Math.floor(random() * items.length)];

  switch (Math.floor(random() * 10)) {
    case 0:
      await store.addLine();
      return;
    case 1: {
      const line = pick(lines);
      if (line && lines.length > 1) await store.removeLine(line.id);
      return;
    }
    case 2: {
      const line = pick(lines);
      if (line) await store.setLineQuantity(line.id, Math.floor(random() * 40));
      return;
    }
    case 3: {
      const line = pick(lines);
      if (line) {
        await store.setLineUnitPrice(line.id, Math.floor(random() * 250_000));
      }
      return;
    }
    case 4: {
      const line = pick(lines);
      const account = pick(REVENUE_ACCOUNTS);
      if (line && account) await store.setLineAccount(line.id, account.code);
      return;
    }
    case 5: {
      const line = pick(lines);
      const code = pick(TAX_CODES);
      if (line && code) await store.setLineTaxCode(line.id, code.id);
      return;
    }
    case 6:
      await store.setDiscountBp(Math.floor(random() * 3_000));
      return;
    case 7: {
      const currency = pick(["USD", "EUR", "GBP", "CHF"] as const);
      if (currency) await store.setCurrency(currency);
      return;
    }
    case 8: {
      const entry = pick(ledger.posted);
      if (entry) {
        await store.settle(
          entry.id,
          Math.floor(random() * entry.baseTotalCents),
        );
      }
      return;
    }
    default: {
      const line = pick(lines);
      if (line) {
        await store.setLineDescription(
          line.id,
          random() < 0.2 ? "" : `Item ${Math.floor(random() * 999)}`,
        );
      }
      return;
    }
  }
}

/** Mulberry32: small, seeded, and adequate for choosing between branches. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** The browser's half of the protocol, enough to check a frame is coherent. */
function applyPatch(
  replica: WireInstance,
  update: { operations: readonly import("../../shared/protocol").PatchOperation[] },
): void {
  const index = new Map<string, WireInstance>();
  const walk = (instance: WireInstance): void => {
    index.set(instance.id, instance);
    for (const value of instance.values) {
      if (typeof value !== "object" || value === null) continue;
      if (value.kind === "instance") walk(value.instance);
      else if (value.kind === "list") {
        for (const item of value.items) walk(item.instance);
      }
    }
  };
  walk(replica);

  for (const operation of update.operations) {
    const target = index.get(operation.instanceId);
    if (!target) throw new Error(`unknown instance ${operation.instanceId}`);

    if (operation.op === "replace") {
      target.templateId = operation.instance.templateId;
      target.values = operation.instance.values;
      continue;
    }
    target.values[operation.hole] = operation.value;
  }
}

/**
 * Reads a rendered amount back out of the replica.
 *
 * Deliberately parses the replicated strings rather than consulting the model,
 * because the claim under test is about what the screen says.
 */
function parseMoney(text: string): number {
  const negative = text.startsWith("-");
  const digits = text.replace(/[-,.]/g, "");
  if (!/^\d+$/.test(digits)) throw new Error(`not an amount: ${text}`);
  return (negative ? -1 : 1) * Number(digits);
}

function holeText(instance: WireInstance, hole: number): string {
  const value = instance.values[hole];
  if (typeof value !== "string") {
    throw new Error(`hole ${hole} of ${instance.id} is not text`);
  }
  return value;
}

function instanceIn(replica: WireInstance, id: string): WireInstance {
  const found = collectInstances(replica).find(
    (instance) => instance.id === id,
  );
  if (!found) throw new Error(`no instance ${id} in the replica`);
  return found;
}

function collectInstances(instance: WireInstance): WireInstance[] {
  const found: WireInstance[] = [instance];
  for (const value of instance.values) {
    if (typeof value !== "object" || value === null) continue;
    if (value.kind === "instance") {
      found.push(...collectInstances(value.instance));
    } else if (value.kind === "list") {
      for (const item of value.items) {
        found.push(...collectInstances(item.instance));
      }
    }
  }
  return found;
}

/** Finds the instance whose template layout contains a phrase. */
function findByTemplateText(
  root: WireInstance,
  templates: readonly WireTemplate[],
  phrase: string,
): WireInstance {
  const matching = new Set(
    templates
      .filter((template) => template.strings.join("").includes(phrase))
      .map((template) => template.id),
  );

  const found = collectInstances(root).find((instance) =>
    matching.has(instance.templateId),
  );
  if (!found) throw new Error(`no instance renders "${phrase}"`);
  return found;
}

function sequenceOf(number: string): number {
  const parts = number.split("-");
  return Number(parts[2]);
}

function periodOf(body: string): string {
  return body.split("-")[1] ?? "";
}
