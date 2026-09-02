import { html } from "lit-html";

import { component, type RenderOutput } from "../component";
import { keyed } from "../keyed";
import type { Probe } from "./types";

/**
 * Lab chrome: a side nav of real links, one per discovered probe.
 *
 * Switching probes is a new document, not a session route. Each probe has
 * its own runtime, so `<a href="?probe=">` is the honest move — the same
 * shape the docs site uses. The lab host wraps every probe with this; a
 * probe hosted on its own `listen()` can import it the same way.
 */

export type ProbeLink = {
  id: string;
  title: string;
  forces: string;
};

export function catalogOf(probes: readonly Pick<Probe, "id" | "title" | "forces">[]): ProbeLink[] {
  return probes.map((probe) => ({
    id: probe.id,
    title: probe.title,
    forces: probe.forces,
  }));
}

export function wrapProbe(probe: Probe, probes: readonly ProbeLink[]): Probe {
  return {
    ...probe,
    createApp: (session) => {
      const instance = probe.createApp(session);
      return {
        app: () =>
          ProbeShell({
            current: probe.id,
            probes,
            children: instance.app(),
          }),
        ...(instance.dispose ? { dispose: instance.dispose } : {}),
      };
    },
  };
}

function hrefOf(id: string): string {
  return `?probe=${encodeURIComponent(id)}`;
}

const NavLink = component(function NavLink(props: {
  probe: ProbeLink;
  current: boolean;
}) {
  const { probe, current } = props;
  return current
    ? html`<a
        href="${hrefOf(probe.id)}"
        class="probe-nav-link is-current"
        aria-current="page"
        title="${probe.forces}"
        data-probe="${`nav:${probe.id}`}"
      >
        ${probe.title}
      </a>`
    : html`<a
        href="${hrefOf(probe.id)}"
        class="probe-nav-link"
        title="${probe.forces}"
        data-probe="${`nav:${probe.id}`}"
      >
        ${probe.title}
      </a>`;
});

export const ProbeShell = component(function ProbeShell(props: {
  current: string;
  probes: readonly ProbeLink[];
  children: RenderOutput;
}) {
  return html`
    <div class="probe-shell">
      <nav class="probe-nav" aria-label="Probes">
        <p class="probe-nav-label">Probes</p>
        <ul class="probe-nav-list">
          ${keyed(
            props.probes,
            (probe) => probe.id,
            (probe) => html`
              <li>
                ${NavLink({
                  probe,
                  current: probe.id === props.current,
                })}
              </li>
            `,
          )}
        </ul>
      </nav>
      <div class="probe-body" id="probe-content">${props.children}</div>
    </div>
  `;
});
