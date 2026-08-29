import { html } from "lit-html";

import type { SubmitPayload } from "../../../shared/protocol";
import { component, useState, useStore } from "../../component";
import { keyed } from "../../keyed";
import {
  formatMoney,
  grantsFor,
  roleLabel,
  type Employee,
  type Granularity,
  type Grants,
  type Viewer,
} from "./directory";
import type { CompanyStore } from "./store";

export type ConsoleActions = {
  /** Per-session selection, owned by the useState in <Console>. */
  select: (employeeId: string | null) => void;
  /**
   * Both mutations return their promise so the runtime can await them and turn
   * a rejected authorization check into a `handler_failed` for this session.
   */
  decide: (
    employeeId: string,
    decision: "approved" | "denied",
  ) => Promise<void>;
  save: (
    employeeId: string,
    fields: Record<string, string>,
  ) => Promise<void>;
};

/**
 * The console.
 *
 * Every privileged value reaches a template hole only after `grantsFor` said
 * yes, which is what makes I2 the whole of the enforcement story: a value that
 * is not rendered has no representation on the wire to hide.
 *
 * Identity and granularity arrive as props because they are fixed session
 * configuration read from the query string, which only `createApp` can see.
 * The selected record is different: it is the one thing a single user diverges
 * on after connecting, so it lives in this component's own state.
 */
export const Console = component(function Console(props: {
  store: CompanyStore;
  userId: string | null;
  granularity: Granularity;
  /** The `?role=` the client asked for, before it is checked against the directory. */
  requestedRole: string | null;
}) {
  const store = useStore(props.store);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { granularity } = props;
  const viewer = store.viewer(props.userId);
  const employees = store.employees();

  const actions: ConsoleActions = {
    select: setSelectedId,
    decide: async (employeeId, decision) => {
      await store.decideRaise(props.userId ?? "", employeeId, decision);
    },
    save: async (employeeId, fields) => {
      const salary = fields["salary"];
      await store.updateRecord(props.userId ?? "", employeeId, {
        title: fields["title"],
        ...(salary === undefined || salary.trim().length === 0
          ? {}
          : { salaryCents: parseSalary(salary) }),
      });
      setSelectedId(null);
    },
  };

  const names = new Map(employees.map((employee) => [employee.id, employee.name]));

  const decidable = employees.filter(
    (employee) =>
      employee.raise?.status === "pending" &&
      grantsFor(viewer, employee).approve,
  );
  const visiblePay = employees.filter(
    (employee) => grantsFor(viewer, employee).compensation,
  );
  const selected =
    selectedId === null
      ? undefined
      : employees.find((employee) => employee.id === selectedId);

  // A `?role=` the client asked for and did not get.
  const claimedRole =
    props.requestedRole !== null && props.requestedRole !== viewer.role
      ? props.requestedRole
      : null;

  return html`
    <header class="app-header">
      <h1>People console</h1>
      <p>
        ${viewer.name} · ${roleLabel(viewer.role)} · ${granularity} gating
      </p>
    </header>

    ${claimedRole === null
      ? null
      : html`<p class="empty">
          This tab asked for the "${claimedRole}" role. The server
          resolves roles from the staff directory, so the request was ignored.
        </p>`}

    <section class="summary">
      <p class="inspector-summary">
        ${employees.length} records · ${decidable.length} raises awaiting you ·
        ${visiblePay.length === 0
          ? "no compensation visible to you"
          : `${formatMoney(
              visiblePay.reduce((total, employee) => total + employee.salaryCents, 0),
            )} of payroll across ${visiblePay.length} records`}
      </p>
    </section>

    <ul class="todo-list">
      ${keyed(
        employees,
        (employee) => employee.id,
        (employee) =>
          RecordRow({
            employee,
            managerName: names.get(employee.managerId ?? "") ?? "—",
            grants: grantsFor(viewer, employee),
            granularity,
            viewer,
            actions,
          }),
      )}
    </ul>

    ${selected === undefined
      ? null
      : EditPanel({
          employee: selected,
          grants: grantsFor(viewer, selected),
          actions,
        })}

    <footer class="app-footer">
      <span
        >Authorization resolved at
        ${granularity === "fine" ? "field" : "subtree"} level</span
      >
    </footer>
  `;
});

