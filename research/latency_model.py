"""
Latency model: does the round trip actually cost anything in practice?

The first model treated every mutation as instant in an SPA (optimistic UI)
and as a full round trip under server authority. That is too generous to the
SPA for three reasons:

  1. Optimistic UI only works when the client can PREDICT the server result.
     Server-generated ids, validation, permissions, derived totals, ordering,
     and conflict resolution are not predictable.
  2. Even when predictable, someone has to hand-write the prediction and the
     rollback for that specific mutation. Coverage in real codebases is partial.
  3. A mutation usually invalidates queries, so reaching a globally consistent
     UI often costs a SECOND round trip that the server-driven model does not
     pay -- its patch is holistically correct by construction.

So this model splits interactions three ways and measures two different
latencies: time to first feedback, and time to a fully consistent UI.

Run:  python research/latency_model.py
"""

from dataclasses import dataclass

RTT_MS = 60.0
LOCAL_MS = 6.0
DB_WRITE_MS = 3.0
SERVER_RENDER_MS = 0.5
CLIENT_PATCH_MS = 2.0

# Probability an SPA mutation triggers invalidate-then-refetch rather than
# returning the updated state inline. The React Query default is to refetch.
SPA_REFETCH_PROB = 0.6

# When an optimistic prediction is wrong the user sees a flash and a rollback,
# which is worse than having waited.
OPTIMISTIC_WRONG_RATE = 0.03


@dataclass
class Mix:
    """How a session's interactions actually divide up."""
    name: str
    ephemeral: float            # hover, scroll, focus, typing, menu open
    predictable_mutation: float  # toggle, like, reorder, star
    unpredictable_mutation: float  # create w/ server id, submit+validate, assign
    optimistic_implemented: float  # share of predictable mutations hand-optimized
    sdui_primitive_coverage: float  # share of ephemeral handled client-side
    interactions_per_min: float

    def check(self):
        total = self.ephemeral + self.predictable_mutation + self.unpredictable_mutation
        assert abs(total - 1.0) < 1e-9, f"{self.name}: mix sums to {total}"


def spa_latency(m: Mix):
    """Returns (feedback_ms, consistency_ms, fast_share)."""
    refetch_ms = SPA_REFETCH_PROB * (RTT_MS + 1.0)

    # Ephemeral: instant, and there is nothing to make consistent.
    e_fb = e_con = LOCAL_MS

    # Predictable mutations: instant only where someone built the prediction.
    opt = m.optimistic_implemented
    p_fb = opt * LOCAL_MS + (1 - opt) * (RTT_MS + DB_WRITE_MS + LOCAL_MS)
    p_con = RTT_MS + DB_WRITE_MS + refetch_ms

    # Unpredictable mutations: the client cannot know the answer.
    u_fb = RTT_MS + DB_WRITE_MS + LOCAL_MS
    u_con = RTT_MS + DB_WRITE_MS + refetch_ms

    fb = (m.ephemeral * e_fb + m.predictable_mutation * p_fb
          + m.unpredictable_mutation * u_fb)
    con = (m.ephemeral * e_con + m.predictable_mutation * p_con
           + m.unpredictable_mutation * u_con)
    # Share of interactions that feel instant.
    fast = m.ephemeral + m.predictable_mutation * opt
    return fb, con, fast


def sdui_latency(m: Mix):
    cov = m.sdui_primitive_coverage
    round_trip = RTT_MS + DB_WRITE_MS + SERVER_RENDER_MS + CLIENT_PATCH_MS

    # Ephemeral is instant only where a client primitive exists.
    e_fb = cov * LOCAL_MS + (1 - cov) * round_trip
    # Both mutation classes cost exactly one round trip, and the resulting
    # patch is consistent across the whole view by construction.
    p_fb = u_fb = round_trip

    fb = (m.ephemeral * e_fb + m.predictable_mutation * p_fb
          + m.unpredictable_mutation * u_fb)
    con = fb  # feedback and consistency are the same event
    fast = m.ephemeral * cov
    return fb, con, fast


def sdui_with_optimistic(m: Mix, coverage: float):
    """Server-driven with a framework-level optimistic primitive.

    Declared at the binding (`?checked=${t.done}` opts into local echo), so it
    is written once in the runtime rather than per feature in app code.
    """
    cov = m.sdui_primitive_coverage
    round_trip = RTT_MS + DB_WRITE_MS + SERVER_RENDER_MS + CLIENT_PATCH_MS
    e_fb = cov * LOCAL_MS + (1 - cov) * round_trip
    p_fb = coverage * LOCAL_MS + (1 - coverage) * round_trip
    u_fb = round_trip
    fb = (m.ephemeral * e_fb + m.predictable_mutation * p_fb
          + m.unpredictable_mutation * u_fb)
    con = (m.ephemeral * e_fb + m.predictable_mutation * round_trip
           + m.unpredictable_mutation * u_fb)
    fast = m.ephemeral * cov + m.predictable_mutation * coverage
    return fb, con, fast


MIXES = [
    Mix("Task / todo app", 0.60, 0.30, 0.10, 0.60, 0.85, 20),
    Mix("Project tracker (Linear-like)", 0.65, 0.22, 0.13, 0.55, 0.85, 25),
    Mix("Admin / CRM (form heavy)", 0.50, 0.15, 0.35, 0.35, 0.85, 12),
    Mix("Live dashboard", 0.90, 0.05, 0.05, 0.30, 0.85, 4),
    Mix("Social feed", 0.80, 0.17, 0.03, 0.80, 0.85, 30),
    Mix("Drawing canvas", 0.97, 0.02, 0.01, 0.50, 0.85, 600),
]


