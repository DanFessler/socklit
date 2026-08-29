import type { MetricsSnapshot } from "../../metrics";
import type { GroupReport } from "./measure";
import type { Measurements } from "./harness";

/** Renders the measurement output as plain text tables. */
export function formatMeasurements(data: Measurements): string {
  const out: string[] = [];

  out.push("routes probe — shareable fraction and route-change cost");
  out.push(`generated ${data.generatedAt}`);
  out.push("");

  out.push(heading("1. A population of 12 spread across N routes"));
  out.push(
    table(
      [
        "routes",
        "sess/route",
        "personal",
        "distinct trees",
        "amort",
        "node id",
        "subtree id",
        "shared B",
        "node dedup",
        "byte dedup",
        "node amort",
      ],
      data.population.map((row) => [
        String(row.routes),
        String(row.sessionsPerRoute),
        row.personalized ? "on" : "off",
        String(row.population.distinctTrees),
        `${row.population.sessionAmortization.toFixed(2)}x`,
        percent(row.group.nodeIdentityFraction),
        percent(row.group.subtreeIdentityFraction),
        percent(row.group.sharedByteFraction),
        percent(row.population.instanceDedupFraction),
        percent(row.population.byteDedupFraction),
        ratio(row.population.instanceDedupFraction),
      ]),
    ),
  );
  out.push("");
  out.push(
    "  amort = sessions / distinct serialized trees, the amortization ratio",
    "  node id / subtree id = fraction of addresses identical in every session",
    "  node dedup = share of node renders removable if any identical node could be shared",
    "  node amort = the same figure as an amortization ratio, for comparison with amort",
  );
  out.push("");

  out.push(heading("2. One route, four distinct users"));
  out.push(
    table(
      ["route", "sessions", "personal", "whole tree", "node id", "subtree id", "shared B", "distinct trees"],
      data.routeGroups.map((row) => [
        row.route,
        String(row.sessions),
        row.personalized ? "on" : "off",
        row.group.wholeTreeIdentical ? "identical" : "differs",
        percent(row.group.nodeIdentityFraction),
        percent(row.group.subtreeIdentityFraction),
        percent(row.group.sharedByteFraction),
        String(row.population.distinctTrees),
      ]),
    ),
  );
  out.push("");

  out.push(heading("3. One personalized element, at increasing population"));
  out.push(
    table(
      ["route", "sessions", "personal", "whole tree", "node id", "subtree id", "shared B", "amort"],
      data.scale.map((row) => [
        row.route,
        String(row.sessions),
        row.personalized ? "on" : "off",
        row.group.wholeTreeIdentical ? "identical" : "differs",
        percent(row.group.nodeIdentityFraction),
        percent(row.group.subtreeIdentityFraction),
        percent(row.group.sharedByteFraction),
        `${row.population.sessionAmortization.toFixed(2)}x`,
      ]),
    ),
  );
  out.push("");

  out.push(heading("4. What a route change costs"));
  for (const report of data.navigation) {
    out.push(
      `  shell=${report.shell}: connect ships ${report.connectTemplates} templates ` +
        `(${report.connectTemplateBytes} B) plus a ${report.connectSnapshotBytes} B snapshot`,
    );
    out.push(
      table(
        ["from", "to", "visit", "templates", "ops", "root replace", "bytes"],
        report.steps.map((step) => [
          step.from,
          step.to,
          step.visit,
          String(step.templates),
          String(step.operations),
          step.rootReplace ? "yes" : "no",
          String(step.bytes),
        ]),
      ),
    );
    out.push(
      `  first visits ${report.firstVisitBytes} B, repeat visits ${report.repeatVisitBytes} B, ` +
        `${report.templatesAfterTour} templates cached after the tour`,
    );
    out.push("");
  }

  out.push(heading("5. Where the shareable boundary falls"));
  for (const entry of data.boundaries) {
    out.push(`  ${entry.label}`);
    out.push(
      `    ${percent(entry.group.nodeIdentityFraction)} of ${entry.group.addresses} addresses identical, ` +
        `${percent(entry.group.sharedByteFraction)} of ${entry.group.bytes} B inside shareable subtrees`,
    );
    out.push(...boundaryLines(entry.group));
    out.push("");
  }

  out.push(heading("6. Runtime metrics"));
  out.push("  sharing phase");
  out.push(...metricsLines(data.metrics.sharing));
  out.push("  navigation phase");
  out.push(...metricsLines(data.metrics.navigation));

  return out.join("\n");
}

function boundaryLines(group: GroupReport): string[] {
  if (group.boundaries.length === 0) {
    return ["    no subtree is identical across the whole group"];
  }

  return group.boundaries
    .slice(0, 8)
    .map(
      (boundary) =>
        `    ${boundary.id.padEnd(34)} depth ${boundary.depth}  ` +
        `${String(boundary.instances).padStart(3)} nodes  ${String(boundary.bytes).padStart(6)} B  ` +
        `${String(boundary.events).padStart(2)} handlers`,
    );
}

function metricsLines(snapshot: MetricsSnapshot): string[] {
  return [
    `    ${snapshot.renders} renders across ${snapshot.nodes} nodes`,
    `    ${snapshot.microsecondsPerNode ?? 0} us/node for render + serialize + diff`,
    `    ${snapshot.retainedBytesPerSession ?? 0} B retained tree per session`,
    `    sent: ${snapshot.sentBytes.templates} B templates, ` +
      `${snapshot.sentBytes.snapshots} B snapshots, ${snapshot.sentBytes.updates} B updates`,
  ];
}

function heading(text: string): string {
  return `${text}\n${"-".repeat(text.length)}`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** A dedup fraction restated as "renders needed against renders requested". */
function ratio(dedupFraction: number): string {
  if (dedupFraction >= 1) return "inf";
  return `${(1 / (1 - dedupFraction)).toFixed(2)}x`;
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? "").length)),
  );

  const line = (cells: string[]): string =>
    `  ${cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  ")}`.trimEnd();

  return [
    line(headers),
    `  ${widths.map((width) => "-".repeat(width)).join("  ")}`,
    ...rows.map(line),
  ].join("\n");
}
