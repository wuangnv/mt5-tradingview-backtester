# UI controls repair — 2026-10-03

Owner request: fix malformed buttons/components in the running MT5 UI, especially sidebar expand/collapse. This is a scoped repair, not whole-product or full WCAG acceptance.

## Result and state flow

- Desktop sidebar uses a panel icon whose chevron and action label follow the existing collapsed state. The full 44×44 target is centered in the compact rail cell and separated from the expanded wordmark. A visible focus ring supports keyboard use.
- Mobile uses a hamburger to open the existing modal navigation drawer; Escape, close, backdrop, focus trapping and restoration retain their behavior. Mobile state remains transient, while desktop choice uses the existing `tw-shell-rail-collapsed` localStorage key.
- The compact header hides the tiny competing WM mark and aligns its first grid track with the 58px mobile rail. Expanded navigation retains the full product wordmark.
- Session select chevrons and theme sun/moon icons use inline SVG rather than font glyphs. The native select still owns selection. Language switches directly between EN/VI without a misleading dropdown caret; theme labels describe the action.
- Historical Analytics cutoff text and the empty Sessions instruction use semantic theme colors. Light contrast measured 5.79 and 7.36 respectively; dark 6.92 and 10.80. Historical reports still use cursor20 independently of canonical60; no session advance or data write was introduced.

## Verification

Final UI source hash: `eea5c82cf33e97da9a81933b600bff3b7cfb29f099cadd73963b2e01af37ca22` (scan sourceBefore equals sourceAfter).

Local evidence root: `D:/ANNAM/TradingWorkspace/.artifacts/mt5-controls-20261003/`.

- `unit-final.txt`: 76/76 web tests passed. `build-final.txt`: Vite build passed,77 modules; existing large-chunk warning retained.
- `controls-r3/report.json`: 8/8 cases at1440/768/390/320px, dark/light. Full hit-target corners, logo/menu separation, centered compact geometry, focus, desktop reload persistence, mobile preference separation, icon/label state, language/theme/help actions, select SVG centering and minimum4.5 body-text contrast passed. `TW_UI_SESSION=39b1d068edd64e75864f692f27237852` enables the historical-note checks.
- `mobile-drawer/report.json`: both existing default/saved-desktop-preference scenarios passed, including Tab/ShiftTab, Escape/button/backdrop/navigation dismissal, reload,760/761 boundary and chart omission.
- `route-scan-r3/report.json`:144/144 cases across18 routes ×4 widths ×2 themes; zero axe violations, unresolved ARIA cases, page errors, document/content overflow failures or unexpected requests. The harness now supports `--cursor=20` to include historical chart/Analytics/Trades state. Real local services used; no API fixtures.
- `independent-review/REVIEW.md`: independent diff/visual/action review passed.48 loaded route/theme cases,16 shell state probes,4 full-bleed chart checks and follow-up empty Sessions review. Root additionally inspected final compact/empty and historical screenshots.

All browser tests used isolated contexts at `http://127.0.0.1:5180`, blocked external/mutating requests, and closed only their own contexts. Preview API8020 is GET-only and broker locked. No DB reseed, provider, broker, course/progress, ledger, STATE or golden mutation.

## Preserved failures and limits

- `controls-r1`: persistence assertion failed because the new test reset storage on every reload; corrected initialization now seeds only an absent preference. Product persistence was unchanged. Failed report retained.
- `route-scan-r1`:140 completed cases plus a Playbook dark locator timeout; direct Playbook probe was healthy. Final144-case scans r2 and r3 passed; initial failure retained.
- User-facing tab inspection encountered a CDP focus-emulation timeout. The user's tab was left untouched; isolated local browser checks and GET200 confirm the running updated source. Do not claim that tab was refreshed through CUA.
- Existing canonical goldens describe the earlier source and were not updated or automatically promoted. These intentional header/icon changes require a separate reviewed golden revision before claiming a pixel comparator pass at this new source. Full manual WCAG, all error/scroll states, production auth, long-duration chart performance and whole-product gates remain separate.

Reproduce from `foundation_v2/web`: `node tests/shell-controls.browser.mjs` with explicit `TW_UI_ORIGIN`, fresh `TW_UI_EVIDENCE`, and optional `TW_UI_SESSION`; existing `tests/mobile-drawer.browser.mjs`; `node tests/wm-integration-quality-browser.mjs --mode=scan --widths=1440,768,390,320 --session=39b1d068edd64e75864f692f27237852 --cursor=20 --out=<fresh-directory>`. Do not overwrite retained attempts.
