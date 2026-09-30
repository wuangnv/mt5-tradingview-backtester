# WMREPLAY design context for Figma Make

This repository is the MT5 backtesting and replay product that is being
redesigned in Figma Make. Read this file as product context and a map of the
source. It is not a visual specification and it does not constrain the design
direction.

## Design objective

Explore the strongest possible product and interface direction for a serious
FX replay, backtesting and trading-review workspace. The current UI is a
starting point only. Figma Make may replace the navigation model, page
hierarchy, shell, typography, color system, layout, density, chart framing,
interaction model and responsive behavior.

The design should feel deliberate and useful for repeated chart replay, review
and research. It may be radically different from the existing screens. Study
the product behavior first, then propose several coherent directions and
develop the strongest one into a complete product surface.

## Product in one paragraph

WMREPLAY is a local-first MT5 trading workspace for deliberate market replay,
manual backtesting, research, journaling, analytics and risk review. The user
starts with a local dataset, opens a replay session, advances through bars,
records decisions and annotations, evaluates a playbook or research run, then
reviews the result in journal, analytics and risk surfaces. Broker and live
execution capability is intentionally guarded and is not the product's default
workflow.

## Source priority

Use these sources in this order when they disagree:

1. `foundation_v2/web/src/` — current React/Vite product UI and route entry.
2. `foundation_v2/trading_workspace_v2/` — current PATH-2 backend contracts,
   state boundaries and API semantics.
3. `foundation_v2/README.md` and
   `foundation_v2/project-session-contract.md` — foundation behavior and
   local/demo capability boundaries.
4. Root `README.md` — product history and legacy Flask reference. It describes
   useful domain behavior, but it is not the visual or frontend authority.
5. `ui/` and the existing CSS — implementation history and reference only;
   they are not a requirement to preserve the current visual language.

## Main screens and source map

| Product surface | Route value | Primary source |
| --- | --- | --- |
| Overview / session home | `overview` | `foundation_v2/web/src/main.jsx` |
| Data Desk | `data` | `foundation_v2/web/src/DataDeskWorkspace.jsx` |
| Practice / replay chart | `replay` | `foundation_v2/web/src/ReplayWorkspace.jsx` |
| Research | `research` | `foundation_v2/web/src/ResearchWorkspace.jsx` |
| Journal | `journal` | `foundation_v2/web/src/JournalWorkspace.jsx` |
| Analytics | `analytics` | `foundation_v2/web/src/AnalyticsWorkspace.jsx` |
| Risk | `risk` | `foundation_v2/web/src/RiskWorkspace.jsx` |
| Playbook | `playbook` | `foundation_v2/web/src/PlaybookWorkspace.jsx` |
| Trade Desk / simulator | `trade` | `foundation_v2/web/src/TradeWorkspace.jsx` |
| Learn | `learn` | `foundation_v2/web/src/LearnWorkspace.jsx` |
| Settings and connectors | `settings` | `foundation_v2/web/src/SettingsWorkspace.jsx`, `NotionConnector.jsx` |

The application shell and current language/theme controls are in
`foundation_v2/web/src/FxReplayShell.jsx` and the paired `fx-shell-*.css`
files. Shared route and replay context parsing is in
`foundation_v2/web/src/workspaceContext.js`.

## Core workflow to understand

1. Select or import a local dataset in Data Desk.
2. Open a replay session in Practice.
3. Move through the chart by cursor/bar and record decisions or annotations.
4. Keep the dataset, replay cursor, cutoff and provenance visible enough to
   support trustworthy review.
5. Link decisions to Journal, Playbook and Research where the current source
   supports that context.
6. Review closed results in Analytics and inspect hypothetical or blocked risk
   states in Risk.
7. Use Trade Desk only within its guarded simulator/demo boundary.

The URL carries a canonical local context such as `workspace`, `view`,
`session`, `dataset`, `cursor`, `cutoff` and `mode`. The workspace identifier is
an internal routing/API context. It does not need to be presented as a product
brand or prominent visible label in the new UI.

## Facts the redesign must keep truthful

- Unknown, missing, stale and blocked data must remain distinguishable from a
  valid zero or successful result.
- Replay decisions and research results are not broker orders.
- Current foundation execution capability is fail-closed; the design must not
  imply that a live order was sent unless a later, separately authorized
  capability says so.
- Provenance, dataset identity, cutoff and cost assumptions matter to research
  and review, even if their presentation is redesigned completely.
- Local/demo session and provider connector contracts are not production login
  or account-management contracts.

These are product truths, not constraints on typography, composition,
navigation style or visual expression.

## What to explore freely

Consider multiple alternatives for:

- a chart-first replay workspace;
- navigation and information architecture;
- a command palette or contextual tool surfaces;
- dataset and provenance onboarding;
- replay controls and decision capture;
- journal/playbook/research linkage;
- analytics storytelling and risk explanation;
- empty, loading, blocked, error and stale states;
- desktop, tablet and mobile layouts;
- light/dark themes, motion and density;
- brand and wordmark treatment for WMREPLAY.

Do not preserve the existing sidebar, header, card structure or color palette
just because they exist. Treat them as evidence of the current implementation,
not as an approved design system.

## Figma Make working request

First inspect the source and explain the product model you inferred. Then
produce several materially different product directions. Develop the strongest
direction into a connected set of screens rather than a single isolated
landing page. Show interaction states and responsive variants where the
workflow needs them. Keep labels and data examples grounded in the domain, but
make the visual and information-architecture decisions independently.

The eventual implementation will be brought back into this repository by an
engineer. Keep enough interaction and route intent visible that the design can
be mapped back to the source later.

## Files intentionally excluded from the Figma source handoff

Do not use or expose local account presets, runtime state, downloaded market
data, private logs, or proprietary charting-library files. In particular, do
not add `*.ini`, `*.log`, `data/`, `foundation_v2/runtime/`, `.venv/` or local
`charting_library/` contents to a design prompt. They are machine/account
state, not product design context.
