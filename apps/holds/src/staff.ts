export type Person = { id: string; name: string };

/** Static office directory. Not store state — everyone sees the same list. */
export const STAFF: Person[] = [
  { id: "p01", name: "Ada Lovelace" },
  { id: "p02", name: "Alan Turing" },
  { id: "p03", name: "Grace Hopper" },
  { id: "p04", name: "Katherine Johnson" },
  { id: "p05", name: "Dorothy Vaughan" },
  { id: "p06", name: "Mary Jackson" },
  { id: "p07", name: "Margaret Hamilton" },
  { id: "p08", name: "Barbara Liskov" },
  { id: "p09", name: "Radia Perlman" },
  { id: "p10", name: "Frances Allen" },
  { id: "p11", name: "Jean Bartik" },
  { id: "p12", name: "Betty Holberton" },
  { id: "p13", name: "Adele Goldberg" },
  { id: "p14", name: "Hedy Lamarr" },
  { id: "p15", name: "Annie Easley" },
  { id: "p16", name: "Clarence Ellis" },
  { id: "p17", name: "Mark Dean" },
  { id: "p18", name: "Philip Emeagwali" },
  { id: "p19", name: "Fei-Fei Li" },
  { id: "p20", name: "Timnit Gebru" },
  { id: "p21", name: "Joy Buolamwini" },
  { id: "p22", name: "Reshma Saujani" },
  { id: "p23", name: "Limor Fried" },
  { id: "p24", name: "Yuki Tanaka" },
  { id: "p25", name: "Junade Ali" },
  { id: "p26", name: "Priya Natarajan" },
  { id: "p27", name: "Kenji Watanabe" },
  { id: "p28", name: "Sofia Alvarez" },
  { id: "p29", name: "Omar Haddad" },
  { id: "p30", name: "Nia Okonkwo" },
  { id: "p31", name: "Elena Voss" },
  { id: "p32", name: "Marcus Chen" },
  { id: "p33", name: "Priya Shah" },
  { id: "p34", name: "Jonah Berg" },
  { id: "p35", name: "Amara Diallo" },
  { id: "p36", name: "Luca Romano" },
  { id: "p37", name: "Hana Kim" },
  { id: "p38", name: "Diego Morales" },
  { id: "p39", name: "Ingrid Solberg" },
  { id: "p40", name: "Samir Patel" },
  { id: "p41", name: "Chloe Nguyen" },
];

export function personName(id: string | null): string | null {
  if (!id) return null;
  return STAFF.find((person) => person.id === id)?.name ?? "Unknown";
}
