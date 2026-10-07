# WMREPLAY page patterns — 03/10/2026

The owner approved the real Dashboard trial and requested research plus application to the remaining MT5 pages. This extends the project pattern; it does not release a global UI system, change pinned shared contracts or grant broker/provider/data permissions. The Dashboard trial remains the visual reference.

Current color authority (06/10/2026): [project-palette.md](project-palette.md) applies
the owner-approved vintage palette to every workspace. The trading chart exception
selected on 07/10/2026 is recorded in the native-palette section below.
It supersedes earlier literal colors below. Current Testing control geometry and
text-only navigation hover are defined by [testing-standard.md](testing-standard.md).

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

Recent Sessions has independent search/status/sort and six-row pagination. Direct actions open revision-aware settings, duplicate and exact-name delete dialogs. Session archive/restore UI is deferred; existing archived records remain readable through All or a direct link and keep replay/duplicate restrictions. Dashboard deletion remains scoped to the session, with conflict/uncertain-result reconciliation. Demo mutations stay in component state. URL parameters retain Performance and list filters separately. The shared subnav uses the existing hover/selected/focus tokens. Current control evidence: `foundation_v2/evidence/session-controls-20261006/`; initial layout evidence: `foundation_v2/evidence/ui-dashboard-fx-20261003/CHECKPOINT.md`.

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

## Session scope controls — 04/10/2026

Sessions entry uses an explicit deep link first, then a valid remembered replay session,
then newest creation among active sessions. Opening report filters never updates replay
resume storage. Primary Sessions navigation requests the default; explicit session links
retain their own destination.

Primary Trades navigation opens all sessions. Its searchable checkbox dropdown supports
all, one, multiple, or no sessions; repeated `sessions` URL keys preserve selection on
reload. A plain explicit `session` deep link still selects that session. Historical or
trade-detail deep links retain the existing exact single-session analytics reader.
Analytics Sessions uses a single Session control inside the filter grid; catalog/header
management chrome belongs only to Sessions. Prop source selection remains separate.

GET `/api/v2/replay/trades` accepts optional comma-separated `sessions` (absent = all;
empty = none), side/outcome and UTC close-date filters. It reuses the Dashboard lineage
dedup projection, with an optional ledger; each row retains selected source/session,
origin, revision/cutoff/hash, currency and starting capital. No mixed-session monetary
total/balance is inferred. Table Return (%) uses each row's original capital and CSV
retains per-source provenance/currency. Unavailable sessions are listed explicitly;
invalid selected IDs fail instead of broadening scope. Checkbox/detail identities
include session + trade while display/Journal/Replay use the original trade ID.

Session changes clear old trade/cursor/event scope; date aliases cannot restore cleared
filters. Dropdown uses existing hover/selected/focus tokens and stays within its mobile
container. Unchanged background GET reconciliation retains page size/page/columns/detail.
Evidence: `foundation_v2/evidence/ui-session-scopes-20261004/CHECKPOINT.md`.

## Chart workspace — Lightweight rollback, 04/10/2026

The shell owns navigation, theme and a single command slot. ReplayWorkspace renders its
commands into that slot; there is no second toolbar/context row above the canvas. Two
SVG rails expose existing capabilities: drawings on the left, order/object/data/context
panels and the real Journal route on the right. Unavailable FX Replay tools are not
represented as inert controls. Timeframe changes choose a registered dataset rather
than fabricate candles at another aggregation.

Drawing and replay toolbars are chart-relative overlays. Pointer and arrow-key movement,
pin/collapse and workspace-scoped optional storage retain user control. Responsive default
positions separate the two bars; they remain collapsible because overlays can cover candles.
On narrow screens the dock overlays the chart; Escape returns focus to its actual opener.

Order draft/entry/TP/SL use native Lightweight Charts price/time projections. The order
primitive participates in autoscaling so TP/SL remain reachable and repaints on pan/zoom.
Unknown money stays N/A. Buy/Sell prices are modeled bid/ask at the current cutoff, while
market fill remains next-bar open. Drag/key TP/SL commits through the same revision lock as
replay stepping. Source session/revision/cursor changes invalidate a drag; historical,
completed or conflicted states lock mutation. Draft changes have dashed lines and labels.

Execution data is accepted only when its cursor matches the displayed candles, including
when an older local preview API still returns a canonical execution snapshot for history.
New backend historical reads reconstruct the execution checkpoint. Props keep their
price-mark/receipt gates; editing protection does not create a Prop feed receipt.

