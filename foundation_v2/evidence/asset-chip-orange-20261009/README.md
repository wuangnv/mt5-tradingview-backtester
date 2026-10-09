# Orange multi-asset chips

Owner requested orange chips and remove-icon hover that only becomes clearer.
Uses existing `--project-action` / `--project-on-action` palette tokens. Chip size
and field-toggle logic are unchanged. Enabled remove icons change opacity from
0.72 to1; no hover background/border. Keyboard focus uses the contrasting
on-action color at full opacity; independent review identified the default
blue ring's weak contrast on orange, which this scoped override fixes.

Actual local dashboard, real GET APIs, no submissions/backend writes:6 journeys
passed at1710/1440/360px in dark/light. Assertions cover palette colors,
transparent/borderless remove-icon hover, search, repeated-click collapse,
keyboard/remove-icon focus and asset removal. Production Vite build passed.
Independent review confirmed the hover/color behavior and prompted the focus
repair. This is not whole-product QA.

Run from `foundation_v2/web` with two compatible downloaded assets in tenant-a:

```powershell
$env:TW_UI_EVIDENCE_DIR='../.runtime/asset-chip-orange'
node tests/assetField.browser.mjs
node node_modules/vite/bin/vite.js build --outDir ../.runtime/asset-chip-orange-build/dist --logLevel error
```
