import tempfile
import time
import unittest
from pathlib import Path

from execution_service import ExecutionRiskDenied, ExecutionService
from execution_store import ExecutionJournal
from mt5_demo_broker import MT5SocketDemoAdapter


class FakeMT5Fetcher:
    def __init__(self, *, trade_mode="demo"):
        self.trade_mode = trade_mode
        self.login = 123456
        self.server = "Broker-Demo"
        self.connected = True
        self.place_calls = []
        self.close_calls = []
        self.lookup_calls = []

    def get_execution_context(self):
        return {
            "success": True,
            "protocol_version": 2,
            "account": {
                "login": self.login,
                "server": self.server,
                "company": "Broker",
                "currency": "USD",
                "trade_mode": self.trade_mode,
                "trade_allowed": True,
                "trade_expert": True,
            },
            "terminal": {
                "connected": self.connected,
                "trade_allowed": True,
                "mql_trade_allowed": True,
            },
        }

    def get_account_result(self):
        return {
            "success": True,
            "account": {
                "currency": "USD",
                "balance": 10000.0,
                "equity": 10010.0,
                "margin": 50.0,
                "free_margin": 9960.0,
            },
        }

    def get_price_result(self, symbol):
        now = int(time.time())
        return {
            "success": True,
            "price": {
                "bid": 1.1000,
                "ask": 1.1002,
                "time": now,
                "time_msc": now * 1000,
                "server_time": now,
            },
        }

    def get_symbol_info(self, symbol):
        return {
            "success": True,
            "symbol": {
                "trade_allowed": True,
                "filling_mode": 1,
                "execution_mode": 2,
                "tick_size": 0.0001,
                "tick_value": 10.0,
                "volume_step": 0.01,
                "volume_min": 0.01,
                "volume_max": 100.0,
                "stops_level": 0,
            },
        }

    def get_positions_result(self):
        return {"success": True, "positions": []}

    def place_order(self, symbol, side, volume, stop_loss, take_profit, *, request_id):
        self.place_calls.append(request_id)
        return {
            "success": True,
            "status": "accepted",
            "order_id": 11,
            "deal_id": 12,
            "position_id": 13,
            "price": 1.1002,
            "retcode": 10009,
        }

    def close_position(self, position_id, *, request_id):
        self.close_calls.append(request_id)
        return {
            "success": True,
            "status": "closed",
            "order_id": 21,
            "deal_id": 22,
            "position_id": position_id,
            "price": 1.1000,
            "retcode": 10009,
        }

    def lookup_request(self, request_id):
        self.lookup_calls.append(request_id)
        return {
            "success": True,
            "found": True,
            "status": "accepted",
            "order_id": 11,
            "deal_id": 12,
            "position_id": 13,
            "source": "deal",
        }

    def drop_client_connection(self):
        self.connected = False

    def wait_for_connection(self, timeout):
        self.connected = True
        return True


