export type Brief = {
  title: string;
  byline: string;
  body: string;
};

export type BriefState = {
  brief: Brief;
  readers: number;
  stars: Record<string, boolean>;
};

const BRIEF: Brief = {
  title: "The wire is the document",
  byline: "A note on first paint",
  body: "A server that already owns the tree should not wait for a socket to say so. This paragraph must appear in the HTTP response.",
};

export type BriefStore = {
  state: () => BriefState;
  star: (who: string) => void;
  addReader: () => void;
  onChange: (listener: () => void) => () => void;
};

export function createBriefStore(initial?: Partial<BriefState>): BriefStore {
  const state: BriefState = {
    brief: initial?.brief ?? { ...BRIEF },
    readers: initial?.readers ?? 12,
    stars: { ...(initial?.stars ?? {}) },
  };
  const listeners = new Set<() => void>();

  return {
    state: () => state,
    star(who) {
      state.stars[who] = !state.stars[who];
      for (const listener of listeners) listener();
    },
    addReader() {
      state.readers += 1;
      for (const listener of listeners) listener();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
