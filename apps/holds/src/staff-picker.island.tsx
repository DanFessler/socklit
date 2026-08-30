import { useMemo, useState } from "react";

type Person = { id: string; name: string };

export function StaffPicker(props: {
  people: Person[];
  value: string | null;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return props.people;
    return props.people.filter((person) =>
      person.name.toLowerCase().includes(needle),
    );
  }, [props.people, query]);

  return (
    <div className="staff-picker">
      <input
        type="search"
        className="staff-picker-input"
        placeholder="Search staff…"
        value={query}
        aria-label="Search staff"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
      />
      {open ? (
        <ul className="staff-picker-list">
          {matches.length === 0 ? (
            <li className="staff-picker-empty">No one matches</li>
          ) : (
            matches.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  className={
                    person.id === props.value
                      ? "staff-picker-option is-current"
                      : "staff-picker-option"
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
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
