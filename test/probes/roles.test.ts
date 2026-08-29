import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  GRANULARITIES,
  formatMoney,
  grantKey,
  grantsFor,
  type Employee,
  type Granularity,
  type Role,
} from "../../server/probes/roles/directory";
import { create } from "../../server/probes/roles/probe";
import { ShareCensusBuilder, collectPrimitives } from "../../server/probes/roles/share";
import {
  createCompanyStore,
  type CompanyStore,
} from "../../server/probes/roles/store";
import type { Probe } from "../../server/probes/types";
import { Runtime } from "../../server/runtime";
import type {
  ClientMessage,
  ServerMessage,
  WireInstance,
} from "../../shared/protocol";

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

  asWebSocket(): WebSocket {
    return this as unknown as WebSocket;
  }

  find<T extends ServerMessage["type"]>(
    type: T,
  ): Extract<ServerMessage, { type: T }> | undefined {
    return this.sent.find((message) => message.type === type) as
      | Extract<ServerMessage, { type: T }>
      | undefined;
  }
}

/**
 * The only values in the seed set that identify exactly one record.
 *
 * Rating notes are derived from the rating alone, so at most five distinct
 * strings exist across the company and searching for them cannot tell "this
 * viewer saw Dana's note" from "this viewer saw their own note, and Dana
 * happens to share a rating".
 */
function uniqueSecrets(employee: Employee): string[] {
  return [employee.ssn, employee.bankAccount];
}

