"""Real PostgreSQL boundaries; the caller must provide a disposable fixture."""
import os
from concurrent.futures import ThreadPoolExecutor
from psycopg import sql
from tempfile import TemporaryDirectory
from uuid import uuid4

import pytest
from psycopg_pool import PoolTimeout

from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.contracts import DatasetSource
from trading_workspace_v2.research import ResearchService
from trading_workspace_v2.migrations import apply_migrations
from trading_workspace_v2.store import JobIdempotencyConflict, PostgresStore, SCHEMA_SQL


@pytest.fixture
def store():
    dsn = os.environ.get("TW_V2_DATABASE_URL")
    if not dsn or os.environ.get("TW_V2_ALLOW_DESTRUCTIVE_TEST_DB") != "1":
        pytest.skip("requires explicitly disposable PostgreSQL fixture")
    item = PostgresStore(dsn, pool_size=2, pool_timeout=.25, dedicated_size=1)
    item.initialize()
    with item.connect() as conn:
        conn.execute("TRUNCATE workspaces CASCADE")
    yield item
    item.close()


@pytest.fixture
def job_scope(store):
    workspace = "platform-" + uuid4().hex
    with TemporaryDirectory() as folder:
        service = ResearchService(store, ArtifactStore(folder))
        source = DatasetSource(source_id="platform-fixture", provider="synthetic", instrument_mapping={"EURUSD":"EURUSD"},
            license_use="qa-only", retrieved_at_utc="2026-01-01T00:00:00Z", export_settings="fixture")
        dataset = service.register_dataset(workspace_id=workspace, source=source, instrument_id="EURUSD", timeframe="1m",
            rows=[{"timestamp":1700000000+i*60,"open":1,"high":2,"low":1,"close":1,"volume":0} for i in range(4)])
        yield workspace, dataset.dataset_id


def test_pool_reuses_sessions_rolls_back_errors_and_enforces_capacity(store):
    with store.connect() as conn:
        first = conn.execute("SELECT pg_backend_pid() AS pid").fetchone()["pid"]
    with store.connect() as conn:
        assert conn.execute("SELECT pg_backend_pid() AS pid").fetchone()["pid"] == first
    workspace = "rollback-" + uuid4().hex
    with pytest.raises(RuntimeError):
        with store.connect() as conn:
            conn.execute("INSERT INTO workspaces VALUES(%s,'fixture')", (workspace,))
            raise RuntimeError("abort")
    with store.connect() as conn:
        assert conn.execute("SELECT 1 FROM workspaces WHERE workspace_id=%s", (workspace,)).fetchone() is None
        with store.connect():
            with pytest.raises(PoolTimeout):
                with store.connect():
                    pass


def test_dedicated_lock_dies_on_exception_without_contaminating_pool(store):
    key = 0x504C4154
    with pytest.raises(RuntimeError):
        with store.dedicated_connection() as owner:
            owner.execute("SELECT pg_advisory_lock(%s)", (key,))
            raise RuntimeError("abort")
    with store.dedicated_connection() as contender:
        assert contender.execute("SELECT pg_try_advisory_lock(%s) AS owned", (key,)).fetchone()["owned"]
    with store.connect() as conn:
        assert conn.execute("SELECT count(*) AS n FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory'").fetchone()["n"] == 0
    with store.dedicated_connection():
        with pytest.raises(PoolTimeout):
            with store.dedicated_connection():
                pass
    with store.dedicated_connection() as next_owner:
        assert next_owner.execute("SELECT 1 AS value").fetchone()["value"] == 1


def test_batch_records_preserves_scope_order_revisions_and_deleted_filter(store):
    workspace = "records-" + uuid4().hex
    other = "records-" + uuid4().hex
    store.ensure_workspace(workspace)
    store.ensure_workspace(other)
    records = [store.create_record(workspace, "journal", {"value":i}) for i in range(5)]
    store.create_record(other, "journal", {"value":"private"})
    updated = store.update_record(workspace,"journal", records[1]["record_id"],1,{"value":"updated"})
    with store.connect() as conn:
        conn.execute("UPDATE workspace_record_revisions SET deleted=true WHERE workspace_id=%s AND record_id=%s", (workspace, records[2]["record_id"]))
    result = store.list_records(workspace,"journal")
    assert len(result) == 4
    assert result[0] == updated
    assert all(row == store.get_record(workspace,"journal",row["record_id"]) for row in result)


