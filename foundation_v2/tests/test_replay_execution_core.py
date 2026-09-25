from __future__ import annotations

import sys
import unittest
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(V2) not in sys.path:
    sys.path.insert(0, str(V2))

from trading_workspace_v2.execution_semantics import IntrabarAmbiguityError
from trading_workspace_v2.replay_execution import (
    advance_replay_execution,
    initialize_replay_execution,
    queue_market_order,
)
from trading_workspace_v2.retained import CostModel, InstrumentSpec


def instrument() -> InstrumentSpec:
    return InstrumentSpec.from_mapping(
        {
            "instrument_id": "EURUSD",
            "asset_class": "fx",
            "base_ccy": "EUR",
            "quote_ccy": "USD",
            "account_ccy": "USD",
            "tick_size": "0.0001",
            "pip_size": "0.0001",
            "contract_size": "100000",
            "quantity_min": "0.01",
            "quantity_step": "0.01",
            "effective_from_utc": "2026-01-01T00:00:00Z",
            "effective_to_utc": "",
        }
    )


def costs() -> CostModel:
    return CostModel.from_mapping(
        {
            "version": "replay-fixture-cost-v1",
            "spread_basis": "bid_ask_embedded",
            "commission_per_side_account": "1",
            "minimum_fee_account": "0",
            "slippage_price_per_side": "0",
            "financing_account": "0",
            "quote_to_account_rate": "1",
            "account_ccy": "USD",
            "rounding_decimals": 2,
        }
    )


def initial_state(cursor_index: int = 0):
    return initialize_replay_execution(
        replay_session_id="replay-fixture",
        branch_id="branch-fixture",
        dataset_id="dataset-fixture",
        dataset_sha256="d" * 64,
        instrument_spec={
            "instrument_id": "EURUSD",
            "asset_class": "fx",
            "base_ccy": "EUR",
            "quote_ccy": "USD",
            "account_ccy": "USD",
            "tick_size": "0.0001",
            "pip_size": "0.0001",
            "contract_size": "100000",
            "quantity_min": "0.01",
            "quantity_step": "0.01",
            "effective_from_utc": "2026-01-01T00:00:00Z",
            "effective_to_utc": "",
        },
        cost_model={
            "version": "replay-fixture-cost-v1",
            "spread_basis": "bid_ask_embedded",
            "commission_per_side_account": "1",
            "minimum_fee_account": "0",
            "slippage_price_per_side": "0",
            "financing_account": "0",
            "quote_to_account_rate": "1",
            "account_ccy": "USD",
            "rounding_decimals": 2,
        },
        spread_price="0.0002",
        timeframe_seconds=60,
        starting_balance="100000",
        cursor_index=cursor_index,
    )


