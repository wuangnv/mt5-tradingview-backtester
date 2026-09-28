from __future__ import annotations

import copy
import unittest

from trading_workspace_v2.chart_overlay_contract import (
    ChartOverlayContractError,
    DETERMINISTIC_ENGINE,
    INDICATOR_SCHEMA,
    OVERLAY_SCHEMA,
    PACKET_SCHEMA,
    PREP_ONLY_MODE,
    cache_key,
    definition_sha256,
    validate_indicator_spec,
    validate_overlay_packet,
)


def indicator(*, source_timeframe_seconds: int = 300, **updates) -> dict:
    value = {
        "schema": INDICATOR_SCHEMA,
        "mode": PREP_ONLY_MODE,
        "engine": DETERMINISTIC_ENGINE,
        "family": "ict",
        "indicator_id": "fvg",
        "version": "ict-fvg-v1",
        "timezone": "Asia/Ho_Chi_Minh",
        "display_timeframe_seconds": 60,
        "source_timeframe_seconds": source_timeframe_seconds,
        "mtf_policy": "higher_closed" if source_timeframe_seconds > 60 else "same_timeframe",
        "lookahead": "closed_only",
        "causal_delay_bars": 0,
        "repaint": {"flag": False, "state": "confirmed", "confirmation_bars": 0},
        "parameters": {"min_gap_ticks": 1},
    }
    value.update(updates)
    return value


def packet(*, overlays=None, spec=None, cutoff=1_700_000_180, source=None) -> dict:
    spec = spec or indicator()
    normalized = validate_indicator_spec(spec)
    source = source or {"kind": "replay", "id": "replay-1", "dataset_id": "fixture-eurusd"}
    overlay = {
        "schema": OVERLAY_SCHEMA,
        "mode": PREP_ONLY_MODE,
        "overlay_id": "fvg-1",
        "kind": "zone",
        "instrument_id": "EURUSD",
        "display_timeframe_seconds": 60,
        "cutoff_timestamp": cutoff,
        "source": source,
        "anchors": [
            {"timestamp": 1_700_000_060, "price": 1.1010},
            {"timestamp": 1_700_000_120, "price": 1.1020},
        ],
        "confidence": {"state": "unknown", "value": None},
        "repaint": {"flag": False, "state": "confirmed", "confirmation_bars": 0},
        "status": "preview",
        "revision": 1,
        "indicator_sha256": definition_sha256(normalized),
        "cache_key": cache_key(
            indicator=normalized,
            source=source,
            instrument_id="EURUSD",
            display_timeframe_seconds=60,
            cutoff_timestamp=cutoff,
        ),
        "label": "FVG candidate",
    }
    return {
        "schema": PACKET_SCHEMA,
        "mode": PREP_ONLY_MODE,
        "engine": DETERMINISTIC_ENGINE,
        "indicator": spec,
        "indicator_sha256": definition_sha256(normalized),
        "source": source,
        "cutoff_timestamp": cutoff,
        "overlays": overlays or [overlay],
    }


