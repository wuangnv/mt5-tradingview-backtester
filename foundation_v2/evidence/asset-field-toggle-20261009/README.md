# Multi-asset field: chip visibility and repeated-click toggle

Local actual dashboard with real GET APIs; form submissions and other writes
blocked. This is scoped UI validation, not whole-product acceptance.

Baseline reproduced in dark/light at 1710, 1440 and 360px:
- Clicking the wrapper or asset caption twice leaves the popup expanded.
- Chip fill equals the outer field's hover fill, hiding its shape.
- Inherited form-button minimum height makes chips 40px and desktop field44px.

Candidate passes all six viewport/theme journeys:
- Wrapper, caption and arrow each open and then close on repeated clicks.
- Search, Escape/focus return and keyboard opening still work.
- Removing assets preserves the open/closed popup state; removing the last
  asset restores the placeholder, which also toggles correctly.
- Chips are26px, with a separate neutral fill and subtle boundary; desktop field
  remains36px and the narrow viewport field44px, without hover layout shifts.
- No page errors or backend writes. Shared menu regression:18 checks passed.
- Production Vite build passed. Independent source/screenshot review approved.

Commands from `foundation_v2/web`:

```powershell
$env:TW_UI_EVIDENCE_DIR='../.runtime/asset-field-regression'
node tests/assetField.browser.mjs
node tests/menuAlignment.browser.mjs
node node_modules/vite/bin/vite.js build --outDir ../.runtime/asset-field-build/dist --logLevel error
```

`assetField.browser.mjs` requires at least two compatible downloaded local assets
in tenant-a; it reads the real catalogue and only changes the unsaved dialog.
