"""Offline timing and ambiguity contract for methodology feature research.

This module is intentionally a small PREP_ONLY boundary.  It records when a
feature was observed and when its definition made it available to a causal
research decision.  It does not calculate ICT/SMC signals, execute orders, or
claim that a feature has an edge.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any


FEATURE_TIMING_SCHEMA = "feature-timing-fixture-v1"
PREP_ONLY_MODE = "PREP_ONLY"
_OUTCOMES = {"not_triggered", "stop_loss", "take_profit", "ambiguous"}


class FeatureTimingContractError(ValueError):
    """Raised when a timing fixture would permit look-ahead or false fills."""


def definition_sha256(definition: dict[str, Any]) -> str:
    """Return the stable hash of a feature definition.

    Hashing uses sorted keys and compact UTF-8 JSON so the identity does not
    depend on dictionary insertion order or pretty-printing.
    """

    if not isinstance(definition, dict) or not definition:
        raise FeatureTimingContractError("feature definition must be a non-empty object")
    try:
        canonical = json.dumps(
            definition, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise FeatureTimingContractError("feature definition must be JSON-serializable") from exc
    return hashlib.sha256(canonical).hexdigest()


def _integer(value: Any, name: str) -> int:
    if type(value) is not int:
        raise FeatureTimingContractError(f"{name} must be an integer")
    return value


def validate_feature_timing_fixture(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate a deterministic, local-only feature timing fixture.

    Every sample must expose an exact definition hash and an availability time
    derived from ``observed_at + causal_delay_bars * timeframe_seconds``.
    A same-bar stop and target hit is deliberately non-executable until a
    lower-timeframe ordering source is supplied; OHLC alone cannot choose it.
    """

    if not isinstance(payload, dict):
        raise FeatureTimingContractError("fixture must be an object")
    if payload.get("schema") != FEATURE_TIMING_SCHEMA:
        raise FeatureTimingContractError("unsupported feature timing schema")
    if payload.get("mode") != PREP_ONLY_MODE:
        raise FeatureTimingContractError("feature timing fixture must remain PREP_ONLY")
    definitions = payload.get("definitions")
    samples = payload.get("samples")
    if not isinstance(definitions, list) or not definitions:
        raise FeatureTimingContractError("fixture definitions are required")
    if not isinstance(samples, list) or not samples:
        raise FeatureTimingContractError("fixture samples are required")

    by_id: dict[str, tuple[dict[str, Any], str]] = {}
    for index, definition in enumerate(definitions):
        prefix = f"definitions[{index}]"
        if not isinstance(definition, dict):
            raise FeatureTimingContractError(f"{prefix} must be an object")
        definition_id = definition.get("definition_id")
        if not isinstance(definition_id, str) or not definition_id.strip():
            raise FeatureTimingContractError(f"{prefix}.definition_id is required")
        if definition_id in by_id:
            raise FeatureTimingContractError(f"duplicate feature definition: {definition_id}")
        if definition.get("family") not in {"ict", "smc", "price_action"}:
            raise FeatureTimingContractError(f"{prefix}.family is unsupported")
        timeframe = _integer(definition.get("timeframe_seconds"), f"{prefix}.timeframe_seconds")
        delay = _integer(definition.get("causal_delay_bars"), f"{prefix}.causal_delay_bars")
        if timeframe <= 0 or delay < 0:
            raise FeatureTimingContractError(f"{prefix} timing values are invalid")
        if definition.get("feature_available_event") not in {"bar_close", "next_bar_open"}:
            raise FeatureTimingContractError(f"{prefix}.feature_available_event is unsupported")
        if definition["feature_available_event"] == "next_bar_open" and delay < 1:
            raise FeatureTimingContractError(f"{prefix}.next_bar_open requires a positive causal delay")
        by_id[definition_id] = (definition, definition_sha256(definition))

    seen_samples: set[str] = set()
    for index, sample in enumerate(samples):
        prefix = f"samples[{index}]"
        if not isinstance(sample, dict):
            raise FeatureTimingContractError(f"{prefix} must be an object")
        sample_id = sample.get("sample_id")
        if not isinstance(sample_id, str) or not sample_id.strip():
            raise FeatureTimingContractError(f"{prefix}.sample_id is required")
        if sample_id in seen_samples:
            raise FeatureTimingContractError(f"duplicate sample_id: {sample_id}")
        seen_samples.add(sample_id)
        definition_id = sample.get("definition_id")
        if definition_id not in by_id:
            raise FeatureTimingContractError(f"{prefix} references unknown definition")
        definition, expected_hash = by_id[definition_id]
        if sample.get("definition_sha256") != expected_hash:
            raise FeatureTimingContractError(f"{prefix}.definition_sha256 does not match definition")
        observed_at = _integer(sample.get("observed_at"), f"{prefix}.observed_at")
        available_at = _integer(sample.get("available_at"), f"{prefix}.available_at")
        expected_available_at = observed_at + definition["causal_delay_bars"] * definition["timeframe_seconds"]
        if available_at != expected_available_at:
            raise FeatureTimingContractError(f"{prefix}.available_at violates causal delay")
        if sample.get("outcome") not in _OUTCOMES:
            raise FeatureTimingContractError(f"{prefix}.outcome is unsupported")
        same_bar = sample.get("same_bar")
        if not isinstance(same_bar, dict) or type(same_bar.get("stop_hit")) is not bool or type(same_bar.get("take_profit_hit")) is not bool:
            raise FeatureTimingContractError(f"{prefix}.same_bar hit flags are required")
        dual_hit = same_bar["stop_hit"] and same_bar["take_profit_hit"]
        outcome = sample["outcome"]
        executable = sample.get("executable")
        if type(executable) is not bool:
            raise FeatureTimingContractError(f"{prefix}.executable must be boolean")
        if dual_hit:
            if outcome != "ambiguous" or executable or sample.get("resolution") != "lower_timeframe_required":
                raise FeatureTimingContractError(f"{prefix} dual-hit outcome must fail closed")
        elif executable:
            raise FeatureTimingContractError(f"{prefix} PREP_ONLY samples cannot be executable")
        elif outcome == "ambiguous":
            raise FeatureTimingContractError(f"{prefix} ambiguous outcome requires dual-hit evidence")
        elif outcome == "stop_loss" and not same_bar["stop_hit"]:
            raise FeatureTimingContractError(f"{prefix} stop_loss lacks stop hit")
        elif outcome == "take_profit" and not same_bar["take_profit_hit"]:
            raise FeatureTimingContractError(f"{prefix} take_profit lacks target hit")
        if outcome == "not_triggered" and (same_bar["stop_hit"] or same_bar["take_profit_hit"]):
            raise FeatureTimingContractError(f"{prefix} not_triggered has a hit flag")

    return {
        "validated": True,
        "schema": FEATURE_TIMING_SCHEMA,
        "mode": PREP_ONLY_MODE,
        "definition_count": len(definitions),
        "sample_count": len(samples),
        "ambiguous_count": sum(sample["outcome"] == "ambiguous" for sample in samples),
        "oracle": "causal-feature-timing-v1",
    }

