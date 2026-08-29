import { html } from "lit-html";

import type { ChangePayload, SubmitPayload } from "../../../shared/protocol";
import {
  component,
  useState,
  useStore,
  type RenderOutput,
} from "../../component";
import { keyed } from "../../keyed";
import {
  COLUMNS,
  TABS,
  type AdminUiState,
  type SortColumn,
} from "./ui-state";
import {
  monthlyValue,
  PLANS,
  SEAT_PRICE,
  STATUSES,
  type Account,
  type AccountStatus,
  type AccountStore,
  type Plan,
} from "./accounts";

/**
 * A menu-heavy admin console with every interaction routed to the server.
 *
 * Opening a menu, hovering a tooltip, collapsing a section, ticking a row and
 * switching a tab all travel the same path as saving a record: an event to the
 * session, a mutation of per-session state, `invalidate()`, a re-render of the
 * whole tree, a diff, and a patch back. That is the only way to express any of
 * it today, and measuring how bad it is is the point of the probe.
 *
 * The disclosure panels are the exception: their collapsed flag lives in a
 * `useState` on the panel itself, because nothing outside the panel reads or
 * writes it. Everything else stays on `AdminUiState`, and each case is a
 * specific piece of cross-component coordination that component scope cannot
 * express — `openOnly()` closing a sibling's menu, a scrim that renders only
 * when some descendant is open, a bulk bar counting a selection made in the
 * table. See `ui-state.ts` for the field-by-field classification.
 *
 * Every control carries a `data-probe` marker so the measurement harness can
 * address it the way the browser does, by finding the event hole that follows
 * the marker.
 */

/** Re-renders this session; `mutate` is optional so async handlers can refresh. */
export type Commit = (mutate?: () => void) => void;

type Run = (
  action: () => Promise<number>,
  describe: (changed: number) => string,
) => Promise<void>;

const TOOLTIPS: Record<string, string> = {
  accounts: "Every account visible to your role.",
  seats: "Seats billed across the accounts matching the current filter.",
  value: "Seats multiplied by the plan's per-seat price.",
  flagged: "Accounts a reviewer marked for a second look.",
};

export function createAdminApp(
  store: AccountStore,
  ui: AdminUiState,
  invalidate: () => void,
): () => RenderOutput {
  const commit: Commit = (mutate) => {
    mutate?.();
    invalidate();
  };

  /**
   * Runs a store mutation from a menu item.
   *
   * The menu closes optimistically on the server, but nothing the user can see
   * changes until the round trip completes, because the server owns the frame.
   */
  const run: Run = async (action, describe) => {
    ui.openOnly(null);
    try {
      ui.toast = describe(await action());
    } catch (error) {
      ui.toast = error instanceof Error ? error.message : String(error);
    }
    commit();
  };

  return () => AdminApp({ store, ui, commit, run });
}

const AdminApp = component(function AdminApp(props: {
  store: AccountStore;
  ui: AdminUiState;
  commit: Commit;
  run: Run;
}) {
  const { ui, commit, run } = props;
  const store = useStore(props.store);

  const all = store.list();
  ui.pruneSelection(new Set(all.map((account) => account.id)));

  const visible = sortAccounts(filterAccounts(all, ui), ui);

  return html`
    <div class="admin admin-${ui.density}">
      ${STYLE} ${Header({ ui, commit })} ${TabStrip({ ui, commit })}
      ${ui.toast === null
        ? null
        : html`<p class="toast">
            <span>${ui.toast}</span>
            <button
              type="button"
              class="linkish"
              data-probe="toast:dismiss"
              @click=${() =>
                commit(() => {
                  ui.toast = null;
                })}
            >
              dismiss
            </button>
          </p>`}
      ${ui.tab === "accounts"
        ? AccountsTab({ store, ui, all, visible, commit, run })
        : ui.tab === "billing"
          ? BillingTab({ all })
          : AuditTab({ store })}
      ${ui.modal === null ? null : ModalLayer({ store, ui, commit })}
      ${ui.openMenu === null
        ? null
        : html`<div
            class="scrim"
            data-probe="scrim"
            @click=${() => commit(() => ui.openOnly(null))}
          ></div>`}
    </div>
  `;
});

const Header = component(function Header(props: {
  ui: AdminUiState;
  commit: Commit;
}) {
  const { ui, commit } = props;

  return html`
    <header class="admin-head">
      <div>
        <h1>Operations console</h1>
        <p class="muted">
          Signed in as ${ui.actor}. Every menu, tab and checkbox below is
          server state.
        </p>
      </div>
      <div class="menu-anchor">
        <button
          type="button"
          data-probe="menu:user"
          @click=${() =>
            commit(() => ui.openOnly(ui.openMenu === "user" ? null : "user"))}
        >
          ${ui.actor} ▾
        </button>
        ${ui.openMenu === "user"
          ? html`<div class="menu menu-right">
              <button
                type="button"
                data-probe="user:density"
                @click=${() =>
                  commit(() => {
                    ui.density =
                      ui.density === "comfortable" ? "compact" : "comfortable";
                    ui.openOnly(null);
                  })}
              >
                Toggle density
              </button>
              <button
                type="button"
                data-probe="user:signout"
                @click=${() =>
                  commit(() => {
                    ui.openOnly(null);
                    ui.toast = "Sign-out is not part of this probe.";
                  })}
              >
                Sign out
              </button>
            </div>`
          : null}
      </div>
    </header>
  `;
});

