"""
Generate the charts embedded in economics.md.

Imports the models directly so the charts can never drift from the numbers.

Charts are written on a transparent background with mid-tone neutral text, so
one set of files stays legible on both light and dark document themes. That
constraint rules out white legend boxes; the fan-out chart labels its lines
directly instead.

Run:  python research/make_charts.py
"""

import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter

import cost_model as cm
import latency_model as lm

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "charts")
os.makedirs(OUT, exist_ok=True)

# Charts are saved on a transparent background using a mid-tone neutral for
# all text and rules, so a single set of files stays legible on both light and
# dark document themes. Series colours are mid-saturation for the same reason.
COLORS = {
    "rest_spa": "#8592a6",
    "rt_spa": "#4b8ef7",
    "sdui_naive": "#f0a020",
    "sdui": "#17b57e",
    "sdui_amort": "#9b6ef3",
    "sdui_subtree": "#d94f9a",
}
LABELS = {
    "rest_spa": "REST SPA",
    "rt_spa": "Real-time SPA",
    "sdui_naive": "Server-driven (naive)",
    "sdui": "Server-driven",
    "sdui_amort": "Server-driven + render sharing",
    "sdui_subtree": "Server-driven + subtree sharing",
}
ACCENT_WARN = "#e08a1e"
ACCENT_VIOLET = "#9b6ef3"
ACCENT_RED = "#ef4444"

# Readable against both #ffffff and typical dark editor backgrounds.
INK = "#7d8795"
MUTED = "#7d8795"
GRID = "#7d8795"
GRID_ALPHA = 0.22

plt.rcParams.update({
    "figure.facecolor": "none",
    "axes.facecolor": "none",
    "savefig.facecolor": "none",
    "font.size": 10,
    "text.color": INK,
    "axes.labelcolor": INK,
    "xtick.color": MUTED,
    "ytick.color": MUTED,
    "axes.edgecolor": GRID,
})


def style(ax, ygrid=True):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)
        ax.spines[side].set_alpha(0.45)
    if ygrid:
        ax.set_axisbelow(True)
        ax.yaxis.grid(True, color=GRID, linewidth=0.8, alpha=GRID_ALPHA)
        ax.xaxis.grid(False)


def save(fig, name):
    path = os.path.join(OUT, name)
    fig.savefig(path, dpi=150, bbox_inches="tight", transparent=True)
    plt.close(fig)
    print(f"  wrote charts/{name}")


# --------------------------------------------------------------------------
def chart_cost():
    """Cost per 1000 user-hours, every scenario and architecture."""
    names, series = [], {k: [] for k in COLORS}
    for w in cm.SCENARIOS:
        names.append(w.name.replace(" (Linear-like)", "").replace(" / marketing", ""))
        results = {
            "rest_spa": cm.model_rest_spa(w),
            "rt_spa": cm.model_rt_spa(w),
            "sdui_naive": cm.model_sdui(w, dedupe_queries=False),
            "sdui": cm.model_sdui(w),
        }
        if w.identical_views:
            results["sdui_amort"] = cm.model_sdui(w, amortize_renders=True)
        for k in COLORS:
            series[k].append(results[k].usd_per_1k_user_hours if k in results else None)

    fig, ax = plt.subplots(figsize=(11, 4.8))
    n = len(COLORS)
    width = 0.8 / n
    for i, (key, vals) in enumerate(series.items()):
        xs = [j + i * width - 0.4 + width / 2 for j, v in enumerate(vals) if v is not None]
        ys = [v for v in vals if v is not None]
        ax.bar(xs, ys, width * 0.9, label=LABELS[key], color=COLORS[key])

    ax.set_yscale("log")
    ax.set_xticks(range(len(names)))
    ax.set_xticklabels(names, fontsize=9)
    ax.set_ylabel("USD per 1,000 user-hours (log scale)")
    ax.set_title("Cost by workload: server-driven is cheapest in three of six scenarios",
                 fontsize=12, fontweight="bold", pad=14, loc="left")
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"${v:g}"))
    ax.legend(frameon=False, ncol=3, fontsize=9, loc="upper left",
              bbox_to_anchor=(0, -0.12))
    style(ax)
    save(fig, "cost_per_user_hour.png")


