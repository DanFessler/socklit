/**
 * Measures how much of A6's render amortization survives authorization.
 *
 * research/design-probes.md hypothesizes that the amortization ratio in the
 * decision rule is really
 *
 *     concurrent_sessions / (distinct_views x distinct_authorization_classes)
 *
 * and that field-level permissions collapse sharing almost entirely while
 * coarse subtree-level permissions preserve it. This connects a population of
 * sessions to the real runtime, captures the trees it actually sends, and counts
 * how many of them are byte-identical.
 *
 *   npx tsx scripts/roles-amortization.ts
 *   npx tsx scripts/roles-amortization.ts --sessions=400
 *
 * Nothing is mutated, so the numbers are reproducible from the seeded company.
 */

import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";

import { RuntimeMetrics } from "../server/metrics";
import { Runtime } from "../server/runtime";
import { create } from "../server/probes/roles/probe";
import {
  GRANULARITIES,
  type Employee,
  type Granularity,
  type Role,
} from "../server/probes/roles/directory";
import {
  ShareCensusBuilder,
  findListHost,
  type ShareCensus,
} from "../server/probes/roles/share";
import { createCompanyStore } from "../server/probes/roles/store";
import type { ServerMessage, WireInstance } from "../shared/protocol";

const DATA_DIRECTORY = fileURLToPath(new URL("../data/roles/", import.meta.url));

/** A back-office population: mostly staff, a fifth managers, a few privileged. */
const ROLE_MIX: Array<{ role: Role; weight: number }> = [
  { role: "employee", weight: 68 },
  { role: "manager", weight: 18 },
  { role: "hr", weight: 5 },
  { role: "finance", weight: 5 },
  { role: "exec", weight: 4 },
];

const POPULATION_SIZES = [25, 50, 100, 200, 400, 800];

/** Captures exactly the frames the server writes, without a socket. */
class CaptureSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  readonly frames: string[] = [];

  send(data: string): void {
    this.frames.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close");
  }

  asWebSocket(): WebSocket {
    return this as unknown as WebSocket;
  }

  snapshot(): { root: WireInstance; bytes: number } {
    for (const frame of this.frames) {
      const message = JSON.parse(frame) as ServerMessage;
      if (message.type === "snapshot") {
        return { root: message.root, bytes: frame.length };
      }
    }
    throw new Error("session never received a snapshot");
  }
}

type Session = { userId: string; role: Role; root: WireInstance; bytes: number };