const TabStrip = component(function TabStrip(props: {
  ui: AdminUiState;
  commit: Commit;
}) {
  const { ui, commit } = props;

  return html`
    <nav class="tabs">
      ${keyed(
        TABS,
        (tab) => tab.id,
        (tab) => html`
          <button
            type="button"
            class="tab ${ui.tab === tab.id ? "tab-active" : ""}"
            data-probe="tab"
            @click=${() =>
              commit(() => {
                ui.tab = tab.id;
                ui.openOnly(null);
              })}
          >
            ${tab.label}
          </button>
        `,
      )}
    </nav>
  `;
});

const AccountsTab = component(function AccountsTab(props: {
  store: AccountStore;
  ui: AdminUiState;
  all: readonly Account[];
  visible: readonly Account[];
  commit: Commit;
  run: Run;
}) {
  const { store, ui, all, visible, commit, run } = props;

  const selected = ui.selectedIds();
  const allVisibleSelected =
    visible.length > 0 && visible.every((account) => ui.isSelected(account.id));

  return html`
    ${FiltersPanel({
      ui,
      commit,
      visibleCount: visible.length,
      totalCount: all.length,
    })}
    ${SummaryPanel({ ui, visible, commit })}

    <div class="toolbar">
      <div class="menu-anchor">
        <button
          type="button"
          data-probe="menu:columns"
          @click=${() =>
            commit(() =>
              ui.openOnly(ui.openMenu === "columns" ? null : "columns"),
            )}
        >
          Columns ▾
        </button>
        ${ui.openMenu === "columns" ? ColumnMenu({ ui, commit }) : null}
      </div>

      <div class="menu-anchor">
        <button
          type="button"
          data-probe="menu:bulk"
          ?disabled=${selected.length === 0}
          @click=${() =>
            commit(() => ui.openOnly(ui.openMenu === "bulk" ? null : "bulk"))}
        >
          Bulk actions ▾
        </button>
        ${ui.openMenu === "bulk"
          ? BulkMenu({ store, ui, selected, run })
          : null}
      </div>

      <button
        type="button"
        class="primary"
        data-probe="open:invite"
        @click=${() =>
          commit(() => {
            ui.openOnly(null);
            ui.modal = { kind: "invite", plan: "team", seats: 5, error: null };
          })}
      >
        Invite account
      </button>
      <span class="grow"></span>
      <span class="muted">${selected.length} selected</span>
    </div>

    ${selected.length === 0
      ? null
      : BulkBar({ store, ui, selected, commit, run })}

    <table class="grid">
      <thead>
        <tr>
          <th class="pick">
            <input
              type="checkbox"
              data-probe="select-all"
              .checked=${allVisibleSelected}
              @change=${(event: ChangePayload) =>
                commit(() => {
                  const wanted = event.checked ?? !allVisibleSelected;
                  for (const account of visible) {
                    ui.setSelected(account.id, wanted);
                  }
                })}
            />
          </th>
          ${SortHeader({ ui, column: "name", label: "Account", commit })}
          ${ui.isColumnVisible("plan")
            ? SortHeader({ ui, column: "plan", label: "Plan", commit })
            : null}
          ${ui.isColumnVisible("status")
            ? SortHeader({ ui, column: "status", label: "Status", commit })
            : null}
          ${ui.isColumnVisible("seats")
            ? SortHeader({ ui, column: "seats", label: "Seats", commit })
            : null}
          ${ui.isColumnVisible("value")
            ? SortHeader({ ui, column: "value", label: "Monthly", commit })
            : null}
          ${ui.isColumnVisible("region")
            ? html`<th class="plain">Region</th>`
            : null}
          <th class="plain"></th>
        </tr>
      </thead>
      <tbody>
        ${keyed(
          visible,
          (account) => account.id,
          (account) => AccountRow({ store, ui, account, commit, run }),
        )}
      </tbody>
    </table>

    ${visible.length === 0
      ? html`<p class="empty">No accounts match this filter.</p>`
      : null}
  `;
});

/**
 * The filters disclosure, including its collapsed flag.
 *
 * This is the one piece of interaction state in the probe that component scope
 * can take: the arrow, the click that toggles it and the body it hides are all
 * inside this component, so no other component needs to name it. It replaces a
 * `Set<string>` on `AdminUiState` keyed by the literal `"filters"`.
 *
 * The cost is a different lifetime. The Set lived as long as the session; this
 * lives as long as the component is rendered, so leaving the Accounts tab and
 * coming back now reopens the panel.
 */
const FiltersPanel = component(function FiltersPanel(props: {
  ui: AdminUiState;
  visibleCount: number;
  totalCount: number;
  commit: Commit;
}) {
  const { ui, visibleCount, totalCount, commit } = props;
  const [collapsed, setCollapsed] = useState(false);

  return html`
    <section class="panel">
      <div class="panel-head">
        <button
          type="button"
          class="disclosure"
          data-probe="collapse:filters"
          @click=${() => setCollapsed(!collapsed)}
        >
          ${collapsed ? "▸" : "▾"} Filters
        </button>
        <span class="muted">${visibleCount} of ${totalCount} accounts</span>
      </div>
      ${collapsed ? null : FilterFields({ ui, commit })}
    </section>
  `;
});

