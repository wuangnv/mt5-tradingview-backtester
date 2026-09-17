import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from p2_app import create_app


class P2ResearchApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.evidence_db = root / "sessions.sqlite3"
        self.research_db = root / "research.sqlite3"
        self._create_empty_evidence_db()
        self.evidence_mtime = self.evidence_db.stat().st_mtime_ns
        self.app = create_app(self.evidence_db, self.research_db)
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp_dir.cleanup()

    def _create_empty_evidence_db(self):
        connection = sqlite3.connect(self.evidence_db)
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
        connection.commit()
        connection.close()

    def _create_chain(self):
        hypothesis = self.client.post(
            "/api/research/hypotheses",
            json={"title": "Range break", "thesis": "Clean breaks may continue."},
        ).json["hypothesis"]
        strategy = self.client.post(
            "/api/research/strategy-versions",
            json={
                "hypothesis_id": hypothesis["id"],
                "strategy_key": "range-break",
                "version": "1.0.0",
                "rules": {"entry": "break"},
            },
        ).json["strategy_version"]
        protocol = self.client.post(
            "/api/research/protocols",
            json={
                "strategy_version_id": strategy["id"],
                "name": "fixture",
                "dataset_id": "fixture-v1",
                "dataset_sha256": "a" * 64,
                "data_start_ms": 1000,
                "cutoff_ms": 5000,
                "seed": 11,
                "parameters": {"spread": 0.8},
            },
        ).json["protocol"]
        return hypothesis, strategy, protocol

    def test_full_research_lifecycle_and_snapshot(self):
        _, _, protocol = self._create_chain()
        created = self.client.post(
            "/api/research/runs",
            json={
                "protocol_id": protocol["id"],
                "budget": {"max_bars": 250, "max_runtime_ms": 2000},
            },
        )
        self.assertEqual(created.status_code, 201)
        run = created.json["run"]
        self.assertEqual(run["status"], "planned")
        self.assertEqual(len(run["repro_key"]), 64)

        started = self.client.post(f"/api/research/runs/{run['id']}/start")
        self.assertEqual(started.status_code, 200)
        self.assertEqual(started.json["run"]["status"], "running")

        completed = self.client.post(
            f"/api/research/runs/{run['id']}/complete",
            json={"observed_until_ms": 5000, "result": {"fixture_checksum": "abc123"}},
        )
        self.assertEqual(completed.status_code, 200)
        self.assertEqual(completed.json["run"]["status"], "completed")

        snapshot = self.client.get("/api/research")
        self.assertEqual(snapshot.status_code, 200)
        workspace = snapshot.json["workspace"]
        self.assertEqual(len(workspace["hypotheses"]), 1)
        self.assertEqual(len(workspace["strategy_versions"]), 1)
        self.assertEqual(len(workspace["protocols"]), 1)
        self.assertEqual(len(workspace["runs"]), 1)
        self.assertEqual(self.evidence_db.stat().st_mtime_ns, self.evidence_mtime)

    def test_future_leak_is_rejected_via_api(self):
        _, _, protocol = self._create_chain()
        run = self.client.post(
            "/api/research/runs",
            json={
                "protocol_id": protocol["id"],
                "budget": {"max_bars": 10, "max_runtime_ms": 100},
            },
        ).json["run"]
        self.client.post(f"/api/research/runs/{run['id']}/start")
        response = self.client.post(
            f"/api/research/runs/{run['id']}/complete",
            json={"observed_until_ms": 5001, "result": {}},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json["error"]["code"], "INVALID_RESEARCH")
        detail = self.client.get(f"/api/research/runs/{run['id']}")
        self.assertEqual(detail.json["run"]["status"], "running")

    def test_fail_cancel_and_execution_boundary_are_explicit(self):
        _, _, protocol = self._create_chain()
        failed = self.client.post(
            "/api/research/runs",
            json={
                "protocol_id": protocol["id"],
                "budget": {"max_bars": 10, "max_runtime_ms": 100},
            },
        ).json["run"]
        response = self.client.post(
            f"/api/research/runs/{failed['id']}/fail", json={"reason": "fixture invalid"}
        )
        self.assertEqual(response.json["run"]["status"], "failed")

        cancelled = self.client.post(
            "/api/research/runs",
            json={
                "protocol_id": protocol["id"],
                "budget": {"max_bars": 10, "max_runtime_ms": 100},
            },
        ).json["run"]
        response = self.client.post(
            f"/api/research/runs/{cancelled['id']}/cancel", json={"reason": "budget review"}
        )
        self.assertEqual(response.json["run"]["status"], "cancelled")
        self.assertEqual(self.client.post("/api/trade/place", json={}).status_code, 404)

    def test_research_page_and_import_do_not_load_mt5(self):
        page = self.client.get("/research")
        self.assertEqual(page.status_code, 200)
        self.assertIn(b"Research Workspace", page.data)
        self.assertIn(b"research.js", page.data)

        process = subprocess.run(
            [
                sys.executable,
                "-c",
                "import sys; import p2_app; "
                "assert 'mt5_data' not in sys.modules; "
                "assert 'app' not in sys.modules",
            ],
            cwd=Path(__file__).resolve().parents[1],
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(process.returncode, 0, process.stderr)


if __name__ == "__main__":
    unittest.main()
