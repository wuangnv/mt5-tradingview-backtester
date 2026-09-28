"""Fail-closed safety contract for running while the owner is unavailable.

This is an offline policy/evidence reducer.  It does not schedule work, send a
broker order, call a provider, acquire a lease, or change an execution
capability.  The owner-absence mode is deliberately narrower than AI trade
mode: ``paper`` means local simulation only and every mode keeps
``execution_capability`` literally false.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


OWNER_ABSENCE_SAFETY_SCHEMA = "owner-absence-safety-v1"
DEFAULT_ABSENT_MODE = "research"

AbsenceMode = Literal["research", "paper", "advisory"]
AbsenceDecision = Literal["allow", "stop"]
StopReason = Literal[
    "kill_switch_active",
    "configured_stop_reason",
    "lease_missing",
    "lease_expired",
    "heartbeat_missing",
    "heartbeat_stale",
    "heartbeat_timestamp_in_future",
    "resource_missing",
    "resource_stale",
    "resource_timestamp_in_future",
    "data_missing",
    "data_stale",
    "data_timestamp_in_future",
    "data_after_cutoff",
    "cutoff_timestamp_in_future",
]


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime, field_name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must include a timezone")
    return value


def _unique_non_empty(values: tuple[str, ...], field_name: str) -> tuple[str, ...]:
    cleaned = tuple(value.strip() for value in values)
    if any(not value for value in cleaned):
        raise ValueError(f"{field_name} must contain non-empty values")
    if len(set(cleaned)) != len(cleaned):
        raise ValueError(f"{field_name} must be unique")
    return cleaned


class OwnerAbsencePolicy(BaseModel):
    """Immutable input evidence for one owner-absence evaluation.

    Missing timestamps are valid model states so that a caller can persist an
    incomplete snapshot.  ``evaluate_owner_absence`` then reports the exact
    missing gate instead of silently treating it as fresh.
    """

    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)

    schema_version: Literal["owner-absence-safety-v1"] = OWNER_ABSENCE_SAFETY_SCHEMA
    mode: AbsenceMode = DEFAULT_ABSENT_MODE
    owner_absent: Literal[True] = True
    # This literal is intentionally impossible to widen through configuration.
    execution_capability: Literal[False] = False
    kill_switch_active: bool = True
    lease_id: str | None = Field(default=None, min_length=1, max_length=128)
    lease_owner: str | None = Field(default=None, min_length=1, max_length=128)
    lease_expires_at_utc: datetime | None = None
    heartbeat_at_utc: datetime | None = None
    heartbeat_max_age_seconds: int = Field(default=60, gt=0, strict=True)
    resource_checked_at_utc: datetime | None = None
    resource_max_age_seconds: int = Field(default=300, gt=0, strict=True)
    data_observed_at_utc: datetime | None = None
    data_max_age_seconds: int = Field(default=300, gt=0, strict=True)
    data_cutoff_utc: datetime | None = None
    configured_stop_reasons: tuple[StopReason, ...] = ()
    updated_at_utc: datetime = Field(default_factory=_utc_now)

    @field_validator(
        "lease_expires_at_utc",
        "heartbeat_at_utc",
        "resource_checked_at_utc",
        "data_observed_at_utc",
        "data_cutoff_utc",
        "updated_at_utc",
    )
    @classmethod
    def validate_times(cls, value: datetime | None, info) -> datetime | None:
        return None if value is None else _aware(value, str(info.field_name))

    @field_validator("configured_stop_reasons")
    @classmethod
    def validate_stop_reasons(cls, value: tuple[StopReason, ...]) -> tuple[StopReason, ...]:
        return _unique_non_empty(value, "configured_stop_reasons")


class OwnerAbsenceDecision(BaseModel):
    """Fail-closed projection; it is never an execution command."""

    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)

    schema_version: Literal["owner-absence-safety-v1"] = OWNER_ABSENCE_SAFETY_SCHEMA
    mode: AbsenceMode
    decision: AbsenceDecision = "stop"
    stop_reasons: tuple[StopReason, ...] = ()
    evaluated_at_utc: datetime = Field(default_factory=_utc_now)
    execution_capability: Literal[False] = False

    @field_validator("evaluated_at_utc")
    @classmethod
    def validate_evaluated_at(cls, value: datetime) -> datetime:
        return _aware(value, "evaluated_at_utc")

    @field_validator("stop_reasons")
    @classmethod
    def validate_decision_reasons(cls, value: tuple[StopReason, ...]) -> tuple[StopReason, ...]:
        return _unique_non_empty(value, "stop_reasons")

    @model_validator(mode="after")
    def _enforce_fail_closed(self) -> "OwnerAbsenceDecision":
        if self.decision == "allow" and self.stop_reasons:
            raise ValueError("an allowed absence decision cannot contain stop_reasons")
        if self.decision == "stop" and not self.stop_reasons:
            raise ValueError("a stopped absence decision must explain stop_reasons")
        return self

    @classmethod
    def from_policy(
        cls,
        policy: OwnerAbsencePolicy,
        *,
        stop_reasons: tuple[StopReason, ...],
        evaluated_at_utc: datetime,
    ) -> "OwnerAbsenceDecision":
        reasons = tuple(dict.fromkeys(stop_reasons))
        return cls(
            mode=policy.mode,
            decision="stop" if reasons else "allow",
            stop_reasons=reasons,
            evaluated_at_utc=evaluated_at_utc,
        )


def _age_exceeds(now: datetime, observed: datetime, max_age_seconds: int) -> bool:
    # A negative age is handled by the caller as a future timestamp.  Keeping
    # this comparison in seconds avoids float rounding at the boundary.
    return (now - observed).total_seconds() > max_age_seconds


def evaluate_owner_absence(
    policy: OwnerAbsencePolicy,
    *,
    now: datetime | None = None,
) -> OwnerAbsenceDecision:
    """Evaluate autonomous offline readiness without performing side effects.

    Every missing or future freshness proof stops the run.  A timestamp exactly
    at its configured age boundary remains valid; a lease expiring at ``now``
    is already expired.  The result never grants broker or provider authority.
    """

    now_value = _aware(now or _utc_now(), "now")
    reasons: list[StopReason] = []
    if policy.kill_switch_active:
        reasons.append("kill_switch_active")
    if policy.configured_stop_reasons:
        reasons.append("configured_stop_reason")

    if policy.lease_id is None or policy.lease_owner is None or policy.lease_expires_at_utc is None:
        reasons.append("lease_missing")
    elif policy.lease_expires_at_utc <= now_value:
        reasons.append("lease_expired")

    if policy.heartbeat_at_utc is None:
        reasons.append("heartbeat_missing")
    elif policy.heartbeat_at_utc > now_value:
        reasons.append("heartbeat_timestamp_in_future")
    elif _age_exceeds(now_value, policy.heartbeat_at_utc, policy.heartbeat_max_age_seconds):
        reasons.append("heartbeat_stale")

    if policy.resource_checked_at_utc is None:
        reasons.append("resource_missing")
    elif policy.resource_checked_at_utc > now_value:
        reasons.append("resource_timestamp_in_future")
    elif _age_exceeds(now_value, policy.resource_checked_at_utc, policy.resource_max_age_seconds):
        reasons.append("resource_stale")

    if policy.data_observed_at_utc is None:
        reasons.append("data_missing")
    elif policy.data_observed_at_utc > now_value:
        reasons.append("data_timestamp_in_future")
    elif _age_exceeds(now_value, policy.data_observed_at_utc, policy.data_max_age_seconds):
        reasons.append("data_stale")
    if (
        policy.data_cutoff_utc is not None
        and policy.data_observed_at_utc is not None
        and policy.data_observed_at_utc > policy.data_cutoff_utc
    ):
        reasons.append("data_after_cutoff")
    if policy.data_cutoff_utc is not None and policy.data_cutoff_utc > now_value:
        reasons.append("cutoff_timestamp_in_future")

    return OwnerAbsenceDecision.from_policy(
        policy,
        stop_reasons=tuple(dict.fromkeys(reasons)),
        evaluated_at_utc=now_value,
    )


__all__ = [
    "AbsenceDecision",
    "AbsenceMode",
    "DEFAULT_ABSENT_MODE",
    "OWNER_ABSENCE_SAFETY_SCHEMA",
    "OwnerAbsenceDecision",
    "OwnerAbsencePolicy",
    "StopReason",
    "evaluate_owner_absence",
]