describe("roles probe", () => {
  let directory: string;
  let probe: Probe;
  let runtime: Runtime;
  let store: CompanyStore;
  let employees: Employee[];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "socklit-roles-"));
    probe = await create({
      dataFile: (name) => join(directory, name),
      log: () => {},
    });
    runtime = new Runtime({
      createApp: (session) => probe.createApp(session),
      ...(probe.subscribe ? { subscribe: probe.subscribe } : {}),
    });
    // A second handle on the file the probe just seeded, for asserting against
    // the authoritative record set and for driving mutations directly.
    store = await createCompanyStore(join(directory, "company.json"));
    employees = store.employees();
  });

  afterEach(async () => {
    runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  async function connect(query: Record<string, string>): Promise<FakeSocket> {
    const socket = new FakeSocket();
    runtime.attach(socket.asWebSocket(), new URLSearchParams(query));
    await runtime.whenIdle();
    return socket;
  }

  function snapshotRoot(socket: FakeSocket): WireInstance {
    const snapshot = socket.find("snapshot");
    if (snapshot?.type !== "snapshot") throw new Error("expected a snapshot");
    return snapshot.root;
  }

  async function rootFor(
    userId: string,
    granularity: Granularity = "fine",
  ): Promise<WireInstance> {
    return snapshotRoot(await connect({ probe: "roles", user: userId, granularity }));
  }

  function firstUserWith(role: Role): string {
    const [userId] = store.usersWithRole(role);
    if (userId === undefined) throw new Error(`no seeded user with role ${role}`);
    return userId;
  }

  it("declares the register entries it forces", () => {
    expect(probe.id).toBe("roles");
    expect(probe.forces).toBe("I2, A6, the amortization/authorization collision");
  });

  it("resolves the role from the directory rather than the query string", async () => {
    const userId = firstUserWith("employee");
    const promoted = await rootFor(userId);
    const claimed = snapshotRoot(
      await connect({
        probe: "roles",
        user: userId,
        granularity: "fine",
        role: "hr",
      }),
    );

    // The refusal notice is rendered: the rejected claim reaches a hole, while
    // the label beside it still reports the role the directory assigned.
    const before = new Set(collectPrimitives(promoted));
    const after = new Set(collectPrimitives(claimed));
    expect(after.has("hr")).toBe(true);
    expect(before.has("hr")).toBe(false);
    expect(after.has("Employee")).toBe(true);

    // And the tab that asked to be HR received no additional data for it.
    for (const employee of employees) {
      for (const secret of uniqueSecrets(employee)) {
        expect(before.has(secret)).toBe(false);
        expect(after.has(secret)).toBe(false);
      }
    }
  });

  it("keeps other people's identifiers off the wire for every role that may not see them", async () => {
    for (const role of [
      "employee",
      "manager",
      "finance",
      "exec",
    ] as const satisfies readonly Role[]) {
      const userId = firstUserWith(role);
      const values = new Set(collectPrimitives(await rootFor(userId)));

      const leaked = employees
        .flatMap(uniqueSecrets)
        .filter((secret) => values.has(secret));

      expect(
        leaked,
        `${role} received identifiers it has no grant for`,
      ).toHaveLength(0);
    }
  });

  it("sends the whole record set to people operations, which does have the grant", async () => {
    const values = new Set(collectPrimitives(await rootFor(firstUserWith("hr"))));

    const present = employees
      .flatMap(uniqueSecrets)
      .filter((secret) => values.has(secret));

    expect(present).toHaveLength(employees.length * 2);
  });

  it("renders nothing privileged for a visitor who is not in the directory", async () => {
    const values = new Set(
      collectPrimitives(await rootFor("nobody-in-the-directory")),
    );

    for (const employee of employees) {
      for (const secret of uniqueSecrets(employee)) {
        expect(values.has(secret)).toBe(false);
      }
      expect(values.has(formatMoney(employee.salaryCents))).toBe(false);
    }
  });

  it("exposes the same values wherever the authorization decision is taken", async () => {
    const userId = firstUserWith("manager");

    const visible = await Promise.all(
      GRANULARITIES.map(async (granularity) => {
        const values = new Set(collectPrimitives(await rootFor(userId, granularity)));
        return employees
          .filter((employee) => values.has(formatMoney(employee.salaryCents)))
          .map((employee) => employee.id)
          .sort();
      }),
    );

    const [coarse] = visible;
    expect(coarse).toBeDefined();
    expect(coarse?.length ?? 0).toBeGreaterThan(0);
    for (const set of visible) {
      expect(set).toEqual(coarse);
    }
  });

  it("re-checks authorization when the mutation commits, not when the control was rendered", async () => {
    const target = employees.find(
      (employee) =>
        employee.raise?.status === "pending" && employee.accessRole === "employee",
    );
    expect(target).toBeDefined();
    if (!target) return;

    const outsider = employees.find(
      (employee) =>
        employee.accessRole === "employee" &&
        employee.id !== target.id &&
        employee.id !== target.managerId,
    );
    expect(outsider).toBeDefined();
    if (!outsider) return;

    await expect(
      store.decideRaise(outsider.id, target.id, "approved"),
    ).rejects.toThrow(/may not decide raises/);

    // The person who does hold the grant is allowed through, so the rejection
    // above is authorization and not a broken code path.
    const manager = target.managerId;
    expect(manager).not.toBeNull();
    if (manager === null) return;

    const decided = await store.decideRaise(manager, target.id, "approved");
    expect(decided.raise?.status).toBe("approved");
  });

  it("refuses to let anyone decide their own raise", async () => {
    const selfApprover = employees.find(
      (employee) =>
        employee.raise?.status === "pending" &&
        grantsFor(store.viewer(employee.id), employee).compensation,
    );
    expect(selfApprover).toBeDefined();
    if (!selfApprover) return;

    expect(grantsFor(store.viewer(selfApprover.id), selfApprover).approve).toBe(
      false,
    );
    await expect(
      store.decideRaise(selfApprover.id, selfApprover.id, "approved"),
    ).rejects.toThrow(/may not decide raises/);
  });

  it("treats a repeated decision as intent rather than a flip", async () => {
    const target = employees.find(
      (employee) => employee.raise?.status === "pending",
    );
    expect(target).toBeDefined();
    if (!target || target.managerId === null) return;

    const approver = grantsFor(store.viewer(target.managerId), target).approve
      ? target.managerId
      : firstUserWith("hr");

    const once = await store.decideRaise(approver, target.id, "approved");
    const twice = await store.decideRaise(approver, target.id, "approved");

    expect(twice.raise?.status).toBe("approved");
    expect(twice.salaryCents).toBe(once.salaryCents);
  });

  it("collapses a population into a handful of grant classes however large it gets", async () => {
    const viewers = employees.map((employee) => store.viewer(employee.id));
    const record = employees[0];
    expect(record).toBeDefined();
    if (!record) return;

    const classes = new Set(
      viewers.map((viewer) => grantKey(grantsFor(viewer, record))),
    );

    // The unit shared rendering would key on is the grant tuple, not the user,
    // which is why the multiplier saturates instead of growing with headcount.
    expect(classes.size).toBeLessThanOrEqual(6);
    expect(viewers.length).toBeGreaterThan(classes.size * 5);
  });

  it("shares less when one shared subtree carries a personal field", async () => {
    const plan = ["employee", "manager", "finance", "exec", "hr"]
      .flatMap((role) => store.usersWithRole(role as Role).slice(0, 8));
    expect(plan.length).toBeGreaterThan(10);

    const census = async (granularity: Granularity) => {
      const builder = new ShareCensusBuilder();
      for (const userId of plan) {
        builder.add(await rootFor(userId, granularity));
      }
      return builder.census();
    };

    const coarse = await census("coarse");
    const fine = await census("fine");
    const personal = await census("personal");

    // Gating every field individually costs a little sharing; adding one
    // viewer-dependent field to the subtree everyone was sharing costs most of
    // it. The second effect is far larger than the first.
    expect(fine.nodeRatio).toBeGreaterThan(coarse.nodeRatio * 0.5);
    expect(coarse.nodeRatio).toBeGreaterThan(personal.nodeRatio * 3);
    expect(personal.renderMultiplier).toBeGreaterThan(coarse.renderMultiplier * 3);
  });
});
