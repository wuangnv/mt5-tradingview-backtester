from __future__ import annotations

import copy
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trading_workspace_v2.dukascopy_catalog import DukascopyCatalog, MAX_BYTES, normalize_instruments

GROUPS = [{"id": 3, "code": "FX", "parentId": None}, {"id": 18, "code": "FX_MAJORS", "parentId": 3}]
ROW = {"id": 1, "name": "EUR/USD", "code": "EUR-USD", "description": "Euro / US Dollar", "groupId": 18, "pipValue": 0.0001, "priceScale": 5, "extra_secret": "do-not-store"}
PAYLOAD = {"instruments": [ROW], "groups": GROUPS}


class DukascopyCatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "catalog.json"
        self.addCleanup(self.temp.cleanup)
        self.calls = []

    def provider(self, status=200, payload=PAYLOAD):
        def handler(request):
            self.calls.append(request)
            self.assertEqual(request.url.host, "jetta.dukascopy.com")
            self.assertEqual(request.url.path, "/v1/instruments")
            self.assertFalse(request.url.query)
            self.assertNotIn("authorization", request.headers)
            return httpx.Response(status, json=payload)
        client = httpx.Client(transport=httpx.MockTransport(handler))
        self.addCleanup(client.close)
        return DukascopyCatalog(self.path, client=client)

    def test_keyless_reads_never_touch_network_or_disk(self):
        provider = DukascopyCatalog(self.path)
        self.assertTrue(provider.status()["configured"])
        self.assertEqual(provider.list_instruments("a"), [])
        self.assertTrue(provider.status()["refresh_available"])
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
        self.assertTrue(restarted.status()["configured"])
        self.assertEqual(restarted.list_instruments("a"), provider.list_instruments("a"))
        self.assertEqual(restarted.list_datasets("a"), [])
        self.assertFalse(restarted.capabilities["read_history"])
        self.assertFalse(restarted.capabilities["fresh_quote"])
        self.assertEqual(restarted.list_instruments("a")[0]["asset_class"], "fx")
        self.assertEqual(restarted.list_instruments("a")[0]["provider_code"], "EUR-USD")
        self.assertEqual(restarted.list_instruments("a")[0]["pip_value"], 0.0001)
        self.assertEqual(restarted.list_instruments("a")[0]["price_scale"], 5)

    def test_failed_refresh_preserves_last_valid_file_and_rows(self):
        self.provider().refresh()
        before = self.path.read_bytes()
        for status, payload, reason in [(429, {}, "rate_limited"), (403, {}, "source_unavailable"),
                                       (500, {}, "source_unavailable"), (200, [], "invalid_response"),
                                       (200, {"instruments": [ROW, ROW], "groups": GROUPS}, "invalid_response")]:
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
        snapshot["raw_catalog"]["instruments"][0]["name"] = "GBP/USD"
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
            provider = DukascopyCatalog(self.path, client=client)
            provider.refresh()
            self.assertIsNotNone(provider.status()["error"])
            self.assertFalse(self.path.exists())

    def test_invalid_schema_and_symbols_are_not_silently_skipped(self):
        invalid = [{"error": "denied"}, [], {"instruments": [None], "groups": []}]
        for field, value in [("name", "<script>"), ("name", ""), ("name", None), ("code", None), ("code", "EUR/USD"),
                             ("pipValue", float("nan")), ("pipValue", 0), ("pipValue", True),
                             ("priceScale", 13), ("priceScale", True), ("groupId", "18")]:
            invalid.append({"instruments": [{**ROW, field: value}], "groups": GROUPS})
        for payload in invalid:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                normalize_instruments(payload)

    def test_group_hierarchy_and_unclassified_groups_preserve_metadata(self):
        groups = [*GROUPS, {"id": 7, "code": "STCK_CFD", "parentId": None},
                  {"id": 47, "code": "US", "parentId": 7},
                  {"id": 19, "code": "FX_METALS", "parentId": 3},
                  {"id": 100, "code": "FUTURE_UNKNOWN", "parentId": None}]
        for group_id, expected in [(47, "stock"), (19, "metal"), (100, ""), (999, "")]:
            item = normalize_instruments({"instruments": [{**ROW, "groupId": group_id}], "groups": groups})[0]
            self.assertEqual(item["asset_class"], expected)
            self.assertEqual(item["provider_group_id"], group_id)
        cycle = copy.deepcopy(PAYLOAD)
        cycle["groups"][0]["parentId"] = 18
        with self.assertRaises(ValueError):
            normalize_instruments(cycle)

    def test_keyed_v1_cache_is_not_reused_for_new_provider(self):
        self.path.write_text(json.dumps({"version": 1, "source": "https://freeserv.dukascopy.com/2.0/"}))
        provider = self.provider()
        self.assertEqual(provider.status()["error"], "invalid_cache")
        self.assertEqual(provider.list_instruments("a"), [])
        provider.refresh()
        self.assertEqual(provider.status()["status"], "cached")
        self.assertIsNone(provider.status()["error"])

    def test_duplicate_provider_codes_fail_closed(self):
        with self.assertRaises(ValueError):
            normalize_instruments({"instruments": [ROW, {**ROW, "name": "SECOND"}], "groups": GROUPS})

    def test_network_timeout_preserves_cached_metadata(self):
        self.provider().refresh()
        before = self.path.read_bytes()
        def handler(request):
            raise httpx.ReadTimeout("test timeout", request=request)
        client = httpx.Client(transport=httpx.MockTransport(handler))
        self.addCleanup(client.close)
        provider = DukascopyCatalog(self.path, client=client)
        provider.refresh()
        self.assertEqual(provider.status()["error"], "source_unavailable")
        self.assertEqual(provider.status()["status"], "cached")
        self.assertEqual(self.path.read_bytes(), before)

    def test_null_upstream_precision_is_preserved_without_guessing(self):
        payload = {"instruments": [{**ROW, "priceScale": None, "description": None}], "groups": GROUPS}
        provider = self.provider(payload=payload)
        provider.refresh()
        self.assertIsNone(provider.status()["error"])
        item = DukascopyCatalog(self.path).list_instruments("a")[0]
        self.assertIsNone(item["price_scale"])
        self.assertEqual(item["name"], "EUR/USD")
        self.assertEqual(item["provider_code"], "EUR-USD")

    def test_large_valid_list_survives_cache_restart(self):
        payload = {"instruments": [{**ROW, "name": f"QA{i}", "code": f"QA{i}", "description": "x" * 240} for i in range(4000)], "groups": GROUPS}
        provider = self.provider(payload=payload)
        provider.refresh()
        self.assertLessEqual(self.path.stat().st_size, MAX_BYTES)
        self.assertEqual(len(DukascopyCatalog(self.path).list_instruments("a")), 4000)

    def test_cached_reads_do_not_wait_for_refresh_network(self):
        self.provider().refresh()
        entered, release, read = threading.Event(), threading.Event(), threading.Event()
        def handler(request):
            entered.set()
            release.wait(3)
            return httpx.Response(500)
        client = httpx.Client(transport=httpx.MockTransport(handler))
        self.addCleanup(client.close)
        provider = DukascopyCatalog(self.path, client=client)
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
