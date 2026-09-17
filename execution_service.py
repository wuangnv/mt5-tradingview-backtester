"""P4 execution contract with deny-by-default mode/account/risk guards."""

import math
from dataclasses import dataclass

from execution_store import ExecutionIntentConflict, ExecutionJournal, fingerprint


class ExecutionError(RuntimeError):
    code = "EXECUTION_ERROR"


class ExecutionValidationError(ExecutionError):
    code = "EXECUTION_INVALID"


class ExecutionDenied(ExecutionError):
    code = "EXECUTION_DENIED"


class ExecutionRiskDenied(ExecutionDenied):
    code = "EXECUTION_RISK_DENIED"


class ExecutionUnknown(ExecutionError):
    code = "EXECUTION_UNKNOWN"


@dataclass(frozen=True)
class ExecutionContext:
    mode: str
    account_id: str
    request_id: str


def _finite_number(value, name, *, minimum=None):
    if isinstance(value, bool):
        raise ExecutionValidationError(f"{name} must be a finite number")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ExecutionValidationError(f"{name} must be a finite number") from exc
    if not math.isfinite(number):
        raise ExecutionValidationError(f"{name} must be a finite number")
    if minimum is not None and number < minimum:
        raise ExecutionValidationError(f"{name} must be at least {minimum}")
    return number


