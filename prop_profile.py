"""Versioned prop-rule evaluation with explicit data blockers."""

import math
import re
from datetime import date

from risk_lab import RiskLabValidationError


class PropProfileValidationError(RiskLabValidationError):
    pass


def _finite(value, label, *, minimum=None):
    if isinstance(value, bool):
        raise PropProfileValidationError(f"{label} must be a finite number")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise PropProfileValidationError(f"{label} must be a finite number") from exc
    if not math.isfinite(number):
        raise PropProfileValidationError(f"{label} must be a finite number")
    if minimum is not None and number < minimum:
        raise PropProfileValidationError(f"{label} must be at least {minimum}")
    return number


def _profile(profile):
    if not isinstance(profile, dict):
        raise PropProfileValidationError("profile must be an object")
    profile_id = str(profile.get("profile_id") or "").strip()
    terms_version = str(profile.get("terms_version") or "").strip()
    effective_from = str(profile.get("effective_from") or "").strip()
    reset_timezone = str(profile.get("reset_timezone") or "").strip()
    if not profile_id or not terms_version or not effective_from or not reset_timezone:
        raise PropProfileValidationError(
            "profile_id, terms_version, effective_from and reset_timezone are required"
        )
    try:
        date.fromisoformat(effective_from)
    except ValueError as exc:
        raise PropProfileValidationError("effective_from must be YYYY-MM-DD") from exc
    if reset_timezone != "UTC" and not re.fullmatch(
        r"[A-Za-z_+-]+(?:/[A-Za-z0-9_+.-]+)+", reset_timezone
    ):
        raise PropProfileValidationError("reset_timezone must be UTC or an IANA-style timezone id")

    total = profile.get("total_drawdown")
    daily = profile.get("daily_loss")
    if not isinstance(total, dict) or not isinstance(daily, dict):
        raise PropProfileValidationError("total_drawdown and daily_loss must be objects")
    drawdown_type = str(total.get("type") or "").strip().lower()
    if drawdown_type not in {"static", "trailing"}:
        raise PropProfileValidationError("total_drawdown.type must be static or trailing")
    total_basis = str(total.get("basis") or "").strip().lower()
    daily_basis = str(daily.get("basis") or "").strip().lower()
    if total_basis not in {"balance", "equity"} or daily_basis not in {"balance", "equity"}:
        raise PropProfileValidationError("drawdown basis must be balance or equity")
    cost_basis = str(profile.get("cost_basis") or "included").strip().lower()
    if cost_basis not in {"included", "separate"}:
        raise PropProfileValidationError("cost_basis must be included or separate")
    breach_at_boundary = profile.get("breach_at_boundary", True)
    if not isinstance(breach_at_boundary, bool):
        raise PropProfileValidationError("breach_at_boundary must be boolean")
    return {
        "profile_id": profile_id,
        "terms_version": terms_version,
        "effective_from": effective_from,
        "reset_timezone": reset_timezone,
        "total_drawdown": {
            "type": drawdown_type,
            "amount": _finite(total.get("amount"), "total_drawdown.amount", minimum=0.0),
            "basis": total_basis,
        },
        "daily_loss": {
            "amount": _finite(daily.get("amount"), "daily_loss.amount", minimum=0.0),
            "basis": daily_basis,
        },
        "cost_basis": cost_basis,
        "breach_at_boundary": breach_at_boundary,
    }


def _optional_finite(snapshot, key, blockers):
    if snapshot.get(key) in (None, ""):
        blockers.append(f"missing_{key}")
        return None
    return _finite(snapshot.get(key), key)


def _breached(current, floor, at_boundary):
    return current <= floor if at_boundary else current < floor


def evaluate_prop_profile(profile, snapshot):
    normalized = _profile(profile)
    if not isinstance(snapshot, dict):
        raise PropProfileValidationError("snapshot must be an object")

    blockers = []
    starting_balance = _optional_finite(snapshot, "starting_balance", blockers)
    balance = _optional_finite(snapshot, "balance", blockers)
    equity = None
    if "equity" in {
        normalized["total_drawdown"]["basis"],
        normalized["daily_loss"]["basis"],
    }:
        equity = _optional_finite(snapshot, "equity", blockers)

    high_water_mark = None
    if normalized["total_drawdown"]["type"] == "trailing":
        high_water_mark = _optional_finite(snapshot, "high_water_mark", blockers)

    daily_start_key = f"daily_start_{normalized['daily_loss']['basis']}"
    daily_start = _optional_finite(snapshot, daily_start_key, blockers)

    costs_total = 0.0
    costs_today = 0.0
    if normalized["cost_basis"] == "separate":
        costs_total = _optional_finite(snapshot, "costs_total", blockers)
        costs_today = _optional_finite(snapshot, "costs_today", blockers)

    if blockers:
        return {
            "schema_version": "prop-profile-evaluation-v1",
            "status": "blocked_by_data",
            "profile": normalized,
            "blocked_by_data": sorted(set(blockers)),
            "total_drawdown": None,
            "daily_loss": None,
        }

    current_total = balance if normalized["total_drawdown"]["basis"] == "balance" else equity
    current_daily = balance if normalized["daily_loss"]["basis"] == "balance" else equity
    if normalized["cost_basis"] == "separate":
        current_total -= costs_total
        current_daily -= costs_today

    if normalized["total_drawdown"]["type"] == "static":
        total_reference = starting_balance
    else:
        total_reference = high_water_mark
    total_floor = total_reference - normalized["total_drawdown"]["amount"]
    daily_floor = daily_start - normalized["daily_loss"]["amount"]
    total_breached = _breached(current_total, total_floor, normalized["breach_at_boundary"])
    daily_breached = _breached(current_daily, daily_floor, normalized["breach_at_boundary"])

    return {
        "schema_version": "prop-profile-evaluation-v1",
        "status": "breached" if total_breached or daily_breached else "within_limits",
        "profile": normalized,
        "blocked_by_data": [],
        "total_drawdown": {
            "basis": normalized["total_drawdown"]["basis"],
            "reference": total_reference,
            "floor": total_floor,
            "current": current_total,
            "remaining": current_total - total_floor,
            "breached": total_breached,
        },
        "daily_loss": {
            "basis": normalized["daily_loss"]["basis"],
            "reference": daily_start,
            "floor": daily_floor,
            "current": current_daily,
            "remaining": current_daily - daily_floor,
            "breached": daily_breached,
        },
        "assumptions": {
            "cost_basis": normalized["cost_basis"],
            "cashflow_adjustment": "not_modeled",
            "payout_probability": "not_estimated",
        },
    }
