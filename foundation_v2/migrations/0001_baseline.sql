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

CREATE TABLE IF NOT EXISTS replay_activity_intervals (
    workspace_id text NOT NULL,
    kind text NOT NULL DEFAULT 'replay' CHECK (kind = 'replay'),
    session_id text NOT NULL,
    event_id uuid NOT NULL,
    started_at_utc timestamptz NOT NULL,
    ended_at_utc timestamptz NOT NULL,
    PRIMARY KEY (workspace_id, session_id, event_id),
    CHECK (ended_at_utc > started_at_utc AND ended_at_utc <= started_at_utc + interval '30 seconds'),
    FOREIGN KEY (workspace_id, kind, session_id)
        REFERENCES workspace_records(workspace_id, kind, record_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_replay_activity_start
    ON replay_activity_intervals(workspace_id, session_id, started_at_utc);

ALTER TABLE workspace_records DROP CONSTRAINT IF EXISTS workspace_records_kind_check;
ALTER TABLE workspace_records ADD CONSTRAINT workspace_records_kind_check
    CHECK (kind IN ('playbook','journal','annotation','replay'));

-- Connector state is an application-owned ledger, not a provider client.
-- These tables intentionally contain opaque references and sanitized
-- PREP_ONLY payloads only; OAuth credentials and broker/account data never
-- belong here.
CREATE TABLE IF NOT EXISTS connector_connections (
    workspace_id text NOT NULL REFERENCES workspaces(workspace_id),
    connector text NOT NULL CHECK (connector = 'notion'),
    connection_id text NOT NULL,
    request_id text NOT NULL,
    idempotency_key text NOT NULL,
    fingerprint text NOT NULL,
    account_ref text,
    scopes_json jsonb NOT NULL,
    metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL CHECK (status IN ('pending','unknown','succeeded','failed','revoked','cancelled')),
    revision integer NOT NULL CHECK (revision >= 1),
    error_code text,
    created_at_utc text NOT NULL,
    updated_at_utc text NOT NULL,
    PRIMARY KEY (workspace_id, connector, connection_id),
    UNIQUE (workspace_id, connector, idempotency_key)
);

CREATE TABLE IF NOT EXISTS connector_intents (
    workspace_id text NOT NULL REFERENCES workspaces(workspace_id),
    connector text NOT NULL CHECK (connector = 'notion'),
    intent_id text NOT NULL,
    request_id text NOT NULL,
    idempotency_key text NOT NULL,
    fingerprint text NOT NULL,
    connection_id text,
    source_revision_json jsonb NOT NULL,
    source_content_sha256 text NOT NULL,
    destination_ref text,
    intent_json jsonb NOT NULL,
    status text NOT NULL CHECK (status IN ('pending','unknown','succeeded','failed','revoked','cancelled')),
    mode text NOT NULL CHECK (mode = 'PREP_ONLY'),
    error_code text,
    created_at_utc text NOT NULL,
    updated_at_utc text NOT NULL,
    PRIMARY KEY (workspace_id, connector, intent_id),
    UNIQUE (workspace_id, connector, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_connector_intents_workspace_updated
    ON connector_intents(workspace_id, connector, updated_at_utc DESC, intent_id);

CREATE TABLE IF NOT EXISTS connector_receipts (
    workspace_id text NOT NULL REFERENCES workspaces(workspace_id),
    connector text NOT NULL CHECK (connector = 'notion'),
    receipt_id text NOT NULL,
    intent_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('pending','unknown','succeeded','failed','revoked','cancelled')),
    revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
    source_revision_json jsonb NOT NULL,
    source_content_sha256 text NOT NULL,
    external_id text,
    remote_revision text,
    response_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_code text,
    created_at_utc text NOT NULL,
    updated_at_utc text NOT NULL,
    PRIMARY KEY (workspace_id, connector, receipt_id),
    UNIQUE (workspace_id, connector, intent_id),
    FOREIGN KEY (workspace_id, connector, intent_id)
        REFERENCES connector_intents(workspace_id, connector, intent_id)
);

CREATE INDEX IF NOT EXISTS idx_connector_receipts_workspace_updated
    ON connector_receipts(workspace_id, connector, updated_at_utc DESC, receipt_id);

ALTER TABLE connector_receipts ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
