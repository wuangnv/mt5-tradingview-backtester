import unittest

from p5c_live_check import LiveCheckError, run_live_check


class FakeLiveCheckFetcher:
    def __init__(self, *, mode="real", account_id="live-1", server="Broker-Real"):
        self.mode = mode
        self.account_id = account_id
        self.server = server
        self.positions = []
        self.check_calls = []

    def get_execution_context(self):
        return {
            "success": True,
            "protocol_version": 3,
            "account": {
                "login": self.account_id,
                "server": self.server,
                "company": "Broker",
                "currency": "USD",
                "trade_mode": self.mode,
                "trade_allowed": True,
                "trade_expert": True,
            },
            "terminal": {
                "connected": True,
                "trade_allowed": True,
                "mql_trade_allowed": True,
            },
        }

    def get_account_result(self):
        return {
            "success": True,
            "account": {"balance": 0.0, "equity": 0.0},
        }

    def get_positions_result(self):
        return {"success": True, "positions": list(self.positions)}

    def get_symbol_info(self, symbol):
        return {
            "success": True,
            "symbol": {
                "name": symbol,
                "trade_allowed": True,
                "digits": 5,
                "stops_level": 0,
                "tick_size": 0.00001,
                "point": 0.00001,
                "volume_min": 0.01,
            },
        }

    def get_price_result(self, symbol):
        return {
            "success": True,
            "price": {"symbol": symbol, "bid": 1.10000, "ask": 1.10002},
        }

    def check_order(self, symbol, side, volume, sl, tp):
        self.check_calls.append((symbol, side, volume, sl, tp))
        return {
            "success": True,
            "check": {
                "checked": False,
                "retcode": 10019,
                "last_error": 0,
                "balance": 0.0,
                "equity": 0.0,
                "profit": 0.0,
                "margin": 0.0,
                "margin_free": 0.0,
                "margin_level": 0.0,
                "comment": "No money",
            },
        }


class P5CLiveCheckTests(unittest.TestCase):
    def test_zero_balance_broker_rejection_is_valid_check_only_evidence(self):
        fetcher = FakeLiveCheckFetcher()
        result = run_live_check(
            fetcher,
            expected_account_id="live-1",
            expected_server="Broker-Real",
        )

        self.assertFalse(result["live_execution_enabled"])
        self.assertFalse(result["order_send_used"])
        self.assertTrue(result["positions_unchanged"])
        self.assertFalse(result["broker_check"]["checked"])
        self.assertEqual(result["broker_check"]["retcode"], 10019)
        self.assertEqual(len(fetcher.check_calls), 1)

    def test_demo_account_is_blocked_before_order_check(self):
        fetcher = FakeLiveCheckFetcher(mode="demo")
        with self.assertRaisesRegex(LiveCheckError, "not live/real"):
            run_live_check(fetcher)
        self.assertEqual(fetcher.check_calls, [])

    def test_wrong_identity_is_blocked_before_order_check(self):
        fetcher = FakeLiveCheckFetcher()
        with self.assertRaisesRegex(LiveCheckError, "account id"):
            run_live_check(fetcher, expected_account_id="other")
        self.assertEqual(fetcher.check_calls, [])

    def test_position_change_during_order_check_fails_closed(self):
        class MutatingFetcher(FakeLiveCheckFetcher):
            def check_order(self, symbol, side, volume, sl, tp):
                response = super().check_order(symbol, side, volume, sl, tp)
                self.positions.append({"ticket": 42, "symbol": symbol})
                return response

        with self.assertRaisesRegex(LiveCheckError, "positions changed"):
            run_live_check(MutatingFetcher())


if __name__ == "__main__":
    unittest.main()