type RowProps = {
  employee: Employee;
  managerName: string;
  grants: Grants;
  granularity: Granularity;
  viewer: Viewer;
  actions: ConsoleActions;
};

/**
 * Delegates to the row shape the granularity asks for.
 *
 * Delegation costs no address: whichever row it picks occupies the slot this
 * component was called in, so the wire cannot tell the choice was made here
 * rather than inline in the parent's keyed callback.
 */
const RecordRow = component(function RecordRow(props: RowProps) {
  return props.granularity === "fine"
    ? FineRow({
        employee: props.employee,
        managerName: props.managerName,
        grants: props.grants,
        actions: props.actions,
      })
    : CoarseRow(props);
});

/**
 * Authorization resolved at subtree boundaries.
 *
 * The public block is one nested instance whose bytes do not depend on the
 * viewer at all, so it is the only part of this app that a shared-subtree
 * implementation could hand to every session unchanged.
 */
const CoarseRow = component(function CoarseRow(props: RowProps) {
  const { employee, managerName, grants, actions } = props;

  return html`
    <li class="todo record">
      ${props.granularity === "personal"
        ? PersonalBlock({ employee, managerName, viewer: props.viewer })
        : PublicBlock({ employee, managerName })}
      ${grants.compensation ? CompensationBlock({ employee }) : null}
      ${grants.rating ? RatingBlock({ employee }) : null}
      ${grants.identifiers ? IdentifierBlock({ employee }) : null}
      ${grants.approve && employee.raise?.status === "pending"
        ? ApprovalBlock({ employee, actions })
        : null}
      ${grants.edit
        ? html`<button
            class="link"
            type="button"
            @click=${() => actions.select(employee.id)}
          >
            Edit
          </button>`
        : null}
    </li>
  `;
});

/**
 * Authorization resolved per field.
 *
 * Identical output for identical viewers and identical safety — the privileged
 * values are still absent, not hidden — but the row is now one instance whose
 * every hole depends on the grant, so no part of it is shareable with a viewer
 * holding a different grant.
 */
const FineRow = component(function FineRow(props: {
  employee: Employee;
  managerName: string;
  grants: Grants;
  actions: ConsoleActions;
}) {
  const { employee, managerName, grants, actions } = props;

  return html`
    <li class="todo record">
      <span class="record-name">${employee.name}</span>
      <span class="record-title">${employee.title}</span>
      <span class="record-dept">${employee.department}</span>
      <span class="record-mgr">${managerName}</span>
      <span class="record-salary"
        >${grants.compensation ? formatMoney(employee.salaryCents) : "—"}</span
      >
      <span class="record-raise"
        >${grants.compensation ? raiseSummary(employee) : "—"}</span
      >
      <span class="record-rating"
        >${grants.rating ? `${employee.rating} of 5` : "—"}</span
      >
      <span class="record-note"
        >${grants.rating ? employee.ratingNote : "—"}</span
      >
      <span class="record-ssn">${grants.identifiers ? employee.ssn : "—"}</span>
      <span class="record-bank"
        >${grants.identifiers ? employee.bankAccount : "—"}</span
      >
      ${grants.approve && employee.raise?.status === "pending"
        ? ApprovalBlock({ employee, actions })
        : null}
      ${grants.edit
        ? html`<button
            class="link"
            type="button"
            @click=${() => actions.select(employee.id)}
          >
            Edit
          </button>`
        : null}
    </li>
  `;
});

const PublicBlock = component(function PublicBlock(props: {
  employee: Employee;
  managerName: string;
}) {
  const { employee, managerName } = props;

  return html`
    <div class="record-public">
      <span class="record-name">${employee.name}</span>
      <span class="record-title">${employee.title}</span>
      <span class="record-dept">${employee.department}</span>
      <span class="record-mgr">Reports to ${managerName}</span>
    </div>
  `;
});

