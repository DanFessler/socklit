"""
Render amortization, corrected.

`economics.md` finding 3 originally modeled render sharing as a session-level
property: if two sessions are looking at "the same dashboard", one render
serves both, so 2,000 viewers cost one render.

That is not a thing that happens. Two sessions on the same dashboard are on
different routes, have different unread badges, a different name in the corner,
and different permissions. The whole tree is never identical, so the unit of
sharing has to be the subtree, and the amortization has to be discounted twice:

  1. Amdahl. The per-session part of the re-rendered region is rendered per
     session no matter how large the audience is. Speedup is capped at
     1 / personal_share, and the cap does not move with fan-out.

  2. Partitioning. The shared part is only shared within a cohort of sessions
     whose inputs AND authorization match. The audience splits into
     distinct_views x auth_classes cohorts, and each cohort pays its own render.

This script quantifies both, and answers the question design-probes.md left
open: does the structural cost advantage survive contact with realistic
personalization?
"""

from cost_model import (SCENARIOS, Workload, model_rt_spa, model_sdui,
                        model_rest_spa)


def speedup(personal_share: float, cohorts: float, audience: float) -> float:
    """Render-cost speedup from subtree sharing versus rendering per session."""
    effective = audience * personal_share + min(cohorts, audience) * (1 - personal_share)
    return audience / effective


def dashboard() -> Workload:
    return next(w for w in SCENARIOS if "dashboard" in w.name.lower())


def amdahl_cap():
    print("=" * 74)
    print("1. THE CEILING: speedup is capped by the personal fraction")
    print("=" * 74)
    print("A single shared cohort (the most optimistic possible partitioning),")
    print("2,000 viewers. 'Personal' = share of re-rendered nodes that differ")
    print("per session.\n")
    print(f"{'personal share':>16} {'speedup @2k':>12} {'ceiling @inf':>13}  interpretation")
    print("-" * 74)
    rows = [
        (0.000, "perfectly identical view, no personalization at all"),
        (0.005, "a clock or a connection dot"),
        (0.020, "name in the corner"),
        (0.050, "name, avatar, unread badge"),
        (0.100, "the above plus a personal sidebar"),
        (0.200, "personalized rows inside the shared table"),
        (0.400, "half the view is per-user"),
    ]
    for share, label in rows:
        s = speedup(share, 1, 2000)
        cap = float("inf") if share == 0 else 1 / share
        cap_s = "unbounded" if cap == float("inf") else f"{cap:>8.0f}x"
        print(f"{share:>15.1%} {s:>11.0f}x {cap_s:>13}  {label}")
    print()
    print("The ceiling is a property of the view, not of the audience. Doubling")
    print("the audience does not move it. 5% personalization caps the structural")
    print("advantage at 20x no matter how many people are watching.")
    print()


def partitioning():
    print("=" * 74)
    print("2. THE PARTITIONING: cohorts multiply, they do not add")
    print("=" * 74)
    print("2,000 viewers, 2% personal content. Cohorts = views x auth classes.\n")
    print(f"{'views':>6} {'auth classes':>13} {'cohorts':>8} {'speedup':>9} {'renders/change':>15}")
    print("-" * 74)
    for views, auth in [(1, 1), (1, 3), (4, 1), (4, 3), (4, 10), (12, 10), (30, 10)]:
        cohorts = views * auth
        s = speedup(0.02, cohorts, 2000)
        eff = 2000 / s
        print(f"{views:>6} {auth:>13} {cohorts:>8} {s:>8.0f}x {eff:>15.0f}")
    print()
    print("An admin console with 4 saved views and 10 roles is 40 cohorts, not")
    print("one. Note the last rows: once cohorts x personal cost approaches the")
    print("audience, sharing has stopped doing anything.")
    print()


def break_even():
    w = dashboard()
    rt = model_rt_spa(w)
    rest = model_rest_spa(w)
    naive = model_sdui(w)
    ideal = model_sdui(w, amortize_renders=True)

    print("=" * 74)
    print(f"3. BREAK-EVEN ON A REAL WORKLOAD: {w.name}")
    print("=" * 74)
    print(f"{w.concurrent:,} concurrent, fan-out {w.effective_fan_out:,.0f}, "
          f"{w.ui_nodes} nodes, {w.changes_per_min:,.0f} changes/min\n")
    print(f"  {'real-time SPA (the bar to beat)':<38} {rt.cpu_cores:>8.2f} cores")
    print(f"  {'REST SPA':<38} {rest.cpu_cores:>8.2f} cores")
    print(f"  {'SDUI, no sharing':<38} {naive.cpu_cores:>8.2f} cores")
    print(f"  {'SDUI, idealized whole-tree sharing':<38} {ideal.cpu_cores:>8.2f} cores  <- the old claim")
    print()
    print("Now with subtree sharing at realistic personalization:\n")
    print(f"{'personal':>9} {'cohorts':>8} {'cores':>9} {'vs RT SPA':>11}   verdict")
    print("-" * 74)
    grid = [(0.005, 1), (0.02, 1), (0.02, 12), (0.02, 40),
            (0.05, 12), (0.05, 40), (0.10, 12), (0.10, 40), (0.20, 40)]
    for share, cohorts in grid:
        r = model_sdui(w, personal_share=share, cohorts=cohorts)
        ratio = r.cpu_cores / rt.cpu_cores
        verdict = "SDUI wins" if ratio < 1 else "SPA wins"
        print(f"{share:>8.1%} {cohorts:>8} {r.cpu_cores:>9.2f} {ratio:>10.2f}x   {verdict}")
    print()

    for cohorts in (1, 12, 40):
        lo, hi = 0.0, 1.0
        for _ in range(60):
            mid = (lo + hi) / 2
            if model_sdui(w, personal_share=mid, cohorts=cohorts).cpu_cores < rt.cpu_cores:
                lo = mid
            else:
                hi = mid
        print(f"  With {cohorts:>2} cohorts, SDUI stays cheaper only below "
              f"{lo:.2%} personal content.")
    print()


