# Offline download workflow audit — 08/10/2026

Scope: owner-requested investigation from library UI through API, pinned
dukascopy-node worker, durable cache, CSV validation and publication. This is
a focused maintenance receipt, not product-wide acceptance.

## Actual source finding

Owner EUR/USD job was paused at 1,358 / 8,558 days, with 28,516,998 transferred
bytes. Its last resume request had concurrency 1 / pause 4 seconds; the source
policy subsequently reached level 3 (next run 1 / 8 seconds). Existing journal
records `source_rate_limited`; old code did not retain response headers.

After the persisted cooldown expired, one Node GET to the first uncached day,
21/01/2007, returned HTTP 202, CloudFront, HTML content type, no Retry-After.
A second bounded GET to the same URL confirmed `x-amzn-waf-action: challenge`.
See `source-probe.json` and `waf-confirmation.json`. There were no further source
requests. This is an AWS WAF access challenge. Earlier 429s remain journal
evidence; their missing headers prevent attributing every earlier failure to WAF.
No full Internet transfer succeeded in this audit, and pacing/restart cannot
be claimed to remove the current access challenge.

Primary references:

- [AWS Challenge action](https://docs.aws.amazon.com/waf/latest/APIReference/API_ChallengeAction.html)
- [Upstream BufferFetcher](https://github.com/Leo4815162342/dukascopy-node/blob/master/src/buffer-fetcher/index.ts)
- [Upstream batching](https://www.dukascopy-node.app/custom-batching)

Pinned local 1.50.0 BufferFetcher source was inspected as well. With default
retryCount 0, non-200 HTTP responses can become empty buffers and then be
filtered out. Therefore apparent upstream completion is not an oracle for
complete historical coverage. The app deliberately keeps explicit HTTP failures
and source timestamps instead of silently omitting days or inventing flat bars.

## Changes and state flow

- UI GET polling reconnects after failures with bounded 5–30 second backoff;
  active jobs poll at 2 seconds and idle/paused jobs at 15 seconds. GET recovery,
  reload and other-tab observation never resend download POSTs.
- Source cooldown now gates new jobs and resume before a worker is spawned;
  paused-job public timers include the shared source cooldown.
- Worker retries only transient transport/408/502/503/504 errors, twice, with
  bounded delay and Retry-After handling. 429/access challenges are never retried
  automatically, and an in-flight batch stops retries once it sees a 429.
- `last-source-error.json` records URL/status and an allowlist of diagnostic
  headers, not cookies, tokens or arbitrary response content. Missing diagnostics
  do not hide the primary error.
- AWS challenge/captcha responses become `source_access_challenge`, preserve a
  paused job, do not escalate rate-limit levels, and do not invent a cooldown.
  Explanation appears in the existing progress tooltip/accessibility text and
  detail dialog, keeping the owner-requested grid free of redundant labels.
- Saved progress is retained while cache is revalidated; ETA uses fresh network
  days rather than the much faster cache scan. Old workers without network-day
  fields remain compatible.

Download is still full-history from the user's perspective. Daily buckets are
internal receipts for bounded memory and resume. Publication remains all-or-none;
updates preserve the parent's hash and create a new immutable dataset version.
No challenge solver, alternate endpoint, cookies/proxy rotation, new dependencies,
MT5/live mode, cache deletion or user-job mutation was introduced.

## Verification

- 16 worker tests passed: transient recovery, 429/challenge handling, CLI
  diagnostics, parallel draining, cache checksum/resume, ordered candles,
  maintained progress and exact bytes.
- 27 backend tests + 2 subtests passed, including real Node child execution with
  a labeled offline fetch fixture, transient 503 recovery, validated CSV/artifact
  publication, update versioning, pause/cancel and shared cooldown guards.
- 18 focused frontend tests passed; an existing stale expected supportsPause
  shape was corrected to the current contract. Production UI build passed.
- `qa.mjs`: actual Vite UI at 1710/768/360 with explicitly intercepted fixture
  API writes. Start once, network-poll recovery, pause, reload, cooldown disable,
  resume same job, cancel, challenge details and no automatic retries passed.
  A separate actual API GET-only page check passed. This is not a real Internet
  download success or a real browser-to-DB mutation acceptance.
- Owner cache read-only audit: 1,358 consecutive days, 1,393,457 original candles,
  28,527,452 bytes; every audited bucket SHA/row count matched. 1,359 receipt files
  include a successful later parallel bucket that resume will reuse. Full-history
  coverage and source availability remain unproven.

Runtime: no API restart or actual resume performed. UI changes are served by Vite;
backend changes require the existing `restart-offline-api.bat`. Restart loads the
fixes but does not grant access past WAF. Source access must use a provider-supported
route; the existing CSV import remains available for authorized exported history.