const FilterFields = component(function FilterFields(props: {
  ui: AdminUiState;
  commit: Commit;
}) {
  const { ui, commit } = props;

  return html`
    <div class="panel-body filters">
      <label class="field">
        <span>Status</span>
        <select
          data-probe="filter:status"
          .value=${ui.filterStatus}
          @change=${(event: ChangePayload) =>
            commit(() => {
              ui.filterStatus = (event.value ?? "all") as AccountStatus | "all";
            })}
        >
          <option value="all">All</option>
          <option value="active">active</option>
          <option value="trial">trial</option>
          <option value="suspended">suspended</option>
          <option value="churned">churned</option>
        </select>
      </label>

      <label class="field">
        <span>Plan</span>
        <select
          data-probe="filter:plan"
          .value=${ui.filterPlan}
          @change=${(event: ChangePayload) =>
            commit(() => {
              ui.filterPlan = (event.value ?? "all") as Plan | "all";
            })}
        >
          <option value="all">All</option>
          <option value="free">free</option>
          <option value="team">team</option>
          <option value="business">business</option>
          <option value="enterprise">enterprise</option>
        </select>
      </label>

      <label class="field grow">
        <span>Search</span>
        <input
          type="search"
          placeholder="name or owner"
          autocomplete="off"
          data-probe="filter:query"
          .value=${ui.query}
          @input=${(event: ChangePayload) =>
            commit(() => {
              ui.query = event.value ?? "";
            })}
        />
      </label>

      <button
        type="button"
        data-probe="filter:reset"
        @click=${() =>
          commit(() => {
            ui.filterStatus = "all";
            ui.filterPlan = "all";
            ui.query = "";
          })}
      >
        Reset
      </button>
    </div>
  `;
});

/** The summary disclosure. Same shape as `FiltersPanel`, same reasoning. */
const SummaryPanel = component(function SummaryPanel(props: {
  ui: AdminUiState;
  visible: readonly Account[];
  commit: Commit;
}) {
  const { ui, visible, commit } = props;
  const [collapsed, setCollapsed] = useState(false);

  return html`
    <section class="panel">
      <div class="panel-head">
        <button
          type="button"
          class="disclosure"
          data-probe="collapse:summary"
          @click=${() => setCollapsed(!collapsed)}
        >
          ${collapsed ? "▸" : "▾"} Summary
        </button>
      </div>
      ${collapsed ? null : SummaryCards({ ui, visible, commit })}
    </section>
  `;
});

const SummaryCards = component(function SummaryCards(props: {
  ui: AdminUiState;
  visible: readonly Account[];
  commit: Commit;
}) {
  const { ui, visible, commit } = props;

  const seats = visible.reduce((total, account) => total + account.seats, 0);
  const value = visible.reduce(
    (total, account) => total + monthlyValue(account),
    0,
  );
  const flagged = visible.filter((account) => account.flagged).length;

  const cards: ReadonlyArray<{ id: string; label: string; value: string }> = [
    { id: "accounts", label: "Accounts", value: String(visible.length) },
    { id: "seats", label: "Seats", value: seats.toLocaleString("en-US") },
    {
      id: "value",
      label: "Monthly",
      value: `$${value.toLocaleString("en-US")}`,
    },
    { id: "flagged", label: "Flagged", value: String(flagged) },
  ];

  return html`
    <div class="panel-body cards">
      ${keyed(
        cards,
        (card) => card.id,
        (card) => html`
          <div class="card">
            <span class="card-label">
              ${card.label}
              <span
                class="hint"
                data-probe="tip-in"
                @mouseenter=${() =>
                  commit(() => {
                    ui.hoveredTip = card.id;
                  })}
                data-probe-b="tip-out"
                @mouseleave=${() =>
                  commit(() => {
                    ui.hoveredTip = null;
                  })}
                >?</span
              >
            </span>
            <strong class="card-value">${card.value}</strong>
            ${ui.hoveredTip === card.id
              ? html`<span class="tip">${TOOLTIPS[card.id] ?? ""}</span>`
              : null}
          </div>
        `,
      )}
    </div>
  `;
});

const ColumnMenu = component(function ColumnMenu(props: {
  ui: AdminUiState;
  commit: Commit;
}) {
  const { ui, commit } = props;

  return html`
    <div class="menu">
      ${keyed(
        COLUMNS,
        (column) => column.id,
        (column) => html`
          <label class="menu-check">
            <input
              type="checkbox"
              data-probe="column"
              .checked=${ui.isColumnVisible(column.id)}
              @change=${(event: ChangePayload) =>
                commit(() =>
                  ui.toggleColumn(
                    column.id,
                    event.checked ?? !ui.isColumnVisible(column.id),
                  ),
                )}
            />
            <span>${column.label}</span>
          </label>
        `,
      )}
    </div>
  `;
});

