from __future__ import annotations

import os
import json
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from threading import Barrier
from uuid import uuid4

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
for entry in (str(ROOT), str(V2)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

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
)
from trading_workspace_v2.api import create_app
from trading_workspace_v2.auth import LocalWorkspaceAuthorization
from trading_workspace_v2.store import (
    PostgresStore,
    PropIdempotencyConflict,
    PropPersistenceConflict,
    StoredContractUntrusted,
)


def amount(value: str) -> ThresholdValue:
    return ThresholdValue(amount=Decimal(value))


def profile() -> PropProfileSnapshot:
    return PropProfileSnapshot(
        profile_id="ps01-generic",
        terms_version="2026-09-25",
        profile_hash="sha256:ps01-fixture-v1",
        effective_from=date(2026, 9, 25),
        source_kind="generic",
        supported_rule_flags=["daily_loss", "overall_drawdown", "profit_target"],
        phases=[
            PropPhaseSpec(
                phase_index=1,
                initial_capital=Decimal("100000"),
                currency="USD",
                profit_target=ProfitTargetRule(threshold=amount("10000")),
                daily_loss=LossRule(threshold=amount("5000")),
                overall_drawdown=OverallDrawdownRule(threshold=amount("10000")),
                reset_timezone="UTC",
                min_qualifying_days=1,
            )
        ],
    )


