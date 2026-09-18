import tempfile
import unittest
from pathlib import Path

from execution_store import ExecutionJournal, fingerprint
from live_readiness import LivePolicy, MT5LiveReadinessProbe


class FakeLiveFetcher:
    def __init__(self, *, trade_mode="real", server="Broker-Live", positions=None):
        self.trade_mode = trade_mode
        self.server = server
        self.positions = list(positions or [])
        self.trade_calls = []

    def get_execution_context(self):
        return {
            "success": True,
            "protocol_version": 2,
            "account": {
                "login": 987654,
                "server": self.server,
                "company": "Broker",
                "currency": "USD",
                "trade_mode": self.trade_mode,
                "trade_allowed": True,
                "trade_expert": True,
            },
            "terminal": {
                "connected": True,
                "trade_allowed": True,
                "mql_trade_allowed": True,
            },
        }

    def get_positions_result(self):
        return {"success": True, "positions": list(self.positions)}

    def get_symbol_info(self, symbol):
        if symbol != "EURUSD":
            return {"success": False, "message": f"Unknown symbol: {symbol}"}
        return {"success": True, "symbol": {"trade_allowed": True}}

    def place_order(self, *args, **kwargs):
        self.trade_calls.append(("place", args, kwargs))
        raise AssertionError("P5A readiness must never send an order")


def approved_policy(**overrides):
    values = {
        "expected_account_id": "987654",
        "expected_server": "Broker-Live",
        "max_risk_pct": 0.25,
        "max_risk_amount": 25.0,
        "max_positions": 1,
        "allowed_actions": ("place_market", "close_position", "reconcile"),
        "allowed_symbols": ("EURUSD",),
    }
    values.update(overrides)
    return LivePolicy(**values)


