import { html } from "lit-html";
import { describe, expect, it } from "vitest";

import { component } from "../../server/component";
import { DurableVault } from "../../server/durable";
import { renderFirstPaint } from "../../server/first-paint";
import {
  catalogOf,
  ProbeShell,
  wrapProbe,
} from "../../server/probes/shell";
import type { Probe } from "../../server/probes/types";

const Hello = component(function Hello() {
  return html`<p data-probe="body">hello from the probe</p>`;
});

const catalog = catalogOf([
  { id: "hello", title: "Hello", forces: "S0" },
  { id: "other", title: "Other", forces: "S1" },
]);

const probe: Probe = {
  id: "hello",
  title: "Hello",
  forces: "S0",
  createApp: () => ({ app: () => Hello({}) }),
};

describe("ProbeShell", () => {
  it("paints a side nav of real links around the probe", () => {
    const painted = renderFirstPaint({
      createApp: () => ({
        app: () =>
          ProbeShell({
            current: "hello",
            probes: catalog,
            children: Hello({}),
          }),
      }),
      params: new URLSearchParams(),
      user: null,
      durable: DurableVault.memory(),
    });

    expect(painted.markup).toContain("hello from the probe");
    expect(painted.markup).toContain('href="?probe=hello"');
    expect(painted.markup).toContain('href="?probe=other"');
    expect(painted.markup).toContain('title="S0"');
    expect(painted.markup).toContain('title="S1"');
    expect(painted.markup).toMatch(
      /data-probe="nav:hello"[^>]*aria-current="page"|aria-current="page"[^>]*data-probe="nav:hello"/,
    );
    expect(painted.markup).not.toMatch(
      /data-probe="nav:other"[^>]*aria-current="page"|aria-current="page"[^>]*data-probe="nav:other"/,
    );
  });

  it("wrapProbe puts the shell around createApp and leaves the probe itself clean", () => {
    const wrapped = wrapProbe(probe, catalog);
    const painted = renderFirstPaint({
      createApp: wrapped.createApp,
      params: new URLSearchParams(),
      user: null,
      durable: DurableVault.memory(),
    });

    expect(painted.markup).toContain("hello from the probe");
    expect(painted.markup).toContain('data-probe="nav:hello"');
    expect(painted.markup).toContain('data-probe="nav:other"');

    const bare = renderFirstPaint({
      createApp: probe.createApp,
      params: new URLSearchParams(),
      user: null,
      durable: DurableVault.memory(),
    });
    expect(bare.markup).toContain("hello from the probe");
    expect(bare.markup).not.toContain("probe-nav");
  });
});