class Ps01PropPersistenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        dsn = os.getenv("TW_V2_DATABASE_URL")
        if not dsn:
            raise unittest.SkipTest("TW_V2_DATABASE_URL is required for PS-01 Postgres persistence tests")
        cls.dsn = dsn
        cls.store = PostgresStore(dsn)
        cls.store.initialize()

    def setUp(self):
        suffix = uuid4().hex
        self.workspace_id = f"ps01-{suffix}"
        self.session_id = f"session-{suffix}"
        self.attempt_id = f"attempt-{suffix}"
        self.start = datetime(2026, 9, 1, 8, 0, tzinfo=timezone.utc)
        self.cutoff = self.start + timedelta(days=30)
        self.session = PropSessionSnapshot(
            workspace_id=self.workspace_id,
            session_id=self.session_id,
            profile=profile(),
            status="running",
        )
        self.attempt = ChallengeAttemptSnapshot(
            workspace_id=self.workspace_id,
            session_id=self.session_id,
            attempt_id=self.attempt_id,
            profile_id=self.session.profile.profile_id,
            terms_version=self.session.profile.terms_version,
            profile_hash=self.session.profile.profile_hash,
            data_version="dataset-sha256:ps01",
            cost_version="cost-v1",
            engine_version="replay-v1",
            status="running",
            revision=1,
            virtual_start_utc=self.start,
            virtual_cutoff_utc=self.cutoff,
        )
        self.phase = PhaseStateSnapshot(
            workspace_id=self.workspace_id,
            session_id=self.session_id,
            attempt_id=self.attempt_id,
            profile_hash=self.session.profile.profile_hash,
            phase_index=1,
            initial_balance=Decimal("100000"),
            balance=Decimal("100250"),
            floating_pl=Decimal("-50"),
            equity=Decimal("100200"),
            high_water_mark=Decimal("100400"),
            daily_anchor=Decimal("100100"),
            qualifying_days=1,
            virtual_time_utc=self.start + timedelta(hours=2),
            last_event_sequence=7,
            open_positions=1,
            pending_orders=1,
            evaluation_quality="full_for_declared_model",
        )
        self.resume_state = {
            "cursor": {"bar_index": 412, "timestamp_utc": "2026-09-01T10:00:00Z"},
            "open_positions": [{"position_id": "pos-1", "side": "long", "quantity": "1"}],
            "pending_orders": [{"order_id": "ord-1", "kind": "stop", "price": "1.1050"}],
        }
        self.store.create_prop_session(self.session)
        self.store.create_prop_attempt(self.attempt, self.phase, resume_state=self.resume_state)

    def test_persisted_prop_identity_corruption_never_crosses_scoped_reads(self):
        for table,column,original,changes in (
            ("prop_sessions","snapshot_json",self.session.model_dump(mode="json"),
             {"workspace_id":"foreign-workspace","session_id":"foreign-session","status":"invalid"}),
            ("prop_attempts","snapshot_json",self.attempt.model_dump(mode="json"),
             {"workspace_id":"foreign-workspace","session_id":"foreign-session","attempt_id":"foreign-attempt","revision":1.5}),
            ("prop_attempts","phase_json",self.phase.model_dump(mode="json"),
             {"workspace_id":"foreign-workspace","session_id":"foreign-session","attempt_id":"foreign-attempt","profile_hash":"sha256:foreign-profile"}),
        ):
            for key,value in changes.items():
                with self.subTest(table=table,column=column,key=key):
                    with self.store.connect() as conn:
                        conn.execute(f"UPDATE {table} SET {column}=jsonb_set({column},%s,%s::jsonb) WHERE workspace_id=%s AND session_id=%s",
                                     ([key],json.dumps(value),self.workspace_id,self.session_id))
                    try:
                        getters = [lambda:self.store.get_prop_resume_state(self.workspace_id,self.session_id,self.attempt_id)]
                        if table == "prop_sessions":
                            getters += [lambda:self.store.get_prop_session(self.workspace_id,self.session_id),
                                        lambda:self.store.list_prop_sessions(self.workspace_id)]
                        elif column == "snapshot_json":
                            getters += [lambda:self.store.get_prop_attempt(self.workspace_id,self.session_id,self.attempt_id),
                                        lambda:self.store.list_prop_attempts(self.workspace_id,self.session_id)]
                        for getter in getters:
                            with self.assertRaisesRegex(StoredContractUntrusted,"stored_contract_untrusted"):
                                getter()
                    finally:
                        with self.store.connect() as conn:
                            conn.execute(f"UPDATE {table} SET {column}=%s::jsonb WHERE workspace_id=%s AND session_id=%s",
                                         (json.dumps(original),self.workspace_id,self.session_id))
        restored = self.store.get_prop_resume_state(self.workspace_id,self.session_id,self.attempt_id)
        self.assertEqual(restored["attempt"],self.attempt)

    def test_resume_round_trip_preserves_cursor_money_event_and_orders_after_store_restart(self):
        next_attempt = self.attempt.model_copy(update={"revision": 2})
        next_phase = self.phase.model_copy(
            update={
                "balance": Decimal("100500"),
                "floating_pl": Decimal("-125"),
                "equity": Decimal("100375"),
                "high_water_mark": Decimal("100750"),
                "daily_anchor": Decimal("100300"),
                "virtual_time_utc": self.start + timedelta(hours=3),
                "last_event_sequence": 8,
            }
        )
        next_resume = {
            **self.resume_state,
            "cursor": {"bar_index": 433, "timestamp_utc": "2026-09-01T11:00:00Z"},
        }
        saved = self.store.save_prop_resume_state(
            next_attempt,
            next_phase,
            expected_revision=1,
            operation_id=f"pause-{uuid4().hex}",
            resume_state=next_resume,
        )
        self.assertFalse(saved["duplicate"])

        restarted_store = PostgresStore(self.dsn)
        restored = restarted_store.get_prop_resume_state(self.workspace_id, self.session_id, self.attempt_id)
        self.assertIsNotNone(restored)
        self.assertEqual(restored["attempt"].revision, 2)
        self.assertEqual(restored["attempt"].status, "running")
        self.assertEqual(restored["attempt"].profile_hash, self.session.profile.profile_hash)
        self.assertEqual(restored["phase"].equity, Decimal("100375"))
        self.assertEqual(restored["phase"].high_water_mark, Decimal("100750"))
        self.assertEqual(restored["phase"].daily_anchor, Decimal("100300"))
        self.assertEqual(restored["phase"].last_event_sequence, 8)
        self.assertEqual(restored["phase"].open_positions, 1)
        self.assertEqual(restored["phase"].pending_orders, 1)
        self.assertEqual(restored["resume_state"]["cursor"]["bar_index"], 433)
        self.assertEqual(restored["resume_state"]["open_positions"][0]["position_id"], "pos-1")
        self.assertEqual(restored["resume_state"]["pending_orders"][0]["order_id"], "ord-1")

    def test_attempt_writes_are_revision_fenced_and_durably_idempotent(self):
        operation_id = f"pause-{uuid4().hex}"
        next_attempt = self.attempt.model_copy(update={"revision": 2})
        next_phase = self.phase.model_copy(
            update={
                "virtual_time_utc": self.start + timedelta(hours=4),
                "last_event_sequence": 8,
            }
        )
        first = self.store.save_prop_resume_state(
            next_attempt,
            next_phase,
            expected_revision=1,
            operation_id=operation_id,
            resume_state=self.resume_state,
        )
        duplicate = PostgresStore(self.dsn).save_prop_resume_state(
            next_attempt,
            next_phase,
            expected_revision=1,
            operation_id=operation_id,
            resume_state=self.resume_state,
        )
        self.assertFalse(first["duplicate"])
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(duplicate["attempt"], next_attempt)

        with self.assertRaisesRegex(PropPersistenceConflict, "revision conflict"):
            self.store.save_prop_resume_state(
                next_attempt,
                next_phase,
                expected_revision=1,
                operation_id=f"stale-{uuid4().hex}",
                resume_state=self.resume_state,
            )

        changed_phase = next_phase.model_copy(update={"last_event_sequence": 9})
        with self.assertRaisesRegex(PropIdempotencyConflict, "already used"):
            self.store.save_prop_resume_state(
                next_attempt,
                changed_phase,
                expected_revision=1,
                operation_id=operation_id,
                resume_state=self.resume_state,
            )

    def test_concurrent_duplicate_operation_is_serialized_as_idempotent_success(self):
        operation_id = f"two-tabs-{uuid4().hex}"
        next_attempt = self.attempt.model_copy(update={"revision": 2})
        next_phase = self.phase.model_copy(
            update={
                "virtual_time_utc": self.start + timedelta(hours=4),
                "last_event_sequence": 8,
            }
        )
        barrier = Barrier(2)

        def save_once():
            barrier.wait()
            return PostgresStore(self.dsn).save_prop_resume_state(
                next_attempt,
                next_phase,
                expected_revision=1,
                operation_id=operation_id,
                resume_state=self.resume_state,
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: save_once(), range(2)))
        self.assertEqual(sorted(result["duplicate"] for result in results), [False, True])
        self.assertTrue(all(result["attempt"] == next_attempt for result in results))

    def test_resume_rejects_missing_position_or_pending_order_state(self):
        next_attempt = self.attempt.model_copy(update={"revision": 2})
        next_phase = self.phase.model_copy(
            update={
                "virtual_time_utc": self.start + timedelta(hours=4),
                "last_event_sequence": 8,
            }
        )
        with self.assertRaisesRegex(PropPersistenceConflict, "open_positions are required"):
            self.store.save_prop_resume_state(
                next_attempt,
                next_phase,
                expected_revision=1,
                operation_id=f"missing-positions-{uuid4().hex}",
                resume_state={"pending_orders": self.resume_state["pending_orders"]},
            )
        with self.assertRaisesRegex(PropPersistenceConflict, "pending_orders are required"):
            self.store.save_prop_resume_state(
                next_attempt,
                next_phase,
                expected_revision=1,
                operation_id=f"missing-orders-{uuid4().hex}",
                resume_state={"open_positions": self.resume_state["open_positions"]},
            )

    def test_resume_requires_monotonic_cursor_within_attempt(self):
        next_attempt = self.attempt.model_copy(update={"revision": 2})
        next_phase = self.phase.model_copy(
            update={
                "virtual_time_utc": self.start + timedelta(hours=4),
                "last_event_sequence": 8,
            }
        )
        without_cursor = {
            "open_positions": self.resume_state["open_positions"],
            "pending_orders": self.resume_state["pending_orders"],
        }
        with self.assertRaisesRegex(PropPersistenceConflict, "resume cursor is required"):
            self.store.save_prop_resume_state(
                next_attempt,
                next_phase,
                expected_revision=1,
                operation_id=f"missing-cursor-{uuid4().hex}",
                resume_state=without_cursor,
            )

        rewound = {
            **self.resume_state,
            "cursor": {"bar_index": 400, "timestamp_utc": "2026-09-01T09:30:00Z"},
        }
        with self.assertRaisesRegex(PropPersistenceConflict, "cursor cannot move backwards"):
            self.store.save_prop_resume_state(
                next_attempt,
                next_phase,
                expected_revision=1,
                operation_id=f"rewind-cursor-{uuid4().hex}",
                resume_state=rewound,
            )

    def test_concurrent_duplicate_create_is_deterministic(self):
        suffix = uuid4().hex
        workspace_id = f"ps01-create-{suffix}"
        session_id = f"session-{suffix}"
        attempt_id = f"attempt-{suffix}"
        session = self.session.model_copy(update={"workspace_id": workspace_id, "session_id": session_id})
        attempt = self.attempt.model_copy(
            update={"workspace_id": workspace_id, "session_id": session_id, "attempt_id": attempt_id}
        )
        phase = self.phase.model_copy(
            update={"workspace_id": workspace_id, "session_id": session_id, "attempt_id": attempt_id}
        )
        session_barrier = Barrier(2)

        def create_session_once():
            session_barrier.wait()
            return PostgresStore(self.dsn).create_prop_session(session)

        with ThreadPoolExecutor(max_workers=2) as executor:
            sessions = list(executor.map(lambda _: create_session_once(), range(2)))
        self.assertEqual(sessions, [session, session])

        attempt_barrier = Barrier(2)

        def create_attempt_once():
            attempt_barrier.wait()
            return PostgresStore(self.dsn).create_prop_attempt(
                attempt,
                phase,
                resume_state=self.resume_state,
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            attempts = list(executor.map(lambda _: create_attempt_once(), range(2)))
        self.assertEqual(sorted(result["duplicate"] for result in attempts), [False, True])

    def test_session_allows_only_one_active_attempt_and_restart_requires_terminal_parent(self):
        second = self.attempt.model_copy(
            update={
                "attempt_id": f"second-{uuid4().hex}",
                "parent_attempt_id": self.attempt_id,
            }
        )
        second_phase = self.phase.model_copy(update={"attempt_id": second.attempt_id})
        with self.assertRaisesRegex(PropPersistenceConflict, "active attempt"):
            self.store.create_prop_attempt(second, second_phase, resume_state=self.resume_state)

        abandoned = self.store.apply_prop_transition_intent(
            TransitionIntent(
                workspace_id=self.workspace_id,
                session_id=self.session_id,
                attempt_id=self.attempt_id,
                profile_hash=self.session.profile.profile_hash,
                intent_id=f"abandon-{uuid4().hex}",
                expected_revision=1,
                event_sequence=self.phase.last_event_sequence,
                action="abandon",
            )
        )
        restarted = self.store.create_prop_attempt(second, second_phase, resume_state=self.resume_state)
        self.assertFalse(restarted["duplicate"])
        self.assertEqual(restarted["session"].status, second.status)
        self.assertEqual(abandoned["attempt"].status, "abandoned")

    def test_atomic_bundle_rolls_back_new_session_when_attempt_cannot_be_created(self):
        suffix = uuid4().hex
        workspace_id = f"ps01-bundle-{suffix}"
        session_id = f"session-{suffix}"
        attempt_id = f"attempt-{suffix}"
        session = self.session.model_copy(update={"workspace_id": workspace_id, "session_id": session_id})
        attempt = self.attempt.model_copy(
            update={
                "workspace_id": workspace_id,
                "session_id": session_id,
                "attempt_id": attempt_id,
                "parent_attempt_id": "missing-parent",
            }
        )
        phase = self.phase.model_copy(
            update={"workspace_id": workspace_id, "session_id": session_id, "attempt_id": attempt_id}
        )
        with self.assertRaisesRegex(PropPersistenceConflict, "parent prop attempt"):
            self.store.create_prop_session_bundle(session, attempt, phase, resume_state=self.resume_state)
        self.assertIsNone(self.store.get_prop_session(workspace_id, session_id))

    def test_atomic_bundle_retry_is_idempotent(self):
        suffix = uuid4().hex
        workspace_id = f"ps01-bundle-retry-{suffix}"
        session_id = f"session-{suffix}"
        attempt_id = f"attempt-{suffix}"
        session = self.session.model_copy(update={"workspace_id": workspace_id, "session_id": session_id})
        attempt = self.attempt.model_copy(
            update={"workspace_id": workspace_id, "session_id": session_id, "attempt_id": attempt_id}
        )
        phase = self.phase.model_copy(
            update={"workspace_id": workspace_id, "session_id": session_id, "attempt_id": attempt_id}
        )
        first = self.store.create_prop_session_bundle(session, attempt, phase, resume_state=self.resume_state)
        duplicate = PostgresStore(self.dsn).create_prop_session_bundle(
            session, attempt, phase, resume_state=self.resume_state
        )
        self.assertFalse(first["duplicate"])
        self.assertTrue(duplicate["duplicate"])

    def test_atomic_bundle_cannot_create_a_second_active_attempt(self):
        suffix = uuid4().hex
        workspace_id = f"ps01-bundle-active-{suffix}"
        session_id = f"session-{suffix}"
        first_attempt_id = f"attempt-a-{suffix}"
        second_attempt_id = f"attempt-b-{suffix}"
        session = self.session.model_copy(update={"workspace_id": workspace_id, "session_id": session_id})
        first_attempt = self.attempt.model_copy(
            update={"workspace_id": workspace_id, "session_id": session_id, "attempt_id": first_attempt_id}
        )
        first_phase = self.phase.model_copy(
            update={"workspace_id": workspace_id, "session_id": session_id, "attempt_id": first_attempt_id}
        )
        second_attempt = first_attempt.model_copy(
            update={"attempt_id": second_attempt_id, "parent_attempt_id": first_attempt_id}
        )
        second_phase = first_phase.model_copy(update={"attempt_id": second_attempt_id})

        self.store.create_prop_session_bundle(
            session,
            first_attempt,
            first_phase,
            resume_state=self.resume_state,
        )
        with self.assertRaisesRegex(PropPersistenceConflict, "active attempt"):
            self.store.create_prop_session_bundle(
                session,
                second_attempt,
                second_phase,
                resume_state=self.resume_state,
            )

    def test_atomic_bundle_rejects_divergent_session_and_attempt_lifecycle_status(self):
        suffix = uuid4().hex
        workspace_id = f"ps01-bundle-status-{suffix}"
        session_id = f"session-{suffix}"
        attempt_id = f"attempt-{suffix}"
        session = self.session.model_copy(
            update={"workspace_id": workspace_id, "session_id": session_id, "status": "paused"}
        )
        attempt = self.attempt.model_copy(
            update={"workspace_id": workspace_id, "session_id": session_id, "attempt_id": attempt_id}
        )
        phase = self.phase.model_copy(
            update={"workspace_id": workspace_id, "session_id": session_id, "attempt_id": attempt_id}
        )

        with self.assertRaisesRegex(PropPersistenceConflict, "lifecycle status must match"):
            self.store.create_prop_session_bundle(session, attempt, phase, resume_state=self.resume_state)
        self.assertIsNone(self.store.get_prop_session(workspace_id, session_id))

    def test_session_profile_is_frozen_and_tenant_queries_are_isolated(self):
        changed_profile = self.session.profile.model_copy(update={"terms_version": "changed-after-start"})
        changed = self.session.model_copy(update={"profile": changed_profile, "revision": 2})
        with self.assertRaisesRegex(PropPersistenceConflict, "frozen prop profile"):
            self.store.update_prop_session(
                changed,
                expected_revision=1,
                operation_id=f"profile-edit-{uuid4().hex}",
            )

        valid = self.session.model_copy(update={"revision": 2})
        operation_id = f"session-checkpoint-{uuid4().hex}"
        first = self.store.update_prop_session(valid, expected_revision=1, operation_id=operation_id)
        duplicate = PostgresStore(self.dsn).update_prop_session(
            valid,
            expected_revision=1,
            operation_id=operation_id,
        )
        self.assertFalse(first["duplicate"])
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(self.store.get_prop_session(self.workspace_id, self.session_id), valid)
        self.assertIsNone(self.store.get_prop_session(f"other-{self.workspace_id}", self.session_id))
        self.assertEqual(self.store.list_prop_sessions(f"other-{self.workspace_id}"), [])

    def test_terminal_attempt_cannot_be_rewritten(self):
        terminal_result = self.store.apply_prop_transition_intent(
            TransitionIntent(
                workspace_id=self.workspace_id,
                session_id=self.session_id,
                attempt_id=self.attempt_id,
                profile_hash=self.session.profile.profile_hash,
                intent_id=f"abandon-{uuid4().hex}",
                expected_revision=1,
                event_sequence=self.phase.last_event_sequence,
                action="abandon",
            )
        )
        terminal = terminal_result["attempt"]
        terminal_phase = terminal_result["phase"]
        rewritten = terminal.model_copy(update={"status": "completed_pass", "revision": 3})
        with self.assertRaisesRegex(PropPersistenceConflict, "terminal prop attempts are immutable"):
            self.store.save_prop_resume_state(
                rewritten,
                terminal_phase.model_copy(update={"last_event_sequence": 9}),
                expected_revision=2,
                operation_id=f"rewrite-{uuid4().hex}",
                resume_state=self.resume_state,
            )

    def test_prop_api_round_trip_is_tenant_scoped_and_remains_simulation_only(self):
        authorization = LocalWorkspaceAuthorization.for_local_owner([self.workspace_id])
        with tempfile.TemporaryDirectory(prefix="ps01-api-") as artifact_root:
            with TestClient(
                create_app(
                    dsn=self.dsn,
                    artifact_root=artifact_root,
                    authorization=authorization,
                    learn_roots={},
                )
            ) as client:
                headers = {"X-Workspace-Id": self.workspace_id}
                current = client.get(
                    f"/api/v2/prop/sessions/{self.session_id}/attempts/{self.attempt_id}",
                    headers=headers,
                )
                self.assertEqual(current.status_code, 200)
                self.assertEqual(current.json()["attempt"]["mode"], "simulation")
                self.assertEqual(current.json()["resume_state"]["cursor"]["bar_index"], 412)

                bundle_suffix = uuid4().hex
                bundle_session = self.session.model_copy(
                    update={"session_id": f"bundle-session-{bundle_suffix}"}
                )
                bundle_attempt = self.attempt.model_copy(
                    update={
                        "session_id": bundle_session.session_id,
                        "attempt_id": f"bundle-attempt-{bundle_suffix}",
                    }
                )
                bundle_phase = self.phase.model_copy(
                    update={
                        "session_id": bundle_session.session_id,
                        "attempt_id": bundle_attempt.attempt_id,
                    }
                )
                bundled = client.post(
                    "/api/v2/prop/session-bundles",
                    headers=headers,
                    json={
                        "session": bundle_session.model_dump(mode="json"),
                        "attempt": bundle_attempt.model_dump(mode="json"),
                        "phase": bundle_phase.model_dump(mode="json"),
                        "resume_state": self.resume_state,
                    },
                )
                self.assertEqual(bundled.status_code, 201)
                self.assertFalse(bundled.json()["duplicate"])
                self.assertEqual(bundled.json()["attempt"]["mode"], "simulation")
                bundled_retry = client.post(
                    "/api/v2/prop/session-bundles",
                    headers=headers,
                    json={
                        "session": bundle_session.model_dump(mode="json"),
                        "attempt": bundle_attempt.model_dump(mode="json"),
                        "phase": bundle_phase.model_dump(mode="json"),
                        "resume_state": self.resume_state,
                    },
                )
                self.assertEqual(bundled_retry.status_code, 201)
                self.assertTrue(bundled_retry.json()["duplicate"])

                conflicting_bundle_attempt = bundle_attempt.model_copy(update={"data_version": "different-dataset"})
                conflicting_bundle = client.post(
                    "/api/v2/prop/session-bundles",
                    headers=headers,
                    json={
                        "session": bundle_session.model_dump(mode="json"),
                        "attempt": conflicting_bundle_attempt.model_dump(mode="json"),
                        "phase": bundle_phase.model_dump(mode="json"),
                        "resume_state": self.resume_state,
                    },
                )
                self.assertEqual(conflicting_bundle.status_code, 409)

                attempts = client.get(
                    f"/api/v2/prop/sessions/{self.session_id}/attempts",
                    headers=headers,
                )
                self.assertEqual(attempts.status_code, 200)
                self.assertEqual([item["attempt_id"] for item in attempts.json()["items"]], [self.attempt_id])

                next_attempt = self.attempt.model_copy(update={"revision": 2})
                next_phase = self.phase.model_copy(
                    update={
                        "virtual_time_utc": self.start + timedelta(hours=3),
                        "last_event_sequence": 8,
                    }
                )
                operation_id = f"api-pause-{uuid4().hex}"
                body = {
                    "attempt": next_attempt.model_dump(mode="json"),
                    "phase": next_phase.model_dump(mode="json"),
                    "expected_revision": 1,
                    "operation_id": operation_id,
                    "resume_state": self.resume_state,
                }
                first = client.put(
                    f"/api/v2/prop/sessions/{self.session_id}/attempts/{self.attempt_id}/resume",
                    headers=headers,
                    json=body,
                )
                duplicate = client.put(
                    f"/api/v2/prop/sessions/{self.session_id}/attempts/{self.attempt_id}/resume",
                    headers=headers,
                    json=body,
                )
                self.assertEqual(first.status_code, 200)
                self.assertFalse(first.json()["duplicate"])
                self.assertEqual(duplicate.status_code, 200)
                self.assertTrue(duplicate.json()["duplicate"])

                transition_id = f"api-pause-transition-{uuid4().hex}"
                paused = client.post(
                    f"/api/v2/prop/sessions/{self.session_id}/attempts/{self.attempt_id}/transitions",
                    headers=headers,
                    json={
                        "workspace_id": self.workspace_id,
                        "session_id": self.session_id,
                        "attempt_id": self.attempt_id,
                        "profile_hash": self.session.profile.profile_hash,
                        "intent_id": transition_id,
                        "expected_revision": 2,
                        "event_sequence": 8,
                        "action": "pause",
                    },
                )
                self.assertEqual(paused.status_code, 200)
                self.assertEqual(paused.json()["attempt"]["status"], "paused")
                self.assertEqual(paused.json()["session"]["status"], "paused")

                foreign = self.session.model_copy(
                    update={
                        "workspace_id": f"other-{self.workspace_id}",
                        "session_id": f"foreign-{self.session_id}",
                    }
                )
                denied = client.post(
                    "/api/v2/prop/sessions",
                    headers=headers,
                    json=foreign.model_dump(mode="json"),
                )
                self.assertEqual(denied.status_code, 403)
                self.assertEqual(denied.json()["detail"], "prop_workspace_mismatch")
                foreign_attempt = bundle_attempt.model_copy(
                    update={
                        "workspace_id": foreign.workspace_id,
                        "session_id": foreign.session_id,
                    }
                )
                foreign_phase = bundle_phase.model_copy(
                    update={
                        "workspace_id": foreign.workspace_id,
                        "session_id": foreign.session_id,
                    }
                )
                denied_bundle = client.post(
                    "/api/v2/prop/session-bundles",
                    headers=headers,
                    json={
                        "session": foreign.model_dump(mode="json"),
                        "attempt": foreign_attempt.model_dump(mode="json"),
                        "phase": foreign_phase.model_dump(mode="json"),
                        "resume_state": self.resume_state,
                    },
                )
                self.assertEqual(denied_bundle.status_code, 403)
                self.assertEqual(denied_bundle.json()["detail"], "prop_workspace_mismatch")
                self.assertFalse(client.get("/health").json()["execution_capability"])


if __name__ == "__main__":
    unittest.main()
