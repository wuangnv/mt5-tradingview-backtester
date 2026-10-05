from __future__ import annotations

import copy
import sys
import unittest
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT), str(ROOT / "foundation_v2")]

from trading_workspace_v2.replay_execution import (
    ReplayExecutionError, fork_replay_execution_checkpoint, queue_market_order,
)
from trading_workspace_v2.replay_tick_execution import (
    ReplayTickExecutionSnapshot, advance_tick_execution, change_tick_protection,
    initialize_tick_execution, reconstruct_tick_execution_checkpoint, validate_tick_execution_event,
)


def initial(*, balance="100000", leverage="100", commission="1", slippage="0"):
    return initialize_tick_execution(
        replay_session_id="tick-session", branch_id="tick-branch", dataset_id="m1-dataset",
        dataset_sha256="d" * 64, tick_snapshot_id="tick-snapshot", tick_snapshot_sha256="a" * 64,
        instrument_spec={"instrument_id": "EURUSDm", "asset_class": "fx", "base_ccy": "EUR",
            "quote_ccy": "USD", "account_ccy": "USD", "tick_size": "0.0001", "pip_size": "0.0001",
            "contract_size": "100000", "quantity_min": "0.01", "quantity_step": "0.01",
            "effective_from_utc": "2026-01-01T00:00:00Z", "effective_to_utc": ""},
        cost_model={"version": "tick-fixture-cost-v1", "spread_basis": "bid_ask_embedded",
            "commission_per_side_account": commission, "minimum_fee_account": "0",
            "slippage_price_per_side": slippage, "financing_account": "0",
            "quote_to_account_rate": "1", "account_ccy": "USD", "rounding_decimals": 2},
        spread_price="0", timeframe_seconds=60, starting_balance=balance, cursor_index=0,
        research_margin={"version": "fixed-starting-balance-leverage-v1", "leverage": leverage})


def bar(timestamp=1000):
    return {"timestamp": timestamp, "open": 1.1000, "high": 1.1050, "low": 1.0950, "close": 1.1010}


def tick(bid="1.1000", ask="1.1002", *, offset=0, sequence=0, timestamp=1000):
    return {"time_msc": timestamp * 1000 + offset, "sequence": sequence, "bid": bid, "ask": ask}


def queued(snapshot=None, *, side="BUY", quantity="1", stop="1.0990", target="1.1020"):
    return queue_market_order(snapshot or initial(), operation_id="order-1", side=side,
                              quantity=quantity, stop_loss=stop, take_profit=target)