class ExecutionService:
    """Demo-only execution service. P4 intentionally refuses live mode."""

    def __init__(
        self,
        adapter,
        journal: ExecutionJournal,
        *,
        max_risk_pct=1.0,
        max_risk_amount=100.0,
        max_positions=3,
        freshness_ms=5000,
    ):
        self.adapter = adapter
        self.journal = journal
        self.max_risk_pct = float(max_risk_pct)
        self.max_risk_amount = float(max_risk_amount)
        self.max_positions = int(max_positions)
        self.freshness_ms = int(freshness_ms)

    def _guard(self, context: ExecutionContext):
        mode = str(context.mode).strip().lower()
        if mode != "demo":
            raise ExecutionDenied(f"execution disabled in {mode or 'unspecified'} mode")
        if not context.account_id or context.account_id != self.adapter.account_id:
            raise ExecutionDenied("explicit matching demo account_id is required")
        if not str(context.request_id).strip():
            raise ExecutionDenied("request_id is required")

    def _normalize_order(self, order):
        if not isinstance(order, dict):
            raise ExecutionValidationError("order must be an object")
        symbol = str(order.get("symbol") or "").strip().upper()
        if not symbol:
            raise ExecutionValidationError("order.symbol is required")
        side = str(order.get("side") or "").strip().lower()
        if side not in {"buy", "sell"}:
            raise ExecutionValidationError("order.side must be buy or sell")
        volume = _finite_number(order.get("volume"), "order.volume", minimum=0.0000001)
        stop_loss = _finite_number(order.get("stop_loss"), "order.stop_loss", minimum=0.0000001)
        take_profit = order.get("take_profit")
        if take_profit in (None, ""):
            take_profit = None
        else:
            take_profit = _finite_number(take_profit, "order.take_profit", minimum=0.0000001)
        return {
            "symbol": symbol,
            "side": side,
            "volume": volume,
            "stop_loss": stop_loss,
            "take_profit": take_profit,
        }

    def preview(self, order):
        order = self._normalize_order(order)
        account = self.adapter.account_snapshot()
        try:
            quote = self.adapter.quote_snapshot(order["symbol"])
        except (KeyError, ValueError) as exc:
            raise ExecutionValidationError(str(exc)) from exc
        now_ms = self.adapter.now_ms()

        for label, snapshot in (("account", account), ("quote", quote)):
            age_ms = now_ms - int(snapshot.get("as_of_ms", 0))
            if age_ms < 0 or age_ms > self.freshness_ms:
                raise ExecutionRiskDenied(f"{label} snapshot is stale")

        contract = quote["contract"]
        step = _finite_number(contract.get("volume_step"), "contract.volume_step", minimum=0.0000001)
        min_volume = _finite_number(contract.get("min_volume"), "contract.min_volume", minimum=0.0000001)
        max_volume = _finite_number(contract.get("max_volume"), "contract.max_volume", minimum=min_volume)
        volume = order["volume"]
        if volume < min_volume or volume > max_volume:
            raise ExecutionRiskDenied("volume is outside symbol limits")
        units = round(volume / step)
        if not math.isclose(volume, units * step, rel_tol=0, abs_tol=1e-9):
            raise ExecutionRiskDenied("volume does not match symbol volume_step")

        entry = float(quote["ask"] if order["side"] == "buy" else quote["bid"])
        stop = order["stop_loss"]
        if order["side"] == "buy" and stop >= entry:
            raise ExecutionRiskDenied("buy stop_loss must be below the current ask")
        if order["side"] == "sell" and stop <= entry:
            raise ExecutionRiskDenied("sell stop_loss must be above the current bid")
        target = order["take_profit"]
        if target is not None and order["side"] == "buy" and target <= entry:
            raise ExecutionRiskDenied("buy take_profit must be above the current ask")
        if target is not None and order["side"] == "sell" and target >= entry:
            raise ExecutionRiskDenied("sell take_profit must be below the current bid")

        tick_size = _finite_number(contract.get("tick_size"), "contract.tick_size", minimum=0.0000001)
        tick_value = _finite_number(
            contract.get("tick_value_per_lot"),
            "contract.tick_value_per_lot",
            minimum=0.0000001,
        )
        stop_ticks = abs(entry - stop) / tick_size
        risk_amount = stop_ticks * tick_value * volume
        balance = _finite_number(account.get("balance"), "account.balance", minimum=0)
        risk_limit = min(self.max_risk_amount, balance * self.max_risk_pct / 100.0)
        positions = self.adapter.positions_snapshot()
        reasons = []
        if len(positions) >= self.max_positions:
            reasons.append("max_positions reached")
        if risk_amount > risk_limit + 1e-9:
            reasons.append("estimated stop risk exceeds configured limit")

        return {
            "passed": not reasons,
            "reasons": reasons,
            "order": order,
            "entry_price": entry,
            "estimated_stop_risk": round(risk_amount, 8),
            "risk_limit": round(risk_limit, 8),
            "risk_limit_pct": self.max_risk_pct,
            "account_as_of_ms": int(account["as_of_ms"]),
            "quote_as_of_ms": int(quote["as_of_ms"]),
            "position_count": len(positions),
        }

    def _run_once(self, context, operation, payload, callback):
        self._guard(context)
        request_fingerprint = fingerprint(payload)
        record, created = self.journal.prepare(
            context.request_id,
            context.mode,
            context.account_id,
            operation,
            request_fingerprint,
        )
        if not created:
            return record["response"] or {"status": "unknown", "request_id": context.request_id}

        try:
            result = callback()
        except Exception as exc:
            raise ExecutionUnknown(
                "adapter result is unknown; reconcile before retrying the same intent"
            ) from exc
        if not isinstance(result, dict):
            result = {"status": "unknown"}
        result = dict(result)
        result.setdefault("status", "unknown")
        result["request_id"] = context.request_id
        self.journal.finish(context.request_id, result)
        return result

    def place(self, context: ExecutionContext, order):
        self._guard(context)
        preview = self.preview(order)
        if not preview["passed"]:
            raise ExecutionRiskDenied("; ".join(preview["reasons"]))
        normalized = preview["order"]
        payload = {"order": normalized, "risk": {"entry_price": preview["entry_price"]}}
        return self._run_once(
            context,
            "place",
            payload,
            lambda: self.adapter.place(normalized, context.request_id),
        )

    def close(self, context: ExecutionContext, position_id):
        position_id = str(position_id or "").strip()
        if not position_id:
            raise ExecutionValidationError("position_id is required")
        return self._run_once(
            context,
            "close",
            {"position_id": position_id},
            lambda: self.adapter.close(position_id, context.request_id),
        )

    def reconcile(self, request_id):
        record = self.journal.get(str(request_id))
        if record is None:
            raise ExecutionValidationError("request_id was not found")
        if record["mode"] != "demo" or record["account_id"] != self.adapter.account_id:
            raise ExecutionDenied("request does not belong to the active demo account")
        result = self.adapter.lookup_request(record["request_id"])
        if result is None:
            result = {"status": "unknown", "request_id": record["request_id"]}
        else:
            result = dict(result)
            result.setdefault("status", "unknown")
            result["request_id"] = record["request_id"]
        return self.journal.finish(record["request_id"], result)["response"]

    def snapshot(self):
        return {
            "mode": "demo",
            "adapter": "local-simulator",
            "live_execution_enabled": False,
            "account": self.adapter.account_snapshot(),
            "positions": self.adapter.positions_snapshot(),
            "requests": self.journal.list_recent(50),
            "limits": {
                "max_risk_pct": self.max_risk_pct,
                "max_risk_amount": self.max_risk_amount,
                "max_positions": self.max_positions,
                "freshness_ms": self.freshness_ms,
            },
        }


__all__ = [
    "ExecutionContext",
    "ExecutionDenied",
    "ExecutionError",
    "ExecutionIntentConflict",
    "ExecutionRiskDenied",
    "ExecutionService",
    "ExecutionUnknown",
    "ExecutionValidationError",
]
