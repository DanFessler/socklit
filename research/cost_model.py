"""
Cost model comparing web architectures across workload scenarios.

Architectures
  rest_spa    Classic SPA. Client renders. Data via REST refetch/polling.
  rt_spa      SPA plus a WebSocket push layer. Client renders. Server pushes data deltas.
  sdui_naive  Server-authoritative UI without a shared query layer: every
              invalidated session re-runs its own queries.
  sdui        Server-authoritative UI with query deduplication.
  sdui_amort  Adds render sharing for sessions viewing identical content.

Both SPA baselines are modeled generously: delta-only polling, a read-through
cache, and optimistic mutations. The point is to find where server-driven wins
against a well-built client app, not against a strawman.

Every constant is an assumption, collected at the top so any conclusion can be
re-tested by changing one number.

Run:  python research/cost_model.py
"""

from dataclasses import dataclass

# --------------------------------------------------------------------------
# Assumptions. Order-of-magnitude estimates, not measurements.
# --------------------------------------------------------------------------

# Payload sizes
SPA_BUNDLE_KB = 300.0          # React + router + query + component lib, gzipped
SDUI_CLIENT_KB = 12.0          # lit-html + replica runtime, gzipped
BUNDLE_CACHE_HIT = 0.70        # loads served from browser/CDN cache
BYTES_PER_UI_NODE = 45.0       # JSON representation of one node/row
PATCH_BYTES = 80.0             # one hole patch, framed
DATA_DELTA_BYTES = 120.0       # one data-object delta pushed by rt_spa
WS_FRAME_OVERHEAD = 6.0
POLL_EMPTY_RESPONSE_B = 200.0  # 304 / empty-delta response

# Server CPU (microseconds)
SERVER_RENDER_US_PER_NODE = 0.50
SERVER_DIFF_US_PER_NODE = 0.30
JSON_SERIALIZE_US_PER_KB = 5.0
PERMISSION_FILTER_US_PER_NODE = 0.10   # rt_spa filters per recipient too
REQUEST_OVERHEAD_US = 120.0            # HTTP parse, auth, routing per request
DB_QUERY_MS = 1.0
DB_WRITE_MS = 3.0

# Client CPU (microseconds per node), mid-range device
CLIENT_RENDER_US_PER_NODE = 3.0
CLIENT_PATCH_US_PER_NODE = 3.0
LOW_END_DEVICE_FACTOR = 4.0
CLIENT_HYDRATE_MS = 300.0
CLIENT_BUNDLE_PARSE_MS_PER_KB = 1.0
DOWNLINK_KBPS = 1500.0

# Memory (KB per session)
WS_CONN_KB = 40.0
RT_SPA_SUB_KB = 20.0
SDUI_TREE_KB_PER_NODE = 0.20
SDUI_HANDLER_KB_PER_NODE = 0.05
SDUI_SESSION_BASE_KB = 30.0

# Latency
RTT_MS = 60.0
LOCAL_INTERACTION_MS = 6.0

# How much of the locally-handleable interaction surface the server-driven
# client actually covers with client primitives. This is the crux variable:
# every local behavior must be explicitly built as a primitive, whereas a
# client app gets all of them by default.
SDUI_PRIMITIVE_COVERAGE = 0.85   # mature runtime
SDUI_PRIMITIVE_COVERAGE_V0 = 0.30

# Does the SPA implement optimistic mutations? This is the complexity the
# server-driven model claims to delete.
SPA_OPTIMISTIC = True

# Pricing (USD)
VCPU_HOUR = 0.034
GB_HOUR = 0.005
EGRESS_PER_GB = 0.09
DB_QPS_HOUR_PER_1K = 0.55
CACHE_GB_HOUR = 0.016          # managed Redis, pricier than plain RAM

# Stateful servers cannot shed load quickly and need migration headroom.
UTIL_STATELESS = 0.70
UTIL_STATEFUL = 0.50

REST_CACHE_HIT = 0.80


