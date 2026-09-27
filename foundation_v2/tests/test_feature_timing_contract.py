from __future__ import annotations

import json
from pathlib import Path
import unittest

from trading_workspace_v2.feature_timing_contract import (
    FeatureTimingContractError,
    definition_sha256,
    validate_feature_timing_fixture,
)


FIXTURE = Path(__file__).with_name("fixtures") / "feature_timing_contract.json"


def load_fixture() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


class FeatureTimingContractTests(unittest.TestCase):
    def test_prep_only_fixture_validates_causal_timing_and_dual_hit_fail_closed(self):
        result = validate_feature_timing_fixture(load_fixture())
        self.assertEqual(result["oracle"], "causal-feature-timing-v1")
        self.assertEqual(result["ambiguous_count"], 1)

    def test_definition_hash_is_order_independent(self):
        self.assertEqual(
            definition_sha256({"b": 2, "a": 1}),
            definition_sha256({"a": 1, "b": 2}),
        )

    def test_future_leaking_available_at_is_rejected(self):
        payload = load_fixture()
        payload["samples"][0]["available_at"] = payload["samples"][0]["observed_at"] - 1
        with self.assertRaisesRegex(FeatureTimingContractError, "available_at"):
            validate_feature_timing_fixture(payload)

    def test_hash_tampering_is_rejected(self):
        payload = load_fixture()
        payload["samples"][0]["definition_sha256"] = "0" * 64
        with self.assertRaisesRegex(FeatureTimingContractError, "definition_sha256"):
            validate_feature_timing_fixture(payload)

    def test_dual_hit_cannot_be_reported_as_a_fill(self):
        payload = load_fixture()
        payload["samples"][1]["executable"] = True
        with self.assertRaisesRegex(FeatureTimingContractError, "dual-hit"):
            validate_feature_timing_fixture(payload)


if __name__ == "__main__":
    unittest.main()