# --------------------------------------------------------------------------
def chart_fanout():
    """Render sharing inverts the fan-out penalty, but only partially."""
    fanouts = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2000]
    rt, sd, am, sub = [], [], [], []
    for fo in fanouts:
        w = cm.Workload("probe", 5_000, 120, 10, 0.6, fo, 600, 15, 2_000, False)
        w_id = cm.Workload("probe", 5_000, 120, 10, 0.6, fo, 600, 15, 2_000, True)
        rt.append(cm.model_rt_spa(w).cpu_cores)
        sd.append(cm.model_sdui(w).cpu_cores)
        am.append(cm.model_sdui(w_id, amortize_renders=True).cpu_cores)
        sub.append(cm.model_sdui(w, personal_share=0.02, cohorts=12).cpu_cores)

    fig, ax = plt.subplots(figsize=(10.5, 5.2))
    ax.plot(fanouts, rt, "-o", color=COLORS["rt_spa"], lw=2.2, ms=5)
    ax.plot(fanouts, sd, "-o", color=COLORS["sdui"], lw=2.2, ms=5)
    # Dashed: whole-tree sharing is an unreachable bound, not an operating point.
    ax.plot(fanouts, am, "--", color=COLORS["sdui_amort"], lw=1.8, alpha=0.75)
    ax.plot(fanouts, sub, "-o", color=COLORS["sdui_subtree"], lw=2.4, ms=5)

    # Label the lines directly: a legend box cannot have a background that
    # works on both light and dark themes.
    for value, key, extra in ((sd[-1], "sdui", ""),
                              (rt[-1], "rt_spa", ""),
                              (sub[-1], "sdui_subtree", "\n2% personal, 12 cohorts"),
                              (am[-1], "sdui_amort", "\n(unreachable bound)")):
        ax.annotate(LABELS[key] + extra, xy=(2000, value), xytext=(2450, value),
                    color=COLORS[key], fontsize=9.5, fontweight="bold",
                    va="center")
    ax.set_xlim(0.85, 34000)

    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlabel("Fan-out (sessions interested in one data change)")
    ax.set_ylabel("Server CPU cores (log scale)")
    ax.set_title("The fan-out inversion, discounted",
                 fontsize=13, fontweight="bold", pad=26, loc="left")
    ax.text(0, 1.045, "Sharing subtrees still beats client rendering at high "
                      "fan-out, but the advantage is bounded, not flat",
            transform=ax.transAxes, fontsize=10, color=MUTED)

    cross = next(f for f, a, r in zip(fanouts, sub, rt) if a < r)
    ax.axvline(cross, color=MUTED, ls=":", lw=1.2, alpha=0.6)
    ax.annotate("naive server rendering:\ncost scales with audience",
                xy=(900, 31), xytext=(1.25, 26), fontsize=9, color=ACCENT_WARN,
                va="top", arrowprops=dict(arrowstyle="->", color=ACCENT_WARN,
                                          lw=1, connectionstyle="arc3,rad=-0.15"))
    ax.annotate("realistic sharing still rises with\naudience, and crosses below\n"
                "the client app only here",
                xy=(430, 3.15), xytext=(1.35, 14), fontsize=9,
                color=COLORS["sdui_subtree"], va="top",
                arrowprops=dict(arrowstyle="->", color=COLORS["sdui_subtree"],
                                lw=1, connectionstyle="arc3,rad=-0.2"))

    ax.set_xticks([1, 10, 100, 1000])
    ax.set_xticklabels(["1", "10", "100", "1,000"])
    ax.minorticks_off()
    style(ax)
    save(fig, "fanout_inversion.png")


