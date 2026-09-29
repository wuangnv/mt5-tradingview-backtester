from __future__ import annotations

from decimal import Decimal, InvalidOperation
from itertools import islice, product
from math import prod
import re


class ResearchValidationPlanError(ValueError):
    pass


def _positive_int(value, name: str, *, minimum: int = 1, maximum: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ResearchValidationPlanError(f"{name} must be an integer >= {minimum}")
    if maximum is not None and value > maximum:
        raise ResearchValidationPlanError(f"{name} must be <= {maximum}")
    return value


def _nonnegative_int(value, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ResearchValidationPlanError(f"{name} must be a nonnegative integer")
    return value


def _bounded_multiplier(value, name: str) -> str:
    if isinstance(value, bool):
        raise ResearchValidationPlanError(f"{name} must be a finite multiplier between 0 and 10")
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ResearchValidationPlanError(f"{name} must be a finite multiplier between 0 and 10") from exc
    if not parsed.is_finite() or parsed < 0 or parsed > 10:
        raise ResearchValidationPlanError(f"{name} must be a finite multiplier between 0 and 10")
    return format(parsed.normalize(), "f")


def build_cost_fill_stress_plan(stress_scenarios: list[dict] | None) -> dict:
    """Normalize a small deterministic matrix of cost/fill stress multipliers.

    The base scenario is always present. Callers may add at most seven declared
    scenarios; each can only scale already-pinned execution-cost inputs.
    """

    if stress_scenarios is None:
        stress_scenarios = []
    if not isinstance(stress_scenarios, list):
        raise ResearchValidationPlanError("stress_scenarios must be a list")
    if len(stress_scenarios) > 7:
        raise ResearchValidationPlanError("stress_scenarios supports at most 7 declared scenarios")

    multiplier_fields = (
        "spread_price_multiplier",
        "commission_multiplier",
        "minimum_fee_multiplier",
        "slippage_multiplier",
        "financing_multiplier",
    )
    base = {"scenario_id": "base", **{field: "1" for field in multiplier_fields}}
    scenarios = [base]
    seen = {"base"}
    for raw in stress_scenarios:
        if not isinstance(raw, dict):
            raise ResearchValidationPlanError("stress scenario must be structured")
        unknown = sorted(set(raw) - ({"scenario_id"} | set(multiplier_fields)))
        if unknown:
            raise ResearchValidationPlanError(f"unsupported stress scenario fields: {', '.join(unknown)}")
        scenario_id = raw.get("scenario_id")
        if (
            not isinstance(scenario_id, str)
            or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", scenario_id) is None
        ):
            raise ResearchValidationPlanError("stress scenario_id must use 1-64 letters, digits, dot, dash, or underscore")
        if scenario_id in seen:
            raise ResearchValidationPlanError("stress scenario_id values must be unique and cannot reuse base")
        normalized = {"scenario_id": scenario_id}
        for field in multiplier_fields:
            normalized[field] = _bounded_multiplier(raw.get(field, 1), f"{scenario_id}.{field}")
        if all(normalized[field] == "1" for field in multiplier_fields):
            raise ResearchValidationPlanError("declared stress scenario must change at least one multiplier")
        seen.add(scenario_id)
        scenarios.append(normalized)

    return {
        "schema": "bounded-cost-fill-stress-v1",
        "selection": "declared-order",
        "max_scenarios": 8,
        "scenario_count": len(scenarios),
        "scenarios": scenarios,
    }


def _validate_rows(rows: list[dict], timeframe_seconds: int) -> list[int]:
    if not isinstance(rows, list) or not rows:
        raise ResearchValidationPlanError("walk-forward planning requires source rows")
    timestamps: list[int] = []
    for row in rows:
        if not isinstance(row, dict) or type(row.get("timestamp")) is not int:
            raise ResearchValidationPlanError("source rows require integer timestamps")
        timestamps.append(row["timestamp"])
    if timestamps != sorted(timestamps) or len(set(timestamps)) != len(timestamps):
        raise ResearchValidationPlanError("source rows must be strictly chronological")
    if any(right - left < timeframe_seconds for left, right in zip(timestamps, timestamps[1:])):
        raise ResearchValidationPlanError("source rows overlap the declared timeframe")
    return timestamps


def _closed_holdout_boundary(holdout_policy: dict | None) -> int | None:
    policy = holdout_policy or {"mode": "none"}
    if not isinstance(policy, dict):
        raise ResearchValidationPlanError("holdout policy must be structured")
    mode = policy.get("mode", "none")
    if mode == "none":
        return None
    if mode != "metadata_only":
        raise ResearchValidationPlanError("U5c planning never authorizes holdout content access")
    boundary = policy.get("from_utc")
    if type(boundary) is not int or boundary < 0:
        raise ResearchValidationPlanError("metadata-only holdout requires integer from_utc")
    return boundary


def _range(timestamps: list[int], start: int, stop: int, timeframe_seconds: int) -> dict:
    if start >= stop:
        return {"start_index": start, "stop_index": stop, "bar_count": 0, "from_utc": None, "to_utc": None}
    return {
        "start_index": start,
        "stop_index": stop,
        "bar_count": stop - start,
        "from_utc": timestamps[start],
        "to_utc": timestamps[stop - 1] + timeframe_seconds,
    }


def build_walk_forward_plan(
    rows: list[dict],
    *,
    timeframe_seconds: int,
    train_bars: int,
    oos_bars: int,
    step_bars: int | None = None,
    purge_bars: int = 0,
    embargo_bars: int = 0,
    overlap_bars: int = 0,
    expanding: bool = True,
    max_folds: int = 20,
    holdout_policy: dict | None = None,
) -> dict:
    """Create chronological train/OOS folds without granting holdout access.

    `purge_bars` removes the tail of each training slice. `embargo_bars` leaves
    an unused gap after the split and before OOS. Callers that know labels or
    positions can overlap a boundary pass that requirement via `overlap_bars`;
    planning fails if the requested purge is smaller than that known overlap.
    """

    timeframe_seconds = _positive_int(timeframe_seconds, "timeframe_seconds")
    train_bars = _positive_int(train_bars, "train_bars")
    oos_bars = _positive_int(oos_bars, "oos_bars")
    step_bars = oos_bars if step_bars is None else _positive_int(step_bars, "step_bars")
    purge_bars = _nonnegative_int(purge_bars, "purge_bars")
    embargo_bars = _nonnegative_int(embargo_bars, "embargo_bars")
    overlap_bars = _nonnegative_int(overlap_bars, "overlap_bars")
    max_folds = _positive_int(max_folds, "max_folds", maximum=10_000)
    if type(expanding) is not bool:
        raise ResearchValidationPlanError("expanding must be boolean")
    if purge_bars < overlap_bars:
        raise ResearchValidationPlanError("purge_bars is smaller than the declared overlap_bars")
    if purge_bars >= train_bars:
        raise ResearchValidationPlanError("purge_bars must leave at least one training bar")

    timestamps = _validate_rows(rows, timeframe_seconds)
    holdout_from = _closed_holdout_boundary(holdout_policy)
    if holdout_from is not None:
        for timestamp in timestamps:
            if timestamp + timeframe_seconds > holdout_from:
                raise ResearchValidationPlanError("source rows reach locked holdout data")

    folds = []
    split_index = train_bars
    while len(folds) < max_folds:
        purge_start = split_index - purge_bars
        embargo_stop = split_index + embargo_bars
        oos_stop = embargo_stop + oos_bars
        if oos_stop > len(timestamps):
            break
        train_start = 0 if expanding else split_index - train_bars
        fold = {
            "fold": len(folds) + 1,
            "train": _range(timestamps, train_start, purge_start, timeframe_seconds),
            "purge": _range(timestamps, purge_start, split_index, timeframe_seconds),
            "embargo": _range(timestamps, split_index, embargo_stop, timeframe_seconds),
            "oos": _range(timestamps, embargo_stop, oos_stop, timeframe_seconds),
        }
        if fold["train"]["to_utc"] is not None and fold["oos"]["from_utc"] is not None:
            if fold["train"]["to_utc"] > fold["oos"]["from_utc"]:
                raise ResearchValidationPlanError("walk-forward fold is not chronological")
        if holdout_from is not None and fold["oos"]["to_utc"] > holdout_from:
            raise ResearchValidationPlanError("walk-forward OOS reaches locked holdout data")
        folds.append(fold)
        split_index += step_bars

    if not folds:
        raise ResearchValidationPlanError("not enough pre-holdout rows for one walk-forward fold")
    return {
        "schema": "walk-forward-plan-v1",
        "chronology": "train-purge-embargo-oos",
        "expanding": expanding,
        "timeframe_seconds": timeframe_seconds,
        "train_bars": train_bars,
        "oos_bars": oos_bars,
        "step_bars": step_bars,
        "purge_bars": purge_bars,
        "embargo_bars": embargo_bars,
        "overlap_bars": overlap_bars,
        "holdout": {"access": False, "from_utc": holdout_from},
        "fold_count": len(folds),
        "folds": folds,
    }


def build_regime_partition(
    rows: list[dict],
    *,
    timeframe_seconds: int,
    regime_field: str = "regime",
    known_at_field: str = "regime_known_at",
    max_regimes: int = 8,
    max_segments: int = 10_000,
    holdout_policy: dict | None = None,
) -> dict:
    """Build a bounded, as-of regime partition without opening holdout data.

    Regime labels are supplied by a caller-owned, precomputed source.  The
    planner deliberately does not infer labels from future prices: every row
    must carry an integer ``known_at_field`` that is no later than that row's
    timestamp.  This keeps segmentation useful for sensitivity reporting while
    making an accidental look-ahead fail closed at the contract boundary.
    """

    timeframe_seconds = _positive_int(timeframe_seconds, "timeframe_seconds")
    max_regimes = _positive_int(max_regimes, "max_regimes", maximum=64)
    max_segments = _positive_int(max_segments, "max_segments", maximum=100_000)
    for field_name, value in (("regime_field", regime_field), ("known_at_field", known_at_field)):
        if not isinstance(value, str) or re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", value) is None:
            raise ResearchValidationPlanError(f"{field_name} must be a safe field name")
    if regime_field == known_at_field:
        raise ResearchValidationPlanError("regime_field and known_at_field must differ")

    timestamps = _validate_rows(rows, timeframe_seconds)
    holdout_from = _closed_holdout_boundary(holdout_policy)
    if holdout_from is not None:
        for timestamp in timestamps:
            if timestamp + timeframe_seconds > holdout_from:
                raise ResearchValidationPlanError("source rows reach locked holdout data")

    labels: list[str] = []
    known_at: list[int] = []
    for row, timestamp in zip(rows, timestamps):
        label = row.get(regime_field)
        if (
            not isinstance(label, str)
            or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", label) is None
        ):
            raise ResearchValidationPlanError(
                f"{regime_field} must contain a 1-64 character regime label"
            )
        published_at = row.get(known_at_field)
        if type(published_at) is not int or published_at < 0:
            raise ResearchValidationPlanError(
                f"{known_at_field} must contain a nonnegative integer timestamp"
            )
        if published_at > timestamp:
            raise ResearchValidationPlanError(
                f"{known_at_field} cannot be later than the observed row timestamp"
            )
        labels.append(label)
        known_at.append(published_at)

    unique_labels = sorted(set(labels))
    if len(unique_labels) > max_regimes:
        raise ResearchValidationPlanError("regime label count exceeds max_regimes")

    segments: list[dict] = []
    start = 0
    while start < len(labels):
        stop = start + 1
        while stop < len(labels) and labels[stop] == labels[start]:
            stop += 1
        if len(segments) >= max_segments:
            raise ResearchValidationPlanError("regime segment count exceeds max_segments")
        segment_range = _range(timestamps, start, stop, timeframe_seconds)
        segments.append(
            {
                "segment_id": f"segment-{len(segments) + 1:05d}",
                "label": labels[start],
                "known_at_utc": known_at[start],
                **segment_range,
            }
        )
        start = stop

    summaries = []
    for label in unique_labels:
        matching = [segment for segment in segments if segment["label"] == label]
        summaries.append(
            {
                "label": label,
                "bar_count": sum(segment["bar_count"] for segment in matching),
                "segment_count": len(matching),
            }
        )
    return {
        "schema": "regime-segmentation-v1",
        "causal_status": "as-of",
        "source": {"regime_field": regime_field, "known_at_field": known_at_field},
        "timeframe_seconds": timeframe_seconds,
        "holdout": {"access": False, "from_utc": holdout_from},
        "label_count": len(unique_labels),
        "segment_count": len(segments),
        "labels": summaries,
        "segments": segments,
    }


def build_bounded_sweep(parameter_space: dict[str, list], *, max_trials: int) -> dict:
    """Deterministically enumerate a finite prefix of a parameter grid."""

    max_trials = _positive_int(max_trials, "max_trials", maximum=10_000)
    if not isinstance(parameter_space, dict) or not parameter_space:
        raise ResearchValidationPlanError("parameter_space must not be empty")
    if any(not isinstance(name, str) or not name for name in parameter_space):
        raise ResearchValidationPlanError("parameter names must be non-empty strings")
    names = sorted(parameter_space)
    values = []
    for name in names:
        options = parameter_space[name]
        if not isinstance(options, list) or not options:
            raise ResearchValidationPlanError(f"parameter {name} must have at least one option")
        values.append(options)

    search_space_size = prod(len(options) for options in values)
    trials = []
    for index, combination in enumerate(islice(product(*values), max_trials), start=1):
        trials.append(
            {
                "trial_id": f"trial-{index:04d}",
                "parameters": dict(zip(names, combination)),
            }
        )
    return {
        "schema": "bounded-parameter-sweep-v1",
        "selection": "deterministic-grid-prefix",
        "search_space_size": search_space_size,
        "max_trials": max_trials,
        "trial_count": len(trials),
        "truncated": search_space_size > len(trials),
        "trials": trials,
    }


def _planned_trial_ids(sweep: dict) -> list[str]:
    """Validate and return the server-owned trial identities from a sweep.

    Sweep plans are persisted in job protocols/checkpoints and may therefore be
    malformed at a trust boundary.  Keep malformed plans on the typed research
    validation path instead of leaking an ``AttributeError`` from ``.get``.
    """

    trials = sweep.get("trials") if isinstance(sweep, dict) else None
    if not isinstance(trials, list) or not trials:
        raise ResearchValidationPlanError("sweep plan is missing trials")
    if any(not isinstance(trial, dict) for trial in trials):
        raise ResearchValidationPlanError("sweep plan has invalid trial identities")
    planned = [trial.get("trial_id") for trial in trials]
    if any(not isinstance(trial_id, str) or not trial_id.strip() for trial_id in planned):
        raise ResearchValidationPlanError("sweep plan has invalid trial identities")
    if len(set(planned)) != len(planned):
        raise ResearchValidationPlanError("sweep plan has invalid trial identities")
    return planned


def summarize_sweep_outcomes(sweep: dict, outcomes: list[dict]) -> dict:
    """Require an explicit terminal outcome for every planned sweep trial."""

    planned = _planned_trial_ids(sweep)
    if not isinstance(outcomes, list):
        raise ResearchValidationPlanError("sweep outcomes must be a list")

    allowed = {"completed", "failed", "canceled"}
    observed: dict[str, str] = {}
    for outcome in outcomes:
        if not isinstance(outcome, dict):
            raise ResearchValidationPlanError("sweep outcomes must be structured")
        trial_id = outcome.get("trial_id")
        status = outcome.get("status")
        if trial_id not in planned:
            raise ResearchValidationPlanError("sweep outcome references an unplanned trial")
        if trial_id in observed:
            raise ResearchValidationPlanError("sweep outcome duplicates a trial")
        if status not in allowed:
            raise ResearchValidationPlanError("sweep outcome must be completed, failed, or canceled")
        observed[trial_id] = status
    missing = [trial_id for trial_id in planned if trial_id not in observed]
    if missing:
        raise ResearchValidationPlanError("sweep outcomes do not account for every planned trial")
    counts = {status: sum(value == status for value in observed.values()) for status in sorted(allowed)}
    return {
        "schema": "bounded-parameter-sweep-summary-v1",
        "trial_count": len(planned),
        "fully_accounted": True,
        "status_counts": counts,
    }


def complete_canceled_sweep_outcomes(sweep: dict, outcomes: list[dict]) -> tuple[list[dict], dict]:
    """Terminalize a partial sweep by marking every unrecorded trial canceled."""

    planned = _planned_trial_ids(sweep)
    if not isinstance(outcomes, list):
        raise ResearchValidationPlanError("sweep outcomes must be a list")

    allowed = {"completed", "failed", "canceled"}
    observed: dict[str, str] = {}
    for outcome in outcomes:
        if not isinstance(outcome, dict):
            raise ResearchValidationPlanError("sweep outcomes must be structured")
        trial_id = outcome.get("trial_id")
        status = outcome.get("status")
        if trial_id not in planned:
            raise ResearchValidationPlanError("sweep outcome references an unplanned trial")
        if trial_id in observed:
            raise ResearchValidationPlanError("sweep outcome duplicates a trial")
        if status not in allowed:
            raise ResearchValidationPlanError("sweep outcome must be completed, failed, or canceled")
        observed[trial_id] = status

    terminal = [
        {"trial_id": trial_id, "status": observed.get(trial_id, "canceled")}
        for trial_id in planned
    ]
    return terminal, summarize_sweep_outcomes(sweep, terminal)
