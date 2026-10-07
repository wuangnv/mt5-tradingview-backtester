# Independent Dashboard side-split review

Scoped PASS, 07/10/2026. No unresolved findings in this slice. This review covers the closed-trade Buy/Sell split, minimal overall-win card, centered remaining-days cluster and actual timing provenance. It does not reopen earlier Live/Market/KPI acceptance.

## Evidence

- `report.json`: 24 actual/demo × EN/VI × dark/light × 1710/768/360 cases PASS. Sixteen Axe scans, zero violations. Nine source/code-doc SHA-256 pins match before/after and current source.
- 24 synthetic guard cases PASS: two locale/theme/width variants for empty, buy-only, sell-only, 50/50, 1/3 versus 2/3, unknown/null, string counts, fractional counts, negative counts, mismatched sum, unsafe integers and string total. Fixtures are intercepted local GET responses, not actual execution evidence.
- `settled-progress-report.json`: four actual-mode cases wait for dataset/replay metadata and the remaining-days badge before measuring. Actual metadata shows 91 days. Desktop measures the combined track-and-label midpoint against the action-row midpoint; 768/360 verify centered contents within the responsive group. Source pins match the matrix and remain unchanged.
- Zero page errors, external/write requests or horizontal page overflow in all checks. Browser guards allowed only GET/HEAD/OPTIONS on local 5180/8010; WebSockets closed.

## Verified behavior and data flow

The actual overview returned one closed trade, zero BUY and one SELL. A separate GET of `/api/v2/replay/trades` exposed the deduplicated ledger; counting its typed side fields independently matched the overview counts. The actual split therefore displays 0.00% Buy / 100.00% Sell; demo ledger has 30/30 and displays 50/50. Both locale formats keep two decimals. Segment widths match the arithmetic; zero-side segments have exactly zero width. Green/red labels remain readable in both themes and narrow layouts.

Source audit confirms backend side counts use the same `trades` collection after filtering and branch deduplication as the existing metrics. Upstream replay analytics validates BUY/SELL before emitting ledger entries. Genuine empty aggregate gives zero counts; selected sources with no readable analytics give null counts. UI requires nonnegative safe integers, positive safe total and exact matching sum before rendering the split. The supplied backend tests cover real engine BUY/SELL fills, inherited branch deduplication, session/side/date scopes and null versus zero; their execution is owned by the primary checkpoint, not independently rerun here.

Overall win rate has exactly its label/icon row and percentage value. There is no supporting outcome bar or subtitle beneath it. Remaining-days progress uses a static 6px track, 6px gap and label as one centered 32/44px control-height group; desktop centering is verified for the entire visible cluster rather than just its text. Responsive layouts keep the existing stacked action arrangement.

Actual `time_invested_seconds` and `historical_time_replayed_seconds` remain null in the API and `—` in the UI. Backend still emits unknown timing and this change adds no timer. Wall-clock time, session creation time and cursor × timeframe are not substituted for measured practice/replay time.

The terminology contract records generic **Mã giao dịch**, compact **Mã**, and Forex-only **Cặp tiền**, retaining raw identifiers such as XAUUSDm and English Symbol. This is a documented naming recommendation; this slice does not claim every historical copy occurrence was migrated.

## Visual review and boundaries

Inspected actual dark desktop, light VI mobile demo, mixed/unknown fixtures and settled progress screenshots. Representative images: `actual-dark-en-1710.png`, `demo-light-vi-360.png`, `settled-progress-dark-en-1710.png`, `settled-progress-light-en-360.png` and corresponding mixed-side fixture captures.

Current actual dataset exercises a SELL-only split; balanced/buy-only/malformed positive distributions are demonstrated by the explicit fixtures and the source-level backend test. No actual trades, sessions, timers, downloads or broker/provider actions were created. Build/backend/unit results remain in the primary checkpoint. No source edits or commits were made by this reviewer.
