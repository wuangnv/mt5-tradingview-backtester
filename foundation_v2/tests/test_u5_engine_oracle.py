from __future__ import annotations

import sys
import time
import unittest
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch


HERE = Path(__file__).resolve()
WORKSPACE = next(parent for parent in HERE.parents if (parent / "projects" / "mt5-tradingview-backtester").is_dir())
PROJECT = WORKSPACE / "projects" / "mt5-tradingview-backtester"
FOUNDATION = PROJECT / "foundation_v2"
for entry in (str(PROJECT), str(FOUNDATION)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from trading_workspace_v2 import research_engine as engine


TIMEFRAME = 3600


def bar(timestamp, open_, high, low, close):
    return {
        "timestamp": timestamp,
        "open": open_,
        "high": high,
        "low": low,
        "close": close,
        "volume": 100,
    }


def instrument_fixture():
    return {
        "instrument_id": "ORACLE",
        "asset_class": "fx",
        "base_ccy": "EUR",
        "quote_ccy": "USD",
        "account_ccy": "USD",
        "tick_size": "0.05",
        "pip_size": "0.01",
        "contract_size": "1000",
        "quantity_min": "0.01",
        "quantity_step": "0.01",
        "effective_from_utc": "2026-01-01T00:00:00Z",
        "effective_to_utc": "",
    }


def cost_model_fixture():
    return {
        "version": "u5-oracle-cost-v1",
        "spread_basis": "bid_ask_embedded",
        "commission_per_side_account": "0.333",
        "minimum_fee_account": "0",
        "slippage_price_per_side": "0.0023",
        "financing_account": "0.0049",
        "quote_to_account_rate": "1.2345",
        "account_ccy": "USD",
        "rounding_decimals": 2,
    }


def protocol_for(rows, *, direction="both", hold_bars=1, lookback=2, timeframe_seconds=TIMEFRAME):
    return {
        "schema_version": "research-protocol-v1",
        "playbook": {
            "record_id": "u5-oracle-playbook",
            "revision": 1,
            "rules": {
                "engine": engine.ENGINE_VERSION,
                "lookback": lookback,
                "hold_bars": hold_bars,
                "direction": direction,
                "quantity": 0.03,
                "planned_stop_distance_price": 0.2,
            },
        },
        "dataset": {
            "dataset_id": "u5-oracle-dataset",
            "instrument_spec": instrument_fixture(),
            "timeframe_seconds": timeframe_seconds,
            "quality": {"disposition": "pass"},
            "source": {"provider": "u5-oracle"},
        },
        "range": {
            "from_utc": int(rows[0]["timestamp"]),
            "to_utc": int(rows[-1]["timestamp"]) + TIMEFRAME,
        },
        "starting_balance": 10_000,
        "parameters": {
            "spread_price": "0.02",
            "cost_model": cost_model_fixture(),
        },
        "engine": {
            "version": engine.ENGINE_VERSION,
            "code_sha256": engine.engine_code_sha256(),
        },
        "budget": {"max_bars": 100, "max_runtime_ms": 5_000},
    }


class U5EngineGoldenOracleTests(unittest.TestCase):
    def assert_decimal(self, actual, expected):
        self.assertEqual(Decimal(str(actual)), Decimal(expected))

    def test_long_next_open_fixed_horizon_cost_and_rounding_are_golden(self):
        rows = [
            bar(0, 9.80, 9.95, 9.70, 9.90),
            bar(3600, 9.90, 10.10, 9.85, 10.00),
            bar(7200, 10.00, 10.25, 9.95, 10.20),
            bar(10800, 10.03, 10.30, 10.00, 10.21),
        ]

        result = engine.execute_breakout(rows, protocol_for(rows, direction="long"))

        self.assertEqual(result["signals"], {"long": 1, "short": 0, "no_signal": 0, "skipped_overlap": 0})
        self.assertEqual(len(result["ledger"]), 1)
        trade = result["ledger"][0]
        self.assertEqual((trade["signal_time_utc"], trade["open_time_utc"], trade["close_time_utc"]), (10800, 10800, 14400))
        self.assertEqual(trade["side"], "BUY")

        # Hand oracle: half-spread=0.01, tick=0.05. BUY pays ceil(10.04)=10.05
        # and exits at floor(10.20)=10.20. Units=0.03*1000=30.
        self.assert_decimal(trade["price_open"], "10.05")
        self.assert_decimal(trade["price_close"], "10.20")
        self.assert_decimal(trade["gross_pnl"], "5.56")
        self.assert_decimal(trade["costs"]["commission_account"], "0.67")
        self.assert_decimal(trade["costs"]["slippage_account"], "0.17")
        self.assert_decimal(trade["costs"]["financing_account"], "0.00")
        self.assert_decimal(trade["fees"], "0.84")
        self.assert_decimal(trade["rounding_adjustment"], "-0.01")
        self.assert_decimal(trade["net_pnl"], "4.71")
        self.assert_decimal(
            Decimal(str(trade["gross_pnl"])) - Decimal(str(trade["fees"])) + Decimal(str(trade["rounding_adjustment"])),
            "4.71",
        )
        self.assert_decimal(trade["planned_risk_budget"], "7.407")
        self.assertEqual(trade["exit_model"], "fixed_horizon_bar_close")

    def test_short_entry_floor_exit_ceil_and_cost_are_golden(self):
        rows = [
            bar(0, 10.20, 10.30, 10.00, 10.10),
            bar(3600, 10.10, 10.20, 9.90, 10.00),
            bar(7200, 10.00, 10.05, 9.70, 9.80),
            bar(10800, 10.17, 10.20, 9.80, 9.93),
        ]

        result = engine.execute_breakout(rows, protocol_for(rows, direction="short"))

        self.assertEqual(result["signals"], {"long": 0, "short": 1, "no_signal": 0, "skipped_overlap": 0})
        trade = result["ledger"][0]
        self.assertEqual((trade["signal_time_utc"], trade["open_time_utc"], trade["close_time_utc"]), (10800, 10800, 14400))
        self.assertEqual(trade["side"], "SELL")

        # Hand oracle: SELL receives floor(10.16)=10.15 and covers at ceil(9.94)=9.95.
        self.assert_decimal(trade["price_open"], "10.15")
        self.assert_decimal(trade["price_close"], "9.95")
        self.assert_decimal(trade["gross_pnl"], "7.41")
        self.assert_decimal(trade["fees"], "0.84")
        self.assert_decimal(trade["rounding_adjustment"], "0.00")
        self.assert_decimal(trade["net_pnl"], "6.57")

    def test_no_signal_produces_no_ledger_entries(self):
        rows = [bar(index * TIMEFRAME, 10.0, 10.1, 9.9, 10.0) for index in range(6)]

        result = engine.execute_breakout(rows, protocol_for(rows))

        self.assertEqual(result["ledger"], [])
        self.assertEqual(result["signals"], {"long": 0, "short": 0, "no_signal": 3, "skipped_overlap": 0})

    def test_single_position_skips_signal_while_fixed_horizon_trade_is_open(self):
        rows = [
            bar(0, 10.00, 10.10, 9.90, 10.00),
            bar(3600, 10.00, 10.20, 9.90, 10.10),
            bar(7200, 10.10, 10.50, 10.00, 10.30),
            bar(10800, 10.30, 10.70, 10.20, 10.60),
            bar(14400, 10.60, 10.90, 10.50, 10.80),
            bar(18000, 10.80, 11.00, 10.70, 10.90),
        ]

        result = engine.execute_breakout(rows, protocol_for(rows, direction="long", hold_bars=2))

        self.assertEqual(len(result["ledger"]), 1)
        self.assertEqual(result["signals"], {"long": 2, "short": 0, "no_signal": 0, "skipped_overlap": 1})
        self.assertEqual(result["ledger"][0]["open_time_utc"], 10800)
        self.assertEqual(result["ledger"][0]["close_time_utc"], 18000)

    def test_sub_timeframe_rows_are_rejected_before_closed_bar_signal_use(self):
        rows = [
            bar(0, 10.0, 10.1, 9.9, 10.0),
            bar(3600, 10.0, 10.1, 9.9, 10.0),
            bar(5400, 10.0, 10.1, 9.9, 10.0),
            bar(9000, 10.0, 10.1, 9.9, 10.0),
        ]

        with self.assertRaisesRegex(engine.ResearchEngineValidationError, "overlap the declared timeframe"):
            engine.execute_breakout(rows, protocol_for(rows))

    def test_integer_rules_and_timeframe_reject_fractional_nonfinite_and_bool_values(self):
        base_rules = {
            "engine": engine.ENGINE_VERSION,
            "lookback": 2,
            "hold_bars": 1,
            "direction": "both",
            "quantity": 0.03,
            "planned_stop_distance_price": 0.2,
        }
        for field, invalid in (
            ("lookback", 2.5),
            ("lookback", "2.5"),
            ("lookback", float("nan")),
            ("hold_bars", float("inf")),
            ("hold_bars", True),
        ):
            with self.subTest(field=field, invalid=invalid):
                with self.assertRaisesRegex(engine.ResearchEngineValidationError, "positive integer"):
                    engine.validate_rules({**base_rules, field: invalid})

        rows = [bar(index * TIMEFRAME, 10.0, 10.1, 9.9, 10.0) for index in range(4)]
        with self.assertRaisesRegex(engine.ResearchEngineValidationError, "dataset.timeframe_seconds must be a positive integer"):
            engine.execute_breakout(rows, protocol_for(rows, timeframe_seconds=3600.5))

    def test_deadline_and_cancellation_fail_closed(self):
        rows = [bar(index * TIMEFRAME, 10.0, 10.1, 9.9, 10.0) for index in range(4)]
        protocol = protocol_for(rows)

        with self.assertRaisesRegex(engine.ResearchEngineValidationError, "max_runtime_ms"):
            engine.execute_breakout(rows, protocol, deadline=time.perf_counter() - 1.0)

        calls = 0

        def canceled():
            nonlocal calls
            calls += 1
            return False

        with self.assertRaisesRegex(engine.ResearchEngineInterrupted, "interrupted"):
            engine.execute_breakout(rows, protocol, continue_check=canceled)
        self.assertEqual(calls, 1)

    def test_hash_drift_covers_retained_cost_source_and_queued_protocol(self):
        baseline = engine.engine_code_sha256()
        original_read_bytes = Path.read_bytes

        def drifted_read_bytes(path):
            payload = original_read_bytes(path)
            if path.name == "data_costs.py":
                return payload + b"\n# u5 oracle synthetic dependency drift\n"
            return payload

        with patch.object(Path, "read_bytes", new=drifted_read_bytes):
            self.assertNotEqual(engine.engine_code_sha256(), baseline)

        rows = [bar(index * TIMEFRAME, 10.0, 10.1, 9.9, 10.0) for index in range(4)]
        protocol = protocol_for(rows)
        protocol["engine"]["code_sha256"] = "0" * 64
        with self.assertRaisesRegex(engine.ResearchEngineValidationError, "queued protocol"):
            engine.execute_breakout(rows, protocol)


if __name__ == "__main__":
    unittest.main()