class P5LiveReadinessTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.journal = ExecutionJournal(
            Path(self.temp_dir.name) / "execution.sqlite3"
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_matching_real_account_can_pass_read_only_gate(self):
        fetcher = FakeLiveFetcher()
        state = MT5LiveReadinessProbe(fetcher).snapshot(
            approved_policy(), self.journal
        )

        self.assertTrue(state["ready_for_live_gate"])
        self.assertTrue(state["read_only"])
        self.assertFalse(state["execution_enabled"])
        self.assertEqual(state["account"]["mode"], "real")
        self.assertEqual(fetcher.trade_calls, [])

    def test_demo_or_wrong_server_is_blocked(self):
        demo = MT5LiveReadinessProbe(FakeLiveFetcher(trade_mode="demo")).snapshot(
            approved_policy(), self.journal
        )
        self.assertFalse(demo["ready_for_live_gate"])
        self.assertTrue(
            any("not a live/real account" in item for item in demo["blockers"])
        )

        wrong_server = MT5LiveReadinessProbe(
            FakeLiveFetcher(server="Other-Live")
        ).snapshot(approved_policy(), self.journal)
        self.assertFalse(wrong_server["ready_for_live_gate"])
        self.assertTrue(
            any("server does not match" in item for item in wrong_server["blockers"])
        )

    def test_missing_protocol_or_terminal_state_is_blocked(self):
        class MissingProtocolFetcher(FakeLiveFetcher):
            def get_execution_context(self):
                context = super().get_execution_context()
                context.pop("protocol_version")
                return context

        missing_protocol = MT5LiveReadinessProbe(MissingProtocolFetcher()).snapshot(
            approved_policy(), self.journal
        )
        self.assertFalse(missing_protocol["ready_for_live_gate"])
        self.assertTrue(
            any("protocol v2" in item for item in missing_protocol["blockers"])
        )

        class MissingTerminalFetcher(FakeLiveFetcher):
            def get_execution_context(self):
                context = super().get_execution_context()
                context["terminal"] = {}
                return context

        missing_terminal = MT5LiveReadinessProbe(MissingTerminalFetcher()).snapshot(
            approved_policy(), self.journal
        )
        self.assertFalse(missing_terminal["ready_for_live_gate"])
        self.assertTrue(
            any("terminal state is missing" in item for item in missing_terminal["blockers"])
        )

    def test_missing_limits_and_actions_are_blocked(self):
        state = MT5LiveReadinessProbe(FakeLiveFetcher()).snapshot(
            LivePolicy(
                expected_account_id="987654",
                expected_server="Broker-Live",
            ),
            self.journal,
        )
        self.assertFalse(state["ready_for_live_gate"])
        self.assertTrue(any("max_risk_pct" in item for item in state["blockers"]))
        self.assertTrue(
            any("allowed live actions" in item for item in state["blockers"])
        )

    def test_missing_symbol_scope_is_blocked_for_non_place_actions(self):
        state = MT5LiveReadinessProbe(FakeLiveFetcher()).snapshot(
            approved_policy(
                allowed_actions=("close_position", "reconcile"),
                allowed_symbols=(),
            ),
            self.journal,
        )

        self.assertFalse(state["ready_for_live_gate"])
        self.assertTrue(any("allowed_symbols" in item for item in state["blockers"]))

    def test_malformed_or_unknown_symbol_scope_fails_closed(self):
        malformed = MT5LiveReadinessProbe(FakeLiveFetcher()).snapshot(
            approved_policy(allowed_symbols=("???",)), self.journal
        )
        self.assertFalse(malformed["ready_for_live_gate"])
        self.assertTrue(any("invalid broker symbol" in item for item in malformed["blockers"]))

        wrong_type = MT5LiveReadinessProbe(FakeLiveFetcher()).snapshot(
            approved_policy(allowed_symbols=(123,)), self.journal
        )
        self.assertFalse(wrong_type["ready_for_live_gate"])
        self.assertTrue(any("malformed" in item for item in wrong_type["blockers"]))

        mapping = MT5LiveReadinessProbe(FakeLiveFetcher()).snapshot(
            approved_policy(allowed_symbols={"EURUSD": 1}), self.journal
        )
        self.assertFalse(mapping["ready_for_live_gate"])
        self.assertTrue(any("malformed" in item for item in mapping["blockers"]))

        unknown = MT5LiveReadinessProbe(FakeLiveFetcher()).snapshot(
            approved_policy(allowed_symbols=("UNKNOWN",)), self.journal
        )
        self.assertFalse(unknown["ready_for_live_gate"])
        self.assertTrue(any("Unknown symbol" in item for item in unknown["blockers"]))

    def test_malformed_policy_fails_closed_instead_of_raising(self):
        state = MT5LiveReadinessProbe(FakeLiveFetcher()).snapshot(
            LivePolicy(
                expected_account_id="987654",
                expected_server="Broker-Live",
                max_risk_pct="Infinity",
                max_risk_amount="NaN",
                max_positions="bad",
                allowed_actions=None,
                allowed_symbols=None,
            ),
            self.journal,
        )

        self.assertFalse(state["ready_for_live_gate"])
        self.assertTrue(any("max_risk_pct" in item for item in state["blockers"]))
        self.assertTrue(any("max_risk_amount" in item for item in state["blockers"]))
        self.assertTrue(any("max_positions" in item for item in state["blockers"]))

    def test_boolean_and_fractional_limits_fail_closed(self):
        state = MT5LiveReadinessProbe(FakeLiveFetcher()).snapshot(
            approved_policy(
                max_risk_pct=True,
                max_risk_amount=True,
                max_positions=1.9,
            ),
            self.journal,
        )

        self.assertFalse(state["ready_for_live_gate"])
        self.assertTrue(any("max_risk_pct" in item for item in state["blockers"]))
        self.assertTrue(any("max_risk_amount" in item for item in state["blockers"]))
        self.assertTrue(any("max_positions" in item for item in state["blockers"]))

    def test_missing_positions_payload_fails_closed(self):
        class MissingPositionsFetcher(FakeLiveFetcher):
            def get_positions_result(self):
                return {"success": True}

        state = MT5LiveReadinessProbe(MissingPositionsFetcher()).snapshot(
            approved_policy(), self.journal
        )

        self.assertFalse(state["ready_for_live_gate"])
        self.assertTrue(
            any("positions response is missing" in item for item in state["blockers"])
        )

    def test_unknown_live_request_blocks_gate_until_reconciled(self):
        payload = {"order": {"symbol": "EURUSD"}}
        self.journal.prepare(
            "live-unknown-1",
            "live",
            "987654",
            "Broker-Live",
            "place",
            fingerprint(payload),
        )
        state = MT5LiveReadinessProbe(FakeLiveFetcher()).snapshot(
            approved_policy(), self.journal
        )

        self.assertFalse(state["ready_for_live_gate"])
        self.assertEqual(len(state["unknown_live_requests"]), 1)
        self.assertTrue(any("unreconciled" in item for item in state["blockers"]))

    def test_unknown_live_request_for_other_account_still_blocks_gate(self):
        payload = {"order": {"symbol": "GBPUSD"}}
        self.journal.prepare(
            "other-live-unknown",
            "live",
            "111111",
            "Other-Live",
            "place",
            fingerprint(payload),
        )
        state = MT5LiveReadinessProbe(FakeLiveFetcher()).snapshot(
            approved_policy(), self.journal
        )

        self.assertFalse(state["ready_for_live_gate"])
        self.assertEqual(
            [item["request_id"] for item in state["unknown_live_requests"]],
            ["other-live-unknown"],
        )

    def test_existing_position_blocks_new_exposure_at_limit(self):
        state = MT5LiveReadinessProbe(
            FakeLiveFetcher(
                positions=[{"ticket": 42, "symbol": "EURUSD"}]
            )
        ).snapshot(approved_policy(max_positions=1), self.journal)

        self.assertFalse(state["ready_for_live_gate"])
        self.assertTrue(any("max_positions" in item for item in state["blockers"]))


if __name__ == "__main__":
    unittest.main()
