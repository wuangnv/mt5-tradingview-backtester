import importlib.util
import socket
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch


class MT5DataFetcherTransportTests(unittest.TestCase):
    def test_check_order_uses_read_only_gateway_command(self):
        module_path = Path(__file__).resolve().parents[1] / "mt5_data.py"
        spec = importlib.util.spec_from_file_location("mt5_data_check_test", module_path)
        module = importlib.util.module_from_spec(spec)
        with patch("threading.Thread"):
            spec.loader.exec_module(module)

        fetcher = object.__new__(module.MT5DataFetcher)
        calls = []

        def fake_send(command, timeout):
            calls.append((command, timeout))
            return {"success": True, "check": {"checked": False}}

        fetcher._send_request = fake_send
        result = fetcher.check_order("EURUSD", "buy", 0.01, 1.09, 0.0)

        self.assertTrue(result["success"])
        self.assertEqual(calls, [("CHECK_ORDER;BUY;EURUSD;0.01;1.09;0.0", 8.0)])

    def test_timeout_discards_socket_so_late_response_cannot_poison_next_request(self):
        module_path = Path(__file__).resolve().parents[1] / "mt5_data.py"
        spec = importlib.util.spec_from_file_location("mt5_data_transport_test", module_path)
        module = importlib.util.module_from_spec(spec)
        with patch("threading.Thread"):
            spec.loader.exec_module(module)

        client, peer = socket.socketpair()
        fetcher = object.__new__(module.MT5DataFetcher)
        fetcher.client_socket = client
        fetcher.initialized = True
        fetcher.lock = threading.Lock()

        def late_response():
            try:
                peer.recv(4096)
                time.sleep(0.08)
                peer.sendall(b'{"success":true,"marker":"late-first"}\n')
            except OSError:
                pass

        worker = threading.Thread(target=late_response, daemon=True)
        worker.start()
        try:
            first = fetcher._send_request("FIRST", timeout=0.02)
            self.assertFalse(first["success"])
            self.assertIn("timeout", first["message"].lower())
            self.assertIsNone(fetcher.client_socket)
            self.assertFalse(fetcher.initialized)

            second = fetcher._send_request("SECOND", timeout=0.02)
            self.assertFalse(second["success"])
            self.assertIn("no active connection", second["message"].lower())
        finally:
            try:
                client.close()
            except OSError:
                pass
            peer.close()
            worker.join(timeout=1)


if __name__ == "__main__":
    unittest.main()
