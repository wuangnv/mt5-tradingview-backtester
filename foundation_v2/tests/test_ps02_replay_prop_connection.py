from __future__ import annotations

import os
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(V2) not in sys.path:
    sys.path.insert(0, str(V2))

from trading_workspace_v2.prop_replay import (
    ReplayPropConnectionError,
    replay_mark_to_prop_event,
    validate_replay_prop_binding,
)
from trading_workspace_v2.prop_session import (
    ChallengeAttemptSnapshot,
    LossRule,
    OverallDrawdownRule,
    PhaseStateSnapshot,
    ProfitTargetRule,
    PropPhaseSpec,
    PropProfileSnapshot,
    PropSessionSnapshot,
    ThresholdValue,
    TransitionIntent,
    evaluate_prop_lifecycle_event,
)
from trading_workspace_v2.replay import ReplayService
from trading_workspace_v2.replay_execution import ReplayExecutionEvent, ReplayExecutionSnapshot
from trading_workspace_v2.research import ResearchService
from trading_workspace_v2.store import PostgresStore, PropIdempotencyConflict, PropPersistenceConflict


DATASET_SHA = "a" * 64
BASE_TIME = 1767225600  # 2026-01-01T00:00:00Z


def instrument_mapping():
    return {
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


def cost_mapping():
    return {
        "version": "replay-cost-v1",
        "spread_basis": "bid_ask_embedded",
        "commission_per_side_account": "1",
        "minimum_fee_account": "0",
        "slippage_price_per_side": "0",
        "financing_account": "0",
        "quote_to_account_rate": "1",
        "account_ccy": "USD",
        "rounding_decimals": 2,
    }


def phase_spec(
    *,
    equity_rules: bool = False,
    phase_index: int = 1,
    initial_capital: str = "100000",
    carry_policy: str = "reset",
    position_policy: str = "carry",
):
    basis = "equity" if equity_rules else "balance"
    return PropPhaseSpec(
        phase_index=phase_index,
        initial_capital=initial_capital,
        currency="USD",
        profit_target=ProfitTargetRule(
            threshold=ThresholdValue(amount="10000"), basis=basis, comparator="gte"
        ),
        daily_loss=LossRule(
            threshold=ThresholdValue(amount="5000"), basis=basis, comparator="lt"
        ),
        overall_drawdown=OverallDrawdownRule(
            threshold=ThresholdValue(amount="10000"),
            basis=basis,
            comparator="lt",
            kind="static",
        ),
        reset_timezone="UTC",
        min_qualifying_days=0,
        carry_policy=carry_policy,
        position_policy=position_policy,
    )


def prop_state(
    *,
    equity_rules: bool = False,
    workspace_id: str = "tenant-a",
    session_id: str = "prop-session",
    attempt_id: str = "attempt-1",
    dataset_sha256: str = DATASET_SHA,
):
    spec = phase_spec(equity_rules=equity_rules)
    profile = PropProfileSnapshot(
        profile_id="ps02-replay",
        terms_version="2026-09-25",
        profile_hash="sha256:ps02-replay",
        effective_from=date(2026, 9, 25),
        source_kind="generic",
        supported_rule_flags=["daily_loss", "overall_drawdown", "profit_target"],
        phases=[spec],
    )
    session = PropSessionSnapshot(
        workspace_id=workspace_id,
        session_id=session_id,
        profile=profile,
        status="running",
    )
    attempt = ChallengeAttemptSnapshot(
        workspace_id=workspace_id,
        session_id=session.session_id,
        attempt_id=attempt_id,
        profile_id=profile.profile_id,
        terms_version=profile.terms_version,
        profile_hash=profile.profile_hash,
        data_version=f"sha256:{dataset_sha256}",
        cost_version="replay-cost-v1",
        engine_version="replay-v1",
        status="running",
        revision=1,
        virtual_start_utc=datetime.fromtimestamp(BASE_TIME, tz=timezone.utc),
        virtual_cutoff_utc=datetime.fromtimestamp(BASE_TIME + 3600, tz=timezone.utc),
    )
    phase = PhaseStateSnapshot(
        workspace_id=workspace_id,
        session_id=session.session_id,
        attempt_id=attempt.attempt_id,
        profile_hash=profile.profile_hash,
        phase_index=1,
        initial_balance="100000",
        balance="100000",
        floating_pl="0",
        equity="100000",
        high_water_mark="100000",
        daily_anchor="100000",
        qualifying_days=0,
        virtual_time_utc=datetime.fromtimestamp(BASE_TIME, tz=timezone.utc),
        last_event_sequence=0,
        open_positions=0,
        pending_orders=0,
        evaluation_quality="full_for_declared_model",
    )
    resume = {
        "cursor": {"bar_index": 0, "timestamp_utc": "2026-01-01T00:00:00Z"},
        "open_positions": [],
        "pending_orders": [],
    }
    return session, attempt, phase, resume


class FakeArtifacts:
    def __init__(self, rows):
        self.rows = rows

    def read_dataset(self, artifact_path, artifact_sha256):
        if artifact_sha256 != DATASET_SHA:
            raise AssertionError("unexpected dataset hash")
        return [dict(row) for row in self.rows]


class FakeStore:
    def __init__(self, rows):
        self.rows = rows
        self.records = {}
        self.counter = 0
        self.prop = prop_state()
        self.receipts = {}

    def get_dataset(self, workspace_id, dataset_id):
        if workspace_id != "tenant-a" or dataset_id != "dataset-1":
            return None
        return SimpleNamespace(
            artifact_path="datasets/fixture.json",
            artifact_sha256=DATASET_SHA,
            instrument_id="EURUSD",
            timeframe_seconds=60,
            instrument_spec=instrument_mapping(),
        )

    def create_record(self, workspace_id, kind, payload, *, source_key=None):
        self.counter += 1
        record_id = f"replay-{self.counter}"
        self.records[(workspace_id, kind, record_id)] = {
            "record_id": record_id,
            "source_key": source_key,
            "revision": 1,
            "payload": dict(payload),
            "deleted": False,
            "created_at_utc": "2026-01-01T00:00:00Z",
            "updated_at_utc": "2026-01-01T00:00:00Z",
        }
        return self.get_record(workspace_id, kind, record_id)

    def get_record(self, workspace_id, kind, record_id):
        value = self.records.get((workspace_id, kind, record_id))
        if value is None:
            return None
        return {**value, "payload": dict(value["payload"])}

    def update_record(self, workspace_id, kind, record_id, expected_revision, payload):
        key = (workspace_id, kind, record_id)
        current = self.records.get(key)
        if current is None:
            raise LookupError("record not found")
        if current["revision"] != expected_revision:
            raise RuntimeError("record revision conflict")
        current["revision"] += 1
        current["payload"] = dict(payload)
        return self.get_record(workspace_id, kind, record_id)

    def get_prop_resume_state(self, workspace_id, session_id, attempt_id):
        session, attempt, phase, resume = self.prop
        if (
            workspace_id != session.workspace_id
            or session_id != session.session_id
            or attempt_id != attempt.attempt_id
        ):
            return None
        return {
            "session": session,
            "attempt": attempt,
            "phase": phase,
            "resume_state": dict(resume),
        }

    def get_prop_mutation_snapshot(self, workspace_id, session_id, attempt_id, operation_id):
        previous = self.receipts.get(operation_id)
        if previous is None:
            return None
        _, _, prior_result = previous
        return {
            "fingerprint": "fake-receipt",
            "attempt": prior_result["attempt"],
            "phase": prior_result["phase"],
            "resume_state": prior_result["resume_state"],
        }

    def apply_prop_lifecycle_event(self, event, *, resume_state=None):
        previous = self.receipts.get(event.operation_id)
        if previous is not None:
            prior_event, prior_resume, prior_result = previous
            if prior_event != event.model_dump(mode="json") or prior_resume != resume_state:
                raise AssertionError("idempotent retry changed event or caller-owned resume payload")
            return {**prior_result, "duplicate": True}
        session, attempt, phase, current_resume = self.prop
        result = evaluate_prop_lifecycle_event(
            session,
            attempt,
            phase,
            event,
            resume_state=resume_state if event.evaluation_quality == "full_for_declared_model" else current_resume,
        )
        self.prop = (session, result["attempt"], result["phase"], result["resume_state"])
        stored = {
            "session": session,
            "attempt": result["attempt"],
            "phase": result["phase"],
            "resume_state": result["resume_state"],
            "objectives": result["objectives"],
            "duplicate": False,
        }
        self.receipts[event.operation_id] = (
            event.model_dump(mode="json"),
            dict(resume_state or {}),
            stored,
        )
        return stored


class ReplayPropConnectionTests(unittest.TestCase):
    def setUp(self):
        self.rows = [
            {"timestamp": BASE_TIME, "open": 1.1000, "high": 1.1010, "low": 1.0990, "close": 1.1000, "volume": 10},
            {"timestamp": BASE_TIME + 60, "open": 1.1000, "high": 1.1030, "low": 1.0990, "close": 1.1020, "volume": 11},
            {"timestamp": BASE_TIME + 120, "open": 1.1020, "high": 1.1040, "low": 1.1010, "close": 1.1030, "volume": 12},
        ]
        self.store = FakeStore(self.rows)
        self.service = ReplayService(self.store, FakeArtifacts(self.rows))

    def build_open_replay(self):
        created = self.service.create("tenant-a", "dataset-1", 0)
        session_id = created["record_id"]
        initialized = self.service.initialize_execution(
            "tenant-a",
            session_id,
            1,
            instrument_spec=instrument_mapping(),
            cost_model=cost_mapping(),
            spread_price="0.0002",
            timeframe_seconds=60,
            starting_balance="100000",
        )
        queued = self.service.queue_market_order(
            "tenant-a",
            session_id,
            initialized["revision"],
            operation_id="open-1",
            side="BUY",
            quantity="0.10",
            stop_loss="1.0900",
            take_profit="1.1200",
        )
        stepped = self.service.step("tenant-a", session_id, queued["revision"], 1)
        return session_id, stepped

    def test_replay_execution_persists_fill_and_mark_before_prop_consumes_it(self):
        session_id, stepped = self.build_open_replay()
        self.assertEqual([item["kind"] for item in stepped["execution_events"]], ["market_fill", "price_mark"])
        snapshot = ReplayExecutionSnapshot.model_validate(stepped["payload"]["execution"])
        self.assertEqual(snapshot.cursor_index, 1)
        self.assertEqual(snapshot.event_sequence, 2)
        self.assertEqual(snapshot.ledger[-1]["details"]["intrabar_equity_coverage"], "insufficient")

        fed = self.service.feed_prop_lifecycle(
            "tenant-a",
            session_id,
            prop_session_id="prop-session",
            prop_attempt_id="attempt-1",
            replay_event_sequence=2,
            expected_prop_revision=1,
            prop_event_sequence=1,
        )
        self.assertFalse(fed["duplicate"])
        self.assertEqual(fed["prop_event"]["balance_before_separate_costs"], "100000")
        self.assertEqual(fed["prop_event"]["open_positions"], 1)
        self.assertEqual(fed["prop_event"]["evaluation_quality"], "full_for_declared_model")
        self.assertEqual(fed["phase"]["last_event_sequence"], 1)
        self.assertEqual(fed["resume_state"]["cursor"]["bar_index"], 1)
        self.assertEqual(fed["resume_state"]["replay_binding"]["last_replay_event_sequence"], 2)
        self.assertEqual(len(fed["resume_state"]["open_positions"]), 1)

        duplicate = self.service.feed_prop_lifecycle(
            "tenant-a",
            session_id,
            prop_session_id="prop-session",
            prop_attempt_id="attempt-1",
            replay_event_sequence=2,
            expected_prop_revision=1,
            prop_event_sequence=1,
        )
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(duplicate["attempt"]["revision"], 2)

    def test_delayed_exact_retry_after_later_mark_remains_idempotent(self):
        session_id, stepped = self.build_open_replay()
        first = self.service.feed_prop_lifecycle(
            "tenant-a",
            session_id,
            prop_session_id="prop-session",
            prop_attempt_id="attempt-1",
            replay_event_sequence=2,
            expected_prop_revision=1,
            prop_event_sequence=1,
        )
        self.assertFalse(first["duplicate"])

        advanced = self.service.step("tenant-a", session_id, stepped["revision"], 1)
        snapshot = ReplayExecutionSnapshot.model_validate(advanced["payload"]["execution"])
        second_mark = next(
            item for item in snapshot.ledger
            if item["kind"] == "price_mark" and item["sequence"] > 2
        )
        second = self.service.feed_prop_lifecycle(
            "tenant-a",
            session_id,
            prop_session_id="prop-session",
            prop_attempt_id="attempt-1",
            replay_event_sequence=second_mark["sequence"],
            expected_prop_revision=2,
            prop_event_sequence=2,
        )
        self.assertFalse(second["duplicate"])
        self.assertEqual(second["attempt"]["revision"], 3)

        delayed = self.service.feed_prop_lifecycle(
            "tenant-a",
            session_id,
            prop_session_id="prop-session",
            prop_attempt_id="attempt-1",
            replay_event_sequence=2,
            expected_prop_revision=1,
            prop_event_sequence=1,
        )
        self.assertTrue(delayed["duplicate"])
        self.assertEqual(delayed["attempt"]["revision"], 2)

    def test_market_order_rejected_when_replay_has_no_future_bar(self):
        created = self.service.create("tenant-a", "dataset-1", len(self.rows) - 1)
        session_id = created["record_id"]
        initialized = self.service.initialize_execution(
            "tenant-a",
            session_id,
            1,
            instrument_spec=instrument_mapping(),
            cost_model=cost_mapping(),
            spread_price="0.0002",
            timeframe_seconds=60,
            starting_balance="100000",
        )
        with self.assertRaisesRegex(ValueError, "future replay bar"):
            self.service.queue_market_order(
                "tenant-a",
                session_id,
                initialized["revision"],
                operation_id="too-late",
                side="BUY",
                quantity="0.10",
                stop_loss="1.0900",
                take_profit="1.1200",
            )

    def test_equity_rule_downgrades_bar_close_mark_without_intrabar_path(self):
        session_id, stepped = self.build_open_replay()
        replay_event = ReplayExecutionEvent.model_validate(stepped["payload"]["execution"]["ledger"][-1])
        session, attempt, phase, _ = prop_state(equity_rules=True)
        snapshot = ReplayExecutionSnapshot.model_validate(stepped["payload"]["execution"])
        validate_replay_prop_binding(snapshot, attempt, phase)
        event = replay_mark_to_prop_event(
            workspace_id="tenant-a",
            prop_session_id=session.session_id,
            prop_attempt_id=attempt.attempt_id,
            profile_hash=attempt.profile_hash,
            expected_prop_revision=attempt.revision,
            prop_event_sequence=1,
            phase_spec=session.profile.phases[0],
            replay_event=replay_event,
        )
        self.assertEqual(event.evaluation_quality, "insufficient")

    def test_binding_rejects_dataset_cost_engine_and_initial_balance_mismatch(self):
        _, stepped = self.build_open_replay()
        snapshot = ReplayExecutionSnapshot.model_validate(stepped["payload"]["execution"])
        _, attempt, phase, _ = prop_state()
        validate_replay_prop_binding(snapshot, attempt, phase)
        cases = [
            attempt.model_copy(update={"data_version": "sha256:" + "b" * 64}),
            attempt.model_copy(update={"cost_version": "other-cost"}),
            attempt.model_copy(update={"engine_version": "other-engine"}),
        ]
        for candidate in cases:
            with self.subTest(candidate=candidate):
                with self.assertRaises(ReplayPropConnectionError):
                    validate_replay_prop_binding(snapshot, candidate, phase)
        with self.assertRaisesRegex(ReplayPropConnectionError, "initial balance"):
            validate_replay_prop_binding(
                snapshot,
                attempt,
                phase.model_copy(update={"initial_balance": "99999"}),
            )

    def test_execution_enabled_branch_fails_closed_until_checkpoint_reconstruction_exists(self):
        session_id, stepped = self.build_open_replay()
        with self.assertRaisesRegex(ValueError, "canonical checkpoint"):
            self.service.branch("tenant-a", session_id, stepped["revision"], 0)


@unittest.skipUnless(os.getenv("TW_V2_DATABASE_URL"), "TW_V2_DATABASE_URL is required for replay/prop PostgreSQL integration")
class ReplayPropPostgresIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="tw-ps02-replay-")
        self.workspace_id = f"ps02-replay-{uuid4().hex}"
        self.store = PostgresStore(os.environ["TW_V2_DATABASE_URL"])
        self.store.initialize()
        self.artifacts = ArtifactStore(self.temp.name)
        self.research = ResearchService(self.store, self.artifacts)
        self.authorization = LocalWorkspaceAuthorization.for_local_owner([self.workspace_id])

    def tearDown(self):
        self.temp.cleanup()

    def _build_replay_boundary(self, *, with_position: bool = False, row_count: int = 4):
        rows = [
            {
                "timestamp": BASE_TIME + index * 60,
                "open": 1.1000 + index * 0.0010,
                "high": 1.1020 + index * 0.0010,
                "low": 1.0990 + index * 0.0010,
                "close": 1.1010 + index * 0.0010,
                "volume": 10 + index,
            }
            for index in range(row_count)
        ]
        dataset = self.research.register_dataset(
            workspace_id=self.workspace_id,
            source=DatasetSource(
                source_id=f"ps02c2-boundary-{uuid4().hex}",
                provider="synthetic-local",
                instrument_mapping={"EURUSD": "EURUSD"},
                license_use="qa-only",
                retrieved_at_utc="2026-09-25T00:00:00Z",
                export_settings="ps02c2-boundary-v1",
            ),
            instrument_id="EURUSD",
            timeframe="1m",
            rows=rows,
        )
        replay_service = ReplayService(self.store, self.artifacts)
        created = replay_service.create(self.workspace_id, dataset.dataset_id, 0)
        replay_id = created["record_id"]
        initialized = replay_service.initialize_execution(
            self.workspace_id,
            replay_id,
            created["revision"],
            instrument_spec=instrument_mapping(),
            cost_model=cost_mapping(),
            spread_price="0.0002",
            timeframe_seconds=60,
            starting_balance="100000",
        )
        expected_revision = initialized["revision"]
        if with_position:
            queued = replay_service.queue_market_order(
                self.workspace_id,
                replay_id,
                expected_revision,
                operation_id=f"open-{uuid4().hex}",
                side="BUY",
                quantity="0.10",
                stop_loss="1.0900",
                take_profit="1.1400",
            )
            expected_revision = queued["revision"]
        stepped = replay_service.step(self.workspace_id, replay_id, expected_revision, 1)
        snapshot = ReplayExecutionSnapshot.model_validate(stepped["payload"]["execution"])
        event = ReplayExecutionEvent.model_validate(snapshot.ledger[-1])
        self.assertEqual(event.kind, "price_mark")
        return dataset, replay_service, replay_id, stepped, snapshot, event

    def _create_bound_multiphase_bundle(
        self,
        *,
        dataset,
        replay_id: str,
        snapshot: ReplayExecutionSnapshot,
        boundary_event: ReplayExecutionEvent,
        carry_policy: str,
        position_policy: str,
        next_initial: str = "50000",
    ):
        first = phase_spec(
            phase_index=1,
            initial_capital="100000",
            carry_policy=carry_policy,
            position_policy=position_policy,
        )
        second = phase_spec(
            phase_index=2,
            initial_capital=next_initial,
            carry_policy="reset",
            position_policy="must_be_flat",
        )
        profile = PropProfileSnapshot(
            profile_id="ps02c2-multi",
            terms_version="2026-09-25",
            profile_hash=f"sha256:{uuid4().hex}",
            effective_from=date(2026, 9, 25),
            source_kind="generic",
            supported_rule_flags=["daily_loss", "overall_drawdown", "profit_target"],
            phases=[first, second],
        )
        session_id = f"prop-{uuid4().hex}"
        attempt_id = f"attempt-{uuid4().hex}"
        session = PropSessionSnapshot(
            workspace_id=self.workspace_id,
            session_id=session_id,
            profile=profile,
            status="phase_passed",
        )
        attempt = ChallengeAttemptSnapshot(
            workspace_id=self.workspace_id,
            session_id=session_id,
            attempt_id=attempt_id,
            profile_id=profile.profile_id,
            terms_version=profile.terms_version,
            profile_hash=profile.profile_hash,
            data_version=f"sha256:{dataset.artifact_sha256}",
            cost_version="replay-cost-v1",
            engine_version="replay-v1",
            status="phase_passed",
            revision=1,
            virtual_start_utc=datetime.fromtimestamp(BASE_TIME, tz=timezone.utc),
            virtual_cutoff_utc=datetime.fromtimestamp(BASE_TIME + 3600, tz=timezone.utc),
        )
        boundary_time = datetime.fromtimestamp(boundary_event.virtual_time_utc, tz=timezone.utc)
        open_position = snapshot.position.model_dump(mode="json") if snapshot.position is not None else None
        phase = PhaseStateSnapshot(
            workspace_id=self.workspace_id,
            session_id=session_id,
            attempt_id=attempt_id,
            profile_hash=profile.profile_hash,
            phase_index=1,
            initial_balance="100000",
            balance=snapshot.balance,
            floating_pl=snapshot.floating_pl,
            equity=snapshot.equity,
            high_water_mark=max(snapshot.equity, snapshot.balance),
            daily_anchor="100000",
            qualifying_days=0,
            virtual_time_utc=boundary_time,
            last_event_sequence=1,
            open_positions=1 if open_position is not None else 0,
            pending_orders=0,
            evaluation_quality="full_for_declared_model",
        )
        resume = {
            "cursor": {
                "bar_index": snapshot.cursor_index,
                "timestamp_utc": boundary_time.isoformat().replace("+00:00", "Z"),
            },
            "open_positions": [open_position] if open_position is not None else [],
            "pending_orders": [],
            "replay_binding": {
                "replay_session_id": replay_id,
                "branch_id": snapshot.branch_id,
                "dataset_id": snapshot.dataset_id,
                "dataset_sha256": snapshot.dataset_sha256,
                "last_replay_event_sequence": snapshot.event_sequence,
            },
        }
        self.store.create_prop_session_bundle(session, attempt, phase, resume_state=resume)
        intent = TransitionIntent(
            workspace_id=self.workspace_id,
            session_id=session_id,
            attempt_id=attempt_id,
            profile_hash=profile.profile_hash,
            intent_id=f"phase-next-{uuid4().hex}",
            expected_revision=1,
            event_sequence=1,
            action="next_phase",
        )
        return session, attempt, phase, resume, intent

    def test_api_replay_fill_ledger_feeds_persisted_prop_attempt_idempotently(self):
        rows = [
            {"timestamp": BASE_TIME, "open": 1.1000, "high": 1.1010, "low": 1.0990, "close": 1.1000, "volume": 10},
            {"timestamp": BASE_TIME + 60, "open": 1.1000, "high": 1.1030, "low": 1.0990, "close": 1.1020, "volume": 11},
            {"timestamp": BASE_TIME + 120, "open": 1.1020, "high": 1.1040, "low": 1.1010, "close": 1.1030, "volume": 12},
        ]
        dataset = self.research.register_dataset(
            workspace_id=self.workspace_id,
            source=DatasetSource(
                source_id="ps02-replay-fixture",
                provider="synthetic-local",
                instrument_mapping={"EURUSD": "EURUSD"},
                license_use="qa-only",
                retrieved_at_utc="2026-09-25T00:00:00Z",
                export_settings="ps02-replay-connection-v1",
            ),
            instrument_id="EURUSD",
            timeframe="1m",
            rows=rows,
        )
        session_id = f"prop-{uuid4().hex}"
        attempt_id = f"attempt-{uuid4().hex}"
        session, attempt, phase, resume = prop_state(
            workspace_id=self.workspace_id,
            session_id=session_id,
            attempt_id=attempt_id,
            dataset_sha256=dataset.artifact_sha256,
        )
        self.store.create_prop_session_bundle(session, attempt, phase, resume_state=resume)

        app = create_app(
            dsn=os.environ["TW_V2_DATABASE_URL"],
            artifact_root=self.temp.name,
            authorization=self.authorization,
        )
        headers = {"X-Workspace-Id": self.workspace_id}
        with TestClient(app) as client:
            replay = client.post(
                "/api/v2/replay/sessions",
                headers=headers,
                json={"dataset_id": dataset.dataset_id, "start_index": 0},
            )
            self.assertEqual(replay.status_code, 201, replay.text)
            replay_id = replay.json()["record_id"]

            initialized = client.post(
                f"/api/v2/replay/sessions/{replay_id}/execution",
                headers=headers,
                json={
                    "expected_revision": 1,
                    "instrument_spec": instrument_mapping(),
                    "cost_model": cost_mapping(),
                    "spread_price": "0.0002",
                    "timeframe_seconds": 60,
                    "starting_balance": "100000",
                },
            )
            self.assertEqual(initialized.status_code, 200, initialized.text)

            queued = client.post(
                f"/api/v2/replay/sessions/{replay_id}/orders/market",
                headers=headers,
                json={
                    "expected_revision": 2,
                    "operation_id": "api-open-1",
                    "side": "BUY",
                    "quantity": "0.10",
                    "stop_loss": "1.0900",
                    "take_profit": "1.1200",
                },
            )
            self.assertEqual(queued.status_code, 200, queued.text)

            stepped = client.post(
                f"/api/v2/replay/sessions/{replay_id}/step",
                headers=headers,
                json={"expected_revision": 3, "steps": 1},
            )
            self.assertEqual(stepped.status_code, 200, stepped.text)
            self.assertEqual(
                [item["kind"] for item in stepped.json()["execution_events"]],
                ["market_fill", "price_mark"],
            )

            feed_url = (
                f"/api/v2/replay/sessions/{replay_id}/prop/sessions/{session_id}"
                f"/attempts/{attempt_id}/feed"
            )
            feed_body = {
                "replay_event_sequence": 2,
                "expected_prop_revision": 1,
                "prop_event_sequence": 1,
            }
            first = client.post(feed_url, headers=headers, json=feed_body)
            self.assertEqual(first.status_code, 200, first.text)
            self.assertFalse(first.json()["duplicate"])
            self.assertEqual(first.json()["phase"]["last_event_sequence"], 1)
            self.assertEqual(first.json()["resume_state"]["replay_binding"]["last_replay_event_sequence"], 2)

            duplicate = client.post(feed_url, headers=headers, json=feed_body)
            self.assertEqual(duplicate.status_code, 200, duplicate.text)
            self.assertTrue(duplicate.json()["duplicate"])

        restored = self.store.get_prop_resume_state(self.workspace_id, session_id, attempt_id)
        self.assertEqual(restored["attempt"].revision, 2)
        self.assertEqual(restored["phase"].last_event_sequence, 1)
        self.assertEqual(restored["resume_state"]["cursor"]["bar_index"], 1)
        replay_record = self.store.get_record(self.workspace_id, "replay", replay_id)
        snapshot = ReplayExecutionSnapshot.model_validate(replay_record["payload"]["execution"])
        self.assertEqual(snapshot.event_sequence, 2)
        self.assertEqual(len(snapshot.ledger), 2)

    def test_replay_bound_next_phase_is_atomic_idempotent_and_phase2_feedable(self):
        rows = [
            {"timestamp": BASE_TIME, "open": 1.1000, "high": 1.1010, "low": 1.0990, "close": 1.1000, "volume": 10},
            {"timestamp": BASE_TIME + 60, "open": 1.1000, "high": 1.1020, "low": 1.0990, "close": 1.1010, "volume": 11},
            {"timestamp": BASE_TIME + 120, "open": 1.1010, "high": 1.1030, "low": 1.1000, "close": 1.1020, "volume": 12},
            {"timestamp": BASE_TIME + 180, "open": 1.1020, "high": 1.1040, "low": 1.1010, "close": 1.1030, "volume": 13},
        ]
        dataset = self.research.register_dataset(
            workspace_id=self.workspace_id,
            source=DatasetSource(
                source_id="ps02c2-phase-fixture",
                provider="synthetic-local",
                instrument_mapping={"EURUSD": "EURUSD"},
                license_use="qa-only",
                retrieved_at_utc="2026-09-25T00:00:00Z",
                export_settings="ps02c2-phase-transition-v1",
            ),
            instrument_id="EURUSD",
            timeframe="1m",
            rows=rows,
        )
        replay_service = ReplayService(self.store, self.artifacts)
        created = replay_service.create(self.workspace_id, dataset.dataset_id, 0)
        replay_id = created["record_id"]
        initialized = replay_service.initialize_execution(
            self.workspace_id,
            replay_id,
            created["revision"],
            instrument_spec=instrument_mapping(),
            cost_model=cost_mapping(),
            spread_price="0.0002",
            timeframe_seconds=60,
            starting_balance="100000",
        )
        stepped = replay_service.step(self.workspace_id, replay_id, initialized["revision"], 1)
        boundary = ReplayExecutionSnapshot.model_validate(stepped["payload"]["execution"])
        boundary_event = ReplayExecutionEvent.model_validate(boundary.ledger[-1])
        self.assertEqual(boundary_event.kind, "price_mark")

        first = phase_spec(
            phase_index=1,
            initial_capital="100000",
            carry_policy="reset",
            position_policy="must_be_flat",
        )
        second = phase_spec(
            phase_index=2,
            initial_capital="50000",
            carry_policy="reset",
            position_policy="must_be_flat",
        )
        profile = PropProfileSnapshot(
            profile_id="ps02c2-multi",
            terms_version="2026-09-25",
            profile_hash="sha256:ps02c2-multi",
            effective_from=date(2026, 9, 25),
            source_kind="generic",
            supported_rule_flags=["daily_loss", "overall_drawdown", "profit_target"],
            phases=[first, second],
        )
        session_id = f"prop-{uuid4().hex}"
        attempt_id = f"attempt-{uuid4().hex}"
        session = PropSessionSnapshot(
            workspace_id=self.workspace_id,
            session_id=session_id,
            profile=profile,
            status="phase_passed",
        )
        attempt = ChallengeAttemptSnapshot(
            workspace_id=self.workspace_id,
            session_id=session_id,
            attempt_id=attempt_id,
            profile_id=profile.profile_id,
            terms_version=profile.terms_version,
            profile_hash=profile.profile_hash,
            data_version=f"sha256:{dataset.artifact_sha256}",
            cost_version="replay-cost-v1",
            engine_version="replay-v1",
            status="phase_passed",
            revision=1,
            virtual_start_utc=datetime.fromtimestamp(BASE_TIME, tz=timezone.utc),
            virtual_cutoff_utc=datetime.fromtimestamp(BASE_TIME + 3600, tz=timezone.utc),
        )
        boundary_time = datetime.fromtimestamp(boundary_event.virtual_time_utc, tz=timezone.utc)
        phase = PhaseStateSnapshot(
            workspace_id=self.workspace_id,
            session_id=session_id,
            attempt_id=attempt_id,
            profile_hash=profile.profile_hash,
            phase_index=1,
            initial_balance="100000",
            balance=boundary.balance,
            floating_pl=boundary.floating_pl,
            equity=boundary.equity,
            high_water_mark=max(boundary.equity, boundary.balance),
            daily_anchor="100000",
            qualifying_days=0,
            virtual_time_utc=boundary_time,
            last_event_sequence=1,
            open_positions=0,
            pending_orders=0,
            evaluation_quality="full_for_declared_model",
        )
        resume = {
            "cursor": {
                "bar_index": boundary.cursor_index,
                "timestamp_utc": boundary_time.isoformat().replace("+00:00", "Z"),
            },
            "open_positions": [],
            "pending_orders": [],
            "replay_binding": {
                "replay_session_id": replay_id,
                "branch_id": boundary.branch_id,
                "dataset_id": boundary.dataset_id,
                "dataset_sha256": boundary.dataset_sha256,
                "last_replay_event_sequence": boundary.event_sequence,
            },
        }
        self.store.create_prop_session_bundle(session, attempt, phase, resume_state=resume)

        intent = TransitionIntent(
            workspace_id=self.workspace_id,
            session_id=session_id,
            attempt_id=attempt_id,
            profile_hash=profile.profile_hash,
            intent_id="phase-1-to-2",
            expected_revision=1,
            event_sequence=1,
            action="next_phase",
        )
        transitioned = self.store.apply_prop_transition_intent(intent)
        self.assertFalse(transitioned["duplicate"])
        self.assertEqual(transitioned["attempt"].status, "next_phase_ready")
        self.assertEqual(transitioned["phase"].phase_index, 2)
        self.assertEqual(transitioned["phase"].initial_balance, 50000)
        self.assertEqual(transitioned["phase"].balance, 50000)

        replay_after = ReplayExecutionSnapshot.model_validate(
            transitioned["replay_record"]["payload"]["execution"]
        )
        self.assertEqual(replay_after.starting_balance, 100000)
        self.assertEqual(replay_after.phase_index, 2)
        self.assertEqual(replay_after.phase_initial_balance, 50000)
        self.assertEqual(replay_after.balance, 50000)
        self.assertEqual(replay_after.event_sequence, boundary.event_sequence + 1)
        self.assertEqual(replay_after.ledger[-1]["kind"], "phase_transition")
        self.assertEqual(
            transitioned["resume_state"]["replay_binding"]["last_replay_event_sequence"],
            replay_after.event_sequence,
        )

        duplicate = PostgresStore(os.environ["TW_V2_DATABASE_URL"]).apply_prop_transition_intent(intent)
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(duplicate["attempt"].revision, transitioned["attempt"].revision)
        self.assertEqual(duplicate["replay_record"]["revision"], transitioned["replay_record"]["revision"])

        started = self.store.apply_prop_transition_intent(
            TransitionIntent(
                workspace_id=self.workspace_id,
                session_id=session_id,
                attempt_id=attempt_id,
                profile_hash=profile.profile_hash,
                intent_id="start-phase-2",
                expected_revision=transitioned["attempt"].revision,
                event_sequence=transitioned["phase"].last_event_sequence,
                action="start",
            )
        )
        advanced = replay_service.step(
            self.workspace_id,
            replay_id,
            transitioned["replay_record"]["revision"],
            1,
        )
        advanced_snapshot = ReplayExecutionSnapshot.model_validate(advanced["payload"]["execution"])
        self.assertEqual(advanced_snapshot.phase_index, 2)
        phase2_mark = ReplayExecutionEvent.model_validate(advanced_snapshot.ledger[-1])
        fed = replay_service.feed_prop_lifecycle(
            self.workspace_id,
            replay_id,
            prop_session_id=session_id,
            prop_attempt_id=attempt_id,
            replay_event_sequence=phase2_mark.sequence,
            expected_prop_revision=started["attempt"].revision,
            prop_event_sequence=started["phase"].last_event_sequence + 1,
        )
        self.assertFalse(fed["duplicate"])
        self.assertEqual(fed["phase"]["phase_index"], 2)
        self.assertEqual(fed["phase"]["initial_balance"], "50000")

        with self.assertRaises(PropIdempotencyConflict):
            self.store.apply_prop_transition_intent(
                intent.model_copy(update={"expected_revision": 999})
            )

        late_duplicate = self.store.apply_prop_transition_intent(intent)
        self.assertTrue(late_duplicate["duplicate"])
        self.assertEqual(late_duplicate["attempt"].revision, fed["attempt"]["revision"])
        self.assertEqual(late_duplicate["phase"].phase_index, 2)

    def test_replay_bound_carry_all_preserves_position_and_two_tab_race_commits_once(self):
        dataset, _, replay_id, _, snapshot, boundary_event = self._build_replay_boundary(with_position=True)
        _, _, _, _, intent = self._create_bound_multiphase_bundle(
            dataset=dataset,
            replay_id=replay_id,
            snapshot=snapshot,
            boundary_event=boundary_event,
            carry_policy="carry_all",
            position_policy="carry",
            next_initial="50000",
        )
        second_intent = intent.model_copy(update={"intent_id": f"phase-next-{uuid4().hex}"})

        def apply(candidate):
            try:
                return PostgresStore(os.environ["TW_V2_DATABASE_URL"]).apply_prop_transition_intent(candidate)
            except Exception as exc:
                return exc

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(apply, (intent, second_intent)))
        successes = [item for item in outcomes if isinstance(item, dict)]
        failures = [item for item in outcomes if isinstance(item, Exception)]
        self.assertEqual(len(successes), 1)
        self.assertEqual(len(failures), 1)
        self.assertIsInstance(failures[0], PropPersistenceConflict)

        result = successes[0]
        replay_after = ReplayExecutionSnapshot.model_validate(result["replay_record"]["payload"]["execution"])
        self.assertEqual(replay_after.position, snapshot.position)
        self.assertEqual(replay_after.balance, snapshot.balance)
        self.assertEqual(replay_after.floating_pl, snapshot.floating_pl)
        self.assertEqual(result["resume_state"]["open_positions"], [snapshot.position.model_dump(mode="json")])
        self.assertEqual(
            len([item for item in replay_after.ledger if item.get("kind") == "phase_transition"]),
            1,
        )

    def test_replay_bound_carry_balance_preserves_realized_balance_in_both_domains(self):
        dataset, _, replay_id, _, snapshot, boundary_event = self._build_replay_boundary()
        carried_balance = snapshot.balance + 2750
        carried_snapshot = snapshot.model_copy(
            update={"balance": carried_balance, "floating_pl": 0, "equity": carried_balance}
        )
        boundary_event = boundary_event.model_copy(
            update={
                "balance": carried_balance,
                "floating_pl": 0,
                "equity": carried_balance,
            }
        )
        carried_snapshot = carried_snapshot.model_copy(
            update={
                "ledger": [
                    *carried_snapshot.ledger[:-1],
                    boundary_event.model_dump(mode="json"),
                ]
            }
        )
        replay_record = self.store.get_record(self.workspace_id, "replay", replay_id)
        replay_payload = dict(replay_record["payload"])
        replay_payload["execution"] = carried_snapshot.model_dump(mode="json")
        self.store.update_record(
            self.workspace_id,
            "replay",
            replay_id,
            replay_record["revision"],
            replay_payload,
        )
        _, _, _, _, intent = self._create_bound_multiphase_bundle(
            dataset=dataset,
            replay_id=replay_id,
            snapshot=carried_snapshot,
            boundary_event=boundary_event,
            carry_policy="carry_balance",
            position_policy="must_be_flat",
            next_initial="50000",
        )

        result = self.store.apply_prop_transition_intent(intent)
        replay_after = ReplayExecutionSnapshot.model_validate(result["replay_record"]["payload"]["execution"])
        self.assertEqual(result["phase"].balance, carried_balance)
        self.assertEqual(result["phase"].floating_pl, 0)
        self.assertEqual(result["phase"].high_water_mark, carried_balance)
        self.assertEqual(replay_after.balance, carried_balance)
        self.assertEqual(replay_after.floating_pl, 0)
        self.assertEqual(replay_after.phase_initial_balance, 50000)

    def test_replay_bound_next_phase_rejects_unconsumed_replay_progression_without_prop_writes(self):
        dataset, replay_service, replay_id, stepped, snapshot, boundary_event = self._build_replay_boundary()
        session, attempt, _, _, intent = self._create_bound_multiphase_bundle(
            dataset=dataset,
            replay_id=replay_id,
            snapshot=snapshot,
            boundary_event=boundary_event,
            carry_policy="reset",
            position_policy="must_be_flat",
        )
        advanced = replay_service.step(self.workspace_id, replay_id, stepped["revision"], 1)
        advanced_snapshot = ReplayExecutionSnapshot.model_validate(advanced["payload"]["execution"])
        self.assertGreater(advanced_snapshot.event_sequence, snapshot.event_sequence)

        with self.assertRaisesRegex(PropPersistenceConflict, "unconsumed progression"):
            self.store.apply_prop_transition_intent(intent)

        restored = self.store.get_prop_resume_state(self.workspace_id, session.session_id, attempt.attempt_id)
        self.assertEqual(restored["attempt"].revision, 1)
        self.assertEqual(restored["phase"].phase_index, 1)
        replay_restored = self.store.get_record(self.workspace_id, "replay", replay_id)
        self.assertEqual(replay_restored["revision"], advanced["revision"])
        self.assertFalse(any(item.get("kind") == "phase_transition" for item in advanced_snapshot.ledger))

    def test_replay_bound_next_phase_rejects_pending_replay_order_without_prop_writes(self):
        dataset, replay_service, replay_id, stepped, snapshot, boundary_event = self._build_replay_boundary()
        session, attempt, _, _, intent = self._create_bound_multiphase_bundle(
            dataset=dataset,
            replay_id=replay_id,
            snapshot=snapshot,
            boundary_event=boundary_event,
            carry_policy="reset",
            position_policy="must_be_flat",
        )
        queued = replay_service.queue_market_order(
            self.workspace_id,
            replay_id,
            stepped["revision"],
            operation_id=f"pending-{uuid4().hex}",
            side="BUY",
            quantity="0.10",
            stop_loss="1.0900",
            take_profit="1.1400",
        )

        with self.assertRaisesRegex(PropPersistenceConflict, "zero pending replay orders"):
            self.store.apply_prop_transition_intent(intent)

        prop_restored = self.store.get_prop_resume_state(self.workspace_id, session.session_id, attempt.attempt_id)
        self.assertEqual(prop_restored["attempt"].revision, 1)
        self.assertEqual(prop_restored["phase"].phase_index, 1)
        replay_restored = self.store.get_record(self.workspace_id, "replay", replay_id)
        self.assertEqual(replay_restored["revision"], queued["revision"])
        restored_snapshot = ReplayExecutionSnapshot.model_validate(replay_restored["payload"]["execution"])
        self.assertIsNotNone(restored_snapshot.pending_market_order)
        self.assertFalse(any(item.get("kind") == "phase_transition" for item in restored_snapshot.ledger))

    def test_replay_bound_next_phase_rolls_back_replay_and_prop_on_mid_transaction_failure(self):
        dataset, _, replay_id, stepped, snapshot, boundary_event = self._build_replay_boundary()
        session, attempt, _, _, intent = self._create_bound_multiphase_bundle(
            dataset=dataset,
            replay_id=replay_id,
            snapshot=snapshot,
            boundary_event=boundary_event,
            carry_policy="reset",
            position_policy="must_be_flat",
        )

        with patch.object(self.store, "_sync_prop_session_status", side_effect=RuntimeError("forced sync failure")):
            with self.assertRaisesRegex(RuntimeError, "forced sync failure"):
                self.store.apply_prop_transition_intent(intent)

        replay_restored = self.store.get_record(self.workspace_id, "replay", replay_id)
        restored_snapshot = ReplayExecutionSnapshot.model_validate(replay_restored["payload"]["execution"])
        self.assertEqual(replay_restored["revision"], stepped["revision"])
        self.assertEqual(restored_snapshot.event_sequence, snapshot.event_sequence)
        self.assertFalse(any(item.get("kind") == "phase_transition" for item in restored_snapshot.ledger))
        prop_restored = self.store.get_prop_resume_state(self.workspace_id, session.session_id, attempt.attempt_id)
        self.assertEqual(prop_restored["attempt"].revision, 1)
        self.assertEqual(prop_restored["phase"].phase_index, 1)

    def test_replay_bound_next_phase_rejects_final_dataset_bar_without_writes(self):
        dataset, _, replay_id, stepped, snapshot, boundary_event = self._build_replay_boundary(row_count=2)
        session, attempt, _, _, intent = self._create_bound_multiphase_bundle(
            dataset=dataset,
            replay_id=replay_id,
            snapshot=snapshot,
            boundary_event=boundary_event,
            carry_policy="reset",
            position_policy="must_be_flat",
        )
        self.assertEqual(stepped["payload"]["status"], "completed")

        with self.assertRaisesRegex(PropPersistenceConflict, "future replay bar"):
            self.store.apply_prop_transition_intent(intent)

        replay_restored = self.store.get_record(self.workspace_id, "replay", replay_id)
        self.assertEqual(replay_restored["revision"], stepped["revision"])
        prop_restored = self.store.get_prop_resume_state(self.workspace_id, session.session_id, attempt.attempt_id)
        self.assertEqual(prop_restored["attempt"].revision, 1)
        self.assertEqual(prop_restored["phase"].phase_index, 1)


if __name__ == "__main__":
    unittest.main()
from trading_workspace_v2.api import create_app
from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.auth import LocalWorkspaceAuthorization
from trading_workspace_v2.contracts import DatasetSource
