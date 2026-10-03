# Independent component audit review — 03/10/2026

Verdict: **SCOPED_ACCEPT** for the component audit changes. No remaining blocking issue found in the inspected source and final evidence. This is scoped UI acceptance, not whole-product, broker, golden-image or global design-system acceptance.

Reviewer: support_patterns. Reviewed source, test harness, reports and selected captures; no product edits, suite reruns, backend writes, personal-browser inspection or commits.

## Source and behavior

Reviewed the diffs for component-interactions.css, ReplayObjects.jsx, ReplayWorkspace.jsx/CSS, PlaybookWorkspace.jsx, SettingsWorkspace.jsx/CSS and fx-shell-preferences.css.

- Disabled input/textarea state is visible and uses not-allowed cursor; keyboard focus covers scrollable region/table components. Chart overlay labels reflect checkbox state and show keyboard focus. Object buttons use stable Hiển thị/Khóa names with pressed state derived from existing hidden/locked preferences.
- Replay play/pause and viewport range choices are action buttons. Range commands no longer imply a retained selection after pan/zoom/latest. The side-panel opener names its actual destination and exposes expanded/controls state.
- Default crosshair avoids accidental drawing drafts. The empty annotation wrapper is omitted in cross mode; choosing a drawing tool exposes the real draft hint. Sidebar actions have separate rows with at least 44px targets.
- Playbook detail selection uses pressed state; loading/error is not advertised as an empty catalog or zero count. Reviewer identified the remaining empty-catalog “Chọn một playbook” prompt; the final guard now omits it when no items exist.
- Settings retains its existing appearance draft/apply/store flow, while removing duplicate session loading, footer facts and the duplicate Learn return link. Removed chart-menu CSS has no matching JSX consumers. Unnecessary active-button translation is removed.

No provider/broker/backend contract changed. Visibility/lock preferences and appearance are browser-local; replay annotation fixtures are explicitly labeled and do not write to a backend.

## Evidence inspected

Final source hash: `de28829cb7d722774c9e5a8ce8e806ef7cf9b6d8c053ad03a140fe08776c1d7b`.

- Read interactions-final5/report.json: PASS, six cases (dark/light at 1440/390/320px), 30 captures, no page errors, blocked requests or reported axe violations. Reviewed its harness assertions for appearance save/cancel/reload, catalog states, overlays, stable object states/reload, cross mode, sidebar links and keyboard ledger focus. Analytics oracle now targets the real metric structure, known 75 value and USD unit; this harness does not separately assert the 60-trade count.
- Visually inspected final5 objects-locked-dark-320, objects-visible-dark-390, objects-locked-light-390, objects-visible-light-1440/320, settings-dark-320, settings-light-390/320, playbook-selected-light-320 and ledger-focus-dark-390. Themes, disabled fields, selected states and narrow layouts are readable in these captures; saved drawing becomes visible on the chart after show/unlock.
- Read routes-final2/report.json: 144 cases SCOPED_PASS, no failures, source before/after stable at `bd54ce7973ca6b28f76d3178bf44a7780192aada075e306f9f72211c230f0610`. Read zoom-final2/report.json: 24 cases SCOPED_PASS at that same hash. The final product delta after those runs is only the Playbook empty prompt guard.
- Read playbook-final/report.json: eight focused replacement cases SCOPED_PASS, stable final de28829c hash. Read playbook-zoom-final/report.json: six focused zoom replacements SCOPED_PASS at that final hash. Inspected playbook-final light320 and dark1440 to confirm the misleading choose prompt is gone.
- Earlier replay-final captures were inspected as historical context but are not used to prove final default-cross behavior. Final5 source/harness/captures supersede them. Read build-final3.txt (81 modules, successful build) and unit-final3.txt (80 passed, zero failed); no build/test rerun by reviewer.

## Failed evidence and limits

interactions-final3 and final4 remain FAIL: their Analytics metric selectors expected a combined text or an article while the actual component uses dl/dt/dd. Other earlier failures, including initial-tool assumptions, pointer/focus modality, preference-reset harness behavior, genuine watchlist contrast failure and source-drift rejection, are retained rather than relabeled. The final report and focused source replacements establish the reviewed result.

No cross-engine runtime or full WCAG certification is claimed. Axe checks and computed focus assertions cover their tested scope; screenshots do not independently establish all keyboard or finance behavior. The 144-route scan was not rerun wholesale for the final single guard; its affected Playbook route and zoom cases were replaced at the final hash. Broader product/runtime/broker gates remain with their existing owners.
