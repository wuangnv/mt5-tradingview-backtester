"""Independent reconciliation checks for automatic research-engine artifacts."""

import math
from collections import defaultdict
from datetime import datetime, timezone

from evidence_metrics import compute_metrics_v2
from research_store import ResearchConflict


class ResearchReconciliationError(RuntimeError):
    code = "RESEARCH_RECONCILIATION_MISMATCH"


def _finite(value, name):
    if isinstance(value, bool):
        raise ResearchReconciliationError(f"{name} must be numeric")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ResearchReconciliationError(f"{name} must be numeric") from exc
    if not math.isfinite(number):
        raise ResearchReconciliationError(f"{name} must be finite")
    return number


def _same(left, right, tolerance=1e-9):
    if left is None or right is None:
        return left is right
    return math.isclose(float(left), float(right), rel_tol=tolerance, abs_tol=tolerance)


def validate_engine_result(result):
    if not isinstance(result, dict) or result.get("artifact_schema_version") != "research-engine-result-v1":
        raise ResearchReconciliationError("research engine artifact schema is unsupported")
    ledger = result.get("ledger")
    metrics = result.get("metrics")
    if not isinstance(ledger, list) or not isinstance(metrics, dict):
        raise ResearchReconciliationError("research engine artifact is incomplete")

    scalar_net = 0.0
    wins = losses = breakeven = 0
    for index, trade in enumerate(ledger):
        if not isinstance(trade, dict):
            raise ResearchReconciliationError(f"ledger[{index}] must be an object")
        gross = _finite(trade.get("gross_pnl"), f"ledger[{index}].gross_pnl")
        fees = _finite(trade.get("fees"), f"ledger[{index}].fees")
        net = _finite(trade.get("net_pnl"), f"ledger[{index}].net_pnl")
        if not _same(gross - fees, net, tolerance=1e-7):
            raise ResearchReconciliationError(f"ledger[{index}] gross-fees does not equal net")
        planned_risk = _finite(
            trade.get("planned_risk_budget"), f"ledger[{index}].planned_risk_budget"
        )
        if planned_risk <= 0:
            raise ResearchReconciliationError(f"ledger[{index}] planned risk must be positive")
        if not _same(net / planned_risk, trade.get("realized_r"), tolerance=1e-7):
            raise ResearchReconciliationError(f"ledger[{index}] realized R is inconsistent")
        signal_time = int(trade.get("signal_time_utc"))
        open_time = int(trade.get("open_time_utc"))
        close_time = int(trade.get("close_time_utc"))
        if signal_time > open_time or open_time > close_time:
            raise ResearchReconciliationError(f"ledger[{index}] timing order is invalid")
        scalar_net += net
        if net > 1e-12:
            wins += 1
        elif net < -1e-12:
            losses += 1
        else:
            breakeven += 1

    starting_balance = _finite(metrics.get("starting_balance"), "metrics.starting_balance")
    recomputed = compute_metrics_v2(ledger, starting_balance)
    oracle = {
        "closed_trade_count": len(ledger),
        "wins": wins,
        "losses": losses,
        "breakeven": breakeven,
        "net_pnl": scalar_net,
        "ending_closed_trade_balance": starting_balance + scalar_net,
    }
    for field, expected in oracle.items():
        actual = metrics.get(field)
        if isinstance(expected, int):
            if actual != expected:
                raise ResearchReconciliationError(f"metrics.{field} does not match scalar oracle")
        elif not _same(actual, expected, tolerance=1e-7):
            raise ResearchReconciliationError(f"metrics.{field} does not match scalar oracle")

    metric_fields = (
        "closed_trade_count",
        "wins",
        "losses",
        "breakeven",
        "win_rate_pct",
        "loss_rate_pct",
        "net_pnl",
        "profit_factor_after_cost",
        "payoff_ratio_after_cost",
        "expectancy_net_per_trade",
        "average_realized_r",
        "closed_trade_balance_max_drawdown",
        "closed_trade_balance_max_drawdown_pct",
        "max_loss_streak",
        "ending_closed_trade_balance",
    )
    for field in metric_fields:
        if not _same(metrics.get(field), recomputed.get(field), tolerance=1e-7):
            raise ResearchReconciliationError(f"metrics.{field} does not match metrics-v2 recomputation")

    return {
        "validation_schema_version": "research-validation-v1",
        "reconciled": True,
        "oracle": oracle,
        "metric_version": metrics.get("metric_schema_version"),
        "available": [
            "closed_trade_metrics",
            "planned_vs_realized_r",
            "closed_trade_balance_drawdown",
        ],
        "blocked_by_data": {
            "floating_equity_drawdown": "intraday/floating equity samples are not present",
            "mae_mfe": "intratrade path samples are not present",
            "exposure": "market-session calendar plus position path are not present",
            "cashflow_reconciliation": "research engine fixture has no deposits/withdrawals",
        },
    }