This workbench remains available with `chart_engine=lightweight` as a reversible rollback.
Its original scoped receipt is foundation_v2/evidence/ui-chart-workbench-20261004/CHECKPOINT.md.

## Chart workspace — Advanced Charts default, 04/10/2026

Owner-confirmed Advanced Charts v23.040 supplies the native drawing rail, indicators,
chart styles, interval selector, settings and object tree. WMReplay retains the session
navigation, floating replay controls, application dock and simulator/account bar. Native
tools replace the overlapping custom drawing/type/indicator controls. Replay pauses on
native mouse-down; its toolbar starts below the symbol/volume legend and retains local
move/pin/collapse preferences. Theme is applied after restoring saved layouts so a dark
snapshot cannot override the light shell.

Only the current API-visible prefix reaches the independent datafeed. Higher intervals
aggregate that prefix, including the causal partial last bucket; intervals below the
dataset are not offered. Symbol, tick precision and asset class follow dataset/execution
metadata. Rewind/session changes rebuild the widget; the adapter also invalidates cache
callbacks on rewind. Native order lines use generation locks and the existing protection
API. Entry/SL/TP fit into the price scale, with an explicit native "Vừa lệnh" action.

Native layout/drawing snapshots stay local to browser/workspace/session/dataset and
creation cutoff. History may restore only a snapshot saved at or before that cutoff;
there is no remote TradingView persistence or market data. The eight existing workspace
annotation types render as readonly native imports and never serialize into the native
layout. They remain managed through the application Objects panel; new native drawings
use the chart's object tree. The local vendor distribution is served separately and is
never tracked/copied into the app bundle. Missing assets show a real error and explicit
rollback. See foundation_v2/evidence/ui-advanced-chart-20261004/CHECKPOINT.md for scoped
runtime evidence; full U4/product, real-data, performance and manual WCAG gates stay open.

## Legacy reference refinement — 07/10/2026

Direct inspection of the owner's FX Legacy session identified all header icons:
back, symbol search, comparison, timeframes, chart type, New Layout, Indicators,
Undo/Redo, session name, layout selector, Quick Search, Settings, snapshot, Editor,
AI Mentor, theme and fullscreen. Alerts is absent; no FX Replay logo is added.
The rocket beside quantity is Scalper mode, distinct from the Mentor sparkle.
The replay switch is timeframe sync; it stays disabled until its semantics are implemented.

Advanced Charts owns the native header, including intervals, chart styles,
indicators, undo/redo and chart settings. `LegacyChartHeader` renders only the
application-specific controls through five official `createButton` extension
hosts (market, layout, session, search, tools). Fullscreen belongs to the header
tools group; the rail starts below its continuous header separator. CSS ordering
targets this pinned v23 distribution; a vendor upgrade requires renewed visual QA.
All desktop docks reserve space below the full-width header. The iframe stays
full width, its body reserves the dock/rail width, and a native resize updates the
canvas and price scale. Both document body and outer canvas allow header overflow;
checking header bounds alone does not prove the rightmost controls are visible.
Screens at 600px or less use a dock overlay because v23 has a minimum chart width.
Codex's embedded browser can cancel v23 blob iframe navigation. The explicit
`chart_iframe=srcdoc` URL option loads the same generated local document and options
hash using srcdoc; normal blob transport remains the default. Vendor assets are
unchanged. Retest this version-specific adapter on any chart-library upgrade.
The default native viewport is retained unless a local
layout was saved. Changing interval aggregates the same causal prefix and never
advances replay. The replay timeframe is independent until its sync switch is on;
native interval events then drive the replay selector. Rewind/remount retains the
chosen native interval without reusing a saved layout from a later cutoff.
Mobile tools use an overflow menu, including native indicator/undo/redo actions
that do not fit the row. Menus handle outside click and Escape in both documents
and restore focus when the opener disappears during resize. Native header
pointer/keyboard interaction pauses replay before operating a chart control.