const BulkMenu = component(function BulkMenu(props: {
  store: AccountStore;
  ui: AdminUiState;
  selected: readonly string[];
  run: Run;
}) {
  const { store, ui, run } = props;

  // Captured when the menu rendered, so the action names a set rather than
  // reading whatever is selected by the time the click lands.
  const ids = [...props.selected];

  return html`
    <div class="menu menu-wide">
      <button
        type="button"
        data-probe="bulk:activate"
        @click=${() =>
          run(
            () => store.setStatus(ids, "active", ui.actor),
            (changed) => `Activated ${changed} of ${ids.length}.`,
          )}
      >
        Mark active
      </button>
      <button
        type="button"
        data-probe="bulk:flag"
        @click=${() =>
          run(
            () => store.setFlagged(ids, true, ui.actor),
            (changed) => `Flagged ${changed} of ${ids.length}.`,
          )}
      >
        Flag for review
      </button>
      <button
        type="button"
        data-probe="bulk:unflag"
        @click=${() =>
          run(
            () => store.setFlagged(ids, false, ui.actor),
            (changed) => `Cleared ${changed} flags.`,
          )}
      >
        Clear review flag
      </button>
      <div class="menu-group">
        <span class="menu-label">Move to plan</span>
        ${keyed(
          PLANS,
          (plan) => plan,
          (plan) => html`
            <button
              type="button"
              data-probe="bulk:plan"
              @click=${() =>
                run(
                  () => store.setPlan(ids, plan, ui.actor),
                  (changed) => `Moved ${changed} accounts to ${plan}.`,
                )}
            >
              ${plan}
            </button>
          `,
        )}
      </div>
    </div>
  `;
});

const BulkBar = component(function BulkBar(props: {
  store: AccountStore;
  ui: AdminUiState;
  selected: readonly string[];
  commit: Commit;
  run: Run;
}) {
  const { store, ui, commit, run } = props;
  const ids = [...props.selected];

  return html`
    <div class="bulk-bar">
      <strong>${ids.length} selected</strong>
      <button
        type="button"
        data-probe="bulk-bar:activate"
        @click=${() =>
          run(
            () => store.setStatus(ids, "active", ui.actor),
            (changed) => `Activated ${changed} of ${ids.length}.`,
          )}
      >
        Mark active
      </button>
      <button
        type="button"
        data-probe="bulk-bar:suspend"
        @click=${() =>
          commit(() => {
            ui.openOnly(null);
            ui.modal = { kind: "confirm", action: "suspend", ids };
          })}
      >
        Suspend…
      </button>
      <button
        type="button"
        class="danger"
        data-probe="bulk-bar:delete"
        @click=${() =>
          commit(() => {
            ui.openOnly(null);
            ui.modal = { kind: "confirm", action: "delete", ids };
          })}
      >
        Delete…
      </button>
      <span class="grow"></span>
      <button
        type="button"
        class="linkish"
        data-probe="bulk-bar:clear"
        @click=${() => commit(() => ui.selection.clear())}
      >
        Clear selection
      </button>
    </div>
  `;
});

const SortHeader = component(function SortHeader(props: {
  ui: AdminUiState;
  column: SortColumn;
  label: string;
  commit: Commit;
}) {
  const { ui, column, label, commit } = props;

  const marker =
    ui.sortColumn === column ? (ui.sortDirection === "asc" ? " ▲" : " ▼") : "";

  return html`<th>
    <button
      type="button"
      class="sort"
      data-probe="sort"
      @click=${() => commit(() => ui.sortBy(column))}
    >
      ${label}${marker}
    </button>
  </th>`;
});

const AccountRow = component(function AccountRow(props: {
  store: AccountStore;
  ui: AdminUiState;
  account: Account;
  commit: Commit;
  run: Run;
}) {
  const { store, ui, account, commit, run } = props;

  const selected = ui.isSelected(account.id);
  const menuOpen = ui.openMenu === `row:${account.id}`;

  return html`
    <tr class="${selected ? "row-selected" : "row"}">
      <td class="pick">
        <input
          type="checkbox"
          data-probe="row-select"
          .checked=${selected}
          @change=${(event: ChangePayload) =>
            commit(() => ui.setSelected(account.id, event.checked ?? !selected))}
        />
      </td>
      <td class="name">
        <span class="name-text">${account.name}</span>
        ${account.flagged ? html`<span class="flag">flagged</span>` : null}
        <span
          class="hint"
          data-probe="tip-in"
          @mouseenter=${() =>
            commit(() => {
              ui.hoveredTip = `row:${account.id}`;
            })}
          data-probe-b="tip-out"
          @mouseleave=${() =>
            commit(() => {
              ui.hoveredTip = null;
            })}
          >?</span
        >
        ${ui.hoveredTip === `row:${account.id}`
          ? html`<span class="tip">${account.owner} · ${account.region}</span>`
          : null}
      </td>
      ${ui.isColumnVisible("plan")
        ? html`<td><span class="badge">${account.plan}</span></td>`
        : null}
      ${ui.isColumnVisible("status")
        ? html`<td>
            <span class="badge badge-${account.status}">${account.status}</span>
          </td>`
        : null}
      ${ui.isColumnVisible("seats")
        ? html`<td class="numeric">${account.seats}</td>`
        : null}
      ${ui.isColumnVisible("value")
        ? html`<td class="numeric">
            $${monthlyValue(account).toLocaleString("en-US")}
          </td>`
        : null}
      ${ui.isColumnVisible("region")
        ? html`<td class="muted">${account.region}</td>`
        : null}
      <td class="row-actions">
        <div class="menu-anchor">
          <button
            type="button"
            class="dots"
            data-probe="menu:row"
            @click=${() =>
              commit(() => ui.openOnly(menuOpen ? null : `row:${account.id}`))}
          >
            ⋯
          </button>
          ${menuOpen ? RowMenu({ store, ui, account, commit, run }) : null}
        </div>
      </td>
    </tr>
  `;
});

