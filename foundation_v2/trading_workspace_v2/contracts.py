from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


CONTRACT_VERSION = "foundation-v2.1"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class DatasetSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str = Field(min_length=1)
    provider: str = Field(min_length=1)
    instrument_mapping: dict[str, str]
    license_use: str = Field(min_length=1)
    retrieved_at_utc: str = Field(min_length=1)
    export_settings: str = Field(min_length=1)

    @field_validator("instrument_mapping")
    @classmethod
    def non_empty_mapping(cls, value: dict[str, str]) -> dict[str, str]:
        if not value:
            raise ValueError("instrument_mapping must not be empty")
        return value


class DatasetManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: str = CONTRACT_VERSION
    dataset_id: str
    workspace_id: str
    source: DatasetSource
    instrument_id: str
    timeframe: str
    row_count: int = Field(ge=2)
    first_timestamp: int
    last_timestamp: int
    artifact_path: str
    artifact_sha256: str
    raw_artifact_path: str | None = None
    raw_sha256: str | None = None
    normalized_sha256: str | None = None
    instrument_spec: dict | None = None
    timeframe_seconds: int | None = Field(default=None, gt=0)
    available_range: dict | None = None
    quality: dict = Field(default_factory=dict)
    holdout_policy: dict = Field(default_factory=lambda: {"mode": "none"})
    transform_version: str | None = None
    created_at_utc: str


class CreateResearchJob(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dataset_id: str = Field(min_length=1)
    strategy_version: Literal["close-delta-v1"] = "close-delta-v1"
    starting_balance: float = Field(gt=0)


class CreateEngineResearchJob(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    dataset_id: str = Field(min_length=1)
    playbook_id: str = Field(min_length=1, max_length=128)
    playbook_revision: int = Field(ge=1, strict=True)
    starting_balance: float = Field(gt=0)
    data_from_utc: int = Field(ge=0, strict=True)
    data_to_utc: int = Field(gt=0, strict=True)
    split: Literal["baseline", "train", "validation"] = "baseline"
    engine_backend: Literal["nautilus", "reference"] = "nautilus"
    seed: int = 0
    spread_price: float = Field(default=0.0, ge=0)
    cost_model: dict
    research_leverage: float | None = Field(default=None, ge=1, le=1000)
    max_bars: int = Field(default=100_000, ge=2, le=1_000_000, strict=True)
    max_runtime_ms: int = Field(default=30_000, ge=100, le=600_000, strict=True)
    max_memory_mb: int = Field(default=1024, ge=256, le=4096, strict=True)


class ResearchJobView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: str = CONTRACT_VERSION
    job_id: str
    workspace_id: str
    dataset_id: str
    strategy_version: str
    starting_balance: float
    protocol_sha256: str | None = None
    protocol: dict | None = None
    status: Literal["queued", "running", "completed", "failed", "canceled"]
    cancel_requested: bool = False
    result_path: str | None = None
    result_sha256: str | None = None
    error_code: str | None = None
    created_at_utc: str
    updated_at_utc: str


class ResearchResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: str = CONTRACT_VERSION
    job_id: str
    workspace_id: str
    dataset_id: str
    dataset_sha256: str
    strategy_version: str
    metrics_schema_version: str
    metrics: dict
    trade_count: int
    created_at_utc: str


class EngineResearchResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    artifact_schema_version: Literal["research-engine-result-v1"] = "research-engine-result-v1"
    contract_version: str = CONTRACT_VERSION
    job_id: str
    workspace_id: str
    dataset_id: str
    dataset_sha256: str
    protocol_sha256: str
    protocol: dict
    playbook_id: str
    playbook_revision: int
    engine_version: Literal["bar-breakout-v1"] = "bar-breakout-v1"
    engine_code_sha256: str
    split: Literal["baseline", "train", "validation"]
    assumptions: dict
    signals: dict
    ledger: list[dict]
    metrics: dict
    observed_range: dict
    execution: dict = Field(default_factory=dict)
    created_at_utc: str


class PlaybookDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=160)
    status: Literal["draft", "frozen"] = "draft"
    execution_capability: Literal["manual-only", "engine-supported", "needs-definition"]
    rules: dict
    parent_playbook_id: str | None = Field(default=None, max_length=128)
    parent_revision: int | None = Field(default=None, ge=1)


class PlaybookFreezeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=1)


class PlaybookForkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=1)
    name: str | None = Field(default=None, min_length=1, max_length=160)
    execution_capability: Literal["manual-only", "engine-supported", "needs-definition"] | None = None
    rules: dict | None = None


class JournalDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entry_type: Literal["observation", "hypothesis", "decision", "no-trade", "missed-trade"]
    note: str = Field(min_length=1, max_length=10_000)
    source: dict
    tags: list[str] = Field(default_factory=list, max_length=32)

    @field_validator("source")
    @classmethod
    def source_has_identity(cls, value: dict) -> dict:
        if not str(value.get("kind") or "").strip() or not str(value.get("id") or "").strip():
            raise ValueError("source requires kind and id")
        return value


class ChartAnnotationDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    annotation_type: Literal["horizontal-line", "zone", "trendline", "text", "arrow", "entry", "sl", "tp"]
    instrument_id: str = Field(min_length=1, max_length=64)
    timeframe: str = Field(min_length=1, max_length=32)
    cutoff_timestamp: int
    anchors: list[dict] = Field(min_length=1, max_length=8)
    source: str = Field(min_length=1, max_length=64)
    run_id: str | None = Field(default=None, max_length=128)
    rule_version: str | None = Field(default=None, max_length=128)
    label: str | None = Field(default=None, max_length=256)

    @field_validator("anchors")
    @classmethod
    def anchors_respect_cutoff(cls, value: list[dict], info) -> list[dict]:
        cutoff = info.data.get("cutoff_timestamp")
        for anchor in value:
            if "timestamp" not in anchor or "price" not in anchor:
                raise ValueError("each anchor requires timestamp and price")
            try:
                timestamp = int(anchor["timestamp"])
                float(anchor["price"])
            except (TypeError, ValueError) as exc:
                raise ValueError("anchor timestamp/price must be numeric") from exc
            if cutoff is not None and timestamp > int(cutoff):
                raise ValueError("annotation anchor exceeds replay cutoff")
        return value


class RevisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=1)
    payload: dict


class AIRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job: Literal["playbook_search", "research_rule_draft", "journal_review", "chart_overlay"]
    context_version: str = Field(min_length=1, max_length=128)
    context_hash: str | None = Field(default=None, max_length=128)
    state: dict


class ReplayCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dataset_id: str = Field(min_length=1)
    start_index: int = Field(default=0, ge=0)


class ReplayStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=1)
    steps: int = Field(default=1, ge=1, le=1000)


class ReplayBranch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=1)
    cursor_index: int = Field(ge=0)


class InstrumentValidationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    instrument: dict


class CostPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cost_model: dict
    side: Literal["BUY", "SELL", "buy", "sell"]
    quantity: float = Field(gt=0)
    contract_size: float = Field(gt=0)
    entry_bid: float = Field(gt=0)
    entry_ask: float = Field(gt=0)
    exit_bid: float = Field(gt=0)
    exit_ask: float = Field(gt=0)


class NewsVisibilityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    events: list[dict] = Field(max_length=10_000)
    decision_time_utc: int
    allow_archive_proxy: bool = False


class PropEvaluationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    profile: dict
    snapshot: dict