@dataclass
class Workload:
    name: str
    concurrent: int
    session_minutes: float
    interactions_per_min: float
    local_fraction: float        # actions that are purely presentational
    fan_out: float               # sessions interested in a given data change
    ui_nodes: int
    poll_interval_s: float       # 0 = no polling (static or push-only)
    changes_per_min: float       # global data mutation rate
    identical_views: bool
    note: str = ""

    @property
    def sessions_started_per_s(self) -> float:
        return self.concurrent / (self.session_minutes * 60.0)

    @property
    def changes_per_s(self) -> float:
        return self.changes_per_min / 60.0

    @property
    def actions_per_s(self) -> float:
        return self.concurrent * self.interactions_per_min / 60.0

    @property
    def mutating_actions_per_s(self) -> float:
        return self.actions_per_s * (1.0 - self.local_fraction)

    @property
    def effective_fan_out(self) -> float:
        return min(self.fan_out, self.concurrent)

    @property
    def poll_delta_fraction(self) -> float:
        """Probability a poll finds something new: how often a change relevant
        to one session lands inside one poll window."""
        if not self.poll_interval_s:
            return 0.0
        relevant_per_s = self.changes_per_s * self.effective_fan_out / self.concurrent
        return min(1.0, relevant_per_s * self.poll_interval_s)


@dataclass
class Result:
    arch: str
    db_read_qps: float
    db_write_qps: float
    cpu_cores: float
    memory_gb: float
    egress_mbps: float
    client_ms_per_min: float
    client_ms_per_min_low_end: float
    tti_ms: float
    interaction_p50_ms: float
    server_events_per_s: float   # inbound events the server must handle
    burst_fanout_s: float        # time to fan out one maximally-shared change
    state_locations: int         # places the same fact is stored
    monthly_usd: float
    usd_per_1k_user_hours: float


def _cost(cores, gb, egress_mbps, db_qps, cache_gb, concurrent):
    hours = 730.0
    egress_gb_month = egress_mbps / 8.0 * 3600.0 * hours / 1000.0
    monthly = (cores * VCPU_HOUR * hours
               + gb * GB_HOUR * hours
               + cache_gb * CACHE_GB_HOUR * hours
               + egress_gb_month * EGRESS_PER_GB
               + db_qps / 1000.0 * DB_QPS_HOUR_PER_1K * hours)
    user_hours = concurrent * hours
    return monthly, (monthly / user_hours * 1000.0 if user_hours else 0.0)


def _spa_tti() -> float:
    download_ms = SPA_BUNDLE_KB * (1 - BUNDLE_CACHE_HIT) * 8 / DOWNLINK_KBPS * 1000
    return (download_ms
            + SPA_BUNDLE_KB * CLIENT_BUNDLE_PARSE_MS_PER_KB * 0.3
            + CLIENT_HYDRATE_MS + RTT_MS + DB_QUERY_MS)


def _spa_latency(w: Workload) -> float:
    if SPA_OPTIMISTIC:
        mutation_ms = LOCAL_INTERACTION_MS      # painted immediately, reconciled later
    else:
        mutation_ms = RTT_MS + DB_WRITE_MS + LOCAL_INTERACTION_MS
    return w.local_fraction * LOCAL_INTERACTION_MS + (1 - w.local_fraction) * mutation_ms


