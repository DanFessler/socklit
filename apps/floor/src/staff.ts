export type Member = { id: string; name: string; role: string };

/** Desk roster. Reference data — not the JSON store. */
export const STAFF: Member[] = [
  { id: "maya", name: "Maya Chen", role: "Night lead" },
  { id: "owen", name: "Owen Hale", role: "On-call" },
  { id: "priya", name: "Priya Shah", role: "SRE" },
  { id: "luis", name: "Luis Ortega", role: "Platform" },
  { id: "jun", name: "Jun Park", role: "Support" },
  { id: "elena", name: "Elena Voss", role: "Commander" },
  { id: "theo", name: "Theo Brooks", role: "Network" },
  { id: "amara", name: "Amara Diallo", role: "Security" },
  { id: "nate", name: "Nate Kim", role: "Database" },
  { id: "samira", name: "Samira Noor", role: "Comms" },
];

const byId = new Map(STAFF.map((member) => [member.id, member]));

export function memberById(id: string): Member | undefined {
  return byId.get(id);
}

export function memberName(id: string): string {
  return byId.get(id)?.name ?? "Unknown";
}
