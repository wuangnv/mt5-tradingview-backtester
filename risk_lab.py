"""Deterministic R3a probability and risk models with explicit assumptions."""

import math


MODEL_VERSION = "risk-lab-v1"
MAX_HORIZON = 10000
MAX_STREAK_STATES = 2_000_000
MAX_EQUITY_LOSSES = 10000


class RiskLabValidationError(ValueError):
    code = "RISK_LAB_INVALID_REQUEST"


def _finite_number(value, name):
    if isinstance(value, bool):
        raise RiskLabValidationError(f"{name} must be a finite number")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise RiskLabValidationError(f"{name} must be a finite number") from exc
    if not math.isfinite(number):
        raise RiskLabValidationError(f"{name} must be a finite number")
    return number


def _integer(value, name, minimum=0, maximum=None):
    if isinstance(value, bool):
        raise RiskLabValidationError(f"{name} must be an integer")
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise RiskLabValidationError(f"{name} must be an integer") from exc
    if str(value).strip() not in {str(number), f"+{number}"} and not isinstance(value, int):
        try:
            if float(value) != number:
                raise RiskLabValidationError(f"{name} must be an integer")
        except (TypeError, ValueError) as exc:
            raise RiskLabValidationError(f"{name} must be an integer") from exc
    if number < minimum:
        raise RiskLabValidationError(f"{name} must be at least {minimum}")
    if maximum is not None and number > maximum:
        raise RiskLabValidationError(f"{name} must be at most {maximum}")
    return number


def _probability(value, name):
    number = _finite_number(value, name)
    if number < 0 or number > 1:
        raise RiskLabValidationError(f"{name} must be between 0 and 1")
    return number


def next_k_losses_probability(loss_probability, streak_length):
    q = _probability(loss_probability, "loss_probability")
    k = _integer(streak_length, "streak_length", minimum=1, maximum=MAX_HORIZON)
    return q**k


def streak_occurrence_curve(loss_probability, streak_length, horizon):
    """P(at least one k-loss streak by n) for n=0..horizon under IID Bernoulli losses."""
    q = _probability(loss_probability, "loss_probability")
    k = _integer(streak_length, "streak_length", minimum=1, maximum=MAX_HORIZON)
    n_max = _integer(horizon, "horizon", minimum=0, maximum=MAX_HORIZON)
    if k * max(n_max, 1) > MAX_STREAK_STATES:
        raise RiskLabValidationError("streak computation is above the configured state cap")

    if k == 1:
        return [1.0 - (1.0 - q) ** n for n in range(n_max + 1)]

    states = [0.0] * k
    states[0] = 1.0
    curve = [0.0]
    for _ in range(n_max):
        survival = sum(states)
        next_states = [0.0] * k
        next_states[0] = (1.0 - q) * survival
        for streak in range(1, k):
            next_states[streak] = q * states[streak - 1]
        states = next_states
        probability = 1.0 - sum(states)
        if probability < 0 and probability > -1e-12:
            probability = 0.0
        if probability > 1 and probability < 1 + 1e-12:
            probability = 1.0
        curve.append(probability)
    return curve


def streak_occurrence_probability(loss_probability, streak_length, horizon):
    return streak_occurrence_curve(loss_probability, streak_length, horizon)[-1]


def streak_scenario(loss_probability, streak_length, horizon):
    q = _probability(loss_probability, "loss_probability")
    k = _integer(streak_length, "streak_length", minimum=1, maximum=MAX_HORIZON)
    n = _integer(horizon, "horizon", minimum=0, maximum=MAX_HORIZON)
    curve = streak_occurrence_curve(q, k, n)
    return {
        "model_version": MODEL_VERSION,
        "label": "hypothetical_iid_bernoulli",
        "assumptions": [
            "loss probability q is fixed",
            "trade outcomes are independent",
            "win and breakeven are both non-loss for this model",
        ],
        "inputs": {"loss_probability": q, "streak_length": k, "horizon": n},
        "next_k_all_losses_probability": q**k,
        "at_least_one_streak_probability": curve[-1],
        "horizon_curve": [
            {"horizon": index, "probability": value}
            for index, value in enumerate(curve)
        ],
        "formula": {
            "next_k": "q^k",
            "at_least_one_streak": "1 - sum_j a[N,j], with recurrence over trailing-loss states 0..k-1",
        },
    }


def compounded_loss_scenario(starting_equity, risk_fraction, losses):
    equity_0 = _finite_number(starting_equity, "starting_equity")
    if equity_0 <= 0:
        raise RiskLabValidationError("starting_equity must be greater than zero")
    f = _finite_number(risk_fraction, "risk_fraction")
    if f < 0 or f >= 1:
        raise RiskLabValidationError("risk_fraction must be at least 0 and less than 1")
    k = _integer(losses, "losses", minimum=0, maximum=MAX_EQUITY_LOSSES)

    path = []
    for loss_count in range(k + 1):
        equity = equity_0 * ((1.0 - f) ** loss_count)
        drawdown_fraction = 1.0 - (equity / equity_0)
        recovery_fraction = (
            drawdown_fraction / (1.0 - drawdown_fraction)
            if drawdown_fraction < 1.0
            else None
        )
        path.append(
            {
                "losses": loss_count,
                "equity": equity,
                "drawdown_fraction": drawdown_fraction,
                "recovery_fraction": recovery_fraction,
            }
        )
    return {
        "model_version": MODEL_VERSION,
        "label": "hypothetical_fixed_fraction_losses",
        "assumptions": [
            "each loss is exactly risk_fraction of equity immediately before that trade",
            "no cashflow, gap, slippage, overlapping exposure, or partial fill effects",
        ],
        "inputs": {"starting_equity": equity_0, "risk_fraction": f, "losses": k},
        "ending_equity": path[-1]["equity"],
        "drawdown_fraction": path[-1]["drawdown_fraction"],
        "recovery_fraction": path[-1]["recovery_fraction"],
        "path": path,
        "formula": "E_k = E_0 * (1-f)^k; DD = 1-(1-f)^k; recovery = DD/(1-DD)",
    }


def breakeven_win_rate(win_payoff, loss_amount, extra_cost=0.0, win_probability=None):
    win = _finite_number(win_payoff, "win_payoff")
    loss = _finite_number(loss_amount, "loss_amount")
    cost = _finite_number(extra_cost, "extra_cost")
    if win <= 0 or loss <= 0:
        raise RiskLabValidationError("win_payoff and loss_amount must be greater than zero")
    if cost < 0:
        raise RiskLabValidationError("extra_cost must not be negative")
    probability = None if win_probability in (None, "") else _probability(win_probability, "win_probability")
    rate = (loss + cost) / (win + loss)
    expectancy = None
    if probability is not None:
        expectancy = probability * win - (1.0 - probability) * loss - cost
    return {
        "model_version": MODEL_VERSION,
        "label": "hypothetical_two_outcome_breakeven",
        "assumptions": [
            "one fixed positive payoff W and one fixed loss L",
            "extra_cost is included only if W/L are not already net of that cost",
            "no breakeven/variable exits unless the model is extended",
        ],
        "inputs": {
            "win_payoff": win,
            "loss_amount": loss,
            "extra_cost": cost,
            "win_probability": probability,
        },
        "breakeven_win_rate": rate,
        "expectancy": expectancy,
        "feasible_probability": rate <= 1.0,
        "formula": "E = pW - (1-p)L - c; p_BE = (L+c)/(W+L)",
    }
