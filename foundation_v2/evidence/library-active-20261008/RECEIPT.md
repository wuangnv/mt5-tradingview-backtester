# Library active-download controls — 08/10/2026

Scope: existing offline data library; no MT5/live/broker actions or real data deletion/import/download changes.

## Behavior

- Download status adds Downloading (queued/running/pausing), including updates of saved datasets. Not downloaded excludes active new downloads. Clear filters resets search/category/source/status and page; sort/page size stay unchanged.
- Unsupported/unknown history is explicit. Bundled Dukascopy earliest M1/Bid dates through yesterday UTC are shown as available history, distinct from verified local coverage. Exact count and replay size are unknown before processing; received payload bytes during downloads are labelled separately.
- Row ellipsis becomes Pause/Cancel; paused/failed rows offer Resume/Cancel. Pause is negotiated via supports_pause so an older API never exposes a fake enabled action. UI states and API actions are driven by real job journals, not optimistic completion.
- Pause journals pausing before terminating its owned child; ingestion/publication check interruption. Final cleanup yields paused and retains completed buckets. Cancel is terminal; remote-owner journal writes remain locked. No incomplete dataset is published.
- Worker commit efe87fe uses bounded concurrency 3, ordered per-day CSV writes, checksummed bucket cache and throttled progress. Global 429 cooldown remains. Benchmark is isolated generated data; it does not predict live Internet speed.

## Evidence

- Production web build PASS.
- Node library model 8/8 PASS, Node worker 10/10 PASS.
- Python full-download suite 17/17 PASS plus existing pure price-ingest regression 1/1 PASS; no user DB writes.
- Independent browser results/review in this folder: mocked APIs including intercepted pause/resume/cancel. Desktop/mobile dark/light, VI/EN, saved updates, backend-without-pause, empty/error, filter/sort/pager composition. Actual runtime rollout is separate.
- Reproducible before/after benchmark and independent performance/backend source review: performance/. Initial failed browser oracle for Paused retained as attempt-1.json; source now distinguishes action Pause from status Paused.
- Final backend review follow-up: processing-pause and unpublished artifact rollback tests were added. Final journal read/save clears active in finally after child cleanup; inherited exceptional process.wait failure remains outside this ordinary-path slice.

## Runtime rollout

At validation time API 8010 still runs older source and an owner-started full EUR/USD job. No restart or interruption has been performed. Existing Node child keeps old code; a new worker reads the optimized file. Runtime supports_pause is absent, so Pause remains disabled until API restart. Restart requires the owner gate in EXECUTION-ENTRYPOINT.md and must preserve raw/checksummed bucket cache, then resume the same job rather than start another full download.
