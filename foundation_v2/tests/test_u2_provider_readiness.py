from __future__ import annotations

import sys
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
for entry in (str(ROOT), str(V2)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from trading_workspace_v2.data_sources import (  # noqa: E402
    DataProviderRegistry,
    StaticMetadataProvider,
    _provider_readiness,
)


class U2ProviderReadinessTests(unittest.TestCase):
    def test_instrument_catalog_is_opt_in_scoped_metadata_without_remote_authority(self):
        class CatalogProvider(StaticMetadataProvider):
            def list_instruments(self, workspace):
                return [{"instrument_id": "EURUSD", "provider": "fixture", "asset_class": "fx"}] if workspace == "a" else []

        provider = CatalogProvider("fixture", {})
        registry = DataProviderRegistry([provider])
        self.assertEqual(registry.list_instruments("a"), [{"instrument_id": "EURUSD", "provider": "fixture", "asset_class": "fx", "provider_id": "fixture"}])
        self.assertEqual(registry.list_instruments("b"), [])
        self.assertFalse(registry.capabilities()[0]["readiness"]["network_access"])
        provider.capabilities = {**provider.capabilities, "read_metadata": False}
        self.assertEqual(registry.list_instruments("a"), [])
        self.assertEqual(DataProviderRegistry([StaticMetadataProvider("local", {})]).list_instruments("a"), [])

    def test_offline_provider_discloses_capability_and_non_entitlement(self):
        registry = DataProviderRegistry([StaticMetadataProvider("offline-fake", {})])

        item = registry.capabilities()[0]

        self.assertEqual(item["provider_id"], "offline-fake")
        self.assertTrue(item["capabilities"]["read_metadata"])
        self.assertFalse(item["capabilities"]["fresh_quote"])
        self.assertEqual(
            item["readiness"],
            {
                "source_kind": "offline_fixture",
                "connection_mode": "offline_fixture",
                "network_access": False,
                "oauth_required": False,
                "entitlement_status": "fixture_only",
                "production_ready": False,
            },
        )

    def test_unknown_provider_defaults_fail_closed_and_drops_extra_fields(self):
        class UnknownProvider:
            provider_id = "unknown"
            capabilities = {"read_metadata": True}
            readiness = {
                "source_kind": "custom",
                "network_access": True,
                "oauth_required": True,
                "entitlement_status": "pending",
                "production_ready": False,
                "secret": "must not be returned",
            }

        profile = _provider_readiness(UnknownProvider())

        self.assertEqual(profile["source_kind"], "custom")
        self.assertTrue(profile["network_access"])
        self.assertTrue(profile["oauth_required"])
        self.assertFalse(profile["production_ready"])
        self.assertNotIn("secret", profile)

    def test_malformed_readiness_uses_safe_defaults(self):
        class BrokenProvider:
            provider_id = "broken"
            capabilities = {}
            readiness = "not-an-object"

        profile = _provider_readiness(BrokenProvider())

        self.assertFalse(profile["network_access"])
        self.assertFalse(profile["oauth_required"])
        self.assertEqual(profile["entitlement_status"], "unverified")
        self.assertFalse(profile["production_ready"])


if __name__ == "__main__":
    unittest.main()
