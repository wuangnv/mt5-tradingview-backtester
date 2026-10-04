from __future__ import annotations

import os
import tempfile
from collections.abc import Mapping
from contextlib import contextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import PlainTextResponse
from psycopg.errors import UniqueViolation
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .auth import LocalWorkspaceAuthorization, MissingTrustedIdentity, WorkspaceMembershipDenied
from .artifacts import ArtifactStore
from .contracts import (
    AIRequest,
    CONTRACT_VERSION,
    ChartAnnotationDelete,
    ChartAnnotationDraft,
    CostPreviewRequest,
    CreateEngineResearchJob,
    CreateResearchJob,
    DatasetSource,
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
    ReplayMetadataUpdate,
    ReplayPropFeedRequest,
    ReplaySessionCatalogItem,
    ReplayStep,
    RevisionRequest,
)
from .data_sources import DataProviderRegistry, LocalCatalogProvider
from .data_ingest import DataImportError, DataIngestService, preview_csv
from .learn import LearnCatalog, LearnCatalogError, LearnResourceNotFound, LearnWorkspaceNotConfigured
from .product import JournalSourceImmutableError, PlaybookFrozenError, PlaybookLineageError, ProductService
from .dashboard_read_model import build_dashboard_performance
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
from .replay_analytics import build_replay_analytics_view
from .research import ResearchService
from .analytics_read_model import AnalyticsValidationError, analytics_csv, build_analytics_view
from .nautilus_worker import runtime_ready
from .retained import AIInvalidRequest, DataContractError, PropProfileValidationError
from .connector_ledger import ConnectorIdempotencyConflict, ConnectorLedgerError
from .notion_oauth import NotionOAuthConfig, NotionOAuthError, NotionOAuthService, is_loopback_host
from .project_session import build_local_demo_session_status
from .store import PostgresStore, PropIdempotencyConflict, PropPersistenceConflict


class ConnectorConnectionCreateRequest(BaseModel):
    """Local, opaque connector state; never an OAuth credential payload."""

    model_config = ConfigDict(extra="forbid")

    connection_id: str = Field(min_length=1, max_length=128)
    request_id: str = Field(min_length=1, max_length=128)
    idempotency_key: str = Field(min_length=1, max_length=128)
    account_ref: str | None = Field(default=None, max_length=128)
    scopes: list[str] = Field(min_length=1, max_length=16)
    metadata: dict[str, object] = Field(default_factory=dict)


class ConnectorConnectionStateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str = Field(min_length=1, max_length=32)
    expected_revision: int = Field(ge=1)
    error_code: str | None = Field(default=None, max_length=128)


class ConnectorIntentCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    intent_id: str = Field(min_length=1, max_length=128)
    request_id: str = Field(min_length=1, max_length=128)
    idempotency_key: str = Field(min_length=1, max_length=128)
    connection_id: str | None = Field(default=None, max_length=128)
    intent: dict[str, object]


class ConnectorReceiptUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str = Field(min_length=1, max_length=32)
    expected_revision: int = Field(ge=1)
    external_id: str | None = Field(default=None, max_length=256)
    remote_revision: str | None = Field(default=None, max_length=128)
    response: dict[str, object] = Field(default_factory=dict)
    error_code: str | None = Field(default=None, max_length=128)


class CsvDataImportRequest(BaseModel):
    """Bounded local CSV payload for the Data Desk import seam.

    The browser sends text rather than a server-side path.  This keeps the
    endpoint local and avoids turning an API request into arbitrary filesystem
    access.  ``csv_text`` is intentionally bounded before it reaches the
    streaming ingest implementation.
    """

    model_config = ConfigDict(extra="forbid")

    csv_text: str = Field(min_length=1, max_length=10_000_000)
    source: DatasetSource
    instrument: dict
    timeframe_seconds: int = Field(gt=0, le=31_536_000, strict=True)
    holdout_policy: dict | None = None


CSV_PAYLOAD_MAX_BYTES = 10 * 1024 * 1024


