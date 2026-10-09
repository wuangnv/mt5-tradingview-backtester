# Asset field hover and redundant copy cleanup

Scope: local create-session dialog and UI Reference; actual GET APIs, no form
submits/backend writes. This receipt does not establish whole-product acceptance.

- Asset outer field and form dropdown hover use `--wm-hover`; inner asset arrow
  stays transparent with no border. Checked wrapper, arrow and edge hover.
- Disabled fields retain their resting appearance. Focus/open borders remain
  blue, including when focus moves to an option while the trigger is hovered.
- Removed asset helper paragraph and shared checkbox-menu selected count.
  Asset toggling, select-all tri-state, search and keyboard behavior still pass.
- Actual dialog: 16 cases across dark/light, no page errors or writes.
- UI Reference: 8 field cases across dark/light; filled dropdown hover matches
  the same semantic token as the actual dialog.
- Menu regression: 18 checks, dark/light at 1710px/360px; includes short popup
  viewports and open-border-under-hover regression.
- Vite production build passed. Independent read-only review approved the diff
  and dark/light screenshots, including the follow-up specificity fix.

Durable regression command from `foundation_v2/web`:

```powershell
$env:TW_UI_EVIDENCE_DIR='../.runtime/asset-hover-regression'
node tests/menuAlignment.browser.mjs
node node_modules/vite/bin/vite.js build --outDir ../.runtime/asset-hover-build/dist --logLevel error
```

Candidate receipts/screenshots and menu report accompany this note. Existing
unrelated CSS edits were excluded from the checkpoint.
