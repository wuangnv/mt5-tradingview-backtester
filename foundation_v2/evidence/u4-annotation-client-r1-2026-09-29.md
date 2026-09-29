# U4 annotation client seam — r1

This receipt records a focused, offline-safe U4 slice.  The web client now has
a typed boundary for chart annotation drafts and the existing local annotation
API.  It validates time/price anchors, keeps every anchor at or before the
replay cutoff, bounds payload sizes, and preserves optimistic revision guards.

## Scope

- `web/src/chartAnnotations.js` normalizes the eight annotation types already
  declared by the foundation contract.
- `createChartAnnotation`, `listChartAnnotations`, and
  `reviseChartAnnotation` send workspace-scoped requests to the existing local
  `/api/v2/chart/annotations` endpoints.
- API errors remain errors; the helper never calls a broker, provider, OAuth
  endpoint, or holdout dataset.
- The module is intentionally renderer-neutral.  It does not pretend to draw
  pixels or enable the disabled Practice CTA until the chart gesture can bind a
  real candle/price anchor.

## Validation

```text
cd foundation_v2/web
node --test tests/chartAnnotations.test.mjs
npm run build
```

The focused Node test covers normalization, cutoff rejection, unknown-field and
anchor bounds, workspace headers, revision payloads, and HTTP error handling.
The browser integration remains a follow-up for the P6 chart-first workbench;
this seam is the contract it should consume.

## Remaining U4 gap

Practice still needs a chart gesture/toolbar that supplies real anchors and a
visual renderer for persisted annotations.  Enabling `Vẽ vùng` with a guessed
price or pixel-only coordinates would weaken provenance, so that UI remains
locked until the P6 chart selection state is integrated.