Compare, multi-chart layout creation, Editor and AI Mentor retain
explicit preview states. Mentor text is local UI state and cannot send to a provider.
Quick Search opens existing preview tools. Save/restore remains browser-local;
Save stays visible under the layout name: clean is disabled, dirty/error is enabled,
and saving is disabled until persistence succeeds. Ctrl+S and manual Save cancel
the debounce. Local autosave uses five seconds after edits (project policy, not an
assertion about FX's cadence). Edit revision, replay generation and cutoff guard
against stale callbacks; timeout/storage failure stays retryable. Snapshots retain
the existing workspace/session/dataset/cutoff scope. FX's live clean state and official
FAQ confirm layout persistence of indicators, drawings and style; its cloud protocol
and dirty-to-save timing were not mutated or inferred from the reference session.
The camera opens Download/Copy image, using client-only PNG and guarded
generation/cutoff/interval capture. Clipboard denial is surfaced rather than reported
as success. The owner confirmed
TradingView logo-removal rights; `widget_logo` stays disabled without vendor edits.

The native drawing rail and bottom scale controls remain. One draggable replay
bar and one draggable quick-action bar match the reference; the extra app drawing
palette is removed. Quick actions can be hidden and restored from session settings.
The right rail follows Object tree / Order / Go To / News / Journal / Settings.
Replay speed has sixteen positions (1–16 requested advances per second). Only one
revisioned request runs at a time, so service latency can reduce the actual speed.
Bar Replay arms selection of a previously visible candle; it does not reset to
the dataset start. Forward replay resolves the first available underlying candle
in the next UTC interval bucket on the server, capped at 1000 traversed bars;
all fills/protections still process each bar. Historical forward is a bounded GET
up to the canonical cursor; rewind selects the previous occupied interval bucket.
Unsupported sub-dataset intervals and calendar resolutions stay unavailable.
Buy/Sell retains simulated order ownership with white labels. Quantity has one
outline with a separate spinner. The center grip resizes the positions list;
the footer maximize button expands that list below the header, while header
fullscreen uses the browser Fullscreen API. Replay/quick toolbars remain visible
above the expanded list. The wallet popup shows cutoff-safe equity and P/L;
uninitialized execution stays unknown rather than inventing an account balance.
Footer balance visibility and position expansion are UI state only. Positions read the cutoff-safe execution snapshot:
open/pending state and protective fills from its ledger. Unavailable execution
is distinct from an empty list; unknown per-trade commission stays a dash.
Pagination is local over the snapshot, not a claim of server paging.

Order opens a focus-trapped modal using the existing simulator submission and risk
validation. Current simulator contracts require both SL/TP; their switches are
display-only, and unsupported order types, break-even and strategy creation stay
disabled. A separate local Scalper preset converts positive distances in percent,
pips or supported ticks to protective draft prices. It persists by workspace and
session in browser storage and still opens the existing confirmation dialog;
it does not claim FX's instant order execution. Successful Save can open Journal;
errors leave the draft visible.
Go To is anchored to the invoking rail or quick-bar button; custom cursor/date
navigation preserves existing cutoff checks. Future/news/session jumps stay disabled.
The layout selector displays reference rows 1–8 and sync controls; only one chart is
supported. Copy/rename/open layouts remain unavailable rather than implying cloud
storage. The session title is plain italic text.

The v23 public `paneObjectTree` probe did not open a right-side native tree. The app
drawer reads `getAllShapes`/`getAllStudies` and uses public selection, visibility and
remove APIs, excluding imported workspace annotations. It is app chrome over native
entities. Journal's Trades and Month/Year calendar derive closed trades from the
cutoff-safe execution ledger; its rows are not journal-note records. Unknown execution
stays unavailable, commission stays unknown and quantities preserve eight digits.
Menus and Journal tabs support keyboard navigation and resize focus restoration.

Dark chart: #0F0F0F pane, #000000 chrome, #202020 grid, #DBDBDB scale text;
light: #FFFFFF. Up/down candles and Buy/Sell use #26A69A / #EF5350.
Project pages use the stronger semantic palette in [project-palette.md](project-palette.md).
Testing state/language/paging contract remains [testing-standard.md](testing-standard.md).
Initial receipt: foundation_v2/evidence/legacy-match-20261007/CHECKPOINT.md.
Native header correction: foundation_v2/evidence/native-refinement-20261007/CHECKPOINT.md.
FX controls and Save mechanism: foundation_v2/evidence/fx-chart-controls-20261007/CHECKPOINT.md.
Header/rail/footer and replay polish: foundation_v2/evidence/fx-chart-polish-20261007/CHECKPOINT.md.

Owner follow-up: remove the floating quick-action toolbar and its visibility setting.
The rail retains those destinations. Header separators render inside clipped v23
groups; session name centers in the remaining space between left undo/redo and
right layout/save controls, without an internal separator. Layout controls end
beside Quick Search. App-owned popovers, compact overflow, order dialog and drawers
share Testing's Inter baseline, project focus/hover/disabled tokens and 140ms
feedback with reduced-motion support. Native chart typography, compact dimensions,
blue trading actions and candle/Buy/Sell semantics remain chart-owned. Quantity
focus belongs to its single outer container; hover fills only the individual spinner arrow while the input stays transparent. All six-dot grips use filled
circles. Popovers focus the selected enabled item, dismiss on focus leaving,
restore the opener on Escape/explicit dismissal and preserve native form editing.
Evidence: `foundation_v2/evidence/fx-chart-polish-20261007/consistency-report.json`
and `independent/consistency-review.md`.

### Chart hover and positions follow-up

Compact chart action controls use rounded hover geometry. Six-dot drag grips do not react visually to pointer hover; keyboard focus remains available. Quantity focus belongs to the single outer edge, including when either spinner is focused.

The replay interval list uses a compact 146px popover with rows filling its content width. Native header intervals retain TradingView's active state and render the current choice with neutral active text (white in dark, black in light) and the existing active surface. Opening positions with the chevron restores a readable height (at least 260px or 40% of available table space, capped to the chart's normal limit); larger user-resized normal heights are retained. Dragging may still shrink below that opening default.

