# MT5 project UI

Project-specific UI configuration for the PATH-2 React/WMReplay implementation in
[`foundation_v2/web/`](../foundation_v2/web/).

This layer sits below:

- `D:\ANNAM\UI-Systems` — product-agnostic foundations;
- `D:\ANNAM\TradingWorkspace\UI` — reusable trading-domain contracts.

## Current state

Status: **implementation in progress; partial local validation**.

The active review entry is [`foundation_v2/web/index.html`](../foundation_v2/web/index.html),
served by Vite, with route/state behavior owned by
[`FxReplayShell.jsx`](../foundation_v2/web/src/FxReplayShell.jsx) and its workspace components.
See the [root README](../README.md) for setup and the authoritative workspace plans.

`project-ui.json` records current routes and the outstanding UI acceptance gates.
`SHELL_SKELETON_MODE` remains enabled. Native zoom, axe/WCAG, canonical golden,
long-duration memory and full-bleed promotion remain open; metadata validation does
not close these product gates.

The static U1 previews remain historical exploration references, not the active UI.
The owner delegated UI direction and acceptance to agents on 23/09/2026; independent
review and runnable visual/interaction QA are required.

Shared token pins retain their explicit partial scope, and
`approvedForProductionPropagation` remains `false`.

