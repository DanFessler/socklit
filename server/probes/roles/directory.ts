/**
 * The authorization model, kept apart from both the store and the view.
 *
 * `grantsFor` is the single place that decides what a viewer may see of one
 * record. The view calls it to decide what to render; the store calls it again
 * inside every mutation, because rendering a control is not authorization.
 */

export type Role = "guest" | "employee" | "manager" | "finance" | "exec" | "hr";

/**
 * Where authorization is resolved in the template tree.
 *
 * `coarse`  one gated subtree per sensitivity level
 * `fine`    every field is its own hole in one flat row template
 * `personal` coarse subtrees, but one field inside the shared subtree depends
 *            on the viewer's identity rather than on their grants
 *
 * This is the probe's independent variable. It changes nothing about who may
 * see what — only where in the tree the decision is taken.
 */
export type Granularity = "coarse" | "fine" | "personal";

export const GRANULARITIES: readonly Granularity[] = [
  "coarse",
  "fine",
  "personal",
];

export type RaiseStatus = "pending" | "approved" | "denied";

export type RaiseRequest = {
  requestedCents: number;
  status: RaiseStatus;
  reason: string;
};

export type Employee = {
  id: string;
  name: string;
  title: string;
  department: string;
  managerId: string | null;
  /** What this person may see when they sign in. Never read from the client. */
  accessRole: Role;
  salaryCents: number;
  rating: number;
  ratingNote: string;
  raise: RaiseRequest | null;
  ssn: string;
  bankAccount: string;
};

export type Company = { employees: Employee[] };

export type Viewer = {
  userId: string;
  name: string;
  role: Role;
  /** The viewer's own record, when they have one. */
  employeeId: string | null;
};

export const GUEST: Viewer = {
  userId: "guest",
  name: "Unrecognized visitor",
  role: "guest",
  employeeId: null,
};

/**
 * What one viewer may see and do with one record.
 *
 * Five independent bits rather than a level, because real consoles are not a
 * ladder: finance may see pay without ratings, and an executive may see ratings
 * without national identifiers.
 */
export type Grants = {
  /** Salary and the size of any raise request. */
  compensation: boolean;
  /** Performance rating and its note. */
  rating: boolean;
  /** National identifier and bank details. */
  identifiers: boolean;
  /** May decide a pending raise. */
  approve: boolean;
  /** May rewrite the record. */
  edit: boolean;
};

export const NO_GRANTS: Grants = {
  compensation: false,
  rating: false,
  identifiers: false,
  approve: false,
  edit: false,
};

export function grantsFor(viewer: Viewer, employee: Employee): Grants {
  const grants = baseGrants(viewer, employee);

  // Nobody signs off on their own raise, whatever their role is.
  if (viewer.employeeId !== null && viewer.employeeId === employee.id) {
    return { ...grants, approve: false };
  }
  return grants;
}

function baseGrants(viewer: Viewer, employee: Employee): Grants {
  switch (viewer.role) {
    case "hr":
      return {
        compensation: true,
        rating: true,
        identifiers: true,
        approve: true,
        edit: true,
      };

    case "exec":
      return { ...NO_GRANTS, compensation: true, rating: true, approve: true };

    case "finance":
      return { ...NO_GRANTS, compensation: true };

    case "manager":
      if (employee.managerId === viewer.employeeId) {
        return { ...NO_GRANTS, compensation: true, rating: true, approve: true };
      }
      return selfGrants(viewer, employee);

    case "employee":
      return selfGrants(viewer, employee);

    case "guest":
      return NO_GRANTS;
  }
}

/** Everyone may see their own pay and their own review. */
function selfGrants(viewer: Viewer, employee: Employee): Grants {
  if (viewer.employeeId !== null && viewer.employeeId === employee.id) {
    return { ...NO_GRANTS, compensation: true, rating: true };
  }
  return NO_GRANTS;
}

/**
 * The distinct grant tuple, as a short string.
 *
 * Two viewers with the same key see byte-identical output for that record, so
 * this is the real unit that shared rendering would be keyed by — and there are
 * only a handful of them however many users exist.
 */
export function grantKey(grants: Grants): string {
  return [
    grants.compensation ? "c" : "-",
    grants.rating ? "r" : "-",
    grants.identifiers ? "i" : "-",
    grants.approve ? "a" : "-",
    grants.edit ? "e" : "-",
  ].join("");
}

export function viewerFor(
  employees: readonly Employee[],
  userId: string | null,
): Viewer {
  if (userId === null || userId.length === 0) return GUEST;

  const record = employees.find((employee) => employee.id === userId);
  if (!record) return GUEST;

  return {
    userId: record.id,
    name: record.name,
    role: record.accessRole,
    employeeId: record.id,
  };
}

export function parseGranularity(raw: string | null): Granularity {
  return GRANULARITIES.includes(raw as Granularity)
    ? (raw as Granularity)
    : "fine";
}

export function roleLabel(role: Role): string {
  switch (role) {
    case "hr":
      return "People operations";
    case "exec":
      return "Executive";
    case "finance":
      return "Finance";
    case "manager":
      return "Line manager";
    case "employee":
      return "Employee";
    case "guest":
      return "No access";
  }
}

export function formatMoney(cents: number): string {
  const dollars = Math.round(cents / 100);
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${grouped}`;
}
