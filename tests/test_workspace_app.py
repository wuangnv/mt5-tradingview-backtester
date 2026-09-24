import hashlib
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from demo_broker import DemoBrokerSimulator
from r3b_qa_fixture import build_r3b_qa_report
from session_store import SessionStore
from workspace_app import create_app
from workspace_storage import WorkspaceStorageError, backup_workspace, restore_workspace


class WorkspaceAppTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.data_root = self.root / "data"
        self.data_root.mkdir()
        self.education_root = self.root / "education"
        self._create_education()
        self._create_evidence_db()
        self._create_history()
        self.evidence_hash = hashlib.sha256((self.data_root / "sessions.sqlite3").read_bytes()).hexdigest()
        self.history_hashes = self._history_hashes(self.data_root / "chunks")
        self.app = create_app(
            self.data_root,
            demo_adapter=DemoBrokerSimulator(),
            education_root=self.education_root,
        )
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp_dir.cleanup()

    def _create_evidence_db(self):
        payload = {
            "date": 200000,
            "symbol": "EURUSD",
            "timeframe": "H1",
            "barsReplayed": 2,
            "realMs": 5000,
            "startBalance": 1000,
            "trades": [
                {
                    "time": 10800,
                    "time_open": 3600,
                    "ticket": 1001,
                    "symbol": "EURUSD",
                    "type": "BUY",
                    "volume": 0.1,
                    "price_open": 1.06,
                    "price_close": 1.01,
                    "profit": -5.0,
                    "result": "Closed",
                    "r": -1.0,
                }
            ],
        }
        connection = sqlite3.connect(self.data_root / "sessions.sqlite3")
        connection.execute(
            """
            CREATE TABLE replay_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at_ms INTEGER NOT NULL,
                symbol TEXT NOT NULL,
                timeframe TEXT NOT NULL,
                bars_replayed INTEGER NOT NULL,
                duration_ms INTEGER NOT NULL,
                start_balance REAL NOT NULL,
                trade_count INTEGER NOT NULL,
                net_profit REAL NOT NULL,
                win_rate REAL NOT NULL,
                payload TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            INSERT INTO replay_sessions (
                created_at_ms, symbol, timeframe, bars_replayed, duration_ms,
                start_balance, trade_count, net_profit, win_rate, payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (200000, "EURUSD", "H1", 2, 5000, 1000, 1, -5.0, 0.0, json.dumps(payload)),
        )
        connection.commit()
        connection.close()

    def _create_history(self):
        directory = self.data_root / "chunks" / "EURUSD" / "H1"
        directory.mkdir(parents=True)
        bars = [
            {"time": 0, "open": 1.00, "high": 1.05, "low": 0.99, "close": 1.02, "volume": 10},
            {"time": 3600, "open": 1.02, "high": 1.08, "low": 1.01, "close": 1.06, "volume": 20},
            {"time": 7200, "open": 1.06, "high": 1.09, "low": 1.03, "close": 1.04, "volume": 30},
            {"time": 10800, "open": 1.04, "high": 1.07, "low": 1.00, "close": 1.01, "volume": 40},
            {"time": 14400, "open": 1.01, "high": 1.06, "low": 0.98, "close": 1.05, "volume": 50},
        ]
        (directory / "meta.json").write_text(
            json.dumps(
                {
                    "symbol": "EURUSD",
                    "timeframe": "H1",
                    "count": len(bars),
                    "firstTime": 0,
                    "lastTime": 14400,
                    "chunks": [{"index": 0, "count": len(bars), "firstTime": 0, "lastTime": 14400}],
                }
            ),
            encoding="utf-8",
        )
        (directory / "chunk_000000.json").write_text(json.dumps({"bars": bars}), encoding="utf-8")

    def _create_education(self):
        self.education_root.mkdir(parents=True)
        (self.education_root / "course.json").write_text(
            json.dumps(
                {
                    "version": "1.1",
                    "title": "Trading foundations",
                    "status": "authored_not_learner_validated",
                    "primary_language": "vi",
                    "start_lesson": "M01-L01",
                    "modules": [
                        {
                            "id": "M01",
                            "title": "Co che giao dich",
                            "file": "modules/01-giao-dich.md",
                            "lessons": [{"id": "M01-L01", "title": "Hai gia mua/ban"}],
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        (self.education_root / "progress.json").write_text(
            json.dumps(
                {
                    "main_course": {
                        "status": "in_progress",
                        "current_lesson_id": "M01-L01",
                        "completed_lessons": [],
                        "completed_modules": [],
                    },
                    "pending_activity": {
                        "id": "PENDING-1",
                        "objective": "Read a chart",
                        "lesson_file": "practice/example.md",
                        "variant": "fixture",
                        "expected": "must never be exposed",
                    },
                    "assessments": {"answer": "secret tutor key"},
                }
            ),
            encoding="utf-8",
        )

    @staticmethod
    def _history_hashes(root):
        return {
            path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in root.rglob("*")
            if path.is_file()
        }

    def test_supported_pages_share_navigation_and_keep_live_locked(self):
        for path, label in (
            ("/", b"Evidence Explorer"),
            ("/research", b"Research Workspace"),
            ("/practice?run=1&trade=1001", b"Practice Replay"),
            ("/trade-desk", b"Trade Desk"),
            ("/risk-lab", b"Probability / Risk Lab"),
        ):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path)
            self.assertIn(label, response.data)
            self.assertIn(b"Practice &amp; Journal", response.data)
            self.assertIn(b"Live locked", response.data)

        readiness = self.client.get("/api/live-readiness/state")
        self.assertEqual(readiness.status_code, 200)
        self.assertFalse(readiness.json["state"]["execution_enabled"])
        self.assertFalse(readiness.json["state"]["ready_for_live_gate"])
        self.assertEqual(self.client.post("/api/trade/place", json={}).status_code, 404)

    def test_u2_data_desk_metadata_is_read_only_and_holdout_content_stays_locked(self):
        providers = self.client.get("/api/data-desk/providers")
        self.assertEqual(providers.status_code, 200)
        self.assertEqual(providers.json["providers"][0]["provider_id"], "local-chunks")
        self.assertFalse(providers.json["providers"][0]["capabilities"]["fresh_quote"])
        self.assertFalse(providers.json["providers"][0]["capabilities"]["holdout_content"])

        datasets = self.client.get("/api/data-desk/datasets")
        self.assertEqual(datasets.status_code, 200)
        self.assertEqual(len(datasets.json["datasets"]), 1)
        dataset = datasets.json["datasets"][0]
        self.assertEqual(dataset["dataset_key"], "EURUSD:H1")
        self.assertEqual(dataset["rows"], 5)
        self.assertEqual(dataset["verified_range"], None)
        self.assertEqual(dataset["quality_status"], "unverified_local_cache")
        self.assertEqual(dataset["holdout"], {"metadata_visible": True, "content_access": False})

    def test_u3c_learn_bridge_uses_existing_owner_without_exposing_answer_keys(self):
        response = self.client.get("/api/learn/overview")
        self.assertEqual(response.status_code, 200)
        learn = response.json["learn"]
        self.assertEqual(learn["schema_version"], "learn-overview-v1")
        self.assertEqual(learn["progress"]["current_lesson_id"], "M01-L01")
        self.assertEqual(learn["progress"]["pending_activity"]["id"], "PENDING-1")
        self.assertTrue(learn["safety"]["read_only"])
        self.assertFalse(learn["safety"]["answer_keys_exposed"])
        serialized = json.dumps(response.json)
        self.assertNotIn("secret tutor key", serialized)
        self.assertNotIn("must never be exposed", serialized)

    def test_u4_chart_state_api_versions_annotations_and_blocks_future_anchors(self):
        payload = {
            "kind": "entry",
            "instrument_id": "EURUSD",
            "timeframe": "H1",
            "cutoff_ms": 7_200_000,
            "anchors": [{"time_utc": 7200, "price": 1.04}],
            "source": {"kind": "replay", "id": "1:1001"},
            "strategy_version_id": "manual-replay-v1",
            "label": "planned entry",
        }
        created = self.client.post("/api/chart/annotations", json=payload)
        self.assertEqual(created.status_code, 201)
        annotation = created.json["annotation"]
        listed = self.client.get("/api/chart/annotations?instrument_id=EURUSD&timeframe=H1")
        self.assertEqual([item["id"] for item in listed.json["annotations"]], [annotation["id"]])

        future = dict(payload)
        future["anchors"] = [{"time_utc": 10800, "price": 1.01}]
        blocked = self.client.post("/api/chart/annotations", json=future)
        self.assertEqual(blocked.status_code, 422)
        self.assertEqual(blocked.json["error"]["code"], "CHART_INVALID")

        layout = self.client.put(
            "/api/chart/layouts/practice",
            json={"payload": {"panels": [{"symbol": "EURUSD", "timeframe": "H1"}]}},
        )
        self.assertEqual(layout.status_code, 200)
        self.assertEqual(layout.json["layout"]["revision"], 1)

    def test_r3a_risk_lab_api_is_hypothetical_and_validated(self):
        streak = self.client.post(
            "/api/risk-lab/streak",
            json={"loss_probability": 0.5, "streak_length": 2, "horizon": 3},
        )
        self.assertEqual(streak.status_code, 200)
        scenario = streak.json["scenario"]
        self.assertEqual(scenario["label"], "hypothetical_iid_bernoulli")
        self.assertAlmostEqual(scenario["next_k_all_losses_probability"], 0.25)
        self.assertAlmostEqual(scenario["at_least_one_streak_probability"], 0.375)

        equity = self.client.post(
            "/api/risk-lab/equity",
            json={"starting_equity": 10000, "risk_fraction": 0.01, "losses": 3},
        )
        self.assertEqual(equity.status_code, 200)
        self.assertEqual(equity.json["scenario"]["label"], "hypothetical_fixed_fraction_losses")

        breakeven = self.client.post(
            "/api/risk-lab/breakeven",
            json={"win_payoff": 2, "loss_amount": 1, "extra_cost": 0, "win_probability": 0.5},
        )
        self.assertEqual(breakeven.status_code, 200)
        self.assertAlmostEqual(breakeven.json["scenario"]["breakeven_win_rate"], 1 / 3)
        self.assertAlmostEqual(breakeven.json["scenario"]["expectancy"], 0.5)

        invalid = self.client.post(
            "/api/risk-lab/streak",
            json={"loss_probability": 1.2, "streak_length": 2, "horizon": 3},
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json["error"]["code"], "RISK_LAB_INVALID_REQUEST")

    def test_u6d_prop_profile_api_stays_blocked_when_required_equity_path_is_missing(self):
        response = self.client.post(
            "/api/risk-lab/prop-profile/evaluate",
            json={
                "profile": {
                    "profile_id": "fixture-prop",
                    "terms_version": "test-v1",
                    "effective_from": "2026-09-19",
                    "reset_timezone": "Asia/Ho_Chi_Minh",
                    "cost_basis": "included",
                    "total_drawdown": {"type": "trailing", "amount": 1000, "basis": "equity"},
                    "daily_loss": {"amount": 500, "basis": "equity"},
                },
                "snapshot": {"starting_balance": 10000, "balance": 9900},
            },
        )
        self.assertEqual(response.status_code, 200)
        evaluation = response.json["evaluation"]
        self.assertEqual(evaluation["status"], "blocked_by_data")
        self.assertIn("missing_equity", evaluation["blocked_by_data"])
        self.assertIn("missing_high_water_mark", evaluation["blocked_by_data"])

    def test_r2_analytics_api_filter_and_export_share_one_read_model(self):
        analytics = self.client.get("/api/analytics/runs/1?side=BUY&outcome=loss")
        self.assertEqual(analytics.status_code, 200)
        view = analytics.json["analytics"]
        self.assertEqual(view["metrics"]["metric_schema_version"], "metrics-v2")
        self.assertEqual(view["scope"]["selected_trade_count"], 1)
        self.assertEqual(view["metrics"]["closed_trade_count"], 1)
        self.assertEqual(view["metrics"]["net_pnl"], -5.0)
        self.assertEqual(view["metrics"]["basis"]["costs"], "incomplete_or_unknown")
        self.assertIsNone(view["metrics"]["average_realized_r"])

        export = self.client.get("/api/analytics/runs/1/export.csv?side=BUY&outcome=loss")
        self.assertEqual(export.status_code, 200)
        self.assertIn(b"selected_trade_count,1", export.data)
        self.assertIn(b"1001", export.data)

        invalid = self.client.get("/api/analytics/runs/1?side=SHORT")
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json["error"]["code"], "ANALYTICS_INVALID_REQUEST")

    def test_r3b_current_legacy_run_is_locked_before_simulation(self):
        eligibility = self.client.get("/api/risk-lab/bootstrap/eligibility/1")
        self.assertEqual(eligibility.status_code, 200)
        gate = eligibility.json["eligibility"]
        self.assertFalse(gate["eligible"])
        self.assertIn("dataset_id_unknown", gate["reasons"])
        self.assertIn("cost_model_unknown", gate["reasons"])
        self.assertIn("risk_model_unknown", gate["reasons"])
        self.assertIn("requires_at_least_20_closed_trades", gate["reasons"])

        blocked = self.client.post(
            "/api/risk-lab/bootstrap",
            json={
                "run_id": "1",
                "seed": 123,
                "path_count": 100,
                "horizon": 20,
                "breach_drawdown_fraction": 0.10,
            },
        )
        self.assertEqual(blocked.status_code, 422)
        self.assertEqual(blocked.json["error"]["code"], "RISK_LAB_INSUFFICIENT_DATA")

    def test_r3b_provenance_complete_qa_run_is_eligible_and_reproducible_end_to_end(self):
        saved = SessionStore(self.data_root / "sessions.sqlite3").save(build_r3b_qa_report())
        run_id = str(saved["id"])

        run = self.client.get(f"/api/runs/{run_id}")
        self.assertEqual(run.status_code, 200)
        self.assertEqual(run.json["run"]["artifact_schema_version"], "replay-evidence-v2")
        self.assertEqual(run.json["run"]["data"]["quality_status"], "synthetic_qa_only")
        self.assertTrue(run.json["run"]["comparison"]["ready"])

        eligibility = self.client.get(f"/api/risk-lab/bootstrap/eligibility/{run_id}")
        self.assertEqual(eligibility.status_code, 200)
        gate = eligibility.json["eligibility"]
        self.assertTrue(gate["eligible"])
        self.assertEqual(gate["observed"]["closed_trades"], 30)
        self.assertGreaterEqual(gate["observed"]["utc_day_blocks"], 5)

        request_payload = {
            "run_id": run_id,
            "seed": 123,
            "path_count": 250,
            "horizon": 30,
            "breach_drawdown_fraction": 0.10,
        }
        first = self.client.post("/api/risk-lab/bootstrap", json=request_payload)
        second = self.client.post("/api/risk-lab/bootstrap", json=request_payload)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json["simulation"], second.json["simulation"])
        self.assertEqual(first.json["simulation"]["method"]["block_count"], 10)
        self.assertIn("breach_monte_carlo_se", first.json["simulation"]["results"])

    def test_workspace_status_is_explicitly_partial_and_reports_actual_local_schemas(self):
        response = self.client.get("/api/workspace/status")
        self.assertEqual(response.status_code, 200)
        status = response.json["workspace"]
        self.assertEqual(status["status_schema_version"], "workspace-integration-status-v2")
        self.assertFalse(status["acceptance"]["full_product_complete"])
        self.assertIn("ui_acceptance_pending", status["acceptance"]["blockers"])
        self.assertIn("live_execution_permission_pending", status["acceptance"]["blockers"])
        self.assertIn("production_research_protocol_pending", status["acceptance"]["blockers"])
        self.assertIn("miro_update_pending", status["acceptance"]["blockers"])
        self.assertEqual(status["database_user_versions"]["chart.sqlite3"], 1)
        self.assertEqual(status["database_user_versions"]["research.sqlite3"], 3)
        self.assertTrue(status["capabilities"]["prop_profile_evaluator"])
        self.assertFalse(status["capabilities"]["learn_bridge"]["answer_keys_exposed"])
        self.assertFalse(status["capabilities"]["execution"]["live_execution_enabled"])
        self.assertEqual(
            status["capabilities"]["execution"]["alert_runtime"], "in_app_poll_only"
        )
        self.assertFalse(status["capabilities"]["ai_advisory"]["execution_capability"])

    def test_end_to_end_journal_export_restart_and_copy_restore(self):
        runs = self.client.get("/api/runs?limit=10").json["runs"]
        self.assertEqual([run["run_id"] for run in runs], ["1"])
        metrics = self.client.get("/api/runs/1/metrics").json["metrics"]
        self.assertEqual(metrics["net_pnl"], -5.0)
        ledger = self.client.get("/api/runs/1/ledger").json["trades"]
        self.assertEqual(ledger[0]["trade_id"], "1001")

        context = self.client.get(
            "/api/practice/runs/1/trades/1001/context?cursor_ms=10800000"
        )
        self.assertEqual(context.status_code, 200)
        self.assertFalse(context.json["context"]["trade"]["outcome_revealed"])

        created = self.client.post(
            "/api/practice/runs/1/trades/1001/journal",
            json={
                "cursor_ms": 10800000,
                "intended_entry": 1.05,
                "intended_stop": 1.00,
                "intended_target": 1.10,
                "execution_grade": "followed",
                "rule_checks": {"entry": True, "risk": True, "exit": False},
                "notes": "workspace journey",
            },
        )
        self.assertEqual(created.status_code, 201)
        entry_id = created.json["entry"]["id"]
        self.assertEqual(created.json["entry"]["source"]["evidence_run_id"], "1")
        export = self.client.get("/api/runs/1/export.csv")
        self.assertEqual(export.status_code, 200)
        self.assertIn(b"net_pnl", export.data)

        restarted = create_app(
            self.data_root,
            demo_adapter=DemoBrokerSimulator(),
            education_root=self.education_root,
        )
        restarted.config["TESTING"] = True
        restored_entry = restarted.test_client().get(f"/api/practice/journal/{entry_id}")
        self.assertEqual(restored_entry.status_code, 200)
        self.assertEqual(restored_entry.json["entry"]["review"]["notes"], "workspace journey")

        backup_root = self.root / "backup"
        restored_root = self.root / "restored"
        manifest = backup_workspace(self.data_root, backup_root)
        restore_workspace(backup_root, restored_root)
        self.assertEqual(manifest["databases"]["research.sqlite3"]["user_version"], 3)
        self.assertEqual(manifest["databases"]["execution.sqlite3"]["user_version"], 3)
        restored_app = create_app(
            restored_root,
            demo_adapter=DemoBrokerSimulator(),
            education_root=self.education_root,
        )
        restored_app.config["TESTING"] = True
        restored_client = restored_app.test_client()
        restored_journal = restored_client.get(f"/api/practice/journal/{entry_id}")
        self.assertEqual(restored_journal.status_code, 200)
        self.assertEqual(restored_journal.json["entry"]["source"]["trade_id"], "1001")
        self.assertEqual(restored_client.get("/api/runs/1/metrics").json["metrics"]["net_pnl"], -5.0)
        self.assertEqual(
            hashlib.sha256((self.data_root / "sessions.sqlite3").read_bytes()).hexdigest(),
            self.evidence_hash,
        )
        self.assertEqual(self._history_hashes(self.data_root / "chunks"), self.history_hashes)

    def test_backup_rejects_tampering_and_unsupported_database_version(self):
        backup_root = self.root / "backup-tampered"
        backup_workspace(self.data_root, backup_root)
        with (backup_root / "journal.sqlite3").open("ab") as handle:
            handle.write(b"tampered")
        with self.assertRaisesRegex(WorkspaceStorageError, "checksum mismatch"):
            restore_workspace(backup_root, self.root / "restore-tampered")

        connection = sqlite3.connect(self.data_root / "research.sqlite3")
        connection.execute("PRAGMA user_version = 99")
        connection.close()
        with self.assertRaisesRegex(WorkspaceStorageError, "schema is unsupported"):
            backup_workspace(self.data_root, self.root / "backup-unsupported")

    def test_importing_workspace_chain_does_not_create_default_apps_or_load_mt5(self):
        process = subprocess.run(
            [
                sys.executable,
                "-c",
                "import sys, p1_app, p2_app, p3_app, p4_app, p5_app, workspace_app; "
                "assert 'mt5_data' not in sys.modules; "
                "assert all(not hasattr(module, 'app') for module in "
                "(p1_app, p2_app, p3_app, p4_app, p5_app, workspace_app))",
            ],
            cwd=Path(__file__).resolve().parents[1],
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(process.returncode, 0, process.stderr)


if __name__ == "__main__":
    unittest.main()
