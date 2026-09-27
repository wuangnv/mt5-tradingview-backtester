"""Provider-neutral strategy research metadata contracts.

The engine currently executes the deterministic ``bar-breakout-v1`` ruleset.
This contract lets the research workspace capture ICT, SMC, and price-action
hypotheses before an executable rule engine exists.  It deliberately keeps
methodology metadata outside ``rules`` so an unsupported idea cannot be
mistaken for an engine-supported playbook.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


STRATEGY_RESEARCH_SCHEMA = "strategy-research-spec-v1"


class StrategyEvaluationSpec(BaseModel):
    """Evaluation guardrails pinned with a strategy hypothesis."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["research-evaluation-v1"] = "research-evaluation-v1"
    split_policy: Literal["baseline_only", "chronological_oos"] = "chronological_oos"
    holdout_access: Literal[False] = False
    cost_model_required: bool = True
    stress_test_required: bool = True
    walk_forward_required: bool = True
    required_metrics: list[str] = Field(
        default_factory=lambda: [
            "trade_count",
            "net_pnl",
            "expectancy",
            "max_drawdown",
            "profit_factor",
        ],
        min_length=1,
    )

    @field_validator("required_metrics")
    @classmethod
    def unique_metric_names(cls, value: list[str]) -> list[str]:
        if any(not isinstance(item, str) or not item.strip() for item in value):
            raise ValueError("required_metrics must contain non-empty names")
        if len(set(value)) != len(value):
            raise ValueError("required_metrics must be unique")
        return value

    @model_validator(mode="after")
    def require_oos_for_edge_claims(self):
        if self.split_policy == "chronological_oos" and not self.walk_forward_required:
            raise ValueError("chronological_oos requires walk_forward_required")
        return self


class StrategyResearchSpec(BaseModel):
    """A versioned, non-executable strategy hypothesis.

    ``edge_status`` is evidence language only.  A status other than
    ``unproven`` must point at durable evidence; this does not turn that
    evidence into a production or live-trading authorization.
    """

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["strategy-research-spec-v1"] = STRATEGY_RESEARCH_SCHEMA
    family: Literal["price_action", "ict", "smc"]
    label: str = Field(min_length=1, max_length=160)
    methodology_version: str = Field(min_length=1, max_length=128)
    hypothesis: str = Field(min_length=1, max_length=10_000)
    definition_mode: Literal["hypothesis", "deterministic"] = "hypothesis"
    execution_capability: Literal["manual-only", "engine-supported", "needs-definition"] = "needs-definition"
    entry_definition: str = Field(min_length=1, max_length=10_000)
    exit_definition: str = Field(min_length=1, max_length=10_000)
    invalidation_definition: str = Field(min_length=1, max_length=10_000)
    signal_features: list[str] = Field(default_factory=list, max_length=64)
    edge_status: Literal["unproven", "software_only", "empirical_pending", "validated_with_evidence"] = "unproven"
    evidence_refs: list[str] = Field(default_factory=list, max_length=64)
    evaluation: StrategyEvaluationSpec = Field(default_factory=StrategyEvaluationSpec)

    @model_validator(mode="after")
    def enforce_capability_and_evidence_boundaries(self):
        if self.execution_capability == "engine-supported" and self.definition_mode != "deterministic":
            raise ValueError("engine-supported strategy specs require deterministic definitions")
        if self.edge_status != "unproven" and not self.evidence_refs:
            raise ValueError("non-unproven edge status requires evidence_refs")
        return self
