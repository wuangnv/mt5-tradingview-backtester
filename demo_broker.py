"""Deterministic local demo broker used by P4 before any MT5 demo permission."""

import time


class DemoBrokerSimulator:
    def __init__(self, account_id="demo-sim-1", balance=10000.0):
        self.account_id = str(account_id)
        self.balance = float(balance)
        self._positions = {}
        self._results = {}
        self._calls = []
        self._next_position = 1
        self.next_status = "accepted"
        self._quotes = {
            "EURUSD": {
                "bid": 1.1000,
                "ask": 1.1002,
                "contract": {
                    "tick_size": 0.0001,
                    "tick_value_per_lot": 10.0,
                    "volume_step": 0.01,
                    "min_volume": 0.01,
                    "max_volume": 2.0,
                },
            }
        }

    @staticmethod
    def now_ms():
        return int(time.time() * 1000)

    @property
    def calls(self):
        return list(self._calls)

    def account_snapshot(self):
        return {
            "account_id": self.account_id,
            "server": "LOCAL-SIM",
            "mode": "demo",
            "currency": "USD",
            "balance": self.balance,
            "equity": self.balance,
            "as_of_ms": self.now_ms(),
        }

    def quote_snapshot(self, symbol):
        symbol = str(symbol).upper()
        if symbol not in self._quotes:
            raise ValueError(f"unsupported simulator symbol {symbol}")
        quote = self._quotes[symbol]
        return {
            "symbol": symbol,
            "bid": quote["bid"],
            "ask": quote["ask"],
            "contract": dict(quote["contract"]),
            "as_of_ms": self.now_ms(),
        }

    def positions_snapshot(self):
        return [dict(value) for value in self._positions.values()]

    def place(self, order, request_id):
        self._calls.append(("place", str(request_id), dict(order)))
        if self.next_status != "accepted":
            result = {"status": self.next_status, "broker_order_id": None}
            self._results[str(request_id)] = dict(result)
            return result

        quote = self.quote_snapshot(order["symbol"])
        fill_price = quote["ask"] if order["side"] == "buy" else quote["bid"]
        position_id = f"sim-pos-{self._next_position}"
        self._next_position += 1
        position = {
            "position_id": position_id,
            "symbol": order["symbol"],
            "side": order["side"],
            "volume": order["volume"],
            "entry_price": fill_price,
            "stop_loss": order["stop_loss"],
            "take_profit": order["take_profit"],
        }
        self._positions[position_id] = position
        result = {
            "status": "accepted",
            "broker_order_id": f"sim-order-{position_id}",
            "position": dict(position),
        }
        self._results[str(request_id)] = dict(result)
        return result

    def close(self, position_id, request_id):
        self._calls.append(("close", str(request_id), str(position_id)))
        if self.next_status != "accepted":
            result = {"status": self.next_status, "broker_order_id": None}
            self._results[str(request_id)] = dict(result)
            return result
        position = self._positions.pop(str(position_id), None)
        if position is None:
            result = {"status": "rejected", "reason": "position not found"}
        else:
            result = {"status": "closed", "position_id": str(position_id)}
        self._results[str(request_id)] = dict(result)
        return result

    def lookup_request(self, request_id):
        result = self._results.get(str(request_id))
        return dict(result) if result is not None else None

    def set_result(self, request_id, result):
        self._results[str(request_id)] = dict(result)
