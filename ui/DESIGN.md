# MT5 UI contract — chart-first decision workspace

**Status:** candidate under implementation (project scope only)  
**Version:** `0.2.0-dev`  
**Owner:** `projects/mt5-tradingview-backtester/ui/`  
**Updated:** 2026-09-29

This is the agent-facing UI contract for the MT5 TradingView Backtester. It
translates the useful interaction grammar observed in the historical
`D:\ANNAM\gtas_vpp` project into a trading product. It is a project contract,
not a release of the shared UI layers and not an approval of every current
screen. The runnable React/Vite implementation in
`foundation_v2/web/` remains the code authority.

## 1. Source of truth and boundaries

Use these sources in this order when a visual choice conflicts with semantics:

1. backend contracts, capability checks, provenance and replay cutoffs;
2. the shared trading invariants in
   [`UI/docs/TRADING-UI-CONTRACT.md`](../../../UI/docs/TRADING-UI-CONTRACT.md);
3. this document and the project fixture/state contract;
4. the implementation and browser runtime;
5. historical references, screenshots and generated design artifacts.

The current project entrypoints and representative surfaces are:

| Surface | Implementation | Primary job |
|---|---|---|
| Shell and context | [`FxReplayShell.jsx`](../foundation_v2/web/src/FxReplayShell.jsx) | Keep navigation, mode and market context visible |
| Overview | [`main.jsx`](../foundation_v2/web/src/main.jsx) | Show the current scope and one useful next action |
| Data | [`DataDeskWorkspace.jsx`](../foundation_v2/web/src/DataDeskWorkspace.jsx) | Select a dataset and inspect quality/provenance |
| Practice / replay | [`ReplayWorkspace.jsx`](../foundation_v2/web/src/ReplayWorkspace.jsx) | Read the chart up to a deliberate decision cutoff |
| Research | [`ResearchWorkspace.jsx`](../foundation_v2/web/src/ResearchWorkspace.jsx) | Run and inspect a bounded hypothesis |
| Analytics | [`AnalyticsWorkspace.jsx`](../foundation_v2/web/src/AnalyticsWorkspace.jsx) | Explain results, then expose exact records |
| Journal | [`JournalWorkspace.jsx`](../foundation_v2/web/src/JournalWorkspace.jsx) | Keep observations and decisions attached to context |
| Trade / risk | [`TradeWorkspace.jsx`](../foundation_v2/web/src/TradeWorkspace.jsx) and [`RiskWorkspace.jsx`](../foundation_v2/web/src/RiskWorkspace.jsx) | Draft and check a simulated order without implying broker submission |

Do not rewrite the existing Flask/React/Vite stack to match a reference
product. Reuse current routes, stores, chart adapters and semantic fixtures.
Promote a pattern to `D:\ANNAM\TradingWorkspace\UI` only after two real
consumers demonstrate the same contract and the shared versioning gate is
passed.

## 2. Product sentence and information order

The product helps a trader move from a bounded dataset to a reproducible
decision: **choose scope → replay evidence → draft risk → record the decision
→ review the result**. The chart is the main evidence surface, not a decoration
inside a dashboard.

Every decision-facing surface follows this order:

1. **Context** — what is being viewed: workspace, mode, instrument,
   timeframe, dataset/version, timezone, data quality, account/broker state,
   and the exact replay or report cutoff.
2. **Takeaway** — one sentence that states the current state or decision
   question. It may say that there is not enough evidence; it must not invent a
   conclusion from missing data.
3. **Evidence** — chart, metric, table or event marker that supports the
   takeaway. Values carry unit, scope, freshness and source.
4. **Drill-down** — exact trades, candles, rows, assumptions, revision,
   transformation and provenance available on demand.
5. **Action** — the next permitted step, such as step replay, open a source
   row, save a hypothesis, retry a failed read, or create a simulated draft.
   The action is disabled or omitted when its backend capability is absent.

