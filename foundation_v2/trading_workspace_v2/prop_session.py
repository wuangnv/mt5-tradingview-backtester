from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Literal, Mapping
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .retained import evaluate_prop_profile


PROP_SESSION_CONTRACT_VERSION = "prop-session-v1"


class PropSessionContractError(ValueError):
    pass


def _decimal(value: Decimal | int | float | str, label: str) -> Decimal:
    try:
        result = Decimal(str(value))
    except Exception as exc:  # Decimal raises several input-specific exceptions.
        raise PropSessionContractError(f"{label} must be a decimal value") from exc
    if not result.is_finite():
        raise PropSessionContractError(f"{label} must be finite")
    return result


def _utc(value: datetime, label: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise PropSessionContractError(f"{label} must be timezone-aware")
    return value.astimezone(timezone.utc)


class ThresholdValue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: Decimal | None = Field(default=None, ge=0)
    percent: Decimal | None = Field(default=None, ge=0)
    percent_base: Literal["initial_capital", "daily_anchor", "high_water_mark"] = "initial_capital"

    @model_validator(mode="after")
    def exactly_one_value(self):
        if (self.amount is None) == (self.percent is None):
            raise ValueError("exactly one of amount or percent is required")
        return self


class ProfitTargetRule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    threshold: ThresholdValue
    basis: Literal["balance", "equity"] = "balance"
    comparator: Literal["gte", "gt"] = "gte"


class LossRule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    threshold: ThresholdValue
    basis: Literal["balance", "equity"] = "equity"
    comparator: Literal["lt", "lte"] = "lt"


class OverallDrawdownRule(LossRule):
    kind: Literal["static", "trailing"] = "static"
    trailing_granularity: Literal["intraday", "end_of_day"] | None = None
    lock_floor_at_initial: bool = False

    @model_validator(mode="after")
    def granularity_matches_kind(self):
        if self.kind == "trailing" and self.trailing_granularity is None:
            raise ValueError("trailing drawdown requires trailing_granularity")
        if self.kind == "static" and self.trailing_granularity is not None:
            raise ValueError("static drawdown cannot declare trailing_granularity")
        return self


class PropPhaseSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    phase_index: int = Field(ge=1, strict=True)
    initial_capital: Decimal = Field(gt=0)
    currency: str = Field(min_length=3, max_length=12)
    profit_target: ProfitTargetRule
    daily_loss: LossRule
    overall_drawdown: OverallDrawdownRule
    reset_timezone: str = Field(min_length=1, max_length=128)
    reset_local_time: time = time(0, 0)
    reset_order: Literal["fees_then_reset", "reset_then_fees"] = "fees_then_reset"
    min_qualifying_days: int = Field(default=0, ge=0, strict=True)
    max_calendar_days: int | None = Field(default=None, ge=1, strict=True)
    carry_policy: Literal["reset", "carry_balance", "carry_all"] = "reset"
    position_policy: Literal["must_be_flat", "carry", "close_by_simulator"] = "must_be_flat"

    @field_validator("reset_timezone")
    @classmethod
    def timezone_exists(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("reset_timezone must be a valid IANA timezone") from exc
        return value


class PropProfileSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: Literal[PROP_SESSION_CONTRACT_VERSION] = PROP_SESSION_CONTRACT_VERSION
    profile_id: str = Field(min_length=1, max_length=128)
    terms_version: str = Field(min_length=1, max_length=128)
    profile_hash: str = Field(min_length=8, max_length=128)
    effective_from: date
    source_kind: Literal["generic", "custom", "named_provider"] = "generic"
    source_url: str | None = Field(default=None, max_length=2048)
    supported_rule_flags: list[str] = Field(default_factory=list, max_length=64)
    phases: list[PropPhaseSpec] = Field(min_length=1, max_length=16)

    @model_validator(mode="after")
    def phases_are_contiguous(self):
        indexes = [phase.phase_index for phase in self.phases]
        expected = list(range(1, len(indexes) + 1))
        if indexes != expected:
            raise ValueError("phase indexes must be ordered and contiguous from 1")
        currencies = {phase.currency.upper() for phase in self.phases}
        if len(currencies) != 1:
            raise ValueError("all phases in one profile snapshot must use one currency")
        if self.source_kind == "named_provider" and not self.source_url:
            raise ValueError("named_provider profile snapshots require source_url")
        return self


PropSessionStatus = Literal[
    "draft",
    "ready",
    "running",
    "paused",
    "phase_passed",
    "next_phase_ready",
    "completed_pass",
    "failed_breach",
    "expired",
    "abandoned",
]


class PropSessionSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: Literal[PROP_SESSION_CONTRACT_VERSION] = PROP_SESSION_CONTRACT_VERSION
    workspace_id: str = Field(min_length=1, max_length=128)
    session_id: str = Field(min_length=1, max_length=128)
    mode: Literal["simulation"] = "simulation"
    session_type: Literal["challenge", "practice"] = "challenge"
    profile: PropProfileSnapshot
    status: PropSessionStatus = "draft"
    revision: int = Field(default=1, ge=1, strict=True)


AttemptStatus = Literal[
    "ready",
    "running",
    "paused",
    "phase_passed",
    "next_phase_ready",
    "completed_pass",
    "failed_breach",
    "expired",
    "abandoned",
]


class ChallengeAttemptSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: Literal[PROP_SESSION_CONTRACT_VERSION] = PROP_SESSION_CONTRACT_VERSION
    workspace_id: str = Field(min_length=1, max_length=128)
    session_id: str = Field(min_length=1, max_length=128)
    attempt_id: str = Field(min_length=1, max_length=128)
    mode: Literal["simulation"] = "simulation"
    profile_id: str = Field(min_length=1, max_length=128)
    terms_version: str = Field(min_length=1, max_length=128)
    profile_hash: str = Field(min_length=8, max_length=128)
    data_version: str = Field(min_length=1, max_length=256)
    cost_version: str = Field(min_length=1, max_length=128)
    engine_version: str = Field(min_length=1, max_length=128)
    status: AttemptStatus = "ready"
    revision: int = Field(default=1, ge=1, strict=True)
    parent_attempt_id: str | None = Field(default=None, max_length=128)
    branch_kind: Literal["clean", "hindsight_exploratory"] = "clean"
    virtual_start_utc: datetime
    virtual_cutoff_utc: datetime

    @model_validator(mode="after")
    def virtual_interval_is_valid(self):
        start = _utc(self.virtual_start_utc, "virtual_start_utc")
        cutoff = _utc(self.virtual_cutoff_utc, "virtual_cutoff_utc")
        if cutoff < start:
            raise ValueError("virtual_cutoff_utc must not precede virtual_start_utc")
        return self


class PhaseStateSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspace_id: str = Field(min_length=1, max_length=128)
    session_id: str = Field(min_length=1, max_length=128)
    attempt_id: str = Field(min_length=1, max_length=128)
    profile_hash: str = Field(min_length=8, max_length=128)
    phase_index: int = Field(ge=1, strict=True)
    initial_balance: Decimal
    balance: Decimal
    floating_pl: Decimal
    equity: Decimal
    high_water_mark: Decimal
    daily_anchor: Decimal
    qualifying_days: int = Field(default=0, ge=0, strict=True)
    virtual_time_utc: datetime
    last_event_sequence: int = Field(default=0, ge=0, strict=True)
    open_positions: int = Field(default=0, ge=0, strict=True)
    pending_orders: int = Field(default=0, ge=0, strict=True)
    evaluation_quality: Literal["full_for_declared_model", "approximate", "insufficient"]

    @model_validator(mode="after")
    def money_path_is_consistent(self):
        if self.equity != self.balance + self.floating_pl:
            raise ValueError("equity must equal balance plus floating_pl")
        if self.high_water_mark < self.equity:
            raise ValueError("high_water_mark cannot be below current equity")
        _utc(self.virtual_time_utc, "virtual_time_utc")
        return self


class TransitionIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspace_id: str = Field(min_length=1, max_length=128)
    session_id: str = Field(min_length=1, max_length=128)
    attempt_id: str = Field(min_length=1, max_length=128)
    profile_hash: str = Field(min_length=8, max_length=128)
    intent_id: str = Field(min_length=1, max_length=128)
    expected_revision: int = Field(ge=1, strict=True)
    event_sequence: int = Field(ge=0, strict=True)
    action: Literal["start", "pause", "resume", "phase_pass", "next_phase", "complete_pass", "breach", "expire", "abandon"]


class TransitionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    attempt: ChallengeAttemptSnapshot
    intent_fingerprint: str
    duplicate: bool = False


def intent_fingerprint(intent: TransitionIntent) -> str:
    payload = intent.model_dump(mode="json")
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def validate_attempt_against_session(
    session: PropSessionSnapshot,
    attempt: ChallengeAttemptSnapshot,
) -> None:
    if attempt.workspace_id != session.workspace_id:
        raise PropSessionContractError("workspace mismatch")
    if attempt.session_id != session.session_id:
        raise PropSessionContractError("session mismatch")
    if attempt.mode != session.mode:
        raise PropSessionContractError("mode mismatch")
    if attempt.profile_id != session.profile.profile_id:
        raise PropSessionContractError("profile id mismatch")
    if attempt.terms_version != session.profile.terms_version:
        raise PropSessionContractError("profile terms version mismatch")
    if attempt.profile_hash != session.profile.profile_hash:
        raise PropSessionContractError("profile version mismatch")


_TRANSITIONS: dict[str, dict[str, AttemptStatus]] = {
    "ready": {"start": "running", "abandon": "abandoned"},
    "running": {
        "pause": "paused",
        "phase_pass": "phase_passed",
        "complete_pass": "completed_pass",
        "breach": "failed_breach",
        "expire": "expired",
        "abandon": "abandoned",
    },
    "paused": {
        "resume": "running",
        "breach": "failed_breach",
        "expire": "expired",
        "abandon": "abandoned",
    },
    "phase_passed": {"next_phase": "next_phase_ready"},
    "next_phase_ready": {"start": "running", "abandon": "abandoned"},
}


def apply_transition_intent(
    attempt: ChallengeAttemptSnapshot,
    intent: TransitionIntent,
    processed_intents: Mapping[str, str],
) -> TransitionResult:
    fingerprint = intent_fingerprint(intent)
    previous_fingerprint = processed_intents.get(intent.intent_id)
    if previous_fingerprint is not None:
        if previous_fingerprint != fingerprint:
            raise PropSessionContractError("intent_id was already used with different content")
        return TransitionResult(attempt=attempt, intent_fingerprint=fingerprint, duplicate=True)

    if intent.workspace_id != attempt.workspace_id:
        raise PropSessionContractError("workspace mismatch")
    if intent.session_id != attempt.session_id or intent.attempt_id != attempt.attempt_id:
        raise PropSessionContractError("session or attempt mismatch")
    if intent.profile_hash != attempt.profile_hash:
        raise PropSessionContractError("profile version mismatch")
    if intent.expected_revision != attempt.revision:
        raise PropSessionContractError("attempt revision conflict")

    target = _TRANSITIONS.get(attempt.status, {}).get(intent.action)
    if target is None:
        raise PropSessionContractError(f"transition {intent.action} is invalid from {attempt.status}")
    updated = attempt.model_copy(update={"status": target, "revision": attempt.revision + 1})
    return TransitionResult(attempt=updated, intent_fingerprint=fingerprint, duplicate=False)


class MoneyOracleInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    initial_capital: Decimal
    daily_anchor: Decimal
    balance_before_separate_costs: Decimal
    floating_pl: Decimal = Decimal("0")
    high_water_mark: Decimal
    fees: Decimal = Decimal("0")
    swap: Decimal = Decimal("0")
    conversion_adjustment: Decimal = Decimal("0")
    accounting: Literal["costs_included", "costs_separate"] = "costs_included"


def _threshold_amount(
    value: ThresholdValue,
    *,
    initial_capital: Decimal,
    daily_anchor: Decimal,
    high_water_mark: Decimal,
) -> Decimal:
    if value.amount is not None:
        return value.amount
    bases = {
        "initial_capital": initial_capital,
        "daily_anchor": daily_anchor,
        "high_water_mark": high_water_mark,
    }
    return bases[value.percent_base] * (value.percent or Decimal("0")) / Decimal("100")


def _loss_breached(current: Decimal, floor: Decimal, comparator: str) -> bool:
    return current < floor if comparator == "lt" else current <= floor


def _target_hit(current: Decimal, target: Decimal, comparator: str) -> bool:
    return current >= target if comparator == "gte" else current > target


def money_oracle(phase: PropPhaseSpec, values: MoneyOracleInput) -> dict:
    initial = _decimal(values.initial_capital, "initial_capital")
    phase_initial = _decimal(phase.initial_capital, "phase.initial_capital")
    if initial != phase_initial:
        raise PropSessionContractError("initial_capital does not match the frozen phase spec")
    daily_anchor = _decimal(values.daily_anchor, "daily_anchor")
    high_water_mark = _decimal(values.high_water_mark, "high_water_mark")
    balance = _decimal(values.balance_before_separate_costs, "balance_before_separate_costs")
    floating = _decimal(values.floating_pl, "floating_pl")
    if values.accounting == "costs_separate":
        balance += _decimal(values.conversion_adjustment, "conversion_adjustment")
        balance -= _decimal(values.fees, "fees") + _decimal(values.swap, "swap")
    equity = balance + floating

    target_gain = _threshold_amount(
        phase.profit_target.threshold,
        initial_capital=initial,
        daily_anchor=daily_anchor,
        high_water_mark=high_water_mark,
    )
    target_value = initial + target_gain
    target_current = balance if phase.profit_target.basis == "balance" else equity

    daily_allowance = _threshold_amount(
        phase.daily_loss.threshold,
        initial_capital=initial,
        daily_anchor=daily_anchor,
        high_water_mark=high_water_mark,
    )
    daily_floor = daily_anchor - daily_allowance
    daily_current = balance if phase.daily_loss.basis == "balance" else equity

    overall_allowance = _threshold_amount(
        phase.overall_drawdown.threshold,
        initial_capital=initial,
        daily_anchor=daily_anchor,
        high_water_mark=high_water_mark,
    )
    overall_reference = initial if phase.overall_drawdown.kind == "static" else high_water_mark
    overall_floor = overall_reference - overall_allowance
    if phase.overall_drawdown.lock_floor_at_initial:
        overall_floor = min(overall_floor, initial)
    overall_current = balance if phase.overall_drawdown.basis == "balance" else equity

    daily_breached = _loss_breached(daily_current, daily_floor, phase.daily_loss.comparator)
    overall_breached = _loss_breached(
        overall_current, overall_floor, phase.overall_drawdown.comparator
    )
    target_hit = _target_hit(target_current, target_value, phase.profit_target.comparator)

    return {
        "oracle_version": "prop-money-oracle-v1",
        "balance": balance,
        "equity": equity,
        "profit_target": {
            "target": target_value,
            "current": target_current,
            "hit": target_hit,
        },
        "daily_loss": {
            "reference": daily_anchor,
            "floor": daily_floor,
            "current": daily_current,
            "breached": daily_breached,
        },
        "overall_drawdown": {
            "kind": phase.overall_drawdown.kind,
            "reference": overall_reference,
            "floor": overall_floor,
            "current": overall_current,
            "breached": overall_breached,
        },
        "terminal_precedence": "failed_breach" if daily_breached or overall_breached else None,
    }


def _local_boundary(day: date, phase: PropPhaseSpec) -> datetime:
    local_zone = ZoneInfo(phase.reset_timezone)
    return datetime.combine(day, phase.reset_local_time, tzinfo=local_zone).astimezone(timezone.utc)


def calendar_oracle(
    phase: PropPhaseSpec,
    *,
    virtual_start_utc: datetime,
    previous_virtual_utc: datetime,
    current_virtual_utc: datetime,
    qualifying_local_dates: list[date] | None = None,
) -> dict:
    start = _utc(virtual_start_utc, "virtual_start_utc")
    previous = _utc(previous_virtual_utc, "previous_virtual_utc")
    current = _utc(current_virtual_utc, "current_virtual_utc")
    if previous < start or current < previous:
        raise PropSessionContractError("virtual time must be monotonic from the attempt start")

    zone = ZoneInfo(phase.reset_timezone)
    previous_local = previous.astimezone(zone)
    current_local = current.astimezone(zone)
    start_local = start.astimezone(zone)

    boundaries: list[dict] = []
    candidate_day = previous_local.date()
    final_day = current_local.date() + timedelta(days=1)
    while candidate_day <= final_day:
        boundary_utc = _local_boundary(candidate_day, phase)
        if previous < boundary_utc <= current:
            ordered_events = (
                ["fees_swap", "daily_reset"]
                if phase.reset_order == "fees_then_reset"
                else ["daily_reset", "fees_swap"]
            )
            boundaries.append(
                {
                    "local_date": candidate_day.isoformat(),
                    "boundary_utc": boundary_utc,
                    "ordered_events": ordered_events,
                }
            )
        candidate_day += timedelta(days=1)

    qualifying = {
        value
        for value in (qualifying_local_dates or [])
        if start_local.date() <= value <= current_local.date()
    }
    elapsed_calendar_days = (current_local.date() - start_local.date()).days + 1
    deadline_utc = None
    expired = False
    if phase.max_calendar_days is not None:
        deadline_day = start_local.date() + timedelta(days=phase.max_calendar_days)
        deadline_utc = _local_boundary(deadline_day, phase)
        expired = current >= deadline_utc

    return {
        "oracle_version": "prop-calendar-oracle-v1",
        "virtual_time_utc": current,
        "reset_timezone": phase.reset_timezone,
        "reset_boundaries": boundaries,
        "elapsed_calendar_days": elapsed_calendar_days,
        "qualifying_days": len(qualifying),
        "min_qualifying_days_satisfied": len(qualifying) >= phase.min_qualifying_days,
        "deadline_utc": deadline_utc,
        "expired": expired,
    }


def evaluate_with_retained_prop_profile(
    profile: PropProfileSnapshot,
    phase_index: int,
    snapshot: dict,
    *,
    cost_basis: Literal["included", "separate"] = "included",
) -> dict:
    try:
        phase = profile.phases[phase_index - 1]
    except IndexError as exc:
        raise PropSessionContractError("phase_index is outside the profile snapshot") from exc
    if phase.phase_index != phase_index:
        raise PropSessionContractError("phase_index does not match the frozen profile snapshot")
    if phase.daily_loss.threshold.amount is None or phase.overall_drawdown.threshold.amount is None:
        raise PropSessionContractError("retained prop evaluator only supports fixed loss amounts")
    if phase.daily_loss.comparator != phase.overall_drawdown.comparator:
        raise PropSessionContractError("retained prop evaluator requires one loss-boundary comparator")
    breach_at_boundary = phase.daily_loss.comparator == "lte"
    legacy_profile = {
        "profile_id": profile.profile_id,
        "terms_version": profile.terms_version,
        "effective_from": profile.effective_from.isoformat(),
        "reset_timezone": phase.reset_timezone,
        "breach_at_boundary": breach_at_boundary,
        "cost_basis": cost_basis,
        "total_drawdown": {
            "type": phase.overall_drawdown.kind,
            "amount": float(phase.overall_drawdown.threshold.amount),
            "basis": phase.overall_drawdown.basis,
        },
        "daily_loss": {
            "amount": float(phase.daily_loss.threshold.amount),
            "basis": phase.daily_loss.basis,
        },
    }
    return evaluate_prop_profile(legacy_profile, snapshot)
