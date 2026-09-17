"""Synthetic in-memory server used for P1 browser smoke testing."""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from evidence_metrics import compute_metrics_v1
from evidence_store import EvidenceNotFound
from p1_app import create_app


def _ledger(trade_id, net_pnl):
    return [
        {
            "trade_id": str(trade_id),
            "open_time_utc": "2026-09-01T08:00:00Z",
            "close_time_utc": "2026-09-01T10:00:00Z",
            "symbol": "EURUSD",
            "side": "BUY",
            "quantity": 0.1,
            "price_open": 1.08,
            "price_close": 1.0815 if net_pnl > 0 else 1.0793,
            "gross_pnl": None,
            "fees": None,
            "net_pnl": net_pnl,
            "planned_risk_budget": None,
            "realized_r": None,
            "legacy_r": 1.5 if net_pnl > 0 else -1.0,
            "legacy_result": "Take Profit" if net_pnl > 0 else "Stop Loss",
        }
    ]


class UiFixtureStore:
    def __init__(self):
        self._runs = {
            "1": self._make_run("1", "2026-09-01T10:01:00Z", 100001, 15.0),
            "2": self._make_run("2", "2026-09-02T10:01:00Z", 100002, -7.0),
        }

    @staticmethod
    def _make_run(run_id, created_at, trade_id, net_pnl):
        ledger = _ledger(trade_id, net_pnl)
        return {
            "run": {
                "run_id": run_id,
                "artifact_schema_version": "legacy-replay-session-v1",
                "created_at_utc": created_at,
                "status": "completed",
                "halt_reason": None,
                "strategy_id": None,
                "strategy_version": None,
                "starting_balance": 1000.0,
                "data": {
                    "symbol": "EURUSD",
                    "timeframe": "H1",
                    "bars_replayed": 42,
                    "dataset_id": None,
                    "source_id": None,
                    "requested_range": None,
                    "observed_range": None,
                    "timezone": None,
                    "coverage": None,
                    "quality_status": "unknown",
                },
                "assumptions": {
                    "cost_model_version": None,
                    "spread": None,
                    "slippage": None,
                    "commission": None,
                    "fill_model_version": None,
                    "risk_model_version": None,
                },
                "reproduce": {
                    "engine_version": None,
                    "metric_version": "metrics-v1",
                    "code_hash": None,
                    "config_hash": None,
                    "seed": None,
                },
                "comparison": {
                    "ready": False,
                    "reasons": [
                        "requested_range_unknown",
                        "cost_model_unknown",
                        "risk_model_unknown",
                    ],
                },
                "links": {
                    "ledger": f"/api/runs/{run_id}/ledger",
                    "metrics": f"/api/runs/{run_id}/metrics",
                    "equity": f"/api/runs/{run_id}/equity",
                },
            },
            "ledger": ledger,
            "metrics": compute_metrics_v1(ledger, 1000),
        }

    def _bundle(self, run_id):
        try:
            return self._runs[str(run_id)]
        except KeyError as exc:
            raise EvidenceNotFound("run was not found") from exc

    def list_runs(self, limit=50):
        runs = [item["run"] for item in self._runs.values()]
        return sorted(runs, key=lambda run: run["created_at_utc"], reverse=True)[:limit]

    def get_run(self, run_id):
        return self._bundle(run_id)["run"]

    def get_ledger(self, run_id):
        return self._bundle(run_id)["ledger"]

    def get_metrics(self, run_id):
        return self._bundle(run_id)["metrics"]

    def get_trade(self, run_id, trade_id):
        for trade in self.get_ledger(run_id):
            if trade["trade_id"] == str(trade_id):
                return trade
        raise EvidenceNotFound("trade was not found")

    def build_evidence_bundle(self, run_id):
        return self._bundle(run_id)


app = create_app(store=UiFixtureStore())


if __name__ == "__main__":
    port = int(os.environ.get("P1_FIXTURE_PORT", "5011"))
    app.run(host="127.0.0.1", port=port, debug=False)