def main():
    print("=" * 112)
    print("TIME TO FEEDBACK vs TIME TO A CONSISTENT UI")
    print("=" * 112)
    print(f"{'workload':<32}{'spa fb':>9}{'sdui fb':>9}{'gap':>8}"
          f"{'spa cons':>10}{'sdui cons':>11}{'gap':>9}")
    print("-" * 112)
    for m in MIXES:
        m.check()
        sfb, scon, _ = spa_latency(m)
        dfb, dcon, _ = sdui_latency(m)
        print(f"{m.name:<32}{sfb:8.1f}{dfb:9.1f}{dfb-sfb:+8.1f}"
              f"{scon:10.1f}{dcon:11.1f}{dcon-scon:+9.1f}")

    print()
    print("  fb = first visible response.  cons = whole UI correct, including")
    print("  counters, badges, totals and sidebars affected by the change.")
    print("  Negative gap means server-driven is FASTER.")

    print()
    print("=" * 112)
    print("HOW OFTEN IS THE SPA ACTUALLY FASTER?")
    print("=" * 112)
    print(f"{'workload':<32}{'spa instant':>13}{'sdui instant':>14}"
          f"{'spa-only edge':>15}{'per min':>10}")
    print("-" * 112)
    for m in MIXES:
        _, _, sfast = spa_latency(m)
        _, _, dfast = sdui_latency(m)
        edge = max(0.0, sfast - dfast)
        print(f"{m.name:<32}{sfast*100:12.0f}%{dfast*100:13.0f}%"
              f"{edge*100:14.0f}%{edge*m.interactions_per_min:10.1f}")

    print()
    print("  'spa-only edge' = interactions instant in an SPA but not under")
    print("  server authority. This is the entire practical latency advantage.")

    print()
    print("=" * 112)
    print("SENSITIVITY: how much does optimistic UI coverage matter?")
    print("=" * 112)
    print("  Project tracker mix. Varying how many predictable mutations")
    print("  the SPA team actually hand-optimized.")
    print()
    print(f"{'optimistic coverage':>22}{'spa fb':>10}{'sdui fb':>10}{'spa advantage':>16}")
    print("-" * 112)
    base = MIXES[1]
    for oc in [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]:
        m = Mix(base.name, base.ephemeral, base.predictable_mutation,
                base.unpredictable_mutation, oc, base.sdui_primitive_coverage,
                base.interactions_per_min)
        sfb, _, _ = spa_latency(m)
        dfb, _, _ = sdui_latency(m)
        print(f"{oc*100:>21.0f}%{sfb:10.1f}{dfb:10.1f}{dfb-sfb:+15.1f} ms")

    print()
    print("=" * 112)
    print("THE SECOND ROUND TRIP: mutation then refetch")
    print("=" * 112)
    print("  An SPA mutation that invalidates a query pays another round trip")
    print("  before the UI is correct. Server-driven sends one patch.")
    print()
    print(f"{'refetch probability':>22}{'spa consistency':>18}{'sdui consistency':>19}{'winner':>12}")
    print("-" * 112)
    global SPA_REFETCH_PROB
    original = SPA_REFETCH_PROB
    for prob in [0.0, 0.25, 0.5, 0.75, 1.0]:
        SPA_REFETCH_PROB = prob
        _, scon, _ = spa_latency(base)
        _, dcon, _ = sdui_latency(base)
        winner = "sdui" if dcon < scon else "spa"
        print(f"{prob*100:>21.0f}%{scon:18.1f}{dcon:19.1f}{winner:>12}")
    SPA_REFETCH_PROB = original

    print()
    print("=" * 112)
    print("IF SERVER-DRIVEN GETS A FRAMEWORK-LEVEL OPTIMISTIC PRIMITIVE")
    print("=" * 112)
    print("  Written once in the runtime, opted into declaratively at a binding,")
    print("  versus hand-written per mutation in SPA application code.")
    print()
    print(f"{'workload':<32}{'spa fb':>9}{'sdui fb':>9}{'sdui+opt':>11}{'vs spa':>9}")
    print("-" * 112)
    for m in MIXES:
        sfb, _, _ = spa_latency(m)
        dfb, _, _ = sdui_latency(m)
        ofb, _, _ = sdui_with_optimistic(m, coverage=0.8)
        print(f"{m.name:<32}{sfb:8.1f}{dfb:9.1f}{ofb:11.1f}{ofb-sfb:+9.1f}")

    print()
    print("=" * 112)
    print("WHERE THE ROUND TRIP IS UNAVOIDABLE ANYWAY")
    print("=" * 112)
    print("  Share of each workload's interactions that hit the server in BOTH")
    print("  architectures, so the latency is identical and not a differentiator.")
    print()
    print(f"{'workload':<32}{'unavoidable':>14}{'spa-only edge':>16}{'ephemeral':>12}")
    print("-" * 112)
    for m in MIXES:
        _, _, sfast = spa_latency(m)
        _, _, dfast = sdui_latency(m)
        unavoidable = m.unpredictable_mutation + m.predictable_mutation * (1 - m.optimistic_implemented)
        print(f"{m.name:<32}{unavoidable*100:13.0f}%"
              f"{max(0.0, sfast-dfast)*100:15.0f}%{m.ephemeral*100:11.0f}%")


if __name__ == "__main__":
    main()
