/**
 * Inert filler content.
 *
 * The rows exist only so that the clock has something expensive standing next
 * to it. Nothing in here ever changes, which is the point: every tick re-runs
 * the app, re-serializes these rows, and diffs them against an identical copy.
 */

export type StaticRow = {
  id: string;
  label: string;
  region: string;
  value: string;
};

export type RowSource = {
  /** Rows are cached, so tree size is a render cost rather than a data cost. */
  take: (count: number) => StaticRow[];
};

const REGIONS = [
  "eu-west-1",
  "eu-central-1",
  "us-east-1",
  "us-west-2",
  "ap-south-1",
  "sa-east-1",
];

const SUBJECTS = [
  "ingest",
  "checkout",
  "billing",
  "search",
  "media",
  "identity",
  "reporting",
  "webhook",
];

export function createRowSource(): RowSource {
  const cache: StaticRow[] = [];

  return {
    take(count: number): StaticRow[] {
      while (cache.length < count) {
        cache.push(buildRow(cache.length));
      }
      return cache.slice(0, count);
    },
  };
}

function buildRow(index: number): StaticRow {
  const noise = hash(index);
  const subject = SUBJECTS[noise % SUBJECTS.length] ?? "service";
  const region = REGIONS[(noise >>> 5) % REGIONS.length] ?? "eu-west-1";

  return {
    id: `row-${index}`,
    label: `${subject}-${String(index).padStart(5, "0")}`,
    region,
    value: ((noise % 1_000_000) / 100).toFixed(2),
  };
}

/** Any cheap deterministic scramble; the values only need to look plausible. */
function hash(index: number): number {
  let value = index + 0x9e3779b9;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}
