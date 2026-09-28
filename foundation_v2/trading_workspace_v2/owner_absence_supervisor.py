"""Pure lifecycle reducer for unattended owner-absence runs.

The existing :mod:`owner_absence_safety` contract answers whether the current
evidence is fresh.  This module adds the missing lifecycle boundary around it:
an offline supervisor can start one fenced run, continue it while its identity
remains stable, and recover only through a *new* fence after a stop.  It is a
deterministic, side-effect-free reducer; a host process must persist the
returned snapshot and perform any process restart separately.

This deliberately remains ``PREP_ONLY_OFFLINE``.  It never starts a process,
renews a lease, calls a provider, sends an order, or changes execution
capability.  A quarantined run cannot be restarted automatically, even when
fresh evidence later appears.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .owner_absence_safety import (
    OwnerAbsenceDecision,
    OwnerAbsencePolicy,
    StopReason,
    evaluate_owner_absence,
)
from .execution_intent_contract import (
    ExecutionIntent,
    execution_intent_fingerprint,
    evaluate_execution_intent,
)
from .risk_promotion_contracts import AITradeMode, RiskBudget


OWNER_ABSENCE_SUPERVISOR_SCHEMA = "owner-absence-supervisor-v1"
OWNER_ABSENCE_PAPER_ADMISSION_SCHEMA = "owner-absence-paper-admission-v1"
SupervisorState = Literal["new", "running", "recovery_required", "quarantined"]
SupervisorAction = Literal["start", "continue", "restart", "stop", "quarantine"]


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


def _canonical_hash(value: dict[str, object]) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


class SupervisorIdentity(BaseModel):
    """Logical run plus an ephemeral fence that identifies one owner attempt."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    run_id: str = Field(min_length=1, max_length=128)
    fence_token: str = Field(min_length=1, max_length=128)


class OwnerAbsencePaperAdmissionError(ValueError):
    """Raised when an owner-absence step cannot admit one paper intent."""

    def __init__(self, *blockers: str):
        self.blockers = tuple(dict.fromkeys(blockers)) or ("owner_absence_paper_admission_denied",)
        super().__init__(", ".join(self.blockers))


class OwnerAbsencePaperAdmission(BaseModel):
    """Immutable provenance binding for one fenced paper-adapter admission.

    The contract carries no executable capability.  It records which fenced
    owner-absence attempt admitted which exact intent so a paper projection
    cannot silently detach from its supervisor evidence.
    """

    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)

    schema_version: Literal["owner-absence-paper-admission-v1"] = OWNER_ABSENCE_PAPER_ADMISSION_SCHEMA
    run_id: str = Field(min_length=1, max_length=128)
    fence_token: str = Field(min_length=1, max_length=128)
    supervisor_action: Literal["start", "continue", "restart"]
    intent_id: str = Field(min_length=1, max_length=128)
    intent_fingerprint: str = Field(min_length=8, max_length=128)
    capability_epoch: str = Field(min_length=1, max_length=128)
    risk_budget_hash: str = Field(min_length=1, max_length=128)
    admitted_at_utc: datetime
    execution_capability: Literal[False] = False

    @field_validator("admitted_at_utc")
    @classmethod
    def validate_admitted_at(cls, value: datetime) -> datetime:
        return _aware(value, "admitted_at_utc")

    def fingerprint(self) -> str:
        """Stable identity for audit/projection binding; never an authority token."""

        return _canonical_hash(self.model_dump(mode="json"))


class OwnerAbsenceSupervisorSnapshot(BaseModel):
    """Durable reducer state; no field grants broker/provider authority."""

    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)

    schema_version: Literal["owner-absence-supervisor-v1"] = OWNER_ABSENCE_SUPERVISOR_SCHEMA
    state: SupervisorState = "new"
    active_run_id: str | None = Field(default=None, min_length=1, max_length=128)
    active_fence_token: str | None = Field(default=None, min_length=1, max_length=128)
    restart_count: int = Field(default=0, ge=0, strict=True)
    max_restarts: int = Field(default=3, ge=0, strict=True)
    last_stop_reasons: tuple[StopReason, ...] = ()
    last_transition_at_utc: datetime | None = None
    execution_capability: Literal[False] = False

    @field_validator("last_transition_at_utc")
    @classmethod
    def validate_transition_time(cls, value: datetime | None) -> datetime | None:
        return None if value is None else _aware(value, "last_transition_at_utc")

    @field_validator("last_stop_reasons")
    @classmethod
    def validate_stop_reasons(cls, value: tuple[StopReason, ...]) -> tuple[StopReason, ...]:
        return _unique_non_empty(value, "last_stop_reasons")

    @model_validator(mode="after")
    def validate_identity_pair(self) -> "OwnerAbsenceSupervisorSnapshot":
        has_run = self.active_run_id is not None
        has_fence = self.active_fence_token is not None
        if has_run != has_fence:
            raise ValueError("active_run_id and active_fence_token must be provided together")
        if self.state == "new" and has_run:
            raise ValueError("new supervisor snapshot cannot have an active identity")
        if self.state == "running" and not has_run:
            raise ValueError("running supervisor snapshot requires an active identity")
        return self


