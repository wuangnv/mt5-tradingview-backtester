"""P4 execution contract with deny-by-default mode/account/risk guards."""

import math
import time
import uuid
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
    account_server: str
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
        if getattr(self.adapter, "account_mode", None) != "demo":
            raise ExecutionDenied("adapter account mode is not demo")
        if not context.account_server or context.account_server != getattr(
            self.adapter, "server_id", None
        ):
            raise ExecutionDenied("explicit matching demo account server is required")
        if not str(context.request_id).strip():
            raise ExecutionDenied("request_id is required")

    def _adapter_read(self, name, *args):
        try:
            return getattr(self.adapter, name)(*args)
        except (ConnectionError, TimeoutError, OSError) as exc:
            raise ExecutionUnknown("broker adapter is unavailable; reconcile before retrying") from exc

    def _require_capability(self, name):
        capabilities = self.adapter.capabilities_snapshot()
        if not capabilities.get(name):
            raise ExecutionDenied(f"broker capability {name} is unavailable")

    def _guard_new_order(self):
        control = self.journal.get_kill_switch()
        if control["block_new_orders"]:
            raise ExecutionDenied("kill switch blocks new orders")

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
        account = self._adapter_read("account_snapshot")
        try:
            quote = self._adapter_read("quote_snapshot", order["symbol"])
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
        positions = self._adapter_read("positions_snapshot")
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

    def _normalize_pending_order(self, order):
        normalized = self._normalize_order(order)
        order_type = str((order or {}).get("order_type") or "").strip().lower()
        if order_type not in {"limit", "stop"}:
            raise ExecutionValidationError("order.order_type must be limit or stop")
        trigger = _finite_number(
            (order or {}).get("trigger_price"), "order.trigger_price", minimum=0.0000001
        )
        normalized.update({"order_type": order_type, "trigger_price": trigger})
        return normalized

    def preview_pending(self, order):
        order = self._normalize_pending_order(order)
        quote = self._adapter_read("quote_snapshot", order["symbol"])
        current = float(quote["ask"] if order["side"] == "buy" else quote["bid"])
        trigger = order["trigger_price"]
        if order["side"] == "buy":
            if order["order_type"] == "limit" and trigger >= current:
                raise ExecutionRiskDenied("buy limit trigger must be below current ask")
            if order["order_type"] == "stop" and trigger <= current:
                raise ExecutionRiskDenied("buy stop trigger must be above current ask")
            if order["stop_loss"] >= trigger:
                raise ExecutionRiskDenied("buy stop_loss must be below pending trigger")
            if order["take_profit"] is not None and order["take_profit"] <= trigger:
                raise ExecutionRiskDenied("buy take_profit must be above pending trigger")
        else:
            if order["order_type"] == "limit" and trigger <= current:
                raise ExecutionRiskDenied("sell limit trigger must be above current bid")
            if order["order_type"] == "stop" and trigger >= current:
                raise ExecutionRiskDenied("sell stop trigger must be below current bid")
            if order["stop_loss"] <= trigger:
                raise ExecutionRiskDenied("sell stop_loss must be above pending trigger")
            if order["take_profit"] is not None and order["take_profit"] >= trigger:
                raise ExecutionRiskDenied("sell take_profit must be below pending trigger")

        account = self._adapter_read("account_snapshot")
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
        tick_size = _finite_number(contract.get("tick_size"), "contract.tick_size", minimum=0.0000001)
        tick_value = _finite_number(
            contract.get("tick_value_per_lot"), "contract.tick_value_per_lot", minimum=0.0000001
        )
        risk_amount = abs(trigger - order["stop_loss"]) / tick_size * tick_value * volume
        balance = _finite_number(account.get("balance"), "account.balance", minimum=0)
        risk_limit = min(self.max_risk_amount, balance * self.max_risk_pct / 100.0)
        positions = self._adapter_read("positions_snapshot")
        reasons = []
        if len(positions) >= self.max_positions:
            reasons.append("max_positions reached")
        if risk_amount > risk_limit + 1e-9:
            reasons.append("estimated stop risk exceeds configured limit")
        return {
            "passed": not reasons,
            "reasons": reasons,
            "order": order,
            "entry_price": trigger,
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
            context.account_server,
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

    def _existing_result(self, context, operation, payload):
        record = self.journal.find_matching(
            context.request_id,
            context.mode,
            context.account_id,
            context.account_server,
            operation,
            fingerprint(payload),
        )
        if record is None:
            return None
        return record["response"] or {"status": "unknown", "request_id": context.request_id}

    def place(self, context: ExecutionContext, order):
        self._guard(context)
        self._guard_new_order()
        normalized = self._normalize_order(order)
        payload = {"order": normalized}
        existing = self._existing_result(context, "place", payload)
        if existing is not None:
            return existing
        self._require_capability("place_market")
        preview = self.preview(normalized)
        if not preview["passed"]:
            raise ExecutionRiskDenied("; ".join(preview["reasons"]))
        return self._run_once(
            context,
            "place",
            payload,
            lambda: self.adapter.place(normalized, context.request_id),
        )

    def close(self, context: ExecutionContext, position_id):
        self._guard(context)
        position_id = str(position_id or "").strip()
        if not position_id:
            raise ExecutionValidationError("position_id is required")
        payload = {"position_id": position_id}
        existing = self._existing_result(context, "close", payload)
        if existing is not None:
            return existing
        self._require_capability("close_position")
        return self._run_once(
            context,
            "close",
            payload,
            lambda: self.adapter.close(position_id, context.request_id),
        )

    def place_pending(self, context: ExecutionContext, order):
        self._guard(context)
        self._guard_new_order()
        normalized = self._normalize_pending_order(order)
        payload = {"order": normalized}
        existing = self._existing_result(context, "place_pending", payload)
        if existing is not None:
            return existing
        self._require_capability("place_pending")
        preview = self.preview_pending(normalized)
        if not preview["passed"]:
            raise ExecutionRiskDenied("; ".join(preview["reasons"]))
        return self._run_once(
            context,
            "place_pending",
            payload,
            lambda: self.adapter.place_pending(normalized, context.request_id),
        )

    def cancel_pending(self, context: ExecutionContext, order_id):
        self._guard(context)
        order_id = str(order_id or "").strip()
        if not order_id:
            raise ExecutionValidationError("order_id is required")
        payload = {"order_id": order_id}
        existing = self._existing_result(context, "cancel_pending", payload)
        if existing is not None:
            return existing
        self._require_capability("cancel_pending")
        return self._run_once(
            context,
            "cancel_pending",
            payload,
            lambda: self.adapter.cancel_pending(order_id, context.request_id),
        )

    def modify_position(self, context: ExecutionContext, position_id, changes):
        self._guard(context)
        position_id = str(position_id or "").strip()
        if not position_id:
            raise ExecutionValidationError("position_id is required")
        if not isinstance(changes, dict):
            raise ExecutionValidationError("changes must be an object")
        normalized = {}
        for field in ("stop_loss", "take_profit"):
            if field in changes:
                value = changes[field]
                if field == "take_profit" and value in (None, ""):
                    normalized[field] = None
                else:
                    normalized[field] = _finite_number(value, f"changes.{field}", minimum=0.0000001)
        if not normalized:
            raise ExecutionValidationError("changes must include stop_loss or take_profit")
        positions = self._adapter_read("positions_snapshot")
        position = next((item for item in positions if str(item.get("position_id")) == position_id), None)
        if position is None:
            raise ExecutionValidationError("position_id was not found")
        quote = self._adapter_read("quote_snapshot", position["symbol"])
        if position["side"] == "buy":
            stop = normalized.get("stop_loss", position.get("stop_loss"))
            target = normalized.get("take_profit", position.get("take_profit"))
            if stop is not None and stop >= float(quote["bid"]):
                raise ExecutionRiskDenied("buy stop_loss must be below current bid")
            if target is not None and target <= float(quote["ask"]):
                raise ExecutionRiskDenied("buy take_profit must be above current ask")
        else:
            stop = normalized.get("stop_loss", position.get("stop_loss"))
            target = normalized.get("take_profit", position.get("take_profit"))
            if stop is not None and stop <= float(quote["ask"]):
                raise ExecutionRiskDenied("sell stop_loss must be above current ask")
            if target is not None and target >= float(quote["bid"]):
                raise ExecutionRiskDenied("sell take_profit must be below current bid")
        payload = {"position_id": position_id, "changes": normalized}
        existing = self._existing_result(context, "modify_position", payload)
        if existing is not None:
            return existing
        self._require_capability("modify_position")
        return self._run_once(
            context,
            "modify_position",
            payload,
            lambda: self.adapter.modify_position(position_id, normalized, context.request_id),
        )

    def partial_close(self, context: ExecutionContext, position_id, volume):
        self._guard(context)
        position_id = str(position_id or "").strip()
        if not position_id:
            raise ExecutionValidationError("position_id is required")
        volume = _finite_number(volume, "volume", minimum=0.0000001)
        positions = self._adapter_read("positions_snapshot")
        position = next((item for item in positions if str(item.get("position_id")) == position_id), None)
        if position is None:
            raise ExecutionValidationError("position_id was not found")
        quote = self._adapter_read("quote_snapshot", position["symbol"])
        step = _finite_number(quote["contract"].get("volume_step"), "contract.volume_step", minimum=0.0000001)
        units = round(volume / step)
        if not math.isclose(volume, units * step, rel_tol=0, abs_tol=1e-9):
            raise ExecutionRiskDenied("partial close volume does not match symbol volume_step")
        if volume >= float(position["volume"]):
            raise ExecutionRiskDenied("partial close volume must be below current position volume")
        payload = {"position_id": position_id, "volume": volume}
        existing = self._existing_result(context, "partial_close", payload)
        if existing is not None:
            return existing
        self._require_capability("partial_close")
        return self._run_once(
            context,
            "partial_close",
            payload,
            lambda: self.adapter.partial_close(position_id, volume, context.request_id),
        )

    def reconcile(self, request_id):
        record = self.journal.get(str(request_id))
        if record is None:
            raise ExecutionValidationError("request_id was not found")
        if (
            record["mode"] != "demo"
            or record["account_id"] != self.adapter.account_id
            or record["account_server"] != getattr(self.adapter, "server_id", None)
        ):
            raise ExecutionDenied("request does not belong to the active demo account")
        if record["response"] is not None and record["status"] != "unknown":
            return record["response"]
        self._require_capability("request_lookup")
        result = self._adapter_read("lookup_request", record["request_id"])
        if result is None:
            result = {"status": "unknown", "request_id": record["request_id"]}
        else:
            result = dict(result)
            result.setdefault("status", "unknown")
            result["request_id"] = record["request_id"]
        return self.journal.finish(record["request_id"], result)["response"]

    def set_kill_switch(self, enabled, reason=""):
        try:
            return self.journal.set_kill_switch(enabled, reason)
        except Exception as exc:
            if isinstance(exc, ExecutionError):
                raise
            raise ExecutionValidationError(str(exc)) from exc

    def create_alert(self, kind, rule, expires_at_ms=None, alert_id=None):
        kind = str(kind or "").strip().lower()
        if kind not in {"price", "news", "disconnect", "risk"}:
            raise ExecutionValidationError("alert kind must be price, news, disconnect or risk")
        if not isinstance(rule, dict):
            raise ExecutionValidationError("alert rule must be an object")
        if kind == "price":
            symbol = str(rule.get("symbol") or "").strip().upper()
            above = rule.get("above")
            below = rule.get("below")
            if not symbol or (above in (None, "") and below in (None, "")):
                raise ExecutionValidationError("price alert requires symbol and above or below")
            normalized = {"symbol": symbol}
            if above not in (None, ""):
                normalized["above"] = _finite_number(above, "rule.above")
            if below not in (None, ""):
                normalized["below"] = _finite_number(below, "rule.below")
            rule = normalized
        elif kind == "risk":
            max_positions = rule.get("max_positions")
            if max_positions in (None, ""):
                raise ExecutionValidationError("risk alert requires max_positions")
            try:
                max_positions = int(max_positions)
            except (TypeError, ValueError) as exc:
                raise ExecutionValidationError("rule.max_positions must be an integer") from exc
            if max_positions < 0:
                raise ExecutionValidationError("rule.max_positions must be non-negative")
            rule = {"max_positions": max_positions}
        elif kind == "disconnect":
            rule = {}
        else:
            rule = {key: value for key, value in rule.items() if key in {"currency", "impact"}}

        alert_id = str(alert_id or uuid.uuid4())
        try:
            return self.journal.create_alert(alert_id, kind, rule, expires_at_ms)
        except Exception as exc:
            raise ExecutionValidationError(str(exc)) from exc

    def acknowledge_alert(self, alert_id):
        try:
            return self.journal.acknowledge_alert(alert_id)
        except Exception as exc:
            raise ExecutionValidationError(str(exc)) from exc

    def _alert_states(self, connection, positions):
        now_ms = int(time.time() * 1000)
        states = []
        for alert in self.journal.list_alerts(100):
            item = dict(alert)
            if alert["status"] == "acknowledged":
                item["evaluation"] = "acknowledged"
            elif alert["expires_at_ms"] is not None and now_ms >= int(alert["expires_at_ms"]):
                item["evaluation"] = "expired"
            elif alert["kind"] == "disconnect":
                item["evaluation"] = "triggered" if not connection.get("connected") else "clear"
            elif alert["kind"] == "risk":
                item["evaluation"] = (
                    "triggered"
                    if len(positions) >= int(alert["rule"]["max_positions"])
                    else "clear"
                )
            elif alert["kind"] == "price":
                if not connection.get("connected"):
                    item["evaluation"] = "blocked_by_connection"
                else:
                    try:
                        quote = self._adapter_read("quote_snapshot", alert["rule"]["symbol"])
                        midpoint = (float(quote["bid"]) + float(quote["ask"])) / 2.0
                        triggered = False
                        if "above" in alert["rule"] and midpoint >= float(alert["rule"]["above"]):
                            triggered = True
                        if "below" in alert["rule"] and midpoint <= float(alert["rule"]["below"]):
                            triggered = True
                        item["evaluation"] = "triggered" if triggered else "clear"
                        item["observed_mid"] = midpoint
                    except (ExecutionError, KeyError, ValueError, TypeError):
                        item["evaluation"] = "blocked_by_data"
            else:
                item["evaluation"] = "blocked_by_capability"
            states.append(item)
        return states

    def snapshot(self):
        connection = self.adapter.connection_snapshot()
        capabilities = self.adapter.capabilities_snapshot()
        identity = self.adapter.identity_snapshot()
        if connection.get("connected"):
            try:
                account = self._adapter_read("account_snapshot")
                positions = self._adapter_read("positions_snapshot")
                pending_orders = (
                    self._adapter_read("pending_orders_snapshot")
                    if hasattr(self.adapter, "pending_orders_snapshot")
                    else []
                )
            except ExecutionUnknown as exc:
                connection = dict(connection)
                connection["connected"] = False
                connection["message"] = str(exc)
                capabilities = {key: False for key in capabilities}
                account = dict(identity)
                account.update({"balance": None, "equity": None, "as_of_ms": None})
                positions = []
                pending_orders = []
        else:
            account = dict(identity)
            account.update({"balance": None, "equity": None, "as_of_ms": None})
            positions = []
            pending_orders = []
        return {
            "mode": "demo",
            "adapter": getattr(self.adapter, "adapter_name", "unknown"),
            "live_execution_enabled": False,
            "connection": connection,
            "capabilities": capabilities,
            "account": account,
            "positions": positions,
            "pending_orders": pending_orders,
            "requests": self.journal.list_recent(50),
            "kill_switch": {
                **self.journal.get_kill_switch(),
                "cancel_pending": "explicit_confirmed_action_required",
                "close_positions": "explicit_confirmed_action_required",
            },
            "alerts": self._alert_states(connection, positions),
            "alert_runtime": "in_app_poll_only",
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