# --------------------------------------------------------------------------
def chart_sharing_ceiling():
    """Amortization is capped by personalization, and the cap ignores audience."""
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12.5, 4.9))

    shares = [x / 400 for x in range(1, 201)]  # 0.25% .. 50%
    xs = [s * 100 for s in shares]
    # Two audiences 500x apart: they separate only in the leftmost decade and
    # are indistinguishable past ~2%, which is the entire point.
    for audience, color, ls, dy in ((100, COLORS["rest_spa"], ":", 0.72),
                                    (50_000, COLORS["sdui_amort"], "-", 1.5)):
        ys = [audience / (audience * s + (1 - s)) for s in shares]
        ax1.plot(xs, ys, ls, color=color, lw=2.2)
        ax1.annotate(f"{audience:,} viewers", xy=(0.27, ys[0] * dy),
                     color=color, fontsize=9, fontweight="bold", va="center")

    for share, label in ((0.02, "name in\nthe corner"),
                         (0.05, "name, avatar,\nunread badge"),
                         (0.20, "personalized\nrows")):
        y = 1 / share
        ax1.plot([share * 100], [y], "o", color=INK, ms=5, alpha=0.55)
        ax1.annotate(f"{label}\n{y:.0f}x", xy=(share * 100 * 1.18, y * 1.15),
                     fontsize=8.5, color=MUTED, va="bottom")

    ax1.set_xscale("log")
    ax1.set_yscale("log")
    ax1.set_xlim(0.22, 62)
    ax1.set_ylim(1.4, 900)
    ax1.set_xlabel("Share of the re-rendered region that is personal")
    ax1.set_ylabel("Render speedup from sharing (log)")
    ax1.set_title("The ceiling ignores the audience",
                  fontsize=12, fontweight="bold", pad=22, loc="left")
    ax1.text(0, 1.05, "A 500x larger audience buys nothing past ~2% personal",
             transform=ax1.transAxes, fontsize=9.5, color=MUTED)
    ax1.set_xticks([0.25, 1, 5, 20, 50])
    ax1.set_xticklabels(["0.25%", "1%", "5%", "20%", "50%"])
    ax1.minorticks_off()
    style(ax1)

    w = next(x for x in cm.SCENARIOS if "dashboard" in x.name.lower())
    rt = cm.model_rt_spa(w).cpu_cores
    near = [x / 1000 for x in range(0, 201)]  # 0 .. 20%, where the crossing is
    nxs = [s * 100 for s in near]
    # The band between 1 and 40 cohorts is narrow next to the slope: how
    # finely the audience partitions matters far less than how personal it is.
    lo = [cm.model_sdui(w, personal_share=s, cohorts=1).cpu_cores for s in near]
    hi = [cm.model_sdui(w, personal_share=s, cohorts=40).cpu_cores for s in near]
    ax2.fill_between(nxs, lo, hi, color=COLORS["sdui_subtree"], alpha=0.22)
    ax2.plot(nxs, lo, color=COLORS["sdui_subtree"], lw=2.2)
    ax2.plot(nxs, hi, color=COLORS["sdui_subtree"], lw=2.2)
    ax2.annotate("server-driven,\n1 to 40 cohorts", xy=(20.4, hi[-1] - 0.15),
                 color=COLORS["sdui_subtree"], fontsize=9, fontweight="bold",
                 va="center")

    ax2.axhline(rt, color=COLORS["rt_spa"], ls="--", lw=1.8)
    ax2.annotate("real-time SPA", xy=(20.4, rt), color=COLORS["rt_spa"],
                 fontsize=9, fontweight="bold", va="bottom")
    ax2.axvspan(0, 7.0, color=COLORS["sdui"], alpha=0.07)
    ax2.annotate("server-driven\nis cheaper here", xy=(0.7, 5.1), fontsize=9,
                 color=COLORS["sdui"], va="top")
    ax2.set_xlim(0, 27)
    ax2.set_ylim(0, 6)
    ax2.set_xlabel("Share of the re-rendered region that is personal")
    ax2.set_ylabel("Server CPU cores")
    ax2.set_title("Break-even is around 7-9% personal",
                  fontsize=12, fontweight="bold", pad=22, loc="left")
    ax2.text(0, 1.05, f"{w.name}: {w.concurrent:,} viewers of one data stream",
             transform=ax2.transAxes, fontsize=9.5, color=MUTED)
    ax2.set_xticks([0, 5, 10, 15, 20])
    ax2.set_xticklabels(["0", "5%", "10%", "15%", "20%"])
    style(ax2)

    save(fig, "sharing_ceiling.png")


