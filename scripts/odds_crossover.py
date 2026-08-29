"""
Re-runs the fan-out crossover in research/cost_model.py against the render cost
the odds probe actually measured.

economics.md finding 3 assumes 0.8 us per node for render plus diff and calls
that "the single most important number to measure once the prototype runs". The
odds load harness measures it. This substitutes the measurement and reports what
happens to the crossover.

Nothing is edited: the constants are overridden on the imported module.

Run:  python scripts/odds_crossover.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "research"))

import cost_model as m  # noqa: E402

# Measured by scripts/odds-load.ts at 250 sessions and above, 671-node board.
# Re-measured after instance addresses became reusable across renders, which
# took this from 0.098.
MEASURED_US_PER_NODE = 0.083
# Same number with the broadcast's JSON serialization and socket write folded
# in, taken from the wall-clock burst window divided by session count. The
# runtime's own metric does not cover them. Was 0.194 before the same change.
EFFECTIVE_US_PER_NODE = 0.172

ASSUMED = m.SERVER_RENDER_US_PER_NODE + m.SERVER_DIFF_US_PER_NODE
RENDER_SHARE = m.SERVER_RENDER_US_PER_NODE / ASSUMED


def set_node_cost(total):
    m.SERVER_RENDER_US_PER_NODE = total * RENDER_SHARE
    m.SERVER_DIFF_US_PER_NODE = total * (1.0 - RENDER_SHARE)


def probe_workload(fan_out, identical=False):
    return m.Workload("probe", 5_000, 120, 10, 0.6, fan_out, 600, 15, 2_000,
                      identical)


def ratios(fan_out):
    spa = m.model_rt_spa(probe_workload(fan_out))
    plain = m.model_sdui(probe_workload(fan_out))
    shared = m.model_sdui(probe_workload(fan_out, True), amortize_renders=True)
    return spa.cpu_cores, plain.cpu_cores, shared.cpu_cores


def crossing(shared, low=1.0, high=200_000.0):
    """
    Fan-out at which server-driven CPU crosses rt_spa CPU.

    With `shared` the crossing goes from losing to winning as fan-out grows, so
    the search looks for the first fan-out that wins. Without it the comparison
    never crosses in that direction, so the search reports the last fan-out that
    still wins, if any.
    """
    def wins(fan_out):
        spa, plain, amortized = ratios(fan_out)
        return (amortized if shared else plain) < spa

    if wins(low) == wins(high):
        return None
    for _ in range(60):
        mid = (low + high) / 2.0
        if wins(mid) == wins(low):
            low = mid
        else:
            high = mid
    return (low + high) / 2.0


def sweep(label, total):
    set_node_cost(total)
    print("=" * 92)
    print(f"{label}: {total:.3f} us/node for render plus diff")
    print("-" * 92)
    print(f"{'fan-out':>9}{'rt_spa':>10}{'sdui':>10}{'ratio':>9}"
          f"{'sdui_amort':>12}{'ratio':>9}")
    for fan_out in [1, 10, 50, 100, 250, 500, 1000, 2000, 10_000]:
        spa, plain, shared = ratios(fan_out)
        print(f"{fan_out:>9}{spa:>10.2f}{plain:>10.2f}{plain / spa:>8.2f}x"
              f"{shared:>12.2f}{shared / spa:>8.2f}x")

    plain_point = crossing(shared=False)
    shared_point = crossing(shared=True)
    print()
    print("  without sharing: "
          + ("never cheaper than rt_spa at any fan-out"
             if plain_point is None
             else f"crosses rt_spa at fan-out {plain_point:,.0f}"))
    print("  with sharing:    "
          + ("never cheaper than rt_spa at any fan-out"
             if shared_point is None
             else f"beats rt_spa above fan-out {shared_point:,.0f}"))
    print()


def dashboard():
    print("=" * 92)
    print("Live ops dashboard scenario (2,000 concurrent, fan-out 2,000)")
    print("-" * 92)
    workload = m.SCENARIOS[2]
    print(f"{'us/node':<11}{'arch':<13}{'cores':>8}{'burst s':>10}{'$/mo':>10}")
    for label, total in [("assumed", ASSUMED),
                         ("measured", MEASURED_US_PER_NODE),
                         ("effective", EFFECTIVE_US_PER_NODE)]:
        set_node_cost(total)
        rows = [m.model_rt_spa(workload),
                m.model_sdui(workload),
                m.model_sdui(workload, amortize_renders=True)]
        for row in rows:
            print(f"{label if row is rows[0] else '':<11}{row.arch:<13}"
                  f"{row.cpu_cores:>8.2f}{row.burst_fanout_s:>10.3f}"
                  f"{row.monthly_usd:>10,.0f}")
        print()


if __name__ == "__main__":
    sweep("economics.md assumption", ASSUMED)
    sweep("odds probe measurement", MEASURED_US_PER_NODE)
    sweep("measurement plus serialize and send", EFFECTIVE_US_PER_NODE)
    dashboard()