async function run(): Promise<void> {
  const sessions = readNumberFlag("sessions", 200);

  const store = await createCompanyStore(join(DATA_DIRECTORY, "company.json"));
  const usersByRole = new Map<Role, string[]>(
    ROLE_MIX.map(({ role }) => [role, store.usersWithRole(role)]),
  );
  for (const [role, users] of usersByRole) {
    if (users.length === 0) throw new Error(`no seeded users with role ${role}`);
  }

  const probe = await create({
    dataFile: (name) => join(DATA_DIRECTORY, name),
    log: () => {},
  });

  const metrics = new RuntimeMetrics();

  /** Renders one population and returns the trees the server actually sent. */
  async function connectUsers(
    granularity: Granularity,
    plan: string[],
  ): Promise<Session[]> {
    const runtime = new Runtime({
      createApp: (session) => probe.createApp(session),
      metrics,
    });

    const sockets: CaptureSocket[] = [];

    for (const userId of plan) {
      const socket = new CaptureSocket();
      sockets.push(socket);
      runtime.attach(
        socket.asWebSocket(),
        new URLSearchParams({ probe: "roles", user: userId, granularity }),
      );
    }
    await runtime.whenIdle();

    const result = sockets.map((socket, index) => {
      const { root, bytes } = socket.snapshot();
      const userId = plan[index] ?? "";
      return { userId, role: store.viewer(userId).role, root, bytes };
    });

    runtime.dispose();
    return result;
  }

  const connect = (
    granularity: Granularity,
    roles: Role[],
    count: number,
  ): Promise<Session[]> =>
    connectUsers(granularity, population(roles, count, usersByRole));

  function measure(all: Session[]): ShareCensus {
    const builder = new ShareCensusBuilder();
    for (const session of all) builder.add(session.root);
    return builder.census();
  }

  function measureRoster(all: Session[]): ShareCensus {
    const builder = new ShareCensusBuilder();
    for (const session of all) {
      const host = findListHost(session.root);
      if (!host) throw new Error("no keyed collection in the tree");
      builder.add(host);
    }
    return builder.census();
  }

  const allRoles = ROLE_MIX.map(({ role }) => role);

  // ----------------------------------------------------------------------
  console.log(`sessions per population: ${sessions}`);
  console.log(`records in the company: ${store.employees().length}`);
  console.log(
    `role mix: ${ROLE_MIX.map((entry) => `${entry.role} ${entry.weight}%`).join(", ")}`,
  );

  // ----------------------------------------------------------------------
  section("1. Data exposure per role (I2 measured on the wire)");
  const records = store.employees();
  const exposure = [
    ...(await connect("fine", allRoles, sessions)),
    ...(await connectUsers("fine", ["nobody-in-the-directory"])),
  ];

  console.log(" role      sessions  avg snapshot bytes  other people's");
  console.log("                                          identifiers on the wire");
  console.log("---------------------------------------------------------------");
  for (const role of [...allRoles, "guest" as Role]) {
    const group = exposure.filter((session) => session.role === role);
    if (group.length === 0) continue;
    const bytes = Math.round(
      group.reduce((total, session) => total + session.bytes, 0) / group.length,
    );
    const leaked = group.reduce(
      (worst, session) =>
        Math.max(worst, countSecrets(session.root, records, session.userId)),
      0,
    );
    console.log(
      `${role.padEnd(10)}${String(group.length).padStart(8)}` +
        `${bytes.toLocaleString("en-US").padStart(20)}` +
        `${`${leaked} of ${(records.length - 1) * 2}`.padStart(21)}`,
    );
  }

  // ----------------------------------------------------------------------
  section("2. Amortization by where authorization is resolved");
  console.log(
    " granularity  distinct  session  nodes/    shared  render  node",
  );
  console.log(
    "              trees     ratio    session   nodes   mult    ratio",
  );
  console.log(
    "-------------------------------------------------------------------",
  );
  const wholeTree = new Map<Granularity, ShareCensus>();
  const roster = new Map<Granularity, ShareCensus>();
  for (const granularity of GRANULARITIES) {
    const all = await connect(granularity, allRoles, sessions);
    const census = measure(all);
    wholeTree.set(granularity, census);
    roster.set(granularity, measureRoster(all));
    console.log(
      `${granularity.padEnd(13)}` +
        `${String(census.distinctRoots).padStart(8)}` +
        `${census.sessionRatio.toFixed(2).padStart(9)}` +
        `${Math.round(census.nodesPerSession).toLocaleString("en-US").padStart(9)}` +
        `${census.sharedNodes.toLocaleString("en-US").padStart(9)}` +
        `${census.renderMultiplier.toFixed(1).padStart(8)}` +
        `${census.nodeRatio.toFixed(1).padStart(7)}`,
    );
  }

  section("2b. The same population, measured on the roster subtree only");
  console.log(" granularity  distinct roster trees  node ratio  render mult");
  console.log("-------------------------------------------------------------");
  for (const granularity of GRANULARITIES) {
    const census = roster.get(granularity);
    if (!census) continue;
    console.log(
      `${granularity.padEnd(13)}` +
        `${String(census.distinctRoots).padStart(22)}` +
        `${census.nodeRatio.toFixed(1).padStart(12)}` +
        `${census.renderMultiplier.toFixed(1).padStart(13)}`,
    );
  }

  section("2c. Row variants: how many renderings of one record exist");
  console.log(
    " granularity  template  variants  occurrences  address-stable",
  );
  console.log(
    "----------------------------------------------------------------",
  );
  for (const granularity of GRANULARITIES) {
    const census = wholeTree.get(granularity);
    if (!census) continue;
    // The row template is the one with the most occurrences: one per record
    // per session.
    const row = census.byTemplate[0];
    if (!row) continue;
    console.log(
      `${granularity.padEnd(13)}` +
        `${String(row.templateId).padStart(9)}` +
        `${String(row.variants).padStart(10)}` +
        `${row.occurrences.toLocaleString("en-US").padStart(13)}` +
        `${`${row.addressStableVariants}/${row.variants}`.padStart(16)}`,
    );
  }

  // ----------------------------------------------------------------------
  section("3. Effect of the number of roles in the population");
  console.log(" roles in population              coarse   fine   personal");
  console.log("            (node amortization ratio at equal session count)");
  console.log("----------------------------------------------------------");
  for (let count = 1; count <= allRoles.length; count += 1) {
    const roles = allRoles.slice(0, count);
    const cells: string[] = [];
    for (const granularity of GRANULARITIES) {
      const census = measure(await connect(granularity, roles, sessions));
      cells.push(census.nodeRatio.toFixed(1).padStart(8));
    }
    console.log(`${roles.join("+").padEnd(34)}${cells.join("")}`);
  }

  // ----------------------------------------------------------------------
  section("4. Does the multiplier saturate as the population grows?");
  console.log(
    " sessions   coarse mult / ratio   fine mult / ratio   personal mult / ratio",
  );
  console.log(
    "--------------------------------------------------------------------------",
  );
  for (const size of POPULATION_SIZES) {
    const cells: string[] = [];
    for (const granularity of GRANULARITIES) {
      const census = measure(await connect(granularity, allRoles, size));
      cells.push(
        `${census.renderMultiplier.toFixed(1)} / ${census.nodeRatio.toFixed(1)}`.padStart(
          granularity === "coarse" ? 21 : 20,
        ),
      );
    }
    console.log(`${String(size).padStart(9)}${cells.join("")}`);
  }

  // ----------------------------------------------------------------------
  section("5. Render cost measured over every population above");
  const snapshot = metrics.snapshot();
  console.log(`renders            ${snapshot.renders.toLocaleString("en-US")}`);
  console.log(`nodes              ${snapshot.nodes.toLocaleString("en-US")}`);
  console.log(`µs/node            ${snapshot.microsecondsPerNode}`);
  console.log(`nodes/render       ${snapshot.averageNodesPerRender}`);
  console.log(
    `retained b/session ${snapshot.retainedBytesPerSession?.toLocaleString("en-US")}`,
  );
  console.log(
    `snapshot bytes     ${snapshot.sentBytes.snapshots.toLocaleString("en-US")}`,
  );
}

