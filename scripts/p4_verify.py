import json
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from demo_broker import DemoBrokerSimulator
from execution_service import ExecutionContext, ExecutionDenied, ExecutionService
from execution_store import ExecutionJournal, fingerprint


ORDER = {
    "symbol": "EURUSD",
    "side": "buy",
    "volume": 0.1,
    "stop_loss": 1.0952,
    "take_profit": 1.1102,
}


def main():
    with tempfile.TemporaryDirectory() as temp:
        db_path = Path(temp) / "execution.sqlite3"
        adapter = DemoBrokerSimulator()
        service = ExecutionService(adapter, ExecutionJournal(db_path))
        ctx = ExecutionContext("demo", adapter.account_id, "verify-accepted")
        first = service.place(ctx, ORDER)
        second = service.place(ctx, ORDER)

        denied_modes = []
        for mode in ("local", "replay", "live"):
            try:
                service.place(ExecutionContext(mode, adapter.account_id, f"deny-{mode}"), ORDER)
            except ExecutionDenied:
                denied_modes.append(mode)

        risk_blocked = not service.preview(dict(ORDER, stop_loss=1.0802))["passed"]

        crash_ctx = ExecutionContext("demo", adapter.account_id, "verify-crash")
        preview = service.preview(ORDER)
        intent = {"order": preview["order"], "risk": {"entry_price": preview["entry_price"]}}
        service.journal.prepare(
            crash_ctx.request_id,
            crash_ctx.mode,
            crash_ctx.account_id,
            "place",
            fingerprint(intent),
        )
        restarted_adapter = DemoBrokerSimulator()
        restarted = ExecutionService(restarted_adapter, ExecutionJournal(db_path))
        unknown = restarted.place(crash_ctx, ORDER)
        restarted_adapter.set_result(
            crash_ctx.request_id,
            {"status": "accepted", "broker_order_id": "verify-reconciled"},
        )
        reconciled = restarted.reconcile(crash_ctx.request_id)

        output = {
            "success": all(
                [
                    first == second,
                    len(adapter.calls) == 1,
                    sorted(denied_modes) == ["live", "local", "replay"],
                    risk_blocked,
                    unknown.get("status") == "unknown",
                    restarted_adapter.calls == [],
                    reconciled.get("broker_order_id") == "verify-reconciled",
                    "mt5_data" not in sys.modules,
                    "app" not in sys.modules,
                ]
            ),
            "duplicate_not_resent": first == second and len(adapter.calls) == 1,
            "denied_modes": sorted(denied_modes),
            "risk_blocked": risk_blocked,
            "restart_unknown": unknown.get("status") == "unknown",
            "reconciled_without_resend": restarted_adapter.calls == [],
            "live_execution_enabled": False,
            "mt5_modules_imported": "mt5_data" in sys.modules or "app" in sys.modules,
        }
        print(json.dumps(output, indent=2, sort_keys=True))
        return 0 if output["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