def model_rest_spa(w: Workload) -> Result:
    polls_per_s = (w.concurrent / w.poll_interval_s) if w.poll_interval_s else 0.0
    raw_reads = polls_per_s + w.sessions_started_per_s
    db_read = raw_reads * (1.0 - REST_CACHE_HIT)
    db_write = w.mutating_actions_per_s

    full_payload_kb = w.ui_nodes * BYTES_PER_UI_NODE / 1024.0
    delta_frac = w.poll_delta_fraction
    poll_payload_kb = (delta_frac * full_payload_kb * 0.2
                       + (1 - delta_frac) * POLL_EMPTY_RESPONSE_B / 1024.0)

    cpu_us = (raw_reads * REQUEST_OVERHEAD_US
              + polls_per_s * poll_payload_kb * JSON_SERIALIZE_US_PER_KB
              + polls_per_s * w.ui_nodes * PERMISSION_FILTER_US_PER_NODE * delta_frac
              + w.sessions_started_per_s * full_payload_kb * JSON_SERIALIZE_US_PER_KB
              + db_read * DB_QUERY_MS * 1000.0
              + db_write * (DB_WRITE_MS * 1000.0 + REQUEST_OVERHEAD_US))
    cores = cpu_us / 1e6 / UTIL_STATELESS

    memory_gb = w.concurrent * 4.0 / 1024.0 / 1024.0
    cache_gb = max(0.5, w.concurrent * 20.0 / 1024.0 / 1024.0)

    bundle_mbps = (w.sessions_started_per_s * SPA_BUNDLE_KB
                   * (1.0 - BUNDLE_CACHE_HIT) * 8.0 / 1000.0)
    egress = (bundle_mbps
              + w.sessions_started_per_s * full_payload_kb * 8.0 / 1000.0
              + polls_per_s * poll_payload_kb * 8.0 / 1000.0)

    # Client re-renders on each poll that actually carried a delta, plus
    # its own optimistic local work.
    polls_per_min = (60.0 / w.poll_interval_s) if w.poll_interval_s else 0.0
    client_ms = (polls_per_min * delta_frac * w.ui_nodes
                 * CLIENT_RENDER_US_PER_NODE / 1000.0
                 + w.interactions_per_min * w.ui_nodes
                 * CLIENT_RENDER_US_PER_NODE / 1000.0 * 0.3)

    monthly, per_1k = _cost(cores, memory_gb, egress, db_read + db_write,
                            cache_gb, w.concurrent)
    return Result("rest_spa", db_read, db_write, cores, memory_gb, egress,
                  client_ms, client_ms * LOW_END_DEVICE_FACTOR, _spa_tti(),
                  _spa_latency(w), w.mutating_actions_per_s + polls_per_s,
                  0.0, 4, monthly, per_1k)


def model_rt_spa(w: Workload) -> Result:
    db_read = w.changes_per_s + w.sessions_started_per_s
    db_write = w.mutating_actions_per_s
    pushes_per_s = w.changes_per_s * w.effective_fan_out
    full_payload_kb = w.ui_nodes * BYTES_PER_UI_NODE / 1024.0

    cpu_us = (pushes_per_s * (DATA_DELTA_BYTES / 1024.0 * JSON_SERIALIZE_US_PER_KB)
              + pushes_per_s * w.ui_nodes * PERMISSION_FILTER_US_PER_NODE
              + w.sessions_started_per_s * (full_payload_kb * JSON_SERIALIZE_US_PER_KB
                                            + REQUEST_OVERHEAD_US)
              + db_read * DB_QUERY_MS * 1000.0
              + db_write * (DB_WRITE_MS * 1000.0 + REQUEST_OVERHEAD_US))
    cores = cpu_us / 1e6 / UTIL_STATELESS

    memory_gb = w.concurrent * (WS_CONN_KB + RT_SPA_SUB_KB) / 1024.0 / 1024.0
    cache_gb = max(0.5, w.concurrent * 20.0 / 1024.0 / 1024.0)

    bundle_mbps = (w.sessions_started_per_s * SPA_BUNDLE_KB
                   * (1.0 - BUNDLE_CACHE_HIT) * 8.0 / 1000.0)
    egress = (bundle_mbps
              + w.sessions_started_per_s * full_payload_kb * 8.0 / 1000.0
              + pushes_per_s * (DATA_DELTA_BYTES + WS_FRAME_OVERHEAD) / 1024.0 * 8.0 / 1000.0)

    pushes_per_session_per_min = w.changes_per_min * w.effective_fan_out / w.concurrent
    # A pushed delta invalidates a slice of the view, not all of it.
    client_ms = (pushes_per_session_per_min * w.ui_nodes * 0.2
                 * CLIENT_PATCH_US_PER_NODE / 1000.0
                 + w.interactions_per_min * w.ui_nodes
                 * CLIENT_RENDER_US_PER_NODE / 1000.0 * 0.3)

    burst_us = w.effective_fan_out * (DATA_DELTA_BYTES / 1024.0 * JSON_SERIALIZE_US_PER_KB
                                      + w.ui_nodes * PERMISSION_FILTER_US_PER_NODE)

    monthly, per_1k = _cost(cores, memory_gb, egress, db_read + db_write,
                            cache_gb, w.concurrent)
    return Result("rt_spa", db_read, db_write, cores, memory_gb, egress,
                  client_ms, client_ms * LOW_END_DEVICE_FACTOR, _spa_tti(),
                  _spa_latency(w), w.mutating_actions_per_s, burst_us / 1e6,
                  5, monthly, per_1k)


