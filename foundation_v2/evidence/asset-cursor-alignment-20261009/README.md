# Asset-field cursor and optical alignment

Scoped create-session dialog fix: clickable tag field/labels now inherit pointer
cursor, disabled wrapper uses default. Reuses TestingIcon close14px instead of
a font-dependent multiplication glyph; icon is centered in its22px hit area.
Orange chip colors, opacity-only hover and keyboard focus remain unchanged.

Actual local dashboard with real GET APIs and writes blocked:6 journeys pass
in dark/light at1710/1440/360px. Assertions verify label/icon/chip vertical
centers, icon/hit-area horizontal center, field/tag/button pointer, textbox and
balance text cursor, disabled layout/submit default cursor. Search, toggles,
keyboard and asset removal still pass. No page errors or writes. Production
build passed. Independent read-only diff/screenshot review approved.

Run from `foundation_v2/web` with two compatible downloaded assets in tenant-a:

```powershell
$env:TW_UI_EVIDENCE_DIR='../.runtime/asset-cursor-alignment'
node tests/assetField.browser.mjs
node node_modules/vite/bin/vite.js build --outDir ../.runtime/asset-cursor-build/dist --logLevel error
```

This is scoped local UI evidence, not a whole-project cursor or accessibility
acceptance claim. Unrelated CSS changes are excluded from this checkpoint.
