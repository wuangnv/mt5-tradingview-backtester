"""Read-only adapter from legacy replay sessions to the P1 evidence model."""

import json
import math
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

from evidence_metrics import compute_metrics_v1


LEGACY_SCHEMA_VERSION = "legacy-replay-session-v1"


class EvidenceStoreError(Exception):
    code = "READ_FAILURE"


class EvidenceNotFound(EvidenceStoreError):
    code = "RUN_NOT_FOUND"


class EvidenceInvalid(EvidenceStoreError):
    code = "ARTIFACT_INVALID"


class EvidenceSchemaUnsupported(EvidenceStoreError):
    code = "SCHEMA_UNSUPPORTED"


class EvidenceReconciliationMismatch(EvidenceStoreError):
    code = "RECONCILIATION_MISMATCH"


def _utc_from_millis(value):
    try:
        timestamp = int(value) / 1000.0
        return datetime.fromtimestamp(timestamp, tz=UTC).isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError, OSError, OverflowError) as exc:
        raise EvidenceInvalid("created_at_ms is invalid") from exc


def _utc_from_seconds(value, name):
    try:
        timestamp = int(value)
        return datetime.fromtimestamp(timestamp, tz=UTC).isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError, OSError, OverflowError) as exc:
        raise EvidenceInvalid(f"{name} is invalid") from exc


def _finite_number(value, name):
    if isinstance(value, bool):
        raise EvidenceInvalid(f"{name} must be a finite number")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise EvidenceInvalid(f"{name} must be a finite number") from exc
    if not math.isfinite(number):
        raise EvidenceInvalid(f"{name} must be a finite number")
    return number


def _nonnegative_integer(value, name):
    number = _finite_number(value, name)
    if number < 0 or not number.is_integer():
        raise EvidenceInvalid(f"{name} must be a non-negative integer")
    return int(number)


