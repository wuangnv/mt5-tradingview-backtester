from __future__ import annotations

import copy
import hashlib
import json
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
for entry in (str(ROOT), str(V2)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from trading_workspace_v2.artifacts import canonical_json_bytes
from trading_workspace_v2.contracts import CreateEngineResearchJob, DatasetManifest, DatasetSource
from trading_workspace_v2.research import ResearchService
from trading_workspace_v2.research_engine import ResearchEngineInterrupted, ResearchEngineValidationError
from trading_workspace_v2.research_oos import (
    ResearchValidationPlanError,
    build_bounded_sweep,
    build_cost_fill_stress_plan,
    build_regime_partition,
    build_walk_forward_plan,
    complete_canceled_sweep_outcomes,
    summarize_sweep_outcomes,
)
from trading_workspace_v2.store import ClaimedJob, _oos_cancellation_state


TIMEFRAME = 60


def rows(count: int) -> list[dict]:
    return [{"timestamp": index * TIMEFRAME, "close": 100 + index} for index in range(count)]


def engine_rows(count: int) -> list[dict]:
    return [
        {
            "timestamp": index * TIMEFRAME,
            "open": 100 + index,
            "high": 101 + index,
            "low": 99 + index,
            "close": 100.5 + index,
        }
        for index in range(count)
    ]


def manifest_fixture(count: int = 16) -> DatasetManifest:
    return DatasetManifest(
        dataset_id="dataset-u5c",
        workspace_id="tenant-a",
        source=DatasetSource(
            source_id="u5c-fixture",
            provider="offline-fixture",
            instrument_mapping={"EURUSD": "EURUSD"},
            license_use="test-only",
            retrieved_at_utc="2026-09-25T00:00:00Z",
            export_settings="u5c",
        ),
        instrument_id="EURUSD",
        timeframe="1m",
        row_count=count,
        first_timestamp=0,
        last_timestamp=(count - 1) * TIMEFRAME,
        artifact_path="dataset.json",
        artifact_sha256="dataset-sha",
        normalized_sha256="normalized-sha",
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
        timeframe_seconds=TIMEFRAME,
        quality={"disposition": "pass"},
        holdout_policy={"mode": "metadata_only", "from_utc": count * TIMEFRAME},
        transform_version="u5c-fixture-v1",
        created_at_utc="2026-09-25T00:00:00Z",
    )


def engine_request(manifest: DatasetManifest) -> CreateEngineResearchJob:
    return CreateEngineResearchJob(
        dataset_id=manifest.dataset_id,
        playbook_id="playbook-u5c",
        playbook_revision=1,
        starting_balance=10_000,
        data_from_utc=0,
        data_to_utc=manifest.row_count * TIMEFRAME,
        split="validation",
        engine_backend="reference",
        seed=7,
        spread_price=0,
        cost_model={
            "version": "fixture-cost-v1",
            "spread_basis": "bid_ask_embedded",
            "commission_per_side_account": 0,
            "minimum_fee_account": 0,
            "slippage_price_per_side": 0,
            "financing_account": 0,
            "quote_to_account_rate": 1,
            "account_ccy": "USD",
            "rounding_decimals": 2,
        },
        max_bars=100,
        max_runtime_ms=5_000,
    )


def oos_engine_request(manifest: DatasetManifest) -> CreateEngineResearchJob:
    return engine_request(manifest).model_copy(
        update={
            "walk_forward": {
                "train_bars": 8,
                "oos_bars": 4,
                "purge_bars": 1,
                "embargo_bars": 1,
                "max_folds": 2,
            },
            "parameter_space": {"lookback": [2, 3], "hold_bars": [1, 2]},
            "max_trials": 3,
        }
    )


class _FakeArtifacts:
    def __init__(self, fixture_rows: list[dict]):
        self.rows = fixture_rows
        self.result_payload = None
        self.read_calls = 0

    def read_dataset_range(self, _path, _checksum, *, from_utc, to_utc, max_bars, continue_check=None):
        self.read_calls += 1
        selected = [row for row in self.rows if from_utc <= row["timestamp"] < to_utc]
        if len(selected) > max_bars:
            raise ValueError("run exceeded budget.max_bars")
        if continue_check is not None:
            continue_check()
        return selected

    def write_result_candidate(self, _workspace_id, _job_id, _attempt_no, _lease_token, payload):
        self.result_payload = payload
        return "result.json", hashlib.sha256(canonical_json_bytes(payload)).hexdigest()

    def quarantine_result_candidate(self, _path):
        return None


class _FakeStore:
    def __init__(self, manifest: DatasetManifest):
        self.manifest = manifest
        self.created = None
        self.checkpoints = []

    def get_dataset(self, workspace_id, dataset_id):
        if workspace_id == self.manifest.workspace_id and dataset_id == self.manifest.dataset_id:
            return self.manifest
        return None

    def get_record_revision(self, workspace_id, kind, record_id, revision):
        if (workspace_id, kind, record_id, revision) != ("tenant-a", "playbook", "playbook-u5c", 1):
            return None
        return {
            "deleted": False,
            "payload": {
                "name": "U5c breakout",
                "status": "frozen",
                "execution_capability": "engine-supported",
                "rules": {
                    "engine": "bar-breakout-v1",
                    "lookback": 2,
                    "hold_bars": 1,
                    "direction": "both",
                    "quantity": 0.1,
                    "planned_stop_distance_price": 0.5,
                },
            },
        }

    def create_engine_job(self, workspace_id, dataset_id, starting_balance, protocol, protocol_sha256):
        self.created = SimpleNamespace(
            workspace_id=workspace_id,
            job_id="job-u5c",
            dataset_id=dataset_id,
            strategy_version="bar-breakout-v1",
            starting_balance=starting_balance,
            protocol=protocol,
            protocol_sha256=protocol_sha256,
        )
        return self.created

    def is_cancel_requested(self, _workspace_id, _job_id):
        return False

    def renew_job_lease(self, _job, _lease_seconds):
        return True

    def update_job_checkpoint(self, _job, *, checkpoint, progress=None):
        self.checkpoints.append((checkpoint, progress))
        return True

    def complete_job(self, _job, _path, _checksum):
        return True


class U5cWalkForwardTests(unittest.TestCase):
    def test_expanding_walk_forward_is_chronological_with_purge_and_embargo(self):
        plan = build_walk_forward_plan(
            rows(24),
            timeframe_seconds=TIMEFRAME,
            train_bars=8,
            oos_bars=4,
            step_bars=4,
            purge_bars=2,
            embargo_bars=1,
            overlap_bars=2,
            max_folds=3,
        )

        self.assertEqual(plan["fold_count"], 3)
        first, second, third = plan["folds"]
        self.assertEqual((first["train"]["start_index"], first["train"]["stop_index"]), (0, 6))
        self.assertEqual((first["purge"]["start_index"], first["purge"]["stop_index"]), (6, 8))
        self.assertEqual((first["embargo"]["start_index"], first["embargo"]["stop_index"]), (8, 9))
        self.assertEqual((first["oos"]["start_index"], first["oos"]["stop_index"]), (9, 13))
        self.assertEqual(second["train"]["start_index"], 0)
        self.assertEqual(second["oos"]["start_index"], 13)
        self.assertEqual(third["oos"]["start_index"], 17)
        for fold in plan["folds"]:
            self.assertLessEqual(fold["train"]["to_utc"], fold["oos"]["from_utc"])

    def test_rolling_walk_forward_keeps_fixed_training_width_before_purge(self):
        plan = build_walk_forward_plan(
            rows(22),
            timeframe_seconds=TIMEFRAME,
            train_bars=8,
            oos_bars=3,
            step_bars=3,
            purge_bars=1,
            embargo_bars=1,
            expanding=False,
            max_folds=3,
        )

        self.assertEqual(plan["folds"][0]["train"]["start_index"], 0)
        self.assertEqual(plan["folds"][1]["train"]["start_index"], 3)
        self.assertEqual(plan["folds"][2]["train"]["start_index"], 6)
        self.assertTrue(all(fold["train"]["bar_count"] == 7 for fold in plan["folds"]))

    def test_known_overlap_requires_matching_purge(self):
        with self.assertRaisesRegex(ResearchValidationPlanError, "smaller than the declared overlap"):
            build_walk_forward_plan(
                rows(20),
                timeframe_seconds=TIMEFRAME,
                train_bars=8,
                oos_bars=4,
                purge_bars=1,
                overlap_bars=2,
            )

    def test_locked_holdout_is_metadata_only_and_never_opened(self):
        plan = build_walk_forward_plan(
            rows(16),
            timeframe_seconds=TIMEFRAME,
            train_bars=8,
            oos_bars=4,
            purge_bars=1,
            embargo_bars=1,
            holdout_policy={"mode": "metadata_only", "from_utc": 16 * TIMEFRAME},
        )
        self.assertEqual(plan["holdout"], {"access": False, "from_utc": 16 * TIMEFRAME})

        with self.assertRaisesRegex(ResearchValidationPlanError, "reach locked holdout"):
            build_walk_forward_plan(
                rows(17),
                timeframe_seconds=TIMEFRAME,
                train_bars=8,
                oos_bars=4,
                purge_bars=1,
                holdout_policy={"mode": "metadata_only", "from_utc": 16 * TIMEFRAME},
            )
        with self.assertRaisesRegex(ResearchValidationPlanError, "never authorizes holdout"):
            build_walk_forward_plan(
                rows(16),
                timeframe_seconds=TIMEFRAME,
                train_bars=8,
                oos_bars=4,
                holdout_policy={"mode": "unlocked", "from_utc": 16 * TIMEFRAME},
            )

    def test_nonchronological_rows_fail_closed(self):
        fixture = rows(16)
        fixture[4], fixture[5] = fixture[5], fixture[4]
        with self.assertRaisesRegex(ResearchValidationPlanError, "strictly chronological"):
            build_walk_forward_plan(
                fixture,
                timeframe_seconds=TIMEFRAME,
                train_bars=8,
                oos_bars=4,
            )


class U5cRegimePartitionTests(unittest.TestCase):
    def regime_rows(self, count=8):
        labels = ["trend", "trend", "range", "range", "trend", "trend", "volatile", "volatile"]
        return [
            {
                "timestamp": index * TIMEFRAME,
                "close": 100 + index,
                "regime": labels[index],
                "regime_known_at": index * TIMEFRAME,
            }
            for index in range(count)
        ]

    def test_partition_is_deterministic_bounded_and_as_of(self):
        fixture = self.regime_rows()
        first = build_regime_partition(
            fixture,
            timeframe_seconds=TIMEFRAME,
            holdout_policy={"mode": "metadata_only", "from_utc": len(fixture) * TIMEFRAME},
        )
        second = build_regime_partition(
            copy.deepcopy(fixture),
            timeframe_seconds=TIMEFRAME,
            holdout_policy={"mode": "metadata_only", "from_utc": len(fixture) * TIMEFRAME},
        )

        self.assertEqual(first, second)
        self.assertEqual(first["schema"], "regime-segmentation-v1")
        self.assertEqual(first["causal_status"], "as-of")
        self.assertEqual(first["holdout"]["access"], False)
        self.assertEqual(first["label_count"], 3)
        self.assertEqual(first["segment_count"], 4)
        self.assertEqual(
            [(segment["label"], segment["start_index"], segment["stop_index"])
             for segment in first["segments"]],
            [("trend", 0, 2), ("range", 2, 4), ("trend", 4, 6), ("volatile", 6, 8)],
        )
        self.assertEqual(first["labels"], [
            {"label": "range", "bar_count": 2, "segment_count": 1},
            {"label": "trend", "bar_count": 4, "segment_count": 2},
            {"label": "volatile", "bar_count": 2, "segment_count": 1},
        ])

    def test_future_known_at_and_missing_metadata_fail_closed(self):
        future = self.regime_rows()
        future[3]["regime_known_at"] = future[3]["timestamp"] + TIMEFRAME
        with self.assertRaisesRegex(ResearchValidationPlanError, "later than"):
            build_regime_partition(future, timeframe_seconds=TIMEFRAME)

        missing = self.regime_rows()
        del missing[2]["regime_known_at"]
        with self.assertRaisesRegex(ResearchValidationPlanError, "nonnegative integer"):
            build_regime_partition(missing, timeframe_seconds=TIMEFRAME)

    def test_partition_rejects_unbounded_labels_segments_and_locked_rows(self):
        too_many_labels = self.regime_rows()
        too_many_labels[0]["regime"] = "r0"
        too_many_labels[1]["regime"] = "r1"
        too_many_labels[2]["regime"] = "r2"
        with self.assertRaisesRegex(ResearchValidationPlanError, "label count"):
            build_regime_partition(too_many_labels, timeframe_seconds=TIMEFRAME, max_regimes=2)

        too_many_segments = self.regime_rows()
        for index, row in enumerate(too_many_segments):
            row["regime"] = f"r{index % 2}"
        with self.assertRaisesRegex(ResearchValidationPlanError, "segment count"):
            build_regime_partition(too_many_segments, timeframe_seconds=TIMEFRAME, max_segments=2)

        locked = self.regime_rows()
        with self.assertRaisesRegex(ResearchValidationPlanError, "locked holdout"):
            build_regime_partition(
                locked,
                timeframe_seconds=TIMEFRAME,
                holdout_policy={"mode": "metadata_only", "from_utc": 7 * TIMEFRAME},
            )


class U5cBoundedSweepTests(unittest.TestCase):
    def test_sweep_is_deterministic_bounded_and_reports_truncation(self):
        sweep = build_bounded_sweep(
            {"lookback": [2, 4, 8], "hold_bars": [1, 2]},
            max_trials=4,
        )

        self.assertEqual(sweep["search_space_size"], 6)
        self.assertEqual(sweep["trial_count"], 4)
        self.assertTrue(sweep["truncated"])
        self.assertEqual(
            [trial["parameters"] for trial in sweep["trials"]],
            [
                {"hold_bars": 1, "lookback": 2},
                {"hold_bars": 1, "lookback": 4},
                {"hold_bars": 1, "lookback": 8},
                {"hold_bars": 2, "lookback": 2},
            ],
        )

    def test_outcome_accounting_keeps_failed_and_canceled_trials(self):
        sweep = build_bounded_sweep({"lookback": [2, 4, 8]}, max_trials=3)
        summary = summarize_sweep_outcomes(
            sweep,
            [
                {"trial_id": "trial-0001", "status": "completed"},
                {"trial_id": "trial-0002", "status": "failed"},
                {"trial_id": "trial-0003", "status": "canceled"},
            ],
        )
        self.assertTrue(summary["fully_accounted"])
        self.assertEqual(summary["status_counts"], {"canceled": 1, "completed": 1, "failed": 1})

        with self.assertRaisesRegex(ResearchValidationPlanError, "every planned trial"):
            summarize_sweep_outcomes(
                sweep,
                [
                    {"trial_id": "trial-0001", "status": "completed"},
                    {"trial_id": "trial-0002", "status": "failed"},
                ],
            )

    def test_malformed_persisted_trial_plan_fails_with_typed_validation_error(self):
        for malformed in (
            {"trials": [None]},
            {"trials": ["trial-0001"]},
            {"trials": [{"trial_id": ""}]},
        ):
            with self.subTest(malformed=malformed):
                with self.assertRaisesRegex(ResearchValidationPlanError, "invalid trial identities"):
                    summarize_sweep_outcomes(malformed, [])
                with self.assertRaisesRegex(ResearchValidationPlanError, "invalid trial identities"):
                    complete_canceled_sweep_outcomes(malformed, [])


class U5cStressPlanTests(unittest.TestCase):
    def test_cost_fill_stress_plan_is_bounded_deterministic_and_normalized(self):
        declared = [
            {
                "scenario_id": "wide-fill",
                "spread_price_multiplier": 2,
                "slippage_multiplier": "3.0",
            },
            {
                "scenario_id": "fee-shock",
                "commission_multiplier": 4,
                "minimum_fee_multiplier": 2,
                "financing_multiplier": 1.5,
            },
        ]
        first = build_cost_fill_stress_plan(declared)
        second = build_cost_fill_stress_plan(copy.deepcopy(declared))
        self.assertEqual(first, second)
        self.assertEqual([item["scenario_id"] for item in first["scenarios"]], ["base", "wide-fill", "fee-shock"])
        self.assertEqual(first["scenarios"][1]["spread_price_multiplier"], "2")
        self.assertEqual(first["scenarios"][1]["slippage_multiplier"], "3")
        self.assertEqual(first["scenario_count"], 3)

        with self.assertRaisesRegex(ResearchValidationPlanError, "between 0 and 10"):
            build_cost_fill_stress_plan([{"scenario_id": "unbounded", "spread_price_multiplier": 11}])
        with self.assertRaisesRegex(ResearchValidationPlanError, "at most 7"):
            build_cost_fill_stress_plan([{"scenario_id": f"s-{index}", "spread_price_multiplier": 2} for index in range(8)])
        with self.assertRaisesRegex(ResearchValidationPlanError, "change at least one"):
            build_cost_fill_stress_plan([{"scenario_id": "no-op"}])


class U5cResearchJobWiringTests(unittest.TestCase):
    def setUp(self):
        self.manifest = manifest_fixture()
        self.fixture_rows = engine_rows(self.manifest.row_count)
        self.store = _FakeStore(self.manifest)
        self.artifacts = _FakeArtifacts(self.fixture_rows)
        self.service = ResearchService(self.store, self.artifacts, worker_id="u5c-worker", lease_seconds=60)

    def create_job(self):
        return self.service.create_oos_engine_job(
            workspace_id="tenant-a",
            request=engine_request(self.manifest),
            walk_forward={
                "train_bars": 8,
                "oos_bars": 4,
                "purge_bars": 1,
                "embargo_bars": 1,
                "max_folds": 2,
            },
            parameter_space={"lookback": [2, 3], "hold_bars": [1, 2]},
            max_trials=3,
        )

    def test_api_contract_carries_optional_oos_configuration_without_changing_default_jobs(self):
        regular = engine_request(self.manifest)
        self.assertIsNone(regular.walk_forward)
        self.assertIsNone(regular.parameter_space)
        self.assertIsNone(regular.max_trials)

        oos = oos_engine_request(self.manifest)
        job = self.service.create_engine_job(
            workspace_id="tenant-a",
            request=oos,
            walk_forward=oos.walk_forward,
            parameter_space=oos.parameter_space,
            max_trials=oos.max_trials,
        )
        self.assertEqual(job.protocol["validation"]["schema"], "research-oos-validation-v1")
        self.assertFalse(job.protocol["validation"]["holdout_access"])

    def test_oos_configuration_requires_validation_split(self):
        payload = engine_request(self.manifest).model_dump(mode="python")
        payload.update(
            {
                "split": "baseline",
                "walk_forward": {"train_bars": 8, "oos_bars": 4},
                "parameter_space": {"lookback": [2]},
                "max_trials": 1,
            }
        )
        with self.assertRaisesRegex(ValueError, "split=validation"):
            CreateEngineResearchJob(**payload)

        bypassed = engine_request(self.manifest).model_copy(update={"split": "baseline"})
        with self.assertRaisesRegex(ValueError, "split=validation"):
            self.service.create_oos_engine_job(
                workspace_id="tenant-a",
                request=bypassed,
                walk_forward={"train_bars": 8, "oos_bars": 4},
                parameter_space={"lookback": [2]},
                max_trials=1,
            )

    def test_oos_job_queues_request_only_protocol_without_reading_dataset(self):
        job = self.create_job()

        validation = job.protocol["validation"]
        self.assertEqual(validation["schema"], "research-oos-validation-v1")
        self.assertFalse(validation["holdout_access"])
        self.assertNotIn("walk_forward", validation)
        self.assertEqual(
            validation["walk_forward_request"],
            {
                "train_bars": 8,
                "oos_bars": 4,
                "step_bars": 4,
                "purge_bars": 1,
                "embargo_bars": 1,
                "overlap_bars": 0,
                "expanding": True,
                "max_folds": 2,
            },
        )
        self.assertEqual(validation["sweep"]["trial_count"], 3)
        self.assertTrue(validation["sweep"]["truncated"])
        self.assertEqual(self.artifacts.read_calls, 0)
        self.assertEqual(
            validation["selection"],
            {
                "mode": "none",
                "objective": None,
                "ranking": False,
                "winner": None,
                "automatic_selection": False,
                "reason": "objective_not_predeclared",
            },
        )
        self.assertEqual(job.protocol_sha256, hashlib.sha256(canonical_json_bytes(job.protocol)).hexdigest())

    def test_worker_executes_bounded_train_oos_matrix_with_same_trial_parameters(self):
        queued = self.create_job()
        claimed = ClaimedJob(
            workspace_id=queued.workspace_id,
            job_id=queued.job_id,
            dataset_id=queued.dataset_id,
            strategy_version=queued.strategy_version,
            starting_balance=queued.starting_balance,
            protocol=queued.protocol,
            protocol_sha256=queued.protocol_sha256,
            attempt_no=1,
            lease_owner="u5c-worker",
            lease_token="lease-u5c",
        )
        calls = []

        def fake_engine(slice_rows, protocol, *, continue_check=None, deadline=None):
            calls.append(
                {
                    "timestamps": [row["timestamp"] for row in slice_rows],
                    "protocol": copy.deepcopy(protocol),
                }
            )
            return {
                "assumptions": {},
                "signals": {"long": 0, "short": 0, "no_signal": len(slice_rows), "skipped_overlap": 0},
                "ledger": [],
                "metrics": {"metric_schema_version": "metrics-v2"},
                "observed_range": {
                    "from_utc": slice_rows[0]["timestamp"],
                    "to_utc": slice_rows[-1]["timestamp"] + TIMEFRAME,
                    "bar_count": len(slice_rows),
                },
                "execution": {},
            }

        with (
            patch("trading_workspace_v2.research.verify_engine_code"),
            patch("trading_workspace_v2.research.execute_breakout", side_effect=fake_engine),
            patch("trading_workspace_v2.research.validate_engine_result", return_value={"reconciled": True}),
        ):
            result = self.service.execute_claimed(claimed)

        self.assertIsNotNone(result)
        self.assertEqual(self.artifacts.read_calls, 1)
        self.assertEqual(result.artifact_schema_version, "research-oos-result-v1")
        self.assertEqual(result.selection["mode"], "none")
        self.assertFalse(result.selection["ranking"])
        self.assertIsNone(result.selection["winner"])
        self.assertNotIn("observed_range", result.model_dump(mode="json"))
        self.assertEqual(
            result.source_range,
            {
                "from_utc": 0,
                "to_utc": self.manifest.row_count * TIMEFRAME,
                "bar_count": self.manifest.row_count,
                "elapsed_ms": result.source_range["elapsed_ms"],
            },
        )
        self.assertEqual(result.outcome_summary["fully_accounted"], True)
        self.assertEqual(len(result.trials), 3)
        self.assertTrue(all(trial["status"] == "completed" for trial in result.trials))
        self.assertEqual(len(calls), 6)
        for train_call, oos_call in zip(calls[::2], calls[1::2]):
            train_protocol = train_call["protocol"]
            oos_protocol = oos_call["protocol"]
            self.assertEqual(train_protocol["split"], "train")
            self.assertEqual(oos_protocol["split"], "validation")
            self.assertNotIn("validation", train_protocol)
            self.assertNotIn("validation", oos_protocol)
            self.assertEqual(train_protocol["playbook"]["rules"], oos_protocol["playbook"]["rules"])
            self.assertEqual(train_protocol["range"], {"from_utc": 0, "to_utc": 7 * TIMEFRAME})
            self.assertEqual(oos_protocol["range"], {"from_utc": 9 * TIMEFRAME, "to_utc": 13 * TIMEFRAME})
            self.assertEqual(train_call["timestamps"], list(range(0, 7 * TIMEFRAME, TIMEFRAME)))
            self.assertEqual(oos_call["timestamps"], list(range(9 * TIMEFRAME, 13 * TIMEFRAME, TIMEFRAME)))
            self.assertLessEqual(oos_protocol["range"]["to_utc"], self.manifest.holdout_policy["from_utc"])
        self.assertNotIn('"ledger"', json.dumps(self.artifacts.result_payload, sort_keys=True))
        checkpoint, progress = next(
            item for item in self.store.checkpoints if item[0]["phase"] == "oos-validation-verified"
        )
        self.assertEqual(checkpoint["validation_schema"], "research-oos-validation-v1")
        self.assertFalse(checkpoint["holdout_access"])
        self.assertEqual(checkpoint["fold_count"], 1)
        self.assertEqual(checkpoint["trial_count"], 3)
        self.assertTrue(checkpoint["sweep_truncated"])
        self.assertEqual(progress, {"phase_index": 3, "phase_count": 5})
        self.assertEqual(self.store.checkpoints[-1][1], {"phase_index": 5, "phase_count": 5})
        for phase in ("result-validated", "candidate-ready"):
            terminal_checkpoint = next(
                checkpoint for checkpoint, _progress in self.store.checkpoints if checkpoint["phase"] == phase
            )
            self.assertEqual(
                terminal_checkpoint["trial_outcomes"],
                [
                    {"trial_id": "trial-0001", "status": "completed"},
                    {"trial_id": "trial-0002", "status": "completed"},
                    {"trial_id": "trial-0003", "status": "completed"},
                ],
            )
            self.assertEqual(
                terminal_checkpoint["trial_status_counts"],
                {"canceled": 0, "completed": 3, "failed": 0},
            )
            self.assertEqual(terminal_checkpoint["trial_count"], 3)
            self.assertTrue(terminal_checkpoint["fully_accounted"])

    def test_worker_runs_pinned_cost_fill_stress_matrix_pre_holdout_without_ranking(self):
        request = engine_request(self.manifest).model_copy(
            update={
                "spread_price": 0.0002,
                "cost_model": {
                    **engine_request(self.manifest).cost_model,
                    "commission_per_side_account": 1,
                    "minimum_fee_account": 0.5,
                    "slippage_price_per_side": 0.0001,
                    "financing_account": 0.2,
                },
            }
        )
        job = self.service.create_oos_engine_job(
            workspace_id="tenant-a",
            request=request,
            walk_forward={
                "train_bars": 8,
                "oos_bars": 4,
                "purge_bars": 1,
                "embargo_bars": 1,
                "max_folds": 1,
                "stress_scenarios": [
                    {
                        "scenario_id": "wide-fill",
                        "spread_price_multiplier": 2,
                        "slippage_multiplier": 3,
                    },
                    {
                        "scenario_id": "fee-shock",
                        "commission_multiplier": 4,
                        "minimum_fee_multiplier": 2,
                    },
                ],
            },
            parameter_space={"lookback": [2]},
            max_trials=1,
        )
        validation = job.protocol["validation"]
        self.assertEqual(validation["stress"]["scenario_count"], 3)
        self.assertEqual(
            validation["stress_config_sha256"],
            hashlib.sha256(canonical_json_bytes(validation["stress"])).hexdigest(),
        )
        self.assertFalse(validation["selection"]["ranking"])
        self.assertIsNone(validation["selection"]["winner"])

        claimed = ClaimedJob(
            workspace_id=job.workspace_id,
            job_id=job.job_id,
            dataset_id=job.dataset_id,
            strategy_version=job.strategy_version,
            starting_balance=job.starting_balance,
            protocol=job.protocol,
            protocol_sha256=job.protocol_sha256,
            attempt_no=1,
            lease_owner="u5c-worker",
            lease_token="lease-u5c",
        )
        calls = []

        def fake_engine(slice_rows, protocol, *, continue_check=None, deadline=None):
            calls.append(copy.deepcopy(protocol))
            return {
                "assumptions": {},
                "signals": {"long": 0, "short": 0, "no_signal": len(slice_rows), "skipped_overlap": 0},
                "ledger": [],
                "metrics": {"metric_schema_version": "metrics-v2"},
                "observed_range": {
                    "from_utc": slice_rows[0]["timestamp"],
                    "to_utc": slice_rows[-1]["timestamp"] + TIMEFRAME,
                    "bar_count": len(slice_rows),
                },
                "execution": {},
            }

        with (
            patch("trading_workspace_v2.research.verify_engine_code"),
            patch("trading_workspace_v2.research.execute_breakout", side_effect=fake_engine),
            patch("trading_workspace_v2.research.validate_engine_result", return_value={"reconciled": True}),
        ):
            result = self.service.execute_claimed(claimed)

        self.assertEqual(len(calls), 6)
        scenarios = [calls[index]["stress_scenario"]["scenario_id"] for index in range(0, len(calls), 2)]
        self.assertEqual(scenarios, ["base", "wide-fill", "fee-shock"])
        for call in calls:
            self.assertLessEqual(call["range"]["to_utc"], self.manifest.holdout_policy["from_utc"] )
            self.assertNotIn("validation", call)
        wide = next(call for call in calls if call["stress_scenario"]["scenario_id"] == "wide-fill")
        self.assertEqual(wide["parameters"]["spread_price"], "0.0004")
        self.assertEqual(wide["parameters"]["cost_model"]["slippage_price_per_side"], "0.0003")
        self.assertIn("stress:wide-fill", wide["parameters"]["cost_model"]["version"] )
        fee = next(call for call in calls if call["stress_scenario"]["scenario_id"] == "fee-shock")
        self.assertEqual(fee["parameters"]["cost_model"]["commission_per_side_account"], "4")
        self.assertEqual(fee["parameters"]["cost_model"]["minimum_fee_account"], "1")
        self.assertFalse(result.selection["ranking"] )
        self.assertIsNone(result.selection["winner"] )
        fold = result.trials[0]["folds"][0]
        self.assertEqual([item["scenario_id"] for item in fold["stress_scenarios"]], ["base", "wide-fill", "fee-shock"])
        self.assertTrue(all(item["status"] == "completed" for item in fold["stress_scenarios"]))

    def test_rehashed_stress_plan_tamper_fails_closed(self):
        request = engine_request(self.manifest)
        job = self.service.create_oos_engine_job(
            workspace_id="tenant-a",
            request=request,
            walk_forward={
                "train_bars": 8,
                "oos_bars": 4,
                "stress_scenarios": [{"scenario_id": "wide-fill", "spread_price_multiplier": 2}],
            },
            parameter_space={"lookback": [2]},
            max_trials=1,
        )
        tampered = copy.deepcopy(job.protocol)
        tampered["validation"]["stress"]["scenarios"][1]["spread_price_multiplier"] = "9"
        claimed = ClaimedJob(
            workspace_id=job.workspace_id,
            job_id=job.job_id,
            dataset_id=job.dataset_id,
            strategy_version=job.strategy_version,
            starting_balance=job.starting_balance,
            protocol=tampered,
            protocol_sha256=hashlib.sha256(canonical_json_bytes(tampered)).hexdigest(),
            attempt_no=1,
            lease_owner="u5c-worker",
            lease_token="lease-u5c",
        )
        with self.assertRaisesRegex(ResearchEngineValidationError, "changed after job creation"):
            self.service.execute_claimed(claimed)

    def test_terminal_oos_checkpoint_keeps_completed_trials_when_cancel_arrives_late(self):
        queued = self.create_job()
        completed = [
            {"trial_id": "trial-0001", "status": "completed"},
            {"trial_id": "trial-0002", "status": "completed"},
            {"trial_id": "trial-0003", "status": "completed"},
        ]
        for phase in ("result-validated", "candidate-ready"):
            with self.subTest(phase=phase):
                row = {
                    "protocol_json": queued.protocol,
                    "attempt_no": 4,
                    "checkpoint_json": {
                        "schema": "research-job-checkpoint-v1",
                        "phase": phase,
                        "attempt_no": 4,
                        "trial_outcomes": copy.deepcopy(completed),
                    },
                }
                checkpoint, progress = _oos_cancellation_state(row)
                self.assertEqual(checkpoint["phase"], "oos-sweep-canceled")
                self.assertEqual(checkpoint["trial_outcomes"], completed)
                self.assertEqual(
                    checkpoint["trial_status_counts"],
                    {"canceled": 0, "completed": 3, "failed": 0},
                )
                self.assertTrue(checkpoint["fully_accounted"])
                self.assertEqual(progress["trial_index"], 3)
                self.assertEqual(progress["trial_count"], 3)

    def test_worker_records_failed_trial_and_continues_to_terminal_outcomes(self):
        queued = self.create_job()
        claimed = ClaimedJob(
            workspace_id=queued.workspace_id,
            job_id=queued.job_id,
            dataset_id=queued.dataset_id,
            strategy_version=queued.strategy_version,
            starting_balance=queued.starting_balance,
            protocol=queued.protocol,
            protocol_sha256=queued.protocol_sha256,
            attempt_no=1,
            lease_owner="u5c-worker",
            lease_token="lease-u5c",
        )

        def fake_engine(slice_rows, protocol, *, continue_check=None, deadline=None):
            if protocol["playbook"]["rules"]["lookback"] == 3:
                raise ResearchEngineValidationError("trial slice rejected")
            return {
                "assumptions": {},
                "signals": {},
                "ledger": [],
                "metrics": {"metric_schema_version": "metrics-v2"},
                "observed_range": {
                    "from_utc": slice_rows[0]["timestamp"],
                    "to_utc": slice_rows[-1]["timestamp"] + TIMEFRAME,
                    "bar_count": len(slice_rows),
                },
                "execution": {},
            }

        with (
            patch("trading_workspace_v2.research.verify_engine_code"),
            patch("trading_workspace_v2.research.execute_breakout", side_effect=fake_engine) as execute,
            patch("trading_workspace_v2.research.validate_engine_result", return_value={"reconciled": True}),
        ):
            result = self.service.execute_claimed(claimed)

        self.assertEqual(execute.call_count, 6)
        self.assertEqual([trial["status"] for trial in result.trials], ["completed", "failed", "completed"])
        self.assertEqual(
            result.outcome_summary["status_counts"],
            {"canceled": 0, "completed": 2, "failed": 1},
        )
        failed = result.trials[1]
        self.assertEqual(failed["folds"][0]["train"]["status"], "failed")
        self.assertEqual(failed["folds"][0]["oos"]["status"], "failed")

    def test_worker_interruption_accounts_remaining_trials_as_canceled_without_result(self):
        queued = self.create_job()
        claimed = ClaimedJob(
            workspace_id=queued.workspace_id,
            job_id=queued.job_id,
            dataset_id=queued.dataset_id,
            strategy_version=queued.strategy_version,
            starting_balance=queued.starting_balance,
            protocol=queued.protocol,
            protocol_sha256=queued.protocol_sha256,
            attempt_no=1,
            lease_owner="u5c-worker",
            lease_token="lease-u5c",
        )
        calls = 0

        def interrupt_during_second_trial(slice_rows, protocol, *, continue_check=None, deadline=None):
            nonlocal calls
            calls += 1
            if calls == 3:
                raise ResearchEngineInterrupted("cancel during sweep")
            return {
                "assumptions": {},
                "signals": {},
                "ledger": [],
                "metrics": {"metric_schema_version": "metrics-v2"},
                "observed_range": {
                    "from_utc": slice_rows[0]["timestamp"],
                    "to_utc": slice_rows[-1]["timestamp"] + TIMEFRAME,
                    "bar_count": len(slice_rows),
                },
                "execution": {},
            }

        with (
            patch("trading_workspace_v2.research.verify_engine_code"),
            patch("trading_workspace_v2.research.execute_breakout", side_effect=interrupt_during_second_trial),
            patch("trading_workspace_v2.research.validate_engine_result", return_value={"reconciled": True}),
        ):
            result = self.service.execute_claimed(claimed)

        self.assertIsNone(result)
        self.assertIsNone(self.artifacts.result_payload)
        checkpoint, progress = self.store.checkpoints[-1]
        self.assertEqual(checkpoint["phase"], "oos-sweep-canceled")
        self.assertTrue(checkpoint["fully_accounted"])
        self.assertEqual(
            checkpoint["trial_outcomes"],
            [
                {"trial_id": "trial-0001", "status": "completed"},
                {"trial_id": "trial-0002", "status": "canceled"},
                {"trial_id": "trial-0003", "status": "canceled"},
            ],
        )
        self.assertEqual(
            checkpoint["trial_status_counts"],
            {"canceled": 2, "completed": 1, "failed": 0},
        )
        self.assertEqual(progress["trial_index"], 1)
        self.assertEqual(progress["trial_count"], 3)

    def test_baseline_worker_keeps_single_full_range_engine_result(self):
        baseline_request = engine_request(self.manifest).model_copy(update={"split": "baseline"})
        queued = self.service.create_engine_job(workspace_id="tenant-a", request=baseline_request)
        claimed = ClaimedJob(
            workspace_id=queued.workspace_id,
            job_id=queued.job_id,
            dataset_id=queued.dataset_id,
            strategy_version=queued.strategy_version,
            starting_balance=queued.starting_balance,
            protocol=queued.protocol,
            protocol_sha256=queued.protocol_sha256,
            attempt_no=1,
            lease_owner="u5c-worker",
            lease_token="lease-u5c",
        )
        engine_result = {
            "assumptions": {},
            "signals": {},
            "ledger": [],
            "metrics": {"metric_schema_version": "metrics-v2"},
            "observed_range": {
                "from_utc": 0,
                "to_utc": self.manifest.row_count * TIMEFRAME,
                "bar_count": self.manifest.row_count,
            },
            "execution": {},
        }

        with (
            patch("trading_workspace_v2.research.verify_engine_code"),
            patch("trading_workspace_v2.research.execute_breakout", return_value=engine_result) as execute,
            patch("trading_workspace_v2.research.validate_engine_result", return_value={"reconciled": True}),
        ):
            result = self.service.execute_claimed(claimed)

        self.assertEqual(execute.call_count, 1)
        call_rows, call_protocol = execute.call_args.args
        self.assertEqual(len(call_rows), self.manifest.row_count)
        self.assertEqual(call_protocol["range"], {"from_utc": 0, "to_utc": self.manifest.row_count * TIMEFRAME})
        self.assertEqual(result.artifact_schema_version, "research-engine-result-v1")
        self.assertEqual(result.split, "baseline")
        self.assertNotIn("validation", result.protocol)
        self.assertIn("ledger", self.artifacts.result_payload)
        self.assertEqual(self.store.checkpoints[-1][1], {"phase_index": 4, "phase_count": 4})

    def test_worker_rejects_rehashed_protocol_that_attempts_to_open_holdout(self):
        queued = self.create_job()
        tampered = copy.deepcopy(queued.protocol)
        tampered["validation"]["holdout_access"] = True
        tampered_sha256 = hashlib.sha256(canonical_json_bytes(tampered)).hexdigest()
        claimed = ClaimedJob(
            workspace_id=queued.workspace_id,
            job_id=queued.job_id,
            dataset_id=queued.dataset_id,
            strategy_version=queued.strategy_version,
            starting_balance=queued.starting_balance,
            protocol=tampered,
            protocol_sha256=tampered_sha256,
            attempt_no=1,
            lease_owner="u5c-worker",
            lease_token="lease-u5c",
        )

        with self.assertRaisesRegex(ResearchEngineValidationError, "cannot authorize holdout content"):
            self.service.execute_claimed(claimed)

        phases = [checkpoint["phase"] for checkpoint, _progress in self.store.checkpoints]
        self.assertEqual(phases, ["claimed", "protocol-validated", "dataset-loaded"])


if __name__ == "__main__":
    unittest.main()
