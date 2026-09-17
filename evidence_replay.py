"""Pure replay-cutoff helpers for the P1 evidence chart adapter."""

import math


def _timestamp(value, name):
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a finite timestamp")
    try:
        timestamp = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a finite timestamp") from exc
    if not math.isfinite(timestamp):
        raise ValueError(f"{name} must be a finite timestamp")
    return timestamp


def bars_through_cutoff(bars, cutoff):
    """Return only bars visible at or before cutoff without mutating input."""
    if not isinstance(bars, list):
        raise ValueError("bars must be a list")
    cutoff_ts = _timestamp(cutoff, "cutoff")
    visible = []
    for index, bar in enumerate(bars):
        if not isinstance(bar, dict):
            raise ValueError(f"bars[{index}] must be an object")
        if _timestamp(bar.get("time"), f"bars[{index}].time") <= cutoff_ts:
            visible.append(dict(bar))
    return visible
