# Owner-authorized offline history purge — 2026-10-07

Owner explicitly approved deleting the old datasets and their dependent sessions:
“ko sao, bạn cứ xoá hết đi cũng được”. Scope was the local tenant-a Exness history,
not other workspace databases, education, strategies or MT5/online implementation.

## Completed operation

- Verified the active API uses the loopback `trading_workspace_v2_exness_history`
  database and `foundation_v2/.runtime/exness-market-data/tenant-a` artifacts.
- Audited 44 catalog datasets, all with original source `Exness-MT5Trial14 / MT5`.
  All six current replay sessions referenced those dataset IDs. No research jobs
  or Prop replay bindings existed in this workspace.
- Deleted six sessions through the existing revision/name-checked API. Its normal
  immutable deletion receipts remain; canonical session reads return 404.
- Removed 44 dataset catalog rows in a scoped PostgreSQL transaction after
  checking no active replay session or research job remained.
- Validated every absolute filesystem target under the exact tenant artifact
  directory and rejected reparse points. Removed 1,106 exact historical files,
  totalling 1,810,552,897 bytes: normalized datasets, raw sources, Bid/Ask tick
  artifacts, historical captures, history-state and tick-backfill metadata.
  Removal used individual files; empty directories contain no historical data.
- Kept existing `account-pin.json` and `live-snapshot.json`, which belong to the
  deferred online scope. Active API has neither `--mt5-python` nor `--ticks`, so
  no collector is running. No terminal restart, broker call or downloader run.

## Verification

Post-operation PostgreSQL audit: datasets 0, research jobs 0, no active replay
records; all six replay records carry the normal deleted state. Dataset/raw/tick
and historical capture files are absent.

`node foundation_v2/evidence/offline-data-purge-20261007/verify.mjs` passed against
the real local API/UI, with no fixtures: dataset/session catalogs empty, six old
session endpoints return 404, library displays zero saved datasets and its empty
state, Import CSV remains enabled, no page errors or writes/Live API requests.
Machine-readable receipt: `verification.json`; screenshot: `empty-library.png`.

Refreshed the user's existing in-app browser tab and observed “0 bộ dữ liệu đã
lưu” / “Chưa có dữ liệu offline. Nhập CSV để bắt đầu.” No user tab was closed.
`git diff --check` passed. No product code changed in this operation; README was
updated so previous Exness import checkpoints are understood as historical.

Dukascopy data is not imported and its downloader is not enabled by this purge.
This receipt proves deletion and the empty-library state, not data-source or
whole-product readiness.
