"""Strict MT5 demo adapter for the P4 execution contract."""

import hashlib
import time


class MT5SocketDemoAdapter:
    adapter_name = "mt5-demo-socket"

    def __init__(self, fetcher, *, connect_timeout=8.0):
        self.fetcher = fetcher
        wait_for_connection = getattr(fetcher, "wait_for_connection", None)
        if callable(wait_for_connection) and not wait_for_connection(connect_timeout):
            raise ConnectionError("MT5 EA did not connect to the local socket gateway")
        context = self._read_context(require_bound=False)
        account = context["account"]
        if str(account.get("trade_mode") or "").lower() != "demo":
            raise RuntimeError("P4B refuses non-demo MT5 accounts")
        self.account_id = str(account.get("login") or "")
        self.server_id = str(account.get("server") or "")
        self.account_mode = "demo"
        if not self.account_id or not self.server_id:
            raise RuntimeError("MT5 demo identity is incomplete")
        self._last_context = context

    @staticmethod
    def now_ms():
        return int(time.time() * 1000)

    @staticmethod
    def _broker_request_tag(request_id):
        """Map an arbitrary durable request id to a short broker-safe comment token."""
        digest = hashlib.sha256(str(request_id).encode("utf-8")).hexdigest()
        return f"p4b-{digest[:20]}"

    @staticmethod
    def _transport_failure(response):
        message = str(response.get("message") or "").lower()
        return any(
            token in message
            for token in (
                "no active connection",
                "disconnected",
                "timeout",
                "socket communication error",
            )
        )

    def _require_success(self, response, label):
        if not isinstance(response, dict):
            raise ConnectionError(f"{label} returned an invalid response")
        if response.get("success"):
            return response
        if self._transport_failure(response):
            raise ConnectionError(response.get("message") or f"{label} transport failed")
        raise ValueError(response.get("message") or f"{label} failed")

    def _read_context(self, *, require_bound=True):
        response = self._require_success(
            self.fetcher.get_execution_context(), "MT5 execution context"
        )
        if int(response.get("protocol_version") or 0) < 2:
            raise RuntimeError("MT5 gateway protocol v2 is required for P4B")
        account = response.get("account") or {}
        if require_bound:
            if str(account.get("trade_mode") or "").lower() != "demo":
                raise PermissionError("MT5 account switched out of demo mode")
            if str(account.get("login") or "") != self.account_id:
                raise PermissionError("MT5 account login changed after P4B binding")
            if str(account.get("server") or "") != self.server_id:
                raise PermissionError("MT5 account server changed after P4B binding")
        self._last_context = response
        return response

    def identity_snapshot(self):
        account = (self._last_context or {}).get("account") or {}
        return {
            "account_id": self.account_id,
            "server": self.server_id,
            "mode": self.account_mode,
            "currency": account.get("currency"),
            "company": account.get("company"),
        }

    def connection_snapshot(self):
        try:
            context = self._read_context()
        except Exception as exc:
            return {
                "connected": False,
                "transport": "mt5-socket",
                "message": str(exc),
            }
        terminal = context.get("terminal") or {}
        return {
            "connected": bool(terminal.get("connected")),
            "transport": "mt5-socket",
            "protocol_version": int(context.get("protocol_version") or 0),
        }

    def capabilities_snapshot(self):
        try:
            context = self._read_context()
        except Exception:
            return {
                "place_market": False,
                "close_position": False,
                "protective_sl_tp": False,
                "partial_fill_reporting": False,
                "request_lookup": False,
            }
        account = context.get("account") or {}
        terminal = context.get("terminal") or {}
        enabled = all(
            (
                account.get("trade_mode") == "demo",
                bool(account.get("trade_allowed")),
                bool(account.get("trade_expert")),
                bool(terminal.get("connected")),
                bool(terminal.get("trade_allowed")),
                bool(terminal.get("mql_trade_allowed")),
            )
        )
        return {
            "place_market": enabled,
            "close_position": enabled,
            "protective_sl_tp": enabled,
            "partial_fill_reporting": True,
            "request_lookup": True,
        }

    def account_snapshot(self):
        self._read_context()
        response = self._require_success(self.fetcher.get_account_result(), "MT5 account")
        account = response.get("account") or {}
        return {
            "account_id": self.account_id,
            "server": self.server_id,
            "mode": "demo",
            "currency": account.get("currency"),
            "balance": account.get("balance"),
            "equity": account.get("equity"),
            "margin": account.get("margin"),
            "free_margin": account.get("free_margin"),
            "as_of_ms": self.now_ms(),
        }

    def quote_snapshot(self, symbol):
        self._read_context()
        price_response = self._require_success(
            self.fetcher.get_price_result(symbol), "MT5 quote"
        )
        symbol_response = self._require_success(
            self.fetcher.get_symbol_info(symbol), "MT5 symbol contract"
        )
        price = price_response.get("price") or {}
        info = symbol_response.get("symbol") or {}
        if not info.get("trade_allowed"):
            raise ValueError(f"broker trading is disabled for {symbol}")
        return {
            "symbol": str(symbol).upper(),
            "bid": price.get("bid"),
            "ask": price.get("ask"),
            "contract": {
                "tick_size": info.get("tick_size"),
                "tick_value_per_lot": info.get("tick_value"),
                "volume_step": info.get("volume_step"),
                "min_volume": info.get("volume_min"),
                "max_volume": info.get("volume_max"),
                "stops_level": info.get("stops_level"),
            },
            "as_of_ms": self.now_ms(),
        }

    def positions_snapshot(self):
        self._read_context()
        response = self._require_success(
            self.fetcher.get_positions_result(), "MT5 positions"
        )
        positions = []
        for item in response.get("positions") or []:
            positions.append(
                {
                    "position_id": str(item.get("ticket")),
                    "symbol": item.get("symbol"),
                    "side": str(item.get("type") or "").lower(),
                    "volume": item.get("volume"),
                    "entry_price": item.get("price_open"),
                    "current_price": item.get("price_current"),
                    "stop_loss": item.get("sl"),
                    "take_profit": item.get("tp"),
                    "profit": item.get("profit"),
                    "swap": item.get("swap"),
                }
            )
        return positions

    def _trade_response(self, response):
        if not isinstance(response, dict):
            raise ConnectionError("MT5 trade returned an invalid response")
        if not response.get("success") and self._transport_failure(response):
            raise ConnectionError(response.get("message") or "MT5 trade transport failed")
        if not response.get("success"):
            return {
                "status": "rejected",
                "reason": response.get("message") or "broker rejected request",
                "retcode": response.get("retcode"),
            }
        result = {
            "status": response.get("status") or "accepted",
            "broker_order_id": str(response.get("order_id") or "") or None,
            "deal_id": str(response.get("deal_id") or "") or None,
            "position_id": str(response.get("position_id") or "") or None,
            "price": response.get("price"),
            "retcode": response.get("retcode"),
        }
        for key in ("filled_volume", "remaining_volume"):
            if key in response:
                result[key] = response[key]
        return result

    def place(self, order, request_id):
        self._read_context()
        broker_tag = self._broker_request_tag(request_id)
        response = self.fetcher.place_order(
            order["symbol"],
            order["side"],
            order["volume"],
            order["stop_loss"],
            order.get("take_profit") or 0.0,
            request_id=broker_tag,
        )
        return self._trade_response(response)

    def close(self, position_id, request_id):
        self._read_context()
        broker_tag = self._broker_request_tag(request_id)
        response = self.fetcher.close_position(position_id, request_id=broker_tag)
        return self._trade_response(response)

    def lookup_request(self, request_id):
        self._read_context()
        broker_tag = self._broker_request_tag(request_id)
        response = self._require_success(
            self.fetcher.lookup_request(broker_tag), "MT5 request lookup"
        )
        if not response.get("found"):
            return None
        return {
            "status": response.get("status") or "unknown",
            "broker_order_id": str(response.get("order_id") or "") or None,
            "deal_id": str(response.get("deal_id") or "") or None,
            "position_id": str(response.get("position_id") or "") or None,
            "volume": response.get("volume"),
            "price": response.get("price"),
            "source": response.get("source"),
        }

    def reconnect(self, timeout=12.0):
        self.fetcher.drop_client_connection()
        if not self.fetcher.wait_for_connection(timeout):
            raise ConnectionError("MT5 EA did not reconnect to the local socket gateway")
        return self._read_context()


__all__ = ["MT5SocketDemoAdapter"]
