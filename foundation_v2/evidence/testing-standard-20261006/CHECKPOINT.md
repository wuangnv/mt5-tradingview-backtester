# Testing standardization — 2026-10-06

The owner's approved Testing UI scope is implemented and independently reviewed.
The retained direction is Gọn đồng bộ; no framework or vendor asset changes.
The reusable contract is `../../../ui/testing-standard.md`, with an internal
component reference at `http://127.0.0.1:5180/?area=testing&ui_reference=1`.

## Delivered behavior

Shared text/control/icon/spacing roles, neutral hover, consistent select/dropdown
and focus presentation, responsive table controls and corrected local paging.
EN/VI covers Testing system copy and formatting while preserving user/source
names, tags, strategies, symbols and identifiers. Loading, retry, partial/stale,
unknown, empty and filtered-empty states keep their actual meaning.

Routes load on demand; Monte Carlo code and analytics experiments wait until
needed. Actual aggregate Trades reads a server page with full filtered count and
facets. Analytics remains a complete-scope report. Page/scope/revision transitions
are guarded against late responses. Existing unpaged API consumers are compatible.

## Verification

- Independent UI: **164 browser cases passed**, six surfaces, EN/VI, dark/light,
  390/768/1710 widths; 12 scoped Axe scans and 12 popup contrast checks. Actual
  advanced/lightweight chart journeys were read-only. See `independent/REVIEW.md`
  and `independent/final-receipt.json` for exact scope, source lineage and limits.
- Independent language review: 71 snapshots, 20 raw-data boundary checks and
  final accessible-label retests passed. See `language-review/RENDERED-REVIEW.md`.
- Independent paging: 29 backend cases and five controlled browser journeys
  passed, including 137-row paging, full facets, scope/snapshot reset and aborted
  stale responses. See `paging-review/INDEPENDENT-FINDINGS.md`.
- Root validation: production build, 64 focused Node tests, 75 Python tests and
  reusable browser smoke (12 route checks + two component reference journeys)
  passed. Staged diff check and credential-pattern review passed.
- Final whitespace cleanup changed no non-whitespace characters; a post-cleanup
  build, tests and browser smoke passed. The independent receipt records this
  lineage instead of claiming that older byte hashes stayed unchanged.

All actual API browser checks allowed GET/HEAD/OPTIONS only. Saved catalog and
selected session were compared before/after and stayed unchanged. No broker,
provider update or actual edit/archive/delete action was performed.

## Practical limits

The server still reconstructs canonical execution events per request; this is
response paging, not an indexed database query or a cross-request transaction.
Market metadata and demo ledgers page locally; no full bar/tick history download
was introduced. The actual selected replay has uninitialized execution, so its
blocked analytics state is expected; populated reports were tested using labeled
demo fixtures. This checkpoint is Testing UI acceptance, not whole-product or
broker/live acceptance.
