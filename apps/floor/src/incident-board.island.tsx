import { useMemo, useState } from "react";

import type { IncidentCard, IncidentStatus } from "./incident-types";

type FilterStatus = "all" | IncidentStatus;

export function IncidentBoard(props: {
  incidents: IncidentCard[];
  viewerId: string | null;
  onClaim: (id: string) => void;
  onRelease: (id: string) => void;
  onResolve: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<FilterStatus>("all");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return props.incidents.filter((incident) => {
      if (status !== "all" && incident.status !== status) return false;
      if (!q) return true;
      const hay = [
        incident.title,
        incident.authorName,
        incident.ownerName ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [props.incidents, query, status]);

  return (
    <section className="floor-board">
      <div className="floor-filters">
        <input
          className="floor-search"
          type="search"
          placeholder="Find a title…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Find a title"
        />
        <select
          className="floor-status"
          value={status}
          onChange={(event) => setStatus(event.target.value as FilterStatus)}
          aria-label="Status"
        >
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
        </select>
        <p className="floor-count">
          {shown.length} of {props.incidents.length}
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="empty">
          {props.incidents.length === 0
            ? "The floor is quiet."
            : "Nothing matches that filter."}
        </p>
      ) : (
        <ul className="floor-list">
          {shown.map((incident) => (
            <IncidentRow
              key={incident.id}
              incident={incident}
              viewerId={props.viewerId}
              onClaim={props.onClaim}
              onRelease={props.onRelease}
              onResolve={props.onResolve}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function IncidentRow(props: {
  incident: IncidentCard;
  viewerId: string | null;
  onClaim: (id: string) => void;
  onRelease: (id: string) => void;
  onResolve: (id: string) => void;
}) {
  const { incident, viewerId } = props;
  const open = incident.status === "open";
  const canClaim = Boolean(viewerId) && open && incident.ownerId === null;
  const isOwner = Boolean(viewerId) && incident.ownerId === viewerId;
  const canOwn = isOwner && open;

  return (
    <li
      className={`floor-row severity-${incident.severity} status-${incident.status}`}
    >
      <div className="floor-row-main">
        <div className="floor-row-meta">
          <span className={`floor-sev ${incident.severity}`}>
            {incident.severity}
          </span>
          <span className={`floor-state ${incident.status}`}>
            {incident.status}
          </span>
          <time dateTime={incident.filedAt}>{formatFiled(incident.filedAt)}</time>
        </div>
        <h2 className="floor-title">{incident.title}</h2>
        <p className="floor-people">
          Filed by {incident.authorName}
          {incident.ownerName
            ? ` · Owned by ${incident.ownerName}`
            : open
              ? " · Unclaimed"
              : ""}
        </p>
      </div>
      {canClaim || canOwn ? (
        <div className="floor-actions">
          {canClaim ? (
            <button
              type="button"
              className="primary"
              onClick={() => props.onClaim(incident.id)}
            >
              Claim
            </button>
          ) : null}
          {canOwn ? (
            <>
              <button
                type="button"
                onClick={() => props.onRelease(incident.id)}
              >
                Release
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => props.onResolve(incident.id)}
              >
                Resolve
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function formatFiled(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
