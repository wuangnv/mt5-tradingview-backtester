# Dialog form fields — 09/10/2026

Compared the actual local UI Reference and create-session dialog before changing
styles. Reference textbox hover was overridden by its base field rule; composite
balance/asset boundaries lacked hover, and balance was 38px rather than 36px.

Shared `is-field` now owns form dropdown states: reserved 1px border, 8px corners,
neutral rest/stronger hover, blue focus or open. Filter pills retain their own role.
Composite fields use one outer boundary. The balance child reserves its parent's
2px border; all enabled single-line form boundaries now measure 36px. Disabled
layout has no enabled hover. Search keeps its shared underline pattern.

Actual browser checks: 16 dialog cases (seven enabled fields plus disabled layout,
dark/light), eight UI Reference field cases, and four search regressions at
1710/1440px. All pass with zero page errors or backend writes. Advanced inputs,
strategy creation name, filter/clear and Escape focus return were exercised.
See baseline/candidate receipts, reference JSON and candidate screenshots.

Independent review found the balance height issue, then confirmed the corrected
36px receipt and CSS ownership with no further material finding. Final Vite
production build passed. This is focused UI acceptance, not a whole-product gate.
Local probes remain in `web/.runtime/asset-search/`.
