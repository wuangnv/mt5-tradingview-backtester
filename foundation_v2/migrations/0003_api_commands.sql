CREATE TABLE api_commands (
    command_id uuid PRIMARY KEY,
    contract_version text NOT NULL CHECK (contract_version = 'api-command-v1'),
    workspace_id text NOT NULL REFERENCES workspaces(workspace_id),
    identity_id text NOT NULL CHECK (length(identity_id) BETWEEN 1 AND 200),
    method text NOT NULL CHECK (method IN ('GET','POST','PATCH','PUT','DELETE')),
    path text NOT NULL CHECK (length(path) BETWEEN 1 AND 2048),
    query jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(query)='array'),
    body jsonb,
    origin text,
    request_hash text NOT NULL CHECK (length(request_hash)=64),
    idempotency_key text CHECK (length(idempotency_key) BETWEEN 1 AND 200),
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
    attempt_no integer NOT NULL DEFAULT 0 CHECK (attempt_no>=0),
    max_attempts integer NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 3),
    lease_owner text,
    lease_token uuid,
    lease_expires_at_utc timestamptz,
    available_at_utc timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deadline_at_utc timestamptz NOT NULL,
    created_at_utc timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at_utc timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    result_status integer CHECK (result_status BETWEEN 100 AND 599),
    result_headers jsonb,
    result_body jsonb,
    result_text text,
    expires_at_utc timestamptz NOT NULL,
    UNIQUE(workspace_id, identity_id, idempotency_key),
    CHECK (expires_at_utc > deadline_at_utc),
    CHECK (method='GET' OR max_attempts=1),
    CHECK ((status='running') = (lease_token IS NOT NULL)),
    CHECK ((status IN ('completed','failed')) = (result_status IS NOT NULL))
);
CREATE INDEX api_commands_claim_idx ON api_commands(available_at_utc, created_at_utc)
    WHERE status='queued';
CREATE INDEX api_commands_lease_idx ON api_commands(lease_expires_at_utc)
    WHERE status='running';
CREATE INDEX api_commands_workspace_state_idx ON api_commands(workspace_id,status,created_at_utc);
CREATE INDEX api_commands_expiry_idx ON api_commands(expires_at_utc)
    WHERE status IN ('completed','failed');

CREATE TABLE api_command_workers (
    worker_id text PRIMARY KEY,
    contract_version text NOT NULL,
    heartbeat_at_utc timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    route_manifest jsonb NOT NULL
);
