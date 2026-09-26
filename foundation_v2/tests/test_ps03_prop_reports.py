from __future__ import annotations

import csv
import io
import os
import sys
import tempfile
import unittest
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
for entry in (str(ROOT), str(V2)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from trading_workspace_v2.prop_report import build_prop_attempt_report, prop_attempt_report_csv
from trading_workspace_v2.api import create_app
from trading_workspace_v2.auth import LocalWorkspaceAuthorization
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
)
from trading_workspace_v2.store import PostgresStore


def amount(value: str) -> ThresholdValue:
    return ThresholdValue(amount=Decimal(value))


def fixture(*, status: str = "failed_breach", branch_kind: str = "clean"):
    profile = PropProfileSnapshot(
        profile_id="ps03-generic",
        terms_version="2026-09-26",
        profile_hash="sha256:ps03-fixture-v1",
        effective_from=date(2026, 9, 26),
        phases=[
            PropPhaseSpec(
                phase_index=1,
                initial_capital=Decimal("100000"),
                currency="USD",
                profit_target=ProfitTargetRule(threshold=amount("10000")),
                daily_loss=LossRule(threshold=amount("5000")),
                overall_drawdown=OverallDrawdownRule(threshold=amount("10000")),
                reset_timezone="UTC",
            )
        ],
    )
    session = PropSessionSnapshot(
        workspace_id="ps03-workspace",
        session_id="ps03-session",
        profile=profile,
        status=status,
        revision=5,
    )
    attempt = ChallengeAttemptSnapshot(
        workspace_id=session.workspace_id,
        session_id=session.session_id,
        attempt_id="ps03-attempt",
        profile_id=profile.profile_id,
        terms_version=profile.terms_version,
        profile_hash=profile.profile_hash,
        data_version="dataset:ps03",
        cost_version="cost-v1",
        engine_version="replay-v1",
        status=status,
        revision=5,
        parent_attempt_id="parent-1" if branch_kind == "hindsight_exploratory" else None,
        branch_kind=branch_kind,
        virtual_start_utc=datetime(2026, 9, 1, tzinfo=timezone.utc),
        virtual_cutoff_utc=datetime(2026, 10, 1, tzinfo=timezone.utc),
    )
    phase = PhaseStateSnapshot(
        workspace_id=session.workspace_id,
        session_id=session.session_id,
        attempt_id=attempt.attempt_id,
        profile_hash=profile.profile_hash,
        phase_index=1,
        initial_balance=Decimal("100000"),
        balance=Decimal("100500"),
        floating_pl=Decimal("-6000"),
        equity=Decimal("94500"),
        high_water_mark=Decimal("101000"),
        daily_anchor=Decimal("100000"),
        qualifying_days=2,
        virtual_time_utc=datetime(2026, 9, 3, 12, tzinfo=timezone.utc),
        last_event_sequence=9,
        open_positions=1,
        pending_orders=0,
        evaluation_quality="full_for_declared_model",
    )
    resume = {
        "cursor": {"bar_index": 91, "timestamp_utc": "2026-09-03T12:00:00Z"},
        "open_positions": [{"position_id": "position-1"}],
        "pending_orders": [],
        "prop_lifecycle": {
            "last_objectives": {
                "schema": "prop-objectives-v1",
                "phase_index": 1,
                "money": {
                    "profit_target": {"hit": False},
                    "daily_loss": {"breached": True, "floor": "95000"},
                    "overall_drawdown": {"breached": False, "floor": "90000"},
                },
                "calendar": {"min_qualifying_days_satisfied": True},
                "positions_ready": False,
                "pass_ready": False,
                "technical_status": "ready",
                "terminal_action": "breach",
            }
        },
    }
    if branch_kind == "hindsight_exploratory":
        resume["replay_binding"] = {
            "replay_session_id": "replay-child",
            "branch_id": "branch-1",
            "dataset_id": "dataset-1",
            "dataset_sha256": "a" * 64,
            "last_replay_event_sequence": 9,
        }
        resume["branch_provenance"] = {
            "kind": "replay_prop_hindsight_branch_v1",
            "parent_attempt_id": "parent-1",
        }
    return session, attempt, phase, resume


