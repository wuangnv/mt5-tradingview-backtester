"""R3b empirical block bootstrap with explicit eligibility and reproducibility."""

from collections import defaultdict
from datetime import datetime, timezone
import math
import random

from risk_lab import RiskLabValidationError


BOOTSTRAP_VERSION = "block-bootstrap-v1"
MIN_TRADES = 20
MIN_DAY_BLOCKS = 5
MAX_PATHS = 10_000
MAX_BOOTSTRAP_HORIZON = 2_000
MAX_SIMULATED_TRADES = 5_000_000


class RiskLabInsufficientData(RiskLabValidationError):
    code = "RISK_LAB_INSUFFICIENT_DATA"


class RiskLabCancelled(RuntimeError):
    code = "RISK_LAB_CANCELLED"


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


def _integer(value, name, minimum, maximum):
    if isinstance(value, bool):
        raise RiskLabValidationError(f"{name} must be an integer")
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise RiskLabValidationError(f"{name} must be an integer") from exc
    try:
        numeric = float(value)
    except (TypeError, ValueError) as exc:
        raise RiskLabValidationError(f"{name} must be an integer") from exc
    if numeric != number:
        raise RiskLabValidationError(f"{name} must be an integer")
    if number < minimum or number > maximum:
        raise RiskLabValidationError(f"{name} must be between {minimum} and {maximum}")
    return number


def _utc_datetime(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("close_time_utc is missing")
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        raise ValueError("close_time_utc must include a timezone")
    return parsed.astimezone(timezone.utc)


def day_blocks(ledger):
    grouped = defaultdict(list)
    ordered = []
    for index, trade in enumerate(ledger):
        try:
            close_time = _utc_datetime(trade.get("close_time_utc"))
            pnl = _finite_number(trade.get("net_pnl"), f"ledger[{index}].net_pnl")
        except (RiskLabValidationError, ValueError) as exc:
            raise RiskLabValidationError(f"ledger trade {index} is not bootstrap-ready: {exc}") from exc
        ordered.append((close_time, index, pnl))
    ordered.sort(key=lambda item: (item[0], item[1]))
    for close_time, _, pnl in ordered:
        grouped[close_time.date().isoformat()].append(pnl)
    return [{"utc_date": day, "net_pnl": values} for day, values in grouped.items()]


def bootstrap_eligibility(run, ledger):
    reasons = []
    if run.get("status") != "completed":
        reasons.append("run_not_completed")
    if len(ledger) < MIN_TRADES:
        reasons.append(f"requires_at_least_{MIN_TRADES}_closed_trades")

    data = run.get("data") or {}
    assumptions = run.get("assumptions") or {}
    if not data.get("dataset_id"):
        reasons.append("dataset_id_unknown")
    if not data.get("requested_range"):
        reasons.append("requested_range_unknown")
    if not assumptions.get("cost_model_version"):
        reasons.append("cost_model_unknown")
    if not assumptions.get("risk_model_version"):
        reasons.append("risk_model_unknown")

    block_count = 0
    try:
        block_count = len(day_blocks(ledger))
    except RiskLabValidationError:
        reasons.append("ordered_close_time_or_net_pnl_invalid")
    if block_count < MIN_DAY_BLOCKS:
        reasons.append(f"requires_at_least_{MIN_DAY_BLOCKS}_utc_day_blocks")

    return {
        "eligible": not reasons,
        "reasons": sorted(set(reasons)),
        "requirements": {
            "min_closed_trades": MIN_TRADES,
            "min_utc_day_blocks": MIN_DAY_BLOCKS,
            "required_provenance": [
                "dataset_id",
                "requested_range",
                "cost_model_version",
                "risk_model_version",
            ],
        },
        "observed": {"closed_trades": len(ledger), "utc_day_blocks": block_count},
    }


def _quantile(values, probability):
    ordered = sorted(values)
    if not ordered:
        return None
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] * (1.0 - fraction) + ordered[upper] * fraction


def _distribution(values):
    return {
        "p05": _quantile(values, 0.05),
        "p50": _quantile(values, 0.50),
        "p95": _quantile(values, 0.95),
        "min": min(values),
        "max": max(values),
    }


