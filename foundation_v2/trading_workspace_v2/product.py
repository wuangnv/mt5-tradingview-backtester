from __future__ import annotations

from .contracts import ChartAnnotationDraft, JournalDraft, PlaybookDraft
from .retained import (
    AIService,
    CostModel,
    InstrumentSpec,
    OfflineProvider,
    calculate_round_trip_cost,
    evaluate_prop_profile,
    visible_events,
)
from .store import PostgresStore


class ProductService:
    def __init__(self, store: PostgresStore, ai_service=None):
        self.store = store
        self.ai = ai_service or AIService(OfflineProvider(), enabled_jobs=set())

    def list_datasets(self, workspace_id: str) -> list[dict]:
        result = []
        for manifest in self.store.list_datasets(workspace_id):
            result.append(
                {
                    **manifest.model_dump(mode="json"),
                    "quality_status": "fixture-only" if manifest.source.license_use == "qa-only" else "unverified",
                    "holdout_access": False,
                }
            )
        return result

    @staticmethod
    def validate_instrument(payload: dict) -> dict:
        instrument = InstrumentSpec.from_mapping(payload)
        return {
            "instrument_id": instrument.instrument_id,
            "asset_class": instrument.asset_class,
            "base_ccy": instrument.base_ccy,
            "quote_ccy": instrument.quote_ccy,
            "account_ccy": instrument.account_ccy,
            "tick_size": float(instrument.tick_size),
            "pip_size": float(instrument.pip_size),
            "contract_size": float(instrument.contract_size),
            "quantity_min": float(instrument.quantity_min),
            "quantity_step": float(instrument.quantity_step),
            "effective_from_utc": instrument.effective_from_utc,
            "effective_to_utc": instrument.effective_to_utc,
        }

    @staticmethod
    def preview_cost(payload: dict) -> dict:
        model = CostModel.from_mapping(payload["cost_model"])
        return calculate_round_trip_cost(
            model,
            payload["side"],
            payload["quantity"],
            payload["contract_size"],
            payload["entry_bid"],
            payload["entry_ask"],
            payload["exit_bid"],
            payload["exit_ask"],
        )

    @staticmethod
    def visible_news(payload: dict) -> dict:
        items = visible_events(
            payload["events"],
            payload["decision_time_utc"],
            allow_archive_proxy=payload["allow_archive_proxy"],
        )
        return {
            "decision_time_utc": payload["decision_time_utc"],
            "allow_archive_proxy": payload["allow_archive_proxy"],
            "items": items,
            "point_in_time_warning": any(item["point_in_time_status"] == "archive_proxy" for item in items),
        }

    @staticmethod
    def evaluate_prop(payload: dict) -> dict:
        return evaluate_prop_profile(payload["profile"], payload["snapshot"])

    def create_playbook(self, workspace_id: str, draft: PlaybookDraft) -> dict:
        return self.store.create_record(workspace_id, "playbook", draft.model_dump(mode="json"))

    def update_playbook(self, workspace_id: str, record_id: str, expected_revision: int, payload: dict) -> dict:
        validated = PlaybookDraft.model_validate(payload)
        return self.store.update_record(
            workspace_id, "playbook", record_id, expected_revision, validated.model_dump(mode="json")
        )

    def create_journal(self, workspace_id: str, draft: JournalDraft) -> dict:
        source = draft.source
        source_key = f"{source['kind']}:{source['id']}"
        return self.store.create_record(
            workspace_id,
            "journal",
            draft.model_dump(mode="json"),
            source_key=source_key,
        )

    def update_journal(self, workspace_id: str, record_id: str, expected_revision: int, payload: dict) -> dict:
        validated = JournalDraft.model_validate(payload)
        return self.store.update_record(
            workspace_id, "journal", record_id, expected_revision, validated.model_dump(mode="json")
        )

    def create_annotation(self, workspace_id: str, draft: ChartAnnotationDraft) -> dict:
        return self.store.create_record(workspace_id, "annotation", draft.model_dump(mode="json"))

    def update_annotation(self, workspace_id: str, record_id: str, expected_revision: int, payload: dict) -> dict:
        validated = ChartAnnotationDraft.model_validate(payload)
        return self.store.update_record(
            workspace_id, "annotation", record_id, expected_revision, validated.model_dump(mode="json")
        )

    def overview(self, workspace_id: str) -> dict:
        return {
            "counts": self.store.overview_counts(workspace_id),
            "ai": self.ai.status(),
            "execution": self.execution_capabilities(),
            "blocked_reasons": [
                "u1_owner_visual_approval",
                "real_data_qa",
                "real_ai_provider_approval",
                "demo_broker_acceptance",
                "live_execution_authorization",
                "miro_update_permission",
            ],
        }

    @staticmethod
    def execution_capabilities() -> dict:
        return {
            "mode": "locked",
            "preview": False,
            "place": False,
            "modify": False,
            "cancel": False,
            "close": False,
            "broker_execution_capability": False,
            "reason": "F7 foundation software slice has no broker execution authority",
        }
