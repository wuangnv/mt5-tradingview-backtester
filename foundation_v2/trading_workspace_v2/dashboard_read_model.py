"""Workspace replay summary without loading chart rows or inventing account equity."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal

from .analytics_read_model import AnalyticsValidationError, normalize_filters, serialize_filters
from .replay_analytics import build_replay_analytics_view


def _root_session(record: dict, records: dict[str, dict]) -> str | None:
    seen: set[str] = set()
    while record:
        record_id = record["record_id"]
        if record_id in seen:
            return None
        seen.add(record_id)
        parent = record["payload"].get("parent_session_id")
        if not parent:
            return record_id
        record = records.get(parent)
    return None


def _counts(trades: list[dict]) -> dict:
    wins = sum(Decimal(str(trade["net_pnl"])) > 0 for trade in trades)
    losses = sum(Decimal(str(trade["net_pnl"])) < 0 for trade in trades)
    return {
        "closed_trade_count": len(trades),
        "wins": wins,
        "losses": losses,
        "breakeven": len(trades) - wins - losses,
        "win_rate_pct": wins / len(trades) * 100 if trades else None,
    }


def _trade_origin(record: dict, records: dict[str, dict], close_sequence: int) -> str:
    while record["payload"].get("parent_session_id"):
        inherited_sequence = record["payload"].get("parent_checkpoint_event_sequence")
        if (isinstance(inherited_sequence, bool) or not isinstance(inherited_sequence, int)
                or inherited_sequence < 0):
            raise AnalyticsValidationError("replay branch checkpoint is unavailable")
        if close_sequence > inherited_sequence:
            break
        record = records[record["payload"]["parent_session_id"]]
    return record["record_id"]


def build_dashboard_performance(
    records: list[dict],
    workspace_id: str,
    *,
    session_id: str | None = None,
    from_close_utc: str | None = None,
    to_close_utc: str | None = None,
    session_ids: list[str] | None = None,
    include_ledger: bool = False,
    side: str = "all",
    outcome: str = "all",
) -> dict:
    """Aggregate unique replay closures, keeping source failures visible.

    Forks carry copies of earlier fills. Only closures within the inherited
    checkpoint prefix share an origin; fills produced after branching remain
    separate attempts even when their operation IDs and outcomes match.
    Money and balance are deliberately left to per-session analytics because
    sessions may have different account currencies and starting capital.
    """

    filters = normalize_filters({"from_close_utc": from_close_utc, "to_close_utc": to_close_utc,
                                 "side": side, "outcome": outcome})
    serialized = serialize_filters(filters)
    record_map = {record["record_id"]: record for record in records}
    if session_id and session_id not in record_map:
        raise LookupError("replay session not found")
    selected = [record_map[session_id]] if session_id else records
    if session_ids is not None:
        if any(value not in record_map for value in session_ids):
            raise LookupError("replay session not found")
        selected = [record_map[value] for value in dict.fromkeys(session_ids)]
        if len(selected) == 1:
            session_id = selected[0]["record_id"]
    sessions, sources, excluded, trades = [], [], [], []
    seen: set[tuple] = set()
    duplicate_count = 0

    for record in records:
        payload = record.get("payload")
        if not isinstance(payload, dict):
            raise AnalyticsValidationError("replay record payload is invalid")
        execution = payload.get("execution") or {}
        instrument = execution.get("instrument_spec") if isinstance(execution, dict) else None
        instrument = instrument if isinstance(instrument, dict) else {}
        sessions.append({
            "session_id": record["record_id"],
            "name": payload.get("name") if isinstance(payload.get("name"), str) and payload["name"] else record["record_id"],
            "instrument_id": instrument.get("instrument_id"),
            "dataset_id": payload.get("dataset_id"),
            "revision": record["revision"],
            "archived": payload.get("archived", False),
        })

    for record in selected:
        source_id = record["record_id"]
        try:
            root_id = _root_session(record, record_map)
            if not root_id and not session_id:
                excluded.append({"session_id": source_id, "reason": "branch_ancestry_unavailable"})
                continue
            view = build_replay_analytics_view({**record, "workspace_id": workspace_id}, serialized)
            if not view.get("analytics_available"):
                excluded.append({"session_id": source_id, "reason": (view.get("blocked_by_data") or ["execution_unavailable"])[0]})
                continue
            source_trades = view["ledger"]
            keyed_trades = []
            for trade in source_trades:
                net = Decimal(str(trade["net_pnl"]))
                if not net.is_finite():
                    raise AnalyticsValidationError("trade net pnl is invalid")
                origin_id = source_id if session_id else _trade_origin(record, record_map, trade["close_event_sequence"])
                key = (
                    origin_id,
                    trade["close_event_sequence"],
                    trade.get("source_operation_id"),
                    trade.get("source_position_id") or trade["trade_id"],
                    trade.get("close_cursor_index"),
                    str(trade.get("close_time_utc")),
                    str(trade.get("price_close")),
                    net,
                )
                if include_ledger:
                    trade = {**trade, "session_id": source_id,
                             "session_name": record["payload"].get("name") or source_id,
                             "account_currency": view.get("account_currency"),
                             "starting_balance": view["metrics"].get("starting_balance"),
                             "source_provenance": view["provenance"],
                             "origin_session_id": origin_id}
                keyed_trades.append((key, trade))
            sources.append({
                "session_id": source_id,
                "revision": record["revision"],
                "dataset_id": record["payload"].get("dataset_id"),
                "dataset_sha256": view.get("dataset_sha256") or view.get("provenance", {}).get("dataset_sha256"),
                "cutoff_timestamp": view.get("cutoff_timestamp"),
                "closed_trade_count": len(source_trades),
            })
            for key, trade in keyed_trades:
                if key in seen:
                    duplicate_count += 1
                    continue
                seen.add(key)
                trades.append(trade)
        except (AnalyticsValidationError, KeyError, TypeError, ValueError, ArithmeticError):
            excluded.append({"session_id": source_id, "reason": "replay_analytics_source_invalid"})

    by_month: dict[str, list] = defaultdict(list)
    by_symbol: dict[str, list] = defaultdict(list)
    for trade in trades:
        close = normalize_filters({"from_close_utc": trade.get("close_time_utc")})["from_close_utc"]
        if close is not None:
            by_month[close.strftime("%Y-%m")].append(trade)
        by_symbol[str(trade.get("symbol") or "Chưa có symbol")].append(trade)
    metrics = _counts(trades)
    if selected and not sources:
        metrics = dict.fromkeys(metrics)
    result = {
        "schema_version": "dashboard-replay-performance-v1",
        "status": "partial" if excluded else "ready",
        "as_of_utc": datetime.now(timezone.utc).isoformat(),
        "scope": {
            "source": "persisted_replay_execution",
            "session_id": session_id,
            "session_ids": [record["record_id"] for record in selected],
            "session_count": len(selected),
            "readable_session_count": len(sources),
            "filters": serialized,
            "includes_archived": True,
            "duplicate_trade_count": duplicate_count,
            "aggregation": "unique_closed_fills_within_root_lineage",
            "timezone": "UTC",
        },
        "metrics": metrics,
        "months": [{"month": month, **_counts(items)} for month, items in sorted(by_month.items())],
        "symbols": [{"symbol": symbol, **_counts(items)} for symbol, items in sorted(by_symbol.items(), key=lambda item: (-len(item[1]), item[0]))],
        "sessions": sessions,
        "sources": sources,
        "excluded": excluded,
        "time_invested_seconds": None,
        "historical_time_replayed_seconds": None,
    }
    if include_ledger:
        result["ledger"] = trades
    return result