class Ps03PropReportTests(unittest.TestCase):
    def test_report_explains_breach_from_server_owned_objectives_and_stays_simulation_only(self):
        report = build_prop_attempt_report(*fixture())

        self.assertEqual(report["schema_version"], "prop-attempt-report-v1")
        self.assertEqual(report["result_source"], "simulation")
        self.assertEqual(report["outcome"]["status"], "failed_breach")
        self.assertTrue(report["outcome"]["terminal"])
        self.assertEqual(report["outcome"]["terminal_action"], "breach")
        self.assertEqual(report["outcome"]["reason_codes"], ["daily_loss_breached"])
        self.assertEqual(
            report["outcome"]["breaches"],
            [{"rule": "daily_loss", "current": None, "floor": "95000", "reference": None}],
        )
        self.assertEqual(report["objectives"]["money"]["daily_loss"]["floor"], "95000")
        self.assertFalse(report["broker_execution_capability"])
        self.assertFalse(report["safety"]["broker_results_included"])
        self.assertFalse(report["tutorials"]["answer_keys_exposed"])

    def test_hindsight_report_keeps_branch_provenance_and_replay_result_identity(self):
        report = build_prop_attempt_report(*fixture(branch_kind="hindsight_exploratory"))

        self.assertEqual(report["result_source"], "replay_simulation")
        self.assertTrue(report["provenance"]["hindsight_exploratory"])
        self.assertEqual(report["provenance"]["replay_binding"]["replay_session_id"], "replay-child")
        self.assertEqual(report["provenance"]["branch_provenance"]["parent_attempt_id"], "parent-1")

    def test_csv_export_uses_stable_summary_fields_without_nested_resume_payload(self):
        report = build_prop_attempt_report(*fixture())
        exported = prop_attempt_report_csv(report)
        rows = list(csv.DictReader(io.StringIO(exported)))

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["attempt_id"], "ps03-attempt")
        self.assertEqual(rows[0]["reason_codes"], "daily_loss_breached")
        self.assertEqual(rows[0]["broker_execution_capability"], "False")
        self.assertNotIn("open_positions", rows[0])
        self.assertNotIn("objectives", rows[0])


@unittest.skipUnless(os.getenv("TW_V2_DATABASE_URL"), "TW_V2_DATABASE_URL is required for PS-03 API tests")
class Ps03PropReportApiTests(unittest.TestCase):
    def setUp(self):
        self.dsn = os.environ["TW_V2_DATABASE_URL"]
        suffix = uuid4().hex
        self.workspace_id = f"ps03-{suffix}"
        self.session_id = f"session-{suffix}"
        self.attempt_id = f"attempt-{suffix}"
        session, attempt, phase, resume = fixture()
        self.session = session.model_copy(
            update={"workspace_id": self.workspace_id, "session_id": self.session_id, "revision": 1}
        )
        self.attempt = attempt.model_copy(
            update={
                "workspace_id": self.workspace_id,
                "session_id": self.session_id,
                "attempt_id": self.attempt_id,
                "revision": 1,
            }
        )
        self.phase = phase.model_copy(
            update={
                "workspace_id": self.workspace_id,
                "session_id": self.session_id,
                "attempt_id": self.attempt_id,
            }
        )
        self.resume = resume
        store = PostgresStore(self.dsn)
        store.initialize()
        store.create_prop_session_bundle(self.session, self.attempt, self.phase, resume_state=self.resume)
        self.artifact_dir = tempfile.TemporaryDirectory(prefix="ps03-api-")
        self.client = TestClient(
            create_app(
                dsn=self.dsn,
                artifact_root=self.artifact_dir.name,
                authorization=LocalWorkspaceAuthorization.for_local_owner([self.workspace_id]),
            )
        )
        self.headers = {"X-Workspace-Id": self.workspace_id}

    def tearDown(self):
        self.client.close()
        self.artifact_dir.cleanup()

    def test_report_filter_and_csv_are_workspace_scoped_and_simulation_only(self):
        report_url = f"/api/v2/prop/sessions/{self.session_id}/attempts/{self.attempt_id}/report"
        report_response = self.client.get(report_url, headers=self.headers)
        self.assertEqual(report_response.status_code, 200)
        report = report_response.json()
        self.assertEqual(report["attempt"]["attempt_id"], self.attempt_id)
        self.assertEqual(report["outcome"]["reason_codes"], ["daily_loss_breached"])
        self.assertFalse(report["broker_execution_capability"])

        filtered = self.client.get(
            "/api/v2/prop/reports?status=failed_breach&branch_kind=clean",
            headers=self.headers,
        )
        self.assertEqual(filtered.status_code, 200)
        payload = filtered.json()
        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["items"][0]["session"]["session_id"], self.session_id)
        self.assertFalse(payload["broker_execution_capability"])

        empty = self.client.get("/api/v2/prop/reports?status=completed_pass", headers=self.headers)
        self.assertEqual(empty.status_code, 200)
        self.assertEqual(empty.json()["items"], [])

        exported = self.client.get(f"{report_url}.csv", headers=self.headers)
        self.assertEqual(exported.status_code, 200)
        self.assertTrue(exported.headers["content-type"].startswith("text/csv"))
        self.assertIn("attachment", exported.headers["content-disposition"])
        row = list(csv.DictReader(io.StringIO(exported.text)))[0]
        self.assertEqual(row["attempt_id"], self.attempt_id)
        self.assertEqual(row["attempt_status"], "failed_breach")
        self.assertEqual(row["broker_execution_capability"], "False")


if __name__ == "__main__":
    unittest.main()