def validate_research_run(store, run_id):
    run = store.get_run(run_id)
    if run.get("status") != "completed":
        raise ResearchConflict("validation requires a completed research run")
    return validate_engine_result(run.get("result"))


def _close_day(value, name):
    try:
        timestamp = int(value)
    except (TypeError, ValueError) as exc:
        raise ResearchReconciliationError(f"{name} must be an epoch-second integer") from exc
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).date().isoformat()


def _closed_balance_drawdown_details(ledger, starting_balance):
    balance = starting_balance
    peak = starting_balance
    peak_trade_index = -1
    worst = {
        "amount": 0.0,
        "percent": 0.0,
        "peak_trade_id": None,
        "trough_trade_id": None,
        "trades_to_trough": 0,
        "trades_to_recovery": 0,
        "recovered": True,
    }
    worst_peak = starting_balance
    worst_trough_index = -1
    for index, trade in enumerate(ledger):
        balance += _finite(trade.get("net_pnl"), f"ledger[{index}].net_pnl")
        if balance > peak:
            peak = balance
            peak_trade_index = index
        drawdown = peak - balance
        drawdown_pct = (drawdown / peak * 100.0) if peak > 0 else 0.0
        if drawdown > worst["amount"] + 1e-12:
            worst_peak = peak
            worst_trough_index = index
            worst = {
                "amount": drawdown,
                "percent": drawdown_pct,
                "peak_trade_id": (
                    ledger[peak_trade_index].get("trade_id") if peak_trade_index >= 0 else None
                ),
                "trough_trade_id": trade.get("trade_id"),
                "trades_to_trough": index - peak_trade_index,
                "trades_to_recovery": None,
                "recovered": False,
            }

    if worst_trough_index >= 0:
        balance = starting_balance + sum(
            _finite(item.get("net_pnl"), f"ledger[{index}].net_pnl")
            for index, item in enumerate(ledger[: worst_trough_index + 1])
        )
        for offset, trade in enumerate(ledger[worst_trough_index + 1 :], start=1):
            balance += _finite(
                trade.get("net_pnl"),
                f"ledger[{worst_trough_index + offset}].net_pnl",
            )
            if balance >= worst_peak - 1e-12:
                worst["trades_to_recovery"] = offset
                worst["recovered"] = True
                break
    return worst


def research_analytics_report(result):
    """Build an analytics read model only from reconciled research-engine output."""
    validation = validate_engine_result(result)
    ledger = result["ledger"]
    metrics = result["metrics"]
    starting_balance = _finite(metrics.get("starting_balance"), "metrics.starting_balance")

    by_day = defaultdict(lambda: {"trade_count": 0, "net_pnl": 0.0, "wins": 0, "losses": 0})
    by_side = defaultdict(lambda: {"trade_count": 0, "net_pnl": 0.0})
    planned_vs_realized = []
    for index, trade in enumerate(ledger):
        net = _finite(trade.get("net_pnl"), f"ledger[{index}].net_pnl")
        planned = _finite(
            trade.get("planned_risk_budget"), f"ledger[{index}].planned_risk_budget"
        )
        realized = _finite(trade.get("realized_r"), f"ledger[{index}].realized_r")
        day = _close_day(trade.get("close_time_utc"), f"ledger[{index}].close_time_utc")
        day_row = by_day[day]
        day_row["trade_count"] += 1
        day_row["net_pnl"] += net
        if net > 1e-12:
            day_row["wins"] += 1
        elif net < -1e-12:
            day_row["losses"] += 1
        side = str(trade.get("side") or "unknown").lower()
        by_side[side]["trade_count"] += 1
        by_side[side]["net_pnl"] += net
        planned_vs_realized.append(
            {
                "trade_id": trade.get("trade_id"),
                "planned_risk_budget": planned,
                "realized_r": realized,
                "net_pnl": net,
            }
        )

    blocked = dict(validation["blocked_by_data"])
    blocked.update(
        {
            "setup_heatmap": "research-engine ledger does not yet persist setup labels",
            "session_heatmap": "market-session classification is not present",
            "prop_rule_evaluation": "intraday equity and versioned prop-rule inputs are not present",
        }
    )
    return {
        "analytics_schema_version": "research-analytics-v1",
        "reconciled": True,
        "metric_schema_version": metrics.get("metric_schema_version"),
        "metrics": metrics,
        "planned_vs_realized_r": planned_vs_realized,
        "closed_balance_drawdown": _closed_balance_drawdown_details(ledger, starting_balance),
        "breakdowns": {
            "utc_close_day": [
                {"utc_date": day, **values} for day, values in sorted(by_day.items())
            ],
            "side": [
                {"side": side, **values} for side, values in sorted(by_side.items())
            ],
        },
        "available": validation["available"],
        "blocked_by_data": blocked,
        "definitions": metrics.get("definitions", {}),
    }
