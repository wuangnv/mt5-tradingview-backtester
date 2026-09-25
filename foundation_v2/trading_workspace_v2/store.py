from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row

from .contracts import DatasetManifest, ResearchJobView, utc_now_iso
from .prop_session import (
    ChallengeAttemptSnapshot,
    PhaseStateSnapshot,
    PropSessionContractError,
    PropSessionSnapshot,
    validate_attempt_against_session,
)
from .research_oos import complete_canceled_sweep_outcomes


RESEARCH_JOB_ADMISSION_LOCK_KEY = 0x52534A41


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


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS workspaces (
    workspace_id text PRIMARY KEY,
    created_at_utc text NOT NULL
);

CREATE TABLE IF NOT EXISTS datasets (
    workspace_id text NOT NULL REFERENCES workspaces(workspace_id),
    dataset_id text NOT NULL,
    manifest_json jsonb NOT NULL,
    artifact_sha256 text NOT NULL,
    created_at_utc text NOT NULL,
    PRIMARY KEY (workspace_id, dataset_id)
);

CREATE TABLE IF NOT EXISTS research_jobs (
    workspace_id text NOT NULL,
    job_id text NOT NULL,
    dataset_id text NOT NULL,
    strategy_version text NOT NULL,
    starting_balance double precision NOT NULL CHECK (starting_balance > 0),
    status text NOT NULL CHECK (status IN ('queued','running','completed','failed','canceled')),
    cancel_requested boolean NOT NULL DEFAULT false,
    attempt_no integer NOT NULL DEFAULT 0,
    lease_owner text,
    lease_token text,
    lease_expires_at_utc timestamptz,
    result_path text,
    result_sha256 text,
    error_code text,
    created_at_utc text NOT NULL,
    updated_at_utc text NOT NULL,
    PRIMARY KEY (workspace_id, job_id),
    FOREIGN KEY (workspace_id, dataset_id)
        REFERENCES datasets(workspace_id, dataset_id)
);

CREATE INDEX IF NOT EXISTS idx_research_jobs_status
    ON research_jobs(status, created_at_utc);

ALTER TABLE research_jobs ADD COLUMN IF NOT EXISTS cancel_requested boolean NOT NULL DEFAULT false;
ALTER TABLE research_jobs ADD COLUMN IF NOT EXISTS attempt_no integer NOT NULL DEFAULT 0;
ALTER TABLE research_jobs ADD COLUMN IF NOT EXISTS lease_owner text;
ALTER TABLE research_jobs ADD COLUMN IF NOT EXISTS lease_token text;
ALTER TABLE research_jobs ADD COLUMN IF NOT EXISTS lease_expires_at_utc timestamptz;
ALTER TABLE research_jobs ADD COLUMN IF NOT EXISTS protocol_json jsonb;
ALTER TABLE research_jobs ADD COLUMN IF NOT EXISTS protocol_sha256 text;
ALTER TABLE research_jobs ADD COLUMN IF NOT EXISTS checkpoint_json jsonb;
ALTER TABLE research_jobs ADD COLUMN IF NOT EXISTS progress_json jsonb;
ALTER TABLE research_jobs DROP CONSTRAINT IF EXISTS research_jobs_status_check;
ALTER TABLE research_jobs ADD CONSTRAINT research_jobs_status_check
    CHECK (status IN ('queued','running','completed','failed','canceled'));

CREATE INDEX IF NOT EXISTS idx_research_jobs_lease_expiry
    ON research_jobs(status, lease_expires_at_utc);

CREATE TABLE IF NOT EXISTS prop_sessions (
    workspace_id text NOT NULL REFERENCES workspaces(workspace_id),
    session_id text NOT NULL,
    current_revision integer NOT NULL CHECK (current_revision >= 1),
    snapshot_json jsonb NOT NULL,
    created_at_utc text NOT NULL,
    updated_at_utc text NOT NULL,
    PRIMARY KEY (workspace_id, session_id)
);

