ALTER TABLE research_jobs
    ADD COLUMN max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
    ADD COLUMN available_at_utc timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN retry_base_seconds integer NOT NULL DEFAULT 2 CHECK (retry_base_seconds >= 0),
    ADD COLUMN idempotency_key text,
    ADD COLUMN request_fingerprint text;

CREATE UNIQUE INDEX idx_research_jobs_idempotency
    ON research_jobs(workspace_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_research_jobs_available
    ON research_jobs(available_at_utc,created_at_utc,job_id) WHERE status='queued';
