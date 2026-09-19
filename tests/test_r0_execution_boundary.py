import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[1]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class R0ExecutionBoundaryTests(unittest.TestCase):
    def test_importing_mt5_data_does_not_start_transport_thread(self):
        with patch("threading.Thread") as thread_cls:
            module = load_module("mt5_data_r0_import_test", ROOT / "mt5_data.py")

        thread_cls.assert_not_called()
        self.assertIsNone(module.mt5_fetcher.server_thread)
        self.assertIsNone(module.mt5_fetcher.server_socket)

    def _load_legacy_app_with_isolated_dependencies(self):
        fetcher = Mock()
        fetcher.initialized = False
        fetcher.shutdown = Mock()

        mt5_module = types.ModuleType("mt5_data")
        mt5_module.mt5_fetcher = fetcher

        history_module = types.ModuleType("history_store")
        history_module.history_store = Mock()

        session_module = types.ModuleType("session_store")
        session_module.session_store = Mock()

        isolated = {
            "mt5_data": mt5_module,
            "history_store": history_module,
            "session_store": session_module,
        }
        with patch.dict(sys.modules, isolated):
            module = load_module("legacy_app_r0_test", ROOT / "app.py")
        module.app.config["TESTING"] = True
        return module, fetcher

    def test_legacy_place_and_close_are_retired_before_mt5_init(self):
        module, fetcher = self._load_legacy_app_with_isolated_dependencies()
        fetcher.initialize.side_effect = AssertionError("legacy write must not initialize MT5")
        fetcher.place_order.side_effect = AssertionError("legacy write must not place")
        fetcher.close_position.side_effect = AssertionError("legacy write must not close")
        client = module.app.test_client()

        requests = (
            ("/api/trade/place", None),
            ("/api/trade/place", {}),
            ("/api/trade/place", {"symbol": "EURUSD", "type": "BUY", "lots": 0.01}),
            ("/api/trade/close", None),
            ("/api/trade/close", {}),
            ("/api/trade/close", {"ticket": "123"}),
        )
        for path, body in requests:
            with self.subTest(path=path, body=body):
                response = client.post(path, json=body)
                self.assertEqual(response.status_code, 410)
                self.assertEqual(response.json["error"]["code"], "LEGACY_EXECUTION_DISABLED")

        fetcher.initialize.assert_not_called()
        fetcher.place_order.assert_not_called()
        fetcher.close_position.assert_not_called()

    def test_legacy_mutations_are_loopback_same_origin_only(self):
        module, fetcher = self._load_legacy_app_with_isolated_dependencies()
        client = module.app.test_client()

        remote = client.post(
            "/api/mode",
            json={"mode": "backtest"},
            environ_overrides={"REMOTE_ADDR": "192.168.1.50"},
        )
        self.assertEqual(remote.status_code, 403)
        self.assertEqual(remote.json["error"]["code"], "LOCAL_ONLY")

        cross_origin = client.post(
            "/api/mode",
            json={"mode": "backtest"},
            headers={"Origin": "https://example.com"},
        )
        self.assertEqual(cross_origin.status_code, 403)
        self.assertEqual(cross_origin.json["error"]["code"], "ORIGIN_DENIED")
        fetcher.initialize.assert_not_called()

    def test_gateway_source_is_demo_opt_in_and_request_id_guarded(self):
        source = (ROOT / "MT5Gateway.mq5").read_text(encoding="utf-8")
        self.assertIn("InpEnableDemoExecution", source)
        self.assertIn("InpExpectedDemoLogin", source)
        self.assertIn("InpExpectedDemoServer", source)
        self.assertIn("ACCOUNT_TRADE_MODE_DEMO", source)
        self.assertIn("EXECUTION_DISABLED", source)
        self.assertIn("request_id == \"\"", source)

    def test_legacy_server_default_is_loopback(self):
        source = (ROOT / "app.py").read_text(encoding="utf-8")
        self.assertNotIn("host='0.0.0.0'", source)
        self.assertIn("host='127.0.0.1'", source)

    def test_trade_desk_keeps_request_id_until_unknown_is_reconciled(self):
        source = (ROOT / "static" / "js" / "trade_desk.js").read_text(encoding="utf-8")
        self.assertIn("window.sessionStorage", source)
        self.assertIn("durableRequestId", source)
        self.assertIn("reconcileUnknown", source)
        self.assertIn("EXECUTION_INTENT_PENDING", source)
        self.assertEqual(source.count("request_id: requestId()"), 1)
        self.assertNotIn("request_id: requestId(),\n                    order:", source)

    def test_demo_rehearsal_requires_exact_identity_and_explicit_execute_flag(self):
        source = (ROOT / "p5b_demo_rehearsal.py").read_text(encoding="utf-8")
        self.assertIn('parser.add_argument("--expected-account-id", required=True)', source)
        self.assertIn('parser.add_argument("--expected-server", required=True)', source)
        self.assertIn('"--execute"', source)
        self.assertIn('action="store_true"', source)


if __name__ == "__main__":
    unittest.main()
