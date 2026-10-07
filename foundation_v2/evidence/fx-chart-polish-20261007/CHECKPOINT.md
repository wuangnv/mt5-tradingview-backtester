# FX Legacy chart polish — 07/10/2026

Scoped result: PASS for the owner's thirteen comments, with independent source and browser review. This is not whole-product or complete FX feature parity acceptance.

## Behavior and ownership

- FX has the floating quick-action toolbar; retain the single draggable Go To/Order/News/Journal group.
- The native header spans the viewport. Rail and desktop drawers start below its 38px row plus 4px separator. Native canvas and price-scale dimensions shrink with the drawer; header controls remain visible and hit-testable at the far right. At 600px or less, drawers overlay the chart to respect v23's minimum body width.
- Replay uses filled reference-style icons, grip, sixteen speed positions, separate replay timeframe and optional chart sync. Bar Replay selects a prior visible candle. Forward resolves the next occupied UTC timeframe bucket server-side; rewind uses the prior occupied bucket in the known prefix. Calendar/sub-dataset resolutions without support are disabled.
- An optional typed interval augments the existing replay request without changing old bar-count calls. Server traversal caps at 1000 bars and processes every intermediate execution bar. Historical forward is GET-only and clamps at canonical; one pending request and revision conflicts guard playback. Native interval survives historical chart remount.
- Suppress the pinned v23 Ctrl+zoom teaching hint in project-owned CSS; vendor distribution remains unchanged. Native CSS selectors require renewed verification on vendor upgrades.
- Buy/Sell labels are white. Quantity has one outline and a spinner. The center grip resizes positions; footer maximize expands positions below the header, while header fullscreen remains browser fullscreen. Floating controls stay above the expanded table.
- Analytics routes to the current session's analysis with its cutoff context. Wallet details use actual cutoff-safe equity/realized/unrealized values; unknown execution remains a dash and privacy masks all displayed values.
- Scalper shows disabled distance fields and %/Pips pills when switches are off. A saved local workspace/session preset prepares protective order draft prices before existing confirmation. It does not implement instant execution, Auto Break-even or new strategy creation.

## Research

Reference session was inspected through the owner's browser without replay/order/layout/cloud writes. Speed preference was restored, and the temporary Scalper panel dismissed without saving.

