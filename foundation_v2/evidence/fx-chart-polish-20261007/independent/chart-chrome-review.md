# Independent chart chrome review — 2026-10-07

PASS: six actual browser cases (1368×790, 1710×987, 360×844; dark and light), three isolated metadata fixtures (200, 409, 500), no uncaught page errors or unexpected requests. Runtime: local Vite 5180 / API 8010; pinned native TradingView v23, srcdoc transport. Review source and screenshots correspond to the hashes below.

## Verified behavior

- Dark native header/left toolbar, right rail and floating replay toolbar use #0F0F0F; trading footer uses #000000. Light native toolbar groups remain white; their layout wrapper is transparent over #DADADA platform separators. Native bottom toolbar is rendered inside the center area rather than a separate `.layout__area--bottom` element in this configuration. Desktop and mobile screenshots confirm the visible surfaces.
- Duplicate native left object-tree button is hidden. Its separate last group collapses to zero height and has no separator pseudo-element; no empty slot remains. Right object-tree action opens the actual EURUSDm/Volume tree and closes correctly.
- Visible left drawing groups after the first have no 1px margin gap and use a 1px inset divider with 8px left/right offsets. Quick Search retains its outer group boundary; settings/camera internal group separators are hidden.
- Selected native 1m text and its child are white in dark, black in light, including hover. Quantity input and both arrows each produce one neutral 2px inset outer focus ring; child outline is none.
- Right Session Settings action opens the shared four-tab dialog, with real current name and description. Each tab renders, Home keyboard selection works, Escape closes and restores opener focus. The observed shared mobile tab clipping was fixed by the owner; final first-tab bounds after Home are 17–128.14px inside the 17–344px scroller, in both themes. No page horizontal overflow.
- Fixture 200 sends only name, description and expected_revision=2. Response revision3 deliberately includes payload cursor9999; rendered historical cursor remains #500, cutoff remains 05:25:00 6/7/26 UTC and visible count remains 501 candles. New name is reflected in native header and reopened dialog.
- Fixtures 409 and 500 show localized error, disable Save until close, and closing issues a read refresh with cursor_index=500. No repeat PATCH. URL cursor remains500.

## Source review

`openSessionSettings` pauses playback and snapshots current id/revision/name/description. The mutation uses the existing metadata helper with optimistic revision. Success checks record identity and revision+1, then merges only revision, timestamp, name and description into the current record; it retains viewed cutoff, rows and reconstructed execution. Conflict/uncertain failures block retries until the user closes and a historical read refresh occurs. The shared dialog prevents close while pending and restores focus on unmount.

## Evidence and boundaries

Runner: `chart-chrome-review.mjs`; structured results: `chart-chrome-review.json`. Screenshots: `chart-chrome-{dark,light}-{1368,1710,360}.png` and corresponding `chart-chrome-settings-*`.

Only local GET/HEAD/OPTIONS reach the servers; activity POST is fulfilled in memory and WebSockets are closed. Metadata PATCH is intercepted only in isolated fixture contexts and never reaches the backend. No order/replay/activity/metadata persistence, external FX changes, product edits or commits by reviewer. Launched browser contexts are closed after awaiting fixture close-refresh responses.

This receipt covers these seven chrome changes and shared-dialog interaction, not pixel identity with every FX Replay screen or backend metadata persistence. Existing historical review receipts remain separate. Initial runner failures were absent native-area/wrong iframe selectors, light transparent-wrapper oracle, and teardown timing; they were corrected without relaxing the functional assertions.

## Source hashes (SHA-256)

| File (relative to foundation_v2) | SHA-256 |
|---|---|
| web/public/chart-legacy.css | de2403950404dda44159cb39a7cfcfa89966b7b2fb716830efcfcf3799e835fc |
| web/src/nativeChartPalette.js | 6a50a31d303d80574db6ede836b46cfb75d211c613aa5a598ea9d8533a6aefef |
| web/src/LegacyTradingBar.css | d01e42eb0f825a0f536e435452456de0fa8f4e237154d75e84099d12ef5a7f59 |
| web/src/ChartWorkbench.css | 2f08e7576fb647da8bd9c63dda5e1920389c534e6fc5e5dcf7533ff46040bcd3 |
| web/src/ReplayWorkspace.jsx | ade235d2028d6b425d9b39ec3101fd9eefc4a362cfa9a1fe7c516be27adfd51f |
| web/src/testing-copy.json | ec5bfea4b402413344b53b5b5b7e543b01ee2116be9fbe0832f68502e8013991 |
| web/src/SessionSettingsDrawer.jsx | 00d8225739d042b24d704f5ca4ff8cbd16de84fd0867a29957444fad2de3066e |
