export type Severity = "low" | "high";
export type IncidentStatus = "open" | "resolved";

export type IncidentCard = {
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  authorId: string;
  authorName: string;
  ownerId: string | null;
  ownerName: string | null;
  filedAt: string;
};