def model_sdui(w: Workload, dedupe_queries=True, amortize_renders=False,
               coverage=SDUI_PRIMITIVE_COVERAGE,
               personal_share=None, cohorts=1, hole_cost_ratio=1.0) -> Result:
    """
    personal_share / cohorts model SUBTREE sharing rather than whole-session
    sharing. `personal_share` is the fraction of the re-rendered region that
    differs per session (own name, unread badge, "you liked this", a
    permission-gated field). `cohorts` is the number of distinct
    (view x authorization class) groups the audience splits into.

    `hole_cost_ratio` is what a unit of personal content costs relative to a
    full node render. At 1.0 a personal value forces its whole enclosing
    subtree to be re-rendered per session. Below 1.0 it models personal values
    confined to template holes: the template instance is built once per cohort
    and only the binding is evaluated per session.

    Leaving personal_share as None keeps the older, idealized whole-tree
    sharing behaviour, which is retained only as an upper bound.
    """
    # Interactions the client cannot handle locally must round trip.
    sdui_local = w.local_fraction * coverage
    remote_actions_per_s = w.actions_per_s * (1 - sdui_local)

    if dedupe_queries:
        db_read = w.changes_per_s + w.sessions_started_per_s
    else:
        db_read = w.changes_per_s * w.effective_fan_out + w.sessions_started_per_s
    db_write = w.mutating_actions_per_s

    fanout_renders_per_s = w.changes_per_s * w.effective_fan_out
    if personal_share is not None:
        # Amdahl: the personal part is rendered per session no matter how
        # large the audience gets, so speedup is capped at 1/personal_share.
        m = w.effective_fan_out
        effective = (m * personal_share * hole_cost_ratio
                     + min(cohorts, m) * (1.0 - personal_share))
        fanout_renders_per_s = w.changes_per_s * effective
    elif amortize_renders and w.identical_views:
        fanout_renders_per_s = w.changes_per_s
    renders_per_s = (fanout_renders_per_s + w.sessions_started_per_s
                     + remote_actions_per_s)
    sends_per_s = w.changes_per_s * w.effective_fan_out + remote_actions_per_s

    cpu_us = (renders_per_s * w.ui_nodes
              * (SERVER_RENDER_US_PER_NODE + SERVER_DIFF_US_PER_NODE)
              + sends_per_s * (PATCH_BYTES / 1024.0 * JSON_SERIALIZE_US_PER_KB)
              + db_read * DB_QUERY_MS * 1000.0
              + db_write * DB_WRITE_MS * 1000.0)
    cores = cpu_us / 1e6 / UTIL_STATEFUL

    per_session_kb = (SDUI_SESSION_BASE_KB + WS_CONN_KB
                      + w.ui_nodes * (SDUI_TREE_KB_PER_NODE + SDUI_HANDLER_KB_PER_NODE))
    memory_gb = w.concurrent * per_session_kb / 1024.0 / 1024.0

    snapshot_kb = w.ui_nodes * BYTES_PER_UI_NODE * 1.15 / 1024.0
    egress = (w.sessions_started_per_s * SDUI_CLIENT_KB * (1 - BUNDLE_CACHE_HIT) * 8.0 / 1000.0
              + w.sessions_started_per_s * snapshot_kb * 8.0 / 1000.0
              + sends_per_s * (PATCH_BYTES + WS_FRAME_OVERHEAD) / 1024.0 * 8.0 / 1000.0)

    patches_per_session_per_min = w.changes_per_min * w.effective_fan_out / w.concurrent
    # Applying a hole patch touches a handful of nodes, not the tree.
    client_ms = (patches_per_session_per_min * 4.0 * CLIENT_PATCH_US_PER_NODE / 1000.0
                 + w.interactions_per_min * sdui_local * 0.5)

    download_ms = SDUI_CLIENT_KB * (1 - BUNDLE_CACHE_HIT) * 8 / DOWNLINK_KBPS * 1000
    tti = (download_ms + SDUI_CLIENT_KB * CLIENT_BUNDLE_PARSE_MS_PER_KB * 0.3
           + RTT_MS + DB_QUERY_MS
           + w.ui_nodes * SERVER_RENDER_US_PER_NODE / 1000.0
           + w.ui_nodes * CLIENT_RENDER_US_PER_NODE / 1000.0)

    server_round_trip = (RTT_MS + DB_WRITE_MS
                         + w.ui_nodes * (SERVER_RENDER_US_PER_NODE + SERVER_DIFF_US_PER_NODE) / 1000.0
                         + LOCAL_INTERACTION_MS)
    latency = sdui_local * LOCAL_INTERACTION_MS + (1 - sdui_local) * server_round_trip

    if personal_share is not None:
        m = w.effective_fan_out
        burst_renders = (m * personal_share * hole_cost_ratio
                         + min(cohorts, m) * (1.0 - personal_share))
    elif amortize_renders and w.identical_views:
        burst_renders = 1
    else:
        burst_renders = w.effective_fan_out
    burst_us = burst_renders * w.ui_nodes * (SERVER_RENDER_US_PER_NODE + SERVER_DIFF_US_PER_NODE)

    if not dedupe_queries:
        name = "sdui_naive"
    elif personal_share is not None:
        name = "sdui_subtree"
    elif amortize_renders:
        name = "sdui_amort"
    else:
        name = "sdui"

    monthly, per_1k = _cost(cores, memory_gb, egress, db_read + db_write, 0.0, w.concurrent)
    return Result(name, db_read, db_write, cores, memory_gb, egress,
                  client_ms, client_ms * LOW_END_DEVICE_FACTOR, tti, latency,
                  remote_actions_per_s, burst_us / 1e6, 1, monthly, per_1k)


