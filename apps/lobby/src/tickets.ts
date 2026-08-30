import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { personById, type Person } from "./people";

const FILE = "data/tickets.json";

function load(): Map<string, Person> {
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as unknown;
    if (!raw || typeof raw !== "object") return new Map();
    const next = new Map<string, Person>();
    for (const [token, id] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof id !== "string") continue;
      const person = personById(id);
      if (person) next.set(token, person);
    }
    return next;
  } catch {
    return new Map();
  }
}

function save(tickets: Map<string, Person>): void {
  mkdirSync("data", { recursive: true });
  const rows: Record<string, string> = {};
  for (const [token, person] of tickets) rows[token] = person.id;
  writeFileSync(FILE, JSON.stringify(rows, null, 2));
}

export const tickets = load();

export function issue(person: Person): string {
  const token = crypto.randomUUID();
  tickets.set(token, person);
  save(tickets);
  return token;
}