def test_job_idempotency_is_atomic_scoped_and_rejects_content_reuse(store,job_scope):
    workspace,dataset = job_scope
    with ThreadPoolExecutor(max_workers=2) as executor:
        jobs = list(executor.map(lambda _: store.create_job(workspace,dataset,"close-delta-v1",10000,
            idempotency_key="same-request"), range(2)))
    assert jobs[0].job_id == jobs[1].job_id
    with pytest.raises(JobIdempotencyConflict):
        store.create_job(workspace,dataset,"close-delta-v1",20000,idempotency_key="same-request")


def test_expiry_backoff_attempt_cap_and_stale_fencing(store,job_scope):
    workspace,dataset = job_scope
    job = store.create_job(workspace,dataset,"close-delta-v1",10000)
    first = store.claim_next_job("platform-first")
    assert first.job_id == job.job_id
    with store.connect() as conn:
        conn.execute("UPDATE research_jobs SET max_attempts=2,retry_base_seconds=60,lease_expires_at_utc=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE job_id=%s",(job.job_id,))
    store.recover_expired_jobs()
    assert store.claim_next_job("platform-delayed") is None
    with store.connect() as conn:
        row = conn.execute("SELECT available_at_utc > CURRENT_TIMESTAMP AS delayed,status FROM research_jobs WHERE job_id=%s",(job.job_id,)).fetchone()
        assert row == {"delayed":True,"status":"queued"}
        conn.execute("UPDATE research_jobs SET available_at_utc=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE job_id=%s",(job.job_id,))
    second = store.claim_next_job("platform-second")
    assert second.attempt_no == 2
    assert store.retry_job(first,"TRANSIENT") is False
    assert store.retry_job(second,"TRANSIENT") is True
    assert store.get_job(workspace,job.job_id).status == "failed"
    assert store.claim_next_job("platform-exhausted") is None


def test_migration_reentry_and_checksum_mismatch_fail_closed(store):
    store.initialize()
    with store.connect() as conn:
        rows = conn.execute("SELECT version,sha256 FROM tw_schema_migrations ORDER BY version").fetchall()
        assert len(rows) >= 2
        version = rows[0]["version"]
        conn.execute("UPDATE tw_schema_migrations SET sha256='tampered' WHERE version=%s",(version,))
    try:
        with pytest.raises(RuntimeError, match="checksum mismatch"):
            store.initialize()
    finally:
        with store.connect() as conn:
            conn.execute("UPDATE tw_schema_migrations SET sha256=%s WHERE version=%s",(rows[0]["sha256"],version))
    store.initialize()


def test_migrations_adopt_legacy_schema_preserving_existing_rows(store):
    schema = "legacy_" + uuid4().hex
    with store.dedicated_connection() as conn:
        try:
            with conn.transaction():
                conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
                conn.execute(sql.SQL("SET LOCAL search_path TO {}").format(sql.Identifier(schema)))
                conn.execute(SCHEMA_SQL)
                conn.execute("INSERT INTO workspaces VALUES('legacy-owner','fixture')")
                applied = apply_migrations(conn)
                assert applied[0] == "0001_baseline.sql"
                assert conn.execute("SELECT workspace_id FROM workspaces").fetchone()["workspace_id"] == "legacy-owner"
                assert apply_migrations(conn) == []
        finally:
            conn.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema)))


def test_retry_cancellation_wins_and_deterministic_failure_stays_terminal(store,job_scope):
    workspace,dataset = job_scope
    job = store.create_job(workspace,dataset,"close-delta-v1",10000)
    attempt = store.claim_next_job("cancel-worker")
    store.cancel_job(workspace,job.job_id)
    store.retry_job(attempt,"TRANSIENT")
    assert store.get_job(workspace,job.job_id).status == "canceled"
    second_job = store.create_job(workspace,dataset,"close-delta-v1",10000)
    second_attempt = store.claim_next_job("validation-worker")
    assert store.fail_job(second_attempt,"INVALID_PROTOCOL")
    assert store.get_job(workspace,second_job.job_id).status == "failed"
    assert store.claim_next_job("no-retry") is None