SCENARIOS = [
    Workload("Internal admin tool", 200, 90, 8, 0.50, 20, 400, 10, 30, False,
             "Small audience, shared org data, moderate interaction."),
    Workload("Team collaboration (Linear-like)", 5_000, 120, 12, 0.60, 8, 600, 15, 2_000, False,
             "Team-scoped fan-out, heavy keyboard use."),
    Workload("Live ops dashboard", 2_000, 480, 0.5, 0.70, 2_000, 800, 5, 600, True,
             "Everyone watches the same data all day."),
    Workload("Consumer social feed", 200_000, 8, 20, 0.80, 1.2, 500, 30, 200_000, False,
             "Personalized data, huge scale, mostly scrolling."),
    Workload("Content / marketing site", 50_000, 2, 4, 0.90, 50_000, 300, 0, 0.1, True,
             "Near-static content, very high bounce."),
    Workload("Collaborative canvas", 1_000, 60, 600, 0.97, 5, 1_000, 0, 3_000, False,
             "Continuous pointer interaction."),
]


def fmt(v, unit=""):
    if v >= 1_000_000:
        return f"{v/1_000_000:.1f}M{unit}"
    if v >= 1_000:
        return f"{v/1_000:.1f}k{unit}"
    if v >= 10:
        return f"{v:.0f}{unit}"
    if v >= 1:
        return f"{v:.1f}{unit}"
    if v >= 0.01:
        return f"{v:.2f}{unit}"
    return f"{v:.3f}{unit}"


