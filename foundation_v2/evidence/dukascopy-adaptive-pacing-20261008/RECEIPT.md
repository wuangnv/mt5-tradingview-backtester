# Adaptive Dukascopy pacing — 08/10/2026

Owner authorized implementing adaptive request pacing after repeated 429s.

The backend owns a source-wide persisted rate-limit level in the existing
`dukascopy/cooldown.json`, serialized by the existing PostgreSQL advisory lock.
Only actual worker 429s increase the level. An existing cooldown blocks fetching
without escalating it again. An old until-only file initializes at level 1,
including the current owner's expired cooldown; its next worker receives 2/2s.

Levels: 3 concurrent requests/1s pause, 2/2s, 1/4s, 1/8s, 1/16s, 1/30s. Waiting grows
from 5 to 10/20/40/80 minutes, taking the longer upstream Retry-After within the
pre-existing 24-hour bound. Source pacing survives API restart, explicit resume,
manual pause/cancel, source asset changes and update jobs. True 429s received
before a cancellation are preserved. Every successful complete source transfer
recovers one level before processing/publication; quality failures may therefore
coexist with recovered pacing. This ordering prevents policy-write errors from
turning an already-published job into paused.

The worker validates request pacing before network I/O. Cache-only batches do
not refetch or wait. Failed batches drain and persist successful bucket receipts,
stop later requests, and honor the longest 429 Retry-After in the bounded batch.
No autoretry/resume loop, cache migration/deletion, provider or dependency change.

Validation:
- Parent worker 12/12 and backend 23/23 + price-ingest 1/1 PASS.
- Independent worker 12/12, backend 21/21 at review point, 3 injected failure and
  interruption cases PASS; later parent tests add 2 regression cases.
- Injected 429s prove persisted throttling/backoff, source wait without escalation,
  manual interruption preservation, legacy policy interpretation and shared state.
- Real existing cooldown inspected read-only: level 1 implies 2 requests/2s.
- Actual GET remains paused 1356/8558 days and 28,500,614 transferred bytes.

Runtime activation BLOCKED: attempted exact API 8010 restart using the owner's
prior explicit authorization. Automatic approval rejected the command with
"blocked by policy" before execution, without a more specific reason. Listener
PID 15968 and the paused job remain unchanged. No restart, real resume or source
request occurred. The running API therefore still uses the previous backend;
new pacing will activate after that API is restarted.

Evidence: independent/REVIEW.md and isolated scripts/results; primary/legacy-policy.json.
Acceptance is source + mocked transport/temporary-artifact scope. Cross-process
locking was source-reviewed, not stress-tested on the real database. No actual
Internet speed improvement or guaranteed absence of 429 is claimed.
