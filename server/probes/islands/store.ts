import { randomUUID } from "node:crypto";

import { JsonStore, StoreError } from "../../json-store";

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

export const TEAMS = ["west", "east", "eu"] as const;
export type Team = (typeof TEAMS)[number];

export const TEAM_LABEL: Record<Team, string> = {
  west: "West",
  east: "East",
  eu: "EU",
};

export type Person = {
  id: string;
  name: string;
  role: string;
  team: Team;
};

export const PEOPLE: Person[] = [
  { id: "dana", name: "Dana", role: "Staff", team: "west" },
  { id: "omar", name: "Omar", role: "Senior", team: "west" },
  { id: "ravi", name: "Ravi", role: "Lead", team: "east" },
  { id: "mei", name: "Mei", role: "Staff", team: "east" },
  { id: "luca", name: "Luca", role: "Senior", team: "eu" },
  { id: "nina", name: "Nina", role: "Lead", team: "eu" },
];

export type Card = {
  id: string;
  title: string;
  done: boolean;
  priority: Priority;
  color: string;
  team: Team;
  assigneeId: string;
};

const COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_TITLE = 120;

export class CardStore {
  private readonly store: JsonStore<Card[]>;

  constructor(file: string) {
    this.store = new JsonStore<Card[]>({
      file,
      initial: seed,
      parse: (raw) => parseCards(raw, file),
    });
  }

  async load(): Promise<void> {
    await this.store.load();
  }

  list(): Card[] {
    return this.store.state.map((card) => ({ ...card }));
  }

  peopleOn(team: Team): Person[] {
    return PEOPLE.filter((person) => person.team === team).map((person) => ({
      ...person,
    }));
  }

  person(id: string): Person | undefined {
    const person = PEOPLE.find((candidate) => candidate.id === id);
    return person ? { ...person } : undefined;
  }

  add(title: string): Promise<Card> {
    return this.store.mutate((cards) => {
      const card: Card = {
        id: randomUUID(),
        title: normalizeTitle(title),
        done: false,
        priority: "medium",
        color: "#a78bfa",
        team: "west",
        assigneeId: "dana",
      };
      return { next: [...cards, card], result: card };
    });
  }

  setDone(id: string, done: boolean): Promise<Card> {
    return this.store.mutate((cards) => {
      const current = requireCard(cards, id);
      if (current.done === done) return { next: cards, result: current };
      const updated = { ...current, done };
      return { next: replace(cards, id, updated), result: updated };
    });
  }

  setPriority(id: string, priority: string): Promise<Card> {
    if (!isPriority(priority)) {
      throw new StoreError(`unknown priority: ${priority}`);
    }
    return this.store.mutate((cards) => {
      const current = requireCard(cards, id);
      if (current.priority === priority) return { next: cards, result: current };
      const updated = { ...current, priority };
      return { next: replace(cards, id, updated), result: updated };
    });
  }

  setTeam(id: string, team: string): Promise<Card> {
    if (!isTeam(team)) {
      throw new StoreError(`unknown team: ${team}`);
    }
    return this.store.mutate((cards) => {
      const current = requireCard(cards, id);
      if (current.team === team) return { next: cards, result: current };
      const eligible = PEOPLE.filter((person) => person.team === team);
      const assigneeId = eligible.some((person) => person.id === current.assigneeId)
        ? current.assigneeId
        : (eligible[0]?.id ?? current.assigneeId);
      const updated = { ...current, team, assigneeId };
      return { next: replace(cards, id, updated), result: updated };
    });
  }

  assign(id: string, assigneeId: string): Promise<Card> {
    const person = PEOPLE.find((candidate) => candidate.id === assigneeId);
    if (!person) {
      throw new StoreError(`unknown person: ${assigneeId}`);
    }
    return this.store.mutate((cards) => {
      const current = requireCard(cards, id);
      if (person.team !== current.team) {
        throw new StoreError(`${person.name} is not on the ${current.team} team`);
      }
      if (current.assigneeId === assigneeId) return { next: cards, result: current };
      const updated = { ...current, assigneeId };
      return { next: replace(cards, id, updated), result: updated };
    });
  }

