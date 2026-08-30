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

export type Card = {
  id: string;
  title: string;
  done: boolean;
  priority: Priority;
  color: string;
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

  add(title: string): Promise<Card> {
    return this.store.mutate((cards) => {
      const card: Card = {
        id: randomUUID(),
        title: normalizeTitle(title),
        done: false,
        priority: "medium",
        color: "#a78bfa",
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
    },
    {
      id: "write-note",
      title: "Write the islands note",
      done: false,
      priority: "medium",
      color: "#7dd3fc",
    },
    {
      id: "row-actions",
      title: "Do not put row actions inside an island",
      done: true,
      priority: "urgent",
      color: "#fb7185",
    },
  ];
}

function parseCards(raw: unknown, file: string): Card[] {
  if (!Array.isArray(raw)) {
    throw new Error(`malformed cards file: ${file}`);
  }
  return raw.filter(isCard);
}

function isCard(value: unknown): value is Card {
  if (typeof value !== "object" || value === null) return false;
  const card = value as Partial<Card>;
  return (
    typeof card.id === "string" &&
    typeof card.title === "string" &&
    typeof card.done === "boolean" &&
    isPriority(card.priority) &&
    typeof card.color === "string" &&
    COLOR.test(card.color)
  );
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
