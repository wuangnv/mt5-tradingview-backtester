from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from contextlib import contextmanager
from datetime import datetime, timezone
from uuid import uuid4
from threading import Lock, BoundedSemaphore
import weakref

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool, PoolTimeout

from .migrations import MIGRATION_DIRECTORY, apply_migrations

from .contracts import DatasetManifest, ResearchJobView, utc_now_iso
from .connector_ledger import (
    CONNECTOR_KIND,
    CONNECTOR_LEDGER_SCHEMA,
    ConnectorIdempotencyConflict,
    ConnectorLedgerError,
    json_object,
    validate_connection_request,
    validate_intent_request,
    validate_receipt_status,
)
from .prop_replay import (
    ReplayPropConnectionError,
    replay_event_operation_id,
    replay_mark_to_prop_event,
    validate_replay_prop_branch_checkpoint,
    validate_replay_prop_transition_boundary,
    validate_replay_prop_transition_result,
)
from .prop_session import (
    ChallengeAttemptSnapshot,
    PhaseStateSnapshot,
    PropLifecycleEvent,
    PropSessionContractError,
    PropSessionSnapshot,
    TransitionIntent,
    apply_prop_lifecycle_command,
    evaluate_prop_lifecycle_event,
    validate_attempt_against_session,
)
from .replay_execution import (
    ReplayExecutionError,
    parse_replay_execution_snapshot,
    replay_event_for_snapshot,
    transition_replay_phase,
)
from .research_oos import complete_canceled_sweep_outcomes


RESEARCH_JOB_ADMISSION_LOCK_KEY = 0x52534A41


_RESEARCH_CHECKPOINT_FORBIDDEN_KEYS = frozenset(
    {
        "lease_owner",
        "lease_token",
        "lease_expires_at_utc",
        "provider_credentials",
        "broker_state",
        "holdout_data",
        "resume_command",
    }
)
_RESEARCH_CHECKPOINT_PUBLIC_FIELDS = frozenset(
    {
        "schema",
        "phase",
        "attempt_no",
        "dataset_id",
        "protocol_sha256",
        "validation_schema",
        "trial_outcomes",
        "trial_status_counts",
        "trial_count",
        "fully_accounted",
        "row_count",
        "trade_count",
        "result_sha256",
        "from_utc",
        "to_utc",
        "holdout_access",
        "fold_count",
        "sweep_truncated",
        "stress_config_sha256",
        "stress_scenario_count",
    }
)
_RESEARCH_PROGRESS_PUBLIC_FIELDS = frozenset(
    {"phase_index", "phase_count", "trial_index", "trial_count"}
)


def _reject_forbidden_checkpoint_keys(value: object, *, path: str = "checkpoint") -> None:
    """Reject persisted checkpoint data that could cross the read-only boundary.

    Checkpoints are worker progress evidence.  A compromised or stale row must
    fail closed instead of allowing lease/provider/broker/holdout material to
    escape through the inspection endpoint.  The recursive check also covers
    trial outcome details added by future worker phases.
    """

    if isinstance(value, dict):
        for key, child in value.items():
            if key in _RESEARCH_CHECKPOINT_FORBIDDEN_KEYS:
                raise ValueError(f"{path}.{key} is not allowed in a research checkpoint")
            _reject_forbidden_checkpoint_keys(child, path=f"{path}.{key}")
    elif isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            _reject_forbidden_checkpoint_keys(child, path=f"{path}[{index}]")


def validate_research_checkpoint_view(checkpoint: object, progress: object) -> tuple[dict, dict | None]:
    """Validate and project persisted worker progress for a read-only view.

    Unknown fields are intentionally dropped for forward compatibility.  The
    recursive forbidden-key check runs before projection so a corrupt row is
    still rejected rather than silently hiding a lease/provider/broker leak.
    """

    if not isinstance(checkpoint, dict):
        raise ValueError("research checkpoint must be an object")
    if checkpoint.get("schema") != "research-job-checkpoint-v1":
        raise ValueError("research checkpoint schema is invalid")
    if not isinstance(checkpoint.get("phase"), str) or not checkpoint["phase"].strip():
        raise ValueError("research checkpoint phase is invalid")
    attempt_no = checkpoint.get("attempt_no")
    if type(attempt_no) is not int or attempt_no < 0:
        raise ValueError("research checkpoint attempt_no is invalid")
    if progress is not None and not isinstance(progress, dict):
        raise ValueError("research checkpoint progress is invalid")
    _reject_forbidden_checkpoint_keys(checkpoint)
    if progress is not None:
        _reject_forbidden_checkpoint_keys(progress, path="progress")
    projected = {
        key: checkpoint[key]
        for key in _RESEARCH_CHECKPOINT_PUBLIC_FIELDS
        if key in checkpoint
    }
    trial_outcomes = projected.get("trial_outcomes")
    if trial_outcomes is not None:
        if not isinstance(trial_outcomes, list):
            raise ValueError("research checkpoint trial_outcomes is invalid")
        normalized_outcomes: list[dict[str, object]] = []
        for outcome in trial_outcomes:
            if not isinstance(outcome, dict):
                raise ValueError("research checkpoint trial_outcomes is invalid")
            trial_id = outcome.get("trial_id")
            status = outcome.get("status")
            if not isinstance(trial_id, str) or not trial_id.strip() or status not in {
                "completed", "failed", "canceled"
            }:
                raise ValueError("research checkpoint trial_outcomes is invalid")
            normalized_outcomes.append({"trial_id": trial_id, "status": status})
        projected["trial_outcomes"] = normalized_outcomes
    if "holdout_access" in projected and projected["holdout_access"] is not False:
        raise ValueError("research checkpoint cannot expose holdout access")
    status_counts = projected.get("trial_status_counts")
    if status_counts is not None:
        if not isinstance(status_counts, dict) or set(status_counts) - {
            "canceled", "completed", "failed"
        }:
            raise ValueError("research checkpoint trial_status_counts is invalid")
        if any(type(value) is not int or value < 0 for value in status_counts.values()):
            raise ValueError("research checkpoint trial_status_counts is invalid")
        projected["trial_status_counts"] = {
            key: status_counts[key]
            for key in ("canceled", "completed", "failed")
            if key in status_counts
        }
    projected_progress = None
    if progress is not None:
        # Progress is persisted worker evidence, but it is still part of the
        # public read-only contract.  Do not let a malformed row expose bools,
        # negative counters, or an impossible cursor just because unknown
        # fields are otherwise dropped for forward compatibility.
        for key in _RESEARCH_PROGRESS_PUBLIC_FIELDS:
            if key in progress:
                value = progress[key]
                if type(value) is not int or value < 0:
                    raise ValueError(f"research checkpoint progress.{key} is invalid")
        phase_index = progress.get("phase_index")
        phase_count = progress.get("phase_count")
        if (
            phase_index is not None
            and phase_count is not None
            and phase_index > phase_count
        ):
            raise ValueError("research checkpoint progress phase cursor is invalid")
        trial_index = progress.get("trial_index")
        trial_count = progress.get("trial_count")
        if (
            trial_index is not None
            and trial_count is not None
            and trial_index > trial_count
        ):
            raise ValueError("research checkpoint progress trial cursor is invalid")
        projected_progress = {
            key: progress[key]
            for key in _RESEARCH_PROGRESS_PUBLIC_FIELDS
            if key in progress
        }
    return projected, projected_progress


def _oos_cancellation_state(row: dict) -> tuple[dict, dict] | None:
    protocol = row.get("protocol_json")
    validation = protocol.get("validation") if isinstance(protocol, dict) else None
    sweep = validation.get("sweep") if isinstance(validation, dict) else None
    if validation is None or validation.get("schema") != "research-oos-validation-v1" or not isinstance(sweep, dict):
        return None

    checkpoint = row.get("checkpoint_json")
    same_attempt_checkpoint = False
    if isinstance(checkpoint, dict):
        try:
            same_attempt_checkpoint = int(checkpoint.get("attempt_no")) == int(row.get("attempt_no") or 0)
        except (TypeError, ValueError):
            same_attempt_checkpoint = False
    partial_outcomes = checkpoint.get("trial_outcomes") if same_attempt_checkpoint else []
    if not isinstance(partial_outcomes, list):
        partial_outcomes = []
    try:
        terminal_outcomes, summary = complete_canceled_sweep_outcomes(sweep, partial_outcomes)
    except ValueError:
        return None

    observed_count = len(partial_outcomes)
    terminal_checkpoint = {
        "schema": "research-job-checkpoint-v1",
        "phase": "oos-sweep-canceled",
        "attempt_no": int(row.get("attempt_no") or 0),
        "validation_schema": validation["schema"],
        "trial_outcomes": terminal_outcomes,
        "trial_status_counts": summary["status_counts"],
        "trial_count": summary["trial_count"],
        "fully_accounted": summary["fully_accounted"],
    }
    terminal_progress = {
        "phase_index": 3,
        "phase_count": 5,
        "trial_index": observed_count,
        "trial_count": summary["trial_count"],
    }
    return terminal_checkpoint, terminal_progress


SCHEMA_SQL = (MIGRATION_DIRECTORY / "0001_baseline.sql").read_text(encoding="utf-8")


@dataclass(frozen=True)
class ClaimedJob:
    workspace_id: str
    job_id: str
    dataset_id: str
    strategy_version: str
    starting_balance: float
    protocol: dict | None
    protocol_sha256: str | None
    attempt_no: int
    lease_owner: str
    lease_token: str


class StaleJobAttempt(RuntimeError):
    pass


class PropPersistenceConflict(RuntimeError):
    pass


class PropIdempotencyConflict(PropPersistenceConflict):
    pass


class JobIdempotencyConflict(RuntimeError):
    pass


class StoredContractUntrusted(RuntimeError):
    def __init__(self):
        super().__init__("stored_contract_untrusted")


def _stored_prop_snapshot(model, payload, workspace_id, session_id, attempt_id=None):
    if not isinstance(payload, dict) or payload.get("workspace_id") != workspace_id or payload.get("session_id") != session_id:
        raise StoredContractUntrusted()
    if attempt_id is not None and payload.get("attempt_id") != attempt_id:
        raise StoredContractUntrusted()
    try:
        return model.model_validate(payload)
    except ValueError as exc:
        raise StoredContractUntrusted() from exc


_TERMINAL_PROP_ATTEMPT_STATUSES = {"completed_pass", "failed_breach", "expired", "abandoned"}


