# U2 Data Desk readiness — local contract slice

Date: **2026-09-29**  
Commit: **415fe78** (`feat(u2): expose fail-closed provider readiness`)

## Scope

This receipt covers the local/offline part of U2 only. It makes provider
readiness visible without opening a network connector, OAuth flow, paid data
source, broker, or holdout. It does not claim production data entitlement or
real calendar/news coverage.

## What is verified

| Area | Current contract | Result |
| --- | --- | --- |
| Provider boundary | `/api/v2/data/providers` keeps the existing capability table and now includes a bounded `readiness` profile. Local catalog and static fixtures declare `offline`, `network_access=false`, `oauth_required=false`, and `production_ready=false`. Unknown providers inherit the same fail-closed defaults. | PASS, source-level + focused tests |
| Entitlement meaning | `entitlement_status` is descriptive metadata (`dataset_metadata_only`, `fixture_only`, or `unverified`). It is never inferred from provider name or capability flags and never carries a credential, URL, account, or token. | PASS, fail-closed tests |
| Cost | Existing deterministic `CostModel`/`calculate_round_trip_cost` handles bid/ask fills, two-sided commission, slippage, financing, currency conversion and explicit rounding. It remains a contract preview, not a broker-real cost claim. | Existing U2 fixture contract |
| News / point-in-time | Existing `visible_events` only exposes events with `known_at_utc <= decision_time_utc`; missing `known_at` is hidden unless the caller explicitly asks for a labeled `archive_proxy`. | Existing U2 fixture contract |
| Calendar | No real holiday/DST calendar is selected. `scheduled_closed` is not inferred without a source/version. | Correctly remains OPEN |
| Local Data Desk | Browser sends bounded CSV text (10 MiB), server materializes a temporary file, computes raw/normalized hashes, counts, range, duplicate/order/gap quality, and imports immutable artifacts only after explicit confirmation. | Existing UI/API + focused tests |

## Validation

```text
foundation_v2/.venv/Scripts/python.exe -m pytest tests/test_u2_provider_readiness.py tests/test_u2_data_desk_payload.py -q
7 passed

npm run build  (cwd foundation_v2/web)
PASS — Vite 7.3.6, 66 modules
```

The build still reports the pre-existing JavaScript chunk-size warning (>500
kB); it is not a build failure. A full web test run in this shared worktree
was not used to judge this slice because another concurrent lane changed
`workspaceContext.js` while its legacy expectation was running.

## Remaining gates

- Select and verify a real market-data/news/calendar source, point-in-time
  revisions, holiday/DST behavior, and its license/redistribution/retention
  entitlement.
- Prove production-sized import throughput, cancellation/progress, storage
  backup/restore and concurrent-workload behavior against an approved fixture.
- Integrate cost/news/calendar metadata into a real research run only after
  the source and entitlement gates are explicitly approved.

No external request, credential, OAuth, paid subscription, holdout read,
broker call, or execution capability was used for this receipt.
