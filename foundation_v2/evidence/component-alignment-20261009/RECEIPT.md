# Component alignment audit — 09/10/2026

## Outcome

Extended the menu alignment audit to the visible component families across the application. Corrected native checkbox spacing, Ledger selection/action axes and numeric alignment, scenario numeric headers, Market toolbar field height, and the reference table action axis. No data, API, download, trading or state ownership change.

| Confirmed issue | Before | After |
| --- | --- | --- |
| Ledger drawer checkbox-to-caption gap | 13px | 8px shared spacing token |
| Risk checkbox gap | 11px | 8px |
| Journal context checkbox gap | 10px | 8px |
| Ledger action control vs header center, desktop | −9.23px | less than 1px offset |
| Native checkbox browser margin | 3px 3px 3px 4px | 0 |
| Ledger numeric columns | Left aligned | Header and body right aligned, by column key |
| Market search vs desktop dropdown | 44px vs 36px | Both 36px; touch controls retain 44px |
| Reference action column | Header/body different axes | Common center |

Checkboxes follow the first caption line when the label wraps; they are not centered against the entire paragraph. The CSV review checkbox was checked with an intercepted preview fixture; its old margin-top override was redundant and removed. Numeric alignment follows semantic column keys so hiding/reordering columns does not change it. Scenario tables have fixed columns, with the last two numeric columns aligned right.

## Coverage inventory

Root diagnostic: 14 routes × dark/light × desktop1710/mobile360 = 56 initial samples. Independent diagnostic: 15 routes × the same contexts = 60 samples, including Prop demo separately. Counts overlap and do not represent 116 unique workflows.

| Component family | Inspection and evidence |
| --- | --- |
| Shell, page/content regions | Initial route sweep for horizontal overflow; no reproduced issue |
| Button/link/summary icons | Visible direct SVG centers measured across the route sweep; visual samples reviewed |
| Tabs, labels, fields, toolbar controls | Reference and route samples; actual Settings/Risk/Research form geometry; Market toolbar height checks |
| Checkboxes and menu marks | Shared adapter source review; Ledger drawer, actual Risk/Journal context; conditional CSV preview fixture |
| Tables and selection/actions | Demo Ledger data, column toggle regression; reference table; Simulation numeric headers |
| Dialogs and drawers | Quick session, session settings, Ledger filter drawer; actual idle CSV and asset catalog drawer |
| Cards/KPI/report regions | Initial visible route samples and existing compact acceptance; not every populated renderer or tooltip |
| Trading chart | Application controls in initial samples; vendor internals excluded |

Read-only actual app views are distinguished from app demo data and intercepted fixtures. Focused tests use app demo Ledger/session data and a GET dataset fixture. Independent CSV preview POST is intercepted and fulfilled locally; no API write is forwarded. No provider/broker action or service restart.

## Validation

- `npm run build`: passed (175 modules).
- `node tests/componentAlignment.browser.mjs`: 36 focused journeys passed, both themes and widths; no page errors or attempted writes. Assertions cover gaps, axes, field edges, heights and numeric alignment after column selection.
- `node run_compact_system_acceptance.mjs`: 22 regression cases passed.
- Independent final review: 36 focused journeys and 8 conditional CSV/Journal checks passed; [INDEPENDENT-REVIEW.md](independent/INDEPENDENT-REVIEW.md).
- Root visually reviewed final Ledger table, filter drawer and mobile quick-session screenshots.
- `git diff --check`: passed.

Harness failures were investigated separately: a selector targeted the wrong drawer control; mobile stacked toolbar rows require equal heights rather than equal centerY; Simulation needs its tab selected. They are not reported as product failures or passes. Historical failure reports remain with this evidence.

Runnable diagnostic and focused checks: `web/tests/componentAlignmentAudit.browser.mjs` and `web/tests/componentAlignment.browser.mjs`. Set `TW_ALIGNMENT_EVIDENCE` to choose an output directory. The diagnostic identifies candidates; it is not a full acceptance test.

## Limits

No defect was reproduced in the remaining sampled visible controls; this does not certify every conditional component. Real loaded session/chart states, broker/live-connected states, submitted validation/server conflicts, every dialog variant, chart-vendor internals, native zoom/full accessibility and frame pacing remain outside this acceptance. Simulation checks exercise numeric headers because current demo scenarios have empty bodies. `MarketAssetCatalog.jsx` has no current consumer and is not claimed as a user-reachable defect.

The mobile Market toolbar intentionally stacks controls; the audit only requires common heights there. The shared rule fixes browser margins at the checkbox owner rather than adding per-page position adjustments. Alignment uses the component role, not a blanket rule centering all text and content.
