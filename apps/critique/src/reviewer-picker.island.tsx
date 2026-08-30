import { useEffect, useMemo, useRef, useState } from "react";

type Person = { id: string; name: string };

export function ReviewerPicker(props: {
  people: { id: string; name: string }[];
  value: string | null;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = props.people.find((person) => person.id === props.value) ?? null;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return props.people;
    return props.people.filter((person) => person.name.toLowerCase().includes(q));
  }, [props.people, query]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="reviewer" ref={rootRef}>
      <input
        className="reviewer-input"
        type="search"
        value={query}
        placeholder={current ? current.name : "Find a reviewer…"}
        aria-label="Find a reviewer"
        aria-expanded={open}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
      />
      {open ? (
        <ul className="reviewer-list" role="listbox" aria-label="Studio">
          {shown.length === 0 ? (
            <li className="reviewer-empty">No one matches.</li>
          ) : (
            shown.map((person) => {
              const selected = person.id === props.value;
              return (
                <li key={person.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={
                      selected ? "reviewer-option is-selected" : "reviewer-option"
                    }
                    onClick={() => {
                      props.onPick(person.id);
                      setQuery("");
                      setOpen(false);
                    }}
                  >
                    {person.name}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