Position tabs use transparent hover with text contrast, an active underline across the full button and continuous top/bottom dividers. The table header uses project-raised in both themes. Rows-per-page sits left, page navigation right, and the pager remains at the bottom of the positions viewport with a top divider. Expanded overlay and maximized positions hide the chart's floating replay toolbar so it cannot cover table tabs/rows; restoring the regular chart preserves that toolbar's state and position.

The positions grip remains usable while maximized. Dragging follows the pointer in both directions; above the chart's minimum-space limit, the table slides over the chart while retaining its minimum layout space. This avoids a stationary grip followed by a jump to full viewport. Bounds are measured once per gesture and pointer updates are batched to animation frames; release flushes the final update, while cancel/lost capture stops it. Dragging fully up or keyboard End maximizes across the entire viewport, covering the chart header. Pointer down/click alone does not restore. The restore button uses inward corner brackets, paired with outward corners for maximize.

Dark chart chrome uses the same #0F0F0F surface as its pane, above a #000000 trading footer. This changes backgrounds only. Drawing separators are inset 8px; the left native object-tree shortcut is hidden because the right app rail owns that entry. Quick Search, chart properties and screenshot form one header group with no internal vertical separators. Session Settings has an inset divider above its right-rail button.

The chart opens the same SessionSettingsDrawer as the session pages. Name/description saves use the existing revision-guarded metadata API; chart rows, viewed cutoff and reconstructed execution remain intact. A conflict or uncertain result blocks resubmission until closing the dialog refetches the current record at the same cutoff. Quantity keyboard focus uses its single neutral outer contour, while input hover stays transparent and only a hovered spinner arrow fills.

### Dashboard quick session

Dashboard's Backtesting Session action opens a centered native dialog with a fixed
header/footer and a scrolling form. It reuses FxSelect and the Testing locale and
project tokens. Popups clamp to the dialog body so the footer cannot clip options.
Name, positive account balance (default 100000), one local asset/dataset and an
optional saved strategy revision are submitted together through the existing
replay-create API. Advanced mode adds description and the starting candle.
Strategy lookup is tenant-scoped; missing/deleted revisions fail before creation.

The current TradingView Advanced Charts engine is explicitly Legacy Chart. This
choice is stored on the session and preserved on branches. New Chart and shared
chart layouts remain unavailable; Prop Firm links to its existing setup workflow.
Saved capital/currency appear before simulator initialization and seed that
existing setup. No execution snapshot or broker order is fabricated at creation.
A failed 4xx response permits editing/retry. An uncertain network/5xx response
blocks another submission and directs the user to inspect the sessions list.
Evidence: `foundation_v2/evidence/quick-session-20261007/CHECKPOINT.md`.

Owner refinement: quick-dialog fields use transparent outlined controls and neutral
focus; the balance group owns its single outer focus contour. Strategy's empty
popup shows only a no-results row, without a duplicate selected-value header or
synthetic None choice. Its inline create action saves a needs-definition draft
through the existing playbook endpoint, then selects that record/revision. Pending
blocks navigation and repeat submission; uncertain creation requires checking the
strategy catalog. This does not freeze or enable execution of a strategy.
Redundant layout/Legacy explanation is removed; optional layout stays disabled.
The asset link is muted at rest, with content-colored text and an underline on
hover, and no hover surface. Dashboard's three quick actions share border,
padding and geometry, with peach hover.
Evidence: `foundation_v2/evidence/quick-session-polish-20261007/CHECKPOINT.md`.

