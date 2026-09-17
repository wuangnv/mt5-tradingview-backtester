import hashlib
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from p3_app import create_app


class P3PracticeApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.evidence_db = root / "sessions.sqlite3"
        self.research_db = root / "research.sqlite3"
        self.journal_db = root / "journal.sqlite3"
        self.history_root = root / "chunks"
        self._create_evidence_db()
        self._create_history()
        self.evidence_hash = hashlib.sha256(self.evidence_db.read_bytes()).hexdigest()
        self.history_hashes = self._history_hashes()
        self.app = create_app(
            self.evidence_db,
            self.research_db,
            self.journal_db,
            self.history_root,
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
        directory = self.history_root / "EURUSD" / "H1"
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

    def _history_hashes(self):
        return {
            path.name: hashlib.sha256(path.read_bytes()).hexdigest()
            for path in (self.history_root / "EURUSD" / "H1").iterdir()
        }

    def test_context_maps_trade_and_masks_future_outcome(self):
        response = self.client.get("/api/practice/runs/1/trades/1001/context")
        self.assertEqual(response.status_code, 200)
        context = response.json["context"]
        self.assertEqual(context["mapping"]["open_bar_time_ms"], 3600000)
        self.assertEqual(context["mapping"]["open_bar_available_ms"], 7200000)
        self.assertEqual(context["replay"]["cursor_ms"], 7200000)
        self.assertEqual(context["replay"]["next_cursor_ms"], 10800000)
        self.assertFalse(context["trade"]["outcome_revealed"])
        self.assertIsNone(context["trade"]["price_close"])
        self.assertIsNone(context["trade"]["net_pnl"])
        self.assertTrue(all(bar["available_at"] <= 7200 for bar in context["bars"]))

        before_close = self.client.get("/api/practice/runs/1/trades/1001/context?cursor_ms=10800000")
        self.assertFalse(before_close.json["context"]["trade"]["outcome_revealed"])

        closed = self.client.get("/api/practice/runs/1/trades/1001/context?cursor_ms=14400000")
        self.assertEqual(closed.status_code, 200)
        closed_context = closed.json["context"]
        self.assertTrue(closed_context["trade"]["outcome_revealed"])
        self.assertEqual(closed_context["trade"]["price_close"], 1.01)
        self.assertEqual(closed_context["trade"]["net_pnl"], -5.0)
        self.assertTrue(all(bar["available_at"] <= 14400 for bar in closed_context["bars"]))

    def test_journal_uses_backend_fill_and_keeps_revision_history(self):
        created = self.client.post(
            "/api/practice/runs/1/trades/1001/journal",
            json={
                "cursor_ms": 10800000,
                "intended_entry": 1.05,
                "intended_stop": 1.00,
                "intended_target": 1.10,
                "execution_grade": "followed",
                "rule_checks": {"entry": True, "risk": True},
                "notes": "initial",
                "fill_entry": 999,
                "fill_exit": 999,
            },
        )
        self.assertEqual(created.status_code, 201)
        entry = created.json["entry"]
        self.assertEqual(entry["fill"]["entry"], 1.06)
        self.assertIsNone(entry["fill"]["exit"])
        self.assertIsNone(entry["fill"]["close_time_ms"])
        self.assertEqual(entry["source"]["decision_time_ms"], 10800000)
        self.assertEqual(entry["source"]["evidence_run_id"], "1")
        self.assertEqual(entry["source"]["trade_id"], "1001")
        self.assertTrue(entry["source"]["data_source_id"].startswith("local-chunks-v1:EURUSD:H1:"))

        stored = self.app.config["JOURNAL_STORE"].get(entry["id"])
        self.assertEqual(stored["fill"]["exit"], 1.01)

        updated = self.client.patch(
            f"/api/practice/journal/{entry['id']}",
            json={
                "cursor_ms": 10800000,
                "intended_entry": 1.04,
                "intended_stop": 0.99,
                "intended_target": 1.11,
                "execution_grade": "deviated",
                "rule_checks": {"entry": False, "risk": True},
                "notes": "reviewed",
                "fill_entry": 888,
            },
        )
        self.assertEqual(updated.status_code, 200)
        updated_entry = updated.json["entry"]
        self.assertEqual(updated_entry["review"]["revision"], 2)
        self.assertEqual(updated_entry["fill"]["entry"], 1.06)
        self.assertIsNone(updated_entry["fill"]["exit"])
        history = self.client.get(f"/api/practice/journal/{entry['id']}/history")
        self.assertEqual([row["revision"] for row in history.json["revisions"]], [1, 2])

        before_close = self.client.get(
            "/api/practice/runs/1/trades/1001/context?cursor_ms=10800000"
        ).json["context"]
        self.assertEqual(before_close["journal"]["id"], entry["id"])
        self.assertIsNone(before_close["journal"]["fill"]["exit"])

        closed = self.client.get(
            "/api/practice/runs/1/trades/1001/context?cursor_ms=14400000"
        ).json["context"]
        self.assertEqual(closed["journal"]["fill"]["exit"], 1.01)
        self.assertEqual(hashlib.sha256(self.evidence_db.read_bytes()).hexdigest(), self.evidence_hash)
        self.assertEqual(self._history_hashes(), self.history_hashes)

    def test_practice_page_and_execution_boundary(self):
        page = self.client.get("/practice")
        self.assertEqual(page.status_code, 200)
        self.assertIn(b"Practice Replay", page.data)
        self.assertEqual(self.client.post("/api/trade/place", json={}).status_code, 404)
        self.assertEqual(self.client.post("/api/trade/close", json={}).status_code, 404)

    def test_importing_p3_does_not_load_mt5_adapter_or_legacy_app(self):
        process = subprocess.run(
            [
                sys.executable,
                "-c",
                "import sys; import p3_app; "
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