This order is a semantic contract. A page may use a different visual layout
when the task requires it, but it must not hide context or put an action before
the evidence that makes the action safe.

### Route application

| Route | Context | Takeaway | Evidence and drill-down | Next action |
|---|---|---|---|---|
| Overview | workspace, data catalog, broker lock, holdout status | what can be continued now | queue and source status | open the exact next surface |
| Data | dataset, symbol/timeframe, source and QA range | whether the dataset is usable | quality report, gaps, hash and row details | select, retry or inspect |
| Practice | replay session, cursor, cutoff, branch and revision | what is known at this candle | candle chart, OHLC, levels and visible rows | step, pause, branch, journal or draft |
| Research | hypothesis, playbook/version, budget and requested range | run state and whether the result is comparable | metrics, assumptions, events and job records | review, cancel, compare or open replay |
| Analytics | result/session/attempt identity, scope and calculation version | the main result and its uncertainty | equity curve, metrics and exact ledger | inspect a trade, return to replay or export |
| Journal | session/trade/cutoff and note revision | what was observed, inferred and decided | linked chart snapshot and note history | edit a note, tag a setup or review evidence |
| Trade/Risk | mode, account scope, instrument spec and draft revision | whether the draft fits the stated risk | entry/SL/TP, size, fees and risk limits | save simulation draft; broker send stays gated |

## 3. Shell and composition rules

- Keep one stable shell: a narrow navigation rail, a context-bearing top bar,
  and a content area with a clear primary surface. Navigation labels describe
  work (`Practice`, `Research`, `Analytics`) rather than connectors.
- In Practice, give the chart the largest area. Attach replay controls to the
  chart and keep journal/risk/order context beside or below the same cutoff.
- Use flat-first composition. Spacing, typography and alignment establish
  grouping before a border, background, card or shadow. Do not nest cards just
  to make a page look complete.
- A panel may be visually quiet, but its state and scope must remain legible.
  Never remove the broker lock, replay/simulation mode or holdout state to gain
  visual space.
- One primary action per surface is enough. Secondary actions support the
  current job; unrelated routes belong in the shell or progressive disclosure.
- Preserve the user's identity when navigating: workspace, dataset/session,
  cursor, revision, filters and mode must either remain in the URL/state or be
  recoverable deterministically from an included ID.

## 4. Semantic tokens and visual language

The project consumes the pinned productivity token snapshot at
`foundation_v2/web/src/ui-system.snapshot.css`. Tokens are implementation
inputs, not permission to add arbitrary colors. New values first receive a
semantic role, then a theme value.

### Required semantic roles

| Role | Meaning | Display rule |
|---|---|---|
| `surface`, `surface-subtle`, `text`, `muted`, `border`, `focus` | neutral layout and interaction | use for hierarchy; do not encode profit/loss here |
| `accent`, `selected` | current route, selection or primary action | accent is never silently a profit signal |
| `profit`, `loss` | signed financial outcome | show sign, label and unit; color is supplementary |
| `warning`, `unknown`, `stale`, `error` | different data/state meanings | use text and icon/shape as well as color |
| `locked`, `simulation`, `replay`, `demo`, `live` | mode and capability | persistent label where an action or value could be confused |
| `chart-up`, `chart-down`, `chart-grid`, `chart-selection` | chart-only rendering | preserve contrast and do not reuse state colors without a legend |

Primitive values stay separate from semantic meaning. A theme may change hue,
but it must not change what `unknown`, `loss` or `locked` means.

### Type, spacing and numbers

- Reuse the existing font stack and verify Vietnamese glyphs before introducing
  a new font. Metadata is compact; body and table text remain readable at
  125–200% zoom.
- Keep a small spacing rhythm (`4/8/12/16/24/32/48px`) and use larger gaps to
  mark a new semantic group. Radius and shadow communicate grouping or
  elevation only.
- Use tabular numerals and right-align numeric columns. Show instrument
  precision, currency/unit, sign and gross/net scope next to the value.
