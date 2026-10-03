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
| Dashboard | Scope → metrics → main chart → three recent rows | DashboardSessions, DashboardPerformance |
| Sessions / Trades | Compact catalog/scope → selected session details → ledger | SessionPicker |
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