def run():
    for w in SCENARIOS:
        results = [model_rest_spa(w), model_rt_spa(w),
                   model_sdui(w, dedupe_queries=False), model_sdui(w)]
        if w.identical_views:
            results.append(model_sdui(w, amortize_renders=True))

        print("=" * 118)
        print(f"{w.name}  |  {w.concurrent:,} concurrent, fan-out {w.fan_out:,.0f}, "
              f"{w.changes_per_min:,.0f} changes/min, {w.ui_nodes} nodes, "
              f"{w.local_fraction*100:.0f}% local actions")
        print(f"  {w.note}")
        print("-" * 118)
        print(f"{'arch':<12}{'db r/s':>9}{'cores':>8}{'mem GB':>9}{'egr Mb':>9}"
              f"{'cli ms/m':>10}{'lowend':>9}{'TTI ms':>9}{'act ms':>8}"
              f"{'ev/s':>9}{'burst s':>9}{'$/mo':>10}{'$/1k uh':>9}")
        for r in results:
            print(f"{r.arch:<12}{fmt(r.db_read_qps):>9}{fmt(r.cpu_cores):>8}"
                  f"{fmt(r.memory_gb):>9}{fmt(r.egress_mbps):>9}"
                  f"{fmt(r.client_ms_per_min):>10}{fmt(r.client_ms_per_min_low_end):>9}"
                  f"{fmt(r.tti_ms):>9}{fmt(r.interaction_p50_ms):>8}"
                  f"{fmt(r.server_events_per_s):>9}{fmt(r.burst_fanout_s):>9}"
                  f"{fmt(r.monthly_usd):>10}{fmt(r.usd_per_1k_user_hours):>9}")
        print()

    crossovers()


