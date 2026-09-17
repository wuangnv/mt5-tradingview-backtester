"""Versioned metrics for normalized closed-trade ledgers."""

import math


METRIC_SCHEMA_VERSION = "metrics-v1"
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

        if net_pnl > _ZERO_EPSILON:
            wins += 1
            current_loss_streak = 0
        elif net_pnl < -_ZERO_EPSILON:
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
