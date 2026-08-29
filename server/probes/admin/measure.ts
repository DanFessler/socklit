import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAdminHarness,
  type HarnessClient,
  type Interaction,
} from "./harness";
import { STATE_INVENTORY, type Ownership } from "./ui-state";

/**
 * Produces the numbers in research/probes/admin.md.
 *
 * Run with `npx tsx server/probes/admin/measure.ts`. It boots the real probe
 * against a throwaway data directory and drives it through the same tasks an
 * operator would perform, counting one round trip per event sent.
 */

type Step = {
  label: string;
  ownership: Ownership;
  act: (client: HarnessClient) => Promise<Interaction>;
};

type Task = {
  name: string;
  steps: Step[];
  /** Seconds an operator would plausibly spend on this task. */
  seconds: number;
};

const ROW = "acc-003";
const BULK_ROWS = ["acc-001", "acc-002", "acc-004", "acc-006", "acc-008"];

function ephemeral(
  label: string,
  act: Step["act"],
): Step {
  return { label, ownership: "ephemeral", act };
}

function renderAffecting(label: string, act: Step["act"]): Step {
  return { label, ownership: "render-affecting", act };
}

function application(label: string, act: Step["act"]): Step {
  return { label, ownership: "application", act };
}

const TASKS: Task[] = [
  {
    name: "Open a row menu and pick an item",
    seconds: 4,
    steps: [
      ephemeral("open row menu", (client) => client.click("menu:row", ROW)),
      application("pick “Suspend”", (client) =>
        client.click("row:suspend", ROW),
      ),
    ],
  },
  {
    name: "Open a menu and dismiss it without choosing",
    seconds: 3,
    steps: [
      ephemeral("open toolbar menu", (client) => client.click("menu:columns")),
      ephemeral("click away", (client) => client.click("scrim")),
    ],
  },
  {
    name: "Select five rows and apply a bulk action",
    seconds: 9,
    steps: [
      ...BULK_ROWS.map((id) =>
        renderAffecting(`tick ${id}`, (client: HarnessClient) =>
          client.check("row-select", true, id),
        ),
      ),
      ephemeral("open bulk menu", (client) => client.click("menu:bulk")),
      application("pick “Mark active”", (client) =>
        client.click("bulk:activate"),
      ),
    ],
  },
  {
    name: "Open a modal, change two fields, submit",
    seconds: 12,
    steps: [
      ephemeral("open row menu", (client) => client.click("menu:row", ROW)),
      ephemeral("pick “Edit…”", (client) => client.click("row:edit", ROW)),
      renderAffecting("choose plan", (client) =>
        client.choose("modal:plan", "business"),
      ),
      renderAffecting("commit seats field", (client) =>
        client.choose("modal:seats", "900"),
      ),
      application("submit", (client) =>
        client.submit("modal:save", { notes: "Renewal risk, see ticket 44." }),
      ),
    ],
  },
  {
    name: "Switch tabs and come back",
    seconds: 6,
    steps: [
      renderAffecting("tab: Billing", (client) => client.click("tab", "billing")),
      renderAffecting("tab: Audit log", (client) => client.click("tab", "audit")),
      renderAffecting("tab: Accounts", (client) =>
        client.click("tab", "accounts"),
      ),
    ],
  },
  {
    name: "Type four characters into the filter",
    seconds: 3,
    steps: ["g", "gr", "gra", "gray"].map((value) =>
      renderAffecting(`keystroke “${value.at(-1) ?? ""}”`, (client) =>
        client.choose("filter:query", value),
      ),
    ),
  },
  {
    name: "Hover one tooltip",
    seconds: 2,
    steps: [
      ephemeral("pointer enters", (client) => client.fire("tip-in", { kind: "change" })),
      ephemeral("pointer leaves", (client) =>
        client.fire("tip-out", { kind: "change" }),
      ),
    ],
  },
  {
    name: "Re-sort the table",
    seconds: 2,
    steps: [
      renderAffecting("click a column header", (client) =>
        client.click("sort"),
      ),
    ],
  },
  {
    name: "Show one more column",
    seconds: 4,
    steps: [
      ephemeral("open the columns menu", (client) =>
        client.click("menu:columns"),
      ),
      renderAffecting("tick “Region”", (client) =>
        client.check("column", true, "region"),
      ),
      ephemeral("close the menu", (client) => client.click("scrim")),
    ],
  },
  {
    name: "Collapse a section",
    seconds: 2,
    steps: [
      ephemeral("collapse “Summary”", (client) =>
        client.click("collapse:summary"),
      ),
    ],
  },
];

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "admin-probe-"));

  try {
    await report(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function report(directory: string): Promise<void> {
  const harness = await createAdminHarness(directory);
  const client = await harness.connect({ user: "measure" });

  const connected = harness.snapshot();
  console.log("## Connection cost\n");
  console.log(
    table(
      ["measure", "value"],
      [
        ["templates (bytes, once)", String(client.connectBytes.templates)],
        ["first snapshot (bytes)", String(client.connectBytes.snapshot)],
        ["nodes in the tree", String(connected.nodes)],
        [
          "render+diff for the first frame (µs)",
          String(connected.renderMicroseconds),
        ],
        [
          "retained bytes per session",
          String(connected.retainedBytesPerSession ?? 0),
        ],
      ],
    ),
  );

  const rows: string[][] = [];
  const byOwnership = new Map<Ownership, Interaction[]>();
  let totalTrips = 0;
  let totalSeconds = 0;

  for (const task of TASKS) {
    const results: Interaction[] = [];

    for (const step of task.steps) {
      const interaction = await step.act(client);
      results.push(interaction);

      const bucket = byOwnership.get(step.ownership) ?? [];
      bucket.push(interaction);
      byOwnership.set(step.ownership, bucket);
    }

    totalTrips += results.length;
    totalSeconds += task.seconds;

    rows.push([
      task.name,
      String(results.length),
      String(sum(results, (item) => item.bytesOut)),
      String(sum(results, (item) => item.bytesIn)),
      String(Math.round(mean(results, (item) => item.bytesIn))),
      String(Math.round(sum(results, (item) => item.renderMicroseconds))),
    ]);

    await reset(client);
  }

  console.log("\n## Round trips per task\n");
  console.log(
    table(
      [
        "task",
        "round trips",
        "bytes out",
        "bytes in",
        "mean bytes in / trip",
        "server µs",
      ],
      rows,
    ),
  );

  console.log("\n## Cost by ownership class\n");
  console.log(
    table(
      ["class", "interactions", "mean bytes in", "mean server µs", "max bytes in"],
      [...byOwnership.entries()].map(([ownership, items]) => [
        ownership,
        String(items.length),
        String(Math.round(mean(items, (item) => item.bytesIn))),
        String(Math.round(mean(items, (item) => item.renderMicroseconds))),
        String(Math.max(...items.map((item) => item.bytesIn))),
      ]),
    ),
  );

  const uncovered = [...byOwnership.entries()]
    .filter(([ownership]) => ownership !== "application")
    .reduce((total, [, items]) => total + items.length, 0);

  console.log("\n## Decision rule inputs\n");
  console.log(
    table(
      ["measure", "value"],
      [
        ["round trips across all tasks", String(totalTrips)],
        ["task time modelled (s)", String(totalSeconds)],
        [
          "interactions per minute",
          (totalTrips / (totalSeconds / 60)).toFixed(1),
        ],
        [
          "uncovered interactions per minute",
          (uncovered / (totalSeconds / 60)).toFixed(1),
        ],
        [
          "same, with 60% of the minute spent reading",
          (uncovered / (totalSeconds / 60) / 2.5).toFixed(1),
        ],
      ],
    ),
  );

  const steady = harness.snapshot();
  console.log("\n## Steady-state render cost\n");
  console.log(
    table(
      ["measure", "value"],
      [
        ["renders", String(steady.renders - connected.renders)],
        ["quiet renders (no wire traffic)", String(steady.quietRenders)],
        [
          "µs per node, first frame",
          (connected.renderMicroseconds / connected.nodes).toFixed(2),
        ],
        [
          "µs per node, after warm-up",
          (
            (steady.renderMicroseconds - connected.renderMicroseconds) /
            (steady.nodes - connected.nodes)
          ).toFixed(2),
        ],
        [
          "µs per whole-tree render, after warm-up",
          (
            (steady.renderMicroseconds - connected.renderMicroseconds) /
            (steady.renders - connected.renders)
          ).toFixed(0),
        ],
      ],
    ),
  );

  console.log("\n## Perceived latency, computed\n");
  const perTrip = mean(
    [...byOwnership.values()].flat(),
    (item) => item.renderMicroseconds,
  );
  console.log(
    table(
      ["simulated RTT", "expected perceived latency"],
      [0, 150, 400].map((rtt) => [
        `${rtt} ms`,
        `${(rtt + perTrip / 1000).toFixed(1)} ms`,
      ]),
    ),
  );

  console.log("\n## What a second session costs\n");
  const observer = await harness.connect({ user: "observer" });

  const beforeEphemeral = harness.snapshot();
  await client.click("collapse:summary");
  const afterEphemeral = harness.snapshot();
  const observerQuiet = observer.absorb();

  // Staged so the measured interaction is the mutation itself.
  await client.check("row-select", true, "acc-002");
  await client.click("menu:bulk");
  observer.absorb();

  const beforeShared = harness.snapshot();
  await client.click("bulk:flag");
  const afterShared = harness.snapshot();
  const observerBusy = observer.absorb();

  console.log(
    table(
      ["interaction", "renders on the server", "bytes to the other session"],
      [
        [
          "one session collapses a section",
          String(afterEphemeral.renders - beforeEphemeral.renders),
          String(observerQuiet.bytes),
        ],
        [
          "one session flags a record",
          String(afterShared.renders - beforeShared.renders),
          String(observerBusy.bytes),
        ],
      ],
    ),
  );

  // If open/closed were client-owned, the contents would have to be on the
  // client before the user opened anything, because there is no round trip
  // left to fetch them with. This is what that would cost.
  await reset(client);
  const firstOpen = await client.click("menu:row", "acc-009");
  await client.click("scrim");
  const laterOpen = await client.click("menu:row", "acc-010");
  await client.click("scrim");
  const rowCount = client.rowKeys().length;

  console.log("\n## What eagerly rendered menus would cost\n");
  console.log(
    table(
      ["measure", "bytes"],
      [
        ["one row menu, layout already cached", String(laterOpen.bytesIn)],
        ["one row menu, first of its kind", String(firstOpen.bytesIn)],
        [
          `every row menu rendered up front (${rowCount} rows)`,
          String(laterOpen.bytesIn * rowCount),
        ],
        ["the whole first snapshot today", String(client.connectBytes.snapshot)],
      ],
    ),
  );

  console.log("\n## State inventory\n");
  console.log(
    table(
      ["state", "class", "primitive that could own it"],
      STATE_INVENTORY.map((entry) => [
        entry.state,
        entry.ownership,
        entry.primitive ?? "—",
      ]),
    ),
  );

  harness.dispose();
}

/** Returns the session to a clean tab so tasks do not contaminate each other. */
async function reset(client: HarnessClient): Promise<void> {
  if (client.has("modal:cancel")) await client.click("modal:cancel");
  if (client.has("confirm:cancel")) await client.click("confirm:cancel");
  if (client.has("invite:cancel")) await client.click("invite:cancel");
  if (client.has("scrim")) await client.click("scrim");
  if (client.has("bulk-bar:clear")) await client.click("bulk-bar:clear");
  if (client.has("toast:dismiss")) await client.click("toast:dismiss");
  if (client.has("tab", "accounts")) await client.click("tab", "accounts");
  if (client.has("filter:reset")) await client.click("filter:reset");
}

function sum<T>(items: readonly T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0);
}

function mean<T>(items: readonly T[], of: (item: T) => number): number {
  return items.length === 0 ? 0 : sum(items, of) / items.length;
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );

  const line = (cells: string[]): string =>
    `| ${cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join(" | ")} |`;

  return [
    line(headers),
    `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`,
    ...rows.map(line),
  ].join("\n");
}

await main();
