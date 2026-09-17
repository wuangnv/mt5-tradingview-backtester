"""Deterministic fixture execution helpers for the P2 research contract."""

import hashlib
import json

from evidence_replay import bars_through_cutoff


def reproduce_fixture(bars, cutoff_ms, seed, parameters=None):
    """Return a deterministic summary using only bars visible through cutoff_ms."""
    if isinstance(seed, bool):
        raise ValueError("seed must be an integer")
    try:
        seed = int(seed)
    except (TypeError, ValueError) as exc:
        raise ValueError("seed must be an integer") from exc
    if parameters is None:
        parameters = {}
    if not isinstance(parameters, dict):
        raise ValueError("parameters must be an object")

    visible = bars_through_cutoff(bars, cutoff_ms)
    if not visible:
        raise ValueError("fixture has no bars at or before cutoff_ms")
    payload = {
        "bars": visible,
        "cutoff_ms": cutoff_ms,
        "seed": seed,
        "parameters": parameters,
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=True,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return {
        "fixture_checksum": hashlib.sha256(encoded).hexdigest(),
        "input_bar_count": len(bars),
        "visible_bar_count": len(visible),
        "observed_until_ms": visible[-1]["time"],
    }