- `unknown`, `unavailable`, `stale` and `N/A` remain distinct from numeric zero.
  Sort on source numbers, not on formatted strings.
- Vietnamese is the default UI language; retain a short English term in a
  label or tooltip when it is the established trading term (`Decision cutoff`,
  `R`, `holdout`).

## 5. Component and pattern contracts

Components are named by behavior, not by their visual wrapper. Each component
must declare its source, scope, and state before it is reused.

| Pattern | Required contract | Required edge behavior |
|---|---|---|
| `ContextBar` / `ScopeBar` | workspace, mode, instrument, timeframe, dataset/session, cutoff, timezone, freshness | missing context is visibly unknown; changing scope marks or reloads the affected data |
| `ChartPanel` | renderer, rows allowed at cutoff, selected candle/trade, overlays, source and timezone | never renders future rows; gap/partial data shows an explicit break or warning; planned levels differ from actual fills |
| `ReplayToolbar` | play/pause, step, speed, go-to, current cursor and revision | disabled at end/conflict/historical view; keyboard shortcuts never submit an order |
| `Takeaway` | one conclusion/question plus scope/source | no confident sentence when the source is incomplete; title may state the conclusion |
| `MetricValue` | label, value, unit, scope, N/range, source and freshness | no silent zero; derived values say they are derived and link to ledger/input |
| `EvidenceTable` | stable ID, time, unit, status, source/version, sorting/filtering | long data scrolls inside a region; export preserves precision and provenance |
| `SourceInspector` | dataset/provider, hash, row count, transform, exceptions, generated/known-at time | technical details are progressive disclosure, never fabricated; secrets stay hidden |
| `RiskPreview` | entry, SL, TP, size, instrument spec, cost basis, expected loss, mode | rounding and gap/slippage assumptions are visible; it only changes a draft |
| `ModeBanner` | replay/demo/live and account/capability scope | backend is authoritative; the UI cannot imply that a planned order was sent |
| `ContentState` | loading, empty, partial, stale, error, denied, unknown, conflict, success | each state explains why and offers a real action; do not show a dead `Retry` button |
| `NextAction` | one label, destination/action, reason and capability | action is unavailable when its precondition is missing; preserve context on return |

## 6. Data storytelling and visualization

The story is a trading decision, not a report ornament:

```text
scope/cutoff → takeaway → price/metric evidence → exact records → next step
```

- Candles, levels and event markers are the primary visual language for replay.
  An annotation is anchored by instrument, timeframe, timestamp, price,
  source/session, rule version and cutoff; screen pixels are only a render.
- Use a line or area series for equity/balance over time, a ranked table or
  horizontal bar for groups, a timeline for event order, and an exact table for
  audit or action. State the unit, sample size and calculation version.
- Add a chart only when it answers the decision question more clearly than the
  exact value/table. Keep one main takeaway per story and annotate the causal
  event or cutoff near the visual.
- Prefer progressive disclosure: summary first, exact rows and calculation
  details second, source/lineage inspector third. Active filters remain visible
  even when advanced controls are collapsed.
- Avoid pie/donut, gauges, radar, bubbles, treemap, dual-axis and decorative
  funnels by default. A different form needs a specific decision reason and a
  fixture that proves it stays readable.
- Do not connect missing price data with a smooth line or infer an outcome from
  a future suffix. If a value is derived from the ledger, label it as derived.

## 7. State, provenance and safety

The same semantic state must look and read consistently across routes:

| State | Meaning | UI behavior |
|---|---|---|
| Loading | request has not completed | preserve the stable layout; describe what is loading |
| Empty | valid scope has no records | explain what is missing and how to create/select it |
| Partial / stale | only part of the source is current or complete | show range/freshness and limit claims/actions |
| Error | request failed | show cause when safe and a tested recovery action |
| Denied / locked | capability or permission is absent | say what is locked and why; never make it look like a successful no-op |
| Unknown | source did not provide a value | show `unknown`/`N/A`, never `0` |
| Conflict | revision or lineage changed | stop mutation and require refresh/review; never silently rebase |
| Success / completed | operation reached a known end state | show source/cutoff and available follow-up |

