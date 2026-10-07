# Independent quantity hover review — 2026-10-07

PASS on the LegacyTradingBar.css SHA-256 recorded in `quantity-hover-review.json`.

Eight isolated browser cases passed: dark/light at 1368×790 and 360×844, each with the actual enabled controls and a response-only historical-view fixture that disables controls. Local GETs only; activity requests receive nonpersistent matching receipts, other writes/external requests blocked, WebSockets closed. No reviewer source edits/commits, owner replay/order changes or external FX actions.

Input hover preserves transparent parent/input backgrounds and the existing border. Both arrows stay transparent while the input is hovered. Hovering either enabled arrow colors only that arrow; computed gray matches project-hover (#2A2A2A dark, #EBEBEB light), while the other arrow and input/parent remain transparent. Disabled arrows stay transparent under hover.

Each arrow is 24×14px, fills its entire half of the right cell with zero padding/radius, and touches the adjacent arrow with no gap. The right cell aligns to the pill's inner top/right/bottom edges; the existing outer overflow clip preserves its rounded silhouette. Input and both arrow keyboard focus show one outer 2px focus edge at offset −2px, with no inner outline.

`quantity-hover-review.mjs` is the guarded runner; the JSON records computed styles, cell geometry, focus and source hash. Eight screenshots are retained. Desktop dark enabled, mobile light enabled and mobile dark disabled screenshots were inspected directly. Final page errors and unexpected blocked requests are empty.

This receipt covers hover, cell geometry and focus only. It does not exercise order execution or increment/decrement values. The historical fixture is browser-response data, separate from owner data. Earlier consistency tests expecting the whole quantity group to fill gray are obsolete for this owner-requested behavior.