/**
 * The same block plus one field whose value is the viewer's own name.
 *
 * Nothing about it is privileged, and it is the smallest change in this file:
 * one hole, in the one subtree every session was sharing.
 */
const PersonalBlock = component(function PersonalBlock(props: {
  employee: Employee;
  managerName: string;
  viewer: Viewer;
}) {
  const { employee, managerName, viewer } = props;

  return html`
    <div class="record-public">
      <span class="record-name">${employee.name}</span>
      <span class="record-title">${employee.title}</span>
      <span class="record-dept">${employee.department}</span>
      <span class="record-mgr">Reports to ${managerName}</span>
      <span class="record-audit">Opened by ${viewer.name}</span>
    </div>
  `;
});

const CompensationBlock = component(function CompensationBlock(props: {
  employee: Employee;
}) {
  const { employee } = props;

  return html`
    <div class="record-comp">
      <span class="record-salary">${formatMoney(employee.salaryCents)}</span>
      <span class="record-raise">${raiseSummary(employee)}</span>
    </div>
  `;
});

const RatingBlock = component(function RatingBlock(props: {
  employee: Employee;
}) {
  const { employee } = props;

  return html`
    <div class="record-rating">
      <span>${employee.rating} of 5</span>
      <span class="record-note">${employee.ratingNote}</span>
    </div>
  `;
});

const IdentifierBlock = component(function IdentifierBlock(props: {
  employee: Employee;
}) {
  const { employee } = props;

  return html`
    <div class="record-ids">
      <span class="record-ssn">${employee.ssn}</span>
      <span class="record-bank">${employee.bankAccount}</span>
    </div>
  `;
});

/**
 * The decision carries the outcome the user chose, not a flip of what they saw,
 * so it is safe to apply late or twice.
 */
const ApprovalBlock = component(function ApprovalBlock(props: {
  employee: Employee;
  actions: ConsoleActions;
}) {
  const { employee, actions } = props;

  return html`
    <div class="record-approval">
      <span
        >Asking ${formatMoney(employee.raise?.requestedCents ?? 0)} ·
        ${employee.raise?.reason ?? ""}</span
      >
      <button
        class="primary"
        type="button"
        @click=${() => actions.decide(employee.id, "approved")}
      >
        Approve
      </button>
      <button
        class="link"
        type="button"
        @click=${() => actions.decide(employee.id, "denied")}
      >
        Deny
      </button>
    </div>
  `;
});

const EditPanel = component(function EditPanel(props: {
  employee: Employee;
  grants: Grants;
  actions: ConsoleActions;
}) {
  const { employee, grants, actions } = props;

  if (!grants.edit) {
    return html`<p class="empty">
      ${employee.name} is not yours to edit.
      <button class="link" type="button" @click=${() => actions.select(null)}>
        Close
      </button>
    </p>`;
  }

  return html`
    <form
      class="add-form"
      @submit=${(event: SubmitPayload) => actions.save(employee.id, event.fields)}
    >
      <input
        name="title"
        value="${employee.title}"
        maxlength="60"
        autocomplete="off"
        required
      />
      <input
        name="salary"
        value="${Math.round(employee.salaryCents / 100)}"
        inputmode="numeric"
        autocomplete="off"
        required
      />
      <button class="primary" type="submit">Save ${employee.name}</button>
      <button class="link" type="button" @click=${() => actions.select(null)}>
        Cancel
      </button>
    </form>
  `;
});

function raiseSummary(employee: Employee): string {
  if (!employee.raise) return "no request";
  return `${formatMoney(employee.raise.requestedCents)} ${employee.raise.status}`;
}

function parseSalary(raw: string): number {
  const digits = raw.replace(/[^0-9]/g, "");
  const dollars = Number(digits);
  if (!Number.isFinite(dollars) || dollars === 0) {
    throw new Error("salary must be a number of dollars");
  }
  return dollars * 100;
}