class MT5SocketDemoAdapterTests(unittest.TestCase):
    def test_refuses_non_demo_account_at_bind_time(self):
        with self.assertRaises(RuntimeError):
            MT5SocketDemoAdapter(FakeMT5Fetcher(trade_mode="real"))

    def test_bind_timeout_starts_degraded_and_recovers_when_ea_connects(self):
        class DeferredFetcher(FakeMT5Fetcher):
            def __init__(self):
                super().__init__()
                self.online = False

            def wait_for_connection(self, timeout):
                return self.online

            def get_execution_context(self):
                if not self.online:
                    return {
                        "success": False,
                        "message": "No active connection from MT5 Expert Advisor.",
                    }
                return super().get_execution_context()

        fetcher = DeferredFetcher()
        adapter = MT5SocketDemoAdapter(fetcher, connect_timeout=0.01)
        with tempfile.TemporaryDirectory() as temp_dir:
            service = ExecutionService(
                adapter, ExecutionJournal(Path(temp_dir) / "execution.sqlite3")
            )
            state = service.snapshot()
            self.assertFalse(state["connection"]["connected"])
            self.assertFalse(state["capabilities"]["place_market"])
            self.assertEqual(state["account"]["account_id"], "")

            fetcher.online = True
            recovered = service.snapshot()
            self.assertTrue(recovered["connection"]["connected"])
            self.assertEqual(recovered["account"]["account_id"], "123456")
            self.assertEqual(adapter.server_id, "Broker-Demo")

    def test_context_transport_drop_after_wait_starts_degraded(self):
        class RaceFetcher(FakeMT5Fetcher):
            def wait_for_connection(self, timeout):
                return True

            def get_execution_context(self):
                return {
                    "success": False,
                    "message": "Connection with MT5 Expert Advisor was disconnected abruptly.",
                }

        adapter = MT5SocketDemoAdapter(RaceFetcher(), connect_timeout=0.01)
        self.assertEqual(adapter.account_id, "")
        self.assertFalse(adapter.connection_snapshot()["connected"])
        self.assertFalse(adapter.capabilities_snapshot()["request_lookup"])

    def test_identity_capabilities_and_contract_are_demo_bound(self):
        adapter = MT5SocketDemoAdapter(FakeMT5Fetcher())
        self.assertEqual(adapter.account_id, "123456")
        self.assertEqual(adapter.server_id, "Broker-Demo")
        self.assertEqual(adapter.identity_snapshot()["mode"], "demo")
        self.assertTrue(adapter.connection_snapshot()["connected"])
        self.assertTrue(adapter.capabilities_snapshot()["place_market"])
        quote = adapter.quote_snapshot("EURUSD")
        self.assertEqual(quote["contract"]["min_volume"], 0.01)
        self.assertEqual(quote["contract"]["volume_step"], 0.01)
        self.assertEqual(quote["contract"]["filling_mode"], 1)
        self.assertEqual(quote["contract"]["execution_mode"], 2)

    def test_quote_uses_broker_tick_time_and_stale_tick_is_rejected(self):
        class OldTickFetcher(FakeMT5Fetcher):
            def get_price_result(self, symbol):
                server_now = int(time.time()) + 3 * 3600
                return {
                    "success": True,
                    "price": {
                        "bid": 1.1000,
                        "ask": 1.1002,
                        "time": server_now - 3600,
                        "time_msc": (server_now - 3600) * 1000,
                        "server_time": server_now,
                    },
                }

        adapter = MT5SocketDemoAdapter(OldTickFetcher())
        quote = adapter.quote_snapshot("EURUSD")
        self.assertGreater(adapter.now_ms() - quote["as_of_ms"], 3_500_000)
        with tempfile.TemporaryDirectory() as temp_dir:
            service = ExecutionService(
                adapter,
                ExecutionJournal(Path(temp_dir) / "execution.sqlite3"),
                freshness_ms=5000,
            )
            with self.assertRaises(ExecutionRiskDenied):
                service.preview(
                    {
                        "symbol": "EURUSD",
                        "side": "buy",
                        "volume": 0.01,
                        "stop_loss": 1.0950,
                        "take_profit": 1.1050,
                    }
                )

    def test_quote_freshness_uses_broker_clock_not_local_timezone(self):
        class OffsetBrokerClockFetcher(FakeMT5Fetcher):
            def get_price_result(self, symbol):
                broker_now = int(time.time()) + 3 * 3600
                return {
                    "success": True,
                    "price": {
                        "bid": 1.1000,
                        "ask": 1.1002,
                        "time": broker_now,
                        "time_msc": broker_now * 1000,
                        "server_time": broker_now,
                    },
                }

        adapter = MT5SocketDemoAdapter(OffsetBrokerClockFetcher())
        quote = adapter.quote_snapshot("EURUSD")
        self.assertLess(abs(adapter.now_ms() - quote["as_of_ms"]), 1500)
        with tempfile.TemporaryDirectory() as temp_dir:
            service = ExecutionService(
                adapter,
                ExecutionJournal(Path(temp_dir) / "execution.sqlite3"),
                freshness_ms=5000,
            )
            preview = service.preview(
                {
                    "symbol": "EURUSD",
                    "side": "buy",
                    "volume": 0.01,
                    "stop_loss": 1.0950,
                    "take_profit": 1.1050,
                }
            )
            self.assertTrue(preview["passed"])

    def test_request_id_is_mapped_to_short_safe_stable_broker_tag(self):
        fetcher = FakeMT5Fetcher()
        adapter = MT5SocketDemoAdapter(fetcher)
        request_id = "4f3113b0-62ca-4d43-a2e7-danger;newline\n"
        expected = adapter._broker_request_tag(request_id)
        self.assertTrue(expected.startswith("p4b-"))
        self.assertLessEqual(len(expected), 24)
        self.assertNotIn(";", expected)
        self.assertNotIn("\n", expected)

        order = {
            "symbol": "EURUSD",
            "side": "buy",
            "volume": 0.01,
            "stop_loss": 1.0950,
            "take_profit": 1.1050,
        }
        adapter.place(order, request_id)
        adapter.close("13", request_id)
        adapter.lookup_request(request_id)
        self.assertEqual(fetcher.place_calls, [expected])
        self.assertEqual(fetcher.close_calls, [expected])
        self.assertEqual(fetcher.lookup_calls, [expected])

    def test_adapter_preserves_partial_fill_fields_from_mt5(self):
        class PartialFillFetcher(FakeMT5Fetcher):
            def place_order(
                self, symbol, side, volume, stop_loss, take_profit, *, request_id
            ):
                self.place_calls.append(request_id)
                return {
                    "success": True,
                    "status": "partial",
                    "order_id": 31,
                    "deal_id": 32,
                    "position_id": 33,
                    "price": 1.1002,
                    "retcode": 10010,
                    "filled_volume": 0.01,
                    "remaining_volume": 0.01,
                }

        adapter = MT5SocketDemoAdapter(PartialFillFetcher())
        result = adapter.place(
            {
                "symbol": "EURUSD",
                "side": "buy",
                "volume": 0.02,
                "stop_loss": 1.0950,
                "take_profit": 1.1050,
            },
            "partial-adapter",
        )
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["retcode"], 10010)
        self.assertEqual(result["filled_volume"], 0.01)
        self.assertEqual(result["remaining_volume"], 0.01)

    def test_account_or_server_switch_is_denied_before_trade(self):
        fetcher = FakeMT5Fetcher()
        adapter = MT5SocketDemoAdapter(fetcher)
        fetcher.server = "Other-Demo"
        with self.assertRaises(PermissionError):
            adapter.place(
                {
                    "symbol": "EURUSD",
                    "side": "buy",
                    "volume": 0.01,
                    "stop_loss": 1.0950,
                    "take_profit": 1.1050,
                },
                "request-1",
            )
        self.assertEqual(fetcher.place_calls, [])

    def test_reconnect_revalidates_demo_identity(self):
        fetcher = FakeMT5Fetcher()
        adapter = MT5SocketDemoAdapter(fetcher)
        context = adapter.reconnect(timeout=0.1)
        self.assertTrue(context["terminal"]["connected"])
        fetcher.trade_mode = "real"
        with self.assertRaises(PermissionError):
            adapter.reconnect(timeout=0.1)


if __name__ == "__main__":
    unittest.main()