class ChartOverlayContractTests(unittest.TestCase):
    def test_valid_packet_preserves_unknown_confidence_and_causal_cache(self):
        result = validate_overlay_packet(packet())
        self.assertEqual(result["schema"], PACKET_SCHEMA)
        self.assertEqual(result["overlays"][0]["confidence"], {"state": "unknown", "value": None})
        self.assertEqual(len(result["overlays"][0]["cache_key"]), 64)

    def test_causal_metadata_is_optional_but_preserved_when_supplied(self):
        payload = packet()
        payload["overlays"][0].update(
            {
                "known_at": 1_700_000_120,
                "source_bar_ids": ["bar:1700000060", "bar:1700000120"],
                "confirmation_lag_bars": 0,
            }
        )
        result = validate_overlay_packet(payload)
        self.assertEqual(result["overlays"][0]["known_at"], 1_700_000_120)
        self.assertEqual(result["overlays"][0]["source_bar_ids"], ["bar:1700000060", "bar:1700000120"])
        self.assertEqual(result["overlays"][0]["confirmation_lag_bars"], 0)

    def test_causal_metadata_rejects_future_and_mismatched_values(self):
        future = packet()
        future["overlays"][0].update(
            {
                "known_at": future["cutoff_timestamp"] + 1,
                "source_bar_ids": ["bar:1700000060", "bar:1700000120"],
                "confirmation_lag_bars": 0,
            }
        )
        with self.assertRaisesRegex(ChartOverlayContractError, "known_at exceeds replay cutoff"):
            validate_overlay_packet(future)

        mismatched = packet()
        mismatched["overlays"][0].update(
            {
                "known_at": 1_700_000_121,
                "source_bar_ids": ["bar:1700000060", "bar:1700000120"],
                "confirmation_lag_bars": 0,
            }
        )
        with self.assertRaisesRegex(ChartOverlayContractError, "known_at does not match zero confirmation lag"):
            validate_overlay_packet(mismatched)

        partial = packet()
        partial["overlays"][0]["known_at"] = 1_700_000_120
        with self.assertRaisesRegex(ChartOverlayContractError, "must be supplied together"):
            validate_overlay_packet(partial)

    def test_causal_metadata_rejects_lag_longer_than_indicator_delay(self):
        payload = packet()
        payload["overlays"][0].update(
            {
                "known_at": 1_700_000_120,
                "source_bar_ids": ["bar:1700000060", "bar:1700000120"],
                "confirmation_lag_bars": 1,
            }
        )
        with self.assertRaisesRegex(ChartOverlayContractError, "confirmation lag exceeds indicator delay"):
            validate_overlay_packet(payload)

    def test_anchor_after_cutoff_is_rejected(self):
        payload = packet()
        payload["overlays"][0]["anchors"][1]["timestamp"] = payload["cutoff_timestamp"] + 1
        with self.assertRaisesRegex(ChartOverlayContractError, "exceeds replay cutoff"):
            validate_overlay_packet(payload)

    def test_mtf_policy_must_be_explicit_and_closed(self):
        with self.assertRaisesRegex(ChartOverlayContractError, "closed_only or next_bar_open"):
            validate_indicator_spec(indicator(lookahead="lookahead_on"))

        with self.assertRaisesRegex(ChartOverlayContractError, "next_bar_open.*causal_delay_bars"):
            validate_indicator_spec(indicator(lookahead="next_bar_open", causal_delay_bars=0))

        delayed = validate_indicator_spec(
            indicator(lookahead="next_bar_open", causal_delay_bars=1)
        )
        self.assertEqual(delayed["causal_delay_bars"], 1)

        payload = packet()
        payload["indicator"]["mtf_policy"] = "same_timeframe"
        with self.assertRaisesRegex(ChartOverlayContractError, "does not match"):
            validate_overlay_packet(payload)

    def test_session_timezone_and_session_range_are_explicit(self):
        spec = indicator(
            family="ict",
            indicator_id="session_range",
            session={"name": "London", "timezone": "Europe/London", "start": "08:00", "end": "17:00"},
        )
        self.assertEqual(validate_indicator_spec(spec)["session"]["timezone"], "Europe/London")

        missing = indicator(family="ict", indicator_id="session_range")
        with self.assertRaisesRegex(ChartOverlayContractError, "session is required"):
            validate_indicator_spec(missing)

        invalid = copy.deepcopy(spec)
        invalid["session"]["timezone"] = "Not/AZone"
        with self.assertRaisesRegex(ChartOverlayContractError, "IANA timezone"):
            validate_indicator_spec(invalid)

    def test_ote_is_a_supported_ict_renderer_indicator(self):
        spec = indicator(indicator_id="ote", version="smc-zones.v1")
        normalized = validate_indicator_spec(spec)
        self.assertEqual(normalized["family"], "ict")
        self.assertEqual(normalized["indicator_id"], "ote")

    def test_repaint_provisional_is_preview_only_and_delay_covers_confirmation(self):
        spec = indicator(
            family="smc",
            indicator_id="swing_points",
            causal_delay_bars=2,
            repaint={"flag": True, "state": "provisional", "confirmation_bars": 2},
        )
        payload = packet(spec=spec)
        payload["overlays"][0]["repaint"] = copy.deepcopy(spec["repaint"])
        self.assertEqual(validate_overlay_packet(payload)["overlays"][0]["status"], "preview")

        committed = packet(spec=spec)
        committed["overlays"][0]["repaint"] = copy.deepcopy(spec["repaint"])
        committed["overlays"][0]["status"] = "committed"
        with self.assertRaisesRegex(ChartOverlayContractError, "preview-only"):
            validate_overlay_packet(committed)

        too_early = indicator(
            family="smc",
            indicator_id="swing_points",
            causal_delay_bars=1,
            repaint={"flag": True, "state": "provisional", "confirmation_bars": 2},
        )
        with self.assertRaisesRegex(ChartOverlayContractError, "shorter than repaint"):
            validate_indicator_spec(too_early)

    def test_undo_requires_revision_and_cache_hash_cannot_be_reused(self):
        payload = packet()
        payload["overlays"][0]["status"] = "undone"
        with self.assertRaisesRegex(ChartOverlayContractError, "undo_of_revision"):
            validate_overlay_packet(payload)
        payload["overlays"][0]["undo_of_revision"] = 1
        self.assertEqual(validate_overlay_packet(payload)["overlays"][0]["status"], "undone")

        stale = packet()
        stale["overlays"][0]["cache_key"] = "0" * 64
        with self.assertRaisesRegex(ChartOverlayContractError, "cache_key"):
            validate_overlay_packet(stale)

    def test_forbidden_provider_or_broker_fields_are_rejected(self):
        payload = packet()
        payload["indicator"]["parameters"]["api_key"] = "secret"
        with self.assertRaisesRegex(ChartOverlayContractError, "forbidden"):
            validate_overlay_packet(payload)


if __name__ == "__main__":
    unittest.main()

