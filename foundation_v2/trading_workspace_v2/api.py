from __future__ import annotations

import os
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from psycopg.errors import UniqueViolation
from pydantic import ValidationError

from .auth import LocalWorkspaceAuthorization, MissingTrustedIdentity, WorkspaceMembershipDenied
from .artifacts import ArtifactStore
from .contracts import (
    AIRequest,
    CONTRACT_VERSION,
    ChartAnnotationDraft,
    CostPreviewRequest,
    CreateResearchJob,
    InstrumentValidationRequest,
    JournalDraft,
    NewsVisibilityRequest,
    PlaybookDraft,
    PlaybookForkRequest,
    PlaybookFreezeRequest,
    PropEvaluationRequest,
    ReplayBranch,
    ReplayCreate,
    ReplayStep,
    RevisionRequest,
)
from .data_sources import DataProviderRegistry, LocalCatalogProvider
from .product import JournalSourceImmutableError, PlaybookFrozenError, PlaybookLineageError, ProductService
from .replay import ReplayService
from .research import ResearchService
from .retained import AIInvalidRequest, DataContractError, PropProfileValidationError
from .store import PostgresStore


def workspace_id(request: Request, x_workspace_id: str = Header(..., min_length=1)) -> str:
    requested_workspace = x_workspace_id.strip()
    try:
        context = request.app.state.authorization.authorize(requested_workspace)
    except MissingTrustedIdentity as exc:
        raise HTTPException(status_code=401, detail="trusted_identity_missing") from exc
    except WorkspaceMembershipDenied as exc:
        raise HTTPException(status_code=403, detail="workspace_access_denied") from exc
    return context.workspace_id


