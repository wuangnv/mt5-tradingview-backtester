# Vintage project palette — 06/10/2026

Scope: owner-approved colors across the MT5 `foundation_v2/web` project, both
themes and both chart engines. Existing layout, sizing, data contracts and
text-only header navigation hover are preserved. This receipt does not close
broker/provider or whole-product gates.

## Change and ownership

- `public/project-palette.css` owns primitive values; the app and chart iframe
  consume the same file. Existing WM/FX/UI roles alias those values rather than
  introduce another shared-system release.
- Sea blue owns primary actions/series/focus, peach owns secondary highlights,
  sage/rose own positive/negative values, with ivory text and warm-paper light
  surfaces. Light foregrounds and dark rose were adjusted for small-text contrast.
- Lazy route theme overrides now use project roles. Chart theme changes repaint
  candles, volume, order overlays and application-owned annotation shapes, including
  layouts restored from local storage. Saved native drawing choices remain separate.
- Demo and actual state/data paths remain distinct. Session metric info icons
  were removed in a separate checkpoint commit `0d89645`; detail remains in the label title.

## Validation

- Final Vite production build passed. Public palette is copied into `dist`.
- 29 focused chart/annotation/storage/order/drawing unit tests passed, plus the
  updated palette contrast test (30 total). The contrast oracle requires4.5:1
  for small content/semantic text on canvas, surface, raised, control and hover,
  plus filled primary/positive/negative action foregrounds in both themes.
- Primary scan:14 route variants ×2themes, lazy skeletons resolved, no page
  errors or document overflow at1377px. `primary/scan.mjs` and `scan.json` record
  computed colors and loaded-page captures.
- Independent final route review:38 cases and16 same-page demo→actual→demo
  cascade cases passed. Desktop/mobile exploration is retained separately;
  its original light Analytics contrast failure was repaired and rechecked.
- Independent final chart review:8 cases, lightweight/advanced ×dark/light
  ×1377/360px. Real canvas pixels prove palette background/up/down/primary
  before and after the UI theme toggle. Advanced Volume/imported annotations
  were also visually reviewed. Synthetic chart data stays labeled and isolated.
- Tests permitted only local GET/HEAD/OPTIONS and explicitly labeled intercepted
  chart fixtures. No API mutations, broker actions, provider refresh or data deletion.

Independent review details and source fingerprints live under `independent/`.
The user’s open Dashboard was inspected: dark theme resolves canvas `#171C20`,
primary `#8FAFC1`, text `#ECE9E2`. UI remains available at `http://127.0.0.1:5180`.

## Limits

This is palette acceptance for representative actual/demo/empty/unavailable views,
not financial or broker acceptance. The chart harness verifies loaded synthetic
rows and visual theme behavior; native saved drawing preservation is established
by ownership review, without executing a write scenario on the actual API.