class EvidenceStore:
    """Read legacy session artifacts without creating or migrating storage."""

    _REQUIRED_COLUMNS = {
        "id",
        "created_at_ms",
        "symbol",
        "timeframe",
        "bars_replayed",
        "duration_ms",
        "start_balance",
        "trade_count",
        "net_profit",
        "win_rate",
        "payload",
    }

    def __init__(self, db_path=None):
        root = Path(__file__).resolve().parent
        self.db_path = Path(db_path) if db_path else root / "data" / "sessions.sqlite3"

    def _connect(self):
        if not self.db_path.is_file():
            raise EvidenceStoreError("session database does not exist")
        try:
            uri = f"file:{self.db_path.resolve().as_posix()}?mode=ro"
            connection = sqlite3.connect(uri, uri=True, timeout=5)
            connection.row_factory = sqlite3.Row
            columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(replay_sessions)").fetchall()
            }
            if not self._REQUIRED_COLUMNS.issubset(columns):
                connection.close()
                raise EvidenceSchemaUnsupported("replay_sessions schema is unsupported")
            return connection
        except sqlite3.Error as exc:
            raise EvidenceStoreError("could not open session database read-only") from exc

    @staticmethod
    def _summary(row):
        return {
            "run_id": str(row["id"]),
            "artifact_schema_version": LEGACY_SCHEMA_VERSION,
            "created_at_utc": _utc_from_millis(row["created_at_ms"]),
            "status": "completed",
            "halt_reason": None,
            "strategy_id": None,
            "strategy_version": None,
            "data": {
                "symbol": row["symbol"],
                "timeframe": row["timeframe"],
                "bars_replayed": row["bars_replayed"],
                "dataset_id": None,
                "source_id": None,
                "requested_range": None,
                "observed_range": None,
                "timezone": None,
                "coverage": None,
                "quality_status": "unknown",
            },
            "assumptions": {
                "cost_model_version": None,
                "spread": None,
                "slippage": None,
                "commission": None,
                "fill_model_version": None,
                "risk_model_version": None,
            },
            "reproduce": {
                "engine_version": None,
                "metric_version": "metrics-v1",
                "code_hash": None,
                "config_hash": None,
                "seed": None,
            },
            "comparison": {
                "ready": False,
                "reasons": [
                    "requested_range_unknown",
                    "cost_model_unknown",
                    "risk_model_unknown",
                ],
            },
        }

    def list_runs(self, limit=50):
        try:
            with closing(self._connect()) as connection:
                rows = connection.execute(
                    """
                    SELECT id, created_at_ms, symbol, timeframe, bars_replayed
                    FROM replay_sessions
                    ORDER BY created_at_ms DESC, id DESC
                    LIMIT ?
                    """,
                    (limit,),
                ).fetchall()
        except EvidenceStoreError:
            raise
        except sqlite3.Error as exc:
            raise EvidenceStoreError("could not list replay sessions") from exc
        return [self._summary(row) for row in rows]

    def _load(self, run_id):
        try:
            numeric_id = int(run_id)
        except (TypeError, ValueError) as exc:
            raise EvidenceNotFound("run was not found") from exc

        try:
            with closing(self._connect()) as connection:
                row = connection.execute(
                    """
                    SELECT id, created_at_ms, symbol, timeframe, bars_replayed,
                           start_balance, trade_count, net_profit, win_rate, payload
                    FROM replay_sessions
                    WHERE id = ?
                    """,
                    (numeric_id,),
                ).fetchone()
        except EvidenceStoreError:
            raise
        except sqlite3.Error as exc:
            raise EvidenceStoreError("could not read replay session") from exc

        if row is None:
            raise EvidenceNotFound("run was not found")
        try:
            payload = json.loads(row["payload"])
        except (TypeError, json.JSONDecodeError) as exc:
            raise EvidenceInvalid("session payload is not valid JSON") from exc
        if not isinstance(payload, dict):
            raise EvidenceInvalid("session payload must be an object")
        return row, payload

    @staticmethod
    def _reconcile(row, ledger):
        expected_count = _nonnegative_integer(row["trade_count"], "trade_count")
        if len(ledger) != expected_count:
            raise EvidenceReconciliationMismatch("trade count does not match persisted summary")

        net_pnl = sum(trade["net_pnl"] for trade in ledger)
        persisted_net = _finite_number(row["net_profit"], "net_profit")
        if not math.isclose(net_pnl, persisted_net, rel_tol=1e-9, abs_tol=1e-9):
            raise EvidenceReconciliationMismatch("net P/L does not match persisted summary")

        wins = sum(1 for trade in ledger if trade["net_pnl"] > 0)
        win_rate = (wins / len(ledger) * 100.0) if ledger else 0.0
        persisted_win_rate = _finite_number(row["win_rate"], "win_rate")
        if not math.isclose(win_rate, persisted_win_rate, rel_tol=1e-9, abs_tol=1e-9):
            raise EvidenceReconciliationMismatch("win rate does not match persisted summary")

    def _load_reconciled(self, run_id):
        row, payload = self._load(run_id)
        ledger = self._ledger(payload)
        self._reconcile(row, ledger)
        return row, payload, ledger

    @staticmethod
    def _ledger(payload):
        raw_trades = payload.get("trades")
        if not isinstance(raw_trades, list):
            raise EvidenceInvalid("session trades must be an array")

        ledger = []
        seen_ids = set()
        for index, trade in enumerate(raw_trades):
            if not isinstance(trade, dict):
                raise EvidenceInvalid(f"trade {index} must be an object")
            ticket = trade.get("ticket")
            if isinstance(ticket, bool) or not isinstance(ticket, (str, int)):
                raise EvidenceInvalid(f"trade {index} ticket is invalid")
            trade_id = str(ticket)
            if not trade_id or trade_id in seen_ids:
                raise EvidenceInvalid(f"trade {index} ticket is not unique")
            seen_ids.add(trade_id)

            side = str(trade.get("type", "")).upper()
            if side not in {"BUY", "SELL"}:
                raise EvidenceInvalid(f"trade {index} side is invalid")

            ledger.append(
                {
                    "trade_id": trade_id,
                    "open_time_utc": _utc_from_seconds(trade.get("time_open"), "time_open"),
                    "close_time_utc": _utc_from_seconds(trade.get("time"), "time"),
                    "symbol": str(trade.get("symbol", "")),
                    "side": side,
                    "quantity": _finite_number(trade.get("volume"), "volume"),
                    "price_open": _finite_number(trade.get("price_open"), "price_open"),
                    "price_close": _finite_number(trade.get("price_close"), "price_close"),
                    "gross_pnl": None,
                    "fees": None,
                    "net_pnl": _finite_number(trade.get("profit"), "profit"),
                    "planned_risk_budget": None,
                    "realized_r": None,
                    "legacy_r": trade.get("r"),
                    "legacy_result": trade.get("result"),
                }
            )
        return ledger

    def get_run(self, run_id):
        row, payload, _ = self._load_reconciled(run_id)
        run = self._summary(row)
        run["starting_balance"] = _finite_number(
            payload.get("startBalance", row["start_balance"]),
            "startBalance",
        )
        run["links"] = {
            "ledger": f"/api/runs/{run['run_id']}/ledger",
            "metrics": f"/api/runs/{run['run_id']}/metrics",
            "equity": f"/api/runs/{run['run_id']}/equity",
        }
        return run

    def get_ledger(self, run_id):
        _, _, ledger = self._load_reconciled(run_id)
        return ledger

    def get_metrics(self, run_id):
        row, payload, ledger = self._load_reconciled(run_id)
        starting_balance = _finite_number(
            payload.get("startBalance", row["start_balance"]),
            "startBalance",
        )
        try:
            return compute_metrics_v1(ledger, starting_balance)
        except ValueError as exc:
            raise EvidenceInvalid(str(exc)) from exc

    def get_trade(self, run_id, trade_id):
        for trade in self.get_ledger(run_id):
            if trade["trade_id"] == str(trade_id):
                return trade
        raise EvidenceNotFound("trade was not found")

    def build_evidence_bundle(self, run_id):
        """Return the canonical P1 export/read model for one run."""
        row, payload, ledger = self._load_reconciled(run_id)
        run = self._summary(row)
        run["starting_balance"] = _finite_number(
            payload.get("startBalance", row["start_balance"]),
            "startBalance",
        )
        run["links"] = {
            "ledger": f"/api/runs/{run['run_id']}/ledger",
            "metrics": f"/api/runs/{run['run_id']}/metrics",
            "equity": f"/api/runs/{run['run_id']}/equity",
        }
        try:
            metrics = compute_metrics_v1(ledger, run["starting_balance"])
        except ValueError as exc:
            raise EvidenceInvalid(str(exc)) from exc
        return {
            "run": run,
            "ledger": ledger,
            "metrics": metrics,
        }
