"""Fail-closed risk and strategy-promotion contracts.

This module is intentionally pure.  It does not import a broker, a provider,
an HTTP client, a store, or an execution adapter.  A later paper/demo/live
adapter may consume these contracts, but it cannot bypass the reducer or invent
missing risk evidence.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


RISK_BUDGET_SCHEMA = "risk-budget-v1"
PROMOTION_STATE_SCHEMA = "promotion-state-v1"
PROMOTION_EVENT_SCHEMA = "promotion-event-v1"
PROMOTION_DECISION_SCHEMA = "promotion-decision-v1"
AI_TRADE_MODE_SCHEMA = "ai-trade-mode-v1"

PromotionState = Literal[
    "research",
    "backtest_pass",
    "paper",
    "demo",
    "limited_live",
    "live_monitored",
    "paused",
    "killed",
    "review",
]

KNOWN_PROMOTION_STATES = frozenset(
    {
        "research",
        "backtest_pass",
        "paper",
        "demo",
        "limited_live",
        "live_monitored",
        "paused",
        "killed",
        "review",
    }
)

_EVENT_TARGETS: dict[str, str] = {
    "backtest_passed": "backtest_pass",
    "paper_started": "paper",
    "demo_started": "demo",
    "limited_live_approved": "limited_live",
    "canary_passed": "live_monitored",
    "pause_requested": "paused",
    "kill_switch_triggered": "killed",
    "review_started": "review",
    "research_reopened": "research",
}

_ALLOWED_FROM: dict[str, frozenset[str]] = {
    "backtest_passed": frozenset({"research"}),
    "paper_started": frozenset({"backtest_pass"}),
    "demo_started": frozenset({"paper"}),
    "limited_live_approved": frozenset({"demo"}),
    "canary_passed": frozenset({"limited_live"}),
    "pause_requested": frozenset({"backtest_pass", "paper", "demo", "limited_live", "live_monitored"}),
    "kill_switch_triggered": KNOWN_PROMOTION_STATES - {"killed"},
    "review_started": frozenset({"paused", "killed"}),
    "research_reopened": frozenset({"review"}),
}

_EVIDENCE_REQUIRED_TARGETS = frozenset(
    {"backtest_pass", "paper", "demo", "limited_live", "live_monitored", "research"}
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _dedupe_non_empty(values: tuple[str, ...], field_name: str) -> tuple[str, ...]:
    cleaned = tuple(value.strip() for value in values)
    if any(not value for value in cleaned):
        raise ValueError(f"{field_name} must contain non-empty values")
    if len(set(cleaned)) != len(cleaned):
        raise ValueError(f"{field_name} must be unique")
    return cleaned


def _validate_aware(value: datetime, field_name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must include a timezone")
    return value


class RiskBudget(BaseModel):
    """Immutable per-run risk configuration.

    ``None`` means that a budget is not configured.  It is valid for research
    and paper fixtures, but ``live_blockers`` rejects missing fields before a
    live-capable state can be reached.
    """

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, frozen=True)

    schema_version: Literal["risk-budget-v1"] = RISK_BUDGET_SCHEMA
    currency: str = Field(default="VND", min_length=3, max_length=3)
    capital_scope_vnd: Decimal | None = Field(default=None, ge=Decimal("0"))
    reserve_floor_vnd: Decimal | None = Field(default=None, ge=Decimal("0"))
    risk_per_trade_vnd: Decimal | None = Field(default=None, ge=Decimal("0"))
    max_open_risk_vnd: Decimal | None = Field(default=None, ge=Decimal("0"))
    max_daily_loss_vnd: Decimal | None = Field(default=None, ge=Decimal("0"))
    max_weekly_loss_vnd: Decimal | None = Field(default=None, ge=Decimal("0"))
    max_drawdown_vnd: Decimal | None = Field(default=None, ge=Decimal("0"))
    max_position_notional_vnd: Decimal | None = Field(default=None, ge=Decimal("0"))
    max_turnover_vnd: Decimal | None = Field(default=None, ge=Decimal("0"))
    max_symbol_exposure_pct: Decimal | None = Field(default=None, ge=Decimal("0"), le=Decimal("100"))
    max_strategy_exposure_pct: Decimal | None = Field(default=None, ge=Decimal("0"), le=Decimal("100"))
    max_orders_per_day: int | None = Field(default=None, ge=0, strict=True)
    max_slippage_bps: Decimal | None = Field(default=None, ge=Decimal("0"))
    stale_data_max_seconds: int | None = Field(default=None, gt=0, strict=True)
    allowed_instruments: tuple[str, ...] = ()
    effective_from_utc: datetime | None = None
    expires_at_utc: datetime | None = None
    config_hash: str | None = Field(default=None, min_length=1, max_length=128)
    approved_by: str | None = Field(default=None, min_length=1, max_length=128)

    @field_validator("currency")
    @classmethod
    def validate_currency(cls, value: str) -> str:
        normalized = value.upper()
        if normalized != value:
            raise ValueError("currency must be uppercase")
        return value

    @field_validator("allowed_instruments")
    @classmethod
    def validate_allowed_instruments(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        return _dedupe_non_empty(value, "allowed_instruments")

    @field_validator("effective_from_utc", "expires_at_utc")
    @classmethod
    def validate_budget_time(cls, value: datetime | None, info) -> datetime | None:
        return None if value is None else _validate_aware(value, str(info.field_name))

    @model_validator(mode="after")
    def validate_budget_relationships(self) -> RiskBudget:
        if self.reserve_floor_vnd is not None and self.capital_scope_vnd is not None:
            if self.reserve_floor_vnd > self.capital_scope_vnd:
                raise ValueError("reserve_floor_vnd cannot exceed capital_scope_vnd")
        if self.risk_per_trade_vnd is not None and self.max_open_risk_vnd is not None:
            if self.risk_per_trade_vnd > self.max_open_risk_vnd:
                raise ValueError("risk_per_trade_vnd cannot exceed max_open_risk_vnd")
        if self.effective_from_utc is not None and self.expires_at_utc is not None:
            if self.expires_at_utc <= self.effective_from_utc:
                raise ValueError("expires_at_utc must be after effective_from_utc")
        return self

    def live_blockers(self, now: datetime | None = None) -> tuple[str, ...]:
        """Return stable blockers; an empty tuple means structurally ready.

        This is a readiness check only.  It does not authorize a broker or an
        account.  The caller still needs a transition event with owner approval.
        """

        required = (
            "capital_scope_vnd",
            "reserve_floor_vnd",
            "risk_per_trade_vnd",
            "max_open_risk_vnd",
            "max_daily_loss_vnd",
            "max_weekly_loss_vnd",
            "max_drawdown_vnd",
            "max_position_notional_vnd",
            "max_turnover_vnd",
            "max_symbol_exposure_pct",
            "max_strategy_exposure_pct",
            "max_orders_per_day",
            "max_slippage_bps",
            "stale_data_max_seconds",
            "config_hash",
            "approved_by",
        )
        blockers = [field for field in required if getattr(self, field) is None]
        if not self.allowed_instruments:
            blockers.append("allowed_instruments")
        now_value = _validate_aware(now or _utc_now(), "now")
        if self.effective_from_utc is None:
            blockers.append("effective_from_utc")
        elif self.effective_from_utc > now_value:
            blockers.append("budget_not_yet_effective")
        if self.expires_at_utc is None:
            blockers.append("expires_at_utc")
        elif self.expires_at_utc <= now_value:
            blockers.append("budget_expired")
        return tuple(blockers)

    def is_live_ready(self, now: datetime | None = None) -> bool:
        return not self.live_blockers(now)


class AITradeMode(BaseModel):
    """Explicit AI execution capability; default is deny-only.

    ``paper`` permits only a paper adapter and ``live`` permits a live adapter
    after all scope, budget, expiry, reconciliation and owner gates pass.  The
    capability is a separate contract from strategy promotion so an AI answer
    cannot infer execution permission from a strategy state alone.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal["ai-trade-mode-v1"] = AI_TRADE_MODE_SCHEMA
    mode: Literal["configured_deny", "paper", "live"] = "configured_deny"
    account_id: str | None = Field(default=None, min_length=1, max_length=128)
    allowed_symbols: tuple[str, ...] = ()
    allowed_actions: tuple[str, ...] = ()
    risk_budget_hash: str | None = Field(default=None, min_length=1, max_length=128)
    effective_from_utc: datetime | None = None
    expires_at_utc: datetime | None = None
    kill_switch_active: bool = True
    reconciliation_required: Literal[True] = True
    reconciliation_state: Literal["unknown", "ready", "blocked"] = "unknown"
    owner_approved: bool = False

    @field_validator("allowed_symbols", "allowed_actions")
    @classmethod
    def validate_scope_lists(cls, value: tuple[str, ...], info) -> tuple[str, ...]:
        return _dedupe_non_empty(value, str(info.field_name))

    @field_validator("effective_from_utc", "expires_at_utc")
    @classmethod
    def validate_capability_time(cls, value: datetime | None, info) -> datetime | None:
        return None if value is None else _validate_aware(value, str(info.field_name))

    @model_validator(mode="after")
    def validate_capability_relationships(self) -> AITradeMode:
        if self.effective_from_utc is not None and self.expires_at_utc is not None:
            if self.expires_at_utc <= self.effective_from_utc:
                raise ValueError("expires_at_utc must be after effective_from_utc")
        return self

    def readiness_blockers(self, budget: RiskBudget | None, now: datetime | None = None) -> tuple[str, ...]:
        """Check capability completeness without selecting an order scope."""

        if self.mode == "configured_deny":
            return ("ai_trade_mode_configured_deny",)
        blockers: list[str] = []
        if self.account_id is None:
            blockers.append("account_scope_missing")
        if not self.allowed_symbols:
            blockers.append("symbol_scope_missing")
        if not self.allowed_actions:
            blockers.append("action_scope_missing")
        if self.kill_switch_active:
            blockers.append("kill_switch_active")
        if self.reconciliation_required and self.reconciliation_state != "ready":
            blockers.append("reconciliation_not_ready")
        if budget is None:
            blockers.append("risk_budget_missing")
        else:
            blockers.extend(f"risk_budget.{item}" for item in budget.live_blockers(now))
            if self.risk_budget_hash is None:
                blockers.append("risk_budget_hash_missing")
            elif self.risk_budget_hash != budget.config_hash:
                blockers.append("risk_budget_hash_mismatch")
        now_value = _validate_aware(now or _utc_now(), "now")
        if self.effective_from_utc is None:
            blockers.append("ai_mode_effective_from_missing")
        elif self.effective_from_utc > now_value:
            blockers.append("ai_mode_not_yet_effective")
        if self.expires_at_utc is None:
            blockers.append("ai_mode_expiry_missing")
        elif self.expires_at_utc <= now_value:
            blockers.append("ai_mode_expired")
        if self.mode == "live" and not self.owner_approved:
            blockers.append("ai_mode_owner_approval_required")
        return tuple(dict.fromkeys(blockers))

    def execution_blockers(
        self,
        *,
        adapter_mode: Literal["paper", "live"],
        account_id: str | None,
        symbol: str | None,
        action: str | None,
        budget: RiskBudget | None,
        now: datetime | None = None,
    ) -> tuple[str, ...]:
        """Check a concrete adapter request against this capability."""

        blockers = list(self.readiness_blockers(budget, now))
        if self.mode != adapter_mode:
            blockers.append("adapter_mode_not_allowed")
        if account_id is None or account_id != self.account_id:
            blockers.append("account_scope_mismatch")
        if symbol is None or symbol not in self.allowed_symbols:
            blockers.append("symbol_scope_mismatch")
        if action is None or action not in self.allowed_actions:
            blockers.append("action_scope_mismatch")
        return tuple(dict.fromkeys(blockers))