  setColor(id: string, color: string): Promise<Card> {
    if (!COLOR.test(color)) {
      throw new StoreError(`invalid colour: ${color}`);
    }
    return this.store.mutate((cards) => {
      const current = requireCard(cards, id);
      if (current.color === color) return { next: cards, result: current };
      const updated = { ...current, color };
      return { next: replace(cards, id, updated), result: updated };
    });
  }

  remove(id: string): Promise<void> {
    return this.store.mutate((cards) => {
      requireCard(cards, id);
      return { next: cards.filter((card) => card.id !== id), result: undefined };
    });
  }

  onChange(listener: (source: unknown) => void): () => void {
    return this.store.onChange(() => listener(this));
  }
}

export async function createCardStore(file: string): Promise<CardStore> {
  const store = new CardStore(file);
  await store.load();
  return store;
}

function seed(): Card[] {
  return [
    {
      id: "cut-branch",
      title: "Cut a release branch",
      done: false,
      priority: "high",
      color: "#a78bfa",
      team: "west",
      assigneeId: "dana",
    },
    {
      id: "write-note",
      title: "Write the islands note",
      done: false,
      priority: "medium",
      color: "#7dd3fc",
      team: "east",
      assigneeId: "ravi",
    },
    {
      id: "row-actions",
      title: "Do not put row actions inside an island",
      done: true,
      priority: "urgent",
      color: "#fb7185",
      team: "eu",
      assigneeId: "nina",
    },
  ];
}

function parseCards(raw: unknown, file: string): Card[] {
  if (!Array.isArray(raw)) {
    throw new Error(`malformed cards file: ${file}`);
  }
  return raw.flatMap((value) => {
    const card = readCard(value);
    return card ? [card] : [];
  });
}

function readCard(value: unknown): Card | null {
  if (typeof value !== "object" || value === null) return null;
  const card = value as Partial<Card>;
  if (
    typeof card.id !== "string" ||
    typeof card.title !== "string" ||
    typeof card.done !== "boolean" ||
    !isPriority(card.priority) ||
    typeof card.color !== "string" ||
    !COLOR.test(card.color)
  ) {
    return null;
  }

  const team = isTeam(card.team) ? card.team : "west";
  const assigneeId =
    typeof card.assigneeId === "string" &&
    PEOPLE.some((person) => person.id === card.assigneeId && person.team === team)
      ? card.assigneeId
      : (PEOPLE.find((person) => person.team === team)?.id ?? "dana");

  return {
    id: card.id,
    title: card.title,
    done: card.done,
    priority: card.priority,
    color: card.color,
    team,
    assigneeId,
  };
}

function isTeam(value: unknown): value is Team {
  return typeof value === "string" && (TEAMS as readonly string[]).includes(value);
}

function isPriority(value: unknown): value is Priority {
  return (
    typeof value === "string" &&
    (PRIORITIES as readonly string[]).includes(value)
  );
}

function requireCard(cards: readonly Card[], id: string): Card {
  const card = cards.find((candidate) => candidate.id === id);
  if (!card) throw new StoreError(`unknown card: ${id}`);
  return card;
}

function replace(cards: readonly Card[], id: string, updated: Card): Card[] {
  return cards.map((card) => (card.id === id ? updated : card));
}

function normalizeTitle(title: unknown): string {
  if (typeof title !== "string") {
    throw new StoreError("title must be a string");
  }
  const trimmed = title.trim();
  if (trimmed.length === 0) throw new StoreError("title must not be empty");
  if (trimmed.length > MAX_TITLE) {
    throw new StoreError(`title must be at most ${MAX_TITLE} characters`);
  }
  return trimmed;
}
