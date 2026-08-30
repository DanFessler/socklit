import {
  component,
  createJsonStore,
  html,
  keyed,
  StoreError,
  type SessionHandle,
  type SubmitPayload,
  useState,
  useStore,
} from "socklit/server";

import { IncidentBoard } from "./incident-board";
import type { IncidentCard, IncidentStatus, Severity } from "./incident-types";
import { STAFF, memberName, type Member } from "./staff";

export type Incident = {
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  authorId: string;
  ownerId: string | null;
  filedAt: string;
};

function parseIncidents(raw: unknown): Incident[] {
  if (!Array.isArray(raw)) throw new StoreError("expected an array");
  return raw.map((row) => {
    if (!row || typeof row !== "object") throw new StoreError("expected incidents");
    const { id, title, severity, status, authorId, ownerId, filedAt } = row as {
      id?: unknown;
      title?: unknown;
      severity?: unknown;
      status?: unknown;
      authorId?: unknown;
      ownerId?: unknown;
      filedAt?: unknown;
    };
    if (typeof id !== "string" || typeof title !== "string") {
      throw new StoreError("invalid incident");
    }
    if (severity !== "low" && severity !== "high") {
      throw new StoreError("invalid severity");
    }
    if (status !== "open" && status !== "resolved") {
      throw new StoreError("invalid status");
    }
    if (typeof authorId !== "string") throw new StoreError("invalid author");
    if (!(ownerId === null || typeof ownerId === "string")) {
      throw new StoreError("invalid owner");
    }
    if (typeof filedAt !== "string") throw new StoreError("invalid time");
    return { id, title, severity, status, authorId, ownerId, filedAt };
  });
}

/** Shared with every tab. Path is relative to the process working directory. */
export const store = await createJsonStore<Incident[]>({
  file: "data/incidents.json",
  initial: () => [],
  parse: parseIncidents,
});

function toCard(incident: Incident): IncidentCard {
  return {
    id: incident.id,
    title: incident.title,
    severity: incident.severity,
    status: incident.status,
    authorId: incident.authorId,
    authorName: memberName(incident.authorId),
    ownerId: incident.ownerId,
    ownerName: incident.ownerId ? memberName(incident.ownerId) : null,
    filedAt: incident.filedAt,
  };
}

function fileIncident(actor: Member, title: string, severity: Severity): void {
  const incident: Incident = {
    id: crypto.randomUUID(),
    title,
    severity,
    status: "open",
    authorId: actor.id,
    ownerId: null,
    filedAt: new Date().toISOString(),
  };
  void store.mutate((current) => ({
    next: [incident, ...current],
    result: undefined,
  }));
}

function claimIncident(id: string, actor: Member): void {
  void store.mutate((current) => {
    const row = current.find((incident) => incident.id === id);
    if (!row || row.status !== "open" || row.ownerId !== null) {
      return { next: current, result: undefined };
    }
    return {
      next: current.map((incident) =>
        incident.id === id ? { ...incident, ownerId: actor.id } : incident,
      ),
      result: undefined,
    };
  });
}

function releaseIncident(id: string, actor: Member): void {
  void store.mutate((current) => {
    const row = current.find((incident) => incident.id === id);
    if (!row || row.status !== "open" || row.ownerId !== actor.id) {
      return { next: current, result: undefined };
    }
    return {
      next: current.map((incident) =>
        incident.id === id ? { ...incident, ownerId: null } : incident,
      ),
      result: undefined,
    };
  });
}

function resolveIncident(id: string, actor: Member): void {
  void store.mutate((current) => {
    const row = current.find((incident) => incident.id === id);
    if (!row || row.status !== "open" || row.ownerId !== actor.id) {
      return { next: current, result: undefined };
    }
    return {
      next: current.map((incident) =>
        incident.id === id ? { ...incident, status: "resolved" } : incident,
      ),
      result: undefined,
    };
  });
}

export const App = component(function App(props: {
  store: typeof store;
  user: Member | null;
}) {
  const incidents = useStore(props.store).state;
  const [fileError, setFileError] = useState("");
  const user = props.user;
  const cards = incidents.map(toCard);

  return html`
    <header class="app-header floor-header">
      <div>
        <p class="floor-kicker">Operations</p>
        <h1>Incident floor</h1>
        <p class="floor-sub">
          ${user
            ? html`Signed in as <strong>${user.name}</strong> · ${user.role}`
            : html`Watching as guest. Open and resolved rows are live. Filing and
              claiming need a desk badge.`}
        </p>
      </div>
      ${user
        ? html`<button
            type="button"
            class="floor-signout"
            @click=${(_event: unknown, session: SessionHandle) => {
              session.revoke();
            }}
          >
            Sign out
          </button>`
        : html`<form
            class="floor-signin"
            @submit=${(event: SubmitPayload, session: SessionHandle) => {
              const id = event.fields["staff"]?.trim() ?? "";
              const member = STAFF.find((row) => row.id === id);
              if (!member) return;
              const token = crypto.randomUUID();
              tickets.set(token, member);
              session.grant(token);
            }}
          >
            <label>
              <span>Staff</span>
              <select name="staff" required>
                <option value="" disabled selected>Sign in…</option>
                ${keyed(
                  STAFF,
                  (member) => member.id,
                  (member) =>
                    html`<option value=${member.id}>
                      ${member.name} — ${member.role}
                    </option>`,
                )}
              </select>
            </label>
            <button class="primary" type="submit">Sign in</button>
          </form>`}
    </header>

    ${user
      ? html`<form
          class="add-form floor-file"
          @submit=${(event: SubmitPayload, session: SessionHandle) => {
            const actor = session.user as Member | null;
            if (!actor) return;
            const title = event.fields["title"]?.trim() ?? "";
            if (!title) {
              setFileError("Title is required.");
              return;
            }
            const raw = event.fields["severity"] ?? "low";
            const severity: Severity = raw === "high" ? "high" : "low";
            setFileError("");
            fileIncident(actor, title, severity);
          }}
        >
          <input
            name="title"
            placeholder="What broke"
            required
            aria-label="Incident title"
          />
          <select name="severity" aria-label="Severity">
            <option value="low">Low</option>
            <option value="high">High</option>
          </select>
          <button class="primary" type="submit">File</button>
          ${fileError
            ? html`<p class="floor-error">${fileError}</p>`
            : ""}
        </form>`
      : html`<p class="floor-guest-note">
          You can watch who owns what. You cannot file, claim, release, or
          resolve.
        </p>`}

    <mount
      .Island=${IncidentBoard}
      .incidents=${cards}
      .viewerId=${user?.id ?? null}
      .onClaim=${(id: string, session: SessionHandle) => {
        const actor = session.user as Member | null;
        if (!actor) return;
        claimIncident(id, actor);
      }}
      .onRelease=${(id: string, session: SessionHandle) => {
        const actor = session.user as Member | null;
        if (!actor) return;
        releaseIncident(id, actor);
      }}
      .onResolve=${(id: string, session: SessionHandle) => {
        const actor = session.user as Member | null;
        if (!actor) return;
        resolveIncident(id, actor);
      }}
    ></mount>
  `;
});

/** Process-local tickets. The cookie is the string we pass to `grant`. */
export const tickets = new Map<string, Member>();
