"""P5B live-like rehearsal on an exact MT5 demo account.

This deliberately reuses the P4 demo-only execution service. It can prove the
execution/reconciliation path on a broker demo account, but it never enables a
live account or treats demo evidence as live acceptance.
"""

import argparse
import json
import time
import uuid

from execution_service import ExecutionContext, ExecutionService, ExecutionUnknown
from execution_store import ExecutionJournal


class DemoRehearsalError(RuntimeError):
    pass


REQUIRED_CAPABILITIES = ("place_market", "close_position", "request_lookup")


def _positive_number(value, name):
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise DemoRehearsalError(f"{name} must be a positive number") from exc
    if number <= 0:
        raise DemoRehearsalError(f"{name} must be a positive number")
    return number


def validate_demo_preflight(adapter, expected_account_id, expected_server):
    identity = adapter.identity_snapshot()
    connection = adapter.connection_snapshot()
    capabilities = adapter.capabilities_snapshot()
    positions = adapter.positions_snapshot() if connection.get("connected") else []

    blockers = []
    if identity.get("mode") != "demo":
        blockers.append("adapter is not bound to a demo account")
    if str(identity.get("account_id") or "") != str(expected_account_id or ""):
        blockers.append("demo account id does not match the approved account")
    if str(identity.get("server") or "") != str(expected_server or ""):
        blockers.append("demo account server does not match the approved server")
    if not connection.get("connected"):
        blockers.append(connection.get("message") or "MT5 demo connection is unavailable")
    for capability in REQUIRED_CAPABILITIES:
        if not capabilities.get(capability):
            blockers.append(f"broker capability {capability} is unavailable")
    if positions:
        blockers.append("demo rehearsal requires zero existing positions")

    if blockers:
        raise DemoRehearsalError("; ".join(blockers))

    return {
        "identity": identity,
        "connection": connection,
        "capabilities": capabilities,
        "positions": positions,
    }


def build_minimum_order(service, adapter, symbol, *, stop_ticks=20):
    symbol = str(symbol or "").strip().upper()
    if not symbol:
        raise DemoRehearsalError("symbol is required")

    quote = adapter.quote_snapshot(symbol)
    contract = quote.get("contract") or {}
    tick_size = _positive_number(contract.get("tick_size"), "contract.tick_size")
    min_volume = _positive_number(contract.get("min_volume"), "contract.min_volume")
    stops_level = int(contract.get("stops_level") or 0)
    ticks = max(int(stop_ticks), stops_level + 5, 1)
    entry = _positive_number(quote.get("ask"), "quote.ask")

    order = {
        "symbol": symbol,
        "side": "buy",
        "volume": min_volume,
        "stop_loss": entry - (ticks * tick_size),
        "take_profit": None,
    }
    preview = service.preview(order)
    if not preview.get("passed"):
        raise DemoRehearsalError(
            "risk preview did not pass: " + "; ".join(preview.get("reasons") or [])
        )
    return order, preview


def _recover_unknown(adapter, service, request_id):
    reconnect = getattr(adapter, "reconnect", None)
    if callable(reconnect):
        reconnect()
    return service.reconcile(request_id)


def _run_request(callback, adapter, service, request_id):
    try:
        return callback()
    except ExecutionUnknown:
        return _recover_unknown(adapter, service, request_id)


def run_demo_rehearsal(
    adapter,
    journal,
    *,
    expected_account_id,
    expected_server,
    symbol="EURUSD",
    max_risk_pct=0.25,
    max_risk_amount=10.0,
    max_positions=1,
    stop_ticks=20,
    execute=False,
    request_prefix=None,
):
    preflight = validate_demo_preflight(adapter, expected_account_id, expected_server)
    service = ExecutionService(
        adapter,
        journal,
        max_risk_pct=max_risk_pct,
        max_risk_amount=max_risk_amount,
        max_positions=max_positions,
    )
    order, preview = build_minimum_order(service, adapter, symbol, stop_ticks=stop_ticks)

    summary = {
        "phase": "P5B-demo-live-like",
        "live_execution_enabled": False,
        "execute": bool(execute),
        "preflight": preflight,
        "order": order,
        "preview": preview,
        "place": None,
        "place_reconciled": None,
        "place_broker_lookup": None,
        "close": None,
        "close_reconciled": None,
        "close_broker_lookup": None,
        "final_positions": list(preflight["positions"]),
    }
    if not execute:
        return summary

    prefix = request_prefix or f"p5b-{int(time.time())}-{uuid.uuid4().hex[:8]}"
    place_id = f"{prefix}-place"
    close_id = f"{prefix}-close"
    context = lambda request_id: ExecutionContext(
        mode="demo",
        account_id=str(expected_account_id),
        account_server=str(expected_server),
        request_id=request_id,
    )

    place = _run_request(
        lambda: service.place(context(place_id), order),
        adapter,
        service,
        place_id,
    )
    summary["place"] = place
    summary["place_reconciled"] = service.reconcile(place_id)
    summary["place_broker_lookup"] = adapter.lookup_request(place_id)
    if summary["place_broker_lookup"] is None:
        raise DemoRehearsalError("broker request lookup did not find the place request")

    positions = adapter.positions_snapshot()
    position_id = str(place.get("position_id") or "")
    if not position_id:
        position_id = str((place.get("position") or {}).get("position_id") or "")
    if not position_id and len(positions) == 1:
        position_id = str(positions[0].get("position_id") or "")
    if not position_id:
        raise DemoRehearsalError("broker place did not expose a position to close")

    close = _run_request(
        lambda: service.close(context(close_id), position_id),
        adapter,
        service,
        close_id,
    )
    summary["close"] = close
    summary["close_reconciled"] = service.reconcile(close_id)
    summary["close_broker_lookup"] = adapter.lookup_request(close_id)
    if summary["close_broker_lookup"] is None:
        raise DemoRehearsalError("broker request lookup did not find the close request")
    summary["final_positions"] = adapter.positions_snapshot()
    if summary["final_positions"]:
        raise DemoRehearsalError("demo rehearsal cleanup failed: positions remain open")
    return summary


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="P5B exact-bound demo live-like execution rehearsal"
    )
    parser.add_argument("--expected-account-id", required=True)
    parser.add_argument("--expected-server", required=True)
    parser.add_argument("--symbol", default="EURUSD")
    parser.add_argument("--execution-db")
    parser.add_argument("--max-risk-pct", type=float, default=0.25)
    parser.add_argument("--max-risk-amount", type=float, default=10.0)
    parser.add_argument("--max-positions", type=int, default=1)
    parser.add_argument("--stop-ticks", type=int, default=20)
    parser.add_argument(
        "--execute",
        action="store_true",
        help="send one minimum-volume demo place -> close cycle",
    )
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    from mt5_data import mt5_fetcher
    from mt5_demo_broker import MT5SocketDemoAdapter

    adapter = MT5SocketDemoAdapter(mt5_fetcher, connect_timeout=12.0)
    summary = run_demo_rehearsal(
        adapter,
        ExecutionJournal(args.execution_db),
        expected_account_id=args.expected_account_id,
        expected_server=args.expected_server,
        symbol=args.symbol,
        max_risk_pct=args.max_risk_pct,
        max_risk_amount=args.max_risk_amount,
        max_positions=args.max_positions,
        stop_ticks=args.stop_ticks,
        execute=args.execute,
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