def _canonical_json(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def _payload_fingerprint(payload: dict) -> str:
    return hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()


class PostgresStore:
    def __init__(self, dsn: str, *, pool_size: int = 8, pool_timeout: float = 5,
                 dedicated_size: int = 8):
        if pool_size < 1 or dedicated_size < 1 or pool_timeout <= 0:
            raise ValueError("pool size and timeout must be positive")
        self.dsn = dsn
        self._pool_size = pool_size
        self._pool_timeout = pool_timeout
        self._pool = None
        self._pool_lock = Lock()
        self._dedicated_slots = BoundedSemaphore(dedicated_size)
        self._closed = False

    @contextmanager
    def connect(self):
        with self._pool_lock:
            if self._closed:
                raise RuntimeError("PostgresStore is closed")
            if self._pool is None:
                self._pool = ConnectionPool(
                    self.dsn, min_size=0, max_size=self._pool_size,
                    timeout=self._pool_timeout, max_waiting=64, num_workers=1,
                    kwargs={"row_factory": dict_row, "connect_timeout": max(1, int(self._pool_timeout))},
                    open=True,
                )
                weakref.finalize(self, self._pool.close)
            pool = self._pool
        # The pool context commits on success and rolls back on failure, just as
        # the previous psycopg connection context did. A borrower never owns close().
        with pool.connection() as conn:
            yield conn

    @contextmanager
    def dedicated_connection(self):
        """Session locks must be released by closing their own physical session."""
        if self._closed:
            raise RuntimeError("PostgresStore is closed")
        if not self._dedicated_slots.acquire(timeout=self._pool_timeout):
            raise PoolTimeout("dedicated PostgreSQL connection capacity exhausted")
        try:
            if self._closed:
                raise RuntimeError("PostgresStore is closed")
            with psycopg.connect(self.dsn, row_factory=dict_row, autocommit=True,
                                connect_timeout=max(1, int(self._pool_timeout))) as conn:
                yield conn
        finally:
            self._dedicated_slots.release()

    def close(self) -> None:
        with self._pool_lock:
            self._closed = True
            if self._pool is not None:
                self._pool.close()

    def initialize(self) -> None:
        with self.connect() as conn:
            apply_migrations(conn)

    def ensure_workspace(self, workspace_id: str) -> None:
        now = utc_now_iso()
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO workspaces(workspace_id,created_at_utc) VALUES(%s,%s) ON CONFLICT DO NOTHING",
                (workspace_id, now),
            )
            conn.commit()

    # ------------------------------------------------------------------
    # Offline connector ledger (M6 / Notion)
    # ------------------------------------------------------------------
    # These methods persist the product-owned handoff boundary.  They do not
    # perform OAuth, contact Notion, or dispatch a broker action.  A future
    # adapter may consume a PREP_ONLY intent after its own explicit gate and
    # write a sanitized receipt back through ``record_connector_receipt``.

    @staticmethod
    def _connector_row(row: dict | None) -> dict | None:
        if row is None:
            return None
        normalized = dict(row)
        for key in ("scopes_json", "metadata_json", "source_revision_json", "intent_json", "response_json"):
            if key in normalized and isinstance(normalized[key], str):
                normalized[key] = json.loads(normalized[key])
        return normalized

    def create_connector_connection(
        self,
        *,
        workspace_id: str,
        connection_id: str,
        request_id: str,
        idempotency_key: str,
        account_ref: str | None,
        scopes: list[str] | tuple[str, ...],
        metadata: dict,
    ) -> dict:
        """Create or idempotently restore an opaque Notion connection.

        ``account_ref`` is an opaque user-selected reference only.  Tokens,
        authorization codes and broker/account fields are rejected by the
        validator before anything reaches durable storage.
        """

        request = validate_connection_request(
            workspace_id=workspace_id,
            connector=CONNECTOR_KIND,
            connection_id=connection_id,
            request_id=request_id,
            idempotency_key=idempotency_key,
            account_ref=account_ref,
            scopes=scopes,
            metadata=metadata,
        )
        now = utc_now_iso()
        with self.connect() as conn:
            insert_result = conn.execute(
                """
                INSERT INTO connector_connections(
                    workspace_id,connector,connection_id,request_id,idempotency_key,
                    fingerprint,account_ref,scopes_json,metadata_json,status,revision,
                    created_at_utc,updated_at_utc
                ) VALUES(%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,'pending',1,%s,%s)
                ON CONFLICT DO NOTHING
                """,
                (
                    request["workspace_id"],
                    request["connector"],
                    request["connection_id"],
                    request["request_id"],
                    request["idempotency_key"],
                    request["fingerprint"],
                    request["account_ref"],
                    json.dumps(request["scopes"], sort_keys=True),
                    json.dumps(request["metadata"], sort_keys=True),
                    now,
                    now,
                ),
            )
            row = conn.execute(
                """
                SELECT * FROM connector_connections
                WHERE workspace_id=%s AND connector=%s
                  AND (connection_id=%s OR idempotency_key=%s)
                ORDER BY connection_id
                LIMIT 1
                """,
                (
                    request["workspace_id"],
                    request["connector"],
                    request["connection_id"],
                    request["idempotency_key"],
                ),
            ).fetchone()
            if row is None:
                raise ConnectorLedgerError("connector connection was not persisted")
            if row["fingerprint"] != request["fingerprint"]:
                raise ConnectorIdempotencyConflict("connector connection request key was reused with different content")
            conn.commit()
        return {"duplicate": insert_result.rowcount != 1, "connection": self._connector_row(row)}

    def get_connector_connection(self, workspace_id: str, connection_id: str) -> dict | None:
        request_workspace = workspace_id
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM connector_connections WHERE workspace_id=%s AND connector=%s AND connection_id=%s",
                (request_workspace, CONNECTOR_KIND, connection_id),
            ).fetchone()
        return self._connector_row(row)

    def list_connector_connections(self, workspace_id: str) -> list[dict]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM connector_connections WHERE workspace_id=%s AND connector=%s ORDER BY updated_at_utc DESC,connection_id",
                (workspace_id, CONNECTOR_KIND),
            ).fetchall()
        return [self._connector_row(row) for row in rows]

    def update_connector_connection(
        self,
        *,
        workspace_id: str,
        connection_id: str,
        status: str,
        expected_revision: int,
        error_code: str | None = None,
    ) -> dict:
        """Advance connection state without contacting the provider."""

        status = validate_receipt_status(status)
        if isinstance(expected_revision, bool) or not isinstance(expected_revision, int) or expected_revision < 1:
            raise ConnectorLedgerError("expected_revision must be a positive integer")
        if error_code is not None and (not isinstance(error_code, str) or not error_code or len(error_code) > 128):
            raise ConnectorLedgerError("error_code must be a bounded non-empty string")
        now = utc_now_iso()
        with self.connect() as conn:
            current = conn.execute(
                "SELECT * FROM connector_connections WHERE workspace_id=%s AND connector=%s AND connection_id=%s FOR UPDATE",
                (workspace_id, CONNECTOR_KIND, connection_id),
            ).fetchone()
            if current is None:
                raise ConnectorLedgerError("connector connection does not exist")
            if current["revision"] != expected_revision:
                raise ConnectorLedgerError("connector connection revision is stale")
            if current["status"] in {"succeeded", "revoked", "cancelled"} and status != current["status"]:
                raise ConnectorLedgerError("terminal connector connection cannot be rewritten")
            updated = conn.execute(
                """
                UPDATE connector_connections
                SET status=%s, error_code=%s, revision=revision+1, updated_at_utc=%s
                WHERE workspace_id=%s AND connector=%s AND connection_id=%s AND revision=%s
                RETURNING *
                """,
                (status, error_code, now, workspace_id, CONNECTOR_KIND, connection_id, expected_revision),
            ).fetchone()
            if updated is None:
                raise ConnectorLedgerError("connector connection update lost its revision race")
            conn.commit()
        return {"duplicate": False, "connection": self._connector_row(updated)}

    def create_connector_intent(
        self,
        *,
        workspace_id: str,
        intent_id: str,
        request_id: str,
        idempotency_key: str,
        connection_id: str | None,
        intent: dict,
    ) -> dict:
        """Persist a sanitized PREP_ONLY intent and its pending receipt."""

        request = validate_intent_request(
            workspace_id=workspace_id,
            intent_id=intent_id,
            request_id=request_id,
            idempotency_key=idempotency_key,
            connection_id=connection_id,
            intent=intent,
        )
        now = utc_now_iso()
        receipt_id = f"receipt:{request['intent_id']}"
        with self.connect() as conn:
            if request["connection_id"] is not None:
                connection = conn.execute(
                    "SELECT status FROM connector_connections WHERE workspace_id=%s AND connector=%s AND connection_id=%s",
                    (request["workspace_id"], CONNECTOR_KIND, request["connection_id"]),
                ).fetchone()
                if connection is None:
                    raise ConnectorLedgerError("connector connection does not exist")
                if connection["status"] in {"revoked", "cancelled"}:
                    raise ConnectorLedgerError("connector connection is not usable")
            insert_result = conn.execute(
                """
                INSERT INTO connector_intents(
                    workspace_id,connector,intent_id,request_id,idempotency_key,fingerprint,
                    connection_id,source_revision_json,source_content_sha256,destination_ref,
                    intent_json,status,mode,created_at_utc,updated_at_utc
                ) VALUES(%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s::jsonb,'pending','PREP_ONLY',%s,%s)
                ON CONFLICT DO NOTHING
                """,
                (
                    request["workspace_id"],
                    CONNECTOR_KIND,
                    request["intent_id"],
                    request["request_id"],
                    request["idempotency_key"],
                    request["fingerprint"],
                    request["connection_id"],
                    json.dumps(request["source_revision"], sort_keys=True),
                    request["content_sha256"],
                    request["destination_ref"],
                    json.dumps(request["intent"], sort_keys=True),
                    now,
                    now,
                ),
            )
            row = conn.execute(
                """
                SELECT * FROM connector_intents
                WHERE workspace_id=%s AND connector=%s
                  AND (intent_id=%s OR idempotency_key=%s)
                ORDER BY intent_id LIMIT 1
                """,
                (request["workspace_id"], CONNECTOR_KIND, request["intent_id"], request["idempotency_key"]),
            ).fetchone()
            if row is None:
                raise ConnectorLedgerError("connector intent was not persisted")
            if row["fingerprint"] != request["fingerprint"]:
                raise ConnectorIdempotencyConflict("connector intent request key was reused with different content")
            receipt = conn.execute(
                "SELECT * FROM connector_receipts WHERE workspace_id=%s AND connector=%s AND intent_id=%s",
                (request["workspace_id"], CONNECTOR_KIND, row["intent_id"]),
            ).fetchone()
            if receipt is None:
                conn.execute(
                    """
                    INSERT INTO connector_receipts(
                        workspace_id,connector,receipt_id,intent_id,status,revision,
                        source_revision_json,source_content_sha256,created_at_utc,updated_at_utc
                    ) VALUES(%s,%s,%s,%s,'pending',1,%s::jsonb,%s,%s,%s)
                    """,
                    (
                        request["workspace_id"],
                        CONNECTOR_KIND,
                        receipt_id,
                        row["intent_id"],
                        json.dumps(request["source_revision"], sort_keys=True),
                        request["content_sha256"],
                        now,
                        now,
                    ),
                )
                receipt = conn.execute(
                    "SELECT * FROM connector_receipts WHERE workspace_id=%s AND connector=%s AND intent_id=%s",
                    (request["workspace_id"], CONNECTOR_KIND, row["intent_id"]),
                ).fetchone()
            conn.commit()
        return {
            "duplicate": insert_result.rowcount != 1,
            "intent": self._connector_row(row),
            "receipt": self._connector_row(receipt),
        }

    def get_connector_intent(self, workspace_id: str, intent_id: str) -> dict | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM connector_intents WHERE workspace_id=%s AND connector=%s AND intent_id=%s",
                (workspace_id, CONNECTOR_KIND, intent_id),
            ).fetchone()
        return self._connector_row(row)

    def list_connector_intents(self, workspace_id: str) -> list[dict]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM connector_intents WHERE workspace_id=%s AND connector=%s ORDER BY updated_at_utc DESC,intent_id",
                (workspace_id, CONNECTOR_KIND),
            ).fetchall()
        return [self._connector_row(row) for row in rows]

    def get_connector_receipt(self, workspace_id: str, intent_id: str) -> dict | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM connector_receipts WHERE workspace_id=%s AND connector=%s AND intent_id=%s",
                (workspace_id, CONNECTOR_KIND, intent_id),
            ).fetchone()
        return self._connector_row(row)

    def record_connector_receipt(
        self,
        *,
        workspace_id: str,
        intent_id: str,
        status: str,
        expected_revision: int,
        external_id: str | None = None,
        remote_revision: str | None = None,
        response: dict | None = None,
        error_code: str | None = None,
    ) -> dict:
        """Persist a provider outcome supplied by a future adapter.

        This method only writes a receipt supplied by a caller; it never
        dispatches anything.  ``succeeded`` requires an opaque external ID,
        while all response data passes the same sensitive-key rejection as an
        intent.
        """

        status = validate_receipt_status(status)
        if isinstance(expected_revision, bool) or not isinstance(expected_revision, int) or expected_revision < 1:
            raise ConnectorLedgerError("expected_revision must be a positive integer")
        if external_id is not None:
            if not isinstance(external_id, str) or not external_id or len(external_id) > 256 or any(ord(c) < 0x20 for c in external_id):
                raise ConnectorLedgerError("external_id must be a bounded opaque reference")
        if remote_revision is not None:
            if not isinstance(remote_revision, str) or not remote_revision or len(remote_revision) > 128 or any(ord(c) < 0x20 for c in remote_revision):
                raise ConnectorLedgerError("remote_revision must be a bounded reference")
        if status == "succeeded" and not external_id:
            raise ConnectorLedgerError("succeeded receipts require external_id")
        response = {} if response is None else response
        response = json_object(response, "response")
        if error_code is not None and (not isinstance(error_code, str) or not error_code or len(error_code) > 128):
            raise ConnectorLedgerError("error_code must be a bounded non-empty string")
        now = utc_now_iso()
        with self.connect() as conn:
            current = conn.execute(
                "SELECT * FROM connector_receipts WHERE workspace_id=%s AND connector=%s AND intent_id=%s FOR UPDATE",
                (workspace_id, CONNECTOR_KIND, intent_id),
            ).fetchone()
            if current is None:
                raise ConnectorLedgerError("connector receipt does not exist")
            if current["revision"] != expected_revision:
                raise ConnectorLedgerError("connector receipt revision is stale")
            if current["status"] in {"succeeded", "revoked", "cancelled"} and status != current["status"]:
                raise ConnectorLedgerError("terminal connector receipt cannot be rewritten")
            updated = conn.execute(
                """
                UPDATE connector_receipts
                SET status=%s,external_id=%s,remote_revision=%s,response_json=%s::jsonb,
                    error_code=%s,revision=revision+1,updated_at_utc=%s
                WHERE workspace_id=%s AND connector=%s AND intent_id=%s AND revision=%s
                RETURNING *
                """,
                (
                    status,
                    external_id,
                    remote_revision,
                    json.dumps(response, sort_keys=True),
                    error_code,
                    now,
                    workspace_id,
                    CONNECTOR_KIND,
                    intent_id,
                    expected_revision,
                ),
            ).fetchone()
            if updated is None:
                raise ConnectorLedgerError("connector receipt update lost its revision race")
            conn.execute(
                "UPDATE connector_intents SET status=%s,updated_at_utc=%s WHERE workspace_id=%s AND connector=%s AND intent_id=%s",
                (status, now, workspace_id, CONNECTOR_KIND, intent_id),
            )
            conn.commit()
        return {"duplicate": False, "receipt": self._connector_row(updated)}

    @contextmanager
    def dataset_mutation(self, workspace_id, dataset_id):
        key = int.from_bytes(hashlib.sha256(f'dataset-mutation:{workspace_id}:{dataset_id}'.encode()).digest()[:8], 'big', signed=True)
        with self.dedicated_connection() as conn:
            conn.execute('SELECT pg_advisory_lock(%s)', (key,))
            try:
                yield
            finally:
                conn.execute('SELECT pg_advisory_unlock(%s)', (key,))

    @contextmanager
    def dataset_removal(self, workspace_id, dataset_id):
        from .local_datasets import DatasetInUse
        with self.connect() as conn:
            row = conn.execute('SELECT manifest_json FROM datasets WHERE workspace_id=%s AND dataset_id=%s FOR UPDATE', (workspace_id, dataset_id)).fetchone()
            if row:
                research = conn.execute('SELECT 1 FROM research_jobs WHERE workspace_id=%s AND dataset_id=%s LIMIT 1', (workspace_id, dataset_id)).fetchone()
                replay = conn.execute("SELECT 1 FROM workspace_record_revisions WHERE workspace_id=%s AND kind='replay' AND (payload_json->>'dataset_id'=%s OR payload_json->'dataset_ids' ? %s) LIMIT 1", (workspace_id, dataset_id, dataset_id)).fetchone()
                prop = conn.execute("SELECT 1 FROM prop_attempt_revisions WHERE workspace_id=%s AND jsonb_path_exists(resume_json, '$.**.dataset_id ? (@ == $id)', %s::jsonb) LIMIT 1", (workspace_id, json.dumps({'id': dataset_id}))).fetchone()
                if research or replay or prop:
                    raise DatasetInUse('dataset_in_use')
            yield DatasetManifest.model_validate(row['manifest_json']) if row else None
            if row:
                conn.execute('DELETE FROM datasets WHERE workspace_id=%s AND dataset_id=%s', (workspace_id, dataset_id))
            conn.commit()

    @staticmethod
    def _lock_replay_dataset(conn, workspace_id, kind, payload):
        if kind == 'replay' and payload.get('dataset_id'):
            for dataset_id in sorted(set(payload.get('dataset_ids') or [payload['dataset_id']])):
                row = conn.execute('SELECT 1 FROM datasets WHERE workspace_id=%s AND dataset_id=%s FOR KEY SHARE', (workspace_id, dataset_id)).fetchone()
                if not row:
                    raise LookupError('dataset_not_found')

    @staticmethod
    def _lock_resume_datasets(conn, workspace_id, resume):
        pending, identifiers = [resume], set()
        while pending:
            value = pending.pop()
            if isinstance(value, dict):
                if isinstance(value.get('dataset_id'), str):
                    identifiers.add(value['dataset_id'])
                pending.extend(value.values())
            elif isinstance(value, list):
                pending.extend(value)
        for dataset_id in sorted(identifiers):
            PostgresStore._lock_replay_dataset(conn, workspace_id, 'replay', {'dataset_id': dataset_id})

    def put_dataset(self, manifest: DatasetManifest, *, conn=None) -> None:
        if conn is None:
            with self.connect() as owned:
                self.put_dataset(manifest, conn=owned)
            return
        conn.execute(
            """
            INSERT INTO datasets(workspace_id,dataset_id,manifest_json,artifact_sha256,created_at_utc)
            VALUES(%s,%s,%s::jsonb,%s,%s)
            """,
            (
                manifest.workspace_id,
                manifest.dataset_id,
                json.dumps(manifest.model_dump(mode="json"), sort_keys=True),
                manifest.artifact_sha256,
                manifest.created_at_utc,
            ),
        )

    def get_dataset(self, workspace_id: str, dataset_id: str) -> DatasetManifest | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT manifest_json FROM datasets WHERE workspace_id=%s AND dataset_id=%s",
                (workspace_id, dataset_id),
            ).fetchone()
        return DatasetManifest.model_validate(row["manifest_json"]) if row else None

    def list_datasets(self, workspace_id: str) -> list[DatasetManifest]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT manifest_json FROM datasets WHERE workspace_id=%s ORDER BY created_at_utc DESC,dataset_id",
                (workspace_id,),
            ).fetchall()
        return [DatasetManifest.model_validate(row["manifest_json"]) for row in rows]

    def create_job(self, workspace_id: str, dataset_id: str, strategy_version: str, starting_balance: float,
                   *, idempotency_key: str | None = None) -> ResearchJobView:
        job_id = uuid4().hex
        now = utc_now_iso()
        fingerprint = self._job_request_fingerprint(idempotency_key, {
            "dataset_id": dataset_id, "strategy_version": strategy_version,
            "starting_balance": starting_balance,
        })
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO research_jobs(
                    workspace_id,job_id,dataset_id,strategy_version,starting_balance,status,created_at_utc,updated_at_utc,
                    idempotency_key,request_fingerprint
                ) VALUES(%s,%s,%s,%s,%s,'queued',%s,%s,%s,%s) ON CONFLICT DO NOTHING
                """,
                (workspace_id, job_id, dataset_id, strategy_version, starting_balance, now, now,
                 idempotency_key, fingerprint),
            )
            job_id = self._job_idempotency_result(conn, workspace_id, job_id, idempotency_key, fingerprint)
            conn.commit()
        return self.get_job(workspace_id, job_id)

    def create_engine_job(
        self,
        workspace_id: str,
        dataset_id: str,
        starting_balance: float,
        protocol: dict,
        protocol_sha256: str,
        *, idempotency_key: str | None = None,
    ) -> ResearchJobView:
        job_id = uuid4().hex
        now = utc_now_iso()
        fingerprint = self._job_request_fingerprint(idempotency_key, {
            "dataset_id": dataset_id, "strategy_version": "bar-breakout-v1",
            "starting_balance": starting_balance, "protocol": protocol, "protocol_sha256": protocol_sha256,
        })
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO research_jobs(
                    workspace_id,job_id,dataset_id,strategy_version,starting_balance,status,
                    protocol_json,protocol_sha256,created_at_utc,updated_at_utc,idempotency_key,request_fingerprint
                ) VALUES(%s,%s,%s,'bar-breakout-v1',%s,'queued',%s::jsonb,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING
                """,
                (
                    workspace_id,
                    job_id,
                    dataset_id,
                    starting_balance,
                    json.dumps(protocol, sort_keys=True),
                    protocol_sha256,
                    now,
                    now,
                    idempotency_key,
                    fingerprint,
                ),
            )
            job_id = self._job_idempotency_result(conn, workspace_id, job_id, idempotency_key, fingerprint)
            conn.commit()
        return self.get_job(workspace_id, job_id)

    @staticmethod
    def _job_request_fingerprint(idempotency_key, payload):
        if idempotency_key is None:
            return None
        if not isinstance(idempotency_key, str) or not idempotency_key.strip() or len(idempotency_key) > 200:
            raise ValueError("job idempotency key must contain 1 to 200 characters")
        return _payload_fingerprint(payload)

    @staticmethod
    def _job_idempotency_result(conn, workspace_id, job_id, idempotency_key, fingerprint):
        if idempotency_key is None:
            return job_id
        row = conn.execute("SELECT job_id,request_fingerprint FROM research_jobs WHERE workspace_id=%s AND idempotency_key=%s",
                           (workspace_id, idempotency_key)).fetchone()
        if row is None or row["request_fingerprint"] != fingerprint:
            raise JobIdempotencyConflict("job idempotency key was reused with different content")
        return row["job_id"]

    def get_job(self, workspace_id: str, job_id: str) -> ResearchJobView | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM research_jobs WHERE workspace_id=%s AND job_id=%s",
                (workspace_id, job_id),
            ).fetchone()
        if not row:
            return None
        return ResearchJobView(
            job_id=row["job_id"],
            workspace_id=row["workspace_id"],
            dataset_id=row["dataset_id"],
            strategy_version=row["strategy_version"],
            starting_balance=float(row["starting_balance"]),
            protocol_sha256=row.get("protocol_sha256"),
            protocol=row.get("protocol_json"),
            status=row["status"],
            cancel_requested=bool(row["cancel_requested"]),
            result_path=row["result_path"],
            result_sha256=row["result_sha256"],
            error_code=row["error_code"],
            created_at_utc=row["created_at_utc"],
            updated_at_utc=row["updated_at_utc"],
        )

    def update_job_checkpoint(
        self,
        job: ClaimedJob,
        *,
        checkpoint: dict,
        progress: dict | None = None,
    ) -> bool:
        """Persist resumable worker state only for the current lease owner."""
        checkpoint, progress = validate_research_checkpoint_view(checkpoint, progress)
        now = utc_now_iso()
        with self.connect() as conn:
            updated = conn.execute(
                """
                UPDATE research_jobs
                SET checkpoint_json=%s::jsonb,
                    progress_json=COALESCE(%s::jsonb, progress_json),
                    updated_at_utc=%s
                WHERE workspace_id=%s AND job_id=%s AND status='running'
                  AND attempt_no=%s AND lease_owner=%s AND lease_token=%s
                  AND lease_expires_at_utc > CURRENT_TIMESTAMP
                """,
                (
                    json.dumps(checkpoint, sort_keys=True),
                    json.dumps(progress, sort_keys=True) if progress is not None else None,
                    now,
                    job.workspace_id,
                    job.job_id,
                    job.attempt_no,
                    job.lease_owner,
                    job.lease_token,
                ),
            )
            conn.commit()
        return updated.rowcount == 1

    def get_job_checkpoint(self, workspace_id: str, job_id: str) -> dict | None:
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT checkpoint_json,progress_json,attempt_no,status,updated_at_utc
                FROM research_jobs
                WHERE workspace_id=%s AND job_id=%s
                """,
                (workspace_id, job_id),
            ).fetchone()
        if not row or row["checkpoint_json"] is None:
            return None
        checkpoint, progress = validate_research_checkpoint_view(
            row["checkpoint_json"], row["progress_json"]
        )
        return {
            "checkpoint": checkpoint,
            "progress": progress,
            "current_attempt_no": int(row["attempt_no"]),
            "status": row["status"],
            "updated_at_utc": row["updated_at_utc"],
        }

    def _recover_expired_jobs(self, conn, now: str) -> list[dict]:
        return conn.execute(
            """
            UPDATE research_jobs
            SET status=CASE WHEN cancel_requested THEN 'canceled'
                            WHEN attempt_no >= max_attempts THEN 'failed' ELSE 'queued' END,
                error_code=CASE WHEN cancel_requested THEN NULL
                                WHEN attempt_no >= max_attempts THEN 'LEASE_RETRY_EXHAUSTED'
                                ELSE 'LEASE_EXPIRED' END,
                available_at_utc=CURRENT_TIMESTAMP + (
                    LEAST(300.0,retry_base_seconds * power(2.0,LEAST(attempt_no - 1,16)))
                    * (0.8 + random() * 0.4) * INTERVAL '1 second'),
                lease_owner=NULL,
                lease_token=NULL,
                lease_expires_at_utc=NULL,
                updated_at_utc=%s
            WHERE status='running'
              AND (lease_expires_at_utc IS NULL OR lease_expires_at_utc <= CURRENT_TIMESTAMP)
            RETURNING workspace_id,job_id,status
            """,
            (now,),
        ).fetchall()

    def recover_expired_jobs(self) -> list[dict]:
        now = utc_now_iso()
        with self.connect() as conn:
            recovered = self._recover_expired_jobs(conn, now)
            conn.commit()
        return recovered

    def terminal_jobs_requiring_candidate_cleanup(self) -> list[dict]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT workspace_id,job_id,status
                FROM research_jobs
                WHERE status IN ('canceled','failed') AND result_path IS NULL
                ORDER BY updated_at_utc,workspace_id,job_id
                """
            ).fetchall()
        return [dict(row) for row in rows]

    def claim_next_job(
        self,
        worker_id: str = "local-worker",
        lease_seconds: int = 30,
        max_active_jobs: int | None = None,
    ) -> ClaimedJob | None:
        worker_id = worker_id.strip()
        if not worker_id:
            raise ValueError("worker_id is required")
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")
        if max_active_jobs is not None and max_active_jobs <= 0:
            raise ValueError("max_active_jobs must be positive")
        lease_token = uuid4().hex
        with self.connect() as conn:
            now = utc_now_iso()
            self._recover_expired_jobs(conn, now)
            if max_active_jobs is not None:
                # Every capped product worker claim must use this transaction lock so
                # the active-count check and the following claim share one admission gate.
                conn.execute("SELECT pg_advisory_xact_lock(%s)", (RESEARCH_JOB_ADMISSION_LOCK_KEY,))
                active = conn.execute(
                    """
                    SELECT count(*) AS n
                    FROM research_jobs
                    WHERE status='running'
                      AND cancel_requested=false
                      AND lease_expires_at_utc > CURRENT_TIMESTAMP
                    """
                ).fetchone()["n"]
                if int(active) >= max_active_jobs:
                    conn.commit()
                    return None
            row = conn.execute(
                """
                SELECT workspace_id,job_id,dataset_id,strategy_version,starting_balance,attempt_no,
                       protocol_json,protocol_sha256
                FROM research_jobs
                WHERE status='queued' AND cancel_requested=false
                  AND attempt_no < max_attempts AND available_at_utc <= CURRENT_TIMESTAMP
                ORDER BY created_at_utc, job_id
                FOR UPDATE SKIP LOCKED
                LIMIT 1
                """
            ).fetchone()
            if not row:
                conn.commit()
                return None
            claimed = conn.execute(
                """
                UPDATE research_jobs
                SET status='running',
                    attempt_no=attempt_no+1,
                    lease_owner=%s,
                    lease_token=%s,
                    lease_expires_at_utc=CURRENT_TIMESTAMP + (%s * INTERVAL '1 second'),
                    updated_at_utc=%s,
                    error_code=NULL
                WHERE workspace_id=%s AND job_id=%s AND status='queued' AND cancel_requested=false
                RETURNING attempt_no
                """,
                (worker_id, lease_token, lease_seconds, now, row["workspace_id"], row["job_id"]),
            ).fetchone()
            if claimed is None:
                conn.rollback()
                return None
            conn.commit()
        return ClaimedJob(
            workspace_id=row["workspace_id"],
            job_id=row["job_id"],
            dataset_id=row["dataset_id"],
            strategy_version=row["strategy_version"],
            starting_balance=float(row["starting_balance"]),
            protocol=row["protocol_json"],
            protocol_sha256=row["protocol_sha256"],
            attempt_no=int(claimed["attempt_no"]),
            lease_owner=worker_id,
            lease_token=lease_token,
        )

    def renew_job_lease(self, job: ClaimedJob, lease_seconds: int = 30) -> bool:
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")
        now = utc_now_iso()
        with self.connect() as conn:
            updated = conn.execute(
                """
                UPDATE research_jobs
                SET lease_expires_at_utc=CURRENT_TIMESTAMP + (%s * INTERVAL '1 second'),updated_at_utc=%s
                WHERE workspace_id=%s AND job_id=%s AND status='running'
                  AND attempt_no=%s AND lease_owner=%s AND lease_token=%s
                  AND cancel_requested=false
                  AND lease_expires_at_utc > CURRENT_TIMESTAMP
                """,
                (
                    lease_seconds,
                    now,
                    job.workspace_id,
                    job.job_id,
                    job.attempt_no,
                    job.lease_owner,
                    job.lease_token,
                ),
            )
            conn.commit()
        return updated.rowcount == 1

    def complete_job(self, job: ClaimedJob, result_path: str, result_sha256: str) -> bool:
        now = utc_now_iso()
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT status,cancel_requested,attempt_no,lease_owner,lease_token,
                       (lease_expires_at_utc > CURRENT_TIMESTAMP) AS lease_valid
                FROM research_jobs
                WHERE workspace_id=%s AND job_id=%s
                FOR UPDATE
                """,
                (job.workspace_id, job.job_id),
            ).fetchone()
            if row is not None and row["status"] == "canceled" and bool(row["cancel_requested"]):
                conn.rollback()
                return False
            if (
                row is None
                or row["status"] != "running"
                or int(row["attempt_no"]) != job.attempt_no
                or row["lease_owner"] != job.lease_owner
                or row["lease_token"] != job.lease_token
                or not bool(row["lease_valid"])
            ):
                conn.rollback()
                raise StaleJobAttempt("job completion rejected for stale or expired attempt")
            if bool(row["cancel_requested"]):
                conn.execute(
                    """
                    UPDATE research_jobs
                    SET status='canceled',result_path=NULL,result_sha256=NULL,
                        lease_owner=NULL,lease_token=NULL,lease_expires_at_utc=NULL,updated_at_utc=%s
                    WHERE workspace_id=%s AND job_id=%s
                    """,
                    (now, job.workspace_id, job.job_id),
                )
                conn.commit()
                return False
            conn.execute(
                """
                UPDATE research_jobs
                SET status='completed',result_path=%s,result_sha256=%s,error_code=NULL,
                    lease_owner=NULL,lease_token=NULL,lease_expires_at_utc=NULL,updated_at_utc=%s
                WHERE workspace_id=%s AND job_id=%s
                """,
                (result_path, result_sha256, now, job.workspace_id, job.job_id),
            )
            conn.commit()
        return True

    def cancel_job(self, workspace_id: str, job_id: str) -> ResearchJobView | None:
        now = utc_now_iso()
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT status,attempt_no,protocol_json,checkpoint_json,progress_json
                FROM research_jobs
                WHERE workspace_id=%s AND job_id=%s
                FOR UPDATE
                """,
                (workspace_id, job_id),
            ).fetchone()
            if not row:
                conn.rollback()
                return None
            cancellation_state = _oos_cancellation_state(row)
            checkpoint_json = json.dumps(cancellation_state[0], sort_keys=True) if cancellation_state else None
            progress_json = json.dumps(cancellation_state[1], sort_keys=True) if cancellation_state else None
            if row["status"] == "queued":
                conn.execute(
                    """
                    UPDATE research_jobs
                    SET status='canceled',cancel_requested=true,
                        checkpoint_json=COALESCE(%s::jsonb,checkpoint_json),
                        progress_json=COALESCE(%s::jsonb,progress_json),
                        updated_at_utc=%s
                    WHERE workspace_id=%s AND job_id=%s
                    """,
                    (checkpoint_json, progress_json, now, workspace_id, job_id),
                )
            elif row["status"] == "running":
                conn.execute(
                    """
                    UPDATE research_jobs
                    SET status='canceled',cancel_requested=true,result_path=NULL,result_sha256=NULL,
                        checkpoint_json=COALESCE(%s::jsonb,checkpoint_json),
                        progress_json=COALESCE(%s::jsonb,progress_json),
                        lease_owner=NULL,lease_token=NULL,lease_expires_at_utc=NULL,updated_at_utc=%s
                    WHERE workspace_id=%s AND job_id=%s
                    """,
                    (checkpoint_json, progress_json, now, workspace_id, job_id),
                )
            conn.commit()
        return self.get_job(workspace_id, job_id)

    def is_cancel_requested(self, workspace_id: str, job_id: str) -> bool:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT cancel_requested FROM research_jobs WHERE workspace_id=%s AND job_id=%s",
                (workspace_id, job_id),
            ).fetchone()
        return bool(row and row["cancel_requested"])

    def mark_canceled(self, job: ClaimedJob) -> bool:
        now = utc_now_iso()
        with self.connect() as conn:
            updated = conn.execute(
                """
                UPDATE research_jobs
                SET status='canceled',cancel_requested=true,result_path=NULL,result_sha256=NULL,
                    lease_owner=NULL,lease_token=NULL,lease_expires_at_utc=NULL,updated_at_utc=%s
                WHERE workspace_id=%s AND job_id=%s AND status='running'
                  AND attempt_no=%s AND lease_owner=%s AND lease_token=%s
                  AND cancel_requested=true
                  AND lease_expires_at_utc > CURRENT_TIMESTAMP
                """,
                (now, job.workspace_id, job.job_id, job.attempt_no, job.lease_owner, job.lease_token),
            )
            conn.commit()
        return updated.rowcount == 1

    def fail_job(self, job: ClaimedJob, error_code: str) -> bool:
        now = utc_now_iso()
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT cancel_requested
                FROM research_jobs
                WHERE workspace_id=%s AND job_id=%s AND status='running'
                  AND attempt_no=%s AND lease_owner=%s AND lease_token=%s
                  AND lease_expires_at_utc > CURRENT_TIMESTAMP
                FOR UPDATE
                """,
                (job.workspace_id, job.job_id, job.attempt_no, job.lease_owner, job.lease_token),
            ).fetchone()
            if row is None:
                conn.rollback()
                return False
            status = "canceled" if bool(row["cancel_requested"]) else "failed"
            conn.execute(
                """
                UPDATE research_jobs
                SET status=%s,error_code=%s,lease_owner=NULL,lease_token=NULL,
                    lease_expires_at_utc=NULL,updated_at_utc=%s
                WHERE workspace_id=%s AND job_id=%s
                """,
                (status, None if status == "canceled" else error_code, now, job.workspace_id, job.job_id),
            )
            conn.commit()
        return True

    def retry_job(self, job: ClaimedJob, error_code: str) -> bool:
        """Schedule only a caller-classified transient failure of the current attempt.

        Deterministic validation/execution failures retain fail_job's terminal
        semantics. A lease token fences both scheduling and final exhaustion.
        """
        with self.connect() as conn:
            updated = conn.execute(
                """UPDATE research_jobs
                   SET status=CASE WHEN cancel_requested THEN 'canceled'
                                   WHEN attempt_no >= max_attempts THEN 'failed' ELSE 'queued' END,
                       error_code=CASE WHEN cancel_requested THEN NULL ELSE %s END,
                       available_at_utc=CURRENT_TIMESTAMP + (
                           LEAST(300.0,retry_base_seconds * power(2.0,LEAST(attempt_no - 1,16)))
                           * (0.8 + random() * 0.4) * INTERVAL '1 second'),
                       lease_owner=NULL,lease_token=NULL,lease_expires_at_utc=NULL,updated_at_utc=%s
                   WHERE workspace_id=%s AND job_id=%s AND status='running'
                     AND attempt_no=%s AND lease_owner=%s AND lease_token=%s
                     AND lease_expires_at_utc > CURRENT_TIMESTAMP""",
                (error_code, utc_now_iso(), job.workspace_id, job.job_id,
                 job.attempt_no, job.lease_owner, job.lease_token),
            )
        return updated.rowcount == 1

    def record_replay_activity(self, workspace_id, session_id, event_id, start, end):
        # Share the record lock with delete; never resurrect a deleted session.
        with self.connect() as conn:
            record = conn.execute("""
                SELECT v.deleted FROM workspace_records r
                JOIN workspace_record_revisions v
                  ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id
                 AND v.revision=r.current_revision
                WHERE r.workspace_id=%s AND r.kind='replay' AND r.record_id=%s
                FOR UPDATE OF r
            """, (workspace_id, session_id)).fetchone()
            if record is None or record["deleted"]:
                raise LookupError("replay session not found")
            inserted = conn.execute("""
                INSERT INTO replay_activity_intervals(workspace_id,session_id,event_id,started_at_utc,ended_at_utc)
                VALUES(%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING RETURNING event_id
            """, (workspace_id, session_id, event_id, start, end)).fetchone()
            if inserted is None:
                prior = conn.execute("""
                    SELECT started_at_utc,ended_at_utc FROM replay_activity_intervals
                    WHERE workspace_id=%s AND session_id=%s AND event_id=%s
                """, (workspace_id, session_id, event_id)).fetchone()
                if prior["started_at_utc"] != start or prior["ended_at_utc"] != end:
                    raise RuntimeError("activity_event_id_conflict")
            conn.commit()
        return {"schema_version": "replay-activity-v1", "session_id": session_id,
                "event_id": str(event_id), "duplicate": inserted is None,
                "accepted_seconds": (end - start).total_seconds()}

    def list_replay_activity(self, workspace_id):
        # Merge adjacent/overlapping heartbeat intervals per session in SQL so
        # Dashboard never transfers every heartbeat from a long practice run.
        with self.connect() as conn:
            rows = conn.execute("""
                WITH ordered AS (
                    SELECT session_id,event_id,started_at_utc,ended_at_utc,
                        max(ended_at_utc) OVER (
                            PARTITION BY session_id ORDER BY started_at_utc,ended_at_utc,event_id
                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous_end
                    FROM replay_activity_intervals WHERE workspace_id=%s
                ), islands AS (
                    SELECT *, sum(CASE WHEN previous_end IS NULL OR started_at_utc > previous_end
                                      THEN 1 ELSE 0 END) OVER (
                        PARTITION BY session_id ORDER BY started_at_utc,ended_at_utc,event_id
                        ROWS UNBOUNDED PRECEDING) AS island
                    FROM ordered
                )
                SELECT session_id,min(started_at_utc) AS started_at_utc,max(ended_at_utc) AS ended_at_utc
                FROM islands GROUP BY session_id,island
            """, (workspace_id,)).fetchall()
        return rows

    def create_record(self, workspace_id: str, kind: str, payload: dict, *, source_key: str | None = None) -> dict:
        self.ensure_workspace(workspace_id)
        record_id = uuid4().hex
        now = utc_now_iso()
        with self.connect() as conn:
            self._lock_replay_dataset(conn, workspace_id, kind, payload)
            conn.execute(
                """
                INSERT INTO workspace_records(
                    workspace_id,kind,record_id,source_key,current_revision,created_at_utc,updated_at_utc
                ) VALUES(%s,%s,%s,%s,1,%s,%s)
                """,
                (workspace_id, kind, record_id, source_key, now, now),
            )
            conn.execute(
                """
                INSERT INTO workspace_record_revisions(
                    workspace_id,kind,record_id,revision,payload_json,deleted,created_at_utc
                ) VALUES(%s,%s,%s,1,%s::jsonb,false,%s)
                """,
                (workspace_id, kind, record_id, json.dumps(payload, sort_keys=True), now),
            )
            conn.commit()
        return self.get_record(workspace_id, kind, record_id)

    def create_replay_branch_record(
        self,
        workspace_id: str,
        parent_session_id: str,
        expected_parent_revision: int,
        record_id: str,
        payload: dict,
    ) -> dict:
        """Create one Replay branch while revision-fencing the immutable parent head."""

        self.ensure_workspace(workspace_id)
        now = utc_now_iso()
        with self.connect() as conn:
            parent = conn.execute(
                """
                SELECT current_revision FROM workspace_records
                WHERE workspace_id=%s AND kind='replay' AND record_id=%s
                FOR UPDATE
                """,
                (workspace_id, parent_session_id),
            ).fetchone()
            if parent is None:
                raise LookupError("record not found")
            if int(parent["current_revision"]) != int(expected_parent_revision):
                raise RuntimeError("record revision conflict")
            conn.execute(
                """
                INSERT INTO workspace_records(
                    workspace_id,kind,record_id,source_key,current_revision,created_at_utc,updated_at_utc
                ) VALUES(%s,'replay',%s,NULL,1,%s,%s)
                """,
                (workspace_id, record_id, now, now),
            )
            conn.execute(
                """
                INSERT INTO workspace_record_revisions(
                    workspace_id,kind,record_id,revision,payload_json,deleted,created_at_utc
                ) VALUES(%s,'replay',%s,1,%s::jsonb,false,%s)
                """,
                (workspace_id, record_id, json.dumps(payload, sort_keys=True), now),
            )
            conn.commit()
        return self.get_record(workspace_id, "replay", record_id)

    def get_record(self, workspace_id: str, kind: str, record_id: str) -> dict | None:
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT r.record_id,r.source_key,r.current_revision,r.created_at_utc,r.updated_at_utc,
                       v.payload_json,v.deleted
                FROM workspace_records r
                JOIN workspace_record_revisions v
                  ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id
                 AND v.revision=r.current_revision
                WHERE r.workspace_id=%s AND r.kind=%s AND r.record_id=%s
                """,
                (workspace_id, kind, record_id),
            ).fetchone()
        if not row or (kind == "replay" and row["deleted"]):
            return None
        return {
            "record_id": row["record_id"],
            "source_key": row["source_key"],
            "revision": int(row["current_revision"]),
            "payload": row["payload_json"],
            "deleted": bool(row["deleted"]),
            "created_at_utc": row["created_at_utc"],
            "updated_at_utc": row["updated_at_utc"],
        }

    def list_records(self, workspace_id: str, kind: str) -> list[dict]:
        with self.connect() as conn:
            rows = conn.execute(
                """SELECT r.record_id,r.source_key,r.current_revision,r.created_at_utc,r.updated_at_utc,
                          v.payload_json,v.deleted
                   FROM workspace_records r
                   JOIN workspace_record_revisions v
                     ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id
                    AND v.revision=r.current_revision
                   WHERE r.workspace_id=%s AND r.kind=%s AND v.deleted=false
                   ORDER BY r.updated_at_utc DESC,r.record_id""",
                (workspace_id, kind),
            ).fetchall()
        return [{"record_id": row["record_id"], "source_key": row["source_key"],
                 "revision": int(row["current_revision"]), "payload": row["payload_json"],
                 "deleted": bool(row["deleted"]), "created_at_utc": row["created_at_utc"],
                 "updated_at_utc": row["updated_at_utc"]} for row in rows]

    def list_record_heads(self, workspace_id: str, kind: str) -> list[dict]:
        """Revision identity without reading/de-TOASTing execution or journal JSON."""
        with self.connect() as conn:
            rows = conn.execute("""
                SELECT r.record_id,r.current_revision
                FROM workspace_records r JOIN workspace_record_revisions v
                  ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id
                 AND v.revision=r.current_revision
                WHERE r.workspace_id=%s AND r.kind=%s AND v.deleted=false
                ORDER BY r.updated_at_utc DESC,r.record_id
            """, (workspace_id, kind)).fetchall()
        return [{"record_id": row["record_id"], "revision": int(row["current_revision"]),
                 "payload": {}} for row in rows]

    def records_at_heads(self, workspace_id: str, kind: str, heads: list[dict], *, session_ids=None, trade_ids=None, metadata_only=False) -> list[dict]:
        """Read immutable revisions selected by the caller, preserving head order.

        Current revision can advance between reads. Fetching the captured version
        avoids caching a newer payload under an older revision identity.
        """
        if not heads:
            return []
        clauses, params = [], [workspace_id, kind, [head['record_id'] for head in heads],
                                [head['revision'] for head in heads]]
        for ids, aliases in ((session_ids, ('session_id', 'replay_session_id')),
                             (trade_ids, ('trade_id', 'id'))):
            if ids is not None:
                clauses.append("(" + " OR ".join(
                    "v.payload_json->'source'->>%s = ANY(%s)" for _ in aliases) + ")")
                for alias in aliases:
                    params.extend([alias, list(ids)])
        extra = " AND " + " AND ".join(clauses) if clauses else ""
        with self.connect() as conn:
            payload = "jsonb_build_object('timing',v.payload_json->'timing')" if metadata_only else "v.payload_json"
            rows = conn.execute(f"""
                SELECT v.record_id,v.revision,{payload} AS payload_json,v.deleted,v.created_at_utc,
                       r.source_key,r.created_at_utc AS record_created_at_utc,
                       v.created_at_utc AS updated_at_utc
                FROM unnest(%s::text[],%s::integer[]) WITH ORDINALITY AS h(record_id,revision,position)
                JOIN workspace_record_revisions v ON v.record_id=h.record_id AND v.revision=h.revision
                JOIN workspace_records r ON r.workspace_id=v.workspace_id AND r.kind=v.kind AND r.record_id=v.record_id
                WHERE v.workspace_id=%s AND v.kind=%s AND v.deleted=false
            """ + extra + " ORDER BY h.position", params[2:4] + params[:2] + params[4:]).fetchall()
        return [{"record_id": row['record_id'], "revision": int(row['revision']),
                 "source_key": row['source_key'], "payload": row['payload_json'], "deleted": False,
                 "created_at_utc": row['record_created_at_utc'], "updated_at_utc": row['updated_at_utc']} for row in rows]

    def list_journal_records(self, workspace_id: str, *, session_ids=None, trade_ids=None) -> list[dict]:
        if session_ids is None and trade_ids is None:
            return self.list_records(workspace_id, "journal")
        return self.records_at_heads(workspace_id, "journal", self.list_record_heads(workspace_id, "journal"),
                                     session_ids=session_ids, trade_ids=trade_ids)

    def list_record_revisions(self, workspace_id: str, kind: str, record_id: str) -> list[dict]:
        with self.connect() as conn:
            exists = conn.execute(
                "SELECT 1 FROM workspace_records WHERE workspace_id=%s AND kind=%s AND record_id=%s",
                (workspace_id, kind, record_id),
            ).fetchone()
            if not exists:
                raise LookupError("record not found")
            rows = conn.execute(
                """
                SELECT revision,payload_json,deleted,created_at_utc
                FROM workspace_record_revisions
                WHERE workspace_id=%s AND kind=%s AND record_id=%s
                ORDER BY revision
                """,
                (workspace_id, kind, record_id),
            ).fetchall()
        return [
            {
                "revision": int(row["revision"]),
                "payload": row["payload_json"],
                "deleted": bool(row["deleted"]),
                "created_at_utc": row["created_at_utc"],
            }
            for row in rows
        ]

    def get_record_revision(self, workspace_id: str, kind: str, record_id: str, revision: int) -> dict | None:
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT revision,payload_json,deleted,created_at_utc
                FROM workspace_record_revisions
                WHERE workspace_id=%s AND kind=%s AND record_id=%s AND revision=%s
                """,
                (workspace_id, kind, record_id, int(revision)),
            ).fetchone()
        if row is None:
            return None
        return {
            "record_id": record_id,
            "revision": int(row["revision"]),
            "payload": row["payload_json"],
            "deleted": bool(row["deleted"]),
            "created_at_utc": row["created_at_utc"],
        }

    def update_record(self, workspace_id: str, kind: str, record_id: str, expected_revision: int, payload: dict) -> dict:
        now = utc_now_iso()
        payload_json = json.dumps(payload, sort_keys=True)
        with self.connect() as conn:
            self._lock_replay_dataset(conn, workspace_id, kind, payload)
            current = conn.execute(
                """
                SELECT r.current_revision,r.source_key,r.created_at_utc FROM workspace_records r
                WHERE r.workspace_id=%s AND r.kind=%s AND r.record_id=%s
                FOR UPDATE OF r
                """,
                (workspace_id, kind, record_id),
            ).fetchone()
            if not current:
                raise LookupError("record not found")
            # Read the revision after acquiring the parent lock. A joined query
            # can lose its row when PostgreSQL rechecks a concurrently updated parent.
            version = conn.execute(
                'SELECT deleted FROM workspace_record_revisions WHERE workspace_id=%s AND kind=%s AND record_id=%s AND revision=%s',
                (workspace_id, kind, record_id, current['current_revision']),
            ).fetchone()
            if not version or version['deleted']:
                raise LookupError('record not found')
            if int(current["current_revision"]) != int(expected_revision):
                raise RuntimeError("record revision conflict")
            revision = int(expected_revision) + 1
            conn.execute(
                """
                INSERT INTO workspace_record_revisions(
                    workspace_id,kind,record_id,revision,payload_json,deleted,created_at_utc
                ) VALUES(%s,%s,%s,%s,%s::jsonb,false,%s)
                """,
                (workspace_id, kind, record_id, revision, payload_json, now),
            )
            conn.execute(
                """
                UPDATE workspace_records SET current_revision=%s,updated_at_utc=%s
                WHERE workspace_id=%s AND kind=%s AND record_id=%s
                """,
                (revision, now, workspace_id, kind, record_id),
            )
            conn.commit()
        # A second writer may commit after our lock is released. Return our
        # immutable revision receipt, not whichever revision is current later.
        return {
            "record_id": record_id,
            "source_key": current["source_key"],
            "revision": revision,
            "payload": json.loads(payload_json),
            "deleted": False,
            "created_at_utc": current["created_at_utc"],
            "updated_at_utc": now,
        }

    def delete_annotation(self, workspace_id: str, record_id: str, expected_revision: int) -> dict:
        if isinstance(expected_revision, bool) or not isinstance(expected_revision, int) or expected_revision < 1:
            raise ValueError("expected_revision must be a positive integer")
        now = utc_now_iso()
        with self.connect() as conn:
            current = conn.execute(
                """
                SELECT r.current_revision,v.deleted,v.payload_json FROM workspace_records r
                JOIN workspace_record_revisions v
                  ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id
                 AND v.revision=r.current_revision
                WHERE r.workspace_id=%s AND r.kind='annotation' AND r.record_id=%s
                FOR UPDATE OF r
                """,
                (workspace_id, record_id),
            ).fetchone()
            if current is None or current["deleted"]:
                raise LookupError("annotation not found")
            if current["current_revision"] != expected_revision:
                raise RuntimeError("record revision conflict")
            revision = expected_revision + 1
            conn.execute(
                """
                INSERT INTO workspace_record_revisions(
                    workspace_id,kind,record_id,revision,payload_json,deleted,created_at_utc
                ) VALUES(%s,'annotation',%s,%s,%s::jsonb,true,%s)
                """,
                (workspace_id, record_id, revision, json.dumps(current["payload_json"], sort_keys=True), now),
            )
            conn.execute(
                """
                UPDATE workspace_records SET current_revision=%s,updated_at_utc=%s
                WHERE workspace_id=%s AND kind='annotation' AND record_id=%s
                """,
                (revision, now, workspace_id, record_id),
            )
            conn.commit()
        return self.get_record(workspace_id, "annotation", record_id)

    def delete_replay_session(self, workspace_id: str, session_id: str, expected_revision: int, confirmation_name: str) -> dict:
        if isinstance(expected_revision, bool) or not isinstance(expected_revision, int) or expected_revision < 1:
            raise ValueError("expected_revision must be a positive integer")
        now = utc_now_iso()
        with self.connect() as conn:
            current = conn.execute(
                """
                SELECT r.current_revision,v.deleted,v.payload_json FROM workspace_records r
                JOIN workspace_record_revisions v
                  ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id
                 AND v.revision=r.current_revision
                WHERE r.workspace_id=%s AND r.kind='replay' AND r.record_id=%s
                FOR UPDATE OF r
                """, (workspace_id, session_id),
            ).fetchone()
            if current is None or current["deleted"]:
                raise LookupError("replay session not found")
            if int(current["current_revision"]) != expected_revision:
                raise RuntimeError("record_revision_conflict")
            if confirmation_name != (current["payload_json"].get("name") or session_id):
                raise ValueError("session_delete_confirmation_mismatch")
            linked = conn.execute(
                """SELECT 1 FROM prop_attempt_revisions WHERE workspace_id=%s
                   AND resume_json->'replay_binding'->>'replay_session_id'=%s LIMIT 1""",
                (workspace_id, session_id),
            ).fetchone()
            if linked:
                raise RuntimeError("replay_linked_to_prop_attempt")
            revision = expected_revision + 1
            # Keep immutable evidence for branches and audit, while canonical
            # reads and mutations cannot restore the deleted session.
            conn.execute(
                """INSERT INTO workspace_record_revisions(
                       workspace_id,kind,record_id,revision,payload_json,deleted,created_at_utc
                   ) VALUES(%s,'replay',%s,%s,%s::jsonb,true,%s)""",
                (workspace_id, session_id, revision, json.dumps(current["payload_json"], sort_keys=True), now),
            )
            conn.execute(
                """UPDATE workspace_records SET current_revision=%s,updated_at_utc=%s
                   WHERE workspace_id=%s AND kind='replay' AND record_id=%s""",
                (revision, now, workspace_id, session_id),
            )
            conn.commit()
        return {"record_id": session_id, "revision": revision, "deleted": True}

    def create_prop_session(self, session: PropSessionSnapshot) -> PropSessionSnapshot:
        if session.revision != 1:
            raise PropPersistenceConflict("new prop sessions must start at revision 1")
        self.ensure_workspace(session.workspace_id)
        payload = session.model_dump(mode="json")
        now = utc_now_iso()
        with self.connect() as conn:
            encoded = json.dumps(payload, sort_keys=True)
            inserted = conn.execute(
                """
                INSERT INTO prop_sessions(
                    workspace_id,session_id,current_revision,snapshot_json,created_at_utc,updated_at_utc
                ) VALUES(%s,%s,1,%s::jsonb,%s,%s)
                ON CONFLICT (workspace_id,session_id) DO NOTHING
                RETURNING session_id
                """,
                (session.workspace_id, session.session_id, encoded, now, now),
            ).fetchone()
            if inserted is None:
                existing = conn.execute(
                    "SELECT snapshot_json FROM prop_sessions WHERE workspace_id=%s AND session_id=%s",
                    (session.workspace_id, session.session_id),
                ).fetchone()
                current = PropSessionSnapshot.model_validate(existing["snapshot_json"])
                if current == session:
                    return current
                raise PropPersistenceConflict("prop session already exists with different content")
            conn.execute(
                """
                INSERT INTO prop_session_revisions(
                    workspace_id,session_id,revision,snapshot_json,created_at_utc
                ) VALUES(%s,%s,1,%s::jsonb,%s)
                """,
                (session.workspace_id, session.session_id, encoded, now),
            )
            conn.commit()
        return session

    def get_prop_session(self, workspace_id: str, session_id: str) -> PropSessionSnapshot | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT snapshot_json FROM prop_sessions WHERE workspace_id=%s AND session_id=%s",
                (workspace_id, session_id),
            ).fetchone()
        return _stored_prop_snapshot(PropSessionSnapshot, row["snapshot_json"], workspace_id, session_id) if row else None

    def list_prop_sessions(self, workspace_id: str) -> list[PropSessionSnapshot]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT session_id,snapshot_json FROM prop_sessions
                WHERE workspace_id=%s
                ORDER BY updated_at_utc DESC,session_id
                """,
                (workspace_id,),
            ).fetchall()
        return [_stored_prop_snapshot(PropSessionSnapshot, row["snapshot_json"], workspace_id, row["session_id"]) for row in rows]

    def update_prop_session(
        self,
        session: PropSessionSnapshot,
        *,
        expected_revision: int,
        operation_id: str,
    ) -> dict:
        payload = session.model_dump(mode="json")
        fingerprint = _payload_fingerprint(payload)
        now = utc_now_iso()
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT current_revision,snapshot_json FROM prop_sessions
                WHERE workspace_id=%s AND session_id=%s
                FOR UPDATE
                """,
                (session.workspace_id, session.session_id),
            ).fetchone()
            if row is None:
                raise LookupError("prop session not found")
            receipt = conn.execute(
                """
                SELECT fingerprint,entity_revision FROM prop_mutation_receipts
                WHERE workspace_id=%s AND session_id=%s AND attempt_id='' AND operation_id=%s
                """,
                (session.workspace_id, session.session_id, operation_id),
            ).fetchone()
            if receipt is not None:
                if receipt["fingerprint"] != fingerprint:
                    raise PropIdempotencyConflict("operation_id was already used with different session content")
                revision = conn.execute(
                    """
                    SELECT snapshot_json FROM prop_session_revisions
                    WHERE workspace_id=%s AND session_id=%s AND revision=%s
                    """,
                    (session.workspace_id, session.session_id, int(receipt["entity_revision"])),
                ).fetchone()
                if revision is None:
                    raise PropPersistenceConflict("idempotency receipt points to a missing session revision")
                return {"session": PropSessionSnapshot.model_validate(revision["snapshot_json"]), "duplicate": True}
            current = PropSessionSnapshot.model_validate(row["snapshot_json"])
            if int(row["current_revision"]) != int(expected_revision):
                raise PropPersistenceConflict("prop session revision conflict")
            if session.revision != int(expected_revision) + 1:
                raise PropPersistenceConflict("prop session snapshot revision must advance exactly once")
            if session.mode != current.mode or session.session_type != current.session_type:
                raise PropPersistenceConflict("prop session mode and type are immutable")
            if session.profile.model_dump(mode="json") != current.profile.model_dump(mode="json"):
                raise PropPersistenceConflict("frozen prop profile cannot be changed after session creation")
            if session.status != current.status:
                raise PropPersistenceConflict("prop session lifecycle status is server-owned")

            encoded = json.dumps(payload, sort_keys=True)
            conn.execute(
                """
                INSERT INTO prop_session_revisions(
                    workspace_id,session_id,revision,snapshot_json,created_at_utc
                ) VALUES(%s,%s,%s,%s::jsonb,%s)
                """,
                (session.workspace_id, session.session_id, session.revision, encoded, now),
            )
            conn.execute(
                """
                UPDATE prop_sessions SET current_revision=%s,snapshot_json=%s::jsonb,updated_at_utc=%s
                WHERE workspace_id=%s AND session_id=%s
                """,
                (session.revision, encoded, now, session.workspace_id, session.session_id),
            )
            conn.execute(
                """
                INSERT INTO prop_mutation_receipts(
                    workspace_id,session_id,attempt_id,operation_id,fingerprint,entity_revision,created_at_utc
                ) VALUES(%s,%s,'',%s,%s,%s,%s)
                """,
                (session.workspace_id, session.session_id, operation_id, fingerprint, session.revision, now),
            )
            conn.commit()
        return {"session": session, "duplicate": False}

    @staticmethod
    def _sync_prop_session_status(conn, session: PropSessionSnapshot, status: str, now: str) -> PropSessionSnapshot:
        if session.status == status:
            return session
        updated = session.model_copy(update={"status": status, "revision": session.revision + 1})
        encoded = json.dumps(updated.model_dump(mode="json"), sort_keys=True)
        conn.execute(
            """
            INSERT INTO prop_session_revisions(
                workspace_id,session_id,revision,snapshot_json,created_at_utc
            ) VALUES(%s,%s,%s,%s::jsonb,%s)
            """,
            (updated.workspace_id, updated.session_id, updated.revision, encoded, now),
        )
        conn.execute(
            """
            UPDATE prop_sessions
            SET current_revision=%s,snapshot_json=%s::jsonb,updated_at_utc=%s
            WHERE workspace_id=%s AND session_id=%s
            """,
            (updated.revision, encoded, now, updated.workspace_id, updated.session_id),
        )
        return updated

    @staticmethod
    def _validate_prop_phase_scope(
        session: PropSessionSnapshot,
        attempt: ChallengeAttemptSnapshot,
        phase: PhaseStateSnapshot,
    ) -> None:
        validate_attempt_against_session(session, attempt)
        if (
            phase.workspace_id != attempt.workspace_id
            or phase.session_id != attempt.session_id
            or phase.attempt_id != attempt.attempt_id
        ):
            raise PropSessionContractError("phase state scope does not match attempt")
        if phase.profile_hash != attempt.profile_hash:
            raise PropSessionContractError("phase state profile version mismatch")
        if phase.phase_index > len(session.profile.phases):
            raise PropSessionContractError("phase state references an unknown frozen phase")
        phase_spec = session.profile.phases[phase.phase_index - 1]
        if phase.initial_balance != phase_spec.initial_capital:
            raise PropSessionContractError("phase initial balance does not match frozen phase capital")
        eod_trailing = (
            phase_spec.overall_drawdown.kind == "trailing"
            and phase_spec.overall_drawdown.trailing_granularity == "end_of_day"
        )
        hwm_current = (
            phase.balance
            if phase_spec.overall_drawdown.kind == "trailing"
            and phase_spec.overall_drawdown.basis == "balance"
            else phase.equity
        )
        if not eod_trailing and phase.high_water_mark < hwm_current:
            raise PropSessionContractError("high_water_mark cannot be below current equity")
        if phase.virtual_time_utc < attempt.virtual_start_utc or phase.virtual_time_utc > attempt.virtual_cutoff_utc:
            raise PropSessionContractError("phase virtual time is outside the attempt interval")

    @staticmethod
    def _validate_resume_counts(phase: PhaseStateSnapshot, resume_state: dict) -> None:
        positions = resume_state.get("open_positions")
        pending = resume_state.get("pending_orders")
        if phase.open_positions > 0 and not isinstance(positions, (list, tuple, dict)):
            raise PropPersistenceConflict("resume open_positions are required when the phase has open positions")
        if phase.pending_orders > 0 and not isinstance(pending, (list, tuple, dict)):
            raise PropPersistenceConflict("resume pending_orders are required when the phase has pending orders")
        if positions is not None and not isinstance(positions, (list, tuple, dict)):
            raise PropPersistenceConflict("resume open_positions must be a collection")
        if pending is not None and not isinstance(pending, (list, tuple, dict)):
            raise PropPersistenceConflict("resume pending_orders must be a collection")
        if isinstance(positions, (list, tuple, dict)) and len(positions) != phase.open_positions:
            raise PropPersistenceConflict("resume open_positions do not match the phase snapshot count")
        if isinstance(pending, (list, tuple, dict)) and len(pending) != phase.pending_orders:
            raise PropPersistenceConflict("resume pending_orders do not match the phase snapshot count")

    @staticmethod
    def _cursor_key(resume_state: dict, *, required: bool) -> tuple[int, datetime] | None:
        cursor = resume_state.get("cursor")
        if cursor is None and not required:
            return None
        if not isinstance(cursor, dict):
            raise PropPersistenceConflict("resume cursor is required and must be structured")
        bar_index = cursor.get("bar_index")
        timestamp = cursor.get("timestamp_utc")
        if isinstance(bar_index, bool) or not isinstance(bar_index, int) or bar_index < 0:
            raise PropPersistenceConflict("resume cursor bar_index must be a nonnegative integer")
        if not isinstance(timestamp, str) or not timestamp.strip():
            raise PropPersistenceConflict("resume cursor timestamp_utc is required")
        try:
            parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        except ValueError as exc:
            raise PropPersistenceConflict("resume cursor timestamp_utc must be ISO-8601") from exc
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise PropPersistenceConflict("resume cursor timestamp_utc must be timezone-aware")
        return bar_index, parsed

    @classmethod
    def _validate_resume_cursor(cls, resume_state: dict, previous_resume_state: dict | None = None) -> None:
        current = cls._cursor_key(resume_state, required=True)
        previous = cls._cursor_key(previous_resume_state or {}, required=False)
        if previous is None:
            return
        if current[0] < previous[0] or current[1] < previous[1]:
            raise PropPersistenceConflict("resume cursor cannot move backwards within an attempt")

    def create_prop_branch_attempt(
        self,
        workspace_id: str,
        replay_session_id: str,
        *,
        prop_session_id: str,
        parent_attempt_id: str,
        expected_replay_revision: int,
        expected_parent_replay_revision: int,
        expected_parent_attempt_revision: int,
        operation_id: str,
    ) -> dict:
        """Clone one canonical historical Prop checkpoint onto a Replay hindsight branch."""

        identity = "|".join((workspace_id, prop_session_id, parent_attempt_id, operation_id)).encode("utf-8")
        child_attempt_id = f"branch-{hashlib.sha256(identity).hexdigest()[:40]}"
        mutation_payload = {
            "replay_session_id": replay_session_id,
            "prop_session_id": prop_session_id,
            "parent_attempt_id": parent_attempt_id,
            "expected_replay_revision": int(expected_replay_revision),
            "expected_parent_replay_revision": int(expected_parent_replay_revision),
            "expected_parent_attempt_revision": int(expected_parent_attempt_revision),
            "operation_id": operation_id,
        }
        fingerprint = _payload_fingerprint(mutation_payload)
        now = utc_now_iso()

        with self.connect() as conn:
            preview = conn.execute(
                """SELECT v.payload_json FROM workspace_records r
                   JOIN workspace_record_revisions v
                     ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id
                    AND v.revision=r.current_revision
                   WHERE r.workspace_id=%s AND r.kind='replay' AND r.record_id=%s""",
                (workspace_id, replay_session_id),
            ).fetchone()
            replay_ids = {replay_session_id}
            if preview and preview["payload_json"].get("parent_session_id"):
                replay_ids.add(preview["payload_json"]["parent_session_id"])
            for record_id in sorted(replay_ids):
                self._lock_resume_replay(conn, workspace_id, {"replay_binding": {"replay_session_id": record_id}})
            session_row = conn.execute(
                """
                SELECT snapshot_json FROM prop_sessions
                WHERE workspace_id=%s AND session_id=%s
                FOR UPDATE
                """,
                (workspace_id, prop_session_id),
            ).fetchone()
            if session_row is None:
                raise LookupError("prop session not found")
            session = PropSessionSnapshot.model_validate(session_row["snapshot_json"])

            receipt = conn.execute(
                """
                SELECT fingerprint,entity_revision,created_at_utc FROM prop_mutation_receipts
                WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s AND operation_id=%s
                """,
                (workspace_id, prop_session_id, child_attempt_id, operation_id),
            ).fetchone()
            if receipt is not None:
                if receipt["fingerprint"] != fingerprint:
                    raise PropIdempotencyConflict("operation_id was already used with different Replay branch content")
                created = conn.execute(
                    """
                    SELECT snapshot_json,phase_json,resume_json FROM prop_attempt_revisions
                    WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s
                      AND revision=%s
                    """,
                    (workspace_id, prop_session_id, child_attempt_id, int(receipt["entity_revision"])),
                ).fetchone()
                if created is None:
                    raise PropPersistenceConflict("branch receipt points to a missing child attempt revision")
                created_session = conn.execute(
                    """
                    SELECT snapshot_json FROM prop_session_revisions
                    WHERE workspace_id=%s AND session_id=%s AND created_at_utc<=%s
                    ORDER BY created_at_utc DESC,revision DESC
                    LIMIT 1
                    """,
                    (workspace_id, prop_session_id, receipt["created_at_utc"]),
                ).fetchone()
                if created_session is None:
                    raise PropPersistenceConflict("branch receipt points before prop session history")
                return {
                    "session": PropSessionSnapshot.model_validate(created_session["snapshot_json"]),
                    "attempt": ChallengeAttemptSnapshot.model_validate(created["snapshot_json"]),
                    "phase": PhaseStateSnapshot.model_validate(created["phase_json"]),
                    "resume_state": created["resume_json"],
                    "duplicate": True,
                }

            child_record = conn.execute(
                """
                SELECT current_revision FROM workspace_records
                WHERE workspace_id=%s AND kind='replay' AND record_id=%s
                FOR UPDATE
                """,
                (workspace_id, replay_session_id),
            ).fetchone()
            if child_record is None:
                raise LookupError("replay branch not found")
            if int(child_record["current_revision"]) != int(expected_replay_revision):
                raise PropPersistenceConflict("replay branch revision conflict")
            child_row = conn.execute(
                """
                SELECT payload_json FROM workspace_record_revisions
                WHERE workspace_id=%s AND kind='replay' AND record_id=%s AND revision=%s
                """,
                (workspace_id, replay_session_id, int(expected_replay_revision)),
            ).fetchone()
            child_payload = dict(child_row["payload_json"] if child_row else {})
            parent_replay_id = child_payload.get("parent_session_id")
            if not isinstance(parent_replay_id, str) or not parent_replay_id:
                raise ReplayPropConnectionError("Replay session is not a canonical historical branch")
            if int(child_payload.get("parent_revision", -1)) != int(expected_parent_replay_revision):
                raise PropPersistenceConflict("Replay branch parent revision does not match request")

            parent_record = conn.execute(
                """
                SELECT current_revision FROM workspace_records
                WHERE workspace_id=%s AND kind='replay' AND record_id=%s
                FOR UPDATE
                """,
                (workspace_id, parent_replay_id),
            ).fetchone()
            if parent_record is None:
                raise LookupError("parent replay session not found")
            if int(parent_record["current_revision"]) != int(expected_parent_replay_revision):
                raise PropPersistenceConflict("parent replay revision conflict")
            parent_replay_row = conn.execute(
                """
                SELECT payload_json FROM workspace_record_revisions
                WHERE workspace_id=%s AND kind='replay' AND record_id=%s AND revision=%s
                """,
                (workspace_id, parent_replay_id, int(expected_parent_replay_revision)),
            ).fetchone()
            if parent_replay_row is None:
                raise PropPersistenceConflict("parent replay revision is missing")

            parent_row = conn.execute(
                """
                SELECT current_revision,snapshot_json FROM prop_attempts
                WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s
                FOR UPDATE
                """,
                (workspace_id, prop_session_id, parent_attempt_id),
            ).fetchone()
            if parent_row is None:
                raise LookupError("parent prop attempt not found")
            parent_attempt = ChallengeAttemptSnapshot.model_validate(parent_row["snapshot_json"])
            if int(parent_row["current_revision"]) != int(expected_parent_attempt_revision):
                raise PropPersistenceConflict("parent prop attempt revision conflict")
            if parent_attempt.status not in _TERMINAL_PROP_ATTEMPT_STATUSES:
                raise PropPersistenceConflict("parent prop attempt must be terminal before historical branch")
            if parent_attempt.branch_kind == "hindsight_exploratory":
                raise PropPersistenceConflict("nested hindsight Prop attempt branching is not supported")

            child_execution = child_payload.get("execution")
            parent_execution = parent_replay_row["payload_json"].get("execution")
            if not isinstance(child_execution, dict) or not isinstance(parent_execution, dict):
                raise ReplayPropConnectionError("Replay branch execution checkpoint is unavailable")
            child_snapshot = parse_replay_execution_snapshot(child_execution)
            parent_snapshot = parse_replay_execution_snapshot(parent_execution)
            if child_snapshot.replay_session_id != replay_session_id:
                raise ReplayPropConnectionError("Replay branch execution lineage is inconsistent")

            existing_attempt_rows = conn.execute(
                """
                SELECT attempt_id,snapshot_json FROM prop_attempts
                WHERE workspace_id=%s AND session_id=%s
                FOR UPDATE
                """,
                (workspace_id, prop_session_id),
            ).fetchall()
            for existing_row in existing_attempt_rows:
                existing_attempt = ChallengeAttemptSnapshot.model_validate(existing_row["snapshot_json"])
                if existing_attempt.attempt_id != parent_attempt_id and existing_attempt.status not in _TERMINAL_PROP_ATTEMPT_STATUSES:
                    raise PropPersistenceConflict("prop session already has an active attempt")

            historical_rows = conn.execute(
                """
                SELECT revision,snapshot_json,phase_json,resume_json,created_at_utc
                FROM prop_attempt_revisions
                WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s
                ORDER BY revision DESC
                """,
                (workspace_id, prop_session_id, parent_attempt_id),
            ).fetchall()
            try:
                checkpoint_event = replay_event_for_snapshot(child_snapshot, child_snapshot.ledger[-1])
            except (IndexError, ValueError) as exc:
                raise ReplayPropConnectionError("Replay branch checkpoint event is invalid") from exc
            if checkpoint_event.sequence != child_snapshot.event_sequence:
                raise ReplayPropConnectionError("Replay branch checkpoint event sequence is inconsistent")
            parent_checkpoint_event = None
            for item in reversed(parent_snapshot.ledger):
                try:
                    candidate_event = replay_event_for_snapshot(parent_snapshot, item)
                except ValueError as exc:
                    raise ReplayPropConnectionError("parent Replay checkpoint ledger is invalid") from exc
                if candidate_event.sequence == checkpoint_event.sequence:
                    parent_checkpoint_event = candidate_event
                    break
            if parent_checkpoint_event is None:
                raise ReplayPropConnectionError("parent Replay checkpoint event is missing")

            historical = None
            for candidate in historical_rows:
                candidate_attempt = ChallengeAttemptSnapshot.model_validate(candidate["snapshot_json"])
                candidate_phase = PhaseStateSnapshot.model_validate(candidate["phase_json"])
                candidate_resume = dict(candidate["resume_json"] or {})
                try:
                    validate_replay_prop_branch_checkpoint(
                        child_snapshot,
                        child_payload=child_payload,
                        parent_snapshot=parent_snapshot,
                        historical_attempt=candidate_attempt,
                        phase=candidate_phase,
                        resume_state=candidate_resume,
                    )
                except ReplayPropConnectionError:
                    continue

                receipt_rows = conn.execute(
                    """
                    SELECT operation_id,fingerprint
                    FROM prop_mutation_receipts
                    WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s AND entity_revision=%s
                    """,
                    (workspace_id, prop_session_id, parent_attempt_id, int(candidate["revision"])),
                ).fetchall()
                canonical_receipt = False
                if checkpoint_event.kind == "price_mark":
                    expected_operation_id = replay_event_operation_id(
                        replay_session_id=parent_replay_id,
                        branch_id=parent_snapshot.branch_id,
                        replay_event_sequence=checkpoint_event.sequence,
                        prop_session_id=prop_session_id,
                        prop_attempt_id=parent_attempt_id,
                    )
                    previous = conn.execute(
                        """
                        SELECT snapshot_json,phase_json,resume_json
                        FROM prop_attempt_revisions
                        WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s AND revision=%s
                        """,
                        (workspace_id, prop_session_id, parent_attempt_id, int(candidate["revision"]) - 1),
                    ).fetchone()
                    if previous is not None:
                        previous_attempt = ChallengeAttemptSnapshot.model_validate(previous["snapshot_json"])
                        previous_phase = PhaseStateSnapshot.model_validate(previous["phase_json"])
                        previous_resume = dict(previous["resume_json"] or {})
                        try:
                            prop_event = replay_mark_to_prop_event(
                                workspace_id=workspace_id,
                                prop_session_id=prop_session_id,
                                prop_attempt_id=parent_attempt_id,
                                profile_hash=previous_attempt.profile_hash,
                                expected_prop_revision=previous_attempt.revision,
                                prop_event_sequence=candidate_phase.last_event_sequence,
                                phase_spec=session.profile.phases[previous_phase.phase_index - 1],
                                replay_event=parent_checkpoint_event,
                            )
                            supplied_resume = dict(previous_resume)
                            supplied_resume.pop("prop_lifecycle", None)
                            supplied_resume["cursor"] = {
                                "bar_index": parent_checkpoint_event.cursor_index,
                                "timestamp_utc": datetime.fromtimestamp(
                                    parent_checkpoint_event.virtual_time_utc, tz=timezone.utc
                                ).isoformat().replace("+00:00", "Z"),
                            }
                            event_position = parent_checkpoint_event.details.get("open_position")
                            event_pending = parent_checkpoint_event.details.get("pending_market_order")
                            supplied_resume["open_positions"] = [event_position] if event_position is not None else []
                            supplied_resume["pending_orders"] = [event_pending] if event_pending is not None else []
                            supplied_resume["replay_binding"] = {
                                "replay_session_id": parent_replay_id,
                                "branch_id": parent_snapshot.branch_id,
                                "dataset_id": parent_snapshot.dataset_id,
                                "dataset_sha256": parent_snapshot.dataset_sha256,
                                "last_replay_event_sequence": parent_checkpoint_event.sequence,
                            }
                            expected_fingerprint = _payload_fingerprint(
                                {"event": prop_event.model_dump(mode="json"), "resume_state": supplied_resume}
                            )
                            evaluation_resume = dict(supplied_resume)
                            if "prop_lifecycle" in previous_resume:
                                evaluation_resume["prop_lifecycle"] = previous_resume["prop_lifecycle"]
                            expected_result = evaluate_prop_lifecycle_event(
                                session,
                                previous_attempt,
                                previous_phase,
                                prop_event,
                                resume_state=evaluation_resume,
                            )
                            canonical_receipt = any(
                                row["operation_id"] == expected_operation_id
                                and row["fingerprint"] == expected_fingerprint
                                for row in receipt_rows
                            ) and (
                                expected_result["attempt"] == candidate_attempt
                                and expected_result["phase"] == candidate_phase
                                and expected_result["resume_state"] == candidate_resume
                            )
                        except (IndexError, PropSessionContractError, ReplayPropConnectionError):
                            canonical_receipt = False
                elif checkpoint_event.kind == "phase_transition":
                    details = checkpoint_event.details or {}
                    intent_id = details.get("intent_id")
                    intent_fingerprint = details.get("intent_fingerprint")
                    canonical_receipt = bool(intent_id and intent_fingerprint) and any(
                        row["operation_id"] == intent_id and row["fingerprint"] == intent_fingerprint
                        for row in receipt_rows
                    )
                if not canonical_receipt:
                    continue
                historical = (int(candidate["revision"]), candidate_attempt, candidate_phase, candidate_resume)
                break
            if historical is None:
                raise ReplayPropConnectionError("canonical historical Prop checkpoint was not found for Replay branch boundary")

            historical_revision, historical_attempt, historical_phase, historical_resume = historical
            child_attempt = historical_attempt.model_copy(
                update={
                    "attempt_id": child_attempt_id,
                    "status": "paused",
                    "revision": 1,
                    "parent_attempt_id": parent_attempt_id,
                    "branch_kind": "hindsight_exploratory",
                }
            )
            child_phase = historical_phase.model_copy(update={"attempt_id": child_attempt_id})
            child_resume = dict(historical_resume)
            child_resume["replay_binding"] = {
                "replay_session_id": replay_session_id,
                "branch_id": child_snapshot.branch_id,
                "dataset_id": child_snapshot.dataset_id,
                "dataset_sha256": child_snapshot.dataset_sha256,
                "last_replay_event_sequence": child_snapshot.event_sequence,
            }
            child_resume["branch_provenance"] = {
                "kind": "replay_prop_hindsight_branch_v1",
                "parent_attempt_id": parent_attempt_id,
                "parent_attempt_revision": historical_revision,
                "parent_replay_session_id": parent_replay_id,
                "parent_replay_revision": int(expected_parent_replay_revision),
                "parent_checkpoint_event_sequence": child_snapshot.event_sequence,
            }
            self._validate_prop_phase_scope(session, child_attempt, child_phase)
            self._validate_resume_counts(child_phase, child_resume)
            self._validate_resume_cursor(child_resume)
            validate_replay_prop_branch_checkpoint(
                child_snapshot,
                child_payload=child_payload,
                parent_snapshot=parent_snapshot,
                historical_attempt=historical_attempt,
                phase=historical_phase,
                resume_state=historical_resume,
            )

            attempt_json = json.dumps(child_attempt.model_dump(mode="json"), sort_keys=True)
            phase_json = json.dumps(child_phase.model_dump(mode="json"), sort_keys=True)
            resume_json = json.dumps(child_resume, sort_keys=True)
            conn.execute(
                """
                INSERT INTO prop_attempts(
                    workspace_id,session_id,attempt_id,current_revision,snapshot_json,phase_json,resume_json,
                    created_at_utc,updated_at_utc
                ) VALUES(%s,%s,%s,1,%s::jsonb,%s::jsonb,%s::jsonb,%s,%s)
                """,
                (workspace_id, prop_session_id, child_attempt_id, attempt_json, phase_json, resume_json, now, now),
            )
            conn.execute(
                """
                INSERT INTO prop_attempt_revisions(
                    workspace_id,session_id,attempt_id,revision,snapshot_json,phase_json,resume_json,created_at_utc
                ) VALUES(%s,%s,%s,1,%s::jsonb,%s::jsonb,%s::jsonb,%s)
                """,
                (workspace_id, prop_session_id, child_attempt_id, attempt_json, phase_json, resume_json, now),
            )
            session = self._sync_prop_session_status(conn, session, child_attempt.status, now)
            conn.execute(
                """
                INSERT INTO prop_mutation_receipts(
                    workspace_id,session_id,attempt_id,operation_id,fingerprint,entity_revision,created_at_utc
                ) VALUES(%s,%s,%s,%s,%s,1,%s)
                """,
                (workspace_id, prop_session_id, child_attempt_id, operation_id, fingerprint, now),
            )
            conn.commit()
        return {
            "session": session,
            "attempt": child_attempt,
            "phase": child_phase,
            "resume_state": child_resume,
            "duplicate": False,
        }

    @staticmethod
    def _lock_resume_replay(conn, workspace_id: str, resume: dict | None) -> None:
        PostgresStore._lock_resume_datasets(conn, workspace_id, resume)
        binding = (resume or {}).get("replay_binding")
        if not isinstance(binding, dict) or not binding.get("replay_session_id"):
            return
        # All binding writers lock replay before Prop so deletion and a new
        # dependency cannot commit concurrently or leave a dangling binding.
        row = conn.execute(
            """SELECT v.deleted, v.payload_json FROM workspace_records r
               JOIN workspace_record_revisions v
                 ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id
                AND v.revision=r.current_revision
               WHERE r.workspace_id=%s AND r.kind='replay' AND r.record_id=%s
               FOR UPDATE OF r""",
            (workspace_id, binding["replay_session_id"]),
        ).fetchone()
        if row is None or row["deleted"]:
            raise LookupError("replay session not found")
        if row['payload_json'].get('asset_states'):
            raise ValueError('multi-asset replay is not supported by Prop lifecycle')

    def create_prop_attempt(
        self,
        attempt: ChallengeAttemptSnapshot,
        phase: PhaseStateSnapshot,
        *,
        resume_state: dict | None = None,
    ) -> dict:
        if attempt.revision != 1:
            raise PropPersistenceConflict("new prop attempts must start at revision 1")
        if attempt.branch_kind != "clean":
            raise PropPersistenceConflict("hindsight prop attempts require canonical Replay branch binding")
        resume = dict(resume_state or {})
        now = utc_now_iso()
        with self.connect() as conn:
            self._lock_resume_replay(conn, attempt.workspace_id, resume)
            session_row = conn.execute(
                "SELECT snapshot_json FROM prop_sessions WHERE workspace_id=%s AND session_id=%s FOR UPDATE",
                (attempt.workspace_id, attempt.session_id),
            ).fetchone()
            if session_row is None:
                raise LookupError("prop session not found")
            session = PropSessionSnapshot.model_validate(session_row["snapshot_json"])
            self._validate_prop_phase_scope(session, attempt, phase)
            self._validate_resume_counts(phase, resume)
            existing_attempt_rows = conn.execute(
                """
                SELECT attempt_id,snapshot_json FROM prop_attempts
                WHERE workspace_id=%s AND session_id=%s
                FOR UPDATE
                """,
                (attempt.workspace_id, attempt.session_id),
            ).fetchall()
            for existing_row in existing_attempt_rows:
                existing_attempt = ChallengeAttemptSnapshot.model_validate(existing_row["snapshot_json"])
                if (
                    existing_attempt.attempt_id != attempt.attempt_id
                    and existing_attempt.status not in _TERMINAL_PROP_ATTEMPT_STATUSES
                ):
                    raise PropPersistenceConflict("prop session already has an active attempt")
            if attempt.parent_attempt_id:
                parent = conn.execute(
                    """
                    SELECT snapshot_json FROM prop_attempts
                    WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s
                    """,
                    (attempt.workspace_id, attempt.session_id, attempt.parent_attempt_id),
                ).fetchone()
                if parent is None:
                    raise PropPersistenceConflict("parent prop attempt does not exist in this session")
                parent_attempt = ChallengeAttemptSnapshot.model_validate(parent["snapshot_json"])
                if parent_attempt.status not in _TERMINAL_PROP_ATTEMPT_STATUSES:
                    raise PropPersistenceConflict("parent prop attempt must be terminal before restart")

            attempt_json = json.dumps(attempt.model_dump(mode="json"), sort_keys=True)
            phase_json = json.dumps(phase.model_dump(mode="json"), sort_keys=True)
            resume_json = json.dumps(resume, sort_keys=True)
            inserted = conn.execute(
                """
                INSERT INTO prop_attempts(
                    workspace_id,session_id,attempt_id,current_revision,snapshot_json,phase_json,resume_json,
                    created_at_utc,updated_at_utc
                ) VALUES(%s,%s,%s,1,%s::jsonb,%s::jsonb,%s::jsonb,%s,%s)
                ON CONFLICT (workspace_id,session_id,attempt_id) DO NOTHING
                RETURNING attempt_id
                """,
                (
                    attempt.workspace_id,
                    attempt.session_id,
                    attempt.attempt_id,
                    attempt_json,
                    phase_json,
                    resume_json,
                    now,
                    now,
                ),
            ).fetchone()
            if inserted is None:
                existing = conn.execute(
                    """
                    SELECT snapshot_json,phase_json,resume_json FROM prop_attempts
                    WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s
                    """,
                    (attempt.workspace_id, attempt.session_id, attempt.attempt_id),
                ).fetchone()
                current_attempt = ChallengeAttemptSnapshot.model_validate(existing["snapshot_json"])
                current_phase = PhaseStateSnapshot.model_validate(existing["phase_json"])
                if current_attempt == attempt and current_phase == phase and existing["resume_json"] == resume:
                    if session.status != current_attempt.status:
                        raise PropPersistenceConflict("prop session and attempt lifecycle status diverged")
                    return {
                        "session": session,
                        "attempt": current_attempt,
                        "phase": current_phase,
                        "resume_state": existing["resume_json"],
                        "duplicate": True,
                    }
                raise PropPersistenceConflict("prop attempt already exists with different content")
            conn.execute(
                """
                INSERT INTO prop_attempt_revisions(
                    workspace_id,session_id,attempt_id,revision,snapshot_json,phase_json,resume_json,created_at_utc
                ) VALUES(%s,%s,%s,1,%s::jsonb,%s::jsonb,%s::jsonb,%s)
                """,
                (
                    attempt.workspace_id,
                    attempt.session_id,
                    attempt.attempt_id,
                    attempt_json,
                    phase_json,
                    resume_json,
                    now,
                ),
            )
            session = self._sync_prop_session_status(conn, session, attempt.status, now)
            conn.commit()
        return {"session": session, "attempt": attempt, "phase": phase, "resume_state": resume, "duplicate": False}

    def create_prop_session_bundle(
        self,
        session: PropSessionSnapshot,
        attempt: ChallengeAttemptSnapshot,
        phase: PhaseStateSnapshot,
        *,
        resume_state: dict | None = None,
    ) -> dict:
        """Create the initial session and attempt atomically, with exact-payload retry semantics."""
        if session.revision != 1:
            raise PropPersistenceConflict("new prop sessions must start at revision 1")
        if attempt.revision != 1:
            raise PropPersistenceConflict("new prop attempts must start at revision 1")
        if attempt.branch_kind != "clean":
            raise PropPersistenceConflict("hindsight prop attempts require canonical Replay branch binding")
        if attempt.workspace_id != session.workspace_id or attempt.session_id != session.session_id:
            raise PropPersistenceConflict("prop attempt does not belong to the session")
        if session.status != attempt.status:
            raise PropPersistenceConflict("prop session and attempt lifecycle status must match")

        resume = dict(resume_state or {})
        self._validate_prop_phase_scope(session, attempt, phase)
        self._validate_resume_counts(phase, resume)
        self.ensure_workspace(session.workspace_id)
        now = utc_now_iso()
        session_json = json.dumps(session.model_dump(mode="json"), sort_keys=True)
        attempt_json = json.dumps(attempt.model_dump(mode="json"), sort_keys=True)
        phase_json = json.dumps(phase.model_dump(mode="json"), sort_keys=True)
        resume_json = json.dumps(resume, sort_keys=True)

        with self.connect() as conn:
            self._lock_resume_replay(conn, session.workspace_id, resume)
            inserted_session = conn.execute(
                """
                INSERT INTO prop_sessions(
                    workspace_id,session_id,current_revision,snapshot_json,created_at_utc,updated_at_utc
                ) VALUES(%s,%s,1,%s::jsonb,%s,%s)
                ON CONFLICT (workspace_id,session_id) DO NOTHING
                RETURNING session_id
                """,
                (session.workspace_id, session.session_id, session_json, now, now),
            ).fetchone()
            if inserted_session is None:
                existing_session = conn.execute(
                    """
                    SELECT snapshot_json FROM prop_sessions
                    WHERE workspace_id=%s AND session_id=%s FOR UPDATE
                    """,
                    (session.workspace_id, session.session_id),
                ).fetchone()
                current_session = PropSessionSnapshot.model_validate(existing_session["snapshot_json"])
                if current_session != session:
                    raise PropPersistenceConflict("prop session already exists with different content")
            else:
                conn.execute(
                    """
                    INSERT INTO prop_session_revisions(
                        workspace_id,session_id,revision,snapshot_json,created_at_utc
                    ) VALUES(%s,%s,1,%s::jsonb,%s)
                    """,
                    (session.workspace_id, session.session_id, session_json, now),
                )

            existing_attempt_rows = conn.execute(
                """
                SELECT attempt_id,snapshot_json FROM prop_attempts
                WHERE workspace_id=%s AND session_id=%s
                FOR UPDATE
                """,
                (attempt.workspace_id, attempt.session_id),
            ).fetchall()
            for existing_row in existing_attempt_rows:
                existing_attempt = ChallengeAttemptSnapshot.model_validate(existing_row["snapshot_json"])
                if (
                    existing_attempt.attempt_id != attempt.attempt_id
                    and existing_attempt.status not in _TERMINAL_PROP_ATTEMPT_STATUSES
                ):
                    raise PropPersistenceConflict("prop session already has an active attempt")
            if attempt.parent_attempt_id:
                parent = conn.execute(
                    """
                    SELECT snapshot_json FROM prop_attempts
                    WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s
                    """,
                    (attempt.workspace_id, attempt.session_id, attempt.parent_attempt_id),
                ).fetchone()
                if parent is None:
                    raise PropPersistenceConflict("parent prop attempt does not exist in this session")
                parent_attempt = ChallengeAttemptSnapshot.model_validate(parent["snapshot_json"])
                if parent_attempt.status not in _TERMINAL_PROP_ATTEMPT_STATUSES:
                    raise PropPersistenceConflict("parent prop attempt must be terminal before restart")

            inserted_attempt = conn.execute(
                """
                INSERT INTO prop_attempts(
                    workspace_id,session_id,attempt_id,current_revision,snapshot_json,phase_json,resume_json,
                    created_at_utc,updated_at_utc
                ) VALUES(%s,%s,%s,1,%s::jsonb,%s::jsonb,%s::jsonb,%s,%s)
                ON CONFLICT (workspace_id,session_id,attempt_id) DO NOTHING
                RETURNING attempt_id
                """,
                (
                    attempt.workspace_id,
                    attempt.session_id,
                    attempt.attempt_id,
                    attempt_json,
                    phase_json,
                    resume_json,
                    now,
                    now,
                ),
            ).fetchone()
            duplicate = inserted_attempt is None
            if duplicate:
                existing = conn.execute(
                    """
                    SELECT snapshot_json,phase_json,resume_json FROM prop_attempts
                    WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s
                    FOR UPDATE
                    """,
                    (attempt.workspace_id, attempt.session_id, attempt.attempt_id),
                ).fetchone()
                current_attempt = ChallengeAttemptSnapshot.model_validate(existing["snapshot_json"])
                current_phase = PhaseStateSnapshot.model_validate(existing["phase_json"])
                if current_attempt != attempt or current_phase != phase or existing["resume_json"] != resume:
                    raise PropPersistenceConflict("prop attempt already exists with different content")
            else:
                conn.execute(
                    """
                    INSERT INTO prop_attempt_revisions(
                        workspace_id,session_id,attempt_id,revision,snapshot_json,phase_json,resume_json,created_at_utc
                    ) VALUES(%s,%s,%s,1,%s::jsonb,%s::jsonb,%s::jsonb,%s)
                    """,
                    (
                        attempt.workspace_id,
                        attempt.session_id,
                        attempt.attempt_id,
                        attempt_json,
                        phase_json,
                        resume_json,
                        now,
                    ),
                )
            conn.commit()
        return {
            "session": session,
            "attempt": attempt,
            "phase": phase,
            "resume_state": resume,
            "duplicate": duplicate,
        }

    def get_prop_attempt(
        self,
        workspace_id: str,
        session_id: str,
        attempt_id: str,
    ) -> ChallengeAttemptSnapshot | None:
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT snapshot_json FROM prop_attempts
                WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s
                """,
                (workspace_id, session_id, attempt_id),
            ).fetchone()
        return _stored_prop_snapshot(ChallengeAttemptSnapshot, row["snapshot_json"], workspace_id, session_id, attempt_id) if row else None

    def list_prop_attempts(self, workspace_id: str, session_id: str) -> list[ChallengeAttemptSnapshot]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT attempt_id,snapshot_json FROM prop_attempts
                WHERE workspace_id=%s AND session_id=%s
                ORDER BY created_at_utc,attempt_id
                """,
                (workspace_id, session_id),
            ).fetchall()
        return [_stored_prop_snapshot(ChallengeAttemptSnapshot, row["snapshot_json"], workspace_id, session_id, row["attempt_id"]) for row in rows]

    def get_prop_resume_state(self, workspace_id: str, session_id: str, attempt_id: str) -> dict | None:
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT s.snapshot_json AS session_json,
                       a.snapshot_json AS attempt_json,a.phase_json,a.resume_json
                FROM prop_sessions s
                JOIN prop_attempts a
                  ON a.workspace_id=s.workspace_id AND a.session_id=s.session_id
                WHERE s.workspace_id=%s AND s.session_id=%s AND a.attempt_id=%s
                """,
                (workspace_id, session_id, attempt_id),
            ).fetchone()
        if row is None:
            return None
        session = _stored_prop_snapshot(PropSessionSnapshot, row["session_json"], workspace_id, session_id)
        attempt = _stored_prop_snapshot(ChallengeAttemptSnapshot, row["attempt_json"], workspace_id, session_id, attempt_id)
        phase = _stored_prop_snapshot(PhaseStateSnapshot, row["phase_json"], workspace_id, session_id, attempt_id)
        if session.profile.profile_hash != attempt.profile_hash or attempt.profile_hash != phase.profile_hash:
            raise StoredContractUntrusted()
        return {
            "session": session,
            "attempt": attempt,
            "phase": phase,
            "resume_state": row["resume_json"],
        }

    def get_prop_mutation_snapshot(
        self,
        workspace_id: str,
        session_id: str,
        attempt_id: str,
        operation_id: str,
    ) -> dict | None:
        """Return the immutable attempt revision recorded for one mutation receipt."""

        with self.connect() as conn:
            receipt = conn.execute(
                """
                SELECT fingerprint,entity_revision FROM prop_mutation_receipts
                WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s AND operation_id=%s
                """,
                (workspace_id, session_id, attempt_id, operation_id),
            ).fetchone()
            if receipt is None:
                return None
            revision = conn.execute(
                """
                SELECT snapshot_json,phase_json,resume_json FROM prop_attempt_revisions
                WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s AND revision=%s
                """,
                (workspace_id, session_id, attempt_id, int(receipt["entity_revision"])),
            ).fetchone()
        if revision is None:
            raise PropPersistenceConflict("idempotency receipt points to a missing attempt revision")
        return {
            "fingerprint": receipt["fingerprint"],
            "attempt": _stored_prop_snapshot(ChallengeAttemptSnapshot, revision["snapshot_json"], workspace_id, session_id, attempt_id),
            "phase": _stored_prop_snapshot(PhaseStateSnapshot, revision["phase_json"], workspace_id, session_id, attempt_id),
            "resume_state": revision["resume_json"],
        }

    def save_prop_resume_state(
        self,
        attempt: ChallengeAttemptSnapshot,
        phase: PhaseStateSnapshot,
        *,
        expected_revision: int,
        operation_id: str,
        resume_state: dict | None = None,
    ) -> dict:
        resume = dict(resume_state or {})
        mutation_payload = {
            "attempt": attempt.model_dump(mode="json"),
            "phase": phase.model_dump(mode="json"),
            "resume_state": resume,
        }
        fingerprint = _payload_fingerprint(mutation_payload)
        now = utc_now_iso()
        with self.connect() as conn:
            self._lock_resume_replay(conn, attempt.workspace_id, resume)
            row = conn.execute(
                """
                SELECT current_revision,snapshot_json,phase_json,resume_json FROM prop_attempts
                WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s
                FOR UPDATE
                """,
                (attempt.workspace_id, attempt.session_id, attempt.attempt_id),
            ).fetchone()
            if row is None:
                raise LookupError("prop attempt not found")
            receipt = conn.execute(
                """
                SELECT fingerprint,entity_revision FROM prop_mutation_receipts
                WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s AND operation_id=%s
                """,
                (attempt.workspace_id, attempt.session_id, attempt.attempt_id, operation_id),
            ).fetchone()
            if receipt is not None:
                if receipt["fingerprint"] != fingerprint:
                    raise PropIdempotencyConflict("operation_id was already used with different attempt content")
                revision = conn.execute(
                    """
                    SELECT snapshot_json,phase_json,resume_json FROM prop_attempt_revisions
                    WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s AND revision=%s
                    """,
                    (
                        attempt.workspace_id,
                        attempt.session_id,
                        attempt.attempt_id,
                        int(receipt["entity_revision"]),
                    ),
                ).fetchone()
                if revision is None:
                    raise PropPersistenceConflict("idempotency receipt points to a missing attempt revision")
                return {
                    "attempt": ChallengeAttemptSnapshot.model_validate(revision["snapshot_json"]),
                    "phase": PhaseStateSnapshot.model_validate(revision["phase_json"]),
                    "resume_state": revision["resume_json"],
                    "duplicate": True,
                }

            session_row = conn.execute(
                "SELECT snapshot_json FROM prop_sessions WHERE workspace_id=%s AND session_id=%s",
                (attempt.workspace_id, attempt.session_id),
            ).fetchone()
            if session_row is None:
                raise LookupError("prop session not found")
            session = PropSessionSnapshot.model_validate(session_row["snapshot_json"])
            self._validate_prop_phase_scope(session, attempt, phase)
            self._validate_resume_counts(phase, resume)
            self._validate_resume_cursor(resume, row["resume_json"])
            current = ChallengeAttemptSnapshot.model_validate(row["snapshot_json"])
            current_phase = PhaseStateSnapshot.model_validate(row["phase_json"])
            if int(row["current_revision"]) != int(expected_revision):
                raise PropPersistenceConflict("prop attempt revision conflict")
            if attempt.revision != int(expected_revision) + 1:
                raise PropPersistenceConflict("prop attempt snapshot revision must advance exactly once")
            immutable_fields = (
                "workspace_id",
                "session_id",
                "attempt_id",
                "mode",
                "profile_id",
                "terms_version",
                "profile_hash",
                "data_version",
                "cost_version",
                "engine_version",
                "parent_attempt_id",
                "branch_kind",
                "virtual_start_utc",
                "virtual_cutoff_utc",
            )
            if any(getattr(attempt, field) != getattr(current, field) for field in immutable_fields):
                raise PropPersistenceConflict("immutable prop attempt identity/version fields cannot change")
            if current.status in _TERMINAL_PROP_ATTEMPT_STATUSES:
                raise PropPersistenceConflict("terminal prop attempts are immutable")
            if attempt.status != current.status:
                raise PropPersistenceConflict("prop attempt lifecycle status is server-owned")
            if phase.last_event_sequence < current_phase.last_event_sequence:
                raise PropPersistenceConflict("prop event sequence cannot move backwards")
            if phase.virtual_time_utc < current_phase.virtual_time_utc:
                raise PropPersistenceConflict("prop virtual time cannot move backwards")
            if phase.phase_index != current_phase.phase_index:
                raise PropPersistenceConflict("prop phase index is server-owned")

            attempt_json = json.dumps(attempt.model_dump(mode="json"), sort_keys=True)
            phase_json = json.dumps(phase.model_dump(mode="json"), sort_keys=True)
            resume_json = json.dumps(resume, sort_keys=True)
            conn.execute(
                """
                INSERT INTO prop_attempt_revisions(
                    workspace_id,session_id,attempt_id,revision,snapshot_json,phase_json,resume_json,created_at_utc
                ) VALUES(%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s::jsonb,%s)
                """,
                (
                    attempt.workspace_id,
                    attempt.session_id,
                    attempt.attempt_id,
                    attempt.revision,
                    attempt_json,
                    phase_json,
                    resume_json,
                    now,
                ),
            )
            conn.execute(
                """
                UPDATE prop_attempts
                SET current_revision=%s,snapshot_json=%s::jsonb,phase_json=%s::jsonb,resume_json=%s::jsonb,
                    updated_at_utc=%s
                WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s
                """,
                (
                    attempt.revision,
                    attempt_json,
                    phase_json,
                    resume_json,
                    now,
                    attempt.workspace_id,
                    attempt.session_id,
                    attempt.attempt_id,
                ),
            )
            conn.execute(
                """
                INSERT INTO prop_mutation_receipts(
                    workspace_id,session_id,attempt_id,operation_id,fingerprint,entity_revision,created_at_utc
                ) VALUES(%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    attempt.workspace_id,
                    attempt.session_id,
                    attempt.attempt_id,
                    operation_id,
                    fingerprint,
                    attempt.revision,
                    now,
                ),
            )
            conn.commit()
        return {"attempt": attempt, "phase": phase, "resume_state": resume, "duplicate": False}

    def _apply_replay_bound_prop_next_phase(
        self,
        intent: TransitionIntent,
        *,
        fingerprint: str,
        now: str,
        replay_session_id: str,
    ) -> dict:
        """Advance canonical Replay and Prop phase state in one transaction."""

        with self.connect() as conn:
            replay_meta = conn.execute(
                """
                SELECT current_revision,source_key,created_at_utc,updated_at_utc
                FROM workspace_records
                WHERE workspace_id=%s AND kind='replay' AND record_id=%s
                FOR UPDATE
                """,
                (intent.workspace_id, replay_session_id),
            ).fetchone()
            if replay_meta is None:
                raise PropPersistenceConflict("canonical replay session not found")
            replay_version = conn.execute(
                """
                SELECT payload_json,deleted
                FROM workspace_record_revisions
                WHERE workspace_id=%s AND kind='replay' AND record_id=%s AND revision=%s
                """,
                (intent.workspace_id, replay_session_id, int(replay_meta["current_revision"])),
            ).fetchone()
            if replay_version is None:
                raise PropPersistenceConflict("canonical replay current revision is missing")
            if bool(replay_version["deleted"]):
                raise PropPersistenceConflict("canonical replay session not found")
            replay_row = {**replay_meta, **replay_version}

            session_row = conn.execute(
                """
                SELECT snapshot_json FROM prop_sessions
                WHERE workspace_id=%s AND session_id=%s
                FOR UPDATE
                """,
                (intent.workspace_id, intent.session_id),
            ).fetchone()
            if session_row is None:
                raise LookupError("prop session not found")
            session = PropSessionSnapshot.model_validate(session_row["snapshot_json"])

            row = conn.execute(
                """
                SELECT current_revision,snapshot_json,phase_json,resume_json FROM prop_attempts
                WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s
                FOR UPDATE
                """,
                (intent.workspace_id, intent.session_id, intent.attempt_id),
            ).fetchone()
            if row is None:
                raise LookupError("prop attempt not found")

            receipt = conn.execute(
                """
                SELECT fingerprint,entity_revision FROM prop_mutation_receipts
                WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s AND operation_id=%s
                """,
                (intent.workspace_id, intent.session_id, intent.attempt_id, intent.intent_id),
            ).fetchone()
            if receipt is not None:
                if receipt["fingerprint"] != fingerprint:
                    raise PropIdempotencyConflict("intent_id was already used with different transition content")
                receipt_revision = conn.execute(
                    """
                    SELECT 1 FROM prop_attempt_revisions
                    WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s AND revision=%s
                    """,
                    (
                        intent.workspace_id,
                        intent.session_id,
                        intent.attempt_id,
                        int(receipt["entity_revision"]),
                    ),
                ).fetchone()
                if receipt_revision is None:
                    raise PropPersistenceConflict("idempotency receipt points to a missing attempt revision")
                try:
                    current_replay = parse_replay_execution_snapshot(
                        dict(replay_row["payload_json"] or {}).get("execution")
                    )
                except ValueError as exc:
                    raise PropPersistenceConflict("canonical replay execution snapshot is invalid") from exc
                transition_receipt = next(
                    (
                        item
                        for item in current_replay.ledger
                        if item.get("kind") == "phase_transition"
                        and (item.get("details") or {}).get("intent_id") == intent.intent_id
                    ),
                    None,
                )
                if (
                    transition_receipt is None
                    or (transition_receipt.get("details") or {}).get("intent_fingerprint") != fingerprint
                ):
                    raise PropPersistenceConflict("idempotency receipt has no matching canonical replay transition event")
                current_attempt = ChallengeAttemptSnapshot.model_validate(row["snapshot_json"])
                current_phase = PhaseStateSnapshot.model_validate(row["phase_json"])
                if session.status != current_attempt.status:
                    raise PropPersistenceConflict("prop session and attempt lifecycle status diverged")
                return {
                    "session": session,
                    "attempt": current_attempt,
                    "phase": current_phase,
                    "resume_state": row["resume_json"],
                    "duplicate": True,
                    "replay_record": {
                        "record_id": replay_session_id,
                        "revision": int(replay_row["current_revision"]),
                        "payload": replay_row["payload_json"],
                    },
                }

            current = ChallengeAttemptSnapshot.model_validate(row["snapshot_json"])
            current_phase = PhaseStateSnapshot.model_validate(row["phase_json"])
            current_resume = dict(row["resume_json"] or {})
            if int(row["current_revision"]) != intent.expected_revision:
                raise PropPersistenceConflict("prop attempt revision conflict")
            if session.status != current.status:
                raise PropPersistenceConflict("prop session and attempt lifecycle status diverged")
            self._validate_prop_phase_scope(session, current, current_phase)
            self._validate_resume_counts(current_phase, current_resume)

            binding = current_resume.get("replay_binding")
            if not isinstance(binding, dict) or binding.get("replay_session_id") != replay_session_id:
                raise PropPersistenceConflict("prop replay binding changed before canonical phase transition")
            replay_payload = dict(replay_row["payload_json"] or {})
            raw_execution = replay_payload.get("execution")
            if raw_execution is None:
                raise PropPersistenceConflict("canonical replay execution is not initialized")
            try:
                replay_snapshot = parse_replay_execution_snapshot(raw_execution)
            except ValueError as exc:
                raise PropPersistenceConflict("canonical replay execution snapshot is invalid") from exc

            dataset_row = conn.execute(
                """
                SELECT manifest_json,artifact_sha256 FROM datasets
                WHERE workspace_id=%s AND dataset_id=%s
                """,
                (intent.workspace_id, replay_snapshot.dataset_id),
            ).fetchone()
            if dataset_row is None:
                raise PropPersistenceConflict("canonical replay dataset is missing")
            manifest = DatasetManifest.model_validate(dataset_row["manifest_json"])
            if manifest.artifact_sha256 != replay_snapshot.dataset_sha256:
                raise PropPersistenceConflict("canonical replay dataset sha256 changed")

            current_spec = session.profile.phases[current_phase.phase_index - 1]
            try:
                validate_replay_prop_transition_boundary(
                    replay_snapshot,
                    replay_payload=replay_payload,
                    dataset_row_count=manifest.row_count,
                    attempt=current,
                    phase=current_phase,
                    resume_state=current_resume,
                    phase_spec=current_spec,
                )
            except ReplayPropConnectionError as exc:
                raise PropPersistenceConflict(str(exc)) from exc

            result = apply_prop_lifecycle_command(
                session,
                current,
                current_phase,
                intent,
                resume_state=current_resume,
                canonical_replay_transition=True,
            )
            updated_attempt = result["attempt"]
            updated_phase = result["phase"]
            updated_resume = dict(result["resume_state"])
            try:
                replay_transition = transition_replay_phase(
                    replay_snapshot,
                    intent_id=intent.intent_id,
                    intent_fingerprint=result["intent_fingerprint"],
                    from_phase_index=current_phase.phase_index,
                    to_phase_index=updated_phase.phase_index,
                    carry_policy=current_spec.carry_policy,
                    position_policy=current_spec.position_policy,
                    next_phase_initial_balance=updated_phase.initial_balance,
                    virtual_time_utc=int(current_phase.virtual_time_utc.timestamp()),
                )
            except ReplayExecutionError as exc:
                raise PropPersistenceConflict(str(exc)) from exc

            next_binding = dict(updated_resume.get("replay_binding") or {})
            next_binding.update(
                {
                    "replay_session_id": replay_transition.snapshot.replay_session_id,
                    "branch_id": replay_transition.snapshot.branch_id,
                    "dataset_id": replay_transition.snapshot.dataset_id,
                    "dataset_sha256": replay_transition.snapshot.dataset_sha256,
                    "last_replay_event_sequence": replay_transition.event.sequence,
                    "phase_index": updated_phase.phase_index,
                }
            )
            updated_resume["replay_binding"] = next_binding
            try:
                validate_replay_prop_transition_result(
                    replay_transition.snapshot,
                    attempt=updated_attempt,
                    phase=updated_phase,
                    resume_state=updated_resume,
                )
            except ReplayPropConnectionError as exc:
                raise PropPersistenceConflict(str(exc)) from exc
            self._validate_prop_phase_scope(session, updated_attempt, updated_phase)
            self._validate_resume_counts(updated_phase, updated_resume)
            self._validate_resume_cursor(updated_resume, current_resume)

            replay_payload["execution"] = replay_transition.snapshot.model_dump(mode="json")
            replay_revision = int(replay_row["current_revision"]) + 1
            conn.execute(
                """
                INSERT INTO workspace_record_revisions(
                    workspace_id,kind,record_id,revision,payload_json,deleted,created_at_utc
                ) VALUES(%s,'replay',%s,%s,%s::jsonb,false,%s)
                """,
                (
                    intent.workspace_id,
                    replay_session_id,
                    replay_revision,
                    json.dumps(replay_payload, sort_keys=True),
                    now,
                ),
            )
            conn.execute(
                """
                UPDATE workspace_records SET current_revision=%s,updated_at_utc=%s
                WHERE workspace_id=%s AND kind='replay' AND record_id=%s
                """,
                (replay_revision, now, intent.workspace_id, replay_session_id),
            )

            attempt_json = json.dumps(updated_attempt.model_dump(mode="json"), sort_keys=True)
            phase_json = json.dumps(updated_phase.model_dump(mode="json"), sort_keys=True)
            resume_json = json.dumps(updated_resume, sort_keys=True)
            conn.execute(
                """
                INSERT INTO prop_attempt_revisions(
                    workspace_id,session_id,attempt_id,revision,snapshot_json,phase_json,resume_json,created_at_utc
                ) VALUES(%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s::jsonb,%s)
                """,
                (
                    intent.workspace_id,
                    intent.session_id,
                    intent.attempt_id,
                    updated_attempt.revision,
                    attempt_json,
                    phase_json,
                    resume_json,
                    now,
                ),
            )
            conn.execute(
                """
                UPDATE prop_attempts
                SET current_revision=%s,snapshot_json=%s::jsonb,phase_json=%s::jsonb,resume_json=%s::jsonb,
                    updated_at_utc=%s
                WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s
                """,
                (
                    updated_attempt.revision,
                    attempt_json,
                    phase_json,
                    resume_json,
                    now,
                    intent.workspace_id,
                    intent.session_id,
                    intent.attempt_id,
                ),
            )
            updated_session = self._sync_prop_session_status(conn, session, updated_attempt.status, now)
            conn.execute(
                """
                INSERT INTO prop_mutation_receipts(
                    workspace_id,session_id,attempt_id,operation_id,fingerprint,entity_revision,created_at_utc
                ) VALUES(%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    intent.workspace_id,
                    intent.session_id,
                    intent.attempt_id,
                    intent.intent_id,
                    fingerprint,
                    updated_attempt.revision,
                    now,
                ),
            )
            conn.commit()
        return {
            "session": updated_session,
            "attempt": updated_attempt,
            "phase": updated_phase,
            "resume_state": updated_resume,
            "duplicate": False,
            "replay_record": {
                "record_id": replay_session_id,
                "revision": replay_revision,
                "payload": replay_payload,
            },
        }

    def apply_prop_transition_intent(self, intent: TransitionIntent) -> dict:
        """Atomically apply one server-owned Prop lifecycle command."""

        fingerprint = _payload_fingerprint(intent.model_dump(mode="json"))
        now = utc_now_iso()
        if intent.action == "next_phase":
            with self.connect() as preview_conn:
                preview = preview_conn.execute(
                    """
                    SELECT resume_json FROM prop_attempts
                    WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s
                    """,
                    (intent.workspace_id, intent.session_id, intent.attempt_id),
                ).fetchone()
            if preview is None:
                raise LookupError("prop attempt not found")
            preview_binding = dict(preview["resume_json"] or {}).get("replay_binding")
            if preview_binding is not None:
                if not isinstance(preview_binding, dict) or not preview_binding.get("replay_session_id"):
                    raise PropPersistenceConflict("prop replay binding is invalid")
                return self._apply_replay_bound_prop_next_phase(
                    intent,
                    fingerprint=fingerprint,
                    now=now,
                    replay_session_id=str(preview_binding["replay_session_id"]),
                )
        with self.connect() as conn:
            session_row = conn.execute(
                """
                SELECT snapshot_json FROM prop_sessions
                WHERE workspace_id=%s AND session_id=%s
                FOR UPDATE
                """,
                (intent.workspace_id, intent.session_id),
            ).fetchone()
            if session_row is None:
                raise LookupError("prop session not found")
            session = PropSessionSnapshot.model_validate(session_row["snapshot_json"])

            row = conn.execute(
                """
                SELECT current_revision,snapshot_json,phase_json,resume_json FROM prop_attempts
                WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s
                FOR UPDATE
                """,
                (intent.workspace_id, intent.session_id, intent.attempt_id),
            ).fetchone()
            if row is None:
                raise LookupError("prop attempt not found")

            receipt = conn.execute(
                """
                SELECT fingerprint,entity_revision FROM prop_mutation_receipts
                WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s AND operation_id=%s
                """,
                (intent.workspace_id, intent.session_id, intent.attempt_id, intent.intent_id),
            ).fetchone()
            if receipt is not None:
                if receipt["fingerprint"] != fingerprint:
                    raise PropIdempotencyConflict("intent_id was already used with different transition content")
                revision = conn.execute(
                    """
                    SELECT snapshot_json,phase_json,resume_json FROM prop_attempt_revisions
                    WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s AND revision=%s
                    """,
                    (
                        intent.workspace_id,
                        intent.session_id,
                        intent.attempt_id,
                        int(receipt["entity_revision"]),
                    ),
                ).fetchone()
                if revision is None:
                    raise PropPersistenceConflict("idempotency receipt points to a missing attempt revision")
                current_attempt = ChallengeAttemptSnapshot.model_validate(row["snapshot_json"])
                current_phase = PhaseStateSnapshot.model_validate(row["phase_json"])
                if session.status != current_attempt.status:
                    raise PropPersistenceConflict("prop session and attempt lifecycle status diverged")
                return {
                    "session": session,
                    "attempt": current_attempt,
                    "phase": current_phase,
                    "resume_state": row["resume_json"],
                    "duplicate": True,
                }

            current = ChallengeAttemptSnapshot.model_validate(row["snapshot_json"])
            current_phase = PhaseStateSnapshot.model_validate(row["phase_json"])
            current_resume = dict(row["resume_json"] or {})
            if int(row["current_revision"]) != intent.expected_revision:
                raise PropPersistenceConflict("prop attempt revision conflict")
            if session.status != current.status:
                raise PropPersistenceConflict("prop session and attempt lifecycle status diverged")
            self._validate_prop_phase_scope(session, current, current_phase)
            self._validate_resume_counts(current_phase, current_resume)

            result = apply_prop_lifecycle_command(
                session,
                current,
                current_phase,
                intent,
                resume_state=current_resume,
            )
            updated_attempt = result["attempt"]
            updated_phase = result["phase"]
            updated_resume = result["resume_state"]
            self._validate_prop_phase_scope(session, updated_attempt, updated_phase)
            self._validate_resume_counts(updated_phase, updated_resume)
            self._validate_resume_cursor(updated_resume, current_resume)

            attempt_json = json.dumps(updated_attempt.model_dump(mode="json"), sort_keys=True)
            phase_json = json.dumps(updated_phase.model_dump(mode="json"), sort_keys=True)
            resume_json = json.dumps(updated_resume, sort_keys=True)
            conn.execute(
                """
                INSERT INTO prop_attempt_revisions(
                    workspace_id,session_id,attempt_id,revision,snapshot_json,phase_json,resume_json,created_at_utc
                ) VALUES(%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s::jsonb,%s)
                """,
                (
                    intent.workspace_id,
                    intent.session_id,
                    intent.attempt_id,
                    updated_attempt.revision,
                    attempt_json,
                    phase_json,
                    resume_json,
                    now,
                ),
            )
            conn.execute(
                """
                UPDATE prop_attempts
                SET current_revision=%s,snapshot_json=%s::jsonb,phase_json=%s::jsonb,resume_json=%s::jsonb,
                    updated_at_utc=%s
                WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s
                """,
                (
                    updated_attempt.revision,
                    attempt_json,
                    phase_json,
                    resume_json,
                    now,
                    intent.workspace_id,
                    intent.session_id,
                    intent.attempt_id,
                ),
            )
            updated_session = self._sync_prop_session_status(conn, session, updated_attempt.status, now)
            conn.execute(
                """
                INSERT INTO prop_mutation_receipts(
                    workspace_id,session_id,attempt_id,operation_id,fingerprint,entity_revision,created_at_utc
                ) VALUES(%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    intent.workspace_id,
                    intent.session_id,
                    intent.attempt_id,
                    intent.intent_id,
                    fingerprint,
                    updated_attempt.revision,
                    now,
                ),
            )
            conn.commit()
        return {
            "session": updated_session,
            "attempt": updated_attempt,
            "phase": updated_phase,
            "resume_state": updated_resume,
            "duplicate": False,
        }

    def apply_prop_lifecycle_event(
        self,
        event: PropLifecycleEvent,
        *,
        resume_state: dict | None = None,
    ) -> dict:
        """Atomically evaluate and persist one simulation-only Prop lifecycle event."""

        supplied_resume = None if resume_state is None else dict(resume_state)
        fingerprint = _payload_fingerprint(
            {
                "event": event.model_dump(mode="json"),
                "resume_state": supplied_resume,
            }
        )
        now = utc_now_iso()
        with self.connect() as conn:
            self._lock_resume_replay(conn, event.workspace_id, supplied_resume)
            session_row = conn.execute(
                """
                SELECT snapshot_json FROM prop_sessions
                WHERE workspace_id=%s AND session_id=%s
                FOR UPDATE
                """,
                (event.workspace_id, event.session_id),
            ).fetchone()
            if session_row is None:
                raise LookupError("prop session not found")
            session = PropSessionSnapshot.model_validate(session_row["snapshot_json"])

            row = conn.execute(
                """
                SELECT current_revision,snapshot_json,phase_json,resume_json FROM prop_attempts
                WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s
                FOR UPDATE
                """,
                (event.workspace_id, event.session_id, event.attempt_id),
            ).fetchone()
            if row is None:
                raise LookupError("prop attempt not found")

            receipt = conn.execute(
                """
                SELECT fingerprint,entity_revision,created_at_utc FROM prop_mutation_receipts
                WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s AND operation_id=%s
                """,
                (event.workspace_id, event.session_id, event.attempt_id, event.operation_id),
            ).fetchone()
            if receipt is not None:
                if receipt["fingerprint"] != fingerprint:
                    raise PropIdempotencyConflict("operation_id was already used with different lifecycle content")
                revision = conn.execute(
                    """
                    SELECT snapshot_json,phase_json,resume_json FROM prop_attempt_revisions
                    WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s AND revision=%s
                    """,
                    (
                        event.workspace_id,
                        event.session_id,
                        event.attempt_id,
                        int(receipt["entity_revision"]),
                    ),
                ).fetchone()
                if revision is None:
                    raise PropPersistenceConflict("idempotency receipt points to a missing attempt revision")
                historical_session_row = conn.execute(
                    """
                    SELECT snapshot_json FROM prop_session_revisions
                    WHERE workspace_id=%s AND session_id=%s AND created_at_utc<=%s
                    ORDER BY created_at_utc DESC,revision DESC
                    LIMIT 1
                    """,
                    (event.workspace_id, event.session_id, receipt["created_at_utc"]),
                ).fetchone()
                if historical_session_row is None:
                    raise PropPersistenceConflict("idempotency receipt points before prop session history")
                historical_session = PropSessionSnapshot.model_validate(historical_session_row["snapshot_json"])
                historical_attempt = ChallengeAttemptSnapshot.model_validate(revision["snapshot_json"])
                if historical_session.status != historical_attempt.status:
                    raise PropPersistenceConflict("historical prop session and attempt lifecycle status diverged")
                historical_resume = revision["resume_json"]
                lifecycle = historical_resume.get("prop_lifecycle") if isinstance(historical_resume, dict) else None
                return {
                    "session": historical_session,
                    "attempt": historical_attempt,
                    "phase": PhaseStateSnapshot.model_validate(revision["phase_json"]),
                    "resume_state": historical_resume,
                    "objectives": lifecycle.get("last_objectives") if isinstance(lifecycle, dict) else None,
                    "duplicate": True,
                }

            current = ChallengeAttemptSnapshot.model_validate(row["snapshot_json"])
            current_phase = PhaseStateSnapshot.model_validate(row["phase_json"])
            if int(row["current_revision"]) != event.expected_revision:
                raise PropPersistenceConflict("prop attempt revision conflict")
            if session.status != current.status:
                raise PropPersistenceConflict("prop session and attempt lifecycle status diverged")

            current_resume = dict(row["resume_json"] or {})
            next_resume = dict(
                current_resume
                if supplied_resume is None or event.evaluation_quality != "full_for_declared_model"
                else supplied_resume
            )
            # Lifecycle-derived state is server-owned. A simulator may update cursor,
            # positions and pending orders but cannot rewrite objective history.
            if "prop_lifecycle" in current_resume:
                next_resume["prop_lifecycle"] = current_resume["prop_lifecycle"]

            result = evaluate_prop_lifecycle_event(
                session,
                current,
                current_phase,
                event,
                resume_state=next_resume,
            )
            updated_attempt = result["attempt"]
            updated_phase = result["phase"]
            updated_resume = result["resume_state"]
            self._validate_prop_phase_scope(session, updated_attempt, updated_phase)
            self._validate_resume_counts(updated_phase, updated_resume)
            self._validate_resume_cursor(updated_resume, current_resume)
            if updated_phase.phase_index != current_phase.phase_index:
                raise PropPersistenceConflict("lifecycle evaluation cannot change phase index directly")

            attempt_json = json.dumps(updated_attempt.model_dump(mode="json"), sort_keys=True)
            phase_json = json.dumps(updated_phase.model_dump(mode="json"), sort_keys=True)
            resume_json = json.dumps(updated_resume, sort_keys=True)
            conn.execute(
                """
                INSERT INTO prop_attempt_revisions(
                    workspace_id,session_id,attempt_id,revision,snapshot_json,phase_json,resume_json,created_at_utc
                ) VALUES(%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s::jsonb,%s)
                """,
                (
                    event.workspace_id,
                    event.session_id,
                    event.attempt_id,
                    updated_attempt.revision,
                    attempt_json,
                    phase_json,
                    resume_json,
                    now,
                ),
            )
            conn.execute(
                """
                UPDATE prop_attempts
                SET current_revision=%s,snapshot_json=%s::jsonb,phase_json=%s::jsonb,resume_json=%s::jsonb,
                    updated_at_utc=%s
                WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s
                """,
                (
                    updated_attempt.revision,
                    attempt_json,
                    phase_json,
                    resume_json,
                    now,
                    event.workspace_id,
                    event.session_id,
                    event.attempt_id,
                ),
            )
            updated_session = self._sync_prop_session_status(conn, session, updated_attempt.status, now)
            conn.execute(
                """
                INSERT INTO prop_mutation_receipts(
                    workspace_id,session_id,attempt_id,operation_id,fingerprint,entity_revision,created_at_utc
                ) VALUES(%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    event.workspace_id,
                    event.session_id,
                    event.attempt_id,
                    event.operation_id,
                    fingerprint,
                    updated_attempt.revision,
                    now,
                ),
            )
            conn.commit()
        return {
            "session": updated_session,
            "attempt": updated_attempt,
            "phase": updated_phase,
            "resume_state": updated_resume,
            "objectives": result["objectives"],
            "duplicate": False,
        }

    def overview_counts(self, workspace_id: str) -> dict:
        with self.connect() as conn:
            dataset_count = conn.execute(
                "SELECT count(*) AS n FROM datasets WHERE workspace_id=%s", (workspace_id,)
            ).fetchone()["n"]
            jobs = conn.execute(
                "SELECT status,count(*) AS n FROM research_jobs WHERE workspace_id=%s GROUP BY status", (workspace_id,)
            ).fetchall()
            records = conn.execute(
                "SELECT kind,count(*) AS n FROM workspace_records WHERE workspace_id=%s GROUP BY kind", (workspace_id,)
            ).fetchall()
        return {
            "datasets": int(dataset_count),
            "research_jobs": {row["status"]: int(row["n"]) for row in jobs},
            "records": {row["kind"]: int(row["n"]) for row in records},
        }
