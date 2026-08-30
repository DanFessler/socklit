export type Member = { id: string; name: string };

/** Studio directory. Reference data — not the JSON store. */
export const MEMBERS: Member[] = [
  { id: "ada", name: "Ada Chen" },
  { id: "jules", name: "Jules Moreau" },
  { id: "priya", name: "Priya Shah" },
  { id: "nico", name: "Nico Alvarez" },
  { id: "samira", name: "Samira Okonkwo" },
  { id: "eliot", name: "Eliot Park" },
  { id: "renata", name: "Renata Silva" },
  { id: "kai", name: "Kai Nakamura" },
  { id: "maren", name: "Maren Holt" },
  { id: "theo", name: "Theo Voss" },
];

export function memberById(id: string): Member | undefined {
  return MEMBERS.find((row) => row.id === id);
}
