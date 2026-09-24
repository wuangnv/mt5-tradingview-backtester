from __future__ import annotations

import hashlib
import os
import time
import unittest
from decimal import Decimal

from foundation_v2.tests import test_u5_engine_oracle as oracle
from foundation_v2.tests import test_u5_engine_path2 as fixture
from trading_workspace_v2.artifacts import canonical_json_bytes
from trading_workspace_v2.nautilus_worker import (
    ADAPTER_VERSION,
    NAUTILUS_VERSION,
    adapter_hash,
    execute_native_process,
    normalize_native_result,
    runtime_identity,
    runtime_ready,
)
from trading_workspace_v2.research_engine import ResearchEngineValidationError, execute_breakout
from trading_workspace_v2.research_validation import ResearchReconciliationError, validate_engine_result


def protective_protocol(rows, *, direction="long", hold_bars=1, starting_balance=10_000, leverage=30):
    protocol = oracle.protocol_for(rows, direction=direction, hold_bars=hold_bars)
    protocol["playbook"]["rules"].update(
        exit_mode="protective",
        stop_loss_distance_price=0.2,
        take_profit_distance_price=0.3,
    )
    protocol["parameters"]["research_margin"] = {
        "version": "fixed-starting-balance-leverage-v1",
        "leverage": leverage,
    }
    protocol["split"] = "baseline"
    protocol["starting_balance"] = starting_balance
    protocol["dataset"]["artifact_sha256"] = "u5b-fixture-sha256"
    return protocol


def native_protocol(rows, **kwargs):
    protocol = protective_protocol(rows, **kwargs)
    protocol["engine"].update(
        backend="nautilus",
        native_version=NAUTILUS_VERSION,
        adapter_version=ADAPTER_VERSION,
        adapter_sha256=adapter_hash(),
        runtime_identity=runtime_identity(),
    )
    protocol["budget"]["max_memory_mb"] = 512
    return protocol


def validation_payload(engine_result, protocol):
    return {
        "artifact_schema_version": "research-engine-result-v1",
        "job_id": "u5b-direct",
        "workspace_id": "u5b-fixture",
        "dataset_id": protocol["dataset"]["dataset_id"],
        "dataset_sha256": protocol["dataset"]["artifact_sha256"],
        "protocol_sha256": hashlib.sha256(canonical_json_bytes(protocol)).hexdigest(),
        "protocol": protocol,
        "playbook_id": protocol["playbook"]["record_id"],
        "playbook_revision": protocol["playbook"]["revision"],
        "engine_version": protocol["engine"]["version"],
        "engine_code_sha256": protocol["engine"]["code_sha256"],
        "split": "baseline",
        "assumptions": engine_result["assumptions"],
        "signals": engine_result["signals"],
        "ledger": engine_result["ledger"],
        "metrics": engine_result["metrics"],
        "observed_range": engine_result["observed_range"],
        "execution": engine_result.get("execution", {}),
        "created_at_utc": "2026-09-22T00:00:00Z",
    }


