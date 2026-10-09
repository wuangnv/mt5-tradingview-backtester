CREATE TABLE download_sources (
    provider text PRIMARY KEY,
    snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
    revision bigint NOT NULL DEFAULT 1,
    updated_at_utc timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE download_jobs (
    workspace_id text NOT NULL,
    provider text NOT NULL,
    job_id text NOT NULL CHECK (job_id ~ '^[a-f0-9]{32}$'),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    public_snapshot jsonb NOT NULL CHECK (jsonb_typeof(public_snapshot) = 'object'),
    owner_lock_key bigint NOT NULL,
    revision bigint NOT NULL DEFAULT 1,
    created_at_utc timestamptz NOT NULL,
    updated_at_utc timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (workspace_id, provider, job_id),
    CHECK (payload->>'workspace_id' = workspace_id AND payload->>'job_id' = job_id)
);
CREATE INDEX download_jobs_workspace_created_idx
    ON download_jobs (workspace_id, provider, created_at_utc DESC, job_id DESC);

-- The physical advisory lock is the worker's ownership proof. A crashed process
-- cannot leave a native read permanently reporting a running download.
CREATE VIEW download_job_snapshots AS
SELECT j.workspace_id, j.provider, j.job_id, j.revision, j.created_at_utc, j.updated_at_utc,
       j.public_snapshot || jsonb_build_object(
           'revision', j.revision,
           'status', CASE WHEN (j.payload->>'status' IN ('running','pausing')
                              OR (j.payload->>'status'='queued' AND j.updated_at_utc < clock_timestamp()-interval '30 seconds'))
                              AND NOT EXISTS (
                  SELECT 1 FROM pg_locks l
                  WHERE l.locktype='advisory' AND l.granted AND l.objsubid=1
                    AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())
                    AND l.classid=((j.owner_lock_key >> 32) & 4294967295)::oid
                    AND l.objid=(j.owner_lock_key & 4294967295)::oid
              ) THEN 'paused' ELSE j.payload->>'status' END,
           'error', CASE WHEN (j.payload->>'status' IN ('running','pausing')
                              OR (j.payload->>'status'='queued' AND j.updated_at_utc < clock_timestamp()-interval '30 seconds'))
                              AND NOT EXISTS (
                  SELECT 1 FROM pg_locks l
                  WHERE l.locktype='advisory' AND l.granted AND l.objsubid=1
                    AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())
                    AND l.classid=((j.owner_lock_key >> 32) & 4294967295)::oid
                    AND l.objid=(j.owner_lock_key & 4294967295)::oid
              ) THEN CASE WHEN j.payload->>'status'='pausing' THEN NULL ELSE 'download_interrupted' END
              ELSE j.payload->>'error' END,
           'retry_after_seconds', CASE WHEN j.payload->>'status' IN ('paused','failed') THEN
               GREATEST(0, CEIL(GREATEST(COALESCE((j.payload->>'retry_at')::double precision,0),
                   COALESCE((s.snapshot->>'cooldown_until')::double precision,0)) - EXTRACT(EPOCH FROM clock_timestamp())))::bigint
               ELSE 0 END
       ) AS snapshot
FROM download_jobs j LEFT JOIN download_sources s ON s.provider=j.provider;
