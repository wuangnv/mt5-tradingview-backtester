# Dashboard KPI and session refinement — 07/10/2026

Scope: the four Dashboard comments about empty expansion, Summary typography,
remaining-days alignment/color and FX-style KPI/report presentation.

## Implementation

- Dashboard-only empty expansion drops the old 64px text minimum; the complete
  empty panel is 39.5px on desktop and 33.5px on small screens, instead of 84px.
- Summary uses the existing compact 32px action height (44px mobile/coarse),
  13px/500 text and the shell's system-font fallback. No text transform is used.
- Remaining-days text is centered on the adjacent action row, with a sea-blue
  progress track above it. Existing cursor/dataset calculations remain intact.
- KPI values use a consistent hierarchy with small baseline-aligned duration
  units. Demo duration fields are typed seconds. Actual unknown time stays “—”.
  There are no information icons.
- Win/loss/breakeven supporting bars use the existing closed-trade aggregate.
  No Buy/Sell percentage or measured activity time is invented. Monthly activity
  remains labeled closed-trade counts because recorded practice time is absent.
- Monthly counts, win rates and symbol counts use solid report peach, blue and
  violet. Zero bars have zero area; counts use integral tick steps, win rates use
  20% ticks. Dashed gridlines match the numeric axis.
- Axis and bars share the native scroll container; the axis stays sticky while
  scrolling. This fixes the 15px axis/grid mismatch independently found on 360px
  screens with visible native scrollbars. No scrollbar is hidden.

The app still uses the same overview/session GET data and existing loading,
retry, stale, blocked, partial and scope transitions. No backend write, broker
operation, dependency, trading/vendor-chart change or API-schema migration.

## Verification

Root: production build, 16 focused web model tests and 10 backend aggregate tests
passed. `primary/verify.mjs` passed 32 real/demo × EN/VI × dark/light ×
360/768/1440/1710 cases, with keyboard expand/collapse, Summary sizing,
remaining-days optical alignment, empty/populated panels and overflow checks.
Desktop and mobile screenshots were inspected. A focused native-scroll probe
confirmed identical tick/grid positions and an unchanged sticky-axis X position.

Independent review evidence lives in `independent/`. Failed/source-crossed
attempts are diagnostic, not acceptance evidence; the final receipt identifies
the stable source hashes and results. The frozen layout run passed 26 route/viewport
cases and 14 synthetic edge-state cases. A final subtitle-only correction then
passed 8 duration-copy cases; combined review includes 14 Axe scans without
violations. Actual measured zero/positive duration now says “Recorded time”,
while null/invalid values retain missing-data copy. Root verified the final
receipt source hashes against current files. Actual data evidence is read-only from
the running local service. Intercepted edge states are explicitly synthetic.
This checkpoint does not close whole-product, broker or canonical-golden gates.

Runtime remains at http://127.0.0.1:5180/.
