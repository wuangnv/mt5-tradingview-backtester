from __future__ import annotations

import json
from dataclasses import dataclass
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row

from .contracts import DatasetManifest, ResearchJobView, utc_now_iso


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
ALTER TABLE research_jobs DROP CONSTRAINT IF EXISTS research_jobs_status_check;
ALTER TABLE research_jobs ADD CONSTRAINT research_jobs_status_check
    CHECK (status IN ('queued','running','completed','failed','canceled'));

CREATE INDEX IF NOT EXISTS idx_research_jobs_lease_expiry
    ON research_jobs(status, lease_expires_at_utc);

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
    attempt_no: int
    lease_owner: str
    lease_token: str


class StaleJobAttempt(RuntimeError):
    pass


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
            status=row["status"],
            cancel_requested=bool(row["cancel_requested"]),
            result_path=row["result_path"],
            result_sha256=row["result_sha256"],
            error_code=row["error_code"],
            created_at_utc=row["created_at_utc"],
            updated_at_utc=row["updated_at_utc"],
        )

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

    def claim_next_job(self, worker_id: str = "local-worker", lease_seconds: int = 30) -> ClaimedJob | None:
        worker_id = worker_id.strip()
        if not worker_id:
            raise ValueError("worker_id is required")
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")
        lease_token = uuid4().hex
        with self.connect() as conn:
            now = utc_now_iso()
            self._recover_expired_jobs(conn, now)
            row = conn.execute(
                """
                SELECT workspace_id,job_id,dataset_id,strategy_version,starting_balance,attempt_no
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
                "SELECT status FROM research_jobs WHERE workspace_id=%s AND job_id=%s FOR UPDATE",
                (workspace_id, job_id),
            ).fetchone()
            if not row:
                conn.rollback()
                return None
            if row["status"] == "queued":
                conn.execute(
                    "UPDATE research_jobs SET status='canceled',cancel_requested=true,updated_at_utc=%s WHERE workspace_id=%s AND job_id=%s",
                    (now, workspace_id, job_id),
                )
            elif row["status"] == "running":
                conn.execute(
                    """
                    UPDATE research_jobs
                    SET status='canceled',cancel_requested=true,result_path=NULL,result_sha256=NULL,
                        lease_owner=NULL,lease_token=NULL,lease_expires_at_utc=NULL,updated_at_utc=%s
                    WHERE workspace_id=%s AND job_id=%s
                    """,
                    (now, workspace_id, job_id),
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
