from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from psycopg.errors import UniqueViolation
from pydantic import ValidationError

from .auth import LocalWorkspaceAuthorization, MissingTrustedIdentity, WorkspaceMembershipDenied
from .artifacts import ArtifactStore
from .contracts import (
    AIRequest,
    CONTRACT_VERSION,
    ChartAnnotationDraft,
    CostPreviewRequest,
    CreateEngineResearchJob,
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
    ReplayExecutionInitialize,
    ReplayMarketOrderRequest,
    ReplayPropFeedRequest,
    ReplayStep,
    RevisionRequest,
)
from .data_sources import DataProviderRegistry, LocalCatalogProvider
from .learn import LearnCatalog, LearnCatalogError, LearnResourceNotFound, LearnWorkspaceNotConfigured
from .product import JournalSourceImmutableError, PlaybookFrozenError, PlaybookLineageError, ProductService
from .prop_session import (
    AttemptStatus,
    PropAttemptCreateRequest,
    PropResumeSaveRequest,
    ReplayPropBranchAttemptRequest,
    PropSessionBundleCreateRequest,
    PropSessionContractError,
    PropSessionSnapshot,
    PropSessionUpdateRequest,
    TransitionIntent,
)
from .prop_replay import ReplayPropConnectionError
from .prop_report import build_prop_attempt_report, prop_attempt_report_csv
from .replay import ReplayService
from .research import ResearchService
from .nautilus_worker import runtime_ready
from .retained import AIInvalidRequest, DataContractError, PropProfileValidationError
from .store import PostgresStore, PropIdempotencyConflict, PropPersistenceConflict


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
    learn_roots: Mapping[str, str | Path] | None = None,
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
    if learn_roots is None:
        learn_workspace = os.getenv("TW_V2_LEARN_WORKSPACE_ID")
        education_root = os.getenv("TW_V2_EDUCATION_ROOT")
        if bool(learn_workspace) != bool(education_root):
            raise RuntimeError("TW_V2_LEARN_WORKSPACE_ID and TW_V2_EDUCATION_ROOT must be configured together")
        learn_roots = {learn_workspace: education_root} if learn_workspace and education_root else {}
    learn = LearnCatalog(learn_roots)

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
    app.state.learn = learn
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

    @app.get("/api/v2/learn/overview")
    def get_learn_overview(workspace: str = Depends(workspace_id)):
        try:
            return learn.overview(workspace)
        except LearnWorkspaceNotConfigured as exc:
            raise HTTPException(status_code=404, detail="learn_not_configured") from exc
        except LearnCatalogError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @app.get("/api/v2/learn/glossary")
    def get_learn_glossary(workspace: str = Depends(workspace_id)):
        try:
            return learn.glossary(workspace)
        except LearnWorkspaceNotConfigured as exc:
            raise HTTPException(status_code=404, detail="learn_not_configured") from exc
        except LearnCatalogError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @app.get("/api/v2/learn/resources/{resource_id}")
    def get_learn_resource(resource_id: str, workspace: str = Depends(workspace_id)):
        try:
            return learn.resource(workspace, resource_id)
        except LearnWorkspaceNotConfigured as exc:
            raise HTTPException(status_code=404, detail="learn_not_configured") from exc
        except LearnResourceNotFound as exc:
            raise HTTPException(status_code=404, detail="learn_resource_not_found") from exc
        except LearnCatalogError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

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

    def require_prop_scope(workspace: str, session_id: str, *items) -> None:
        for item in items:
            if getattr(item, "workspace_id", workspace) != workspace:
                raise HTTPException(status_code=403, detail="prop_workspace_mismatch")
            if getattr(item, "session_id", session_id) != session_id:
                raise HTTPException(status_code=422, detail="prop_session_mismatch")

    @app.post("/api/v2/prop/sessions", status_code=201)
    def create_prop_session(body: PropSessionSnapshot, workspace: str = Depends(workspace_id)):
        require_prop_scope(workspace, body.session_id, body)
        try:
            return store.create_prop_session(body).model_dump(mode="json")
        except (PropPersistenceConflict, PropSessionContractError) as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.post("/api/v2/prop/session-bundles", status_code=201)
    def create_prop_session_bundle(body: PropSessionBundleCreateRequest, workspace: str = Depends(workspace_id)):
        require_prop_scope(workspace, body.session.session_id, body.session, body.attempt, body.phase)
        try:
            result = store.create_prop_session_bundle(
                body.session,
                body.attempt,
                body.phase,
                resume_state=body.resume_state,
            )
        except (PropPersistenceConflict, PropSessionContractError) as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {
            "session": result["session"].model_dump(mode="json"),
            "attempt": result["attempt"].model_dump(mode="json"),
            "phase": result["phase"].model_dump(mode="json"),
            "resume_state": result["resume_state"],
            "duplicate": result["duplicate"],
        }

    @app.get("/api/v2/prop/sessions")
    def list_prop_sessions(workspace: str = Depends(workspace_id)):
        return {"items": [item.model_dump(mode="json") for item in store.list_prop_sessions(workspace)]}

    @app.get("/api/v2/prop/sessions/{session_id}")
    def get_prop_session(session_id: str, workspace: str = Depends(workspace_id)):
        session = store.get_prop_session(workspace, session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="prop_session_not_found")
        return session.model_dump(mode="json")

    @app.put("/api/v2/prop/sessions/{session_id}")
    def update_prop_session(session_id: str, body: PropSessionUpdateRequest, workspace: str = Depends(workspace_id)):
        require_prop_scope(workspace, session_id, body.session)
        try:
            result = store.update_prop_session(
                body.session,
                expected_revision=body.expected_revision,
                operation_id=body.operation_id,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="prop_session_not_found") from exc
        except PropIdempotencyConflict as exc:
            raise HTTPException(status_code=409, detail="prop_idempotency_conflict") from exc
        except (PropPersistenceConflict, PropSessionContractError) as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {
            "session": result["session"].model_dump(mode="json"),
            "duplicate": result["duplicate"],
        }

    @app.post("/api/v2/prop/sessions/{session_id}/attempts", status_code=201)
    def create_prop_attempt(session_id: str, body: PropAttemptCreateRequest, workspace: str = Depends(workspace_id)):
        require_prop_scope(workspace, session_id, body.attempt, body.phase)
        try:
            result = store.create_prop_attempt(body.attempt, body.phase, resume_state=body.resume_state)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="prop_session_not_found") from exc
        except (PropPersistenceConflict, PropSessionContractError) as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {
            "session": result["session"].model_dump(mode="json"),
            "attempt": result["attempt"].model_dump(mode="json"),
            "phase": result["phase"].model_dump(mode="json"),
            "resume_state": result["resume_state"],
            "duplicate": result["duplicate"],
        }

    @app.get("/api/v2/prop/sessions/{session_id}/attempts")
    def list_prop_attempts(session_id: str, workspace: str = Depends(workspace_id)):
        if store.get_prop_session(workspace, session_id) is None:
            raise HTTPException(status_code=404, detail="prop_session_not_found")
        return {
            "items": [
                item.model_dump(mode="json")
                for item in store.list_prop_attempts(workspace, session_id)
            ]
        }

    @app.get("/api/v2/prop/sessions/{session_id}/attempts/{attempt_id}")
    def get_prop_attempt(session_id: str, attempt_id: str, workspace: str = Depends(workspace_id)):
        result = store.get_prop_resume_state(workspace, session_id, attempt_id)
        if result is None:
            raise HTTPException(status_code=404, detail="prop_attempt_not_found")
        return {
            "session": result["session"].model_dump(mode="json"),
            "attempt": result["attempt"].model_dump(mode="json"),
            "phase": result["phase"].model_dump(mode="json"),
            "resume_state": result["resume_state"],
        }

    def prop_report_or_404(workspace: str, session_id: str, attempt_id: str) -> dict:
        result = store.get_prop_resume_state(workspace, session_id, attempt_id)
        if result is None:
            raise HTTPException(status_code=404, detail="prop_attempt_not_found")
        return build_prop_attempt_report(
            result["session"],
            result["attempt"],
            result["phase"],
            result["resume_state"],
        )

    @app.get("/api/v2/prop/sessions/{session_id}/attempts/{attempt_id}/report")
    def get_prop_attempt_report(session_id: str, attempt_id: str, workspace: str = Depends(workspace_id)):
        return prop_report_or_404(workspace, session_id, attempt_id)

    @app.get("/api/v2/prop/sessions/{session_id}/attempts/{attempt_id}/report.csv")
    def export_prop_attempt_report(session_id: str, attempt_id: str, workspace: str = Depends(workspace_id)):
        report = prop_report_or_404(workspace, session_id, attempt_id)
        return Response(
            content=prop_attempt_report_csv(report),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="prop-attempt-report.csv"'},
        )

    @app.get("/api/v2/prop/reports")
    def list_prop_reports(
        status: AttemptStatus | None = None,
        branch_kind: Literal["clean", "hindsight_exploratory"] | None = None,
        workspace: str = Depends(workspace_id),
    ):
        reports = []
        for session in store.list_prop_sessions(workspace):
            for attempt in store.list_prop_attempts(workspace, session.session_id):
                if status is not None and attempt.status != status:
                    continue
                if branch_kind is not None and attempt.branch_kind != branch_kind:
                    continue
                reports.append(prop_report_or_404(workspace, session.session_id, attempt.attempt_id))
        return {
            "schema_version": "prop-report-list-v1",
            "filters": {"status": status, "branch_kind": branch_kind},
            "items": reports,
            "count": len(reports),
            "broker_execution_capability": False,
        }

    @app.post("/api/v2/prop/sessions/{session_id}/attempts/{attempt_id}/transitions")
    def transition_prop_attempt(
        session_id: str,
        attempt_id: str,
        body: TransitionIntent,
        workspace: str = Depends(workspace_id),
    ):
        require_prop_scope(workspace, session_id, body)
        if body.attempt_id != attempt_id:
            raise HTTPException(status_code=422, detail="prop_attempt_mismatch")
        try:
            result = store.apply_prop_transition_intent(body)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="prop_attempt_not_found") from exc
        except PropIdempotencyConflict as exc:
            raise HTTPException(status_code=409, detail="prop_idempotency_conflict") from exc
        except (PropPersistenceConflict, PropSessionContractError) as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {
            "session": result["session"].model_dump(mode="json"),
            "attempt": result["attempt"].model_dump(mode="json"),
            "phase": result["phase"].model_dump(mode="json"),
            "resume_state": result["resume_state"],
            "duplicate": result["duplicate"],
        }

    @app.put("/api/v2/prop/sessions/{session_id}/attempts/{attempt_id}/resume")
    def save_prop_resume(
        session_id: str,
        attempt_id: str,
        body: PropResumeSaveRequest,
        workspace: str = Depends(workspace_id),
    ):
        require_prop_scope(workspace, session_id, body.attempt, body.phase)
        if body.attempt.attempt_id != attempt_id or body.phase.attempt_id != attempt_id:
            raise HTTPException(status_code=422, detail="prop_attempt_mismatch")
        try:
            result = store.save_prop_resume_state(
                body.attempt,
                body.phase,
                expected_revision=body.expected_revision,
                operation_id=body.operation_id,
                resume_state=body.resume_state,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="prop_attempt_not_found") from exc
        except PropIdempotencyConflict as exc:
            raise HTTPException(status_code=409, detail="prop_idempotency_conflict") from exc
        except (PropPersistenceConflict, PropSessionContractError) as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {
            "attempt": result["attempt"].model_dump(mode="json"),
            "phase": result["phase"].model_dump(mode="json"),
            "resume_state": result["resume_state"],
            "duplicate": result["duplicate"],
        }

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

    @app.get("/api/v2/research/engines")
    def research_engines(workspace: str = Depends(workspace_id)):
        return {"primary": "nautilus", "items": [
            {"id": "nautilus", "version": "1.231.0", "available": runtime_ready(),
             "scope": "fx quote/account currency match; modeled open/close quotes; fixed-horizon; no broker"},
            {"id": "reference", "version": "bar-breakout-v1", "available": True,
             "scope": "deterministic oracle/reference; not the primary engine"},
        ]}

    @app.post("/api/v2/research/engine-jobs", status_code=202)
    def create_engine_research_job(body: CreateEngineResearchJob, workspace: str = Depends(workspace_id)):
        try:
            job = service.create_engine_job(
                workspace_id=workspace,
                request=body,
                walk_forward=body.walk_forward,
                parameter_space=body.parameter_space,
                max_trials=body.max_trials,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc))
        except (ValueError, DataContractError) as exc:
            raise HTTPException(status_code=422, detail=str(exc))
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
    def get_replay(
        session_id: str,
        cursor_index: int | None = None,
        workspace: str = Depends(workspace_id),
    ):
        try:
            return replay.view(workspace, session_id, cursor_index=cursor_index)
        except LookupError:
            raise HTTPException(status_code=404, detail="replay_not_found")
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.post("/api/v2/replay/sessions/{session_id}/execution")
    def initialize_replay_execution(
        session_id: str,
        body: ReplayExecutionInitialize,
        workspace: str = Depends(workspace_id),
    ):
        try:
            return replay.initialize_execution(
                workspace,
                session_id,
                body.expected_revision,
                instrument_spec=body.instrument_spec,
                cost_model=body.cost_model,
                spread_price=body.spread_price,
                timeframe_seconds=body.timeframe_seconds,
                starting_balance=body.starting_balance,
            )
        except LookupError:
            raise HTTPException(status_code=404, detail="replay_not_found")
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.post("/api/v2/replay/sessions/{session_id}/orders/market")
    def queue_replay_market_order(
        session_id: str,
        body: ReplayMarketOrderRequest,
        workspace: str = Depends(workspace_id),
    ):
        try:
            return replay.queue_market_order(
                workspace,
                session_id,
                body.expected_revision,
                operation_id=body.operation_id,
                side=body.side,
                quantity=body.quantity,
                stop_loss=body.stop_loss,
                take_profit=body.take_profit,
            )
        except LookupError:
            raise HTTPException(status_code=404, detail="replay_not_found")
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.post("/api/v2/replay/sessions/{session_id}/step")
    def step_replay(session_id: str, body: ReplayStep, workspace: str = Depends(workspace_id)):
        try:
            return replay.step(workspace, session_id, body.expected_revision, body.steps)
        except LookupError:
            raise HTTPException(status_code=404, detail="replay_not_found")
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.post("/api/v2/replay/sessions/{session_id}/branch", status_code=201)
    def branch_replay(session_id: str, body: ReplayBranch, workspace: str = Depends(workspace_id)):
        try:
            return replay.branch(workspace, session_id, body.expected_revision, body.cursor_index)
        except LookupError:
            raise HTTPException(status_code=404, detail="replay_not_found")
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.post(
        "/api/v2/replay/sessions/{replay_session_id}/prop/sessions/{prop_session_id}/attempts/{parent_attempt_id}/branch",
        status_code=201,
    )
    def branch_replay_prop_attempt(
        replay_session_id: str,
        prop_session_id: str,
        parent_attempt_id: str,
        body: ReplayPropBranchAttemptRequest,
        workspace: str = Depends(workspace_id),
    ):
        try:
            return replay.branch_prop_attempt(
                workspace,
                replay_session_id,
                prop_session_id=prop_session_id,
                parent_attempt_id=parent_attempt_id,
                expected_replay_revision=body.expected_replay_revision,
                expected_parent_replay_revision=body.expected_parent_replay_revision,
                expected_parent_attempt_revision=body.expected_parent_attempt_revision,
                operation_id=body.operation_id,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except PropIdempotencyConflict as exc:
            raise HTTPException(status_code=409, detail="prop_idempotency_conflict") from exc
        except (PropPersistenceConflict, PropSessionContractError) as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ReplayPropConnectionError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.post(
        "/api/v2/replay/sessions/{replay_session_id}/prop/sessions/{prop_session_id}/attempts/{attempt_id}/feed"
    )
    def feed_replay_prop_lifecycle(
        replay_session_id: str,
        prop_session_id: str,
        attempt_id: str,
        body: ReplayPropFeedRequest,
        workspace: str = Depends(workspace_id),
    ):
        try:
            return replay.feed_prop_lifecycle(
                workspace,
                replay_session_id,
                prop_session_id=prop_session_id,
                prop_attempt_id=attempt_id,
                replay_event_sequence=body.replay_event_sequence,
                expected_prop_revision=body.expected_prop_revision,
                prop_event_sequence=body.prop_event_sequence,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except (PropIdempotencyConflict, PropPersistenceConflict, PropSessionContractError) as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ReplayPropConnectionError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
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
