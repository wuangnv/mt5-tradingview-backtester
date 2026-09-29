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
| Provider connection | `disconnected`, `oauth_pending`, `connected`, `expired`, `revoked` | `ProviderOAuthConnection` | Future Drive/Notion/Learn OAuth state; no callback or token exchange is implemented |

Starting provider OAuth requires an active product session. Signing out the
product does not silently revoke a provider connection; the two authorities
must be handled explicitly. Provider `oauth_state` is represented only as a
pending-state marker and is never returned by `snapshot()`.

## Expiry and sign-out

Expiry is fail-closed at the exact `expires_at_utc` boundary. `snapshot(now)`
reports `expired` without mutating the object, so callers cannot accidentally
extend a session by reading it. `sign_out(now)` records an explicit sign-out
timestamp and is idempotent. `revoke()` is a separate terminal action.

## What this does not provide

This contract is suitable for the current trusted local/demo product boundary
and tests. It is **not** a login endpoint, identity provider integration,
session-cookie implementation, account recovery flow, or OAuth client. A
production rollout still needs a separately reviewed authentication service,
secure session persistence, CSRF/session-cookie policy, provider token vault,
and account/workspace authorization integration.
