import { component, html } from "socklit/server";

function Bar(props: { label: string; pct: number; value: string; note?: string }) {
  const width = Math.max(0, Math.min(100, props.pct));
  return html`
    <div class="bar">
      <div class="bar-head">
        <span>${props.label}</span>
        <strong>${props.value}</strong>
      </div>
      <div class="bar-track" role="img" aria-label=${`${props.label}: ${props.value}`}>
        <div class="bar-fill" style=${`width: ${String(width)}%`}></div>
      </div>
      ${props.note ? html`<p class="bar-note">${props.note}</p>` : ""}
    </div>
  `;
}

export const Performance = component(function Performance() {
  return html`
    <header class="page-head">
      <p class="kicker">research/economics.md · research/design-probes.md</p>
      <h1>Ratios, not a price list.</h1>
      <p class="lede">
        The models live in <code>research/</code>. Absolute dollars are
        illustrative; the ratios are the finding. We do not sell cheaper
        servers. Cost is a wash or a win depending on the workload. Fan-out
        is the constraint.
      </p>
    </header>

    <section class="prose">
      <h2>Sharing recovers most of a same-route population</h2>
      <p>
        Session-level sharing is worth exactly zero: one personalized
        string in the corner of a shell holds the amortization ratio at
        1.00×. The unit has to be the subtree. On the routes probe,
        subtree granularity recovers <strong>85.9–91.3% of bytes</strong>
        on same-route populations. On the odds board, with a personal
        panel, it keeps <strong>97.5% of nodes and 82.5% of bytes</strong>
        still shared.
      </p>
    </section>

    <div class="bars">
      ${Bar({
        label: "Same-route bytes shared (routes)",
        pct: 88,
        value: "86–91%",
        note: "85.9–91.3% of bytes at subtree granularity. research/design-probes.md, research/probes/routes.md.",
      })}
      ${Bar({
        label: "Odds board nodes still shared",
        pct: 97.5,
        value: "97.5%",
        note: "A board with a personal panel. Nodes, not renders.",
      })}
      ${Bar({
        label: "Odds board bytes still shared",
        pct: 82.5,
        value: "82.5%",
        note: "research/probes/odds.md. Whole-tree hash collapses; handlers were 77.5% of the shareable region.",
      })}
    </div>

    <section class="prose">
      <h2>The latency gap is 6–15&nbsp;ms, not 6 vs 70</h2>
      <p>
        An earlier comparison credited the SPA with optimistic UI on every
        mutation. Most clicks hit the server in both architectures. Against
        a realistic SPA, time-to-first-feedback is
        <strong>6–15&nbsp;ms apart</strong>, not 6&nbsp;ms versus
        70&nbsp;ms. On time-to-a-<em>correct</em> UI, server authority is
        faster in three of six modelled workloads, because its patch is
        holistically correct while the SPA’s optimistic update is locally
        correct and globally stale until refetch.
      </p>
    </section>

    <div class="table-wrap">
      <table>
        <caption>
          Time to first feedback (ms). Source: research/economics.md,
          latency_model.py.
        </caption>
        <thead>
          <tr>
            <th>Workload</th>
            <th>SPA</th>
            <th>Server-driven</th>
            <th>Gap</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Task / todo</td>
            <td>19.9</td>
            <td>35.2</td>
            <td>+15.3</td>
          </tr>
          <tr>
            <td>Project tracker</td>
            <td>20.4</td>
            <td>32.6</td>
            <td>+12.2</td>
          </tr>
          <tr>
            <td>Admin / CRM</td>
            <td>34.2</td>
            <td>40.2</td>
            <td>+6.0</td>
          </tr>
          <tr>
            <td>Live dashboard</td>
            <td>11.4</td>
            <td>20.0</td>
            <td>+8.6</td>
          </tr>
          <tr>
            <td>Social feed</td>
            <td>10.0</td>
            <td>25.0</td>
            <td>+15.0</td>
          </tr>
          <tr>
            <td>Drawing canvas</td>
            <td>7.3</td>
            <td>16.4</td>
            <td>+9.2</td>
          </tr>
        </tbody>
      </table>
    </div>

    <section class="prose">
      <h2>Memory is an engineering problem, not an economic one</h2>
      <p>
        A million concurrent sessions cost about <strong>210&nbsp;GB</strong>,
        or <strong>$766/month</strong> in RAM, at 220&nbsp;KB per session
        (model). Measured on odds: 350&nbsp;KB per session at 671 nodes —
        1.6× the assumption, still in the range the model calls immaterial.
        210&nbsp;GB does not fit in one Node heap. You need tens of
        processes and sticky routing. That is the real sentence. The dollar
        figure is a laptop.
      </p>
    </section>

    <div class="table-wrap">
      <table>
        <caption>RAM at 220&nbsp;KB/session. research/economics.md finding 2.</caption>
        <thead>
          <tr>
            <th>Sessions</th>
            <th>Memory</th>
            <th>RAM / month</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>10,000</td>
            <td>2.1 GB</td>
            <td>$8</td>
          </tr>
          <tr>
            <td>100,000</td>
            <td>21 GB</td>
            <td>$77</td>
          </tr>
          <tr>
            <td>1,000,000</td>
            <td>210 GB</td>
            <td>$766</td>
          </tr>
          <tr>
            <td>10,000,000</td>
            <td>2.1 TB</td>
            <td>$7,658</td>
          </tr>
        </tbody>
      </table>
    </div>

    <section class="prose">
      <h2>Fan-out is the constraint</h2>
      <p>
        Without sharing, modelled server CPU scales linearly and becomes
        indefensible: 9× a real-time SPA at fan-out 2000. Sharing inverts
        that — a client architecture cannot amortize a render across
        address spaces at any price — but only at the subtree, and only
        while personal content stays under roughly 8% of the shared view.
      </p>
      <p>
        Measurement changed the urgency, not the shape. On odds, 2,000
        sessions emitted byte-identical patches; <strong>99.95% of render
        CPU is redundant</strong> at that fan-out. The penalty for
        <em>not</em> sharing fell from the modelled 9.11× to
        <strong>1.20×</strong>. Egress saturates a gigabit around fan-out
        3,800 while CPU is still under a core. The surviving arguments for
        sharing are burst drain latency and provable redundancy, not
        steady-state cost. Sharing is measured and unbuilt.
      </p>
    </section>

    <div class="bars">
      ${Bar({
        label: "Modelled CPU vs SPA at fan-out 2000, no sharing",
        pct: 100,
        value: "9×",
        note: "cost_model.py, naive sdui. The number everyone quotes.",
      })}
      ${Bar({
        label: "Measured penalty for not sharing (odds)",
        pct: 13,
        value: "1.20×",
        note: "Same fan-out, real render constant (~0.083 µs/node). research/probes/odds.md.",
      })}
    </div>

    <section class="prose">
      <h2>We do not sell cheaper servers</h2>
      <p>
        Server-driven UI is cheapest in three of six modelled scenarios,
        competitive in a fourth, and clearly worse on a drawing canvas.
        The README’s premise — that you move compute into the datacenter
        and therefore pay more — overweights CPU and ignores a 300&nbsp;KB
        bundle. Money is not the reason to avoid this design, and money is
        not the reason to choose it. Nobody in this family has ever sold
        the architecture on cost. We are not starting.
      </p>
      <p>
        Re-run the models with different constants. Charts are generated
        from the same files, so they cannot drift. Treat the ratios as
        meaningful and the absolute dollars as a sketch.
      </p>
    </section>
  `;
});