@contextmanager
def _materialize_csv_payload(csv_text: str):
    """Materialize one bounded request payload and remove it on exit."""

    try:
        payload = csv_text.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise ValueError("csv_text must be valid UTF-8") from exc
    if len(payload) > CSV_PAYLOAD_MAX_BYTES:
        raise ValueError("csv_text exceeds the 10 MiB import limit")
    temporary = tempfile.NamedTemporaryFile(
        mode="wb",
        suffix=".csv",
        prefix="tw-data-desk-",
        delete=False,
    )
    path = Path(temporary.name)
    try:
        with temporary:
            temporary.write(payload)
            temporary.flush()
        yield path
    finally:
        path.unlink(missing_ok=True)


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
    notion_oauth: NotionOAuthService | None = None,
) -> FastAPI:
    dsn = dsn or os.environ["TW_V2_DATABASE_URL"]
    artifact_root = artifact_root or os.environ["TW_V2_ARTIFACT_ROOT"]
    store = PostgresStore(dsn)
    store.initialize()
    artifacts = ArtifactStore(artifact_root)
    service = ResearchService(store, artifacts)
    ingest = DataIngestService(store, artifacts)
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
    app.state.ingest = ingest
    app.state.product = product
    app.state.replay = replay
    app.state.data_registry = data_registry
    app.state.learn = learn
    app.state.authorization = authorization
    if notion_oauth is None:
        notion_oauth = NotionOAuthService(NotionOAuthConfig.from_environment())
    app.state.notion_oauth = notion_oauth

    @app.middleware("http")
    async def protect_notion_oauth_response(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/v2/connectors/notion/oauth/"):
            response.headers["Cache-Control"] = "no-store"
            response.headers["Pragma"] = "no-cache"
            response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
            response.headers["Referrer-Policy"] = "no-referrer"
            response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    def require_local_notion_request(request: Request, *, callback: bool = False, mutation: bool = False) -> None:
        client_host = request.client.host if request.client else None
        try:
            request_url = urlparse(str(request.url))
        except ValueError as exc:
            raise HTTPException(status_code=403, detail="notion_oauth_local_only") from exc
        if not is_loopback_host(client_host) or not is_loopback_host(request_url.hostname) or request_url.scheme != "http":
            raise HTTPException(status_code=403, detail="notion_oauth_local_only")
        try:
            request_port = request_url.port
        except ValueError as exc:
            raise HTTPException(status_code=403, detail="notion_oauth_local_only") from exc
        if callback:
            if notion_oauth.config is None:
                raise HTTPException(status_code=503, detail="notion_oauth_not_configured")
            redirect = urlparse(notion_oauth.config.redirect_uri)
            if request_url.hostname != redirect.hostname or request_port != redirect.port:
                raise HTTPException(status_code=403, detail="notion_oauth_callback_origin_invalid")
        if mutation:
            origin = request.headers.get("origin")
            if not origin:
                raise HTTPException(status_code=403, detail="notion_oauth_origin_required")
            try:
                parsed_origin = urlparse(origin)
                origin_port = parsed_origin.port
            except ValueError as exc:
                raise HTTPException(status_code=403, detail="notion_oauth_origin_invalid") from exc
            if (parsed_origin.scheme, parsed_origin.hostname, origin_port, parsed_origin.path, parsed_origin.query, parsed_origin.fragment, parsed_origin.username) != (
                request_url.scheme, request_url.hostname, request_port, "", "", "", None
            ):
                raise HTTPException(status_code=403, detail="notion_oauth_origin_invalid")

    @app.get("/health")
    def health():
        return {
            "ok": True,
            "contract_version": CONTRACT_VERSION,
            "execution_capability": False,
            "authorization": authorization.status(),
        }

    @app.get("/api/v2/session/status")
    def get_project_session_status(request: Request, workspace: str = Depends(workspace_id)):
        """Return the current local/demo product-session boundary.

        Workspace authorization has already run through ``workspace_id``.  The
        projection below is read-only and intentionally has no OAuth, token,
        cookie, or provider side effect.  A production login/session service
        remains a separate, explicitly reviewed boundary.
        """

        identity = request.app.state.authorization.identity.resolve()
        return build_local_demo_session_status(
            identity_id=identity.subject,
            identity_source=identity.source,
            workspace_id=workspace,
        )

    @app.get("/api/v2/overview")
    def get_overview(
        session_id: str | None = None,
        from_close_utc: str | None = None,
        to_close_utc: str | None = None,
        workspace: str = Depends(workspace_id),
    ):
        try:
            performance = build_dashboard_performance(
                store.list_records(workspace, "replay"),
                workspace,
                session_id=session_id,
                from_close_utc=from_close_utc,
                to_close_utc=to_close_utc,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="replay_not_found") from exc
        except AnalyticsValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except (KeyError, TypeError, ValueError) as exc:
            raise HTTPException(status_code=503, detail="dashboard_source_invalid") from exc
        return {**product.overview(workspace), "performance": performance}

    # OAuth connection is separate from the PREP_ONLY export ledger below.
    # Its token lives only in this process and never enters a JSON response.
    @app.get("/api/v2/connectors/notion/oauth/status")
    def notion_oauth_status(request: Request, workspace: str = Depends(workspace_id)):
        require_local_notion_request(request)
        identity = request.app.state.authorization.identity.resolve()
        return notion_oauth.status(workspace, identity.subject)

    @app.post("/api/v2/connectors/notion/oauth/start")
    def notion_oauth_start(request: Request, workspace: str = Depends(workspace_id)):
        require_local_notion_request(request, mutation=True)
        identity = request.app.state.authorization.identity.resolve()
        try:
            return {"authorization_url": notion_oauth.begin(workspace, identity.subject)}
        except NotionOAuthError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @app.get("/api/v2/connectors/notion/oauth/callback", response_class=PlainTextResponse)
    def notion_oauth_callback(request: Request, state: str = "", code: str = "", error: str = ""):
        require_local_notion_request(request, callback=True)
        if error:
            raise HTTPException(status_code=400, detail="notion_oauth_provider_denied")
        try:
            notion_oauth.complete(state, code, authorize_workspace=authorization.authorize)
        except NotionOAuthError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except (MissingTrustedIdentity, WorkspaceMembershipDenied) as exc:
            raise HTTPException(status_code=403, detail="notion_oauth_workspace_access_denied") from exc
        return "Notion connected to this local project session. Return to the project tab."

    @app.post("/api/v2/connectors/notion/oauth/disconnect")
    def notion_oauth_disconnect(request: Request, workspace: str = Depends(workspace_id)):
        require_local_notion_request(request, mutation=True)
        identity = request.app.state.authorization.identity.resolve()
        notion_oauth.disconnect(workspace, identity.subject)
        return notion_oauth.status(workspace, identity.subject)

    # M6 export routes remain local/PREP_ONLY; they persist a user-selected
    # handoff and do not dispatch a Notion write.
    @app.post("/api/v2/connectors/notion/connections", status_code=201)
    def create_notion_connection(
        body: ConnectorConnectionCreateRequest,
        workspace: str = Depends(workspace_id),
    ):
        store.ensure_workspace(workspace)
        try:
            return store.create_connector_connection(
                workspace_id=workspace,
                connection_id=body.connection_id,
                request_id=body.request_id,
                idempotency_key=body.idempotency_key,
                account_ref=body.account_ref,
                scopes=body.scopes,
                metadata=body.metadata,
            )
        except ConnectorIdempotencyConflict as exc:
            raise HTTPException(status_code=409, detail="connector_idempotency_conflict") from exc
        except ConnectorLedgerError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.get("/api/v2/connectors/notion/connections")
    def list_notion_connections(workspace: str = Depends(workspace_id)):
        return {"items": store.list_connector_connections(workspace), "mode": "PREP_ONLY", "cloud_io": False}

    @app.get("/api/v2/connectors/notion/connections/{connection_id}")
    def get_notion_connection(connection_id: str, workspace: str = Depends(workspace_id)):
        connection = store.get_connector_connection(workspace, connection_id)
        if connection is None:
            raise HTTPException(status_code=404, detail="connector_connection_not_found")
        return connection

    @app.patch("/api/v2/connectors/notion/connections/{connection_id}")
    def update_notion_connection(
        connection_id: str,
        body: ConnectorConnectionStateRequest,
        workspace: str = Depends(workspace_id),
    ):
        try:
            return store.update_connector_connection(
                workspace_id=workspace,
                connection_id=connection_id,
                status=body.status,
                expected_revision=body.expected_revision,
                error_code=body.error_code,
            )
        except ConnectorLedgerError as exc:
            detail = "connector_connection_conflict" if "revision" in str(exc) or "terminal" in str(exc) else str(exc)
            raise HTTPException(status_code=409 if detail == "connector_connection_conflict" else 422, detail=detail) from exc

    @app.post("/api/v2/connectors/notion/intents", status_code=201)
    def create_notion_intent(
        body: ConnectorIntentCreateRequest,
        workspace: str = Depends(workspace_id),
    ):
        store.ensure_workspace(workspace)
        try:
            return store.create_connector_intent(
                workspace_id=workspace,
                intent_id=body.intent_id,
                request_id=body.request_id,
                idempotency_key=body.idempotency_key,
                connection_id=body.connection_id,
                intent=body.intent,
            )
        except ConnectorIdempotencyConflict as exc:
            raise HTTPException(status_code=409, detail="connector_idempotency_conflict") from exc
        except ConnectorLedgerError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.get("/api/v2/connectors/notion/intents")
    def list_notion_intents(workspace: str = Depends(workspace_id)):
        return {"items": store.list_connector_intents(workspace), "mode": "PREP_ONLY", "cloud_io": False}

    @app.get("/api/v2/connectors/notion/intents/{intent_id}")
    def get_notion_intent(intent_id: str, workspace: str = Depends(workspace_id)):
        intent = store.get_connector_intent(workspace, intent_id)
        if intent is None:
            raise HTTPException(status_code=404, detail="connector_intent_not_found")
        return intent

    @app.get("/api/v2/connectors/notion/intents/{intent_id}/receipt")
    def get_notion_receipt(intent_id: str, workspace: str = Depends(workspace_id)):
        receipt = store.get_connector_receipt(workspace, intent_id)
        if receipt is None:
            raise HTTPException(status_code=404, detail="connector_receipt_not_found")
        return receipt

    @app.patch("/api/v2/connectors/notion/intents/{intent_id}/receipt")
    def update_notion_receipt(
        intent_id: str,
        body: ConnectorReceiptUpdateRequest,
        workspace: str = Depends(workspace_id),
    ):
        try:
            return store.record_connector_receipt(
                workspace_id=workspace,
                intent_id=intent_id,
                status=body.status,
                expected_revision=body.expected_revision,
                external_id=body.external_id,
                remote_revision=body.remote_revision,
                response=body.response,
                error_code=body.error_code,
            )
        except ConnectorLedgerError as exc:
            detail = "connector_receipt_conflict" if "revision" in str(exc) or "terminal" in str(exc) else str(exc)
            raise HTTPException(status_code=409 if detail == "connector_receipt_conflict" else 422, detail=detail) from exc

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

    @app.post("/api/v2/data/csv/preview")
    def preview_csv_payload(body: CsvDataImportRequest, workspace: str = Depends(workspace_id)):
        """Return a deterministic quality/provenance report without importing.

        This is deliberately a JSON text contract so the local UI does not
        need a multipart dependency.  The content is parsed through the same
        streaming ingest code used by import, so preview and import cannot
        silently disagree about hashes, timestamps, or quality disposition.
        """

        try:
            with _materialize_csv_payload(body.csv_text) as path:
                preview = preview_csv(
                    path,
                    body.source,
                    body.instrument,
                    body.timeframe_seconds,
                    holdout_policy=body.holdout_policy,
                )
        except (DataImportError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {
            "schema_version": "u2-data-desk-preview-view-v1",
            "workspace_id": workspace,
            "execution_capability": False,
            "preview": preview,
        }

    @app.post("/api/v2/data/csv/import", status_code=201)
    def import_csv_payload(body: CsvDataImportRequest, workspace: str = Depends(workspace_id)):
        """Import one validated local CSV as an immutable dataset artifact."""

        try:
            with _materialize_csv_payload(body.csv_text) as path:
                manifest = ingest.import_csv(
                    workspace_id=workspace,
                    path=path,
                    source=body.source,
                    instrument=body.instrument,
                    timeframe_seconds=body.timeframe_seconds,
                    holdout_policy=body.holdout_policy,
                )
        except DataImportError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {
            "schema_version": "u2-data-desk-import-view-v1",
            "execution_capability": False,
            "dataset": manifest.model_dump(mode="json"),
        }

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

    def analytics_view_or_404(
        job_id: str,
        workspace: str,
        *,
        side: str = "all",
        outcome: str = "all",
        from_close_utc: str | None = None,
        to_close_utc: str | None = None,
    ) -> dict:
        job = store.get_job(workspace, job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="job_not_found")
        if job.status != "completed":
            raise HTTPException(status_code=409, detail="analytics_requires_completed_job")
        result = service.get_result(workspace, job_id)
        if result is None:
            raise HTTPException(status_code=503, detail="analytics_result_unavailable")
        try:
            return build_analytics_view(
                result,
                {
                    "side": side,
                    "outcome": outcome,
                    "from_close_utc": from_close_utc,
                    "to_close_utc": to_close_utc,
                },
            )
        except AnalyticsValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except (TypeError, ValueError) as exc:
            # Invalid source ledger/metric input is a data contract failure;
            # never turn it into a partial or synthetic analytics response.
            raise HTTPException(status_code=422, detail="analytics_source_invalid") from exc

    @app.get("/api/v2/research/jobs/{job_id}/analytics")
    def get_research_analytics(
        job_id: str,
        side: str = "all",
        outcome: str = "all",
        from_close_utc: str | None = None,
        to_close_utc: str | None = None,
        workspace: str = Depends(workspace_id),
    ):
        return analytics_view_or_404(
            job_id,
            workspace,
            side=side,
            outcome=outcome,
            from_close_utc=from_close_utc,
            to_close_utc=to_close_utc,
        )

    @app.get("/api/v2/research/jobs/{job_id}/analytics.csv")
    def export_research_analytics(
        job_id: str,
        side: str = "all",
        outcome: str = "all",
        from_close_utc: str | None = None,
        to_close_utc: str | None = None,
        workspace: str = Depends(workspace_id),
    ):
        view = analytics_view_or_404(
            job_id,
            workspace,
            side=side,
            outcome=outcome,
            from_close_utc=from_close_utc,
            to_close_utc=to_close_utc,
        )
        return Response(
            content=analytics_csv(view),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="job-{job_id}-analytics-v1.csv"'},
        )

    @app.get("/api/v2/research/jobs/{job_id}/checkpoint")
    def get_research_checkpoint(job_id: str, workspace: str = Depends(workspace_id)):
        """Return the latest resumable checkpoint for one workspace job.

        Checkpoints are worker-owned progress evidence, not a command to
        resume, retry, or execute a job.  Keep this endpoint read-only and
        tenant-scoped so a UI can show where an unattended run stopped without
        exposing lease tokens or granting any execution capability.
        """

        job = store.get_job(workspace, job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="job_not_found")
        try:
            checkpoint = store.get_job_checkpoint(workspace, job_id)
        except ValueError as exc:
            # A corrupt/stale row must never be presented as trusted progress
            # evidence or leak forbidden lease/provider/broker fields.
            raise HTTPException(status_code=503, detail="checkpoint_untrusted") from exc
        if checkpoint is None:
            raise HTTPException(status_code=404, detail="checkpoint_not_found")
        return {
            "schema_version": "research-job-checkpoint-view-v1",
            "job_id": job_id,
            "workspace_id": workspace,
            "execution_capability": False,
            **checkpoint,
        }

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

    @app.get("/api/v2/replay/sessions", response_model=dict[str, list[ReplaySessionCatalogItem]])
    def list_replay_sessions(workspace: str = Depends(workspace_id)):
        """List replay metadata for the authenticated local workspace only."""

        try:
            return {"items": replay.list_sessions(workspace)}
        except RuntimeError as exc:
            # A corrupt record must never be rendered as trusted session
            # metadata.  The caller can repair/inspect the store explicitly.
            raise HTTPException(status_code=503, detail="replay_catalog_untrusted") from exc

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

    @app.patch("/api/v2/replay/sessions/{session_id}")
    def update_replay_metadata(session_id: str, body: ReplayMetadataUpdate, workspace: str = Depends(workspace_id)):
        try:
            return replay.update_metadata(workspace, session_id, body.expected_revision,
                                          body.model_dump(exclude={"expected_revision"}, exclude_none=True))
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="replay_not_found") from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail="record_revision_conflict") from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    def replay_analytics_view(session_id, workspace, side, outcome, from_close_utc, to_close_utc,
                              cursor_index=None, cutoff_timestamp=None, event_sequence=None):
        try:
            record = replay.analytics_record(workspace, session_id, cursor_index, cutoff_timestamp, event_sequence)
            return build_replay_analytics_view({**record, "workspace_id": workspace}, {
                "side": side, "outcome": outcome,
                "from_close_utc": from_close_utc, "to_close_utc": to_close_utc,
            })
        except (TypeError, KeyError, ValueError) as exc:
            raise HTTPException(status_code=422, detail="replay_analytics_invalid_source_or_filter") from exc
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="replay_not_found") from exc

    @app.get("/api/v2/replay/sessions/{session_id}/analytics")
    def get_replay_analytics(session_id: str, side: str = "all", outcome: str = "all",
                             from_close_utc: str | None = None, to_close_utc: str | None = None,
                             cursor_index: int | None = None, cutoff_timestamp: int | None = None,
                             event_sequence: int | None = None,
                             workspace: str = Depends(workspace_id)):
        return replay_analytics_view(session_id, workspace, side, outcome, from_close_utc, to_close_utc,
                                     cursor_index, cutoff_timestamp, event_sequence)

    @app.get("/api/v2/replay/sessions/{session_id}/analytics.csv")
    def export_replay_analytics(session_id: str, side: str = "all", outcome: str = "all",
                                from_close_utc: str | None = None, to_close_utc: str | None = None,
                                cursor_index: int | None = None, cutoff_timestamp: int | None = None,
                                event_sequence: int | None = None,
                                workspace: str = Depends(workspace_id)):
        view = replay_analytics_view(session_id, workspace, side, outcome, from_close_utc, to_close_utc,
                                     cursor_index, cutoff_timestamp, event_sequence)
        return PlainTextResponse(content=analytics_csv(view), media_type="text/csv; charset=utf-8",
                                 headers={"Content-Disposition": 'attachment; filename="replay-analytics-v1.csv"'})

    @app.get("/api/v2/replay/sessions/{session_id}/analytics/experiments")
    def get_replay_analytics_experiments(
        session_id: str, stop_distance_ticks: float = 20, stop_multiplier: float = 1,
        target_r: float = 2, side: str = "all", outcome: str = "all",
        from_close_utc: str | None = None, to_close_utc: str | None = None,
        cursor_index: int | None = None, cutoff_timestamp: int | None = None,
        event_sequence: int | None = None,
        workspace: str = Depends(workspace_id),
    ):
        try:
            return replay.analytics_experiments(
                workspace, session_id, filters={"side": side, "outcome": outcome,
                    "from_close_utc": from_close_utc, "to_close_utc": to_close_utc},
                cursor_index=cursor_index, cutoff_timestamp=cutoff_timestamp, event_sequence=event_sequence,
                stop_distance_ticks=stop_distance_ticks, stop_multiplier=stop_multiplier, target_r=target_r)
        except (TypeError, KeyError, ValueError) as exc:
            raise HTTPException(status_code=422, detail="replay_experiment_invalid_source_or_config") from exc
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="replay_not_found") from exc

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
                research_margin=body.research_margin,
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
                strategy_spec=body.strategy_spec,
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

    @app.post("/api/v2/chart/annotations/{record_id}/delete")
    def delete_annotation(record_id: str, body: ChartAnnotationDelete, workspace: str = Depends(workspace_id)):
        try:
            return product.delete_annotation(workspace, record_id, body.expected_revision)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="annotation_not_found") from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail="revision_conflict") from exc

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
