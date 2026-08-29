import type { AccountStatus, Plan } from "./accounts";

/**
 * The interaction state in the admin UI that no single component can own.
 *
 * The prototype has one client-owned thing — an uncontrolled text input — and
 * it does not generalise (design-probes.md A1), so a menu that wants to be
 * open, a row that wants to look selected and a dialog that wants to be
 * visible are all server state, published with `session.invalidate()`.
 *
 * What is no longer here is as interesting as what is. `collapsed` used to be
 * a `Set<string>` keyed by section name with `isCollapsed`/`setCollapsed`
 * around it; each panel now holds its own flag in a `useState`, because the
 * arrow, the toggle and the hidden body are all inside one component.
 *
 * Nothing else could follow it, and always for the same reason: some other
 * component reads it. `openMenu` and `hoveredTip` are cleared by `openOnly()`
 * from wherever a menu is opened, and the scrim renders on the strength of
 * "is anything open at all", which no descendant can answer for its siblings.
 * `selection` is written in the table and read by the bulk bar and the toolbar
 * count. `columns`, the sort and the filters are written in one menu and read
 * by another subtree entirely. Lifting those is not a workaround for a missing
 * feature; it is what shared state means.
 *
 * `STATE_INVENTORY` below records what each field would be owned by in a
 * design that had client primitives, and that classification is the probe's
 * actual deliverable. It classifies the app's interaction state wherever that
 * state now lives, so `collapsed` is still listed.
 */

export type TabId = "accounts" | "billing" | "audit";
export type ColumnId = "plan" | "status" | "seats" | "value" | "region";
export type SortColumn = "name" | "plan" | "status" | "seats" | "value";
export type SortDirection = "asc" | "desc";
export type Density = "comfortable" | "compact";

export type ModalState =
  | {
      kind: "edit";
      id: string;
      plan: Plan;
      status: AccountStatus;
      seats: number;
      error: string | null;
    }
  | { kind: "invite"; plan: Plan; seats: number; error: string | null }
  | {
      kind: "confirm";
      action: "delete" | "suspend";
      /**
       * The ids captured when the dialog opened, not a reference to the live
       * selection. Confirming states an outcome for a named set (I6); reading
       * the selection at confirm time would mean something different if it
       * changed while the dialog was up.
       */
      ids: string[];
    };

export const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "accounts", label: "Accounts" },
  { id: "billing", label: "Billing" },
  { id: "audit", label: "Audit log" },
];

export const COLUMNS: ReadonlyArray<{ id: ColumnId; label: string }> = [
  { id: "plan", label: "Plan" },
  { id: "status", label: "Status" },
  { id: "seats", label: "Seats" },
  { id: "value", label: "Monthly" },
  { id: "region", label: "Region" },
];

const DEFAULT_COLUMNS: ColumnId[] = ["plan", "status", "seats", "value"];

/**
 * Per-connection UI state.
 *
 * Constructed inside `createApp`, so two browser tabs of the same operator
 * diverge completely: nothing here is shared and nothing here is durable.
 */
export class AdminUiState {
  readonly actor: string;

  tab: TabId = "accounts";
  /** At most one menu is open; the value names which one. */
  openMenu: string | null = null;
  hoveredTip: string | null = null;
  selection = new Set<string>();
  modal: ModalState | null = null;
  sortColumn: SortColumn = "name";
  sortDirection: SortDirection = "asc";
  filterStatus: AccountStatus | "all" = "all";
  filterPlan: Plan | "all" = "all";
  query = "";
  columns = new Set<ColumnId>(DEFAULT_COLUMNS);
  density: Density = "comfortable";
  toast: string | null = null;

  constructor(actor: string) {
    this.actor = actor;
  }

  /** Menus, tooltips and dialogs are mutually exclusive overlays. */
  openOnly(menu: string | null): void {
    this.openMenu = menu;
    this.hoveredTip = null;
  }

  isSelected(id: string): boolean {
    return this.selection.has(id);
  }

  setSelected(id: string, selected: boolean): void {
    if (selected) this.selection.add(id);
    else this.selection.delete(id);
  }

  selectedIds(): string[] {
    return [...this.selection];
  }

