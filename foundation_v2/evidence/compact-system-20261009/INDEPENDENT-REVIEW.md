# Independent Compact UI review — 09/10/2026

Reviewer: independent `compact_ui_review` agent. Scope: shared compact candidate/exporter, project CSS adapters, component reference and the create/edit session controls. No source edits, API mutation, provider downloads, broker action or Git commit were performed by the reviewer.

## Verification

Read source/diff and the candidate contract plus `ui/compact-system.md`. Ran separate headless Playwright diagnostics against the Vite app on port5180. All non-GET API requests were aborted. The create-session keyboard checks used a clearly identified intercepted GET dataset fixture; edit-session checks used the app's demo session. Checked dark/light desktop1710×987, narrow360×987 with mouse and coarse/touch, and reduced motion1440×987.

| Check | Observed result |
| --- | --- |
| Neutral button hover, dark | `rgb(61,65,72)` = `#3D4148`; height36px before/after |
| Neutral button hover, light | `rgb(221,225,231)` = `#DDE1E7`; height36px before/after |
| Hover timing | Four color/border/shadow transitions at120ms |
| Quick-session strategy keyboard focus | `:focus-visible=true`,2px blue outline and blue boundary in both themes |
| Asset composite keyboard focus | Outer boundary blue in both themes; see remaining duplicate-cue finding below |
| Session-settings field | Height36px, radius8px, font13px, blue keyboard-focus boundary in both themes |
| Session-settings save control | Height36px |
| Checkbox/radio/switch label at360px | All four rows44px, with mouse and with touch |
| Reduced-motion sample dialog | Animation `none`, close transition `0s` |
| Typed token helper tests |2/2 passed: existing strings/typed aliases and malformed/cyclic/missing token rejection |

The three initial findings (gray select focus,42px settings fields/save,32px coarse choice labels) are resolved. The new hover is neutral and distinct from the row surfaces; it does not reuse the rejected muddy blue fill.

## Remaining consistency findings

1. **Composite asset focus duplicates the cue.** The asset tag field now has a blue outer boundary, while its inner dropdown trigger also gets a2px blue outline from `quick-session.css`. Runtime confirmed both cues in dark/light. The project standard explicitly says not to stack two focus indicators. Keep the outer composite focus boundary and suppress the inner trigger outline specifically within the tag-field; preserve keyboard focus on standalone selects. This is a scoped visual issue, not a missing-focus regression.

2. **Narrow mouse exception is undocumented.** The project table column says “Cảm ứng / màn nhỏ” and gives44px for dialog tabs and icon controls. At360px with a mouse, actual session tabs remain28px and the dialog X32px; with touch they become44px. Earlier compact desktop behavior can be retained, but the standard should explicitly distinguish pointer mode for these controls instead of claiming that all narrow viewports use44px.

## Contract and scope review

The root contract labels Compact0.1.0 as an opt-in candidate and keeps old productivity pins unchanged. Project metadata contains a separate compact pin/hash. Future component contracts are described as design defaults, not implemented placeholder components. Project documentation explicitly distinguishes foundation adoption from whole-product/workflow acceptance, preserves chart/vendor exceptions and avoids an unverified Apple-equivalent60fps claim. No broader architecture or permission-contract regression was found in the reviewed source.

This review is focused UI evidence. It does not verify all routes, full download/replay/Prop behavior, native browser zoom, every chart/vendor control, full accessibility acceptance or heavy-chart frame pacing. The main acceptance receipt must retain those limits.

Verdict: initial blockers resolved; complete the two focused consistency fixes or document their intended exception before describing the compact specimens as internally consistent.

## Final resolution check

Both remaining findings were addressed by the implementing agent and independently rechecked:

- `quick-session.css` now suppresses the focus outline specifically on the asset tag-field's inner trigger. A fresh GET-only Playwright keyboard journey confirms `:focus-visible=true`, inner outline `none`, and one outer blue boundary: `rgb(112,181,255)` dark / `rgb(36,102,172)` light. Standalone-select focus rules remain intact.
- `ui/compact-system.md` explicitly documents narrow mouse behavior: session-type tabs28px and X32px; coarse/touch44px. This matches the independently observed geometry rather than changing established compact mouse behavior.

The main acceptance artifact now records20 passing cases and no page errors. That artifact is the implementer's broader evidence, separate from this reviewer's focused browser checks.

Final verdict: no unresolved findings in the reviewed scope. Scoped Compact foundation/control acceptance is supported; the broader workflow, vendor, zoom/accessibility and performance limits listed above remain.
