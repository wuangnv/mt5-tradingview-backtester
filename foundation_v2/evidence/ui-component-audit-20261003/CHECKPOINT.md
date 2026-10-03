# Component audit and cleanup — 03/10/2026

Owner requested a fuller pass for omissions similar to the selector refinement and removal of redundant or incorrect details. This is a focused project UI audit; it does not redesign pages or complete the entire product plan.

## Result and data/state path

- Disabled inputs/textareas now have a consistent cursor and surface. Scrollable table/region focus is visible. Chart overlay labels and drawing-object toggles reflect actual checked/pressed state, including keyboard focus.
- Object visibility/lock names remain stable (`Hiển thị`, `Khóa`); their pressed state comes from existing hidden/locked preferences, which remain browser-local and survive reload. Lock still blocks rename/delete. Playbook detail selection uses pressed state rather than claiming page navigation.
- Chart opens with crosshair. Drawing requires selecting a tool; handler still uses the same causal anchors/cutoff and draft/API contracts. The empty annotation surface disappears in crosshair mode; actual draft/error evidence remains. Sidebar links have separate44px rows.
- Viewport range buttons remain commands without stale pressed state after pan/zoom or another viewport command. Play/pause keeps its changing action label without redundant pressed semantics. The object opener describes the full side panel and exposes its real expanded state.
- Playbook loading/error do not display a zero count or empty catalog; ready empty catalogs do not ask to choose a nonexistent record. Settings removes duplicated session loading, its repeated footer and duplicate return-to-Learn link. Existing context/permissions/connector facts remain.
- Removed the unnecessary button translation and94lines of unused custom chart-menu/floating-context CSS after checking JSX consumers; removed orphan Settings footer selectors. No read-only-field rules were retained because no real UI field consumes them. Selected watchlist text uses the project primary color to repair light-theme contrast.

Data flow remains service/catalog state → existing selected record/handler → existing URL/detail/metrics; object preferences remain existing localStorage state. No backend write, schema, financial calculation, broker/provider permission, dataset seed, shared UI pin or dependency changed. The removed `chartRange` state tracked only the last clicked command, not the actual viewport, so retaining its selection badge would be misleading.

## Evidence and source scope

Final frontend fingerprint: `de28829cb7d722774c9e5a8ce8e806ef7cf9b6d8c053ad03a140fe08776c1d7b`.

| Receipt | Actual scope |
| --- | --- |
| `unit-final3.txt`, `build-final3.txt` |80/80web tests,81-module Vite build PASS on final source; existing >500kB JS bundle advisory remains |
| `interactions-final5/report.json` |6theme/width scenarios at1440/390/320px,30screens: Playbook delayed/error/empty/selection fixtures; Settings single loading/return and actual browser save/cancel/reload; real61-row chart plus labeled annotation fixture show/lock/reload; crosshair/drawing guidance; separated sidebar links; real Analytics75USD scope and keyboard ledger focus. No errors/blocked requests/axe violations. All service requests remain GET-only. |
| `playbook-final/report.json` |8/8real route/theme/width/axe/reflow cases at1440/768/390/320, matching final source before/after |
| `playbook-zoom-final/report.json` |6/6native zoom cases125%/200%/return100%, matching final source |
| `routes-final2/report.json` |144/144real18-route/theme/width cases, stable `bd54ce7973ca6b28f76d3178bf44a7780192aada075e306f9f72211c230f0610`; final delta only suppresses the nonexistent-record selection prompt in ready empty Playbook, replaced by focused checks above |
| `zoom-final2/report.json` |24/24native Overview/Replay/Playbook/Settings cases on the same `bd54ce…` source; final Playbook replacement above |
| `chart-final/report.json` |8/8synthetic mixed-OHLC renderer regressions, all five chart types/wheel/pan/overlays/cutoff/history on `bd54ce…`; final delta only Playbook empty copy, renderer unchanged |

Real QA session: `39b1d068edd64e75864f692f27237852`, tenant-a, cursor60,61visible candles/60closed simulated trades/net75USD. Catalog and annotation fixtures are intercepted only, not backend records. Local browser preference tests use fresh isolated contexts, not the user's profile. No personal in-app browser verification or Firefox/Safari execution is claimed; axe is scoped automated evidence, not full WCAG certification.

## Failures retained and repaired

- `interactions/report.json`: harness init script reset language on every reload; preserve initial defaults only when keys are absent. Product preference code unchanged.
- `interactions-r2/report.json`: programmatic checkbox focus after pointer input did not request keyboard modality; harness now presses Tab first.
- `interactions-r3/report.json`: real light watchlist contrast failure4.27:1; selected-link color repaired, axe retained.
- `unit.txt`: old source assertion required Playbook page-navigation semantics; updated to the correct pressed contract, remaining recovery assertions retained.
- `routes-final/report.json`: FAIL for source drift, diagnostic144cases only. Final stable matrix is `routes-final2`.
- `interactions-final2/report.json`: regression probe assumed initial crosshair while source default was level; default crosshair is now intentional and tested.
- `interactions-final3` and `interactions-final4`: invalid Analytics locator/oracle (Dashboard combined75USD text vs Analytics separate number/unit and definition-list structure). Final probe separately verifies75 andUSDunit on the actual metric, preserving the financial assertion.
- Earlier PASS receipts (`routes`, `chart`, `zoom-final`, `interactions-r4`, `interactions-final`, `replay-final`) are pre-final observations and are not silently relabeled as final source.

Independent review: `review/REVIEW.md`; selected screenshots: `selected/`. No canonical golden, ledger/STATE, global UI-system or whole-product promotion. Existing preview UI5180/API8020 stays read-only on the isolated QA DB. VI Dubber remains deferred.
