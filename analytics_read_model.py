"""One filtered read model for R2 metrics, charts, export, and comparison."""

from datetime import datetime, timezone

from evidence_metrics import classify_net_pnl, compute_metrics_v2


class AnalyticsValidationError(ValueError):
    code = "ANALYTICS_INVALID_REQUEST"


def _utc_timestamp(value, name):
    if value in (None, ""):
        return None
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


def normalize_filters(values):
    side = str(values.get("side") or "all").strip().upper()
    if side not in {"ALL", "BUY", "SELL"}:
        raise AnalyticsValidationError("side must be all, BUY, or SELL")
    outcome = str(values.get("outcome") or "all").strip().lower()
    if outcome not in {"all", "win", "loss", "breakeven"}:
        raise AnalyticsValidationError("outcome must be all, win, loss, or breakeven")
    from_close = _utc_timestamp(values.get("from_close_utc"), "from_close_utc")
    to_close = _utc_timestamp(values.get("to_close_utc"), "to_close_utc")
    if from_close and to_close and from_close > to_close:
        raise AnalyticsValidationError("from_close_utc must not be after to_close_utc")
    return {
        "side": side,
        "outcome": outcome,
        "from_close_utc": from_close,
        "to_close_utc": to_close,
    }


def serialize_filters(filters):
    return {
        "side": filters["side"].lower(),
        "outcome": filters["outcome"],
        "from_close_utc": filters["from_close_utc"].isoformat() if filters["from_close_utc"] else None,
        "to_close_utc": filters["to_close_utc"].isoformat() if filters["to_close_utc"] else None,
    }


def _trade_close_time(trade):
    return _utc_timestamp(trade.get("close_time_utc"), "trade.close_time_utc")


def filter_ledger(ledger, filters):
    selected = []
    for trade in ledger:
        if filters["side"] != "ALL" and trade.get("side") != filters["side"]:
            continue
        if filters["outcome"] != "all" and classify_net_pnl(trade.get("net_pnl")) != filters["outcome"]:
            continue
        close_time = _trade_close_time(trade)
        if filters["from_close_utc"] and close_time < filters["from_close_utc"]:
            continue
        if filters["to_close_utc"] and close_time > filters["to_close_utc"]:
            continue
        selected.append(trade)
    return selected


def _observed_range(ledger):
    if not ledger:
        return {"first_close_utc": None, "last_close_utc": None}
    values = [trade.get("close_time_utc") for trade in ledger]
    return {"first_close_utc": min(values), "last_close_utc": max(values)}


class AnalyticsReadModel:
    def __init__(self, evidence_store):
        self.evidence_store = evidence_store

    def run_view(self, run_id, values=None):
        filters = normalize_filters(values or {})
        run = self.evidence_store.get_run(run_id)
        ledger = self.evidence_store.get_ledger(run_id)
        selected = filter_ledger(ledger, filters)
        metrics = compute_metrics_v2(selected, run["starting_balance"])
        serialized_filters = serialize_filters(filters)
        active_filters = any(
            (
                serialized_filters["side"] != "all",
                serialized_filters["outcome"] != "all",
                serialized_filters["from_close_utc"] is not None,
                serialized_filters["to_close_utc"] is not None,
            )
        )
        return {
            "run": run,
            "scope": {
                "filters": serialized_filters,
                "selected_trade_count": len(selected),
                "total_trade_count": len(ledger),
                "observed_range": _observed_range(selected),
                "balance_curve_scope": (
                    "selected closed trades replayed from run starting balance; not full account equity"
                    if active_filters
                    else "all closed trades replayed from run starting balance; floating P/L and cashflow unavailable"
                ),
            },
            "metrics": metrics,
            "ledger": selected,
        }

    def compare(self, run_ids, values=None):
        run_ids = [str(run_id) for run_id in run_ids]
        if len(run_ids) < 2:
            raise AnalyticsValidationError("at least two run_id values are required")
        if len(run_ids) > 8:
            raise AnalyticsValidationError("at most eight runs can be compared")
        views = [self.run_view(run_id, values) for run_id in run_ids]
        reasons = []
        reference = views[0]["run"]
        for view in views:
            run = view["run"]
            comparison = run.get("comparison", {})
            if comparison.get("ready") is False:
                reasons.append(f"run_{run['run_id']}:comparison_not_ready")
            for reason in comparison.get("reasons", []):
                reasons.append(f"run_{run['run_id']}:{reason}")
            if run.get("status") != "completed":
                reasons.append(f"run_{run['run_id']}:status_{run.get('status')}")
            if run.get("strategy_id") != reference.get("strategy_id"):
                reasons.append("strategy_id_mismatch")
            if run.get("strategy_version") != reference.get("strategy_version"):
                reasons.append("strategy_version_mismatch")
            if run.get("data", {}).get("dataset_id") != reference.get("data", {}).get("dataset_id"):
                reasons.append("dataset_id_mismatch")
            if run.get("data", {}).get("requested_range") != reference.get("data", {}).get("requested_range"):
                reasons.append("requested_range_mismatch")
            if run.get("data", {}).get("symbol") != reference.get("data", {}).get("symbol"):
                reasons.append("symbol_mismatch")
            if run.get("data", {}).get("timeframe") != reference.get("data", {}).get("timeframe"):
                reasons.append("timeframe_mismatch")
            if run.get("assumptions", {}).get("cost_model_version") != reference.get("assumptions", {}).get("cost_model_version"):
                reasons.append("cost_model_mismatch")
            if run.get("assumptions", {}).get("risk_model_version") != reference.get("assumptions", {}).get("risk_model_version"):
                reasons.append("risk_model_mismatch")
        reasons = sorted(set(reasons))
        return {
            "metric_schema_version": "metrics-v2",
            "ranking_allowed": not reasons,
            "reasons": reasons,
            "runs": views,
        }