Every displayed financial or analytical value carries a value envelope:

```text
value + unit/currency + gross/net + mode/source + freshness + scope
```

At minimum, a replay/report inspector can recover:

```text
workspace, dataset_id, dataset revision/hash, provider, instrument,
timeframe, timezone, observed range, row count, quality status,
session/replay id, cursor and cutoff, branch/parent, calculation version,
generated/known-at time, and exception list
```

Safety rules are non-negotiable:

- `REPLAY`, `SIMULATION`, `DEMO` and `LIVE` are distinct labels. The current
  UI defaults to replay/simulation and keeps broker send locked.
- A planned order, simulated fill, broker-submitted order and actual fill have
  different labels and visual treatment. Drawing or saving a draft never sends
  an order.
- Holdout data remains closed to preview, search and AI context unless the
  approved protocol explicitly opens it. A lock banner is not a substitute for
  backend enforcement.
- A connection loss leaves position/order status unknown or stale; it never
  fabricates a close or a zero balance.
- The UI cannot widen provider, OAuth, cost, account, live-broker or holdout
  scope. Backend capability checks remain the authority.

## 8. Responsive, accessibility and motion

Validate representative widths of **360, 768 and 1440 CSS px**, plus 125–200%
zoom. The layout may recompose, but the semantic order and safety labels stay
the same:

- desktop: chart dominant, decision/risk context in a side region, exact data
  below or behind a deliberate drill-down;
- tablet: chart remains primary; secondary panels stack or become a tab/strip;
- mobile: chart uses the main viewport, context remains in a compact bar, and
  journal/risk/table details use a bottom sheet or scroll region. Never hide the
  cutoff, mode or broker lock to fit the width.

Keyboard focus, visible labels, semantic table headings, reduced-motion support
and non-color state cues are part of the contract. Icons alone do not explain a
warning or an action.

Motion communicates continuity or feedback:

- replay stepping may move the cursor/visible bar so the time change is clear;
- selection, panel opening, save and state changes may use short, reversible
  transitions;
- do not animate numbers to imply precision, autoplay a chart without an
  explicit replay action, or add decorative motion to fill empty space;
- respect `prefers-reduced-motion` by removing nonessential movement while
  keeping state feedback available in text/shape/focus.

## 9. Implementation and acceptance

Implement vertical slices in the existing React/Vite surface. For each slice,
review the diff against this contract and run focused browser checks using the
scripts in `foundation_v2/web/` (for example
`run_replay_ui_acceptance.mjs`, `run_ui_acceptance.mjs` and the route-specific
acceptance scripts). Visual QA must cover:

1. chart/replay at 360/768/1440;
2. loading, empty, error, stale/partial, denied/locked and revision conflict;
3. exact report→replay identity and back/forward context;
4. keyboard/focus, long tables, Vietnamese glyphs and reduced motion;
5. fixture values, units, provenance and no-future-leak semantics.

Build/test success is necessary but not sufficient. Browser runtime behavior is
the acceptance authority for layout and interaction; screenshot-only output is
evidence, not approval.

## 10. Explicit non-copies

The historical GTAS project is a source of tested decisions, not a template.
Do **not** copy:

- Blazor/Radzen component markup, lifecycle patterns, CSS ownership files or
  business-domain layouts;
- GTAS product language, office/procurement roles, PPJ/denim assets, login
  imagery or brand marks;
- its exact token values, animation durations, route names, DOM classes or
  screenshot composition;
- a universal page wrapper or a card wall simply because it is reusable;
- dashboard charts that do not answer a trading decision;
- FX Replay/TradingView proprietary assets, branding or implementation code.

What is intentionally carried forward is the reasoning: one clear question,
evidence before action, progressive disclosure, complete states, restrained
semantic motion, browser-runtime QA and explicit provenance.