def one_field():
    print("=" * 74)
    print("4. THE COST OF ONE PERSONAL FIELD")
    print("=" * 74)
    print("A shared table, 2,000 viewers. What does adding one per-user column")
    print("to an otherwise identical view do?\n")
    w = dashboard()
    rt = model_rt_spa(w)
    print(f"{'view':<44} {'personal':>9} {'cores':>8} {'vs SPA':>8}")
    print("-" * 74)
    cases = [
        ("read-only board, nothing personal", 0.002),
        ("+ name and avatar in the header", 0.02),
        ("+ one 'assigned to you' cell per row", 0.35),
        ("+ per-row permission gating", 0.60),
    ]
    for label, share in cases:
        r = model_sdui(w, personal_share=share, cohorts=12)
        print(f"{label:<44} {share:>8.1%} {r.cpu_cores:>8.2f} {r.cpu_cores / rt.cpu_cores:>7.2f}x")
    print()
    print("The third row is the important one. 'Assigned to you' is a single")
    print("cell, but it sits INSIDE the repeated element, so it personalizes a")
    print("share of the tree proportional to the row count, not to the cell.")
    print("Personalization cost scales with where the field sits in the tree,")
    print("not with how big the field is.")
    print()


def personal_holes():
    print("=" * 74)
    print("5. THE ESCAPE HATCH: personal values as holes, not as subtrees")
    print("=" * 74)
    print("Section 4 assumed a personal value forces its enclosing subtree to")
    print("be re-rendered per session. But the C2 IR already separates template")
    print("structure from hole values. If the personal bit is confined to a")
    print("hole, the instance is built once per cohort and only the binding is")
    print("evaluated per session.\n")
    w = dashboard()
    rt = model_rt_spa(w)
    print(f"{'hole cost vs full render':>26}  {'cores':>8} {'vs SPA':>8}   35% personal, 12 cohorts")
    print("-" * 74)
    for ratio, label in [(1.00, "personal subtree re-render"),
                         (0.50, ""), (0.25, "hole binding + compare"),
                         (0.10, ""), (0.05, "pure scalar substitution")]:
        r = model_sdui(w, personal_share=0.35, cohorts=12, hole_cost_ratio=ratio)
        print(f"{ratio:>25.0%}  {r.cpu_cores:>8.2f} {r.cpu_cores / rt.cpu_cores:>7.2f}x   {label}")
    print()
    print("The catastrophic case from section 4 (9.13 cores, 3.9x worse than")
    print("the SPA) becomes competitive again if and only if personalization")
    print("can be expressed as hole substitution inside a shared template.")
    print("That is a constraint on the authoring API, not an optimization:")
    print("a personal value may parameterize a shared subtree but may not")
    print("change its shape.")
    print()


def fan_out_curve():
    """Data for the corrected fan-out chart."""
    print("=" * 74)
    print("6. CORRECTED FAN-OUT CURVE")
    print("=" * 74)
    print(f"{'fan-out':>9} {'RT SPA':>9} {'SDUI':>9} {'ideal':>9} {'subtree':>9} {'winner':>9}")
    print("-" * 74)
    for fo in (10, 50, 200, 500, 1000, 2000, 5000, 10000):
        w = Workload("probe", max(20000, fo), 480, 0.5, 0.70, fo, 800, 5, 600, True)
        rt = model_rt_spa(w).cpu_cores
        sd = model_sdui(w).cpu_cores
        idl = model_sdui(w, amortize_renders=True).cpu_cores
        sub = model_sdui(w, personal_share=0.02, cohorts=12).cpu_cores
        winner = "SDUI" if sub < rt else "SPA"
        print(f"{fo:>9,} {rt:>9.2f} {sd:>9.2f} {idl:>9.2f} {sub:>9.2f} {winner:>9}")
    print()


if __name__ == "__main__":
    amdahl_cap()
    partitioning()
    break_even()
    one_field()
    personal_holes()
    fan_out_curve()