- [Bar-by-bar rewind](https://support.fxreplay.com/articles/how-to-use-bar-by-bar-rewind)
- [Bar Replay selection](https://support.fxreplay.com/articles/how-to-use-bar-replay---right-click-replay)
- [Scalper mode](https://support.fxreplay.com/articles/how-to-use-scalper-mode-for-faster-trade-execution)
- [Getting started / floating toolbar](https://support.fxreplay.com/faqs-categories/getting-started)

The source implements occupied UTC candle buckets for this dataset-driven replay engine. It does not claim access to FX's proprietary engine, ticks absent from the dataset, or exact cloud persistence behavior.

## Validation

- Production Vite build PASS.
- 29 focused backend interval/protection tests PASS; 14 interval cases independently rerun PASS, including gap navigation, canonical clamp, strict validation and protective fills on intermediate bars.
- 13 JS replay/scalper model tests independently PASS.
- `verify.mjs`: five actual-service GET layouts, 1920×940, 1611×1259, 768×987, 360×987 and 1710×987; dark/light and Vietnamese/English. Header/rail/drawer/canvas geometry and rightmost header hit-test PASS.
- `footer-verify.mjs`: three viewport/theme journeys, unknown actual execution plus labeled execution fixture. White labels, single outline, grip, positions maximize, balance masking, local preset reload and confirmation draft PASS.
- `replay-toolbar.mjs`: actual historical GET navigation and sync persistence; canonical request intercepted into slow/conflict fixture. Pause during pending response and revision lock verified, no owner session step/order writes.
- `replay-selection.mjs`: actual native canvas selection of a known prior candle; GET cursor500→340, selection clears, no writes.
- [Independent review](independent/REVIEW.md) and [final receipt](independent/final-receipt.json): PASS, five configurations, no page errors/unexpected writes.
- Local API restarted only after verifying its exact launcher identity. API8010 and Vite5180 serve200; imported-history launcher runs without MT5 synchronization.

### Embedded browser compatibility

The owner's Codex browser canceled v23's blob iframe navigation (`Network.loadingFailed: net::ERR_ABORTED`), while normal Chromium loaded it. The explicit `chart_iframe=srcdoc` URL option now loads the same library-generated local document and options hash through srcdoc; default blob transport and the vendor bundle remain unchanged. Codex navigation, reload, rendered native candles/header and opening/closing the compact Chart tools menu passed. Screenshot: `codex-srcdoc-chart.jpg`. This option is scoped to the URL, not a browser security setting or a new vendor version.

TradingView's current [featuresets](https://www.tradingview.com/charting-library-docs/latest/customization/Featuresets/) and [troubleshooting](https://www.tradingview.com/charting-library-docs/latest/troubleshooting/) describe iframe loading compatibility for embedded browsers. The pinned v23 bundle does not implement that feature; this adapter explicitly handles that version's generated document.

Early layout probes exposed mobile minimum-width clipping and invisible right controls despite correct bounds. Final fixes and hit tests are retained; initial failed probes were not treated as acceptance. The reviewer's initial pytest cwd was corrected before its successful focused run.

## Consistency with Testing — applied after owner follow-up

Live dashboard computed styles are in `testing-comparison.json`, screenshot `testing-reference-1710.png`. Testing controls use Inter13px/20px, pill radius, 140ms state transitions and project focus#7ABBE6; the pre-change chart snapshot used compact Arial12–14px, mixed4–20px radii, instant or100–120ms feedback and reference blue#5695FE.

The owner subsequently authorized this consistency slice and eleven further visual comments. App-owned dialogs/popovers/drawers now use the same Inter baseline and project hover/focus/disabled tokens, 140ms feedback and reduced-motion handling. Compact native chart dimensions, blue replay/scalper actions, turquoise/red candles/Buy/Sell and neutral chart surfaces are preserved.

Header separators now draw inside clipped v23 groups instead of outside; mentor has two separators and theme a right separator. Undo/redo stay left, session name centers in the remaining area, and layout/save controls end beside Quick Search without a separator inside the session group. Quantity hover/focus spans the one outer rounded outline. All six-dot grips use filled circles and normal text contrast. The owner asked to remove the quick-action toolbar entirely; its visibility setting and unused CSS were removed as well, while rail destinations remain.

Keyboard review also found hidden initial popovers could not receive focus. The popup is now visible before initial focus; selected enabled options focus correctly, disabled form fields are skipped, Tab leaving dismisses including browser-chrome transitions, and Escape/explicit dismissal returns focus appropriately. Compact overflow navigation uses the same keyboard rules.

Validation: production build PASS; `consistency.mjs` actual local GET UI at1920dark/light,1080dark and360dark PASS for separators/center layout, no overflow, quantity hover/focus, grips, selected menu focus/Tab/Escape, Scalper dismissal and reduced motion. Activity receipts are explicitly intercepted fixtures; replay/order mutations and remote requests are blocked. Early probes caught the hidden-focus bug and were repaired; an initial outline-width assertion was corrected to inspect outline-style, since prefers-contrast can set a width on an invisible `none` outline. Independent QA passed twelve dark/light/desktop/mobile configurations across default blob and optional srcdoc, with matching hashes for all nine source files. Its receipt is [consistency-review.md](independent/consistency-review.md), with final reports `independent/consistency-review.json` and `independent/consistency-default-review.json`, without overwriting the prior scope's receipt. The owner's actual Codex tab renders with the known explicit srcdoc option; its menu selected focus and Escape return were verified (`consistency-codex.jpg`).
