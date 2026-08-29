import { createJsonStore, JsonStore, StoreError } from "../../json-store";
import {
  grantsFor,
  viewerFor,
  type Company,
  type Employee,
  type RaiseStatus,
  type Role,
  type Viewer,
} from "./directory";

export const MAX_TITLE_LENGTH = 60;
export const MIN_SALARY_CENTS = 30_000_00;
export const MAX_SALARY_CENTS = 900_000_00;

/**
 * The company record set, behind the same JSON store the todo probe uses.
 *
 * Every mutation takes the *caller's user id* rather than a resolved viewer,
 * and re-derives both the role and the grant from the state it is about to
 * change. A handler that closed over "you may approve this" when the row was
 * rendered therefore cannot act on that belief: if the record was reassigned
 * while the click was in flight, the check fails at commit time.
 */
export class CompanyStore {
  constructor(private readonly store: JsonStore<Company>) {}

  /** Detached copies: view code cannot mutate authoritative state by accident. */
  employees(): Employee[] {
    return this.store.state.employees.map((employee) => ({
      ...employee,
      raise: employee.raise ? { ...employee.raise } : null,
    }));
  }

  employee(id: string): Employee | undefined {
    return this.employees().find((employee) => employee.id === id);
  }

  /** Identity is looked up here, so a client cannot name its own role. */
  viewer(userId: string | null): Viewer {
    return viewerFor(this.store.state.employees, userId);
  }

  usersWithRole(role: Role): string[] {
    return this.store.state.employees
      .filter((employee) => employee.accessRole === role)
      .map((employee) => employee.id);
  }

  /**
   * States the outcome rather than flipping the current one, so a decision that
   * arrives twice or late cannot mean the opposite of what the user clicked.
   */
  decideRaise(
    userId: string,
    employeeId: string,
    decision: Exclude<RaiseStatus, "pending">,
  ): Promise<Employee> {
    return this.store.mutate((company) => {
      const employee = requireEmployee(company, employeeId);
      const viewer = viewerFor(company.employees, userId);

      if (!grantsFor(viewer, employee).approve) {
        throw new StoreError(
          `${viewer.userId} may not decide raises for ${employeeId}`,
        );
      }
      if (!employee.raise) {
        throw new StoreError(`${employeeId} has no raise request`);
      }
      if (employee.raise.status === decision) {
        return { next: company, result: employee };
      }
      if (employee.raise.status !== "pending") {
        throw new StoreError(
          `the raise for ${employeeId} was already ${employee.raise.status}`,
        );
      }

      const updated: Employee = {
        ...employee,
        raise: { ...employee.raise, status: decision },
        salaryCents:
          decision === "approved"
            ? employee.salaryCents + employee.raise.requestedCents
            : employee.salaryCents,
      };
      return { next: replace(company, updated), result: updated };
    });
  }

  updateRecord(
    userId: string,
    employeeId: string,
    fields: { title?: string | undefined; salaryCents?: number | undefined },
  ): Promise<Employee> {
    return this.store.mutate((company) => {
      const employee = requireEmployee(company, employeeId);
      const viewer = viewerFor(company.employees, userId);
      const grants = grantsFor(viewer, employee);

      if (!grants.edit) {
        throw new StoreError(`${viewer.userId} may not edit ${employeeId}`);
      }

      const title =
        fields.title === undefined
          ? employee.title
          : normalizeTitle(fields.title);
      const salaryCents =
        fields.salaryCents === undefined
          ? employee.salaryCents
          : normalizeSalary(fields.salaryCents);

      if (title === employee.title && salaryCents === employee.salaryCents) {
        return { next: company, result: employee };
      }

      const updated: Employee = { ...employee, title, salaryCents };
      return { next: replace(company, updated), result: updated };
    });
  }

  onChange(listener: () => void): () => void {
    return this.store.onChange(listener);
  }
}

export async function createCompanyStore(file: string): Promise<CompanyStore> {
  const store = await createJsonStore<Company>({
    file,
    initial: () => ({ employees: seedEmployees() }),
    parse: (raw) => parseCompany(raw, file),
  });
  return new CompanyStore(store);
}

function requireEmployee(company: Company, id: string): Employee {
  const employee = company.employees.find((candidate) => candidate.id === id);
  if (!employee) throw new StoreError(`unknown employee: ${id}`);
  return employee;
}

function replace(company: Company, updated: Employee): Company {
  return {
    employees: company.employees.map((employee) =>
      employee.id === updated.id ? updated : employee,
    ),
  };
}

function normalizeTitle(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new StoreError("title must not be empty");
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new StoreError(`title must be at most ${MAX_TITLE_LENGTH} characters`);
  }
  return trimmed;
}

function normalizeSalary(cents: number): number {
  if (!Number.isFinite(cents) || !Number.isInteger(cents)) {
    throw new StoreError("salary must be a whole number of cents");
  }
  if (cents < MIN_SALARY_CENTS || cents > MAX_SALARY_CENTS) {
    throw new StoreError("salary is outside the approved band");
  }
  return cents;
}