function section(title: string): void {
  console.log(`\n${"=".repeat(74)}\n${title}\n${"=".repeat(74)}`);
}

/**
 * Deterministic weighted population, cycling through the directory so a role
 * with many members contributes many distinct authorization classes.
 */
function population(
  roles: Role[],
  count: number,
  usersByRole: Map<Role, string[]>,
): string[] {
  const active = ROLE_MIX.filter((entry) => roles.includes(entry.role));
  const total = active.reduce((sum, entry) => sum + entry.weight, 0);
  const cursors = new Map<Role, number>();
  const plan: string[] = [];

  for (let index = 0; index < count; index += 1) {
    // Cumulative-weight walk over a fixed sequence rather than a sample, so
    // two runs of the same size produce the same population.
    const position = ((index + 0.5) / count) * total;
    let seen = 0;
    let chosen = active[active.length - 1]?.role ?? "employee";
    for (const entry of active) {
      seen += entry.weight;
      if (position <= seen) {
        chosen = entry.role;
        break;
      }
    }

    const users = usersByRole.get(chosen) ?? [];
    const cursor = cursors.get(chosen) ?? 0;
    cursors.set(chosen, cursor + 1);
    plan.push(users[cursor % users.length] ?? "");
  }

  return plan;
}

/**
 * Privileged values belonging to somebody other than the viewer, found in the
 * bytes the server sent. Own-record values are excluded because every role may
 * see its own pay and its own review.
 *
 * Only values that are unique to one record can be counted this way. Rating
 * notes are derived from the rating alone, so at most five distinct strings
 * exist across the whole company and a viewer holding one of them matches every
 * other employee who happens to share a rating. Including them reported a leak
 * for roles that have none.
 */
function countSecrets(
  root: WireInstance,
  records: readonly Employee[],
  viewerId: string,
): number {
  const text = JSON.stringify(root);
  return records
    .filter((employee) => employee.id !== viewerId)
    .flatMap((employee) => [employee.ssn, employee.bankAccount])
    .filter((secret) => text.includes(secret)).length;
}

function readNumberFlag(name: string, fallback: number): number {
  const flag = process.argv
    .slice(2)
    .find((argument) => argument.startsWith(`--${name}=`));
  if (!flag) return fallback;
  const value = Number(flag.slice(name.length + 3));
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

await run();
