/** Club book. Reference data — not the JSON store. */
export type Person = { id: string; name: string };

export const PEOPLE: Person[] = [
  { id: "ada", name: "Ada Vale" },
  { id: "ben", name: "Ben Calder" },
  { id: "clara", name: "Clara Finch" },
  { id: "diego", name: "Diego Ruiz" },
  { id: "esme", name: "Esme Hart" },
  { id: "farid", name: "Farid Noor" },
  { id: "greta", name: "Greta Holm" },
  { id: "hiro", name: "Hiro Sato" },
  { id: "ines", name: "Ines Vidal" },
  { id: "jules", name: "Jules Moreau" },
];

export function personById(id: string): Person | undefined {
  return PEOPLE.find((row) => row.id === id);
}

export function personByName(name: string): Person | undefined {
  return PEOPLE.find((row) => row.name === name);
}

export function displayName(id: string | null): string {
  if (!id) return "Empty";
  return personById(id)?.name ?? "Unknown";
}
