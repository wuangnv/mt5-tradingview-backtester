# Independent Compact states follow-up review — 09/10/2026

Reviewer: `compact_ui_review`, independent of implementation. Only source/diff review and read-only browser diagnostics were performed. Browser blocked all non-GET API requests. No downloads, broker operations, source edits or commits.

## Latest scope and version

Owner rejected the proposed leading orange selection marker while review was running. Final scope therefore uses neutral selected rows **without** a leading marker. Runtime confirms dark `#1C1C1C`, light `#F0F0F0`, and no first-cell box-shadow. Switch enabled uses blue; success/financial gain retains green.

Shared Compact0.1.0 source has no diff. Consumer explicitly pins opt-in0.1.1, with snapshot/hash `efbdc8301a23e6c32b93feb461f5126911665db00721a6d2249c8011c3a33c43`. Source/snapshot semantics agree.

## Independent browser checks

| Check | Result |
| --- | --- |
| Selected reference row dark/light | Neutral exact values above, marker absent |
| Switch enabled dark/light | Blue `rgb(112,181,255)` / `rgb(36,102,172)` |
| Switch disabled dark/light | Muted neutral `rgb(184,192,201)` / `rgb(80,89,101)` |
| Native and menu checkbox geometry |16×16px,2px corners, identical120ms background/border timing and standard curve |
| Native and menu checked mark | Same SVG mask; native input and ARIA menu behavior retained |
| Mixed “select all” specimen | `aria-checked=mixed`, `.is-mixed`, visible2px horizontal mark |
| Real demo trade-session filter mixed state | `aria-checked=mixed`, `.is-mixed`,8×2px mark; regression fixed |
| Reference field keyboard focus | One blue border, outline `none`, shadow `none`, in dark/light |
| State source empty/loading/error | One owning status/alert; loading sets `aria-busy=true`; dependent result headings absent |
| Session exists, no closed trades | Session context retained, one results empty message |
| Chart same-session independent step error | Session/results context retained, one local chart alert/retry |
| Report chart sample | Explicit illustrative label; points/axes agree with2,4,3,6 records |
| Report sample360px | No page horizontal overflow; readable12px external labels replace compressed SVG labels |

Desktop checks used1440×987; mobile checks360×987 coarse input. Dark/light scope was exercised independently, not inferred from token source. A first attempt to locate multiple-session select-all on Analytics timed out because that route uses a single-session filter; the correct demo Trade route was then exercised successfully. This diagnostic mismatch was not a product defect.

## Findings and resolutions

1. Initial sample described a chart as an independent source but hid it when session data was absent. Final wording explicitly says all illustrated result groups require the same session and only the chart read/calculation step is independent. Non-session sources remain outside this owner. This resolves the apparent contradiction with shared data-state ownership.
2. Initial native/custom checkbox styling hid SessionFilter's text-based mixed mark because font-size became0. Implementation added `.is-mixed` to the sibling SessionFilter select-all. A fresh demo Trade interaction confirms the mixed bar is visible and ARIA state remains correct.
3. The proposed leading selection marker was removed after owner steering. Review and final acceptance must describe neutral-only selection, not the abandoned marker.

No unresolved source/state/geometry finding remains in this follow-up scope. Project documentation correctly calls KPI/card/report contracts and state ownership **standards plus specimens**, and expressly says Dashboard ownership and all report renderers have not been migrated. No real Dashboard data-flow source change appears in this diff. Shared availability, freshness and certainty contracts are reused without extending broker/provider authority.

## Limits

This is scoped acceptance of the updated tokens, reference controls, focus, state specimen and report specimen. It does not certify all app workflows, all charts/legends/tooltips, provider download progress, native zoom, full accessibility, chart frame pacing or whole-product acceptance. KPI typography and adapters are only partially migrated as recorded in project documentation.
