"""Measured replay time, independent of execution revisions and trade filters."""

from datetime import datetime, timedelta, timezone
from math import isfinite

from .contracts import ReplayActivityRequest


TIMING_VERSION = "replay-timing-v1"


def new_timing(*, legacy_baseline=False):
    return {"schema_version": TIMING_VERSION,
            "started_at_utc": datetime.now(timezone.utc).isoformat(),
            "legacy_baseline": legacy_baseline,
            "historical_time_replayed_seconds": 0}


def validate_activity(body: ReplayActivityRequest, *, now=None):
    now = now or datetime.now(timezone.utc)
    start = body.started_at_utc.astimezone(timezone.utc)
    end = body.ended_at_utc.astimezone(timezone.utc)
    seconds = (end - start).total_seconds()
    if not 0 < seconds <= 30:
        raise ValueError("activity interval must be positive and at most 30 seconds")
    if end > now + timedelta(seconds=5):
        raise ValueError("activity interval is in the future")
    if start < now - timedelta(hours=24):
        raise ValueError("activity interval is older than 24 hours")
    return start, end


def union_seconds(intervals):
    total, previous_end = 0.0, None
    for start, end in sorted(intervals):
        if previous_end is None or start > previous_end:
            total += (end - start).total_seconds()
        elif end > previous_end:
            total += (end - previous_end).total_seconds()
        previous_end = end if previous_end is None else max(previous_end, end)
    return total


def dashboard_timing(records, intervals):
    ids = {record["record_id"] for record in records}
    intervals = [item for item in intervals if item["session_id"] in ids]
    practiced = {item["session_id"] for item in intervals}
    practice_known, historical_known, partial_baseline = set(practiced), set(), set(practiced)
    historical = 0
    for record in records:
        timing = record["payload"].get("timing")
        if not isinstance(timing, dict) or timing.get("schema_version") != TIMING_VERSION:
            continue
        seconds = timing.get("historical_time_replayed_seconds")
        if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not isfinite(seconds) or seconds < 0:
            continue
        historical_known.add(record["record_id"])
        historical += seconds
        if not timing.get("legacy_baseline", True):
            practice_known.add(record["record_id"])
            partial_baseline.discard(record["record_id"])
        else:
            partial_baseline.add(record["record_id"])
    return {
        "time_invested_seconds": union_seconds([(item["started_at_utc"], item["ended_at_utc"])
                                                  for item in intervals]) if practice_known or not records else None,
        "historical_time_replayed_seconds": historical if historical_known or not records else None,
        "timing_scope": {
            "source": "measured_replay_activity_and_step_timestamps",
            "session_ids": sorted(ids), "trade_filters_apply": False,
            "active_interval_aggregation": "wall_clock_union_across_selected_sessions",
            "historical_aggregation": "successful_forward_step_timestamp_deltas",
            "practice_measured_session_count": len(practice_known),
            "historical_measured_session_count": len(historical_known),
            "unknown_practice_session_count": len(ids - practice_known),
            "unknown_historical_session_count": len(ids - historical_known),
            "legacy_partial_session_count": len(partial_baseline),
            "legacy_backfill": False,
        },
    }