# --------------------------------------------------------------------------
def chart_latency():
    """First feedback vs a fully correct screen."""
    names = [m.name.replace(" (Linear-like)", "").replace(" (form heavy)", "")
             for m in lm.MIXES]
    spa_fb, sd_fb, spa_con, sd_con = [], [], [], []
    for m in lm.MIXES:
        a, b, _ = lm.spa_latency(m)
        c, d, _ = lm.sdui_latency(m)
        spa_fb.append(a); spa_con.append(b); sd_fb.append(c); sd_con.append(d)

    fig, axes = plt.subplots(1, 2, figsize=(12.5, 4.8), sharey=True)
    idx = range(len(names))
    w = 0.38

    for ax, (s, d, title, sub) in zip(axes, [
        (spa_fb, sd_fb, "Time to first feedback", "SPA ahead by 6-15 ms"),
        (spa_con, sd_con, "Time to a fully correct screen",
         "server-driven ahead in every business app"),
    ]):
        ax.bar([i - w / 2 for i in idx], s, w, color=COLORS["rt_spa"], label="SPA")
        ax.bar([i + w / 2 for i in idx], d, w, color=COLORS["sdui"], label="Server-driven")
        ax.set_xticks(list(idx))
        ax.set_xticklabels(names, rotation=20, ha="right", fontsize=9)
        ax.set_title(f"{title}\n{sub}", fontsize=11, fontweight="bold", loc="left", pad=10)
        style(ax)

    axes[0].set_ylabel("milliseconds")
    axes[0].legend(frameon=False, fontsize=9, loc="upper left")
    fig.suptitle("Which architecture is faster depends on what you measure",
                 fontsize=12.5, fontweight="bold", x=0.005, ha="left", y=1.06)
    save(fig, "latency_feedback_vs_consistency.png")


# --------------------------------------------------------------------------
def chart_edge():
    """How often the SPA is exclusively faster."""
    names, edges = [], []
    for m in lm.MIXES:
        _, _, sfast = lm.spa_latency(m)
        _, _, dfast = lm.sdui_latency(m)
        names.append(m.name.replace(" (Linear-like)", "").replace(" (form heavy)", ""))
        edges.append(max(0.0, sfast - dfast) * m.interactions_per_min)

    order = sorted(range(len(edges)), key=lambda i: edges[i])
    names = [names[i] for i in order]
    edges = [edges[i] for i in order]
    colors = [ACCENT_RED if e > 20 else COLORS["sdui"] for e in edges]

    fig, ax = plt.subplots(figsize=(10, 4.4))
    bars = ax.barh(names, edges, color=colors, height=0.62)
    ax.axvline(20, color=MUTED, ls="--", lw=1.2, alpha=0.7)
    ax.text(21, -0.4, "perceptibility threshold", fontsize=9, color=MUTED)

    for bar, e in zip(bars, edges):
        ax.text(e + 1.5, bar.get_y() + bar.get_height() / 2, f"{e:.1f}",
                va="center", fontsize=9, color=INK)

    ax.set_xlabel("Interactions per minute that are instant in an SPA but not under server authority")
    ax.set_title("The latency penalty is negligible except for direct manipulation",
                 fontsize=12, fontweight="bold", pad=14, loc="left")
    ax.set_xlim(0, max(edges) * 1.15)
    style(ax, ygrid=False)
    ax.xaxis.grid(True, color=GRID, linewidth=0.8, alpha=GRID_ALPHA)
    ax.set_axisbelow(True)
    save(fig, "interaction_edge.png")


