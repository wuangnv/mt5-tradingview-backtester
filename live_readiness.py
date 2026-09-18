"""P5 read-only live readiness gate.

This module can inspect an MT5 account, but it cannot send, close, or modify
orders. Live execution remains a separate P5 gate.
"""

import math
from dataclasses import dataclass


ALLOWED_ACTIONS = frozenset({"place_market", "close_position", "reconcile"})


def _coerce_number(value, converter):
    if isinstance(value, bool):
        return None
    if converter is int:
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            if not math.isfinite(value) or not value.is_integer():
                return None
            return int(value)
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return None
            digits = text[1:] if text[:1] in {"+", "-"} else text
            if not digits.isdigit():
                return None
            try:
                return int(text)
            except (ValueError, OverflowError):
                return None
        return None
    try:
        return converter(value)
    except (TypeError, ValueError, OverflowError):
        return None


def _normalized_items(value, transform):
    if value is None:
        return ()
    if isinstance(value, str):
        value = (value,)
    elif not isinstance(value, (list, tuple)):
        return None
    items = tuple(value)
    normalized = []
    for item in items:
        if not isinstance(item, str):
            return None
        text = item.strip()
        if not text:
            return None
        normalized.append(transform(text))
    return tuple(sorted(set(normalized)))


def _valid_symbol_token(symbol):
    if not isinstance(symbol, str) or not (1 <= len(symbol) <= 64):
        return False
    if any(char.isspace() or char in ";\r\n" for char in symbol):
        return False
    return any(char.isalnum() for char in symbol)


@dataclass(frozen=True)
class LivePolicy:
    expected_account_id: str = ""
    expected_server: str = ""
    max_risk_pct: float = 0.0
    max_risk_amount: float = 0.0
    max_positions: int = 0
    allowed_actions: tuple = ()
    allowed_symbols: tuple = ()

    def normalized(self):
        return {
            "expected_account_id": str(self.expected_account_id or "").strip(),
            "expected_server": str(self.expected_server or "").strip(),
            "max_risk_pct": _coerce_number(self.max_risk_pct, float),
            "max_risk_amount": _coerce_number(self.max_risk_amount, float),
            "max_positions": _coerce_number(self.max_positions, int),
            "allowed_actions": _normalized_items(
                self.allowed_actions, lambda item: item.lower()
            ),
            "allowed_symbols": _normalized_items(
                self.allowed_symbols, lambda item: item.upper()
            ),
        }


