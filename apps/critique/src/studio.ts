/** Studio directory. Reference data — not stored. */

export type Person = { id: string; name: string };

export const STUDIO: Person[] = [
  { id: "mira-chen", name: "Mira Chen" },
  { id: "jonah-ellison", name: "Jonah Ellison" },
  { id: "priya-nair", name: "Priya Nair" },
  { id: "caleb-ortega", name: "Caleb Ortega" },
  { id: "naomi-brooks", name: "Naomi Brooks" },
  { id: "elias-voss", name: "Elias Voss" },
  { id: "hanna-berg", name: "Hanna Berg" },
  { id: "mateo-alvarez", name: "Mateo Alvarez" },
  { id: "sasha-okonkwo", name: "Sasha Okonkwo" },
  { id: "wren-holloway", name: "Wren Holloway" },
  { id: "leo-park", name: "Leo Park" },
  { id: "amara-singh", name: "Amara Singh" },
  { id: "felix-grant", name: "Felix Grant" },
  { id: "yuki-tanaka", name: "Yuki Tanaka" },
  { id: "rosa-moretti", name: "Rosa Moretti" },
  { id: "theo-lang", name: "Theo Lang" },
  { id: "imani-cole", name: "Imani Cole" },
  { id: "oscar-diaz", name: "Oscar Diaz" },
  { id: "lina-petrov", name: "Lina Petrov" },
  { id: "hugh-brennan", name: "Hugh Brennan" },
  { id: "aisha-rahman", name: "Aisha Rahman" },
  { id: "nico-vargas", name: "Nico Vargas" },
  { id: "june-whitaker", name: "June Whitaker" },
  { id: "omar-haddad", name: "Omar Haddad" },
  { id: "celia-frost", name: "Celia Frost" },
  { id: "benji-kaur", name: "Benji Kaur" },
  { id: "marisol-vega", name: "Marisol Vega" },
  { id: "quinn-adler", name: "Quinn Adler" },
  { id: "fatima-el-sayed", name: "Fatima El-Sayed" },
  { id: "declan-moore", name: "Declan Moore" },
  { id: "mei-lin", name: "Mei Lin" },
  { id: "rafael-costa", name: "Rafael Costa" },
  { id: "greta-holm", name: "Greta Holm" },
  { id: "samir-patel", name: "Samir Patel" },
  { id: "ivy-cho", name: "Ivy Cho" },
  { id: "tomasz-krajewski", name: "Tomasz Krajewski" },
  { id: "noelle-hart", name: "Noelle Hart" },
  { id: "diego-santos", name: "Diego Santos" },
  { id: "freya-lind", name: "Freya Lind" },
  { id: "kai-nakamura", name: "Kai Nakamura" },
  { id: "pearl-washington", name: "Pearl Washington" },
  { id: "andrei-popov", name: "Andrei Popov" },
];

export function personById(id: string | null): Person | null {
  if (!id) return null;
  return STUDIO.find((person) => person.id === id) ?? null;
}