const RowMenu = component(function RowMenu(props: {
  store: AccountStore;
  ui: AdminUiState;
  account: Account;
  commit: Commit;
  run: Run;
}) {
  const { store, ui, account, commit, run } = props;

  return html`
    <div class="menu menu-right">
      <button
        type="button"
        data-probe="row:edit"
        @click=${() =>
          commit(() => {
            ui.openOnly(null);
            ui.modal = {
              kind: "edit",
              id: account.id,
              plan: account.plan,
              status: account.status,
              seats: account.seats,
              error: null,
            };
          })}
      >
        Edit…
      </button>
      <button
        type="button"
        data-probe="row:flag"
        @click=${() =>
          run(
            () => store.setFlagged([account.id], !account.flagged, ui.actor),
            () =>
              account.flagged
                ? `Cleared the flag on ${account.name}.`
                : `Flagged ${account.name}.`,
          )}
      >
        ${account.flagged ? "Clear flag" : "Flag for review"}
      </button>
      <button
        type="button"
        data-probe="row:suspend"
        @click=${() =>
          run(
            () => store.setStatus([account.id], "suspended", ui.actor),
            () => `Suspended ${account.name}.`,
          )}
      >
        Suspend
      </button>
      <button
        type="button"
        class="danger"
        data-probe="row:delete"
        @click=${() =>
          commit(() => {
            ui.openOnly(null);
            ui.modal = {
              kind: "confirm",
              action: "delete",
              ids: [account.id],
            };
          })}
      >
        Delete…
      </button>
    </div>
  `;
});

const ModalLayer = component(function ModalLayer(props: {
  store: AccountStore;
  ui: AdminUiState;
  commit: Commit;
}) {
  const { store, ui, commit } = props;
  const modal = ui.modal;

  return html`
    <div class="overlay">
      <div class="dialog">
        ${modal === null
          ? null
          : modal.kind === "edit"
            ? EditDialog({ store, ui, commit })
            : modal.kind === "invite"
              ? InviteDialog({ store, ui, commit })
              : ConfirmDialog({ store, ui, commit })}
      </div>
    </div>
  `;
});

const EditDialog = component(function EditDialog(props: {
  store: AccountStore;
  ui: AdminUiState;
  commit: Commit;
}) {
  const { ui, commit } = props;
  const store = useStore(props.store);

  const modal = ui.modal;
  if (modal?.kind !== "edit") return html`<p class="empty"></p>`;

  const account = store.get(modal.id);
  if (!account) {
    return html`<div class="dialog-body">
      <h2>That account is gone</h2>
      <p class="muted">It was deleted while this dialog was open.</p>
      <div class="dialog-actions">
        <button
          type="button"
          data-probe="modal:close"
          @click=${() =>
            commit(() => {
              ui.modal = null;
            })}
        >
          Close
        </button>
      </div>
    </div>`;
  }

  // Derived from the server-held draft, which is exactly why the draft cannot
  // be an uncontrolled input the way the notes field below is.
  const projected = SEAT_PRICE[modal.plan] * modal.seats;

  return html`
    <form
      class="dialog-body"
      data-probe="modal:save"
      @submit=${async (event: SubmitPayload) => {
        try {
          await store.save(
            modal.id,
            {
              plan: modal.plan,
              status: modal.status,
              seats: modal.seats,
              // The textarea is uncontrolled, so the server has never seen it
              // and cannot tell "cleared" from "never typed in". Treating empty
              // as "leave it alone" is the bespoke patch A1 forces on you.
              notes: nonEmpty(event.fields["notes"]) ?? account.notes,
            },
            ui.actor,
          );
          ui.modal = null;
          ui.toast = `Saved ${account.name}.`;
        } catch (error) {
          modal.error = error instanceof Error ? error.message : String(error);
        }
        commit();
      }}
    >
      <h2>Edit ${account.name}</h2>
      <p class="muted">${account.owner}</p>

      <label class="field">
        <span>Plan</span>
        <select
          data-probe="modal:plan"
          .value=${modal.plan}
          @change=${(event: ChangePayload) =>
            commit(() => {
              modal.plan = (event.value ?? modal.plan) as Plan;
              modal.error = null;
            })}
        >
          <option value="free">free</option>
          <option value="team">team</option>
          <option value="business">business</option>
          <option value="enterprise">enterprise</option>
        </select>
      </label>

      <label class="field">
        <span>Status</span>
        <select
          data-probe="modal:status"
          .value=${modal.status}
          @change=${(event: ChangePayload) =>
            commit(() => {
              modal.status = (event.value ?? modal.status) as AccountStatus;
              modal.error = null;
            })}
        >
          <option value="active">active</option>
          <option value="trial">trial</option>
          <option value="suspended">suspended</option>
          <option value="churned">churned</option>
        </select>
      </label>

      <label class="field">
        <span>Seats</span>
        <input
          type="number"
          min="1"
          data-probe="modal:seats"
          .value=${String(modal.seats)}
          @change=${(event: ChangePayload) =>
            commit(() => {
              const seats = Number(event.value);
              modal.seats = Number.isFinite(seats) ? Math.trunc(seats) : 0;
              modal.error = null;
            })}
        />
      </label>

      <label class="field">
        <span>Notes (client-owned draft)</span>
        <textarea
          name="notes"
          rows="2"
          maxlength="400"
          placeholder="The server cannot read this until submit."
        ></textarea>
      </label>
      ${account.notes.length === 0
        ? null
        : html`<p class="muted">Current note: ${account.notes}</p>`}

      <p class="projection">
        Projected monthly:
        <strong>$${projected.toLocaleString("en-US")}</strong>
      </p>
      ${modal.error === null ? null : html`<p class="error">${modal.error}</p>`}

      <div class="dialog-actions">
        <button
          type="button"
          class="linkish"
          data-probe="modal:cancel"
          @click=${() =>
            commit(() => {
              ui.modal = null;
            })}
        >
          Cancel
        </button>
        <button type="submit" class="primary">Save changes</button>
      </div>
    </form>
  `;
});