class PromotionSnapshot(BaseModel):
    """Versioned state for one strategy, sleeve or account scope."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal["promotion-state-v1"] = PROMOTION_STATE_SCHEMA
    strategy_id: str = Field(min_length=1, max_length=128)
    strategy_version: str = Field(min_length=1, max_length=128)
    state: PromotionState = "research"
    revision: int = Field(default=0, ge=0, strict=True)
    holdout_locked: Literal[True] = True
    evidence_refs: tuple[str, ...] = ()
    risk_budget: RiskBudget | None = None
    ai_trade_mode: AITradeMode = Field(default_factory=AITradeMode)
    blocked_reason: str | None = Field(default=None, max_length=500)
    updated_at_utc: datetime = Field(default_factory=_utc_now)

    @field_validator("evidence_refs")
    @classmethod
    def validate_evidence_refs(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        return _dedupe_non_empty(value, "evidence_refs")

    @field_validator("updated_at_utc")
    @classmethod
    def validate_snapshot_time(cls, value: datetime) -> datetime:
        return _validate_aware(value, "updated_at_utc")


class PromotionEvent(BaseModel):
    """An auditable request to move a promotion state."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal["promotion-event-v1"] = PROMOTION_EVENT_SCHEMA
    event_type: Literal[
        "backtest_passed",
        "paper_started",
        "demo_started",
        "limited_live_approved",
        "canary_passed",
        "pause_requested",
        "kill_switch_triggered",
        "review_started",
        "research_reopened",
    ]
    actor: str = Field(min_length=1, max_length=128)
    reason: str = Field(min_length=1, max_length=2_000)
    evidence_refs: tuple[str, ...] = ()
    owner_approved: bool = False
    risk_budget_hash: str | None = Field(default=None, min_length=1, max_length=128)
    request_id: str = Field(min_length=1, max_length=128)
    at_utc: datetime = Field(default_factory=_utc_now)

    @field_validator("evidence_refs")
    @classmethod
    def validate_event_evidence(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        return _dedupe_non_empty(value, "evidence_refs")

    @field_validator("at_utc")
    @classmethod
    def validate_event_time(cls, value: datetime) -> datetime:
        return _validate_aware(value, "at_utc")


class PromotionDecision(BaseModel):
    """A fail-closed decision projection, never an execution permission."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal["promotion-decision-v1"] = PROMOTION_DECISION_SCHEMA
    decision: Literal["allow", "deny"] = "deny"
    target_state: PromotionState
    blockers: tuple[str, ...] = ()
    evidence_refs: tuple[str, ...] = ()
    evaluated_at_utc: datetime = Field(default_factory=_utc_now)

    @field_validator("blockers", "evidence_refs")
    @classmethod
    def validate_decision_lists(cls, value: tuple[str, ...], info) -> tuple[str, ...]:
        return _dedupe_non_empty(value, str(info.field_name))

    @field_validator("evaluated_at_utc")
    @classmethod
    def validate_decision_time(cls, value: datetime) -> datetime:
        return _validate_aware(value, "evaluated_at_utc")

    @model_validator(mode="after")
    def enforce_fail_closed_decision(self) -> PromotionDecision:
        if self.decision == "allow" and self.blockers:
            raise ValueError("an allowed decision cannot contain blockers")
        if self.decision == "deny" and not self.blockers:
            raise ValueError("a denied decision must explain its blockers")
        return self


class PromotionTransitionError(ValueError):
    """Raised when a state transition is not safe or not allowed."""

    def __init__(self, *blockers: str):
        self.blockers = tuple(blockers) or ("promotion_transition_denied",)
        super().__init__(", ".join(self.blockers))


def _target_for_event(event_type: str) -> str:
    target = _EVENT_TARGETS.get(event_type)
    if target is None or target not in KNOWN_PROMOTION_STATES:
        raise PromotionTransitionError("unknown_event_or_target")
    return target


def _transition_blockers(snapshot: PromotionSnapshot, event: PromotionEvent, target: str) -> tuple[str, ...]:
    blockers: list[str] = []
    if snapshot.state not in KNOWN_PROMOTION_STATES:
        blockers.append("unknown_current_state")
    if snapshot.state not in _ALLOWED_FROM.get(event.event_type, frozenset()):
        blockers.append("illegal_transition")
    if event.at_utc < snapshot.updated_at_utc:
        blockers.append("stale_event")
    if target in _EVIDENCE_REQUIRED_TARGETS and not (snapshot.evidence_refs or event.evidence_refs):
        blockers.append("evidence_required")
    if target == "paper":
        if snapshot.ai_trade_mode.mode != "paper":
            blockers.append("ai_trade_mode_paper_required")
        blockers.extend(
            f"ai_trade_mode.{item}"
            for item in snapshot.ai_trade_mode.readiness_blockers(snapshot.risk_budget, event.at_utc)
        )
    if target in {"limited_live", "live_monitored"}:
        if not event.owner_approved:
            blockers.append("owner_approval_required")
        if snapshot.ai_trade_mode.mode != "live":
            blockers.append("ai_trade_mode_live_required")
        blockers.extend(
            f"ai_trade_mode.{item}"
            for item in snapshot.ai_trade_mode.readiness_blockers(snapshot.risk_budget, event.at_utc)
        )
        if snapshot.risk_budget is not None and event.risk_budget_hash:
            if event.risk_budget_hash != snapshot.risk_budget.config_hash:
                blockers.append("risk_budget_hash_mismatch")
        else:
            blockers.append("risk_budget_hash_required")
    return tuple(dict.fromkeys(blockers))


def evaluate_promotion(snapshot: PromotionSnapshot, event: PromotionEvent) -> PromotionDecision:
    """Evaluate a transition without mutating state or calling external systems."""

    now = event.at_utc
    try:
        target = _target_for_event(event.event_type)
        blockers = _transition_blockers(snapshot, event, target)
    except PromotionTransitionError as exc:
        # An unknown/malformed event must never be interpreted as a state name.
        # The safe projection is deny + killed; no mutation happens here.
        target = "killed"
        blockers = exc.blockers
    if blockers:
        return PromotionDecision(
            decision="deny",
            target_state=target,  # type: ignore[arg-type]
            blockers=blockers,
            evidence_refs=event.evidence_refs,
            evaluated_at_utc=now,
        )
    return PromotionDecision(
        decision="allow",
        target_state=target,  # type: ignore[arg-type]
        evidence_refs=tuple(dict.fromkeys(snapshot.evidence_refs + event.evidence_refs)),
        evaluated_at_utc=now,
    )


def reduce_promotion(snapshot: PromotionSnapshot, event: PromotionEvent) -> PromotionSnapshot:
    """Apply one allowed event; reject every unsafe/unknown case."""

    decision = evaluate_promotion(snapshot, event)
    if decision.decision != "allow":
        raise PromotionTransitionError(*decision.blockers)
    return snapshot.model_copy(
        update={
            "state": decision.target_state,
            "revision": snapshot.revision + 1,
            "evidence_refs": decision.evidence_refs,
            "blocked_reason": None,
            "updated_at_utc": event.at_utc,
        }
    )


def fail_closed_decision(target_state: object, *, reason: str = "unknown_or_invalid_state") -> PromotionDecision:
    """Construct a safe deny projection for untrusted/unknown input.

    This helper deliberately returns ``killed`` for an unknown target, but it
    does not mutate a snapshot or perform a kill action.  The caller must record
    the decision and use the normal review/re-enable workflow.
    """

    safe_target = (
        target_state
        if isinstance(target_state, str) and target_state in KNOWN_PROMOTION_STATES
        else "killed"
    )
    return PromotionDecision(
        decision="deny",
        target_state=safe_target,  # type: ignore[arg-type]
        blockers=(reason,),
    )