  /**
   * Drops ids that no longer exist.
   *
   * Selection is UI state that names application records, so it goes stale
   * whenever anyone deletes a row — including someone in another session.
   */
  pruneSelection(existing: ReadonlySet<string>): void {
    for (const id of this.selection) {
      if (!existing.has(id)) this.selection.delete(id);
    }
  }

  isColumnVisible(id: ColumnId): boolean {
    return this.columns.has(id);
  }

  toggleColumn(id: ColumnId, visible: boolean): void {
    if (visible) this.columns.add(id);
    else this.columns.delete(id);
  }

  sortBy(column: SortColumn): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
      return;
    }
    this.sortColumn = column;
    this.sortDirection = "asc";
  }
}

/**
 * Ownership classification for every field above.
 *
 * - `ephemeral`: the server never needs to know. A client primitive could own
 *   it outright and the server would render the same tree either way.
 * - `render-affecting`: the client owns the gesture, but the value decides what
 *   the server renders, so the server has to be told. A primitive removes the
 *   flicker but not the round trip unless the client already holds the data.
 * - `application`: durable, shared, authoritative. Belongs on the server under
 *   any architecture.
 *
 * The middle class is the interesting one and it is not in the A2 candidate
 * list in design-probes.md.
 */
export type Ownership = "ephemeral" | "render-affecting" | "application";

export type InventoryEntry = {
  state: string;
  ownership: Ownership;
  /** The A2 primitive that would own it, or null if no primitive can. */
  primitive: string | null;
  note: string;
};

export const STATE_INVENTORY: readonly InventoryEntry[] = [
  {
    state: "openMenu",
    ownership: "ephemeral",
    primitive: "disclosure",
    note: "Which dropdown is open. Contents are server-rendered, so the split runs through one component.",
  },
  {
    state: "hoveredTip",
    ownership: "ephemeral",
    primitive: "disclosure (hover-triggered)",
    note: "Two round trips per hover today: enter and leave.",
  },
  {
    state: "collapsed",
    ownership: "ephemeral",
    primitive: "disclosure",
    note: "Collapsed sections. Now owned by a useState on each panel component rather than a keyed Set here, because nothing outside a panel reads or writes its flag. Still a round trip, so the classification is unchanged.",
  },
  {
    state: "modal (open/closed)",
    ownership: "ephemeral",
    primitive: "disclosure",
    note: "Visibility is ephemeral even though the dialog's contents are not.",
  },
  {
    state: "modal draft fields",
    ownership: "render-affecting",
    primitive: "text input, only for fields nothing derives from",
    note: "Seats drives a server-computed total, so an uncontrolled input cannot hold it.",
  },
  {
    state: "density",
    ownership: "ephemeral",
    primitive: "class toggle",
    note: "Pure presentation; the cheapest possible round trip and still a round trip.",
  },
  {
    state: "tab",
    ownership: "render-affecting",
    primitive: "none",
    note: "Selects which subtree exists. Server must render the destination (S2).",
  },
  {
    state: "selection",
    ownership: "render-affecting",
    primitive: "selection set",
    note: "Ephemeral in nature, but the bulk bar, the counts and the enabled actions all derive from it.",
  },
  {
    state: "columns",
    ownership: "render-affecting",
    primitive: "none",
    note: "Column visibility decides which cells are rendered at all, which is I2 working as designed.",
  },
  {
    state: "sortColumn / sortDirection",
    ownership: "render-affecting",
    primitive: "none",
    note: "Ordering is a property of the rendered list, and the client holds no list to reorder.",
  },
  {
    state: "filterStatus / filterPlan / query",
    ownership: "render-affecting",
    primitive: "text input with echo suppression, for the field only",
    note: "The keystroke is ephemeral, the result is a different query. A primitive fixes the caret, not the wait.",
  },
  {
    state: "toast",
    ownership: "ephemeral",
    primitive: "none",
    note: "Produced by the server, so it arrives with the round trip that caused it.",
  },
  {
    state: "accounts / audit",
    ownership: "application",
    primitive: null,
    note: "Durable and shared. Round trips here are not a differentiator.",
  },
];
