"""Versioned metrics for normalized closed-trade ledgers."""

import math


METRIC_SCHEMA_VERSION = "metrics-v1"
METRIC_SCHEMA_VERSION_V2 = "metrics-v2"
_ZERO_EPSILON = 1e-12


def _finite_number(value, name):
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a finite number")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a finite number") from exc
    if not math.isfinite(number):
        raise ValueError(f"{name} must be a finite number")
    return number


def _optional_number(value, name):
    if value is None:
        return None
    return _finite_number(value, name)


def classify_net_pnl(value):
    """Classify a net result using the same zero tolerance as all metric versions."""
    number = _finite_number(value, "net_pnl")
    if number > _ZERO_EPSILON:
        return "win"
    if number < -_ZERO_EPSILON:
        return "loss"
    return "breakeven"


def compute_metrics_v1(ledger, starting_balance):
    """Compute metrics-v1 from an immutable normalized closed-trade ledger."""
    if not isinstance(ledger, list):
        raise ValueError("ledger must be a list")

    balance = _finite_number(starting_balance, "starting_balance")
    if balance <= 0:
        raise ValueError("starting_balance must be greater than zero")

    wins = 0
    losses = 0
    breakeven = 0
    net_values = []
    gross_values = []
    fee_values = []
    realized_r_values = []
    current_loss_streak = 0
    max_loss_streak = 0
    peak = balance
    max_drawdown = 0.0
    max_drawdown_pct = 0.0
    equity_curve = [
        {"sequence": 0, "trade_id": None, "equity": balance},
    ]

    for index, trade in enumerate(ledger, start=1):
        if not isinstance(trade, dict):
            raise ValueError(f"ledger[{index - 1}] must be an object")

        net_pnl = _finite_number(trade.get("net_pnl"), f"ledger[{index - 1}].net_pnl")
        gross_pnl = _optional_number(
            trade.get("gross_pnl"),
            f"ledger[{index - 1}].gross_pnl",
        )
        fees = _optional_number(trade.get("fees"), f"ledger[{index - 1}].fees")
        planned_risk = _optional_number(
            trade.get("planned_risk_budget"),
            f"ledger[{index - 1}].planned_risk_budget",
        )

        net_values.append(net_pnl)
        if gross_pnl is not None:
            gross_values.append(gross_pnl)
        if fees is not None:
            fee_values.append(fees)

        outcome = classify_net_pnl(net_pnl)
        if outcome == "win":
            wins += 1
            current_loss_streak = 0
        elif outcome == "loss":
            losses += 1
            current_loss_streak += 1
            max_loss_streak = max(max_loss_streak, current_loss_streak)
        else:
            breakeven += 1
            current_loss_streak = 0

        if planned_risk is not None:
            if planned_risk <= 0:
                raise ValueError(
                    f"ledger[{index - 1}].planned_risk_budget must be greater than zero"
                )
            realized_r_values.append(net_pnl / planned_risk)

        balance += net_pnl
        peak = max(peak, balance)
        drawdown = peak - balance
        drawdown_pct = (drawdown / peak * 100.0) if peak > 0 else 0.0
        if drawdown > max_drawdown:
            max_drawdown = drawdown
        if drawdown_pct > max_drawdown_pct:
            max_drawdown_pct = drawdown_pct
        equity_curve.append(
            {
                "sequence": index,
                "trade_id": trade.get("trade_id"),
                "equity": balance,
            }
        )

    count = len(net_values)
    net_pnl = sum(net_values)
    positive_after_cost = sum(value for value in net_values if value > _ZERO_EPSILON)
    negative_after_cost = abs(sum(value for value in net_values if value < -_ZERO_EPSILON))
    if negative_after_cost > _ZERO_EPSILON:
        profit_factor = positive_after_cost / negative_after_cost
    else:
        profit_factor = None

    all_gross_known = len(gross_values) == count
    all_fees_known = len(fee_values) == count

    return {
        "metric_schema_version": METRIC_SCHEMA_VERSION,
        "trade_count": count,
        "wins": wins,
        "losses": losses,
        "breakeven": breakeven,
        "win_rate_pct": (wins / count * 100.0) if count else 0.0,
        "gross_pnl": sum(gross_values) if all_gross_known else None,
        "fees": sum(fee_values) if all_fees_known else None,
        "net_pnl": net_pnl,
        "profit_factor_after_cost": profit_factor,
        "expectancy_net_per_trade": (net_pnl / count) if count else None,
        "average_realized_r": (
            sum(realized_r_values) / len(realized_r_values)
            if realized_r_values
            else None
        ),
        "max_drawdown": max_drawdown,
        "max_drawdown_pct": max_drawdown_pct,
        "max_loss_streak": max_loss_streak,
        "starting_balance": _finite_number(starting_balance, "starting_balance"),
        "ending_balance": balance,
        "equity_curve": equity_curve,
    }