def crossovers():
    print("=" * 118)
    print("CROSSOVER 1: server CPU ratio (sdui / rt_spa) as fan-out grows")
    print("-" * 118)
    for fo in [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2000]:
        w = Workload("probe", 5_000, 120, 10, 0.6, fo, 600, 15, 2_000, False)
        a, b, c = model_rt_spa(w), model_sdui(w), model_sdui(w, amortize_renders=True)
        w2 = Workload("probe", 5_000, 120, 10, 0.6, fo, 600, 15, 2_000, True)
        c = model_sdui(w2, amortize_renders=True)
        print(f"  fan-out {fo:>5}: rt_spa {a.cpu_cores:7.2f} | sdui {b.cpu_cores:8.2f} "
              f"({b.cpu_cores/a.cpu_cores:5.2f}x) | sdui_amort {c.cpu_cores:6.2f} "
              f"({c.cpu_cores/a.cpu_cores:5.2f}x)")

    print()
    print("=" * 118)
    print("CROSSOVER 2: DB read load vs REST poll interval (5k concurrent, fan-out 8)")
    print("-" * 118)
    for poll in [2, 5, 10, 15, 30, 60, 300]:
        w = Workload("probe", 5_000, 120, 10, 0.6, 8, 600, poll, 2_000, False)
        rs, sd, sn = model_rest_spa(w), model_sdui(w), model_sdui(w, dedupe_queries=False)
        print(f"  poll {poll:>4}s: rest_spa {rs.db_read_qps:8.1f} qps | "
              f"sdui {sd.db_read_qps:7.1f} qps ({rs.db_read_qps/sd.db_read_qps:5.1f}x better) | "
              f"sdui_naive {sn.db_read_qps:8.1f} qps")

    print()
    print("=" * 118)
    print("CROSSOVER 3: the memory wall (600-node view)")
    print("-" * 118)
    per_kb = SDUI_SESSION_BASE_KB + WS_CONN_KB + 600 * (SDUI_TREE_KB_PER_NODE + SDUI_HANDLER_KB_PER_NODE)
    rt_kb = WS_CONN_KB + RT_SPA_SUB_KB
    print(f"  sdui per-session {per_kb:.0f} KB | rt_spa per-session {rt_kb:.0f} KB "
          f"({per_kb/rt_kb:.1f}x)")
    for n in [1_000, 10_000, 100_000, 1_000_000, 10_000_000]:
        gb = n * per_kb / 1024 / 1024
        print(f"  {n:>12,} sessions: {gb:9.1f} GB  ${gb*GB_HOUR*730:>10,.0f}/mo RAM  "
              f"({gb/1024:.2f} TB)")

    print()
    print("=" * 118)
    print("CROSSOVER 4: bounce economics (50k concurrent, session length varies)")
    print("-" * 118)
    for bounce_s in [3, 10, 30, 120, 600, 3600]:
        w = Workload("probe", 50_000, bounce_s / 60.0, 4, 0.9, 100, 300, 0, 60, False)
        rs, sd = model_rest_spa(w), model_sdui(w)
        winner = "sdui" if sd.monthly_usd < rs.monthly_usd else "rest_spa"
        print(f"  {bounce_s:>5}s sessions: rest_spa ${rs.monthly_usd:>10,.0f}/mo "
              f"| sdui ${sd.monthly_usd:>10,.0f}/mo | {winner} wins "
              f"({max(rs.monthly_usd,sd.monthly_usd)/min(rs.monthly_usd,sd.monthly_usd):.1f}x)")

    print()
    print("=" * 118)
    print("CROSSOVER 5: client primitive coverage vs latency and server load")
    print("-" * 118)
    print("  (1k users, 60 actions/min, 90% of them locally handleable)")
    for cov in [0.0, 0.3, 0.5, 0.7, 0.85, 0.95, 1.0]:
        w = Workload("probe", 1_000, 60, 60, 0.90, 5, 600, 0, 600, False)
        sd = model_sdui(w, coverage=cov)
        sp = model_rt_spa(w)
        print(f"  coverage {cov*100:>5.0f}%: sdui p50 {sd.interaction_p50_ms:6.1f} ms "
              f"(spa {sp.interaction_p50_ms:4.1f} ms) | {sd.server_events_per_s:8.1f} events/s "
              f"| {sd.cpu_cores:6.2f} cores")

    print()
    print("=" * 118)
    print("CROSSOVER 6: optimistic UI is the thing being traded away")
    print("-" * 118)
    global SPA_OPTIMISTIC
    w = Workload("probe", 5_000, 120, 20, 0.5, 8, 600, 15, 2_000, False)
    for opt in [True, False]:
        SPA_OPTIMISTIC = opt
        sp = model_rt_spa(w)
        label = "with optimistic UI" if opt else "without optimistic UI"
        print(f"  spa {label:<22}: p50 {sp.interaction_p50_ms:5.1f} ms "
              f"| state lives in {sp.state_locations} places")
    SPA_OPTIMISTIC = True
    sd = model_sdui(w)
    print(f"  sdui (coverage {SDUI_PRIMITIVE_COVERAGE*100:.0f}%)     : p50 "
          f"{sd.interaction_p50_ms:5.1f} ms | state lives in {sd.state_locations} place")
    sd0 = model_sdui(w, coverage=SDUI_PRIMITIVE_COVERAGE_V0)
    print(f"  sdui v0 (coverage {SDUI_PRIMITIVE_COVERAGE_V0*100:.0f}%)   : p50 "
          f"{sd0.interaction_p50_ms:5.1f} ms | state lives in {sd0.state_locations} place")

    print()
    print("=" * 118)
    print("CROSSOVER 7: reconnect storm. Every session rebuilds after a deploy.")
    print("-" * 118)
    print("  Cost to re-render and re-snapshot the entire population at once.")
    for n, nodes in [(1_000, 400), (10_000, 600), (100_000, 600), (200_000, 500), (1_000_000, 600)]:
        render_core_s = n * nodes * (SERVER_RENDER_US_PER_NODE + SERVER_DIFF_US_PER_NODE) / 1e6
        snapshot_gb = n * nodes * BYTES_PER_UI_NODE * 1.15 / 1024 / 1024 / 1024
        for window in [10, 60]:
            cores = render_core_s / window
            gbps = snapshot_gb * 8 / window
            print(f"  {n:>9,} sessions x {nodes} nodes, drained over {window:>2}s: "
                  f"{cores:8.1f} cores, {gbps:6.2f} Gb/s egress spike")
        print()

    print("=" * 118)
    print("CROSSOVER 8: worst-case (not average) interaction latency")
    print("-" * 118)
    print("  Averages hide the tail. Any action without a client primitive pays full price.")
    for nodes in [200, 600, 1500, 5000]:
        server_ms = nodes * (SERVER_RENDER_US_PER_NODE + SERVER_DIFF_US_PER_NODE) / 1000.0
        total = RTT_MS + DB_WRITE_MS + server_ms + LOCAL_INTERACTION_MS
        print(f"  {nodes:>5} nodes: {RTT_MS:.0f} ms rtt + {DB_WRITE_MS:.0f} ms write + "
              f"{server_ms:5.2f} ms render + {LOCAL_INTERACTION_MS:.0f} ms paint = "
              f"{total:6.1f} ms  (spa optimistic: {LOCAL_INTERACTION_MS:.0f} ms)")


if __name__ == "__main__":
    run()
