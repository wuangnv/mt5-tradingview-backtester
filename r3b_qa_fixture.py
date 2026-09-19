"""Deterministic QA-only replay artifact for R3b integration acceptance."""

from datetime import datetime, timedelta, timezone
import hashlib
import json


FIXTURE_VERSION = "r3b-qa-fixture-v1"


def _digest(value):
    encoded = json.dumps(
        value,
        ensure_ascii=True,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def build_r3b_qa_report():
    """Build a synthetic, clearly labelled artifact that satisfies R3b data gates."""
    start = datetime(2026, 1, 5, 9, 0, tzinfo=timezone.utc)
    pnl_pattern = (-12.0, 8.0, 16.0)
    trades = []
    ticket = 700000

    for day_index in range(10):
        day_start = start + timedelta(days=day_index)
        for trade_index, pnl in enumerate(pnl_pattern):
            open_time = day_start + timedelta(hours=trade_index * 2)
            close_time = open_time + timedelta(hours=1)
            ticket += 1
            trades.append(
                {
                    "time": int(close_time.timestamp()),
                    "time_open": int(open_time.timestamp()),
                    "ticket": ticket,
                    "symbol": "EURUSD",
                    "type": "BUY" if trade_index != 1 else "SELL",
                    "volume": 0.10,
                    "price_open": 1.1000,
                    "price_close": 1.1010 if pnl > 0 else 1.0990,
                    "profit": pnl,
                    "result": "Closed",
                    "r": pnl / 12.0,
                }
            )

    first_open = datetime.fromtimestamp(trades[0]["time_open"], tz=timezone.utc)
    last_close = datetime.fromtimestamp(trades[-1]["time"], tz=timezone.utc)
    requested_range = {
        "from": first_open.isoformat().replace("+00:00", "Z"),
        "to": last_close.isoformat().replace("+00:00", "Z"),
    }
    dataset_payload = {
        "fixture_version": FIXTURE_VERSION,
        "symbol": "EURUSD",
        "timeframe": "H1",
        "requested_range": requested_range,
        "trades": trades,
    }
    dataset_hash = _digest(dataset_payload)
    config_hash = _digest(
        {
            "fixture_version": FIXTURE_VERSION,
            "pnl_pattern": pnl_pattern,
            "days": 10,
            "trades_per_day": 3,
        }
    )

    return {
        "symbol": "EURUSD",
        "timeframe": "H1",
        "barsReplayed": 240,
        "realMs": 1000,
        "startBalance": 10000,
        "trades": trades,
        "evidence": {
            "artifact_schema_version": "replay-evidence-v2",
            "strategy_id": "qa-r3b-deterministic",
            "strategy_version": FIXTURE_VERSION,
            "data": {
                "dataset_id": f"synthetic-qa-sha256:{dataset_hash}",
                "source_id": FIXTURE_VERSION,
                "requested_range": requested_range,
                "observed_range": requested_range,
                "timezone": "UTC",
                "quality_status": "synthetic_qa_only",
            },
            "assumptions": {
                "cost_model_version": "qa-zero-cost-v1",
                "spread": 0,
                "slippage": 0,
                "commission": 0,
                "fill_model_version": "qa-deterministic-fill-v1",
                "risk_model_version": "qa-fixed-outcome-risk-v1",
            },
            "reproduce": {
                "engine_version": FIXTURE_VERSION,
                "metric_version": "metrics-v2",
                "code_hash": _digest({"fixture_version": FIXTURE_VERSION}),
                "config_hash": config_hash,
                "seed": 20260105,
            },
        },
    }