@unittest.skipUnless(runtime_ready(), "isolated Nautilus runtime required")
class U5BProtectiveOracleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.long_base = [
            oracle.bar(0, 9.80, 9.95, 9.70, 9.90),
            oracle.bar(3600, 9.90, 10.10, 9.85, 10.00),
            oracle.bar(7200, 10.00, 10.25, 9.95, 10.20),
        ]
        cls.short_base = [
            oracle.bar(0, 10.20, 10.30, 10.00, 10.10),
            oracle.bar(3600, 10.10, 10.20, 9.90, 10.00),
            oracle.bar(7200, 10.00, 10.05, 9.70, 9.80),
        ]

    def run_pair(self, rows, **kwargs):
        reference_protocol = protective_protocol(rows, **kwargs)
        reference = execute_breakout(rows, reference_protocol)
        self.assertTrue(validate_engine_result(validation_payload(reference, reference_protocol), rows=rows)["reconciled"])

        protocol = native_protocol(rows, **kwargs)
        native = execute_native_process(
            rows,
            protocol,
            continue_check=lambda: True,
            deadline=time.perf_counter() + 10,
        )
        normalized = normalize_native_result(native, protocol)
        self.assertTrue(validate_engine_result(validation_payload(normalized, protocol), rows=rows)["reconciled"])
        business = lambda ledger: [{key: value for key, value in item.items() if key != "execution_link"} for item in ledger]
        self.assertEqual(reference["signals"], normalized["signals"])
        self.assertEqual(reference["metrics"], normalized["metrics"])
        self.assertEqual(business(reference["ledger"]), business(normalized["ledger"]))
        return reference, normalized, native

    def test_long_and_short_stop_and_take_profit_use_native_contingent_orders(self):
        cases = (
            ("long-stop", self.long_base + [oracle.bar(10800, 10.03, 10.20, 9.80, 10.00)], "long", "stop_loss", "STOP_MARKET", "9.85"),
            ("long-tp", self.long_base + [oracle.bar(10800, 10.03, 10.50, 9.95, 10.40)], "long", "take_profit", "LIMIT", "10.35"),
            ("short-stop", self.short_base + [oracle.bar(10800, 10.17, 10.40, 9.95, 10.20)], "short", "stop_loss", "STOP_MARKET", "10.35"),
            ("short-tp", self.short_base + [oracle.bar(10800, 10.17, 10.20, 9.70, 9.80)], "short", "take_profit", "LIMIT", "9.85"),
        )
        for name, rows, direction, reason, order_type, exit_price in cases:
            with self.subTest(name=name):
                _, normalized, native = self.run_pair(rows, direction=direction)
                trade = normalized["ledger"][0]
                entry_fill, exit_fill = native["fills"]
                self.assertEqual(trade["exit_reason"], reason)
                self.assertEqual(Decimal(str(trade["price_close"])), Decimal(exit_price))
                self.assertEqual(entry_fill["order_type"], "MARKET")
                self.assertEqual(exit_fill["order_type"], order_type)
                self.assertTrue(entry_fill["order_list_id"])
                self.assertEqual(entry_fill["order_list_id"], exit_fill["order_list_id"])
                self.assertEqual(exit_fill["timestamp_ns"], trade["close_time_utc"] * 10**9 - 1)

    def test_gap_stop_tp_and_horizon_are_explicit_and_reconcile(self):
        cases = (
            (
                "gap-stop",
                self.long_base + [oracle.bar(10800, 10.03, 10.20, 9.95, 10.10), oracle.bar(14400, 9.70, 9.90, 9.60, 9.80)],
                "stop_loss_gap",
                "9.65",
                "STOP_MARKET",
                14400 * 10**9 + 1,
            ),
            (
                "gap-tp",
                self.long_base + [oracle.bar(10800, 10.03, 10.20, 9.95, 10.10), oracle.bar(14400, 10.60, 10.70, 10.50, 10.65)],
                "take_profit_gap",
                "10.35",
                "LIMIT",
                14400 * 10**9 + 1,
            ),
            (
                "horizon",
                self.long_base + [oracle.bar(10800, 10.03, 10.20, 9.95, 10.10), oracle.bar(14400, 10.10, 10.20, 9.95, 10.15)],
                "horizon",
                "10.10",
                "MARKET",
                18000 * 10**9,
            ),
        )
        for name, rows, reason, exit_price, order_type, timestamp_ns in cases:
            with self.subTest(name=name):
                _, normalized, native = self.run_pair(rows, direction="long", hold_bars=2)
                trade = normalized["ledger"][0]
                self.assertEqual(trade["exit_reason"], reason)
                self.assertEqual(Decimal(str(trade["price_close"])), Decimal(exit_price))
                self.assertEqual(native["fills"][1]["order_type"], order_type)
                self.assertEqual(native["fills"][1]["timestamp_ns"], timestamp_ns)

    def test_same_bar_dual_hit_fails_closed_in_both_engines(self):
        rows = self.long_base + [oracle.bar(10800, 10.03, 10.50, 9.70, 10.10)]
        with self.assertRaisesRegex(ResearchEngineValidationError, "intrabar ambiguous"):
            execute_breakout(rows, protective_protocol(rows))
        with self.assertRaisesRegex(ResearchEngineValidationError, "intrabar ambiguous"):
            execute_native_process(
                rows,
                native_protocol(rows),
                continue_check=lambda: True,
                deadline=time.perf_counter() + 10,
            )

    def test_insufficient_research_margin_skips_without_publishing_trade(self):
        rows = self.long_base + [oracle.bar(10800, 10.03, 10.20, 9.95, 10.10)]
        reference, normalized, native = self.run_pair(rows, starting_balance=1, leverage=30)
        expected_margin = Decimal("10.05") * Decimal("30") * Decimal("1.2345") / Decimal("30")
        self.assertGreater(expected_margin, Decimal("1"))
        self.assertEqual(reference["ledger"], [])
        self.assertEqual(normalized["ledger"], [])
        self.assertEqual(native["fills"], [])
        self.assertEqual(reference["signals"]["skipped_margin"], 1)
        self.assertIn("not broker evidence", normalized["assumptions"]["margin_model"])

    def test_independent_signal_oracle_rejects_tampered_reference_margin_skip(self):
        rows = self.long_base + [oracle.bar(10800, 10.03, 10.20, 9.95, 10.10)]
        protocol = protective_protocol(rows, starting_balance=1, leverage=30)
        reference = execute_breakout(rows, protocol)
        payload = validation_payload(reference, protocol)
        payload["signals"]["skipped_margin"] = 0
        with self.assertRaisesRegex(ResearchReconciliationError, "signal counters"):
            validate_engine_result(payload, rows=rows)

    def test_independent_signal_oracle_rejects_matching_tampered_native_counters(self):
        rows = self.long_base + [oracle.bar(10800, 10.03, 10.20, 9.95, 10.10)]
        protocol = native_protocol(rows, starting_balance=1, leverage=30)
        native = execute_native_process(
            rows,
            protocol,
            continue_check=lambda: True,
            deadline=time.perf_counter() + 10,
        )
        normalized = normalize_native_result(native, protocol)
        payload = validation_payload(normalized, protocol)
        payload["signals"]["skipped_margin"] = 0
        payload["execution"]["signals"]["skipped_margin"] = 0
        with self.assertRaisesRegex(ResearchReconciliationError, "signal counters"):
            validate_engine_result(payload, rows=rows)

    def test_independent_oracle_rejects_tampered_margin_and_native_order_type(self):
        rows = self.long_base + [oracle.bar(10800, 10.03, 10.20, 9.80, 10.00)]
        protocol = native_protocol(rows)
        native = execute_native_process(
            rows,
            protocol,
            continue_check=lambda: True,
            deadline=time.perf_counter() + 10,
        )
        normalized = normalize_native_result(native, protocol)
        payload = validation_payload(normalized, protocol)

        payload["ledger"][0]["research_margin_required_account"] += 1
        with self.assertRaisesRegex(ResearchReconciliationError, "research_margin_required_account"):
            validate_engine_result(payload, rows=rows)

        payload = validation_payload(normalize_native_result(native, protocol), protocol)
        payload["execution"]["fills"][1]["order_type"] = "MARKET"
        with self.assertRaisesRegex(ResearchReconciliationError, "order type"):
            validate_engine_result(payload, rows=rows)


