# Independent focused repair review — r2

**SCOPED_REPAIR_REVIEW_PASS — A11Y-01, UI-01, A11Y-02 resolved in measured scope.**

Reviewer `/root/mt5_independent_review`. Source before/after during the browser run
both equal `e993bb4910fc42f3faf8c7852ca6807f392deaa6d331f279f843ea8c9d21e6dd`.
Actual isolated synthetic QA API, `tenant-a`, GET-only routes Journal/Data. This
receipt preserves the original findings and r1additional contrast failure.

## Findings and verification

| Finding | Verified final behavior | Scope / result |
|---|---|---|
| A11Y-01 Journal placeholder | Muted token/opacity1 gives6.3719:1dark and6.2252:1light, above4.5. Actual content textarea enabled, empty and visible after scroll. |9fields×4widths×2themes=72observations; all pass|
| UI-01 Data provider collapse | Metadata/status/capability stack; first-cell418.5/358.5/646/308px at1440/1280/768/390. Provider name/read_metadata each single line; word remains whole; no overlap or document/body/content overflow. |8viewport/theme pairs;137px row height everywhere; pass|
| A11Y-02 Data light entitlement | Theme-aware warning token replaces fixedlight color. Light#9a630f/white is5.0412:1, dark#d5a45a/#030303 is9.1209:1; oldlight1.9875failure retained. |All6provider text groups×4widths×2themes=48contrast observations; all≥4.5|

`verify-repairs.mjs` finished exit0: **16/16route cases,416assertions**. Assertions
require normal-text contrast≥4.5, provider first-cell>100px, row≤200px, intact word
flow and no overflow. Measuring without assertions cannot silently pass a failed
threshold. All **16exact Journal/Data crops** were directly inspected; light
entitlement is now readable, Journal390wrap is natural, provider information does
not clip or form vertical letters. Hashes are in `repair-review.json` and
`measurements.json`.

Data/state remains API-owned. CSS renders the existing identity, read capability,
offline/entitlement, production readiness and blocked capability strings. It adds
no execution authority or data writer. The stacked arrangement trades a little
vertical space for readable narrow columns without extra surfaces/wrappers.

## Source sequence and reuse

The run completed with matchinge993before/after hash and exit0 **before** root
changed Learn tablet selector specificity. Root then froze
`fba555162da33d740c254ebf79ba2670df1c0e29e7c80221d649df8dca27ebad`; current hash
at review publication matches that later source. Root reports no Journal/Data
change in this delta. This receipt does **not** claim a browser run atfba555 or any
Learn acceptance. Root's final144route/axe/reflow scan and goldens must identify
their own final source/delta. The completede993measurements are valid historical
evidence and are not rewritten to claimfba555.

For the original18contrast incompletes, Journal and read_metadata are freshly
verified here. Other16retain only the previous scoped classification with delta
review: Journal placeholder selector is field-scoped, Data repair is row-scoped,
the shell change is a comment and Learn has its own workspace selectors. This is
reuse, not a fresh runtime check of those16. The decorative Research-circle
exception stays limited to the inspected no-result state. Previous keyboard and
reduced-motion receipts retain their old source and scope.

Complete manual WCAG2.2AA, every state/screen-reader/keyboard, chart alternatives/
down candles/full gestures, full W8/product/UY/M7 and broker gates remain outside
this repair review. No baseline promotion, source patch, ledger/routing write or
commit was performed by this lane. GET/HEAD/OPTIONS loopback only, WebSocket
closed;0page errors, blocked requests or API writes.

## Preserved evidence

- Original `../contrast-review.json` remains SHA256
  `2bc316aadd106dd854166fc1a4551d7d567deb9cb1c4ada9d170e663c70396f1`.
- r1`../repair-r1/measurements.json` remains
  `eee834a1755a479c6d57170de332e9bcb3632f5ebc7dc5b96ae75efb47678fa4`.
- r1`../repair-r1/provider-text-contrast.json` remains
  `6d648dfe5d091a9a24d5a3605164c040a9c232dd8afba3dbd62a1aec5518de14`,
  `CONFIRMED_CONTRAST_FINDING`; it is not overwritten by this PASS.
- Current `measurements.json`, `repair-review.json` and16PNGhashes form the r2
  packet. `publish-review.mjs` verifies previous and screenshot hashes before
  publishing the independent classification.
