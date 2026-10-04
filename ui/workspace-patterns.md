# WMREPLAY page patterns — 03/10/2026

The owner approved the real Dashboard trial and requested research plus application to the remaining MT5 pages. This extends the project pattern; it does not release a global UI system, change pinned shared contracts or grant broker/provider/data permissions. The Dashboard trial remains the visual reference.

## Research and choices

Primary pages were read on03/10/2026; raw public HTML/text and fetch failures are retained under workspace `.artifacts/wm-pattern-migration-20261003/research/`.

| Reference | Useful principle | WMREPLAY application |
|---|---|---|
| [Carbon data table](https://carbondesignsystem.com/components/data-table/usage/) | Table title + toolbar + aligned rows; expansion reveals additional information; pagination handles long datasets. Consistent control sizing preserves alignment. | Sessions, Trades, Data and Live use compact scope/toolbar/list/detail. Keep real sorting/filtering/pagination and selected context. |
| [Carbon form](https://carbondesignsystem.com/components/form/usage/) | Immediate validation; distinct error, warning, disabled and read-only states; longer forms can use groups/steps; page/panel/dialog follow the task. | Settings, risk, trade draft and Prop use grouped fields with adjacent actions and retained validation. Do not decorate each field group as another card. |
| [Carbon progress indicator](https://carbondesignsystem.com/components/progress-indicator/usage/) | Steps describe concrete actions; helper text communicates optional/error states; vertical layout suits a side area. | Prop phases and current lesson progress use actual persisted state. Never infer completed phases or lessons from appearance. |
| [TradingView UI elements](https://www.tradingview.com/charting-library-docs/latest/ui_elements/) | Distinct top toolbar, chart pane, drawing toolbar and contextual right widgets. | Replay keeps the chart dominant and full-bleed; standardize surrounding controls, menus and contextual panel. No TradingView library/framework migration is implied. |
| Earlier Dashboard research: Edgewonk, TradeZella, FX Replay | Lead with a result and make deeper review a secondary layer. | Analytics and Research place the main result/graph first, with ledger/provenance/definitions available for review. |

Initial MetaTrader history URLs and an old Carbon progress-pattern URL returned404; they are not sources for verified claims. The corrected Carbon component page was read successfully. No logged-in competitor products or proprietary source were accessed.

One identical grid for every page was rejected: forms, long ledgers, lessons and chart execution have different jobs. Repainting existing cards was also insufficient: the migration removes redundant wrappers/intro copy and makes the main task visible. Existing route-specific state and semantic surfaces remain when they communicate selection, editing, permission or interaction.

## Project contract

- Common page frame: compact22px title,16px section heading,14px body,13px controls,12px metadata;32px desktop/16px mobile side spacing;24–32px between groups. Financial values retain units, precision and tabular alignment.
- `workspace-pattern.css` owns shared project token aliases/page frame. Route CSS owns layout, selected rows, forms and state-specific surfaces. Keep chart renderer geometry, nested semantic surfaces and the pinned `ui-system.snapshot.css` independent.
- Flat-first: spacing, typography and alignment before borders/backgrounds. One dominant content region; no decorative colored left edge, nested cards, repeated explanatory hero, or text that narrates implementation details.
- Scope and main action stay near the title. Secondary action/provenance belongs near the content it affects. Essential simulation/live/permission/data warnings remain visible; technical detail may use disclosure.
- All themes, keyboard focus and responsive controls remain usable. Tables may scroll within a named region; the page must not overflow. Menus/drawers remain real interactive surfaces with sufficient contrast.
- No data/state rewrite: selection, filtering, drafts, save/cancel, revisions, reload, drilldown and historical cutoffs retain existing contracts. Unknown is not zero; stale/partial/blocked must remain distinct. Preview fixtures do not prove backend or broker acceptance.

## Page ownership

| Group | Pattern | Existing source |
|---|---|---|
| Dashboard | Three start actions → filtered Performance metrics/charts → searchable Recent Sessions | DashboardSessions, DashboardPerformance |
| Sessions | Session scope/actions → summary/description → performance → Recent Trades | SessionPicker, SessionPerformance |
| Trades | Compact catalog/scope → selected session → detailed ledger | SessionPicker, AnalyticsWorkspace |
| Analytics | Filters → metrics/main balance evidence → ledger → review detail | AnalyticsWorkspace |
| Data / Playbook | Catalog/list → selected detail/editor, import or version diff | DataDeskWorkspace, PlaybookWorkspace |
| Research | Data scope/quality → run assumptions → job result/checkpoint | ResearchWorkspace |
| Journal | Entry list/filter → focused editor/detail | JournalWorkspace |
| Risk / Trade draft | Grouped fields → computed review → explicit simulator action | RiskWorkspace, TradeWorkspace |
| Prop | Session scope/actual phase/goals → resume or create → report | PropWorkspace |
| Learn | Current lesson/progress → course navigation/content | LearnWorkspace |
| Settings | Grouped preferences/context/permissions → save/cancel | SettingsWorkspace |
| Live | Selected surface/capabilities → real snapshot or unavailable state | LiveWorkspace |
| Replay | Chart pane → compact tools → contextual right panel | ReplayWorkspace, FxReplayShell |

Runtime and independent review receipts live in `foundation_v2/evidence/ui-pattern-migration-20261003/`. Pattern approval does not mean whole-product completion or canonical-golden promotion.

## Dashboard layout reopened by owner

The owner requested one-page-at-a-time redesign using the supplied FX Replay screenshot. Dashboard now restores Backtesting session, Prop firm session and Tutorials entry actions. Performance uses the existing overview aggregate with a session scope and UTC close-date period; four metric surfaces sit beside the monthly trades chart, followed by monthly win rate and trades by symbol. Invested/replayed durations stay unknown because the API does not measure them. All-session totals include archived records and remove inherited duplicate closures; partial sources remain explicit. The earlier selected-session P/L layout is superseded for Dashboard only.

Recent Sessions has independent search/status/sort, six-row pagination and a native disclosure menu. Manage links open existing revision-aware rename/duplicate/archive workflows; Dashboard performs no mutations itself. URL parameters retain Performance and list filters separately. The shared subnav uses the existing hover/selected/focus tokens. Evidence: `foundation_v2/evidence/ui-dashboard-fx-20261003/CHECKPOINT.md`; other page layouts retain their current contracts.

Dropdown and navigation refinement: `fx-shell-story.css` owns the project shell hover/selected palette, shared by aside and subnav. Subnav items use an inset40px rounded target rather than a full-height tint/underline. Select triggers, popup options and Recent Sessions menu items have neutral pointer hover; the checked option retains its checkmark and a distinct selected+hover state. Opening a select by pointer does not force a blue glow; keyboard `:focus-visible` remains explicit. Native value/change, disabled and progressive fallback behavior stay intact. This is a project interaction change, not a shared-system release. Evidence: `foundation_v2/evidence/ui-dashboard-controls-20261003/CHECKPOINT.md`.

## Component interaction refinement

### Sessions layout reopened by owner

Sessions follows the owner's FX Replay reference: native session scope and existing management actions, session summary/description, closed-trade balance plus monthly and weekday Net P/L, six metrics, and paginated Recent Trades. This replaces Sessions' embedded four-metric Analytics summary only; Trades and Analytics retain their own layouts. `SessionPicker` owns catalog, revision-aware mutations and a scope-keyed/abortable analytics read; `SessionPerformance` uses the existing analytics adapter/model and renders that selected scope. Native dropdown interactions reuse the Dashboard system.

Balance excludes floating P/L. Average payoff is distinct from planned Risk/Reward and stays unknown when unavailable. Calendar P/L anchors to the last historical close in UTC; week starts Monday. Missing date/PnL makes time summaries unknown. Charts show the latest12months with reachable overflow; weekday bars include signed Net P/L across the session. Recent Trades sorts latest close first, offers5/10/20rows and page selection, and links each trade to its existing Analytics detail. Archive/restore replaces irreversible deletion; duplicate, metadata conflict and uncertain-write fences stay intact. Evidence: `foundation_v2/evidence/ui-sessions-fx-20261004/CHECKPOINT.md`.

Owner feedback after migration: selection and child components still felt basic. `component-interactions.css` extends the same project pattern with distinct hover, persistent selection, open picker and keyboard focus, plus short color transitions and reduced-motion handling. Selected records use a subtle full-row tint/outline; no decorative left rail or nested card. Dashboard results show the actual selected row/checkmark; Data/Prop controls expose their selected state to assistive technology.

Native selects retain their value/change, keyboard, type-ahead, form and disabled contracts. [MDN customizable select](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Forms/Customizable_select), read03/10/2026, documents `appearance:base-select`, `::picker(select)` and optional button/selectedcontent. Support remains limited: the richer picker is enabled through `@supports`; unsupported engines retain native controls. Session selectors use an inert native button/selectedcontent to truncate long labels in the44px trigger while retaining the full option text in the picker. This does not add a JavaScript combobox library or search feature.

Evidence: `foundation_v2/evidence/ui-component-interactions-20261003/CHECKPOINT.md`. Installed Chromium was tested; removing the progressive CSS tests the native fallback contract without claiming a Safari/Firefox run.

## Component audit and consolidation

The follow-up audit closes interaction gaps in disabled fields, keyboard-scroll regions, chart overlays and object controls. Toggle names remain stable with pressed state; one-time actions (play/pause, viewport range) do not claim a persistent selection. Chart opens with crosshair, so drawing requires an explicit tool choice. Annotation guidance appears only while drawing or reviewing a draft, and sidebar actions have separate44px rows.

Loading/error/empty are distinct in Playbook; empty catalogs do not invite selection. Settings retains its safety/context facts but removes repeated footer/loading/return navigation. Retired custom chart-menu CSS and button translation were removed after checking live consumers. No hypothetical read-only field rules were added: there are no such fields in this UI. Evidence and exact source scopes: `foundation_v2/evidence/ui-component-audit-20261003/CHECKPOINT.md`.

## Trades and Analytics reopened from FX Replay references — 04/10/2026

This supersedes the earlier retained Trades/Analytics composition. Subnav identifies the page;
duplicate visible Dashboard/Sessions/Trades/Analytics headings and manual reload actions are removed.
Existing GET reads reconcile on focus/online without retrying writes. Uncertain session management
responses keep their draft and mutation fence until the catalog is reconciled. Provider capability
checks and intentional lifecycle actions remain distinct from reload.

Trades presents one ledger with search, side/outcome/asset/tag/time filters, column selection,
sortable headings, page size/navigation, row selection, detail and CSV. The same filtered rows own
Analytics metrics and export; filtered closed balance is hypothetical from original capital,
never floating equity. URL state retains filters and report tab. Same-revision background reads
keep the subtree, drafts and Monte Carlo result; a changed scope/revision discards obsolete results.

Analytics has Sessions and Prop firm sources, each using Performance, Drawdown and Simulation.
The shell owns those source links as nested navigation beside Analytics in the sub-header;
below760px they form a second header row. They are not tabs inside the scrolling report body.
The header cannot flex-shrink when long reports load; the active primary page stays visible
in its horizontal navigation. Source links retain session/cursor and explicit Prop attempt keys.
Dashboard and report content start24px below the header after duplicate title removal.
Performance includes outcome/side summaries, explicit fixed UTC hour ranges, timezone-aware
hour/day/month breakdowns, calendar and average frequency. Drawdown uses closed-trade balances
and observed price excursion. Missing original fees, planned risk and R remain unknown.
SL/RR uses the read-only experiment endpoint and marks ambiguous/unsupported trades; configured
stop distance is a what-if assumption. Monte Carlo is local seeded bootstrap/configured win-loss,
bounded to250000steps, and is not a forecast or a write to the canonical ledger.

Prop selects a persisted attempt report and binds its replay session/dataset/hash/branch/exact
event/cursor/phase/currency. It includes only closures in the report phase and attempt interval,
from that phase's initial capital; carried positions belong to the close phase. Challenge
equity/objectives remain the report's own snapshots. No unrelated session is used as fallback.
An empty actual Prop catalog is an empty state, not a fabricated challenge.

Project shell hover/selected tokens and existing positive/negative/primary tokens own the colors.
Chart labels use HTML scale captions below900px to avoid shrinking SVG text on tablets/mobile;
dense tables scroll in a named keyboard-focusable region. Native select value/change and
progressive picker behavior remain. CSV escapes spreadsheet formulas and includes provenance.
Evidence and limitations: `foundation_v2/evidence/ui-fx-analytics-20261004/CHECKPOINT.md`.
Header correction evidence: `foundation_v2/evidence/ui-workspace-header-20261004/CHECKPOINT.md`.
