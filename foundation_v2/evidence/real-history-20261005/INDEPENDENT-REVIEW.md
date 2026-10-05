# Independent Exness local replay acceptance — 2026-10-05

PASS for imported-data provenance consistency, actual local causal chart display, empty execution/account state, metadata accuracy and bounded-loading fallback. This is not an acceptance of complete broker history, historical instrument/cost reconstruction, trading execution, SDK access or in-app browser compatibility.

## Exact evidence

- `review.json` contains before/after source and receipt hashes. ReplayWorkspace.jsx SHA256 `217773c066938f49e95de1ba2af3cba1121d9a4c6def7eb9b8033d8509c48ca4`; TradingViewReplayChart.jsx `6a9276a312fbe02a68d401bb09071fa8de2c75742f4c7f421c2690dc8a7d1f80`; advancedReplayDatafeed.js and export/import/preview/normalizedCSV hashes retained there. All fingerprints remained unchanged during review.
- CSV SHA256 `9412b633ae597ba0ee948e0d552f30c63a1f5fd3df2953dab2cde1ab74802356` matches export, import and preview chain. Retained raw export SHA256 `31051b9e169e8e3b4331e6ee651355af49aa478b4f3b18ffa206f6da734c63ba` independently verified.
- All93,810 normalized rows are chronological, unique and equal raw-export timestamps/tick_volume; prices equal raw values formatted at broker5digits. Maximum raw IEEEfloat serialization delta is2.220446049250313e-16, not a changed market price. Raw spread remains separately retained in EURUSDm-M1-raw.csv.
- Actual range is2026-07-05 21:05UTC through2026-10-05 04:26UTC, not a guarantee of every minute in the requested three-month window. Exactly82gap records were recomputed from CSV and deep-equal preview, allclassificationunknown withqualitydispositionreview. No gap filling or reclassification was performed.
- Actual ownerAPI8010 catalog contains exactly one dataset, EURUSDm/Exness-MT5Trial14 / MT5,93,810rows and matching datasetID. No synthetic catalog source is present in this inspected local DB.
- Session476f4b498e1a49ed9d48a75719f4d270 has501visible rows exactly equal CSVprefix,93,810total rows,has_future_rows=true. Execution is absent,execution_view_status=not_initialized; there is no fabricated balance/equity/ledger. APIrevision/payload remained unchanged after UI reads.
- Isolated real Chromium1440×987 onUI5180/API8010, public native setVisibleRange used to request all501visible source bars:501unique native M1 bars across4payloads all match CSVOHLCV and no bar exceeds cutoff1783315500. SymbolEURUSDm. Actual Balance/Equity/P/L displayN/A. See actual-exness-chart.png.
- Data panel and context now show60s,review ·82khoảnggiánđoạn,Exness-MT5Trial14 / MT5,93,810rows and imported artifacthash. See actual-exness-data-panel.png,actual-exness-provenance.png. Initial unverified/unclear-timeframe metadata finding was fixed by root; initial-metadata-findings.json preserves the evidence. No product edits by reviewer.
- `timeout.json`: deliberately stalled library request caused an actual20.227second loading timeout, visible Chrome/Edge suggestion plus fallback. Clicking fallback retained session/dataset/cursor, rendered Lightweight chart and restored outer navigation. See actual-loading-timeout.png,actual-timeout-fallback.png. Exact two-file hashes unchanged. This synthetic stall smoke proves bounded-loading/rollback behavior, not the root-reported IABblobERR_ABORTED cause or IABsuccess.
- Both final harnesses exited0 with zero page errors, blocked external requests or APIwrite attempts. Review used GET-onlyAPI reads and never accessed SDK/account or changed data.

## Scope and trade-offs

Broker-export provenance is supported by root's retained export receipt and file hash chain; this reviewer did not independently access MT5 or certify remote broker origin. Commission and historical swap are not supplied; current InstrumentSpecsnapshot does not verify historical contract changes. Raw spreads are preserved, but no historical cost/execution calibration is accepted here.

501bars are the causal prefix opened in this session; remaining dataset bars remain hidden until replay advances. There is no execution initialization, so account values and ledger results remain absent.82unknown gaps stay unresolved and reviewquality stays explicit.

The earlier navigation_top fix remains in exact source; its independent journey acceptance is in .artifacts/chart-navigation-20261005/independent/ACCEPTANCE.md. Full product/broker/provider acceptance remains separate.

Minor visual limitation observed in deliberately stalled/error state: legacy right-rail text captions wrap within the narrow rail before fallback. Lightweight fallback restores its normal icon rail. This review accepts the bounded error/recovery behavior, not polish of that transient error chrome.