def create_app(
    *,
    dsn: str | None = None,
    artifact_root: str | Path | None = None,
    ai_service=None,
    authorization: LocalWorkspaceAuthorization | None = None,
    data_registry: DataProviderRegistry | None = None,
) -> FastAPI:
    dsn = dsn or os.environ["TW_V2_DATABASE_URL"]
    artifact_root = artifact_root or os.environ["TW_V2_ARTIFACT_ROOT"]
    store = PostgresStore(dsn)
    store.initialize()
    artifacts = ArtifactStore(artifact_root)
    service = ResearchService(store, artifacts)
    replay = ReplayService(store, artifacts)
    product = ProductService(store, ai_service=ai_service)
    data_registry = data_registry or DataProviderRegistry([LocalCatalogProvider(store)])

    if authorization is None:
        with store.connect() as conn:
            existing_workspaces = [row["workspace_id"] for row in conn.execute("SELECT workspace_id FROM workspaces")]
        configured_workspaces = os.getenv("TW_V2_LOCAL_WORKSPACES")
        if configured_workspaces is not None:
            existing_workspaces = [item.strip() for item in configured_workspaces.split(",") if item.strip()]
        authorization = LocalWorkspaceAuthorization.for_local_owner(
            existing_workspaces,
            identity_id=os.getenv("TW_V2_LOCAL_IDENTITY", "local-owner"),
        )

    app = FastAPI(title="Trading Workspace Foundation v2", version=CONTRACT_VERSION)
    app.state.store = store
    app.state.service = service
    app.state.product = product
    app.state.replay = replay
    app.state.data_registry = data_registry
    app.state.authorization = authorization

    @app.get("/health")
    def health():
        return {
            "ok": True,
            "contract_version": CONTRACT_VERSION,
            "execution_capability": False,
            "authorization": authorization.status(),
        }

    @app.get("/api/v2/overview")
    def get_overview(workspace: str = Depends(workspace_id)):
        return product.overview(workspace)

    @app.get("/api/v2/data/datasets")
    def list_datasets(workspace: str = Depends(workspace_id)):
        return {"items": data_registry.list_datasets(workspace), "holdout_access": False}

    @app.get("/api/v2/data/providers")
    def list_data_providers(workspace: str = Depends(workspace_id)):
        return {"items": data_registry.capabilities()}

    @app.post("/api/v2/data/instruments/validate")
    def validate_instrument(body: InstrumentValidationRequest, workspace: str = Depends(workspace_id)):
        store.ensure_workspace(workspace)
        try:
            return product.validate_instrument(body.instrument)
        except DataContractError as exc:
            raise HTTPException(status_code=422, detail=str(exc))

    @app.post("/api/v2/data/cost-preview")
    def preview_cost(body: CostPreviewRequest, workspace: str = Depends(workspace_id)):
        store.ensure_workspace(workspace)
        try:
            return product.preview_cost(body.model_dump(mode="json"))
        except DataContractError as exc:
            raise HTTPException(status_code=422, detail=str(exc))

    @app.post("/api/v2/data/news/visible")
    def get_visible_news(body: NewsVisibilityRequest, workspace: str = Depends(workspace_id)):
        store.ensure_workspace(workspace)
        try:
            return product.visible_news(body.model_dump(mode="json"))
        except DataContractError as exc:
            raise HTTPException(status_code=422, detail=str(exc))

    @app.post("/api/v2/analytics/prop/evaluate")
    def evaluate_prop(body: PropEvaluationRequest, workspace: str = Depends(workspace_id)):
        store.ensure_workspace(workspace)
        try:
            return product.evaluate_prop(body.model_dump(mode="json"))
        except PropProfileValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc))

    @app.post("/api/v2/research/jobs", status_code=202)
    def create_research_job(body: CreateResearchJob, workspace: str = Depends(workspace_id)):
        try:
            job = service.create_job(
                workspace_id=workspace,
                dataset_id=body.dataset_id,
                strategy_version=body.strategy_version,
                starting_balance=body.starting_balance,
            )
        except LookupError:
            raise HTTPException(status_code=404, detail="dataset_not_found")
        return job.model_dump(mode="json")

    @app.get("/api/v2/research/jobs/{job_id}")
    def get_research_job(job_id: str, workspace: str = Depends(workspace_id)):
        job = store.get_job(workspace, job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="job_not_found")
        payload = job.model_dump(mode="json")
        if job.status == "completed":
            payload["result"] = service.get_result(workspace, job_id)
        return payload

    @app.post("/api/v2/research/jobs/{job_id}/cancel")
    def cancel_research_job(job_id: str, workspace: str = Depends(workspace_id)):
        job = service.cancel_job(workspace, job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="job_not_found")
        return job.model_dump(mode="json")

    @app.post("/api/v2/replay/sessions", status_code=201)
    def create_replay(body: ReplayCreate, workspace: str = Depends(workspace_id)):
        try:
            return replay.create(workspace, body.dataset_id, body.start_index)
        except LookupError:
            raise HTTPException(status_code=404, detail="dataset_not_found")
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))

    @app.get("/api/v2/replay/sessions/{session_id}")
    def get_replay(session_id: str, workspace: str = Depends(workspace_id)):
        try:
            return replay.view(workspace, session_id)
        except LookupError:
            raise HTTPException(status_code=404, detail="replay_not_found")

    @app.post("/api/v2/replay/sessions/{session_id}/step")
    def step_replay(session_id: str, body: ReplayStep, workspace: str = Depends(workspace_id)):
        try:
            return replay.step(workspace, session_id, body.expected_revision, body.steps)
        except LookupError:
            raise HTTPException(status_code=404, detail="replay_not_found")
        except RuntimeError:
            raise HTTPException(status_code=409, detail="revision_conflict")

    @app.post("/api/v2/replay/sessions/{session_id}/branch", status_code=201)
    def branch_replay(session_id: str, body: ReplayBranch, workspace: str = Depends(workspace_id)):
        try:
            return replay.branch(workspace, session_id, body.expected_revision, body.cursor_index)
        except LookupError:
            raise HTTPException(status_code=404, detail="replay_not_found")
        except RuntimeError:
            raise HTTPException(status_code=409, detail="revision_conflict")
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))

    @app.post("/api/v2/playbooks", status_code=201)
    def create_playbook(body: PlaybookDraft, workspace: str = Depends(workspace_id)):
        try:
            return product.create_playbook(workspace, body)
        except PlaybookFrozenError as exc:
            raise HTTPException(status_code=409, detail=str(exc))
        except PlaybookLineageError as exc:
            raise HTTPException(status_code=422, detail=str(exc))

    @app.get("/api/v2/playbooks")
    def list_playbooks(workspace: str = Depends(workspace_id)):
        return {"items": store.list_records(workspace, "playbook")}

    @app.get("/api/v2/playbooks/{record_id}")
    def get_playbook(record_id: str, workspace: str = Depends(workspace_id)):
        record = store.get_record(workspace, "playbook", record_id)
        if record is None:
            raise HTTPException(status_code=404, detail="playbook_not_found")
        return record

    @app.post("/api/v2/playbooks/{record_id}/revisions")
    def revise_playbook(record_id: str, body: RevisionRequest, workspace: str = Depends(workspace_id)):
        try:
            return product.update_playbook(workspace, record_id, body.expected_revision, body.payload)
        except LookupError:
            raise HTTPException(status_code=404, detail="playbook_not_found")
        except PlaybookFrozenError as exc:
            raise HTTPException(status_code=409, detail=str(exc))
        except PlaybookLineageError as exc:
            raise HTTPException(status_code=409, detail=str(exc))
        except RuntimeError:
            raise HTTPException(status_code=409, detail="revision_conflict")
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=exc.errors())

    @app.get("/api/v2/playbooks/{record_id}/revisions")
    def list_playbook_revisions(record_id: str, workspace: str = Depends(workspace_id)):
        try:
            return {"items": store.list_record_revisions(workspace, "playbook", record_id)}
        except LookupError:
            raise HTTPException(status_code=404, detail="playbook_not_found")

    @app.post("/api/v2/playbooks/{record_id}/freeze")
    def freeze_playbook(record_id: str, body: PlaybookFreezeRequest, workspace: str = Depends(workspace_id)):
        try:
            return product.freeze_playbook(workspace, record_id, body.expected_revision)
        except LookupError:
            raise HTTPException(status_code=404, detail="playbook_not_found")
        except RuntimeError:
            raise HTTPException(status_code=409, detail="revision_conflict")

    @app.post("/api/v2/playbooks/{record_id}/fork", status_code=201)
    def fork_playbook(record_id: str, body: PlaybookForkRequest, workspace: str = Depends(workspace_id)):
        try:
            return product.fork_playbook(
                workspace,
                record_id,
                body.expected_revision,
                name=body.name,
                execution_capability=body.execution_capability,
                rules=body.rules,
            )
        except LookupError:
            raise HTTPException(status_code=404, detail="playbook_not_found")
        except PlaybookFrozenError as exc:
            raise HTTPException(status_code=409, detail=str(exc))
        except RuntimeError:
            raise HTTPException(status_code=409, detail="revision_conflict")

    @app.post("/api/v2/journal", status_code=201)
    def create_journal(body: JournalDraft, workspace: str = Depends(workspace_id)):
        try:
            return product.create_journal(workspace, body)
        except UniqueViolation:
            raise HTTPException(status_code=409, detail="journal_source_exists")

    @app.get("/api/v2/journal")
    def list_journal(workspace: str = Depends(workspace_id)):
        return {"items": store.list_records(workspace, "journal")}

    @app.get("/api/v2/journal/{record_id}")
    def get_journal(record_id: str, workspace: str = Depends(workspace_id)):
        record = store.get_record(workspace, "journal", record_id)
        if record is None:
            raise HTTPException(status_code=404, detail="journal_not_found")
        return record

    @app.get("/api/v2/journal/{record_id}/revisions")
    def list_journal_revisions(record_id: str, workspace: str = Depends(workspace_id)):
        try:
            return {"items": store.list_record_revisions(workspace, "journal", record_id)}
        except LookupError:
            raise HTTPException(status_code=404, detail="journal_not_found")

    @app.post("/api/v2/journal/{record_id}/revisions")
    def revise_journal(record_id: str, body: RevisionRequest, workspace: str = Depends(workspace_id)):
        try:
            return product.update_journal(workspace, record_id, body.expected_revision, body.payload)
        except LookupError:
            raise HTTPException(status_code=404, detail="journal_not_found")
        except JournalSourceImmutableError as exc:
            raise HTTPException(status_code=409, detail=str(exc))
        except RuntimeError:
            raise HTTPException(status_code=409, detail="revision_conflict")
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=exc.errors())

    @app.post("/api/v2/chart/annotations", status_code=201)
    def create_annotation(body: ChartAnnotationDraft, workspace: str = Depends(workspace_id)):
        return product.create_annotation(workspace, body)

    @app.get("/api/v2/chart/annotations")
    def list_annotations(workspace: str = Depends(workspace_id)):
        return {"items": store.list_records(workspace, "annotation")}

    @app.post("/api/v2/chart/annotations/{record_id}/revisions")
    def revise_annotation(record_id: str, body: RevisionRequest, workspace: str = Depends(workspace_id)):
        try:
            return product.update_annotation(workspace, record_id, body.expected_revision, body.payload)
        except LookupError:
            raise HTTPException(status_code=404, detail="annotation_not_found")
        except RuntimeError:
            raise HTTPException(status_code=409, detail="revision_conflict")
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=exc.errors())

    @app.get("/api/v2/ai/status")
    def ai_status(workspace: str = Depends(workspace_id)):
        store.ensure_workspace(workspace)
        return product.ai.status()

    @app.post("/api/v2/ai/request")
    def ai_request(body: AIRequest, workspace: str = Depends(workspace_id)):
        store.ensure_workspace(workspace)
        try:
            return product.ai.request(body.model_dump(mode="json", exclude_none=True))
        except AIInvalidRequest as exc:
            raise HTTPException(status_code=422, detail=str(exc))

    @app.get("/api/v2/execution/capabilities")
    def execution_capabilities(workspace: str = Depends(workspace_id)):
        store.ensure_workspace(workspace)
        return product.execution_capabilities()

    @app.post("/api/v2/execution/intents")
    def execution_intent(workspace: str = Depends(workspace_id)):
        store.ensure_workspace(workspace)
        raise HTTPException(status_code=403, detail="broker_execution_locked")

    return app


app = create_app() if os.getenv("TW_V2_DATABASE_URL") and os.getenv("TW_V2_ARTIFACT_ROOT") else FastAPI()
