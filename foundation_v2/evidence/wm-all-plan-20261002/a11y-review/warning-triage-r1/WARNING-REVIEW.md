# Data safety-warning contrast — independent triage r1

**CONFIRMED_WARNING_CONTRAST_FINDING / A11Y-03 OPEN.**

Actual read-only local QA Data route, `tenant-a`, dark/light at1440/1280. Source
before/after both `fba555162da33d740c254ebf79ba2670df1c0e29e7c80221d649df8dca27ebad`.
Reviewer `/root/mt5_independent_review` measured4cases/16text observations and
directly inspected all4rendered warning crops. This is targeted partial WCAG
review, not a broader rescan or full conformance statement.

The meaningful safety list is visible after the stacked provider repair. Its
three items inherit the older unconditional `#aeb8be` from
`research-data.css:57` (`.rd-warning-block ul`). Light white background gives
**2.019333456:1 <4.5:1**, font11px, weight400, opacity1. The text conveys import,
holdout/provider/broker and dataset-verification boundaries; it is not decorative
or disabled content. Both1440and1280 reproduce the failure. Dark on#030303 gives
10.213467364:1 and passes.

Exact block locator:
`aside[aria-label="Provider capabilities"] > .rd-warning-block`.

| Exact suffix from block | Text | Dark ratio | Light ratio | Classification |
|---|---|---:|---:|---|
|`> strong`|Quy tắc an toàn|12.934743|7.197266|Pass|
|`> ul > li:nth-child(1)`|Local CSV import chỉ tạo artifact immutable trong workspace hiện tại.|10.213467|2.019333|Light fail|
|`> ul > li:nth-child(2)`|Không mở holdout, không gọi provider ngoài và không gửi lệnh broker.|10.213467|2.019333|Light fail|
|`> ul > li:nth-child(3)`|Dataset chưa verified vẫn phải gắn nhãn trước khi dùng.|10.213467|2.019333|Light fail|

The title already passes normal-text contrast: dark#efc871on#03030312.934743:1,
light#765000onwhite7.197266:1; font11px/700 still uses the4.5normal-text threshold.
Its later token consolidation is an implementation choice, not a required repair
of a measured title failure. Use an existing theme-aware muted token for the list,
then verify both themes/widths on the new source. Preserve this failure receipt.

`measure-warning-text.mjs` exited1 deliberately because6light list observations
failed; `failures=[]` means no measurement/harness error. All text bounds are in
the viewport after targeted scroll; no opacity/background-image ambiguity, page
errors, blocked requests or API writes. GET/HEAD/OPTIONS loopback only, WebSocket
closed. No source, baseline or ledger change was made by this lane.

Evidence `warning-measurements.json` SHA256:
`3758296aa18bdd49a8f5228fbc97d695ca1eba60ab8e84e4420ae9a4d8667ea8`.
It stores exact selectors, foreground/background/font/ancestor chain and4PNG
hashes (`warning-dark/light-1440/1280.png`), all directly inspected. Previously
completed Journal/provider r2remains scoped PASS at sourcee993; its
`../repair-r2/repair-review.json` SHA256
`65720dfc18c31930ef34228c98fb045b773b289c2549431b2b0c782da0254040` was asserted
unchanged. No earlier failing or passing packet was rewritten.

Root retains patch/promotion/full-route/comparator authority. New list color
needs focused verification; Learn, complete manual WCAG, chart/whole W8/product
and broker acceptance remain outside this report.
