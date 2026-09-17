import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from p1_app import create_app


class P1EvidenceApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "sessions.sqlite3"
        self._create_fixture_db()
        self.original_mtime = self.db_path.stat().st_mtime_ns
        self.app = create_app(self.db_path)
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp_dir.cleanup()

    @staticmethod
    def _payload(ticket, profit):
        return {
            "date": 1700000000000,
            "symbol": "EURUSD",
            "timeframe": "H1",
            "barsReplayed": 42,
            "realMs": 120000,
            "startBalance": 1000,
            "trades": [
                {
                    "time": 1700003600,
                    "time_open": 1700000000,
                    "ticket": ticket,
                    "symbol": "EURUSD",
                    "type": "BUY",
                    "volume": 0.1,
                    "price_open": 1.08,
                    "price_close": 1.081,
                    "profit": profit,
                    "result": "Take Profit" if profit > 0 else "Stop Loss",
                    "r": 1.5 if profit > 0 else -1.0,
                }
            ],
        }

    def _create_fixture_db(self):
        connection = sqlite3.connect(self.db_path)
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
        for offset, profit in enumerate((15, -7), start=1):
            payload = self._payload(100000 + offset, profit)
            connection.execute(
                """
                INSERT INTO replay_sessions (
                    created_at_ms, symbol, timeframe, bars_replayed, duration_ms,
                    start_balance, trade_count, net_profit, win_rate, payload
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    1700000000000 + offset,
                    "EURUSD",
                    "H1",
                    42,
                    120000,
                    1000,
                    1,
                    profit,
                    100 if profit > 0 else 0,
                    json.dumps(payload),
                ),
            )
        connection.commit()
        connection.close()

    def test_lists_two_runs_and_marks_legacy_unknowns(self):
        response = self.client.get("/api/runs")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json["runs"]), 2)
        run = response.json["runs"][0]
        self.assertEqual(run["artifact_schema_version"], "legacy-replay-session-v1")
        self.assertIsNone(run["data"]["requested_range"])
        self.assertIsNone(run["assumptions"]["cost_model_version"])
        self.assertFalse(run["comparison"]["ready"])

    def test_detail_ledger_metrics_equity_and_trade_share_one_read_model(self):
        detail = self.client.get("/api/runs/1")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json["run"]["run_id"], "1")

        ledger = self.client.get("/api/runs/1/ledger")
        self.assertEqual(ledger.status_code, 200)
        trade = ledger.json["trades"][0]
        self.assertEqual(trade["trade_id"], "100001")
        self.assertEqual(trade["net_pnl"], 15)
        self.assertIsNone(trade["fees"])
        self.assertIsNone(trade["realized_r"])
        self.assertEqual(trade["legacy_r"], 1.5)

        metrics = self.client.get("/api/runs/1/metrics")
        self.assertEqual(metrics.status_code, 200)
        self.assertEqual(metrics.json["metrics"]["net_pnl"], 15)
        self.assertIsNone(metrics.json["metrics"]["gross_pnl"])
        self.assertIsNone(metrics.json["metrics"]["fees"])

        equity = self.client.get("/api/runs/1/equity")
        self.assertEqual(equity.status_code, 200)
        self.assertEqual(equity.json["equity_curve"][-1]["equity"], 1015)

        inspector = self.client.get("/api/runs/1/trades/100001")
        self.assertEqual(inspector.status_code, 200)
        self.assertEqual(inspector.json["trade"], trade)

    def test_evidence_ui_and_exports_use_read_only_bundle(self):
        page = self.client.get("/")
        self.assertEqual(page.status_code, 200)
        self.assertIn(b"Evidence Explorer", page.data)
        self.assertNotIn(b"charting_library.standalone.js", page.data)
        self.assertEqual(page.headers["Cache-Control"], "no-store")
        self.assertIn("default-src 'self'", page.headers["Content-Security-Policy"])

        exported_json = self.client.get("/api/runs/1/export.json")
        self.assertEqual(exported_json.status_code, 200)
        self.assertIn("attachment", exported_json.headers["Content-Disposition"])
        bundle = json.loads(exported_json.data)
        self.assertEqual(bundle["run"]["run_id"], "1")
        self.assertEqual(bundle["metrics"]["net_pnl"], 15)
        self.assertEqual(bundle["ledger"][0]["trade_id"], "100001")

        exported_csv = self.client.get("/api/runs/1/export.csv")
        self.assertEqual(exported_csv.status_code, 200)
        text = exported_csv.data.decode("utf-8")
        self.assertIn("metrics,net_pnl,15.0", text)
        self.assertIn("data,requested_range,", text)
        self.assertIn("assumptions,cost_model_version,", text)
        self.assertIn("reproduce,metric_version,metrics-v1", text)
        self.assertIn("comparison,ready,False", text)
        self.assertIn("comparison,reasons,", text)
        self.assertIn("100001", text)
        self.assertEqual(self.db_path.stat().st_mtime_ns, self.original_mtime)

    def test_csv_export_neutralizes_formula_like_legacy_values(self):
        connection = sqlite3.connect(self.db_path)
        row = connection.execute("SELECT payload FROM replay_sessions WHERE id = 1").fetchone()
        payload = json.loads(row[0])
        payload["trades"][0]["ticket"] = "=1+1"
        connection.execute(
            "UPDATE replay_sessions SET payload = ? WHERE id = 1",
            (json.dumps(payload),),
        )
        connection.commit()
        connection.close()

        response = self.client.get("/api/runs/1/export.csv")
        self.assertEqual(response.status_code, 200)
        self.assertIn("'=1+1", response.data.decode("utf-8"))

    def test_read_path_does_not_modify_database(self):
        self.client.get("/api/runs")
        self.client.get("/api/runs/1")
        self.client.get("/api/runs/1/metrics")
        self.assertEqual(self.db_path.stat().st_mtime_ns, self.original_mtime)

    def test_missing_database_is_read_failure_and_is_not_created(self):
        missing = Path(self.temp_dir.name) / "missing.sqlite3"
        client = create_app(missing).test_client()
        response = client.get("/api/runs")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json["error"]["code"], "READ_FAILURE")
        self.assertFalse(missing.exists())

    def test_unsupported_schema_is_explicit(self):
        unsupported = Path(self.temp_dir.name) / "unsupported.sqlite3"
        connection = sqlite3.connect(unsupported)
        connection.execute("CREATE TABLE replay_sessions (id INTEGER PRIMARY KEY, payload TEXT)")
        connection.commit()
        connection.close()

        response = create_app(unsupported).test_client().get("/api/runs")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json["error"]["code"], "SCHEMA_UNSUPPORTED")

    def test_reconciliation_mismatch_is_explicit(self):
        connection = sqlite3.connect(self.db_path)
        connection.execute("UPDATE replay_sessions SET net_profit = 999 WHERE id = 1")
        connection.commit()
        connection.close()

        response = self.client.get("/api/runs/1/metrics")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json["error"]["code"], "RECONCILIATION_MISMATCH")

    def test_corrupt_summary_value_is_artifact_invalid(self):
        connection = sqlite3.connect(self.db_path)
        connection.execute("UPDATE replay_sessions SET trade_count = ? WHERE id = 1", ("bad",))
        connection.commit()
        connection.close()

        response = self.client.get("/api/runs/1/metrics")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json["error"]["code"], "ARTIFACT_INVALID")

    def test_invalid_json_artifact_is_explicit(self):
        connection = sqlite3.connect(self.db_path)
        connection.execute("UPDATE replay_sessions SET payload = ? WHERE id = 1", ("{",))
        connection.commit()
        connection.close()

        response = self.client.get("/api/runs/1")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json["error"]["code"], "ARTIFACT_INVALID")

    def test_missing_run_and_execution_route_are_not_available(self):
        missing = self.client.get("/api/runs/999")
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.json["error"]["code"], "RUN_NOT_FOUND")
        self.assertEqual(self.client.post("/api/trade/place", json={}).status_code, 404)

    def test_importing_p1_shell_does_not_import_mt5_adapter(self):
        process = subprocess.run(
            [
                sys.executable,
                "-c",
                "import sys; import p1_app; "
                "assert 'mt5_data' not in sys.modules; "
                "assert 'app' not in sys.modules",
            ],
            cwd=Path(__file__).resolve().parents[1],
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(process.returncode, 0, process.stderr)

    def test_runtime_shell_accepts_explicit_database_path(self):
        process = subprocess.run(
            [
                sys.executable,
                "-c",
                "import os; "
                f"os.environ['EVIDENCE_DB_PATH'] = r'{self.db_path}'; "
                "import p1_app; "
                "client = p1_app.app.test_client(); "
                "assert client.get('/api/runs').status_code == 200",
            ],
            cwd=Path(__file__).resolve().parents[1],
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(process.returncode, 0, process.stderr)

    def test_read_only_verifier_runs_as_a_direct_script(self):
        process = subprocess.run(
            [sys.executable, "scripts/p1_verify.py", str(self.db_path)],
            cwd=Path(__file__).resolve().parents[1],
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(process.returncode, 0, process.stderr)
        result = json.loads(process.stdout)
        self.assertTrue(result["success"])
        self.assertEqual(result["run_count_verified"], 2)
        self.assertTrue(result["database_mtime_unchanged"])
        self.assertFalse(result["mt5_modules_imported"])

    def test_read_only_verifier_reports_insufficient_runs_without_traceback(self):
        connection = sqlite3.connect(self.db_path)
        connection.execute("DELETE FROM replay_sessions WHERE id = 2")
        connection.commit()
        connection.close()

        process = subprocess.run(
            [sys.executable, "scripts/p1_verify.py", str(self.db_path)],
            cwd=Path(__file__).resolve().parents[1],
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(process.returncode, 2)
        self.assertEqual(process.stderr, "")
        result = json.loads(process.stdout)
        self.assertFalse(result["success"])
        self.assertEqual(result["error"]["code"], "INSUFFICIENT_RUNS")
        self.assertEqual(result["error"]["available_runs"], 1)


if __name__ == "__main__":
    unittest.main()