# --------------------------------------------------------------------------
def chart_bounce():
    """Short sessions favour the architecture everyone assumes they penalise."""
    lengths = [3, 10, 30, 60, 120, 300, 600, 1800, 3600]
    rest, sdui = [], []
    for s in lengths:
        w = cm.Workload("probe", 50_000, s / 60.0, 4, 0.9, 100, 300, 0, 60, False)
        rest.append(cm.model_rest_spa(w).monthly_usd)
        sdui.append(cm.model_sdui(w).monthly_usd)

    fig, ax = plt.subplots(figsize=(10, 4.8))
    ax.plot(lengths, rest, "-o", color=COLORS["rest_spa"], lw=2.2, ms=5, label="REST SPA")
    ax.plot(lengths, sdui, "-o", color=COLORS["sdui"], lw=2.2, ms=5, label="Server-driven")
    ax.fill_between(lengths, sdui, rest, color=COLORS["sdui"], alpha=0.08)

    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlabel("Average session length (seconds, log scale)")
    ax.set_ylabel("USD per month (log scale)")
    ax.set_xticks(lengths)
    ax.set_xticklabels(["3s", "10s", "30s", "1m", "2m", "5m", "10m", "30m", "1h"])
    ax.yaxis.set_major_formatter(FuncFormatter(
        lambda v, _: f"${v/1000:g}k" if v >= 1000 else f"${v:g}"))
    ax.set_title("Bounce economics invert: the advantage is largest for the shortest sessions",
                 fontsize=12, fontweight="bold", pad=14, loc="left")
    ax.annotate("5.0x cheaper", xy=(3, 200000), xytext=(4.5, 600000),
                fontsize=9.5, color=INK,
                arrowprops=dict(arrowstyle="-", color=MUTED, lw=1))
    ax.annotate("1.7x cheaper", xy=(3600, 410), xytext=(900, 180),
                fontsize=9.5, color=INK,
                arrowprops=dict(arrowstyle="-", color=MUTED, lw=1))
    ax.legend(frameon=False, fontsize=9, loc="upper right")
    style(ax)
    save(fig, "bounce_economics.png")


# --------------------------------------------------------------------------
def chart_taxonomy():
    """Where the latency argument actually lives: most work round trips anyway."""
    names, both, spa_only, neither = [], [], [], []
    for m in lm.MIXES:
        _, _, sfast = lm.spa_latency(m)
        _, _, dfast = lm.sdui_latency(m)
        names.append(m.name.replace(" (Linear-like)", "").replace(" (form heavy)", ""))
        both.append(dfast * 100)               # instant in both architectures
        spa_only.append((sfast - dfast) * 100)  # the SPA's entire advantage
        neither.append((1 - sfast) * 100)       # round trip regardless

    order = sorted(range(len(names)), key=lambda i: spa_only[i])
    names = [names[i] for i in order]
    both = [both[i] for i in order]
    spa_only = [spa_only[i] for i in order]
    neither = [neither[i] for i in order]

    fig, ax = plt.subplots(figsize=(11, 4.6))
    h = 0.6
    b1 = ax.barh(names, both, h, color=COLORS["sdui"], label="Instant in both")
    b2 = ax.barh(names, spa_only, h, left=both, color=ACCENT_RED,
                 label="Instant in the SPA only")
    b3 = ax.barh(names, neither, h,
                 left=[a + b for a, b in zip(both, spa_only)],
                 color=COLORS["rest_spa"], label="Round trip in both architectures")

    for i, v in enumerate(spa_only):
        ax.text(both[i] + v / 2, i, f"{v:.0f}%", ha="center", va="center",
                fontsize=8.5, color="white", fontweight="bold")
    for i, v in enumerate(neither):
        ax.text(both[i] + spa_only[i] + v / 2, i, f"{v:.0f}%", ha="center",
                va="center", fontsize=8.5, color="white", fontweight="bold")

    ax.set_xlim(0, 100)
    ax.set_xlabel("Share of all interactions in a session")
    ax.set_title("Most interactions are not a differentiator",
                 fontsize=13, fontweight="bold", pad=26, loc="left")
    ax.text(0, 1.06, "The red slice is the SPA's entire latency advantage. The grey "
                     "slice hits the server either way.",
            transform=ax.transAxes, fontsize=10, color=MUTED)
    ax.legend(frameon=False, fontsize=9, ncol=3, loc="upper left",
              bbox_to_anchor=(0, -0.16))
    style(ax, ygrid=False)
    ax.xaxis.grid(True, color=GRID, linewidth=0.8, alpha=GRID_ALPHA)
    ax.set_axisbelow(True)
    save(fig, "interaction_taxonomy.png")


if __name__ == "__main__":
    print("Generating charts...")
    chart_cost()
    chart_fanout()
    chart_sharing_ceiling()
    chart_latency()
    chart_edge()
    chart_bounce()
    chart_taxonomy()
    print("Done.")
