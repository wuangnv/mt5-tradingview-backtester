# Project session contract (local/demo)

Status: **offline contract only** (`project-session-v1`).

`trading_workspace_v2.project_session` describes the product session boundary
without claiming that the product has production authentication. A local session
contains only an opaque session label, a trusted local identity marker, a
selected workspace, timestamps, and lifecycle state. It deliberately contains
no password, cookie, bearer token, refresh token, provider credential, or
network call.

## Two separate lifecycles

| Boundary | States | Authority | Current meaning |
| --- | --- | --- | --- |
| Product session | `signed_in`, `signed_out`, `expired`, `revoked` | `ProjectSession` | Local/demo trusted identity; `production_auth=false` |
| Provider connection | `disconnected`, `oauth_pending`, `connected`, `expired`, `revoked` | `ProviderOAuthConnection` | Offline domain contract; the separate local Notion OAuth adapter below does not persist this model |

Starting provider OAuth requires an active product session. Signing out the
product does not silently revoke a provider connection; the two authorities
must be handled explicitly. Provider `oauth_state` is represented only as a
pending-state marker and is never returned by `snapshot()`.

## Expiry and sign-out

Expiry is fail-closed at the exact `expires_at_utc` boundary. `snapshot(now)`
reports `expired` without mutating the object, so callers cannot accidentally
extend a session by reading it. `sign_out(now)` records an explicit sign-out
timestamp and is idempotent. `revoke()` is a separate terminal action.

## Local Notion OAuth adapter

The MT5 project has a separate, local-only Notion authorization path. It is
disabled unless `TW_V2_NOTION_CLIENT_ID`, `TW_V2_NOTION_CLIENT_SECRET`, and
`TW_V2_NOTION_REDIRECT_URI` are all set in the backend process environment.
The redirect must be an `http://127.0.0.1` or `http://localhost` URL with path
`/api/v2/connectors/notion/oauth/callback`, and must match the URI registered
for the owner's Notion public integration. An explicit port is required. Never place the secret in the web
bundle or repository.

The authorized workspace calls `POST /api/v2/connectors/notion/oauth/start`
with `X-Workspace-Id`. It receives a Notion authorization URL; the browser
visits that URL and Notion returns to the callback. The backend checks a
one-time, ten-minute state plus the current workspace identity before the
token exchange. The UI can poll `GET /api/v2/connectors/notion/oauth/status`
and call `POST /api/v2/connectors/notion/oauth/disconnect`. These routes accept
only loopback clients. Responses expose only an opaque connection ID and
status, never a credential or provider workspace details.

The callback also checks that the browser's loopback host and port match the
configured redirect exactly. Start and disconnect require a same-origin POST.
OAuth responses, including errors, carry no-store, restrictive CSP,
no-referrer, and nosniff headers. Provider identity and granted permissions
remain unverified in status until a separate provider-read validation exists.

Access and optional refresh tokens are validated and held only in process
memory; both are lost on restart. If the provider supplies an access-token
expiry, status changes to `expired` at that boundary, or
`reconnect_required` when a refresh token exists but no refresh adapter is
enabled. The disconnect route removes this local token; it does not revoke it
at Notion.
The existing Notion report ledger and export flow remain `PREP_ONLY` with
`cloud_write=false`. OAuth completion grants no report-write authority.

## What this does not provide

This contract is suitable for the current trusted local/demo product boundary
and tests. It is **not** a production login endpoint, identity provider
integration, session-cookie implementation, or account recovery flow. A
production rollout still needs a separately reviewed authentication service,
secure session persistence, CSRF/session-cookie policy, durable provider token
vault, and account/workspace authorization integration. The local Notion path
does not change `production_auth=false`.
