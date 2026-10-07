from __future__ import annotations

import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trading_workspace_v2.dukascopy_catalog import DukascopyCatalog, MAX_BYTES, normalize_instruments

PAYLOAD = [{"id": 1, "name": "EUR/USD", "nameLong": "Euro / US Dollar", "extra_secret": "do-not-store"}]


class DukascopyCatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "catalog.json"
        self.addCleanup(self.temp.cleanup)
        self.calls = []

    def provider(self, status=200, payload=PAYLOAD):
        def handler(request):
            self.calls.append(request)
            self.assertEqual(request.url.host, "freeserv.dukascopy.com")
            self.assertEqual(request.url.params["path"], "api/instrumentList")
            self.assertEqual(request.url.params["key"], "test-key-only")
            return httpx.Response(status, json=payload)
        client = httpx.Client(transport=httpx.MockTransport(handler))
        self.addCleanup(client.close)
        return DukascopyCatalog(self.path, "test-key-only", client=client)

    def test_missing_key_and_reads_never_touch_network_or_disk(self):
        provider = DukascopyCatalog(self.path)
        self.assertFalse(provider.status()["configured"])
        self.assertEqual(provider.list_instruments("a"), [])
        provider.refresh()
        self.assertEqual(provider.status()["error"], "missing_key")
        self.assertFalse(self.path.exists())

    def test_success_survives_restart_without_key_and_does_not_claim_downloads(self):
        provider = self.provider()
        provider.refresh()
        self.assertEqual(len(self.calls), 1)
        data = self.path.read_text()
        self.assertNotIn("test-key-only", data)
        self.assertNotIn("extra_secret", data)
        self.assertNotIn("do-not-store", data)
        restarted = DukascopyCatalog(self.path)
        self.assertEqual(restarted.status()["status"], "cached")
        self.assertFalse(restarted.status()["configured"])
        self.assertEqual(restarted.list_instruments("a"), provider.list_instruments("a"))
        self.assertEqual(restarted.list_datasets("a"), [])
        self.assertFalse(restarted.capabilities["read_history"])
        self.assertFalse(restarted.capabilities["fresh_quote"])
        self.assertEqual(restarted.list_instruments("a")[0]["asset_class"], "")

    def test_failed_refresh_preserves_last_valid_file_and_rows(self):
        self.provider().refresh()
        before = self.path.read_bytes()
        for status, payload, reason in [(429, {}, "rate_limited"), (403, {}, "key_rejected"),
                                       (500, {}, "source_unavailable"), (200, [], "invalid_response"),
                                       (200, [{"name": "EUR/USD"}, {"name": "EUR/USD"}], "invalid_response")]:
            with self.subTest(status=status, reason=reason):
                provider = self.provider(status, payload)
                provider.refresh()
                self.assertEqual(provider.status()["error"], reason)
                self.assertEqual(provider.status()["status"], "cached")
                self.assertEqual(self.path.read_bytes(), before)
                self.assertEqual(len(provider.list_instruments("a")), 1)
                provider.refresh()
                self.assertFalse(provider.status()["refresh_available"])

    def test_refresh_cooldown_prevents_duplicate_upstream_requests(self):
        provider = self.provider()
        provider.refresh()
        provider.refresh()
        provider.list_instruments("a")
        provider.status()
        self.assertEqual(len(self.calls), 1)
        self.assertGreater(provider.status()["retry_after_seconds"], 0)

    def test_corrupt_or_tampered_cache_fails_closed(self):
        self.path.write_text("broken")
        self.assertEqual(DukascopyCatalog(self.path).status()["error"], "invalid_cache")
        self.provider().refresh()
        snapshot = json.loads(self.path.read_text())
        snapshot["raw_instruments"][0]["name"] = "GBP/USD"
        self.path.write_text(json.dumps(snapshot))
        provider = DukascopyCatalog(self.path)
        self.assertEqual(provider.list_instruments("a"), [])
        self.assertEqual(provider.status()["error"], "invalid_cache")

    def test_stale_cache_is_retained_without_automatic_network(self):
        self.provider().refresh()
        snapshot = json.loads(self.path.read_text())
        snapshot["retrieved_at_utc"] = "2020-01-01T00:00:00+00:00"
        self.path.write_text(json.dumps(snapshot))
        provider = self.provider()
        self.assertTrue(provider.status()["stale"])
        self.assertEqual(len(provider.list_instruments("a")), 1)
        self.assertEqual(len(self.calls), 1)

    def test_oversized_response_and_redirect_fail_closed(self):
        for response in [httpx.Response(200, content=b"x" * (MAX_BYTES + 1)), httpx.Response(302, headers={"location": "https://example.test/"})]:
            client = httpx.Client(transport=httpx.MockTransport(lambda r: response), follow_redirects=False)
            self.addCleanup(client.close)
            provider = DukascopyCatalog(self.path, "test-key-only", client=client)
            provider.refresh()
            self.assertIsNotNone(provider.status()["error"])
            self.assertFalse(self.path.exists())

    def test_invalid_schema_and_symbols_are_not_silently_skipped(self):
        for payload in [{"error": "denied"}, [], [None], [{"name": "<script>"}], [{"name": ""}]]:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                normalize_instruments(payload)

    def test_large_valid_list_survives_cache_restart(self):
        payload = [{"name": f"QA{i}", "nameLong": "x" * 240} for i in range(5000)]
        provider = self.provider(payload=payload)
        provider.refresh()
        self.assertLessEqual(self.path.stat().st_size, MAX_BYTES)
        self.assertEqual(len(DukascopyCatalog(self.path).list_instruments("a")), 5000)

    def test_cached_reads_do_not_wait_for_refresh_network(self):
        self.provider().refresh()
        entered, release, read = threading.Event(), threading.Event(), threading.Event()
        def handler(request):
            entered.set()
            release.wait(3)
            return httpx.Response(500)
        client = httpx.Client(transport=httpx.MockTransport(handler))
        self.addCleanup(client.close)
        provider = DukascopyCatalog(self.path, "test-key-only", client=client)
        worker = threading.Thread(target=provider.refresh)
        worker.start()
        try:
            self.assertTrue(entered.wait(1))
            def cached_read():
                self.assertEqual(len(provider.list_instruments("a")), 1)
                provider.status()
                read.set()
            reader = threading.Thread(target=cached_read)
            reader.start()
            self.assertTrue(read.wait(1), "cached GET waited for network")
            reader.join(1)
        finally:
            release.set()
            worker.join(3)


if __name__ == "__main__":
    unittest.main()