class MT5LiveReadinessProbe:
    """Read-only adapter over the existing MT5 socket fetcher."""

    probe_name = "mt5-live-readiness"

    def __init__(self, fetcher):
        self.fetcher = fetcher

    @staticmethod
    def _success(response, label):
        if not isinstance(response, dict):
            raise ConnectionError(f"{label} returned an invalid response")
        if not response.get("success"):
            raise ConnectionError(response.get("message") or f"{label} failed")
        return response

    def snapshot(self, policy, journal):
        policy = policy.normalized()
        blockers = []

        if not policy["expected_account_id"]:
            blockers.append("expected live account_id is not configured")
        if not policy["expected_server"]:
            blockers.append("expected live account server is not configured")
        if (
            policy["max_risk_pct"] is None
            or not math.isfinite(policy["max_risk_pct"])
            or not (0 < policy["max_risk_pct"] <= 100)
        ):
            blockers.append(
                "max_risk_pct must be explicitly configured between 0 and 100"
            )
        if (
            policy["max_risk_amount"] is None
            or not math.isfinite(policy["max_risk_amount"])
            or policy["max_risk_amount"] <= 0
        ):
            blockers.append("max_risk_amount must be explicitly configured above zero")
        if policy["max_positions"] is None or policy["max_positions"] < 1:
            blockers.append("max_positions must be explicitly configured above zero")

        normalized_actions = policy["allowed_actions"]
        if normalized_actions is None:
            blockers.append("allowed live actions contain malformed values")
            actions = set()
        else:
            actions = set(normalized_actions)
        unknown_actions = sorted(actions - ALLOWED_ACTIONS)
        if not actions:
            blockers.append("allowed live actions are not configured")
        if unknown_actions:
            blockers.append("unsupported live actions: " + ", ".join(unknown_actions))
        normalized_symbols = policy["allowed_symbols"]
        if normalized_symbols is None:
            blockers.append("allowed_symbols contains malformed values")
            symbols = ()
        else:
            symbols = normalized_symbols
        invalid_symbols = [symbol for symbol in symbols if not _valid_symbol_token(symbol)]
        if invalid_symbols:
            blockers.append("allowed_symbols contains invalid broker symbol tokens")
        if not symbols:
            blockers.append("allowed_symbols must be explicitly configured")

        account = {}
        terminal = {}
        positions = []
        protocol_version = 0
        connected = False
        context_loaded = False
        try:
            context = self._success(
                self.fetcher.get_execution_context(), "MT5 execution context"
            )
            context_loaded = True
            protocol_version = int(context.get("protocol_version") or 0)
            account = dict(context.get("account") or {})
            terminal = dict(context.get("terminal") or {})
            connected = bool(terminal.get("connected"))
            positions_response = self._success(
                self.fetcher.get_positions_result(), "MT5 positions"
            )
            if "positions" not in positions_response:
                raise ConnectionError("MT5 positions response is missing positions")
            raw_positions = positions_response["positions"]
            if not isinstance(raw_positions, list):
                raise ConnectionError("MT5 positions returned an invalid positions list")
            positions = list(raw_positions)
            for symbol in symbols:
                symbol_response = self._success(
                    self.fetcher.get_symbol_info(symbol),
                    f"MT5 symbol scope {symbol}",
                )
                symbol_info = symbol_response.get("symbol")
                if not isinstance(symbol_info, dict) or not symbol_info:
                    raise ConnectionError(
                        f"MT5 symbol scope {symbol} returned an invalid contract"
                    )
        except (ConnectionError, OSError, TimeoutError, ValueError) as exc:
            blockers.append(str(exc))

        if context_loaded and protocol_version < 2:
            blockers.append("MT5 gateway protocol v2 or newer is required")

        actual_mode = str(account.get("trade_mode") or "").strip().lower()
        if account and actual_mode not in {"real", "live"}:
            blockers.append("connected MT5 account is not a live/real account")
        actual_account_id = str(account.get("login") or "")
        actual_server = str(account.get("server") or "")
        if (
            policy["expected_account_id"]
            and actual_account_id != policy["expected_account_id"]
        ):
            blockers.append(
                "connected MT5 account_id does not match the approved account"
            )
        if policy["expected_server"] and actual_server != policy["expected_server"]:
            blockers.append("connected MT5 server does not match the approved server")
        if account and not bool(account.get("trade_allowed")):
            blockers.append("MT5 account does not currently allow trading")
        if account and not bool(account.get("trade_expert")):
            blockers.append("MT5 account does not currently allow expert trading")
        if context_loaded and not terminal:
            blockers.append("MT5 terminal state is missing")
        elif terminal:
            if not connected:
                blockers.append("MT5 terminal is disconnected")
            if not bool(terminal.get("trade_allowed")):
                blockers.append("MT5 terminal trading is disabled")
            if not bool(terminal.get("mql_trade_allowed")):
                blockers.append("MT5 MQL trading is disabled")
        if (
            "place_market" in actions
            and policy["max_positions"] is not None
            and policy["max_positions"] > 0
        ):
            if len(positions) >= policy["max_positions"]:
                blockers.append(
                    "current position count has reached the approved max_positions"
                )

        unknown_requests = journal.list_unknown(mode="live")
        if unknown_requests:
            blockers.append(
                "unreconciled live execution requests remain in the durable journal"
            )

        return {
            "phase": "P5A",
            "probe": self.probe_name,
            "read_only": True,
            "execution_enabled": False,
            "ready_for_live_gate": not blockers,
            "blockers": blockers,
            "protocol_version": protocol_version,
            "connection": {"connected": connected},
            "account": {
                "account_id": actual_account_id,
                "server": actual_server,
                "mode": actual_mode,
                "currency": account.get("currency"),
                "company": account.get("company"),
            },
            "positions": positions,
            "unknown_live_requests": unknown_requests,
            "policy": policy,
        }