def metric_dictionary_v2():
    """Return traceable definitions for the decision-facing metrics-v2 scalars."""
    return {
        "closed_trade_count": {
            "question": "How many selected closed trades are in the denominator?",
            "unit": "trades",
            "formula": "count(selected closed trades)",
            "source": "normalized closed-trade ledger",
            "version": METRIC_SCHEMA_VERSION_V2,
        },
        "net_pnl": {
            "question": "What did the selected closed trades make or lose after recorded costs?",
            "unit": "account_currency",
            "formula": "sum(net_pnl_i)",
            "source": "normalized closed-trade ledger",
            "version": METRIC_SCHEMA_VERSION_V2,
        },
        "win_rate_pct": {
            "question": "What share of selected closed trades finished net positive?",
            "unit": "percent",
            "formula": "wins / closed_trade_count * 100",
            "source": "normalized closed-trade ledger",
            "version": METRIC_SCHEMA_VERSION_V2,
        },
        "expectancy_net_per_trade": {
            "question": "What was average net P/L per selected closed trade?",
            "unit": "account_currency_per_trade",
            "formula": "sum(net_pnl_i) / closed_trade_count",
            "source": "normalized closed-trade ledger",
            "version": METRIC_SCHEMA_VERSION_V2,
        },
        "profit_factor_after_cost": {
            "question": "How much net-positive P/L was observed per unit of net-negative P/L?",
            "unit": "ratio",
            "formula": "sum(net positive) / abs(sum(net negative))",
            "source": "normalized closed-trade ledger",
            "version": METRIC_SCHEMA_VERSION_V2,
        },
        "payoff_ratio_after_cost": {
            "question": "How large was the mean net winner relative to the mean net loser?",
            "unit": "ratio",
            "formula": "mean(net winners) / abs(mean(net losers))",
            "source": "normalized closed-trade ledger",
            "version": METRIC_SCHEMA_VERSION_V2,
        },
        "average_realized_r": {
            "question": "What was average realized R when every selected trade has planned risk?",
            "unit": "R",
            "formula": "mean(net_pnl_i / planned_risk_budget_i)",
            "source": "normalized closed-trade ledger",
            "version": METRIC_SCHEMA_VERSION_V2,
        },
        "closed_trade_balance_max_drawdown": {
            "question": "What was the largest peak-to-trough drop in the closed-trade balance path?",
            "unit": "account_currency",
            "formula": "max_t(peak_closed_balance_t - closed_balance_t)",
            "source": "closed-trade balance path; no floating P/L or cashflow",
            "version": METRIC_SCHEMA_VERSION_V2,
        },
        "closed_trade_balance_max_drawdown_pct": {
            "question": "What was the largest closed-trade balance drawdown as a percent of its prior peak?",
            "unit": "percent",
            "formula": "max_t(drawdown_t / peak_closed_balance_t * 100)",
            "source": "closed-trade balance path; no floating P/L or cashflow",
            "version": METRIC_SCHEMA_VERSION_V2,
        },
        "max_loss_streak": {
            "question": "What was the longest consecutive net-loss streak in sequence order?",
            "unit": "trades",
            "formula": "max consecutive net_pnl_i < 0; breakeven resets streak",
            "source": "normalized closed-trade ledger",
            "version": METRIC_SCHEMA_VERSION_V2,
        },
        "starting_balance": {
            "question": "What run starting balance anchors this closed-trade balance path?",
            "unit": "account_currency",
            "formula": "persisted run starting_balance",
            "source": "run artifact",
            "version": METRIC_SCHEMA_VERSION_V2,
        },
        "ending_closed_trade_balance": {
            "question": "What is starting balance plus selected closed-trade net P/L?",
            "unit": "account_currency",
            "formula": "starting_balance + sum(selected net_pnl_i)",
            "source": "run artifact + normalized closed-trade ledger",
            "version": METRIC_SCHEMA_VERSION_V2,
        },
    }