const InviteDialog = component(function InviteDialog(props: {
  store: AccountStore;
  ui: AdminUiState;
  commit: Commit;
}) {
  const { store, ui, commit } = props;

  const modal = ui.modal;
  if (modal?.kind !== "invite") return html`<p class="empty"></p>`;

  return html`
    <form
      class="dialog-body"
      data-probe="invite:submit"
      @submit=${async (event: SubmitPayload) => {
        try {
          const account = await store.invite(
            {
              name: event.fields["name"] ?? "",
              owner: event.fields["owner"] ?? "",
              plan: modal.plan,
              seats: modal.seats,
            },
            ui.actor,
          );
          ui.modal = null;
          ui.toast = `Invited ${account.name} as ${account.id}.`;
        } catch (error) {
          modal.error = error instanceof Error ? error.message : String(error);
        }
        commit();
      }}
    >
      <h2>Invite an account</h2>
      <p class="muted">
        The id is generated by the server, so this is the one dialog here an SPA
        would also have to wait for.
      </p>

      <label class="field">
        <span>Name</span>
        <input name="name" autocomplete="off" maxlength="80" required />
      </label>
      <label class="field">
        <span>Owner email</span>
        <input name="owner" autocomplete="off" maxlength="120" required />
      </label>
      <label class="field">
        <span>Plan</span>
        <select
          data-probe="invite:plan"
          .value=${modal.plan}
          @change=${(event: ChangePayload) =>
            commit(() => {
              modal.plan = (event.value ?? modal.plan) as Plan;
              modal.error = null;
            })}
        >
          <option value="free">free</option>
          <option value="team">team</option>
          <option value="business">business</option>
          <option value="enterprise">enterprise</option>
        </select>
      </label>
      ${modal.error === null ? null : html`<p class="error">${modal.error}</p>`}

      <div class="dialog-actions">
        <button
          type="button"
          class="linkish"
          data-probe="invite:cancel"
          @click=${() =>
            commit(() => {
              ui.modal = null;
            })}
        >
          Cancel
        </button>
        <button type="submit" class="primary">Send invite</button>
      </div>
    </form>
  `;
});

const ConfirmDialog = component(function ConfirmDialog(props: {
  store: AccountStore;
  ui: AdminUiState;
  commit: Commit;
}) {
  const { store, ui, commit } = props;

  const modal = ui.modal;
  if (modal?.kind !== "confirm") return html`<p class="empty"></p>`;

  const ids = modal.ids;
  const verb = modal.action === "delete" ? "Delete" : "Suspend";

  return html`
    <div class="dialog-body">
      <h2>${verb} ${ids.length} account${ids.length === 1 ? "" : "s"}?</h2>
      <p class="muted">
        This applies to the accounts named when the dialog opened, not to
        whatever is selected by the time you confirm.
      </p>
      <div class="dialog-actions">
        <button
          type="button"
          class="linkish"
          data-probe="confirm:cancel"
          @click=${() =>
            commit(() => {
              ui.modal = null;
            })}
        >
          Cancel
        </button>
        <button
          type="button"
          class="danger"
          data-probe="confirm:ok"
          @click=${async () => {
            try {
              const changed =
                modal.action === "delete"
                  ? await store.remove(ids, ui.actor)
                  : await store.setStatus(ids, "suspended", ui.actor);
              ui.toast = `${verb}d ${changed} of ${ids.length}.`;
              ui.selection.clear();
            } catch (error) {
              ui.toast = error instanceof Error ? error.message : String(error);
            }
            ui.modal = null;
            commit();
          }}
        >
          ${verb}
        </button>
      </div>
    </div>
  `;
});