@unittest.skipUnless(os.getenv("TW_V2_DATABASE_URL") and runtime_ready(), "Nautilus and disposable DB required")
class U5BProtectiveIntegrationTests(unittest.TestCase):
    setUpClass = fixture.U5EnginePath2Tests.__dict__["setUpClass"]
    setUp = fixture.U5EnginePath2Tests.setUp
    tearDown = fixture.U5EnginePath2Tests.tearDown
    import_dataset = fixture.U5EnginePath2Tests.import_dataset
    engine_request = fixture.U5EnginePath2Tests.engine_request

    def create_protective_playbook(self):
        created = self.client.post(
            "/api/v2/playbooks",
            headers=self.headers,
            json={
                "name": "Protective breakout",
                "status": "draft",
                "execution_capability": "engine-supported",
                "rules": {
                    "engine": "bar-breakout-v1",
                    "lookback": 2,
                    "hold_bars": 1,
                    "direction": "both",
                    "quantity": 0.1,
                    "planned_stop_distance_price": 0.5,
                    "exit_mode": "protective",
                    "stop_loss_distance_price": 0.5,
                    "take_profit_distance_price": 0.5,
                },
            },
        )
        self.assertEqual(created.status_code, 201, created.text)
        frozen = self.client.post(
            f"/api/v2/playbooks/{created.json()['record_id']}/freeze",
            headers=self.headers,
            json={"expected_revision": 1},
        )
        self.assertEqual(frozen.status_code, 200, frozen.text)
        return frozen.json()

    def test_api_requires_margin_assumption_and_publishes_reconciled_protective_result(self):
        manifest = self.import_dataset()
        playbook = self.create_protective_playbook()
        request = self.engine_request(manifest, playbook, engine_backend="nautilus", max_runtime_ms=15_000)
        missing = self.client.post("/api/v2/research/engine-jobs", headers=self.headers, json=request)
        self.assertEqual(missing.status_code, 422)
        self.assertIn("research_leverage", missing.json()["detail"])

        queued = self.client.post(
            "/api/v2/research/engine-jobs",
            headers=self.headers,
            json={**request, "research_leverage": 30},
        )
        self.assertEqual(queued.status_code, 202, queued.text)
        result = self.client.app.state.service.run_one()
        self.assertIsNotNone(result)
        self.assertTrue(result.ledger)
        self.assertTrue(all(trade["exit_model"] == "protective_bracket" for trade in result.ledger))
        self.assertTrue(all(trade["exit_reason"] == "horizon" for trade in result.ledger))
        self.assertEqual(result.protocol["parameters"]["research_margin"]["leverage"], 30.0)
        self.assertIn("not broker evidence", result.assumptions["margin_model"])
        self.assertTrue(all(fill["order_type"] == expected for fill, expected in zip(result.execution["fills"], ["MARKET", "MARKET"] * len(result.ledger))))


if __name__ == "__main__":
    unittest.main(verbosity=2)