class OwnerAbsenceSupervisorStep(BaseModel):
    """The result of one supervisor tick and the snapshot to persist next."""

    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)

    schema_version: Literal["owner-absence-supervisor-v1"] = OWNER_ABSENCE_SUPERVISOR_SCHEMA
    action: SupervisorAction
    previous_state: SupervisorState
    next_snapshot: OwnerAbsenceSupervisorSnapshot
    safety_decision: OwnerAbsenceDecision
    evaluated_at_utc: datetime

    @field_validator("evaluated_at_utc")
    @classmethod
    def validate_evaluated_at(cls, value: datetime) -> datetime:
        return _aware(value, "evaluated_at_utc")


def admit_owner_absence_paper(
    step: OwnerAbsenceSupervisorStep,
    intent: ExecutionIntent,
    capability: AITradeMode,
    budget: RiskBudget | None,
    *,
    active_capability_epoch: str | None,
    now: datetime | None = None,
) -> OwnerAbsencePaperAdmission:
    """Bind a *currently allowed* fenced supervisor step to one paper intent.

    This is the integration boundary between owner-absence lifecycle evidence
    and the paper bridge.  It rechecks the exact execution-intent admission;
    an ``allow`` from the supervisor alone can never substitute for the
    paper-mode capability/risk decision.  The timestamp must match the
    supervisor tick because this function cannot refresh its policy evidence.
    """

    now_value = _aware(now or step.evaluated_at_utc, "now")
    blockers: list[str] = []
    if step.action not in {"start", "continue", "restart"}:
        blockers.append("supervisor_action_not_running")
    if step.previous_state == "quarantined" or step.next_snapshot.state != "running":
        blockers.append("supervisor_not_running")
    if step.safety_decision.decision != "allow":
        blockers.extend(f"supervisor.{reason}" for reason in step.safety_decision.stop_reasons)
    if step.safety_decision.mode != "paper":
        blockers.append("owner_absence_paper_mode_required")
    if step.safety_decision.execution_capability is not False:
        blockers.append("supervisor_execution_capability_must_remain_false")
    if step.next_snapshot.execution_capability is not False:
        blockers.append("supervisor_snapshot_execution_capability_must_remain_false")
    if step.safety_decision.evaluated_at_utc != step.evaluated_at_utc:
        blockers.append("supervisor_provenance_timestamp_mismatch")
    if now_value != step.evaluated_at_utc:
        blockers.append("supervisor_decision_time_mismatch")
    if step.next_snapshot.active_run_id is None or step.next_snapshot.active_fence_token is None:
        blockers.append("supervisor_identity_missing")
    if intent.mode != "paper":
        blockers.append("paper_execution_mode_required")
    if capability.mode != "paper":
        blockers.append("paper_capability_required")

    execution_decision = evaluate_execution_intent(
        intent,
        capability,
        budget,
        active_capability_epoch=active_capability_epoch,
        now=now_value,
    )
    if execution_decision.decision != "allow":
        blockers.extend(f"execution.{blocker}" for blocker in execution_decision.blockers)

    if blockers:
        raise OwnerAbsencePaperAdmissionError(*blockers)

    # The identity fields are known to be present after the checks above; the
    # explicit assertions keep the narrowing visible to type checkers/readers.
    assert step.next_snapshot.active_run_id is not None
    assert step.next_snapshot.active_fence_token is not None
    return OwnerAbsencePaperAdmission(
        run_id=step.next_snapshot.active_run_id,
        fence_token=step.next_snapshot.active_fence_token,
        supervisor_action=step.action,
        intent_id=intent.intent_id,
        intent_fingerprint=execution_intent_fingerprint(intent),
        capability_epoch=intent.capability_epoch,
        risk_budget_hash=intent.risk_budget_hash,
        admitted_at_utc=now_value,
    )


def _decision(
    policy: OwnerAbsencePolicy,
    *,
    reasons: tuple[StopReason, ...],
    now: datetime,
) -> OwnerAbsenceDecision:
    # Rebuild the immutable decision so supervisor-owned fencing reasons are
    # included in the same persisted safety record as freshness failures.
    return OwnerAbsenceDecision.from_policy(policy, stop_reasons=tuple(dict.fromkeys(reasons)), evaluated_at_utc=now)


def _snapshot(
    previous: OwnerAbsenceSupervisorSnapshot,
    *,
    state: SupervisorState,
    identity: SupervisorIdentity | None,
    restart_count: int | None = None,
    stop_reasons: tuple[StopReason, ...] = (),
    now: datetime,
) -> OwnerAbsenceSupervisorSnapshot:
    return OwnerAbsenceSupervisorSnapshot(
        state=state,
        active_run_id=identity.run_id if identity is not None else previous.active_run_id,
        active_fence_token=identity.fence_token if identity is not None else previous.active_fence_token,
        restart_count=previous.restart_count if restart_count is None else restart_count,
        max_restarts=previous.max_restarts,
        last_stop_reasons=stop_reasons,
        last_transition_at_utc=now,
    )