The balance field retains its left money symbol and places the currency code
immediately after the editable amount, inside the single neutral outer contour.
The amount width follows its value so the unit stays adjacent while editing.
The new-strategy text action keeps the same orange color and transparent surface
at rest and on pointer hover; keyboard focus remains visible.
Evidence: `foundation_v2/evidence/quick-session-unit-20261007/REVIEW.md`.

The approved balance refinement replaces the currency symbol with the existing
wallet icon, separated from the amount by a full-height vertical divider. The amount
keeps comma-separated thousands while editing and at rest, preserving the caret
by its offset within the unformatted value. Backspace/Delete skip separators.
The draft/API value remains unformatted. Decimal input accepts up to two
fractional digits and pasted grouping commas are removed before storing.
The smaller muted currency suffix remains next to the amount, and clicking the
field's blank area focuses the input. The group retains one neutral focus edge.
Evidence: `foundation_v2/evidence/quick-session-wallet-20261007/REVIEW.md`.

### Offline data library

Practice's Market Data route owns offline historical datasets and local CSV
import. It combines configured provider instrument metadata and saved dataset
versions in one table. Categories come from declared asset_class metadata, never
symbol-name guesses. Table columns are product, category, source, UTC historical
range, candle count, quality and actions. Session creation belongs to Sessions
and Dashboard; this page has no create-session action.
Search is left-aligned. Right-aligned controls reuse the Recent Sessions pattern:
compact filter toggle, optional category/source pills, sort, instrument-list refresh and CSV import.
Closing filters resets category/source; search and sort remain independent.
There is no count, duplicate title or permanent explanatory block above the grid.
Table separators extend through the shared page gutter while text stays inset.
Dataset rows open quality/provenance in a native dialog. The toolbar's Import CSV
action opens a separate native dialog. A row's ellipsis opens an action menu with
View details and Import an update. The latter preselects source, instrument,
category and specification in the CSV form; saving creates a new immutable dataset
version. Earlier versions remain separate rows and existing sessions keep their
pinned dataset. Metadata-only rows have no historical range, candle count or
quality assertion; details are disabled and CSV import remains available.
Successful CSV import clears filters, selects the imported version, opens its
details and refreshes the server-owned catalog. Escape/outside dismissal and
keyboard menu navigation return focus; menus reposition during scrolling rather
than dismissing during a trigger's delayed automatic scroll into view.

`view=data` is a compatible alias of `view=market-data`. Both select the Testing
sidebar area. Legacy `data_tab=sync` no longer mounts broker history controls or
starts MT5 polling. Practice does not read market-assets/live-status endpoints.
The existing dataset endpoint now also returns optional catalog_items from
configured providers declaring read_metadata and list_instruments(workspace).
This is metadata only: it grants no network, download, trading or holdout authority.
Unknown dataset links do not silently select an unrelated dataset.

The owner prioritized offline first. MT5 connection/sync UI work is deferred;
existing Live screens remain unchanged. No new Data Desk sidebar entry is created.
The imported-history launcher now configures a metadata-only Dukascopy catalog.
The backend process reads TW_DUKASCOPY_API_KEY; it is never returned to the UI.
Ordinary catalog GETs read an atomically saved local snapshot, without external I/O.
An empty configured catalog is fetched once on page entry; cached lists only refresh
through the toolbar action. Seven-day-old lists are marked stale, with no polling.
Failure retains cached rows; missing key, denied key, 429 and invalid-cache states
remain explicit. A local UI cooldown timer re-enables the button without network I/O.
No inventory or history is fabricated when the real workspace lacks key/cache.
Loaded rows show disabled Downloaded; metadata-only rows currently
show disabled Download with an unavailable-source tooltip. Enabling that action
requires a separately configured and verified history adapter. CSV import reuses
the deterministic preview and immutable artifact APIs.
The import dialog focuses the file picker and restores toolbar focus when closed.
Required CSV columns/time formats are shown before selection. Preview/import locks
the form and dialog close until the request settles, so metadata cannot change
underneath a pending quality report. A blank catalog shows the toolbar and headers;
pagination appears only when there are matching rows. Filter misses and read errors
retain useful feedback.
Demo uses fixture catalogs and disables imports; Research detail
links preserve preview state and clear stale replay-session context.

The new table/shell labels and UTC dates use the current VI/EN locale.
Existing advanced CSV/detail prose retains its prior mixed-language copy;
this consolidation does not claim a full translation migration.
Evidence: `foundation_v2/evidence/offline-library-grid-20261007/RECEIPT.md`.