// --------------------------------------------------------------------------
// Seed data. Deterministic on purpose: the amortization measurement compares
// byte-identical trees, which is only meaningful if the data is reproducible.
// --------------------------------------------------------------------------

const DEPARTMENTS = [
  "Engineering",
  "Support",
  "Sales",
  "Finance",
  "People",
  "Operations",
] as const;

const FIRST_NAMES = [
  "Ada", "Bram", "Chidi", "Dita", "Emeka", "Farrah", "Goro", "Hana",
  "Ilya", "Juno", "Kwame", "Lior", "Mira", "Nils", "Oona", "Piotr",
  "Quinn", "Rania", "Sora", "Tariq", "Ulla", "Vikram", "Wren", "Xiulan",
  "Yosef", "Zaia",
];

const LAST_NAMES = [
  "Abara", "Bourne", "Castile", "Dyer", "Eklund", "Fonseca", "Grieve",
  "Halloran", "Iversen", "Jarosz", "Kestrel", "Loveridge", "Mbeki",
  "Norrington", "Okafor", "Pryce", "Quintero", "Rasmussen", "Sandoval",
  "Thackeray",
];

const TITLES = [
  "Analyst",
  "Associate",
  "Specialist",
  "Coordinator",
  "Lead",
  "Principal",
];

const RAISE_REASONS = [
  "market adjustment",
  "promotion to lead",
  "retention",
  "scope increase",
];

const HEADCOUNT = 60;

/** Small LCG so salaries and ratings are varied but identical on every boot. */
function pseudoRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

function seedEmployees(): Employee[] {
  const random = pseudoRandom(20_260_827);
  const employees: Employee[] = [];

  const id = (index: number) => `emp-${String(index).padStart(2, "0")}`;

  for (let index = 1; index <= HEADCOUNT; index += 1) {
    const first = FIRST_NAMES[index % FIRST_NAMES.length] ?? "Ada";
    const last = LAST_NAMES[(index * 7) % LAST_NAMES.length] ?? "Abara";

    const isExec = index <= 2;
    const isManager = index >= 3 && index <= 8;
    const departmentIndex = isExec
      ? 5
      : isManager
        ? index - 3
        : (index - 9) % DEPARTMENTS.length;
    const department = DEPARTMENTS[departmentIndex] ?? "Operations";

    const managerId = isExec
      ? null
      : isManager
        ? id(department === "Finance" ? 2 : 1)
        : id(3 + departmentIndex);

    const salaryCents =
      Math.round(
        (isExec ? 3_100 : isManager ? 1_750 : 900 + random() * 700) * 100,
      ) * 100;

    const rating = 1 + Math.floor(random() * 5);
    const wantsRaise = !isExec && index % 5 === 0;
    const settled = index % 20 === 0;

    employees.push({
      id: id(index),
      name: `${first} ${last}`,
      title: isExec
        ? index === 1
          ? "Chief executive"
          : "Chief financial officer"
        : isManager
          ? `Head of ${department}`
          : `${department} ${TITLES[index % TITLES.length] ?? "Analyst"}`,
      department,
      managerId,
      accessRole: seedRole(index, isExec, isManager, department),
      salaryCents,
      rating,
      ratingNote: `Calibrated at ${rating} of 5 in the spring cycle`,
      raise: wantsRaise
        ? {
            requestedCents: Math.round(salaryCents * 0.06 / 100) * 100,
            status: settled ? "approved" : "pending",
            reason: RAISE_REASONS[index % RAISE_REASONS.length] ?? "retention",
          }
        : null,
      ssn: `${500 + index}-${10 + (index % 80)}-${1_000 + index * 7}`,
      bankAccount: `NL${20 + index}RABO${3_000_000 + index * 4_099}`,
    });
  }

  return employees;
}

/**
 * People operations and finance staff are ordinary members of their
 * departments who happen to hold a privileged role, which is what makes the
 * authorization classes overlap rather than nest.
 */
function seedRole(
  index: number,
  isExec: boolean,
  isManager: boolean,
  department: string,
): Role {
  if (isExec) return "exec";
  if (isManager) return "manager";
  if (department === "People" && index % 2 === 1) return "hr";
  if (department === "Finance" && index % 3 === 0) return "finance";
  return "employee";
}

function parseCompany(raw: unknown, file: string): Company {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !Array.isArray((raw as Company).employees)
  ) {
    throw new Error(`malformed company file: ${file}`);
  }

  const employees = (raw as Company).employees.filter(isEmployee);
  if (employees.length === 0) {
    throw new Error(`company file has no usable records: ${file}`);
  }
  return { employees };
}

function isEmployee(value: unknown): value is Employee {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Employee>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.department === "string" &&
    typeof candidate.accessRole === "string" &&
    typeof candidate.salaryCents === "number" &&
    typeof candidate.rating === "number" &&
    typeof candidate.ssn === "string" &&
    typeof candidate.bankAccount === "string"
  );
}
