"""Read-only analytics projection for completed foundation-v2 research jobs.

The research engine and :mod:`evidence_metrics` remain the semantic owners of
metric formulas.  This module only selects a bounded ledger slice, asks the
canonical metrics function to recompute that slice, and carries provenance
through to the API/export boundary.  It deliberately does not infer an
equity path when the result has no closed-trade ledger.
"""

from __future__ import annotations

import csv
import io
import json
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any

from .retained import compute_metrics_v2


class AnalyticsValidationError(ValueError):
    """Raised when analytics filters or source data are not well formed."""

    code = "ANALYTICS_INVALID_REQUEST"


def _timestamp(value: Any, name: str) -> datetime | None:
    """Parse an ISO timestamp or a Unix seconds/milliseconds timestamp.

    Research engine ledger timestamps are integer UTC seconds while browser
    filters are normally ISO-8601 strings.  Treat both forms explicitly so a
    filter cannot silently select the wrong range.
    """

    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise AnalyticsValidationError(f"{name} must be an ISO-8601 timestamp or Unix timestamp")
    if isinstance(value, (int, float)):
        numeric = float(value)
        if not numeric == numeric or numeric in (float("inf"), float("-inf")):
            raise AnalyticsValidationError(f"{name} must be a finite timestamp")
        # Millisecond epochs are > 1e11 for the supported historical range.
        seconds = numeric / 1000 if abs(numeric) >= 100_000_000_000 else numeric
        try:
            return datetime.fromtimestamp(seconds, tz=timezone.utc)
        except (OverflowError, OSError, ValueError) as exc:
            raise AnalyticsValidationError(f"{name} must be a valid Unix timestamp") from exc

    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise AnalyticsValidationError(f"{name} must be an ISO-8601 timestamp") from exc
    if parsed.tzinfo is None:
        raise AnalyticsValidationError(f"{name} must include a timezone")
    return parsed.astimezone(timezone.utc)


def normalize_filters(values: Mapping[str, Any] | None = None) -> dict[str, Any]:
    values = values or {}
    side = str(values.get("side") or "all").strip().upper()
    if side not in {"ALL", "BUY", "SELL"}:
        raise AnalyticsValidationError("side must be all, BUY, or SELL")
    outcome = str(values.get("outcome") or "all").strip().lower()
    if outcome not in {"all", "win", "loss", "breakeven"}:
        raise AnalyticsValidationError("outcome must be all, win, loss, or breakeven")
    from_close = _timestamp(values.get("from_close_utc"), "from_close_utc")
    to_close = _timestamp(values.get("to_close_utc"), "to_close_utc")
    if from_close and to_close and from_close > to_close:
        raise AnalyticsValidationError("from_close_utc must not be after to_close_utc")
    return {
        "side": side,
        "outcome": outcome,
        "from_close_utc": from_close,
        "to_close_utc": to_close,
    }


def serialize_filters(filters: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "side": str(filters["side"]).lower(),
        "outcome": filters["outcome"],
        "from_close_utc": filters["from_close_utc"].isoformat() if filters["from_close_utc"] else None,
        "to_close_utc": filters["to_close_utc"].isoformat() if filters["to_close_utc"] else None,
    }


def _trade_close_time(trade: Mapping[str, Any]) -> datetime | None:
    value = trade.get("close_time_utc")
    if value is None or value == "":
        return None
    return _timestamp(value, "trade.close_time_utc")


def _outcome(net_pnl: Any) -> str:
    if net_pnl is None or isinstance(net_pnl, bool):
        return "unknown"
    try:
        number = float(net_pnl)
    except (TypeError, ValueError):
        return "unknown"
    if not number == number or number in (float("inf"), float("-inf")):
        return "unknown"
    if number > 1e-12:
        return "win"
    if number < -1e-12:
        return "loss"
    return "breakeven"