class TickExecutionTests(unittest.TestCase):
    def advance(self, state, ticks, *, timestamp=1000, cursor=1):
        return advance_tick_execution(state, ticks=iter(ticks), bar=bar(timestamp), cursor_index=cursor)

    def test_buy_first_touch_uses_bid_and_keeps_same_millisecond_order(self):
        result = self.advance(queued(), [tick(), tick("1.1022", "1.1024", sequence=1),
                                        tick("1.0980", "1.0982", sequence=2)])
        close = result.events[1]
        self.assertEqual([e.kind for e in result.events], ["market_fill", "protective_fill", "price_mark"])
        self.assertEqual(close.details["reason"], "take_profit")
        self.assertEqual(close.details["fill_price"], "1.1022")
        self.assertEqual(result.snapshot.balance, Decimal("100198"))
        self.assertEqual(close.details["sequence"], 1)

    def test_stop_first_touch_not_ohlc_ambiguity(self):
        result = self.advance(queued(), [tick(), tick("1.0988", "1.0990", offset=100),
                                        tick("1.1040", "1.1042", offset=200)])
        self.assertEqual(result.events[1].details["reason"], "stop_loss")
        self.assertEqual(result.snapshot.balance, Decimal("99858"))

    def test_sell_entries_bid_and_exits_ask(self):
        result = self.advance(queued(side="SELL", stop="1.1020", target="1.0980"),
                              [tick(), tick("1.0976", "1.0978", offset=1)])
        self.assertEqual(result.events[0].details["fill_price"], "1.1000")
        self.assertEqual(result.events[1].details["fill_price"], "1.0978")
        self.assertEqual(result.snapshot.balance, Decimal("100218"))

    def test_sell_does_not_trigger_tp_from_bid_alone(self):
        result = self.advance(queued(side="SELL", stop="1.1020", target="1.0980"),
                              [tick(), tick("1.0979", "1.0981", offset=1)])
        self.assertIsNotNone(result.snapshot.position)
        self.assertEqual(len(result.events), 2)

    def test_buy_does_not_trigger_tp_from_ask_alone(self):
        result = self.advance(queued(), [tick(), tick("1.1019", "1.1021", offset=1)])
        self.assertIsNotNone(result.snapshot.position)
        self.assertEqual(result.snapshot.floating_pl, Decimal("168"))

    def test_existing_position_gap_fills_actual_quote_not_stop_level(self):
        opened = self.advance(queued(), [tick()]).snapshot
        result = self.advance(opened, [tick("1.0900", "1.0905", timestamp=1060)], timestamp=1060, cursor=2)
        self.assertEqual(result.events[0].details["fill_price"], "1.0900")
        self.assertEqual(result.snapshot.balance, Decimal("98978"))

    def test_embedded_spread_and_explicit_commission_slippage_once(self):
        state = queued(initial(commission="2", slippage="0.0001"))
        result = self.advance(state, [tick(), tick("1.1020", "1.1022", offset=1)])
        costs = result.events[1].details["cost_breakdown"]
        self.assertEqual(costs["gross_account"], 180.0)
        self.assertEqual(costs["spread_cost_account"], 0.0)
        self.assertEqual(costs["commission_account"], 4.0)
        self.assertEqual(costs["slippage_account"], 20.0)
        self.assertEqual(result.snapshot.balance, Decimal("100156"))

    def test_margin_rejection_uses_real_ask_and_remains_flat(self):
        state = queued(initial(balance="1000", leverage="1"), quantity="0.01")
        result = self.advance(state, [tick()])
        event = result.events[0]
        self.assertEqual(event.kind, "order_rejected")
        self.assertEqual(event.details["margin_admission"]["required_account"], "1100.200000")
        self.assertEqual(result.snapshot.balance, Decimal("1000"))
        self.assertIsNone(result.snapshot.pending_market_order)
        self.assertIsNone(result.snapshot.position)

    def test_invalid_bracket_at_first_quote_fails_atomically(self):
        state = queued()
        before = state.model_dump(mode="json")
        with self.assertRaisesRegex(ReplayExecutionError, "gap invalidates"):
            self.advance(state, [tick("1.1030", "1.1032")])
        self.assertEqual(state.model_dump(mode="json"), before)

    def test_empty_ticks_fail_closed_without_using_ohlc(self):
        with self.assertRaisesRegex(ReplayExecutionError, "OHLC fallback"):
            self.advance(queued(), [])

    def test_future_and_previous_quotes_fail_closed(self):
        for offset in (-1, 60000, 60001):
            with self.subTest(offset=offset), self.assertRaisesRegex(ReplayExecutionError, "closed bar window"):
                self.advance(queued(), [tick(offset=offset)])

    def test_duplicate_sequence_or_backwards_time_fails_atomically(self):
        state = queued()
        for ticks in ([tick(), tick()], [tick(offset=1), tick(offset=0, sequence=1)]):
            with self.assertRaisesRegex(ReplayExecutionError, "strictly increasing"):
                self.advance(state, ticks)
        self.assertEqual(state.event_sequence, 0)
        self.assertIsNone(state.position)

    def test_crossed_and_offgrid_quotes_are_rejected(self):
        with self.assertRaises(ValueError):
            self.advance(initial(), [tick("1.1002", "1.1001")])
        with self.assertRaisesRegex(ReplayExecutionError, "tick size"):
            self.advance(initial(), [tick("1.10001", "1.1002")])

    def test_snapshot_serialization_keeps_tick_pins_and_revalidates(self):
        result = self.advance(queued(), [tick()])
        raw = result.model_dump(mode="json")["snapshot"]
        self.assertEqual(raw["tick_snapshot_sha256"], "a" * 64)
        self.assertEqual(raw["schema_version"], "replay-execution-tick-v1")
        self.assertEqual(ReplayTickExecutionSnapshot.model_validate(raw), result.snapshot)

    def test_tampered_provenance_and_fill_side_are_rejected(self):
        result = self.advance(queued(), [tick()])
        for key, value in (("tick_snapshot_id", "other"), ("fill_price", "1.1000"),
                           ("time_msc", 1060000)):
            raw = copy.deepcopy(result.events[0].model_dump(mode="json"))
            raw["details"][key] = value
            with self.subTest(key=key), self.assertRaises(ReplayExecutionError):
                validate_tick_execution_event(result.snapshot, raw)

    def test_checkpoint_and_branch_preserve_old_quotes_and_snapshot_pins(self):
        first = self.advance(initial(), [tick()]).snapshot
        second = self.advance(first, [tick("1.1100", "1.1103", timestamp=1060)], timestamp=1060, cursor=2).snapshot
        checkpoint = reconstruct_tick_execution_checkpoint(second, cursor_index=1)
        self.assertEqual(checkpoint.last_bid, Decimal("1.1000"))
        self.assertEqual(second.last_bid, Decimal("1.1100"))
        branch = fork_replay_execution_checkpoint(checkpoint, replay_session_id="child", branch_id="child-branch")
        self.assertIsInstance(branch, ReplayTickExecutionSnapshot)
        self.assertEqual(branch.tick_snapshot_sha256, second.tick_snapshot_sha256)
        self.assertEqual(branch.ledger[-1]["replay_session_id"], "child")

    def test_protection_amendment_uses_closeable_bid_not_bar_close(self):
        opened = self.advance(queued(), [tick()]).snapshot
        updated = change_tick_protection(opened, target_id=opened.position.position_id,
            operation_id="amend-1", stop_loss="1.0995", take_profit="1.1015", mid_close="1.1010",
            virtual_time_utc=1060)
        event = updated.ledger[-1]
        self.assertEqual(event["details"]["closeable_quote"], "1.1000")
        self.assertEqual(event["details"]["mid_close"], "1.1010")
        self.assertEqual(event["details"]["tick_snapshot_sha256"], opened.tick_snapshot_sha256)
        self.assertEqual(opened.position.stop_loss, Decimal("1.0990"))

    def test_snapshot_last_quote_tampering_fails_validation(self):
        raw = self.advance(initial(), [tick()]).snapshot.model_dump(mode="json")
        raw["last_bid"] = "1.0999"
        with self.assertRaises(ValueError):
            ReplayTickExecutionSnapshot.model_validate(raw)

    def test_money_consistent_but_wrong_quote_pnl_is_rejected(self):
        result = self.advance(queued(), [tick()])
        event = result.events[-1].model_dump(mode="json")
        event.update(floating_pl="0", equity=event["balance"])
        with self.assertRaisesRegex(ReplayExecutionError, "floating pnl"):
            validate_tick_execution_event(result.snapshot, event)

    def test_same_second_ledger_time_reversal_is_rejected(self):
        raw = self.advance(queued(), [tick(), tick("1.1020", "1.1022", offset=1)]).snapshot.model_dump(mode="json")
        raw["ledger"][0]["details"]["time_msc"] += 2
        with self.assertRaisesRegex(ValueError, "reverses broker quote order"):
            ReplayTickExecutionSnapshot.model_validate(raw)

    def test_tampered_realized_pnl_cannot_pass_as_a_valid_cost(self):
        result = self.advance(queued(), [tick(), tick("1.1020", "1.1022", offset=1)])
        event = result.events[1].model_dump(mode="json")
        event["details"]["net_pnl"] = "99999"
        with self.assertRaisesRegex(ReplayExecutionError, "cost accounting"):
            validate_tick_execution_event(result.snapshot, event)

    def test_tick_fills_are_deterministic_and_do_not_overclaim_prop_equity_coverage(self):
        ticks = [tick(), tick("1.1010", "1.1012", offset=2000)]
        state = queued()
        one, two = self.advance(state, ticks), self.advance(state, ticks)
        self.assertEqual(one.model_dump(mode="json"), two.model_dump(mode="json"))
        self.assertEqual(one.events[-1].details["intrabar_equity_coverage"], "insufficient")
        self.assertEqual(one.events[-1].virtual_time_utc, 1060)
        self.assertEqual(one.events[-1].details["time_msc"], 1002000)


if __name__ == "__main__":
    unittest.main()
