import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

export type Person = { id: string; name: string };

const FILE = "data/tickets.json";
export const MAX_GUEST_NAME = 40;

/** Old club-book ids, kept so leftover seats and token files still resolve. */
const LEGACY_NAMES: Record<string, string> = {
  ada: "Ada Vale",
  ben: "Ben Calder",
  clara: "Clara Finch",
  diego: "Diego Ruiz",
  esme: "Esme Hart",
  farid: "Farid Noor",
  greta: "Greta Holm",
  hiro: "Hiro Sato",
  ines: "Ines Vidal",
  jules: "Jules Moreau",
};

function parsePerson(raw: unknown): Person | null {
  if (typeof raw === "string") {
    const name = LEGACY_NAMES[raw];
    return name ? { id: raw, name } : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const { id, name } = raw as { id?: unknown; name?: unknown };
  if (typeof id !== "string" || !id) return null;
  if (typeof name !== "string") return null;
  const trimmed = name.trim().slice(0, MAX_GUEST_NAME);
  if (!trimmed) return null;
  return { id, name: trimmed };
}

export function ticketsFromJson(raw: unknown): Map<string, Person> {
  if (!raw || typeof raw !== "object") return new Map();
  const next = new Map<string, Person>();
  for (const [token, value] of Object.entries(raw as Record<string, unknown>)) {
    const person = parsePerson(value);
    if (person) next.set(token, person);
  }
  return next;
}

function load(): Map<string, Person> {
  try {
    return ticketsFromJson(JSON.parse(readFileSync(FILE, "utf8")) as unknown);
  } catch {
    return new Map();
  }
}

function save(current: Map<string, Person>): void {
  mkdirSync("data", { recursive: true });
  const rows: Record<string, Person> = {};
  for (const [token, person] of current) rows[token] = person;
  writeFileSync(FILE, JSON.stringify(rows, null, 2));
}

export const tickets = load();

export function issue(name: string): string | null {
  const trimmed = name.trim().slice(0, MAX_GUEST_NAME);
  if (!trimmed) return null;
  const token = crypto.randomUUID();
  tickets.set(token, { id: crypto.randomUUID(), name: trimmed });
  save(tickets);
  return token;
}

export function guestById(id: string): Person | undefined {
  for (const person of tickets.values()) {
    if (person.id === id) return person;
  }
  const name = LEGACY_NAMES[id];
  return name ? { id, name } : undefined;
}

export function displayName(id: string | null): string {
  if (!id) return "Empty";
  return guestById(id)?.name ?? "Unknown";
}