def block_bootstrap_simulation(
    run,
    ledger,
    *,
    seed,
    path_count,
    horizon,
    breach_drawdown_fraction,
    cancel_check=None,
):
    eligibility = bootstrap_eligibility(run, ledger)
    if not eligibility["eligible"]:
        raise RiskLabInsufficientData(", ".join(eligibility["reasons"]))

    seed_value = _integer(seed, "seed", 0, 2**32 - 1)
    paths = _integer(path_count, "path_count", 1, MAX_PATHS)
    trades_per_path = _integer(horizon, "horizon", 1, MAX_BOOTSTRAP_HORIZON)
    if paths * trades_per_path > MAX_SIMULATED_TRADES:
        raise RiskLabValidationError("path_count * horizon is above the configured workload cap")
    breach = _finite_number(breach_drawdown_fraction, "breach_drawdown_fraction")
    if breach <= 0 or breach >= 1:
        raise RiskLabValidationError("breach_drawdown_fraction must be greater than 0 and less than 1")

    starting_equity = _finite_number(run.get("starting_balance"), "starting_balance")
    if starting_equity <= 0:
        raise RiskLabValidationError("starting_balance must be greater than zero")

    blocks = day_blocks(ledger)
    rng = random.Random(seed_value)
    terminal_equities = []
    max_drawdowns = []
    max_loss_streaks = []
    breach_count = 0

    for path_index in range(paths):
        if cancel_check is not None and cancel_check():
            raise RiskLabCancelled(f"simulation cancelled after {path_index} completed paths")

        sampled = []
        while len(sampled) < trades_per_path:
            sampled.extend(rng.choice(blocks)["net_pnl"])
        sampled = sampled[:trades_per_path]

        equity = starting_equity
        peak = starting_equity
        max_drawdown = 0.0
        current_loss_streak = 0
        max_loss_streak = 0
        for pnl in sampled:
            equity += pnl
            peak = max(peak, equity)
            drawdown = max(0.0, (peak - equity) / peak)
            max_drawdown = max(max_drawdown, drawdown)
            if pnl < 0:
                current_loss_streak += 1
                max_loss_streak = max(max_loss_streak, current_loss_streak)
            else:
                current_loss_streak = 0

        terminal_equities.append(equity)
        max_drawdowns.append(max_drawdown)
        max_loss_streaks.append(max_loss_streak)
        if max_drawdown >= breach:
            breach_count += 1

    breach_rate = breach_count / paths
    monte_carlo_se = math.sqrt(breach_rate * (1.0 - breach_rate) / paths)
    block_sizes = [len(block["net_pnl"]) for block in blocks]
    return {
        "model_version": BOOTSTRAP_VERSION,
        "label": "empirical_utc_day_block_bootstrap",
        "method": {
            "sampling_unit": "UTC close date",
            "replacement": True,
            "within_block_order_preserved": True,
            "block_count": len(blocks),
            "block_size_min": min(block_sizes),
            "block_size_max": max(block_sizes),
        },
        "inputs": {
            "run_id": str(run.get("run_id")),
            "dataset_id": (run.get("data") or {}).get("dataset_id"),
            "seed": seed_value,
            "path_count": paths,
            "horizon": trades_per_path,
            "starting_equity": starting_equity,
            "breach_drawdown_fraction": breach,
            "cost_model_version": (run.get("assumptions") or {}).get("cost_model_version"),
            "risk_model_version": (run.get("assumptions") or {}).get("risk_model_version"),
        },
        "results": {
            "terminal_equity": _distribution(terminal_equities),
            "max_drawdown_fraction": _distribution(max_drawdowns),
            "max_loss_streak": _distribution(max_loss_streaks),
            "breach_rate": breach_rate,
            "breach_monte_carlo_se": monte_carlo_se,
        },
        "limits": [
            "resampling reflects only the observed run and does not establish future stationarity",
            "UTC-day blocks preserve within-day order but not dependence across sampled days",
            "more paths reduce Monte Carlo error but not sample bias or model misspecification",
            "breach rate is a simulated scenario rate, not payout or ruin probability",
        ],
    }