CREATE TABLE IF NOT EXISTS prop_session_revisions (
    workspace_id text NOT NULL,
    session_id text NOT NULL,
    revision integer NOT NULL CHECK (revision >= 1),
    snapshot_json jsonb NOT NULL,
    created_at_utc text NOT NULL,
    PRIMARY KEY (workspace_id, session_id, revision),
    FOREIGN KEY (workspace_id, session_id)
        REFERENCES prop_sessions(workspace_id, session_id)
);

CREATE TABLE IF NOT EXISTS prop_attempts (
    workspace_id text NOT NULL,
    session_id text NOT NULL,
    attempt_id text NOT NULL,
    current_revision integer NOT NULL CHECK (current_revision >= 1),
    snapshot_json jsonb NOT NULL,
    phase_json jsonb NOT NULL,
    resume_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at_utc text NOT NULL,
    updated_at_utc text NOT NULL,
    PRIMARY KEY (workspace_id, session_id, attempt_id),
    FOREIGN KEY (workspace_id, session_id)
        REFERENCES prop_sessions(workspace_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_prop_attempts_session_updated
    ON prop_attempts(workspace_id, session_id, updated_at_utc DESC, attempt_id);

CREATE TABLE IF NOT EXISTS prop_attempt_revisions (
    workspace_id text NOT NULL,
    session_id text NOT NULL,
    attempt_id text NOT NULL,
    revision integer NOT NULL CHECK (revision >= 1),
    snapshot_json jsonb NOT NULL,
    phase_json jsonb NOT NULL,
    resume_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at_utc text NOT NULL,
    PRIMARY KEY (workspace_id, session_id, attempt_id, revision),
    FOREIGN KEY (workspace_id, session_id, attempt_id)
        REFERENCES prop_attempts(workspace_id, session_id, attempt_id)
);

CREATE TABLE IF NOT EXISTS prop_mutation_receipts (
    workspace_id text NOT NULL,
    session_id text NOT NULL,
    attempt_id text NOT NULL DEFAULT '',
    operation_id text NOT NULL,
    fingerprint text NOT NULL,
    entity_revision integer NOT NULL CHECK (entity_revision >= 1),
    created_at_utc text NOT NULL,
    PRIMARY KEY (workspace_id, session_id, attempt_id, operation_id),
    FOREIGN KEY (workspace_id, session_id)
        REFERENCES prop_sessions(workspace_id, session_id)
);

CREATE TABLE IF NOT EXISTS workspace_records (
    workspace_id text NOT NULL REFERENCES workspaces(workspace_id),
    kind text NOT NULL CHECK (kind IN ('playbook','journal','annotation','replay')),
    record_id text NOT NULL,
    source_key text,
    current_revision integer NOT NULL CHECK (current_revision >= 1),
    created_at_utc text NOT NULL,
    updated_at_utc text NOT NULL,
    PRIMARY KEY (workspace_id, kind, record_id),
    UNIQUE (workspace_id, kind, source_key)
);

CREATE TABLE IF NOT EXISTS workspace_record_revisions (
    workspace_id text NOT NULL,
    kind text NOT NULL,
    record_id text NOT NULL,
    revision integer NOT NULL CHECK (revision >= 1),
    payload_json jsonb NOT NULL,
    deleted boolean NOT NULL DEFAULT false,
    created_at_utc text NOT NULL,
    PRIMARY KEY (workspace_id, kind, record_id, revision),
    FOREIGN KEY (workspace_id, kind, record_id)
        REFERENCES workspace_records(workspace_id, kind, record_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_records_kind_updated
    ON workspace_records(workspace_id, kind, updated_at_utc DESC);

ALTER TABLE workspace_records DROP CONSTRAINT IF EXISTS workspace_records_kind_check;
ALTER TABLE workspace_records ADD CONSTRAINT workspace_records_kind_check
    CHECK (kind IN ('playbook','journal','annotation','replay'));
"""


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


_TERMINAL_PROP_ATTEMPT_STATUSES = {"completed_pass", "failed_breach", "expired", "abandoned"}


def _canonical_json(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def _payload_fingerprint(payload: dict) -> str:
    return hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()


class PostgresStore:
    def __init__(self, dsn: str):
        self.dsn = dsn

    def connect(self):
        return psycopg.connect(self.dsn, row_factory=dict_row)

    def initialize(self) -> None:
        with self.connect() as conn:
            conn.execute(SCHEMA_SQL)
            conn.commit()

    def ensure_workspace(self, workspace_id: str) -> None:
        now = utc_now_iso()
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO workspaces(workspace_id,created_at_utc) VALUES(%s,%s) ON CONFLICT DO NOTHING",
                (workspace_id, now),
            )
            conn.commit()

    def put_dataset(self, manifest: DatasetManifest) -> None:
        with self.connect() as conn:
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
            conn.commit()

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

    def create_job(self, workspace_id: str, dataset_id: str, strategy_version: str, starting_balance: float) -> ResearchJobView:
        job_id = uuid4().hex
        now = utc_now_iso()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO research_jobs(
                    workspace_id,job_id,dataset_id,strategy_version,starting_balance,status,created_at_utc,updated_at_utc
                ) VALUES(%s,%s,%s,%s,%s,'queued',%s,%s)
                """,
                (workspace_id, job_id, dataset_id, strategy_version, starting_balance, now, now),
            )
            conn.commit()
        return self.get_job(workspace_id, job_id)

    def create_engine_job(
        self,
        workspace_id: str,
        dataset_id: str,
        starting_balance: float,
        protocol: dict,
        protocol_sha256: str,
    ) -> ResearchJobView:
        job_id = uuid4().hex
        now = utc_now_iso()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO research_jobs(
                    workspace_id,job_id,dataset_id,strategy_version,starting_balance,status,
                    protocol_json,protocol_sha256,created_at_utc,updated_at_utc
                ) VALUES(%s,%s,%s,'bar-breakout-v1',%s,'queued',%s::jsonb,%s,%s,%s)
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
                ),
            )
            conn.commit()
        return self.get_job(workspace_id, job_id)

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
        if not isinstance(checkpoint, dict):
            raise ValueError("checkpoint must be an object")
        if checkpoint.get("schema") != "research-job-checkpoint-v1" or not isinstance(checkpoint.get("phase"), str):
            raise ValueError("checkpoint schema/phase is invalid")
        if progress is not None and not isinstance(progress, dict):
            raise ValueError("progress must be an object")
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
        return {
            "checkpoint": row["checkpoint_json"],
            "progress": row["progress_json"],
            "current_attempt_no": int(row["attempt_no"]),
            "status": row["status"],
            "updated_at_utc": row["updated_at_utc"],
        }

    def _recover_expired_jobs(self, conn, now: str) -> list[dict]:
        return conn.execute(
            """
            UPDATE research_jobs
            SET status=CASE WHEN cancel_requested THEN 'canceled' ELSE 'queued' END,
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

    def create_record(self, workspace_id: str, kind: str, payload: dict, *, source_key: str | None = None) -> dict:
        self.ensure_workspace(workspace_id)
        record_id = uuid4().hex
        now = utc_now_iso()
        with self.connect() as conn:
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
        if not row:
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
            ids = conn.execute(
                "SELECT record_id FROM workspace_records WHERE workspace_id=%s AND kind=%s ORDER BY updated_at_utc DESC,record_id",
                (workspace_id, kind),
            ).fetchall()
        records = [self.get_record(workspace_id, kind, row["record_id"]) for row in ids]
        return [record for record in records if record and not record["deleted"]]

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
        with self.connect() as conn:
            current = conn.execute(
                """
                SELECT current_revision FROM workspace_records
                WHERE workspace_id=%s AND kind=%s AND record_id=%s
                FOR UPDATE
                """,
                (workspace_id, kind, record_id),
            ).fetchone()
            if not current:
                raise LookupError("record not found")
            if int(current["current_revision"]) != int(expected_revision):
                raise RuntimeError("record revision conflict")
            revision = int(expected_revision) + 1
            conn.execute(
                """
                INSERT INTO workspace_record_revisions(
                    workspace_id,kind,record_id,revision,payload_json,deleted,created_at_utc
                ) VALUES(%s,%s,%s,%s,%s::jsonb,false,%s)
                """,
                (workspace_id, kind, record_id, revision, json.dumps(payload, sort_keys=True), now),
            )
            conn.execute(
                """
                UPDATE workspace_records SET current_revision=%s,updated_at_utc=%s
                WHERE workspace_id=%s AND kind=%s AND record_id=%s
                """,
                (revision, now, workspace_id, kind, record_id),
            )
            conn.commit()
        return self.get_record(workspace_id, kind, record_id)

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
        return PropSessionSnapshot.model_validate(row["snapshot_json"]) if row else None

    def list_prop_sessions(self, workspace_id: str) -> list[PropSessionSnapshot]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT snapshot_json FROM prop_sessions
                WHERE workspace_id=%s
                ORDER BY updated_at_utc DESC,session_id
                """,
                (workspace_id,),
            ).fetchall()
        return [PropSessionSnapshot.model_validate(row["snapshot_json"]) for row in rows]

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

    def create_prop_attempt(
        self,
        attempt: ChallengeAttemptSnapshot,
        phase: PhaseStateSnapshot,
        *,
        resume_state: dict | None = None,
    ) -> dict:
        if attempt.revision != 1:
            raise PropPersistenceConflict("new prop attempts must start at revision 1")
        resume = dict(resume_state or {})
        now = utc_now_iso()
        with self.connect() as conn:
            session_row = conn.execute(
                "SELECT snapshot_json FROM prop_sessions WHERE workspace_id=%s AND session_id=%s FOR UPDATE",
                (attempt.workspace_id, attempt.session_id),
            ).fetchone()
            if session_row is None:
                raise LookupError("prop session not found")
            session = PropSessionSnapshot.model_validate(session_row["snapshot_json"])
            self._validate_prop_phase_scope(session, attempt, phase)
            self._validate_resume_counts(phase, resume)
            if attempt.parent_attempt_id:
                parent = conn.execute(
                    """
                    SELECT 1 FROM prop_attempts
                    WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s
                    """,
                    (attempt.workspace_id, attempt.session_id, attempt.parent_attempt_id),
                ).fetchone()
                if parent is None:
                    raise PropPersistenceConflict("parent prop attempt does not exist in this session")

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
        if attempt.workspace_id != session.workspace_id or attempt.session_id != session.session_id:
            raise PropPersistenceConflict("prop attempt does not belong to the session")

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

            if attempt.parent_attempt_id:
                parent = conn.execute(
                    """
                    SELECT 1 FROM prop_attempts
                    WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s
                    """,
                    (attempt.workspace_id, attempt.session_id, attempt.parent_attempt_id),
                ).fetchone()
                if parent is None:
                    raise PropPersistenceConflict("parent prop attempt does not exist in this session")

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
        return ChallengeAttemptSnapshot.model_validate(row["snapshot_json"]) if row else None

    def list_prop_attempts(self, workspace_id: str, session_id: str) -> list[ChallengeAttemptSnapshot]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT snapshot_json FROM prop_attempts
                WHERE workspace_id=%s AND session_id=%s
                ORDER BY created_at_utc,attempt_id
                """,
                (workspace_id, session_id),
            ).fetchall()
        return [ChallengeAttemptSnapshot.model_validate(row["snapshot_json"]) for row in rows]

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
        return {
            "session": PropSessionSnapshot.model_validate(row["session_json"]),
            "attempt": ChallengeAttemptSnapshot.model_validate(row["attempt_json"]),
            "phase": PhaseStateSnapshot.model_validate(row["phase_json"]),
            "resume_state": row["resume_json"],
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
            if phase.last_event_sequence < current_phase.last_event_sequence:
                raise PropPersistenceConflict("prop event sequence cannot move backwards")
            if phase.virtual_time_utc < current_phase.virtual_time_utc:
                raise PropPersistenceConflict("prop virtual time cannot move backwards")
            if phase.phase_index < current_phase.phase_index or phase.phase_index > current_phase.phase_index + 1:
                raise PropPersistenceConflict("prop phase index must stay current or advance exactly once")

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
