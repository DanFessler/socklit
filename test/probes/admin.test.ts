import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAccountStore, type AccountStore } from "../../server/probes/admin/accounts";
import {
  createAdminHarness,
  type AdminHarness,
  type HarnessClient,
} from "../../server/probes/admin/harness";
import { STATE_INVENTORY } from "../../server/probes/admin/ui-state";

/**
 * The admin probe holds every piece of interaction state per session, which
 * makes two things worth proving: that none of it leaks between connections,
 * and that an action taken from a selection means what the operator asked for
 * even when the world moved underneath it.
 */

describe("admin probe", () => {
  let directory: string;
  let harness: AdminHarness;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "socklit-admin-"));
    harness = await createAdminHarness(directory);
  });

  afterEach(async () => {
    harness.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  const connect = (user: string): Promise<HarnessClient> =>
    harness.connect({ user });

  describe("per-session state", () => {
    it("keeps an open menu inside the session that opened it", async () => {
      const first = await connect("dana");
      const second = await connect("omar");

      await first.click("menu:row", "acc-003");

      expect(first.has("row:edit", "acc-003")).toBe(true);
      expect(second.has("row:edit", "acc-003")).toBe(false);
    });

    it("sends nothing at all to the other session when a menu opens", async () => {
      const first = await connect("dana");
      const second = await connect("omar");

      await first.click("menu:columns");

      expect(second.absorb()).toMatchObject({ bytes: 0, frames: 0 });
    });

    it("keeps row selection inside the session that made it", async () => {
      const first = await connect("dana");
      const second = await connect("omar");

      await first.check("row-select", true, "acc-001");
      await first.check("row-select", true, "acc-002");

      expect(first.text()).toContain("2 selected");
      expect(second.has("bulk-bar:clear")).toBe(false);
    });

    it("gives each session its own tab, sort and filter", async () => {
      const first = await connect("dana");
      const second = await connect("omar");

      await first.click("tab", "audit");
      await second.choose("filter:plan", "enterprise");

      // The audit tab has no table, and the filtered table has no free plans.
      expect(first.has("row-select", "acc-001")).toBe(false);
      expect(second.has("row-select", "acc-003")).toBe(true);
      expect(second.has("row-select", "acc-004")).toBe(false);
      expect(second.rowKeys()).not.toContain("acc-001");
    });
  });

  describe("bulk actions", () => {
    it("applies to exactly the selected rows", async () => {
      const client = await connect("dana");
      const selected = ["acc-001", "acc-002", "acc-004", "acc-006", "acc-008"];

      for (const id of selected) {
        await client.check("row-select", true, id);
      }
      await client.click("menu:bulk");
      await client.click("bulk:flag");

      const store = await readStore(directory);
      const flagged = store
        .list()
        .filter((account) => account.flagged)
        .map((account) => account.id);

      // acc-003, acc-005, acc-013, acc-018 and acc-024 are seeded flagged.
      expect(flagged).toEqual(
        expect.arrayContaining([...selected, "acc-003", "acc-005"]),
      );
      for (const account of store.list()) {
        if (selected.includes(account.id)) continue;
        expect(account.flagged).toBe(seededFlagged.has(account.id));
      }
    });

    it("does not touch a row that was unticked before the action ran", async () => {
      const client = await connect("dana");

      await client.check("row-select", true, "acc-001");
      await client.check("row-select", true, "acc-002");
      await client.check("row-select", false, "acc-002");
      await client.click("menu:bulk");
      await client.click("bulk:activate");

      const store = await readStore(directory);
      expect(store.get("acc-001")?.status).toBe("active");
      expect(store.get("acc-002")?.status).toBe("active");
      expect(store.get("acc-005")?.status).toBe("suspended");
    });

    it("confirms against the rows named when the dialog opened", async () => {
      const client = await connect("dana");

      await client.check("row-select", true, "acc-001");
      await client.check("row-select", true, "acc-002");
      await client.click("bulk-bar:delete");

      // The operator ticks another row while the dialog is up. Confirming must
      // still mean the two accounts the dialog was opened for.
      await client.check("row-select", true, "acc-004");
      await client.click("confirm:ok");

      const store = await readStore(directory);
      const ids = store.list().map((account) => account.id);
      expect(ids).not.toContain("acc-001");
      expect(ids).not.toContain("acc-002");
      expect(ids).toContain("acc-004");
    });

    it("is idempotent when the same action is applied twice", async () => {
      const client = await connect("dana");

      await client.check("row-select", true, "acc-001");
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await client.click("menu:bulk");
        await client.click("bulk:flag");
      }

      const store = await readStore(directory);
      expect(store.get("acc-001")?.flagged).toBe(true);
      expect(
        store.audit().filter((entry) => entry.action === "flag for review"),
      ).toHaveLength(1);
    });

    it("drops a selected row that another session deleted", async () => {
      const first = await connect("dana");
      const second = await connect("omar");

      await first.check("row-select", true, "acc-001");
      expect(first.text()).toContain("1 selected");

      await second.click("menu:row", "acc-001");
      await second.click("row:delete", "acc-001");
      await second.click("confirm:ok");

      // The delete is shared state, so this session is told about it.
      expect(first.absorb().bytes).toBeGreaterThan(0);
      expect(first.rowKeys()).not.toContain("acc-001");
      expect(first.has("bulk-bar:clear")).toBe(false);
    });
  });

  describe("editing", () => {
    it("saves the dialog's server-held draft", async () => {
      const client = await connect("dana");

      await client.click("menu:row", "acc-002");
      await client.click("row:edit", "acc-002");
      await client.choose("modal:plan", "enterprise");
      await client.choose("modal:seats", "120");

      // The projected total is computed from the draft the server holds, which
      // is the reason those two fields cannot be uncontrolled inputs.
      expect(client.text()).toContain("Projected monthly: $5,400");

      await client.submit("modal:save", { notes: "Upgraded after review." });

      const store = await readStore(directory);
      const account = store.get("acc-002");
      expect(account).toMatchObject({
        plan: "enterprise",
        seats: 120,
        notes: "Upgraded after review.",
      });
      expect(client.has("modal:save")).toBe(false);
    });

    it("reports a rejected edit inside the dialog and keeps it open", async () => {
      const client = await connect("dana");

      await client.click("menu:row", "acc-002");
      await client.click("row:edit", "acc-002");
      await client.choose("modal:seats", "0");
      await client.submit("modal:save", { notes: "" });

      expect(client.text()).toContain("seats must be at least 1");
      expect(client.has("modal:save")).toBe(true);

      const store = await readStore(directory);
      expect(store.get("acc-002")?.seats).toBe(42);
    });
  });

  describe("the search field", () => {
    it("is server state, so each keystroke changes the rendered rows", async () => {
      const client = await connect("dana");

      const first = await client.choose("filter:query", "gray");
      expect(client.rowKeys()).toEqual(["acc-003"]);
      expect(first.bytesIn).toBeGreaterThan(0);

      await client.choose("filter:query", "grayz");
      expect(client.rowKeys()).toEqual([]);
      expect(client.text()).toContain("No accounts match this filter");
    });
  });

  describe("the store", () => {
    it("skips ids that no longer exist rather than failing the action", async () => {
      const store = await readStore(directory);

      await store.remove(["acc-001"], "dana");
      const changed = await store.setStatus(
        ["acc-001", "acc-002"],
        "suspended",
        "dana",
      );

      expect(changed).toBe(1);
      expect(store.get("acc-002")?.status).toBe("suspended");
    });

    it("rejects an unknown status instead of writing it", async () => {
      const store = await readStore(directory);

      expect(() =>
        store.setStatus(["acc-002"], "deleted" as never, "dana"),
      ).toThrow(/unknown status/);
      expect(store.get("acc-002")?.status).toBe("active");
    });
  });

  it("classifies every field of session state in the inventory", () => {
    // The inventory is the probe's deliverable, so it is worth failing on when
    // a new piece of session state appears without being classified.
    const classified = new Set(
      STATE_INVENTORY.flatMap((entry) =>
        entry.state.split(" / ").map((name) => name.split(" ")[0] ?? ""),
      ),
    );

    for (const field of [
      "tab",
      "openMenu",
      "hoveredTip",
      "collapsed",
      "selection",
      "modal",
      "sortColumn",
      "sortDirection",
      "filterStatus",
      "filterPlan",
      "query",
      "columns",
      "density",
      "toast",
    ]) {
      expect(classified).toContain(field);
    }
  });
});

const seededFlagged = new Set([
  "acc-003",
  "acc-005",
  "acc-013",
  "acc-018",
  "acc-024",
]);

/** Reads the same file the probe wrote, to assert against durable state. */
function readStore(directory: string): Promise<AccountStore> {
  return createAccountStore(join(directory, "accounts.json"));
}
