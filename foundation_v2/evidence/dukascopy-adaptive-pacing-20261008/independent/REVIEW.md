# Independent review: adaptive Dukascopy pacing

Result: PASS in the reviewed source and isolated fixture scope; no remaining blocking finding. Independently executed12 worker tests and21 backend tests, plus3 targeted injected scenarios. No real job, runtime, provider, database, or service was changed by this review lane.

## Source and ownership review

Reviewed `dukascopy_downloads.py`, `data_worker/index.mjs`, their scoped tests, and the production Postgres connection owner. The shared source policy uses the existing artifact-root advisory key. The owner connection holds its session advisory lock across policy read, worker lifetime,429 persistence, successful-transfer recovery, and publication; connection closure releases the lock. Policy writes therefore remain serialized across API processes sharing that database and artifact root. Per-job locks and existing in-process mutation gates remain intact.

Only a worker's actual `source_rate_limited` error escalates the level. Merely encountering an existing unexpired policy reuses its `until` without spawning a worker or escalating. A true429 is recorded before checking user pause/cancel, preserving the source signal even if the job was interrupted. New workers receive current persisted pacing; no automatic retry loop was added.

Levels are3 concurrent/1s pause,2/2s,1/4s,1/8s,1/16s,1/30s.429 waits increase to minimum5/10/20/40/80 minutes and saturate at the last level. The maximum of the existing source deadline, required level wait, and parsed Retry-After is kept. The pre-existing86400-second Retry-After cap remains; this review does not claim longer upstream waits are honored beyond that bound.

Legacy `until`-only policy files map to level1 even after their old wait expires. Missing policy starts at level0. Invalid level values fail closed. A complete successful source transfer recovers only one level. Recovery is now recorded before dataset processing/publication, so its meaning is network-transfer success, not publication/quality acceptance. A later quality failure can therefore coexist with a recovered pacing level; this is the explicit final implementation trade-off.

Worker pacing is consumed from `request.json` and validated before source requests. Network batches wait only when at least one bucket was fetched and another batch remains; cached-only resume skips artificial waits. A failed bounded batch drains in-flight work, retains successful checksummed bucket receipts, stops later scheduling, and selects the longest429 Retry-After over other failures. Existing raw receipt validation, ordered CSV output, byte/cache accounting, pause/cancel and publication safeguards remain in place.

## Finding resolved during review

The first source ordering placed policy recovery after `_complete`, allowing a policy-write failure to downgrade an already-published completion. Parent moved recovery before `_complete`. The independent injected OSError case now confirms paused/download_interrupted, no dataset id, and **zero publication calls**. This prevents an inconsistent completed-dataset/paused-job result. The failure intentionally blocks publication until the policy can be written; this is fail-closed behavior, not successful completion.

Additional isolated cases emit429 after a mocked user pause and cancel. Both retain the requested paused/cancelled state while persisting source policy level1/until10900, confirming interruption cannot discard an already-received429 signal. The tests do not imply a process terminated before receiving the source response can know an unseen429.

## Runnable evidence

From the product root:

```text
node --test foundation_v2/data_worker/tests/worker.test.mjs
.\foundation_v2\.venv\Scripts\python.exe foundation_v2/evidence/dukascopy-adaptive-pacing-20261008/independent/recovery-failure.py
.\foundation_v2\.venv\Scripts\python.exe foundation_v2/evidence/dukascopy-adaptive-pacing-20261008/independent/interruption-policy.py
```

From `foundation_v2`:

```text
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_dukascopy_full_downloads.py -v
```

Observed counts: worker12/12, backend21/21, policy-write failure1/1, interruption-policy2/2. The injected scripts write only evidence JSON and temporary mock artifacts; their temporary fixtures clean themselves up. `recovery-failure-results.json` and `interruption-policy-results.json` record the targeted outcomes.

Acceptance is source/fixture-level only. Cross-process lock ownership was inspected in source, not exercised against the live database. No real throughput benchmark, provider429/recovery experiment, restart, automatic retry, broker action, or full-product acceptance occurred. The change should reduce repeated provider pressure; its actual download speed and rate-limit behavior still require authorized runtime evidence after activation.