class ReplayExecutionCoreTests(unittest.TestCase):
    def test_market_order_fills_next_bar_open_and_marks_closeable_equity(self):
        state = initial_state(4)
        state = queue_market_order(
            state,
            operation_id="open-1",
            side="BUY",
            quantity="0.10",
            stop_loss="1.0900",
            take_profit="1.1200",
        )
        result = advance_replay_execution(
            state,
            bar={"timestamp": 1000, "open": 1.1000, "high": 1.1050, "low": 1.0990, "close": 1.1020},
            cursor_index=5,
        )
        self.assertIsNotNone(result.snapshot.position)
        self.assertEqual(result.snapshot.position.entry_fill, Decimal("1.1001"))
        self.assertEqual(result.snapshot.cursor_index, 5)
        self.assertEqual(result.snapshot.event_sequence, 2)
        self.assertEqual([item.kind for item in result.events], ["market_fill", "price_mark"])
        self.assertEqual(result.events[0].virtual_time_utc, 1000)
        self.assertEqual(result.events[1].virtual_time_utc, 1060)
        self.assertEqual(result.events[0].dataset_sha256, "d" * 64)
        self.assertEqual(result.events[0].replay_session_id, "replay-fixture")
        self.assertEqual(result.events[0].pending_orders, 0)
        self.assertEqual(result.events[0].open_positions, 1)
        self.assertLess(result.events[0].equity, Decimal("100000"))
        self.assertEqual(result.snapshot.balance, Decimal("100000"))
        self.assertEqual(result.snapshot.equity, result.snapshot.balance + result.snapshot.floating_pl)
        self.assertLess(result.snapshot.floating_pl, Decimal("20"))

    def test_protective_stop_and_gap_use_shared_u5b_semantics(self):
        state = initial_state()
        state = queue_market_order(
            state,
            operation_id="open-1",
            side="BUY",
            quantity="0.10",
            stop_loss="1.0950",
            take_profit="1.1200",
        )
        opened = advance_replay_execution(
            state,
            bar={"timestamp": 60, "open": 1.1000, "high": 1.1050, "low": 1.0990, "close": 1.1020},
            cursor_index=1,
        ).snapshot
        stopped = advance_replay_execution(
            opened,
            bar={"timestamp": 120, "open": 1.0940, "high": 1.1000, "low": 1.0930, "close": 1.0990},
            cursor_index=2,
        )
        self.assertIsNone(stopped.snapshot.position)
        self.assertEqual([item.kind for item in stopped.events], ["protective_fill", "price_mark"])
        self.assertEqual(stopped.events[0].virtual_time_utc, 120)
        self.assertEqual(stopped.events[0].details["reason"], "stop_loss_gap")
        self.assertEqual(stopped.events[0].details["fill_price"], "1.0939")
        self.assertLess(stopped.snapshot.balance, Decimal("100000"))
        self.assertEqual(stopped.snapshot.floating_pl, Decimal("0"))

    def test_same_bar_stop_and_take_profit_fail_closed_without_mutating_input(self):
        state = initial_state()
        state = queue_market_order(
            state,
            operation_id="open-1",
            side="BUY",
            quantity="0.10",
            stop_loss="1.0950",
            take_profit="1.1050",
        )
        with self.assertRaisesRegex(IntrabarAmbiguityError, "lower-timeframe ordering required"):
            advance_replay_execution(
                state,
                bar={"timestamp": 60, "open": 1.1000, "high": 1.1060, "low": 1.0940, "close": 1.1000},
                cursor_index=1,
            )
        self.assertEqual(state.cursor_index, 0)
        self.assertEqual(state.event_sequence, 0)
        self.assertIsNotNone(state.pending_market_order)
        self.assertEqual(state.ledger, [])

    def test_quantity_step_and_exact_cursor_are_fail_closed(self):
        state = initial_state(2)
        with self.assertRaisesRegex(ValueError, "instrument step"):
            queue_market_order(
                state,
                operation_id="bad-qty",
                side="BUY",
                quantity="0.015",
                stop_loss="1.0900",
                take_profit="1.1200",
            )
        queued = queue_market_order(
            state,
            operation_id="open-1",
            side="SELL",
            quantity="0.10",
            stop_loss="1.1100",
            take_profit="1.0900",
        )
        with self.assertRaisesRegex(ValueError, "exactly one bar"):
            advance_replay_execution(
                queued,
                bar={"timestamp": 180, "open": 1.1000, "high": 1.1010, "low": 1.0990, "close": 1.1000},
                cursor_index=4,
            )

    def test_invalid_ohlc_fails_closed_before_cursor_or_ledger_advance(self):
        state = initial_state()
        with self.assertRaisesRegex(ValueError, "invalid OHLC bar"):
            advance_replay_execution(
                state,
                bar={"timestamp": 60, "open": 1.1000, "high": 1.0990, "low": 1.1010, "close": 1.1000},
                cursor_index=1,
            )
        self.assertEqual(state.cursor_index, 0)
        self.assertEqual(state.ledger, [])

    def test_consumed_operation_id_cannot_open_a_second_position(self):
        state = queue_market_order(
            initial_state(),
            operation_id="open-once",
            side="BUY",
            quantity="0.10",
            stop_loss="1.0950",
            take_profit="1.1050",
        )
        closed = advance_replay_execution(
            state,
            bar={"timestamp": 60, "open": 1.1000, "high": 1.1060, "low": 1.0990, "close": 1.1050},
            cursor_index=1,
        ).snapshot
        self.assertIsNone(closed.position)
        with self.assertRaisesRegex(ValueError, "operation_id was already consumed"):
            queue_market_order(
                closed,
                operation_id="open-once",
                side="BUY",
                quantity="0.10",
                stop_loss="1.0950",
                take_profit="1.1200",
            )


if __name__ == "__main__":
    unittest.main()
