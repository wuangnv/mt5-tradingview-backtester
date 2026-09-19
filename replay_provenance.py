"""Build content-addressed provenance for newly saved browser replay sessions."""

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path


PROVENANCE_VERSION = "replay-provenance-v1"
COST_MODEL_VERSION = "virtual-zero-cost-v1"
FILL_MODEL_VERSION = "virtual-replay-fill-v1"
RISK_MODEL_VERSION = "virtual-manual-sizing-v1"
ENGINE_VERSION = "browser-replay-v1"


def _canonical_sha256(value):
    encoded = json.dumps(
        value,
        ensure_ascii=True,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _utc_iso(unix_seconds):
    return datetime.fromtimestamp(int(unix_seconds), tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _code_hash():
    root = Path(__file__).resolve().parent
    digest = hashlib.sha256()
    for relative in (
        "replay_provenance.py",
        "session_store.py",
        "static/js/replay.js",
        "static/js/trading.js",
        "static/js/analytics.js",
    ):
        path = root / relative
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def build_replay_evidence(report, history_store):
    replay_range = report.get("replayRange")
    if not isinstance(replay_range, dict):
        raise ValueError("replayRange must be an object")
    try:
        range_from = int(replay_range.get("from"))
        range_to = int(replay_range.get("to"))
    except (TypeError, ValueError) as exc:
        raise ValueError("replayRange.from and replayRange.to must be unix seconds") from exc
    if range_from < 0 or range_to < range_from:
        raise ValueError("replayRange is invalid")

    symbol = str(report.get("symbol") or "").strip().upper()
    timeframe = str(report.get("timeframe") or "").strip().upper()
    bars = history_store.load(symbol, timeframe, from_time=range_from, to_time=range_to)
    if not bars:
        raise ValueError("replay provenance cannot be built because local history range is empty")

    normalized_bars = sorted((dict(bar) for bar in bars), key=lambda bar: int(bar["time"]))
    first_time = int(normalized_bars[0]["time"])
    last_time = int(normalized_bars[-1]["time"])
    dataset_hash = _canonical_sha256(
        {
            "provenance_version": PROVENANCE_VERSION,
            "symbol": symbol,
            "timeframe": timeframe,
            "bars": normalized_bars,
        }
    )
    config_hash = _canonical_sha256(
        {
            "symbol": symbol,
            "timeframe": timeframe,
            "start_balance": report.get("startBalance"),
            "requested_range": {"from": range_from, "to": range_to},
            "cost_model_version": COST_MODEL_VERSION,
            "fill_model_version": FILL_MODEL_VERSION,
            "risk_model_version": RISK_MODEL_VERSION,
        }
    )

    return {
        "artifact_schema_version": "replay-evidence-v2",
        "strategy_id": "manual-replay",
        "strategy_version": "manual-replay-v1",
        "data": {
            "dataset_id": f"local-bars-sha256:{dataset_hash}",
            "source_id": f"local-history:{symbol}:{timeframe}",
            "requested_range": {"from": _utc_iso(range_from), "to": _utc_iso(range_to)},
            "observed_range": {"from": _utc_iso(first_time), "to": _utc_iso(last_time)},
            "timezone": "UTC",
            "quality_status": "local_content_hashed_unverified",
        },
        "assumptions": {
            "cost_model_version": COST_MODEL_VERSION,
            "spread": 0,
            "slippage": 0,
            "commission": 0,
            "fill_model_version": FILL_MODEL_VERSION,
            "risk_model_version": RISK_MODEL_VERSION,
        },
        "reproduce": {
            "engine_version": ENGINE_VERSION,
            "metric_version": "metrics-v2",
            "code_hash": _code_hash(),
            "config_hash": config_hash,
            "seed": None,
        },
    }