def filter_ledger(ledger: list[Mapping[str, Any]], filters: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    selected: list[Mapping[str, Any]] = []
    for trade in ledger:
        if not isinstance(trade, Mapping):
            raise AnalyticsValidationError("ledger entries must be objects")
        if filters["side"] != "ALL" and str(trade.get("side") or "").upper() != filters["side"]:
            continue
        if filters["outcome"] != "all" and _outcome(trade.get("net_pnl")) != filters["outcome"]:
            continue
        close_time = _trade_close_time(trade)
        if filters["from_close_utc"] and (close_time is None or close_time < filters["from_close_utc"]):
            continue
        if filters["to_close_utc"] and (close_time is None or close_time > filters["to_close_utc"]):
            continue
        selected.append(trade)
    return selected


def _observed_range(ledger: list[Mapping[str, Any]]) -> dict[str, str | None]:
    values = [_trade_close_time(trade) for trade in ledger]
    values = [value for value in values if value is not None]
    return {
        "first_close_utc": min(values).isoformat() if values else None,
        "last_close_utc": max(values).isoformat() if values else None,
    }


def _starting_balance(result: Mapping[str, Any]) -> float | None:
    protocol = result.get("protocol")
    if isinstance(protocol, Mapping) and protocol.get("starting_balance") is not None:
        return protocol["starting_balance"]
    metrics = result.get("metrics")
    if isinstance(metrics, Mapping) and metrics.get("starting_balance") is not None:
        return metrics["starting_balance"]
    return None


def build_analytics_view(result: Mapping[str, Any], values: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Build one filtered, provenance-carrying analytics view.

    Results from the close-delta compatibility strategy intentionally contain
    aggregate metrics only.  They remain readable, but filtering/recomputing
    is marked ``blocked_by_data`` instead of fabricating a ledger.
    """

    if not isinstance(result, Mapping):
        raise AnalyticsValidationError("research result must be an object")
    filters = normalize_filters(values)
    serialized = serialize_filters(filters)
    raw_ledger = result.get("ledger")
    has_ledger = isinstance(raw_ledger, list)
    if not has_ledger:
        active = serialized["side"] != "all" or serialized["outcome"] != "all" or any(
            serialized[key] is not None for key in ("from_close_utc", "to_close_utc")
        )
        return {
            "schema_version": "analytics-read-model-v1",
            "analytics_available": False,
            "blocked_by_data": ["closed_trade_ledger_missing"],
            "filters": serialized,
            "scope": {
                "selected_trade_count": None,
                "total_trade_count": None,
                "active_filters": active,
                "observed_range": {"first_close_utc": None, "last_close_utc": None},
                "balance_curve_scope": "unavailable: closed-trade ledger is not present",
            },
            "metrics": result.get("metrics") if isinstance(result.get("metrics"), Mapping) else {},
            "ledger": [],
            "provenance": _provenance(result),
        }

    ledger = list(raw_ledger)
    selected = filter_ledger(ledger, filters)
    starting_balance = _starting_balance(result)
    if starting_balance is None:
        raise AnalyticsValidationError("starting_balance is required to recompute filtered metrics")
    metrics = compute_metrics_v2(selected, starting_balance)
    active = serialized["side"] != "all" or serialized["outcome"] != "all" or any(
        serialized[key] is not None for key in ("from_close_utc", "to_close_utc")
    )
    return {
        "schema_version": "analytics-read-model-v1",
        "analytics_available": True,
        "blocked_by_data": [],
        "filters": serialized,
        "scope": {
            "selected_trade_count": len(selected),
            "total_trade_count": len(ledger),
            "active_filters": active,
            "observed_range": _observed_range(selected),
            "balance_curve_scope": (
                "selected closed trades replayed from result starting balance; floating P/L and cashflow unavailable"
                if active
                else "all closed trades replayed from result starting balance; floating P/L and cashflow unavailable"
            ),
        },
        "metrics": metrics,
        "ledger": selected,
        "provenance": _provenance(result),
    }


def _provenance(result: Mapping[str, Any]) -> dict[str, Any]:
    protocol = result.get("protocol") if isinstance(result.get("protocol"), Mapping) else {}
    return {
        "job_id": result.get("job_id"),
        "workspace_id": result.get("workspace_id"),
        "dataset_id": result.get("dataset_id"),
        "dataset_sha256": result.get("dataset_sha256"),
        "protocol_sha256": result.get("protocol_sha256"),
        "metrics_schema_version": result.get("metrics_schema_version")
        or (result.get("metrics") or {}).get("metric_schema_version"),
        "split": result.get("split") or protocol.get("split"),
        "playbook_id": result.get("playbook_id") or (protocol.get("playbook") or {}).get("record_id"),
        "playbook_revision": result.get("playbook_revision") or (protocol.get("playbook") or {}).get("revision"),
        "created_at_utc": result.get("created_at_utc"),
    }


def _csv_safe(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
    if isinstance(value, str) and value[:1] in {"=", "+", "-", "@"}:
        return "'" + value
    return value


def analytics_csv(view: Mapping[str, Any]) -> str:
    """Serialize the read model without exposing raw chart/provider payloads."""

    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(["section", "field", "value"])
    for section in ("provenance", "filters", "scope"):
        values = view.get(section) or {}
        for field, value in values.items():
            writer.writerow([section, field, _csv_safe(value)])
    for field, value in (view.get("metrics") or {}).items():
        if field not in {"closed_trade_balance_curve", "closed_trade_balance_drawdown_curve", "realized_r_values", "definitions"}:
            writer.writerow(["metrics", field, _csv_safe(value)])
    writer.writerow([])
    fields = [
        "trade_id", "open_time_utc", "close_time_utc", "symbol", "side", "quantity",
        "price_open", "price_close", "gross_pnl", "fees", "net_pnl", "planned_risk_budget",
        "realized_r", "legacy_r", "legacy_result",
    ]
    writer.writerow(fields)
    for trade in view.get("ledger") or []:
        writer.writerow([_csv_safe(trade.get(field)) for field in fields])
    return output.getvalue()


__all__ = [
    "AnalyticsValidationError",
    "analytics_csv",
    "build_analytics_view",
    "filter_ledger",
    "normalize_filters",
    "serialize_filters",
]