def step_owner_absence_supervisor(
    snapshot: OwnerAbsenceSupervisorSnapshot,
    policy: OwnerAbsencePolicy,
    identity: SupervisorIdentity,
    *,
    now: datetime | None = None,
) -> OwnerAbsenceSupervisorStep:
    """Reduce one owner-absence tick without performing any side effect.

    A stop moves the snapshot to ``recovery_required``.  The next successful
    restart must present a different fence token; reusing the old identity is
    rejected even if the evidence became fresh.  Once the bounded restart
    budget is consumed, the snapshot is quarantined and remains so until a
    separate owner-controlled reset creates a new snapshot.
    """

    now_value = _aware(now or _utc_now(), "now")
    safety = evaluate_owner_absence(policy, now=now_value)
    previous_state = snapshot.state

    if snapshot.state == "quarantined":
        safety = _decision(
            policy,
            reasons=tuple((*safety.stop_reasons, "restart_budget_exhausted")),
            now=now_value,
        )
        next_snapshot = _snapshot(
            snapshot,
            state="quarantined",
            identity=None,
            stop_reasons=safety.stop_reasons,
            now=now_value,
        )
        return OwnerAbsenceSupervisorStep(
            action="quarantine",
            previous_state=previous_state,
            next_snapshot=next_snapshot,
            safety_decision=safety,
            evaluated_at_utc=now_value,
        )

    if safety.decision == "stop":
        reasons = safety.stop_reasons
        exhausted = snapshot.restart_count >= snapshot.max_restarts
        next_state: SupervisorState = "quarantined" if exhausted else "recovery_required"
        if exhausted:
            reasons = tuple((*reasons, "restart_budget_exhausted"))
            safety = _decision(policy, reasons=reasons, now=now_value)
        next_snapshot = _snapshot(
            snapshot,
            state=next_state,
            identity=None,
            stop_reasons=safety.stop_reasons,
            now=now_value,
        )
        return OwnerAbsenceSupervisorStep(
            action="quarantine" if exhausted else "stop",
            previous_state=previous_state,
            next_snapshot=next_snapshot,
            safety_decision=safety,
            evaluated_at_utc=now_value,
        )

    if snapshot.state == "new":
        next_snapshot = _snapshot(snapshot, state="running", identity=identity, now=now_value)
        action: SupervisorAction = "start"
    elif snapshot.state == "running":
        expected = (snapshot.active_run_id, snapshot.active_fence_token)
        observed = (identity.run_id, identity.fence_token)
        if expected != observed:
            safety = _decision(policy, reasons=("fence_mismatch",), now=now_value)
            next_snapshot = _snapshot(
                snapshot,
                state="recovery_required",
                identity=None,
                stop_reasons=safety.stop_reasons,
                now=now_value,
            )
            return OwnerAbsenceSupervisorStep(
                action="stop",
                previous_state=previous_state,
                next_snapshot=next_snapshot,
                safety_decision=safety,
                evaluated_at_utc=now_value,
            )
        next_snapshot = _snapshot(snapshot, state="running", identity=identity, now=now_value)
        action = "continue"
    else:  # recovery_required; the quarantined case returned above.
        if (snapshot.active_run_id, snapshot.active_fence_token) == (identity.run_id, identity.fence_token):
            safety = _decision(policy, reasons=("restart_requires_new_fence",), now=now_value)
            next_snapshot = _snapshot(
                snapshot,
                state="recovery_required",
                identity=None,
                stop_reasons=safety.stop_reasons,
                now=now_value,
            )
            return OwnerAbsenceSupervisorStep(
                action="stop",
                previous_state=previous_state,
                next_snapshot=next_snapshot,
                safety_decision=safety,
                evaluated_at_utc=now_value,
            )
        if snapshot.restart_count >= snapshot.max_restarts:
            safety = _decision(policy, reasons=("restart_budget_exhausted",), now=now_value)
            next_snapshot = _snapshot(
                snapshot,
                state="quarantined",
                identity=None,
                stop_reasons=safety.stop_reasons,
                now=now_value,
            )
            return OwnerAbsenceSupervisorStep(
                action="quarantine",
                previous_state=previous_state,
                next_snapshot=next_snapshot,
                safety_decision=safety,
                evaluated_at_utc=now_value,
            )
        next_snapshot = _snapshot(
            snapshot,
            state="running",
            identity=identity,
            restart_count=snapshot.restart_count + 1,
            now=now_value,
        )
        action = "restart"

    return OwnerAbsenceSupervisorStep(
        action=action,
        previous_state=previous_state,
        next_snapshot=next_snapshot,
        safety_decision=safety,
        evaluated_at_utc=now_value,
    )


__all__ = [
    "OWNER_ABSENCE_PAPER_ADMISSION_SCHEMA",
    "OWNER_ABSENCE_SUPERVISOR_SCHEMA",
    "OwnerAbsencePaperAdmission",
    "OwnerAbsencePaperAdmissionError",
    "OwnerAbsenceSupervisorSnapshot",
    "OwnerAbsenceSupervisorStep",
    "SupervisorAction",
    "SupervisorIdentity",
    "SupervisorState",
    "admit_owner_absence_paper",
    "step_owner_absence_supervisor",
]
