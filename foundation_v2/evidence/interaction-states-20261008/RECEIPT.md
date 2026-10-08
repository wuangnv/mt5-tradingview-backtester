# Interaction role consistency — 08/10/2026

Owner request: audit inconsistent hover/borders, especially Data Library actions
merging into row hover. Implementation stays in the project's foundation_v2 UI.

The shared interaction sheet now separates row hover/selection from control hover.
Explicit action roles replace the broad all-button/link hover rules. Table/session
actions are transparent at rest and receive their own hover/open surface, while
toolbar/dialog secondary actions remain filled neutral. Borders reserve their
geometry; pointer hover does not introduce an outline. Keyboard focus, field/open
indications, peach primary actions, red/white destructive actions and text-link
exceptions keep their intended semantics. Compact ellipsis actions use 32/44px
circles. The project contract in ui/testing-standard.md records those roles.

There is no React, API, persistent state or download behavior change. Theme tokens
feed shared interaction roles; route CSS may specialize component geometry but
cannot collapse row/action states through broad hover selectors. Scoped selectors
also keep their behavior when lazy route chunks load in a different order.

Validation:

- Production Vite build passed after the final source edits; git diff --check passed.
- Independent browser QA passed 7 cases: dark/light at 1710/768/360px with labeled
  Library fixtures and Dashboard/Trades demo, plus actual local GET-only catalog.
- Additional actual-only paused-progress check passed without changing the job.
- Reviewed final dark/light desktop Library, Dashboard dialog and actual paused
  progress screenshots. Independent review also inspected mobile and Trades.
- No page errors or write requests. See independent/REVIEW.md and JSON reports;
  representative screenshots are committed, and qa.mjs reproduces the full matrix.

Trade-off: consistency follows action meaning instead of making every button
look identical. Form fields, semantic actions and vendor chart controls retain
deliberate differences. This is scoped UI acceptance; native TradingView internals
and live/broker behavior were not exercised.
