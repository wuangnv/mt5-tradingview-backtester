"""Deterministic P2 verification against an isolated temporary research database."""

import hashlib
import json
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from research_fixture import reproduce_fixture  # noqa: E402
from research_store import ResearchStore, ResearchValidationError  # noqa: E402


def main():
    with tempfile.TemporaryDirectory() as temp_dir:
        store = ResearchStore(Path(temp_dir) / "research.sqlite3")
        bars = [
            {"time": 1_742_788_800, "close": 1.0},
            {"time": 1_742_792_400, "close": 1.1},
            {"time": 1_742_796_000, "close": 9.9},
        ]
        dataset_sha256 = hashlib.sha256(
            json.dumps(bars, separators=(",", ":"), sort_keys=True).encode("utf-8")
        ).hexdigest()
        cutoff_ms = bars[1]["time"] * 1000
        hypothesis = store.create_hypothesis(
            {"title": "P2 verifier", "thesis": "Fixture behavior must be reproducible."}
        )
        strategy = store.create_strategy_version(
            {
                "hypothesis_id": hypothesis["id"],
                "strategy_key": "p2-fixture",
                "version": "1.0.0",
                "rules": {"entry": "fixture"},
            }
        )
        protocol = store.create_protocol(
            {
                "strategy_version_id": strategy["id"],
                "name": "deterministic fixture",
                "dataset_id": "p2-fixture-v1",
                "dataset_sha256": dataset_sha256,
                "data_start_ms": bars[0]["time"] * 1000,
                "cutoff_ms": cutoff_ms,
                "seed": 17,
                "parameters": {"cost_model": "fixture-v1"},
            }
        )
        budget = {"max_bars": 100, "max_runtime_ms": 1000}
        first = store.create_run({"protocol_id": protocol["id"], "budget": budget})
        second = store.create_run({"protocol_id": protocol["id"], "budget": budget})
        store.start_run(first["id"])

        fixture_a = reproduce_fixture(bars, protocol["cutoff_ms"], protocol["seed"], protocol["parameters"])
        fixture_b = reproduce_fixture(bars, protocol["cutoff_ms"], protocol["seed"], protocol["parameters"])

        future_leak_blocked = False
        try:
            store.complete_run(first["id"], {"observed_until_ms": cutoff_ms + 1, "result": {}})
        except ResearchValidationError:
            future_leak_blocked = True

        first = store.complete_run(
            first["id"],
            {"observed_until_ms": fixture_a["observed_until_ms"], "result": fixture_a},
        )
        second = store.cancel_run(second["id"], "verifier cancellation path")
        result = {
            "success": True,
            "same_repro_key": first["repro_key"] == second["repro_key"],
            "same_fixture_checksum": fixture_a["fixture_checksum"] == fixture_b["fixture_checksum"],
            "future_bar_excluded": fixture_a["visible_bar_count"] == 2,
            "production_timestamp_units": fixture_a["observed_until_ms"] == cutoff_ms,
            "future_leak_blocked": future_leak_blocked,
            "statuses": [first["status"], second["status"]],
            "budget_preserved": first["budget"] == budget and second["budget"] == budget,
            "mt5_modules_imported": any(name == "mt5_data" or name == "app" for name in sys.modules),
        }
        result["success"] = all(
            [
                result["same_repro_key"],
                result["same_fixture_checksum"],
                result["future_bar_excluded"],
                result["production_timestamp_units"],
                result["future_leak_blocked"],
                result["statuses"] == ["completed", "cancelled"],
                result["budget_preserved"],
                not result["mt5_modules_imported"],
            ]
        )
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0 if result["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
