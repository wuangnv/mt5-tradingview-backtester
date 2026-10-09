# Shared multi-asset OHLC replay — 09/10/2026

Scope: Quick Session asset picker and one persisted backtest session with shared
capital, replay clock, positions/history and chart switching. This is scoped
feature evidence, not whole-product or broker acceptance.

## Behavior and decisions

- Multi-select tags reuse FxSelect; selected options retain their normal surface,
  with an orange check after the right-aligned category. Option arrows are removed;
  required markers are red. Search, categories, version replacement and keyboard
  selection remain available. Maximum 12 instruments, one version per symbol,
  same account currency; an overlapping replay period is required.
- One parent revision persists all per-instrument execution snapshots. Stepping
  processes orders and protection for inactive charts. One starting balance is
  counted once; realized and floating P/L are combined across instruments.
- Asset switching is membership/revision guarded. Historical reconstruction and
  branching cover all members, dashboard totals deduplicate inherited trades,
  and dataset references protect every member against removal.
- Bar responses are bounded to 2,000 visible rows with absolute cursor offsets.
  Stale instruments cannot receive orders/protection changes in the past.
- Concurrent writes exposed a PostgreSQL joined-lock recheck returning a false
  404. Reading the revision after locking the parent fixes it; repeated race tests
  require one 200 and one 409. Existing deletion fixtures now register a real
  synthetic dataset, with a short artifact root for Windows MAX_PATH.

## Validation

- Focused replay/account/history/branch/analytics regression: 133 tests passed.
- Dedicated disposable PostgreSQL regression: 41 passed, 1 skipped (Windows
  symlink privilege), 3 subtests passed; six deletion fixtures initially failed
  because they referenced a nonexistent dataset. After repair, all 13 deletion
  tests passed on another disposable database. No production dataset was changed.
- Web build and 18 frontend unit tests passed.
- [Picker report](picker/report.json): 10 browser cases passed, including live
  read-only widths 1710/1440/768/360, labeled dark/light and Vietnamese/English
  fixtures, multiple selection/version replacement/removal, orange checks,
  required markers, empty/error states and generic selector regression.
- [Integration report](integration/report.json): real UI and API backed by a
  disposable PostgreSQL database. Create two-asset session, initialize/order on
  each chart, step both positions, switch, reload, amend protection, close both
  and read combined analytics. Expected starting balance 100000, ending balance
  100028.0, two closed trades; no browser JavaScript errors.
- Reviewed [picker](picker/selected-1440-dark.png),
  [two positions](integration/two-positions-1710.png), and responsive history
  screenshots at 1710 dark, 1440 light, 768 light and 360 dark. Narrow position
  tables intentionally use horizontal scrolling.
- Authorized offline API 8010 restart passed its process/download checks.
  Health, `ReplayCreate.dataset_ids`, asset selection route and two existing
  local datasets verified read-only after restart. UI 5180 remains available.

## Limits

OHLC backtest only. Multi-asset tick execution, broker margin models, Prop
bindings and portfolio price experiments are explicitly unsupported. Historical
portfolio queries use shared time/cursor rather than a local event sequence.
No live broker execution, provider download or user session creation was part of
the isolated integration journey.
