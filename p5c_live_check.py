"""P5C broker-side live preflight using MT5 OrderCheck only.

This module never calls OrderSend and never exposes place/close operations.
"""

import argparse
import json
import math


class LiveCheckError(RuntimeError):
    pass


def _success(response, label):
    if not isinstance(response, dict):
        raise LiveCheckError(f"{label} returned an invalid response")
    if not response.get("success"):
        raise LiveCheckError(response.get("message") or f"{label} failed")
    return response


def _positive_number(value, label):
    if isinstance(value, bool):
        raise LiveCheckError(f"{label} must be a positive number")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise LiveCheckError(f"{label} must be a positive number") from exc
    if not math.isfinite(number) or number <= 0:
        raise LiveCheckError(f"{label} must be a positive number")
    return number


def inspect_live_account(fetcher, *, expected_account_id=None, expected_server=None):
    context = _success(fetcher.get_execution_context(), "MT5 execution context")
    if int(context.get("protocol_version") or 0) < 3:
        raise LiveCheckError("MT5 gateway protocol v3 is required for live OrderCheck")

    account = context.get("account") or {}
    terminal = context.get("terminal") or {}
    mode = str(account.get("trade_mode") or "").strip().lower()
    account_id = str(account.get("login") or "")
    server = str(account.get("server") or "")

    blockers = []
    if mode not in {"real", "live"}:
        blockers.append("connected MT5 account is not live/real")
    if expected_account_id is not None and account_id != str(expected_account_id):
        blockers.append("live account id does not match the approved account")
    if expected_server is not None and server != str(expected_server):
        blockers.append("live account server does not match the approved server")
    if not terminal.get("connected"):
        blockers.append("MT5 terminal is disconnected")
    if not account.get("trade_allowed"):
        blockers.append("MT5 account does not allow trading")
    if not account.get("trade_expert"):
        blockers.append("MT5 account does not allow expert trading")
    if not terminal.get("trade_allowed"):
        blockers.append("MT5 terminal trading is disabled")
    if not terminal.get("mql_trade_allowed"):
        blockers.append("MT5 MQL trading is disabled")
    if blockers:
        raise LiveCheckError("; ".join(blockers))

    account_response = _success(fetcher.get_account_result(), "MT5 account")
    positions_response = _success(fetcher.get_positions_result(), "MT5 positions")
    positions = positions_response.get("positions")
    if not isinstance(positions, list):
        raise LiveCheckError("MT5 positions response is missing a valid positions list")

    return {
        "protocol_version": int(context.get("protocol_version") or 0),
        "account": {
            "account_id": account_id,
            "server": server,
            "mode": mode,
            "currency": account.get("currency"),
            "company": account.get("company"),
            "balance": (account_response.get("account") or {}).get("balance"),
            "equity": (account_response.get("account") or {}).get("equity"),
        },
        "positions": positions,
    }


def build_minimum_market_check(fetcher, symbol="EURUSD", *, stop_buffer_points=20):
    symbol = str(symbol or "").strip().upper()
    if not symbol or any(char in symbol for char in ";\r\n"):
        raise LiveCheckError("symbol is invalid")

    symbol_response = _success(fetcher.get_symbol_info(symbol), "MT5 symbol contract")
    info = symbol_response.get("symbol") or {}
    if not info.get("trade_allowed"):
        raise LiveCheckError(f"broker trading is disabled for {symbol}")
    quote_response = _success(fetcher.get_price_result(symbol), "MT5 quote")
    price = quote_response.get("price") or {}

    minimum_volume = _positive_number(info.get("volume_min"), "symbol.volume_min")
    point = _positive_number(info.get("point") or info.get("tick_size"), "symbol.point")
    ask = _positive_number(price.get("ask"), "quote.ask")
    digits = int(info.get("digits") or 5)
    stops_level = max(0, int(info.get("stops_level") or 0))
    distance_points = max(stops_level + 5, int(stop_buffer_points), 1)
    stop_loss = round(ask - distance_points * point, digits)
    if stop_loss <= 0 or stop_loss >= ask:
        raise LiveCheckError("unable to derive a valid protective stop for broker check")

    return {
        "symbol": symbol,
        "side": "buy",
        "volume": minimum_volume,
        "stop_loss": stop_loss,
        "take_profit": 0.0,
    }


def run_live_check(
    fetcher,
    *,
    expected_account_id=None,
    expected_server=None,
    symbol="EURUSD",
):
    preflight = inspect_live_account(
        fetcher,
        expected_account_id=expected_account_id,
        expected_server=expected_server,
    )
    before_positions = list(preflight["positions"])
    order = build_minimum_market_check(fetcher, symbol)
    response = _success(
        fetcher.check_order(
            order["symbol"],
            order["side"],
            order["volume"],
            order["stop_loss"],
            order["take_profit"],
        ),
        "MT5 OrderCheck",
    )
    check = response.get("check")
    if not isinstance(check, dict):
        raise LiveCheckError("MT5 OrderCheck returned an invalid check payload")

    after_response = _success(fetcher.get_positions_result(), "MT5 positions after OrderCheck")
    after_positions = after_response.get("positions")
    if not isinstance(after_positions, list):
        raise LiveCheckError("MT5 positions response is invalid after OrderCheck")
    if after_positions != before_positions:
        raise LiveCheckError("positions changed during check-only live validation")

    return {
        "phase": "P5C-live-check-only",
        "live_execution_enabled": False,
        "order_send_used": False,
        "preflight": preflight,
        "order": order,
        "broker_check": check,
        "positions_unchanged": True,
    }


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Run broker-side MT5 OrderCheck on the active real account"
    )
    parser.add_argument("--expected-account-id")
    parser.add_argument("--expected-server")
    parser.add_argument("--symbol", default="EURUSD")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    from mt5_data import mt5_fetcher

    if not mt5_fetcher.wait_for_connection(12.0):
        raise LiveCheckError("MT5 EA did not connect to the local socket gateway")
    result = run_live_check(
        mt5_fetcher,
        expected_account_id=args.expected_account_id,
        expected_server=args.expected_server,
        symbol=args.symbol,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
