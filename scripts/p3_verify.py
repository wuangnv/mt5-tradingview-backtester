"""Isolated P3 verifier for replay cutoff, provenance and journal revision rules."""

import hashlib
import json
import sqlite3
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from p3_app import create_app  # noqa: E402


def _create_evidence_db(path):
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
    connection = sqlite3.connect(path)
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


def _create_history(root):
    directory = root / "EURUSD" / "H1"
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


def _hash_files(root):
    return {
        str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def verify():
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        evidence_db = root / "sessions.sqlite3"
        research_db = root / "research.sqlite3"
        journal_db = root / "journal.sqlite3"
        history_root = root / "chunks"
        _create_evidence_db(evidence_db)
        _create_history(history_root)
        evidence_before = hashlib.sha256(evidence_db.read_bytes()).hexdigest()
        history_before = _hash_files(history_root)

        app = create_app(evidence_db, research_db, journal_db, history_root)
        app.config["TESTING"] = True
        client = app.test_client()

        initial_response = client.get("/api/practice/runs/1/trades/1001/context")
        if initial_response.status_code != 200:
            raise RuntimeError("initial practice context failed")
        initial = initial_response.json["context"]
        if initial["mapping"]["open_bar_time_ms"] != 3600000:
            raise RuntimeError("trade did not map to the expected open bar")
        if initial["trade"]["outcome_revealed"]:
            raise RuntimeError("trade outcome was revealed before close")
        if any(bar["available_at"] > 7200 for bar in initial["bars"]):
            raise RuntimeError("future OHLC leaked into the initial context")

        before_close = client.get("/api/practice/runs/1/trades/1001/context?cursor_ms=10800000")
        if before_close.json["context"]["trade"]["outcome_revealed"]:
            raise RuntimeError("outcome was revealed before the exit bar closed")

        closed_response = client.get("/api/practice/runs/1/trades/1001/context?cursor_ms=14400000")
        if closed_response.status_code != 200:
            raise RuntimeError("close-time practice context failed")
        closed = closed_response.json["context"]
        if not closed["trade"]["outcome_revealed"] or closed["trade"]["price_close"] != 1.01:
            raise RuntimeError("trade outcome was not revealed at close")
        if any(bar["available_at"] > 14400 for bar in closed["bars"]):
            raise RuntimeError("future OHLC leaked at close")

        created_response = client.post(
            "/api/practice/runs/1/trades/1001/journal",
            json={
                "cursor_ms": 10800000,
                "intended_entry": 1.05,
                "intended_stop": 1.00,
                "intended_target": 1.10,
                "execution_grade": "followed",
                "rule_checks": {"entry": True, "risk": True, "exit": False},
                "notes": "fixture",
                "fill_entry": 999,
                "fill_exit": 999,
            },
        )
        if created_response.status_code != 201:
            raise RuntimeError("journal create failed")
        entry = created_response.json["entry"]
        if entry["fill"]["entry"] != 1.06 or entry["fill"]["exit"] is not None:
            raise RuntimeError("journal response leaked outcome or accepted spoofed fill")
        if entry["source"]["decision_time_ms"] != 10800000:
            raise RuntimeError("journal decision cursor does not match replay cursor")
        stored_entry = app.config["JOURNAL_STORE"].get(entry["id"])
        if stored_entry["fill"]["entry"] != 1.06 or stored_entry["fill"]["exit"] != 1.01:
            raise RuntimeError("backend fill snapshot is not canonical")

        journal_before_close = client.get(
            "/api/practice/runs/1/trades/1001/context?cursor_ms=10800000"
        ).json["context"]["journal"]
        if journal_before_close["fill"]["exit"] is not None:
            raise RuntimeError("journal leaked exit through replay context before close")

        journal_after_close = client.get(
            "/api/practice/runs/1/trades/1001/context?cursor_ms=14400000"
        ).json["context"]["journal"]
        if journal_after_close["fill"]["exit"] != 1.01:
            raise RuntimeError("journal outcome was not revealed after close")

        updated_response = client.patch(
            f"/api/practice/journal/{entry['id']}",
            json={
                "cursor_ms": 10800000,
                "intended_entry": 1.04,
                "intended_stop": 0.99,
                "intended_target": 1.11,
                "execution_grade": "deviated",
                "rule_checks": {"entry": False, "risk": True, "exit": True},
                "notes": "reviewed",
            },
        )
        if (
            updated_response.status_code != 200
            or updated_response.json["entry"]["review"]["revision"] != 2
            or updated_response.json["entry"]["fill"]["exit"] is not None
        ):
            raise RuntimeError("journal revision update failed")
        history_response = client.get(f"/api/practice/journal/{entry['id']}/history")
        if [item["revision"] for item in history_response.json["revisions"]] != [1, 2]:
            raise RuntimeError("journal revision history is incomplete")

        evidence_after = hashlib.sha256(evidence_db.read_bytes()).hexdigest()
        history_after = _hash_files(history_root)
        if evidence_after != evidence_before:
            raise RuntimeError("P3 modified the Evidence DB")
        if history_after != history_before:
            raise RuntimeError("P3 modified the market-history cache")
        if client.post("/api/trade/place", json={}).status_code != 404:
            raise RuntimeError("execution route is reachable from P3")

        return {
            "success": True,
            "trade_mapping_exact": True,
            "future_ohlc_hidden": True,
            "outcome_masked_until_close": True,
            "backend_fill_snapshot": True,
            "journal_outcome_masked_until_close": True,
            "decision_cursor_preserved": True,
            "journal_revision_history": True,
            "evidence_unchanged": True,
            "history_unchanged": True,
            "history_source_id": initial["history"]["source_id"],
            "mt5_modules_imported": any(name == "mt5_data" or name == "app" for name in sys.modules),
            "execution_route_available": False,
        }


def main():
    try:
        result = verify()
    except Exception as exc:
        print(json.dumps({"success": False, "error": {"code": "P3_VERIFY_FAILED", "message": str(exc)}}, indent=2))
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