def compute_metrics_v2(ledger, starting_balance):
    """Compute decision-facing metrics with explicit unknown and balance-DD semantics."""
    base = compute_metrics_v1(ledger, starting_balance)
    count = base["trade_count"]
    winners = []
    losers = []
    realized_r_values = []
    known_gross = 0
    known_fees = 0

    for index, trade in enumerate(ledger):
        net_pnl = _finite_number(trade.get("net_pnl"), f"ledger[{index}].net_pnl")
        outcome = classify_net_pnl(net_pnl)
        if outcome == "win":
            winners.append(net_pnl)
        elif outcome == "loss":
            losers.append(net_pnl)

        if trade.get("gross_pnl") is not None:
            _finite_number(trade.get("gross_pnl"), f"ledger[{index}].gross_pnl")
            known_gross += 1
        if trade.get("fees") is not None:
            _finite_number(trade.get("fees"), f"ledger[{index}].fees")
            known_fees += 1

        planned_risk = trade.get("planned_risk_budget")
        if planned_risk is not None:
            planned_risk = _finite_number(planned_risk, f"ledger[{index}].planned_risk_budget")
            if planned_risk <= 0:
                raise ValueError(f"ledger[{index}].planned_risk_budget must be greater than zero")
            realized_r_values.append(net_pnl / planned_risk)

    payoff_ratio = None
    if winners and losers:
        payoff_ratio = (sum(winners) / len(winners)) / abs(sum(losers) / len(losers))

    drawdown_curve = []
    peak = float(starting_balance)
    for point in base["equity_curve"]:
        equity = point["equity"]
        peak = max(peak, equity)
        drawdown = peak - equity
        drawdown_curve.append(
            {
                "sequence": point["sequence"],
                "trade_id": point["trade_id"],
                "closed_trade_balance": equity,
                "peak_closed_trade_balance": peak,
                "drawdown": drawdown,
                "drawdown_pct": (drawdown / peak * 100.0) if peak > 0 else None,
            }
        )

    realized_r_complete = count > 0 and len(realized_r_values) == count
    return {
        "metric_schema_version": METRIC_SCHEMA_VERSION_V2,
        "closed_trade_count": count,
        "wins": base["wins"],
        "losses": base["losses"],
        "breakeven": base["breakeven"],
        "win_rate_pct": (base["wins"] / count * 100.0) if count else None,
        "loss_rate_pct": (base["losses"] / count * 100.0) if count else None,
        "gross_pnl": base["gross_pnl"],
        "fees": base["fees"],
        "net_pnl": base["net_pnl"],
        "profit_factor_after_cost": base["profit_factor_after_cost"],
        "payoff_ratio_after_cost": payoff_ratio,
        "expectancy_net_per_trade": base["expectancy_net_per_trade"],
        "average_realized_r": (
            sum(realized_r_values) / len(realized_r_values) if realized_r_complete else None
        ),
        "realized_r_known_count": len(realized_r_values),
        "gross_pnl_known_count": known_gross,
        "fees_known_count": known_fees,
        "closed_trade_balance_max_drawdown": base["max_drawdown"],
        "closed_trade_balance_max_drawdown_pct": base["max_drawdown_pct"],
        "max_loss_streak": base["max_loss_streak"],
        "starting_balance": base["starting_balance"],
        "ending_closed_trade_balance": base["ending_balance"],
        "closed_trade_balance_curve": [
            {
                "sequence": point["sequence"],
                "trade_id": point["trade_id"],
                "closed_trade_balance": point["equity"],
            }
            for point in base["equity_curve"]
        ],
        "closed_trade_balance_drawdown_curve": drawdown_curve,
        "realized_r_values": realized_r_values,
        "basis": {
            "pnl": "net_pnl from normalized closed-trade ledger",
            "costs": "complete" if count and known_gross == count and known_fees == count else "incomplete_or_unknown",
            "realized_r": "complete" if realized_r_complete else "incomplete_or_unknown",
            "drawdown": "closed_trade_balance_only",
            "floating_pnl": "not_available",
            "cashflow": "not_available",
        },
        "definitions": metric_dictionary_v2(),
    }
