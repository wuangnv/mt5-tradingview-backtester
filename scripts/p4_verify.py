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
        ctx = ExecutionContext("demo", adapter.account_id, adapter.server_id, "verify-accepted")
        risk_blocked = not service.preview(dict(ORDER, stop_loss=1.0802))["passed"]
        first = service.place(ctx, ORDER)
        adapter.set_quote("EURUSD", bid=1.1200, ask=1.1202)
        second = service.place(ctx, ORDER)

        denied_modes = []
        for mode in ("local", "replay", "live"):
            try:
                service.place(
                    ExecutionContext(mode, adapter.account_id, adapter.server_id, f"deny-{mode}"),
                    ORDER,
                )
            except ExecutionDenied:
                denied_modes.append(mode)

        crash_ctx = ExecutionContext("demo", adapter.account_id, adapter.server_id, "verify-crash")
        intent = {"order": service._normalize_order(ORDER)}
        service.journal.prepare(
            crash_ctx.request_id,
            crash_ctx.mode,
            crash_ctx.account_id,
            crash_ctx.account_server,
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

        timeout_adapter = DemoBrokerSimulator()
        timeout_adapter.next_status = "timeout_accepted"
        timeout_service = ExecutionService(
            timeout_adapter, ExecutionJournal(Path(temp) / "timeout.sqlite3")
        )
        timeout_ctx = ExecutionContext(
            "demo", timeout_adapter.account_id, timeout_adapter.server_id, "verify-timeout"
        )
        timeout_unknown = False
        try:
            timeout_service.place(timeout_ctx, ORDER)
        except Exception as exc:
            timeout_unknown = getattr(exc, "code", None) == "EXECUTION_UNKNOWN"
        timeout_adapter.next_status = "accepted"
        timeout_reconciled = timeout_service.reconcile(timeout_ctx.request_id)

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
                    timeout_unknown,
                    timeout_reconciled.get("status") == "accepted",
                    len(timeout_adapter.calls) == 1,
                    "mt5_data" not in sys.modules,
                    "app" not in sys.modules,
                ]
            ),
            "duplicate_not_resent": first == second and len(adapter.calls) == 1,
            "denied_modes": sorted(denied_modes),
            "risk_blocked": risk_blocked,
            "restart_unknown": unknown.get("status") == "unknown",
            "reconciled_without_resend": restarted_adapter.calls == [],
            "timeout_reconciled_without_resend": timeout_unknown
            and timeout_reconciled.get("status") == "accepted"
            and len(timeout_adapter.calls) == 1,
            "live_execution_enabled": False,
            "mt5_modules_imported": "mt5_data" in sys.modules or "app" in sys.modules,
        }
        print(json.dumps(output, indent=2, sort_keys=True))
        return 0 if output["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
