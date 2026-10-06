# Independent chrome/control review — PASS

The frozen revision passed **85 main browser cases + 2 narrow-mobile supplements**. All six Testing routes were checked in EN/VI, dark/light, and widths1320/768/390. The matrix includes72 demonstration cases,12 natural backend-unavailable cases, and1 coarse-pointer desktop case. A separate8-scan Axe pass found0 WCAG A/AA violations.24 computed text/control contrast samples had a minimum13.326:1.

## Behavior verified

- Workspace link preserves tenant-a and routes to Settings; localized aria/title match the route. Sidebar grouping separators are1px neutral. Expanded and collapsed rail preserve the WM logo; mobile drawer traps keyboard focus and Escape restores its opener.
- Header/rail/subnav active backgrounds and icon colors are neutral in both themes. Header menu is32×32 desktop and44×44 mobile/coarse with the icon center aligned to the sidebar. Main selects are pills; hover and keyboard focus use neutral colors. Compact content controls use32px desktop/44px mobile and16px SVG icons.
- Session Settings remains an inline text action: transparent background,0px border and0px radius. Dashboard background is neutral; decorative bars no longer introduce purple/gold chrome.
- Trades desktop pager uses5 numeric pages plus first/previous/next/last. Mobile uses current page plus previous/next. Pagination circles are32px desktop/44px mobile; next→page2 and previous/first→page1 work. At320/360px, all3 circles plus the row-size pill fit within the viewport. Coarse1320 controls and row-size select are44px high.
- Sort popups stay within content/viewport bounds. Timezone popup has a native scrollbar; track click and thumb drag keep it open, drag increases scrollTop, and Escape restores trigger focus.
- Backend8010 remains stopped. Each of6 actual routes in2 languages shows an honest alert after the read error and clears loading; this is unavailable-state evidence, not successful backend acceptance.

## Findings and oracle corrections

Initial exploratory evidence is retained separately. The reviewer found the desktop header oval44×32 and pager36×40 desktop/24×44 mobile; the owner corrected their CSS specificity and mobile layout before this final pass. The owner also neutralized Dashboard aliases/decorative chart colors and restored Settings inline styling.

The initial pager selector incorrectly included the intentional row-size pill; the final selector excludes FxSelect. A strict2px focus assertion also incorrectly inspected programmatic focus after pointer hover. Focus diagnosis showed :focus-visible=false and outline-style:none while Chromium reported its unused3px outline width. The final harness uses keyboard Tab→focus and checks visible neutral focus after settling. No product change was required for this artifact. Desktop page-count expectation was corrected to9 total controls.

## Evidence and boundaries

GET/HEAD/OPTIONS local5180/8010 traffic only; external/write requests and WebSockets were blocked. Final runs observed0 unexpected blocked requests,0 demonstration API requests, and0 page JS errors. The10 source files in final-receipt.json had identical hashes before/after the main matrix and at receipt creation. Representative images reviewed: Dashboard dark EN1320, Sessions light EN1320, Trades dark VI390, timezone light VI390, and actual-unavailable Analytics EN1320.

Only evidence files were changed by this reviewer; no product edit, commit, server startup, provider or broker action. Previous164-case standardization evidence remains a separate historical scope; it is not implicitly resealed by this receipt.
