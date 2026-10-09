# Shared-menu alignment and bounded UI audit — 09/10/2026

Scope: the reported “Hướng lệnh” menu, shared select/session-filter controls, reporting metadata typography, and independent Dashboard read sources. Continue the current compact UI direction; no new framework, shared-token version, backend contract, provider download, broker action or service restart.

## Behavior and ownership

The menu had conflicting CSS owners: a higher-specificity option rule distributed the checkbox and caption across the row. Geometry now lives in `fx-select.css`, with duplicated page-layout rules removed. Select-all and option labels share the same left edge, 8px checkbox gap and 20px caption line. Disabled choices do not inflate the selectable total; select-all preserves locked values. Mobile select-all has the same 44px target as options.

Session-filter menus retain a useful width independently of their trigger, clamp to the content/viewport, flip above the trigger when needed and scroll their own option list. Entrance animation uses individual `translate`, leaving the positioning `transform` intact. Option focus rings sit inside the row so scrolling does not crop them.

Live Dashboard/trade/analytics metadata that was 10–11px now uses the existing 12px metadata token. Vendor trading-chart geometry and unloaded legacy features remain separate.

Dashboard keeps a successful-read marker per source, including verified empty responses. Same-scope network failures retain verified content with a visible stale warning and retry. An owning source's 401/403 clears its cached data. Session catalog freshness gates mutations; failed-detail retry preserves good sibling caches; dataset metadata retry does not reload unrelated reads. Malformed Prop and dataset objects fail at their read boundary instead of crashing the route. See [source receipt](source-states/RECEIPT.md).

## Verification

- Shared-menu browser regression: 14 cases PASS, dark/light at 1710px and 360px, including search, keyboard, disabled options, CSS loading order, short viewport and animation placement. `menu-report.json` has no runtime errors or writes.
- Compact controls/state regression: 22 cases PASS (`compact/acceptance.json`). This earlier run covers shared control foundations; final targeted menu/source checks cover later changes.
- Dashboard sources: final counts and cases are in [source receipt](source-states/RECEIPT.md) and `source-states/report.json`; response fixtures are explicitly labeled and read-only.
- Independent visible-text/reflow scan: 16 route/theme/width combinations PASS, no visible text under 12px or page/content overflow in the four examined demo routes (`independent-menu/report-meta.json`).
- Final build PASS; Dashboard model/session Node tests 16 PASS.
- Final smoke: 12 VI/EN route checks plus two component-reference journeys PASS, no API writes (`smoke/report.json`).
- [Independent review](INDEPENDENT-REVIEW.md) records reviewed screenshots, reproduced causes and boundaries. Root reviewed aligned menu, mobile calendar and stale metadata evidence.

Failed harness attempts remain in `menu-failure.json` and `source-states/failure.json`; they are not reported as passing evidence. Fixtures test the actual components, but do not establish real backend persistence, account/provider or whole-product acceptance. No user browser cookies/profile were used.

## Audit inventory and remaining gates

The confirmed issues above are repaired. Remaining project-wide audit work is explicit in [compact-system inventory](../../../ui/compact-system.md): each report renderer's tooltip/legend/axis behavior; each form's pending/submit/server-conflict flow; default/reset/URL consistency outside examined filters; full accessibility and native zoom; long-duration memory/frame pacing; and unloaded legacy/vendor internals. Optional replay-context metadata remains best-effort within session detail reads. These are unverified areas, not claims of newly reproduced defects.

The read-state design uses one owner per shared source and local states for independent requests. It avoids treating “no sessions”, “no trades”, “no filter matches”, a network error and a permission error as interchangeable. This audit does not certify every screen as fully synchronized.
