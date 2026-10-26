"""Plot a simulator log written by `quadsim run <scenario> --csv FILE`.

    python3 tools/plot_run.py log.csv out.png [--title TEXT] [--from S] [--to S]
                              [--panels alt,roll,pitch,rate,motors]

Panels share the time axis. Grey bands mark failsafe stage 1 and landing; thin lines mark
arming, disarming and the RC link dropping. Needs matplotlib.
"""

import argparse
import csv
import math
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

SURFACE = "#fcfcfb"
TEXT = "#0b0b0b"
TEXT_2 = "#52514e"
GRID = "#e6e5e0"
SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]  # validated categorical slots 1-4
STAGE1 = "#efeeea"
LANDING = "#dddcd6"


def load(path):
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    cols = {k: [float(r[k]) for r in rows] for k in rows[0]}
    return cols


def spans(t, values, want):
    """(start, end) time ranges where values == want."""
    out, start = [], None
    for ti, v in zip(t, values):
        if v == want and start is None:
            start = ti
        elif v != want and start is not None:
            out.append((start, ti))
            start = None
    if start is not None:
        out.append((start, t[-1]))
    return out


def events(t, cols):
    """Times of arming, disarming and the first RC link loss."""
    marks = []
    for i in range(1, len(t)):
        if cols["armed"][i] and not cols["armed"][i - 1]:
            marks.append((t[i], "armed"))
        if not cols["armed"][i] and cols["armed"][i - 1]:
            marks.append((t[i], "disarmed"))
    lost = next((ti for ti, ok in zip(t, cols["link_ok"]) if not ok), None)
    if lost is not None:
        marks.append((lost, "RC link lost"))
    return sorted(marks)


def style(ax, ylabel):
    ax.set_facecolor(SURFACE)
    ax.set_ylabel(ylabel, color=TEXT_2)
    ax.grid(True, color=GRID, linewidth=0.6)
    ax.tick_params(colors=TEXT_2, labelsize=8)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)


def line(ax, t, y, color, label, dashed=False):
    ax.plot(t, y, color=color, linewidth=1.1, linestyle=(0, (4, 3)) if dashed else "-", label=label)


def angle_panel(ax, t, cols, axis):
    sp = cols["sp_" + axis]
    if any(not math.isnan(v) for v in sp):
        line(ax, t, sp, TEXT_2, "setpoint", dashed=True)
    line(ax, t, cols["est_" + axis], SERIES[1], "estimate")
    line(ax, t, cols[axis], SERIES[0], "true")
    style(ax, f"{axis.capitalize()} (deg)")
    ax.legend(loc="lower right", bbox_to_anchor=(1.0, 1.0), fontsize=7, frameon=False, ncol=3, labelcolor=TEXT_2)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv")
    ap.add_argument("png")
    ap.add_argument("--title", default="")
    ap.add_argument("--from", dest="t0", type=float, default=None)
    ap.add_argument("--to", dest="t1", type=float, default=None)
    ap.add_argument("--panels", default="alt,roll,pitch,motors")
    args = ap.parse_args()

    cols = load(args.csv)
    t_all = cols["t"]
    keep = [i for i, ti in enumerate(t_all)
            if (args.t0 is None or ti >= args.t0) and (args.t1 is None or ti <= args.t1)]
    cols = {k: [v[i] for i in keep] for k, v in cols.items()}
    t = cols["t"]

    panels = args.panels.split(",")
    fig, axes = plt.subplots(len(panels), 1, sharex=True, figsize=(9, 1.9 * len(panels) + 0.6), dpi=150)
    axes = [axes] if len(panels) == 1 else list(axes)
    fig.patch.set_facecolor(SURFACE)

    for ax, panel in zip(axes, panels):
        if panel == "alt":
            line(ax, t, cols["alt"], SERIES[0], "altitude")
            style(ax, "Altitude (m)")
        elif panel in ("roll", "pitch"):
            angle_panel(ax, t, cols, panel)
        elif panel == "rate":
            line(ax, t, cols["sp_p"], TEXT_2, "setpoint", dashed=True)
            line(ax, t, cols["gyro_p"], SERIES[0], "gyro (filtered)")
            style(ax, "Roll rate (deg/s)")
            ax.legend(loc="lower right", bbox_to_anchor=(1.0, 1.0), fontsize=7, frameon=False, ncol=2, labelcolor=TEXT_2)
        elif panel == "motors":
            for m in range(4):
                line(ax, t, cols[f"m{m + 1}"], SERIES[m], f"M{m + 1}")
            style(ax, "Motor command")
            ax.set_ylim(-0.02, 1.02)
            ax.legend(loc="lower right", bbox_to_anchor=(1.0, 1.0), fontsize=7, frameon=False, ncol=4, labelcolor=TEXT_2)
        else:
            sys.exit(f"unknown panel {panel!r}")

        for start, end in spans(t, cols["failsafe"], 1.0):
            ax.axvspan(start, end, color=STAGE1, zorder=0, linewidth=0)
        for start, end in spans(t, cols["failsafe"], 2.0):
            ax.axvspan(start, end, color=LANDING, zorder=0, linewidth=0)

    marks = events(t, cols)
    for ax in axes:
        for when, _ in marks:
            ax.axvline(when, color=TEXT_2, linewidth=0.6, linestyle=(0, (1, 2)))
    top = axes[0]
    for when, label in marks:
        top.annotate(label, (when, 1.0), xycoords=("data", "axes fraction"), xytext=(3, 2),
                     textcoords="offset points", fontsize=7, color=TEXT_2, va="bottom")
    for state, value in (("failsafe stage 1", 1.0), ("failsafe landing", 2.0)):
        for start, _ in spans(t, cols["failsafe"], value)[:1]:
            top.annotate(state, (start, 0.0), xycoords=("data", "axes fraction"), xytext=(3, 4),
                         textcoords="offset points", fontsize=7, color=TEXT_2)

    axes[-1].set_xlabel("Time (s)", color=TEXT_2)
    if args.title:
        fig.suptitle(args.title, color=TEXT, fontsize=11, x=0.06, ha="left")
    fig.tight_layout()
    fig.savefig(args.png, facecolor=SURFACE)


if __name__ == "__main__":
    main()
