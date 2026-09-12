"""
SQLite-backed storage for completed replay sessions.

The browser sends a session report after a replay ends. This module validates
and normalizes that payload before persisting it in the local data directory.
"""
import json
import math
import re
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path


SUPPORTED_TIMEFRAMES = {"M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"}
MAX_TRADES_PER_SESSION = 5000
MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000
MAX_BARS_REPLAYED = 10_000_000
MAX_ABS_MONEY = 1_000_000_000


class SessionStore:
    """Persist validated replay reports in a small local SQLite database."""

    def __init__(self, db_path=None):
        root = Path(__file__).resolve().parent
        self.db_path = Path(db_path) if db_path else root / "data" / "sessions.sqlite3"
        self._init_lock = threading.Lock()
        self._initialize()

    def _connect(self):
        connection = sqlite3.connect(str(self.db_path), timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    @contextmanager
    def _connection(self):
        connection = self._connect()
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _initialize(self):
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._init_lock:
            with self._connection() as connection:
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS replay_sessions (
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
                    CREATE INDEX IF NOT EXISTS idx_replay_sessions_created
                    ON replay_sessions (created_at_ms DESC)
                    """
                )

    @staticmethod
    def _number(value, name, minimum=None, maximum=None):
        if isinstance(value, bool):
            raise ValueError(f"{name} must be a number")
        try:
            number = float(value)
        except (TypeError, ValueError):
            raise ValueError(f"{name} must be a number")
        if not math.isfinite(number):
            raise ValueError(f"{name} must be finite")
        if minimum is not None and number < minimum:
            raise ValueError(f"{name} must be at least {minimum}")
        if maximum is not None and number > maximum:
            raise ValueError(f"{name} must be at most {maximum}")
        return number

    @classmethod
    def _integer(cls, value, name, minimum=None, maximum=None):
        number = cls._number(value, name, minimum, maximum)
        if not number.is_integer():
            raise ValueError(f"{name} must be an integer")
        return int(number)

    @staticmethod
    def _text(value, name, pattern=None, maximum=64):
        if not isinstance(value, str):
            raise ValueError(f"{name} must be text")
        text = value.strip()
        if not text or len(text) > maximum:
            raise ValueError(f"{name} must contain 1 to {maximum} characters")
        if pattern and not pattern.fullmatch(text):
            raise ValueError(f"{name} has invalid characters")
        return text

    @classmethod
    def _normalize_trade(cls, value):
        if not isinstance(value, dict):
            raise ValueError("every trade must be an object")

        ticket = value.get("ticket")
        if isinstance(ticket, bool) or not isinstance(ticket, (str, int)):
            raise ValueError("trade ticket must be text or an integer")
        ticket = str(ticket)
        if not ticket or len(ticket) > 64:
            raise ValueError("trade ticket must contain 1 to 64 characters")

        trade_type = cls._text(value.get("type"), "trade type", maximum=8).upper()
        if trade_type not in {"BUY", "SELL"}:
            raise ValueError("trade type must be BUY or SELL")

        result = cls._text(value.get("result"), "trade result", maximum=32)
        if result not in {"Closed", "Stop Loss", "Take Profit"}:
            raise ValueError("trade result is invalid")

        r_value = value.get("r")
        if r_value is None or r_value == "":
            r_multiple = None
        else:
            r_multiple = cls._number(r_value, "trade R multiple", -100_000, 100_000)

        return {
            "time": cls._integer(value.get("time"), "trade close time", 0, 4_102_444_800),
            "time_open": cls._integer(value.get("time_open"), "trade open time", 0, 4_102_444_800),
            "ticket": ticket,
            "symbol": cls._text(
                value.get("symbol"),
                "trade symbol",
                re.compile(r"[A-Za-z0-9._-]{1,32}"),
                32,
            ).upper(),
            "type": trade_type,
            "volume": cls._number(value.get("volume"), "trade volume", 0.000001, 10_000),
            "price_open": cls._number(value.get("price_open"), "trade open price", 0, MAX_ABS_MONEY),
            "price_close": cls._number(value.get("price_close"), "trade close price", 0, MAX_ABS_MONEY),
            "profit": cls._number(value.get("profit"), "trade profit", -MAX_ABS_MONEY, MAX_ABS_MONEY),
            "result": result,
            "r": r_multiple,
        }

    @classmethod
    def _normalize_report(cls, report):
        if not isinstance(report, dict):
            raise ValueError("report must be a JSON object")

        symbol = cls._text(
            report.get("symbol"),
            "symbol",
            re.compile(r"[A-Za-z0-9._-]{1,32}"),
            32,
        ).upper()
        timeframe = cls._text(report.get("timeframe"), "timeframe", maximum=8).upper()
        if timeframe not in SUPPORTED_TIMEFRAMES:
            raise ValueError("timeframe is invalid")

        raw_trades = report.get("trades")
        if not isinstance(raw_trades, list):
            raise ValueError("trades must be an array")
        if not raw_trades:
            raise ValueError("at least one closed trade is required")
        if len(raw_trades) > MAX_TRADES_PER_SESSION:
            raise ValueError(f"a session may contain at most {MAX_TRADES_PER_SESSION} trades")
        trades = [cls._normalize_trade(trade) for trade in raw_trades]

        profits = [trade["profit"] for trade in trades]
        wins = [profit for profit in profits if profit > 0]
        gross_profit = sum(wins)
        gross_loss = abs(sum(profit for profit in profits if profit <= 0))
        net_profit = sum(profits)

        return {
            "date": int(time.time() * 1000),
            "symbol": symbol,
            "timeframe": timeframe,
            "barsReplayed": cls._integer(
                report.get("barsReplayed"),
                "barsReplayed",
                0,
                MAX_BARS_REPLAYED,
            ),
            "realMs": cls._integer(report.get("realMs"), "realMs", 0, MAX_DURATION_MS),
            "startBalance": cls._number(
                report.get("startBalance"),
                "startBalance",
                0.01,
                MAX_ABS_MONEY,
            ),
            "trades": trades,
            "stats": {
                "trades": len(trades),
                "wins": len(wins),
                "losses": len(trades) - len(wins),
                "net": net_profit,
                "grossProfit": gross_profit,
                "grossLoss": gross_loss,
                "winRate": (len(wins) / len(trades)) * 100,
            },
        }

    @staticmethod
    def _summary(row):
        return {
            "id": row["id"],
            "date": row["created_at_ms"],
            "symbol": row["symbol"],
            "timeframe": row["timeframe"],
            "barsReplayed": row["bars_replayed"],
            "realMs": row["duration_ms"],
            "startBalance": row["start_balance"],
            "stats": {
                "trades": row["trade_count"],
                "net": row["net_profit"],
                "winRate": row["win_rate"],
            },
        }

    def save(self, report):
        normalized = self._normalize_report(report)
        stats = normalized["stats"]
        with self._connection() as connection:
            cursor = connection.execute(
                """
                INSERT INTO replay_sessions (
                    created_at_ms, symbol, timeframe, bars_replayed, duration_ms,
                    start_balance, trade_count, net_profit, win_rate, payload
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    normalized["date"],
                    normalized["symbol"],
                    normalized["timeframe"],
                    normalized["barsReplayed"],
                    normalized["realMs"],
                    normalized["startBalance"],
                    stats["trades"],
                    stats["net"],
                    stats["winRate"],
                    json.dumps(normalized, separators=(",", ":"), allow_nan=False),
                ),
            )
            normalized["id"] = cursor.lastrowid
        return normalized

    def list_sessions(self, limit=50):
        with self._connection() as connection:
            rows = connection.execute(
                """
                SELECT id, created_at_ms, symbol, timeframe, bars_replayed, duration_ms,
                       start_balance, trade_count, net_profit, win_rate
                FROM replay_sessions
                ORDER BY created_at_ms DESC, id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [self._summary(row) for row in rows]

    def get_session(self, session_id):
        with self._connection() as connection:
            row = connection.execute(
                "SELECT id, payload FROM replay_sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
        if row is None:
            return None
        payload = json.loads(row["payload"])
        payload["id"] = row["id"]
        return payload

    def delete(self, session_id):
        with self._connection() as connection:
            cursor = connection.execute(
                "DELETE FROM replay_sessions WHERE id = ?",
                (session_id,),
            )
        return cursor.rowcount > 0


session_store = SessionStore()
