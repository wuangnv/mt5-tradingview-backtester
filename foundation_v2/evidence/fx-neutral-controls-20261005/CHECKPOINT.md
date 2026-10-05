# WMREPLAY neutral controls — scoped UI checkpoint

Owner request: implement the approved “Gọn đồng bộ” select/filter direction and unify ordinary hover with white/gray.

## Behavior and ownership

Project interaction tokens in `web/src/component-interactions.css` own neutral hover, open, selection, focus and primary-action contrast. Light mode uses gray backgrounds and dark text. Global/domain snapshots and dependencies are unchanged.

Ordinary FxSelect, SessionFilter, native selects and Analytics date/Apply/column controls use 40px height and 8px radius; coarse pointers use 44px. Menus use 10px radius, options 6px. Rich session summaries intentionally retain their taller layout. Ordinary long labels truncate instead of changing row height. Research native selects reuse the existing `selectedcontent` markup so long dataset identifiers retain the chevron and ellipsis while their popup labels remain complete. Chevrons rotate on open.

Search, checkbox/multiselect, draft → Apply, URL filters, real session state and demo isolation retain their existing handlers. No new dataset, broker connection, download or order execution is part of this change. Buy/Sell, P/L and destructive/error marks retain semantic colors. The vendor Advanced Charts iframe is outside this project control styling scope.

Mouse click outlines on ordinary selects are removed; keyboard focus remains visible and neutral. Text-input focus follows browser keyboard-input semantics. Reduced-motion behavior remains available.

## Validation

- Production Vite build PASS; existing >500kB bundle warning remains.
- `git diff --check` PASS.
- `primary.json`: 8 demo route/theme cases; ordinary control geometry, search, selection, hover/focus, negative bar color; zero API reads/writes/runtime errors.
- `filter-toolbar.json`: final source browser rerun; column search/select-all, draft Apply, real filter reload/session transitions and aggregate ledger PASS.
- `grid.json`: 8 viewport/theme cases; body-only scroll, sticky grid header/footer, dropdown/pagination, detail/empty states and Market layout PASS.
- `demo.json`: demo state restoration/isolation and adjacent Analytics source tabs PASS.

Representative screenshots were visually reviewed by the root agent. Independent review reports and final source hashes accompany this checkpoint. Raw failed attempts remain under `.artifacts/fx-neutral-controls-20261005`; failures were not replaced with accepted results. Independent review identified amber Dashboard keyboard focus, mobile wrapped control height, Research long-label clipping and Risk inconsistent height; each was fixed and rechecked. The reviewer corrected two oracle mistakes (popup radius and requiring different Buy/Sell hover backgrounds); actual semantic foreground colors remain green/red. A labeled CSS-only danger fixture is distinguished from an actual destructive-action journey.

## Reproduce

With the already-authorized local UI on port 5180 and API on 8010, from `foundation_v2/web`:

```powershell
npm run build
node tests/filterToolbar.browser.mjs
node tests/gridViewport.browser.mjs
node tests/demoPreview.browser.mjs
```

The saved `probe.mjs` is a scoped read-only artifact using the installed Playwright. Original harness outputs are located in `.artifacts`; QA output paths can be supplied through each script's `TW_*_QA_OUT` environment variable. Native select custom presentation depends on browser `base-select` support; unsupported browsers retain the native selection behavior.

This checkpoint accepts this control/hover change only; it does not close whole-product, broker, provider or other plan gates.