const BillingTab = component(function BillingTab(props: {
  all: readonly Account[];
}) {
  const groups = PLANS.map((plan) => {
    const accounts = props.all.filter((account) => account.plan === plan);
    return {
      plan,
      count: accounts.length,
      seats: accounts.reduce((total, account) => total + account.seats, 0),
      value: accounts.reduce(
        (total, account) => total + monthlyValue(account),
        0,
      ),
    };
  });

  return html`
    <section class="panel">
      <div class="panel-body">
        <table class="grid">
          <thead>
            <tr>
              <th class="plain">Plan</th>
              <th class="plain">Accounts</th>
              <th class="plain">Seats</th>
              <th class="plain">Monthly</th>
            </tr>
          </thead>
          <tbody>
            ${keyed(
              groups,
              (group) => group.plan,
              (group) => html`
                <tr class="row">
                  <td><span class="badge">${group.plan}</span></td>
                  <td class="numeric">${group.count}</td>
                  <td class="numeric">
                    ${group.seats.toLocaleString("en-US")}
                  </td>
                  <td class="numeric">
                    $${group.value.toLocaleString("en-US")}
                  </td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </section>
  `;
});

const AuditTab = component(function AuditTab(props: { store: AccountStore }) {
  const store = useStore(props.store);
  const entries = store.audit();

  return html`
    <section class="panel">
      <div class="panel-body">
        ${entries.length === 0
          ? html`<p class="empty">Nothing has been changed yet.</p>`
          : html`<ol class="audit">
              ${keyed(
                entries,
                (entry) => entry.id,
                (entry) => html`
                  <li>
                    <span class="muted"
                      >${new Date(entry.at).toISOString().slice(11, 19)}</span
                    >
                    <strong>${entry.actor}</strong>
                    <span>${entry.action}</span>
                    <span class="muted">(${entry.targets})</span>
                  </li>
                `,
              )}
            </ol>`}
      </div>
    </section>
  `;
});

function nonEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  return value.trim().length === 0 ? null : value;
}

function filterAccounts(
  accounts: readonly Account[],
  ui: AdminUiState,
): Account[] {
  const query = ui.query.trim().toLowerCase();

  return accounts.filter((account) => {
    if (ui.filterStatus !== "all" && account.status !== ui.filterStatus) {
      return false;
    }
    if (ui.filterPlan !== "all" && account.plan !== ui.filterPlan) {
      return false;
    }
    if (query.length === 0) return true;
    return (
      account.name.toLowerCase().includes(query) ||
      account.owner.toLowerCase().includes(query)
    );
  });
}

function sortAccounts(accounts: Account[], ui: AdminUiState): Account[] {
  const direction = ui.sortDirection === "asc" ? 1 : -1;

  return [...accounts].sort((left, right) => {
    const comparison = compareBy(ui.sortColumn, left, right);
    if (comparison !== 0) return comparison * direction;
    return left.id.localeCompare(right.id);
  });
}

function compareBy(column: SortColumn, left: Account, right: Account): number {
  switch (column) {
    case "name":
      return left.name.localeCompare(right.name);
    case "plan":
      return PLANS.indexOf(left.plan) - PLANS.indexOf(right.plan);
    case "status":
      return STATUSES.indexOf(left.status) - STATUSES.indexOf(right.status);
    case "seats":
      return left.seats - right.seats;
    case "value":
      return monthlyValue(left) - monthlyValue(right);
  }
}

/**
 * Layout for the probe, shipped as part of the template.
 *
 * The client stylesheet is owned by the coordinator and styles the todo app, so
 * a probe that wants its own look has to carry it. Templates cross the wire
 * once per connection, so this is a one-time cost rather than a per-render one.
 */
const STYLE = html`
  <style>
    .admin { font-size: 14px; position: relative; }
    .admin-compact { font-size: 12.5px; }
    .admin h1 { margin: 0; font-size: 1.35rem; }
    .admin h2 { margin: 0 0 0.35rem; font-size: 1.05rem; }
    .admin .muted { color: var(--text-muted); }
    .admin .grow { flex: 1; }
    .admin-head {
      display: flex; align-items: start; justify-content: space-between;
      gap: 1rem; margin-bottom: 1rem;
    }
    .admin-head p { margin: 0.25rem 0 0; font-size: 0.85rem; }
    .tabs { display: flex; gap: 0.35rem; border-bottom: 1px solid var(--border); }
    .tab {
      padding: 0.45rem 0.85rem; background: transparent; color: var(--text-muted);
      border-bottom: 2px solid transparent; border-radius: 6px 6px 0 0;
    }
    .tab-active { color: var(--text); border-bottom-color: var(--accent); }
    .toast {
      display: flex; align-items: center; justify-content: space-between;
      gap: 0.75rem; margin: 0.75rem 0 0; padding: 0.5rem 0.75rem;
      background: var(--surface-raised); border: 1px solid var(--border);
      border-radius: 8px; font-size: 0.85rem;
    }
    .panel { margin-top: 0.9rem; border: 1px solid var(--border); border-radius: 8px; }
    .panel-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 0.75rem; padding: 0.4rem 0.6rem;
    }
    .panel-body { padding: 0.2rem 0.6rem 0.7rem; }
    .disclosure {
      background: transparent; color: var(--text); font-weight: 600;
      padding: 0.25rem 0.35rem;
    }
    .filters { display: flex; align-items: end; gap: 0.6rem; flex-wrap: wrap; }
    .field {
      display: flex; flex-direction: column; gap: 0.2rem;
      font-size: 0.75rem; color: var(--text-muted);
    }
    .field select, .field input, .field textarea {
      padding: 0.35rem 0.45rem; background: var(--surface-sunken);
      border: 1px solid var(--border); border-radius: 6px; color: var(--text);
      font: inherit; font-size: 0.85rem;
    }
    .cards { display: flex; gap: 0.6rem; flex-wrap: wrap; }
    .card {
      position: relative; flex: 1; min-width: 7rem; padding: 0.5rem 0.6rem;
      background: var(--surface-raised); border: 1px solid var(--border);
      border-radius: 8px;
    }
    .card-label { display: block; font-size: 0.72rem; color: var(--text-muted); }
    .card-value { font-size: 1.15rem; }
    .hint {
      display: inline-flex; align-items: center; justify-content: center;
      width: 1rem; height: 1rem; margin-left: 0.2rem; border-radius: 50%;
      background: var(--surface-sunken); border: 1px solid var(--border);
      font-size: 0.65rem; cursor: help;
    }
    .tip {
      position: absolute; z-index: 3; bottom: 100%; left: 50%;
      transform: translateX(-50%); margin-bottom: 0.25rem;
      padding: 0.3rem 0.5rem; background: #0f1319;
      border: 1px solid var(--border); border-radius: 6px;
      font-size: 0.72rem; white-space: nowrap;
    }
    .toolbar { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.9rem; }
    .toolbar button, .bulk-bar button, .dialog button,
    .panel button:not(.disclosure) {
      padding: 0.35rem 0.6rem; background: var(--surface-raised);
      border-color: var(--border); color: var(--text); font-size: 0.85rem;
    }
    .admin-head button {
      padding: 0.35rem 0.6rem; background: var(--surface-raised);
      border-color: var(--border); color: var(--text); font-size: 0.85rem;
    }
    .toolbar button[disabled] { opacity: 0.45; cursor: not-allowed; }
    .menu-anchor { position: relative; }
    .menu {
      position: absolute; z-index: 4; top: calc(100% + 0.25rem); left: 0;
      display: flex; flex-direction: column; min-width: 9rem; padding: 0.25rem;
      background: var(--surface-raised); border: 1px solid var(--border);
      border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    }
    .menu-right { left: auto; right: 0; }
    .menu-wide { min-width: 12rem; }
    .menu button, .menu-check {
      display: flex; align-items: center; gap: 0.4rem; padding: 0.35rem 0.5rem;
      background: transparent; border: 0; color: var(--text); text-align: left;
      font-size: 0.85rem; border-radius: 6px; cursor: pointer;
    }
    .menu button:hover, .menu-check:hover { background: var(--surface-sunken); }
    .menu-group {
      border-top: 1px solid var(--border); margin-top: 0.25rem;
      padding-top: 0.25rem;
    }
    .menu-label {
      display: block; padding: 0.2rem 0.5rem; font-size: 0.68rem;
      color: var(--text-muted); text-transform: uppercase;
    }
    .scrim { position: fixed; inset: 0; z-index: 2; }
    .bulk-bar {
      display: flex; align-items: center; gap: 0.6rem; margin-top: 0.6rem;
      padding: 0.45rem 0.6rem; background: var(--accent-strong);
      border: 1px solid var(--accent); border-radius: 8px; font-size: 0.85rem;
    }
    .grid { width: 100%; margin-top: 0.6rem; border-collapse: collapse; }
    .grid th, .grid td {
      padding: 0.3rem 0.45rem; border-bottom: 1px solid var(--border);
      text-align: left; font-size: 0.85rem;
    }
    .admin-compact .grid th, .admin-compact .grid td { padding: 0.15rem 0.4rem; }
    .grid th {
      font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase;
    }
    .grid .pick { width: 1.6rem; }
    .grid .numeric { text-align: right; font-variant-numeric: tabular-nums; }
    .grid .name { position: relative; }
    .sort { padding: 0; background: transparent; color: inherit; font: inherit; }
    .row-selected { background: rgba(97, 47, 118, 0.28); }
    .badge {
      display: inline-block; padding: 0.05rem 0.4rem; border-radius: 999px;
      background: var(--surface-raised); border: 1px solid var(--border);
      font-size: 0.72rem;
    }
    .badge-suspended { color: var(--danger); border-color: var(--danger); }
    .badge-active { color: var(--success); border-color: var(--success); }
    .flag { margin-left: 0.3rem; color: var(--danger); font-size: 0.68rem; }
    .row-actions { text-align: right; }
    .dots { padding: 0 0.35rem; background: transparent; color: var(--text-muted); }
    .overlay {
      position: fixed; inset: 0; z-index: 5; display: flex;
      align-items: center; justify-content: center;
      background: rgba(8, 10, 14, 0.6);
    }
    .dialog {
      width: min(26rem, 92vw); background: var(--surface);
      border: 1px solid var(--border); border-radius: 10px;
    }
    .dialog-body {
      display: flex; flex-direction: column; gap: 0.55rem; padding: 1rem;
    }
    .dialog-actions {
      display: flex; justify-content: end; gap: 0.5rem; margin-top: 0.3rem;
    }
    .projection { margin: 0; font-size: 0.85rem; color: var(--text-muted); }
    .error { margin: 0; color: var(--danger); font-size: 0.82rem; }
    .linkish {
      background: transparent; color: var(--text-muted); text-decoration: underline;
    }
    .danger { color: var(--danger); border-color: var(--danger); }
    .audit { margin: 0; padding-left: 1.1rem; font-size: 0.82rem; }
    .audit li { padding: 0.1rem 0; }
    .empty { padding: 1rem 0; color: var(--text-muted); text-align: center; }
  </style>
`;
