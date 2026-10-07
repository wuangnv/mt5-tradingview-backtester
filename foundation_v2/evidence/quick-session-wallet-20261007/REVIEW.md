# Independent always-grouped balance review — 2026-10-07

PASS eight focused browser cases: dark/light × 360/1710 px × USD/EUR. USD uses actual local catalog reads; EUR changes account currency only in an isolated fetched catalog response. Eight replay POSTs were intercepted and answered 422 before persistence. No source edits or real writes.

This final receipt supersedes `intermediate-raw-focus/REVIEW.md` and the literal `$` presentation in `quick-session-unit-20261007/REVIEW.md`. Historical raw-focus screenshots/results remain under `intermediate-raw-focus/`.

The existing wallet ChartIcon replaces the dollar glyph at 18×18 px. Its 1 px divider spans the full 40 px field interior (top/bottom 0), touching the outer border. Amount is 14 px/500, currency 12 px/muted and adjacent to the editable number. The unit is selected dataset account currency with USD fallback; `aria-describedby` resolves to that suffix. The wallet is aria-hidden.

Verified behavior:

- `100,000` and `25,000.75` remain grouped on focus and blur; no raw/grouped visual jump. Clicking the field's blank right region focuses the input without changing display. Tab navigation applies no display change.
- Typing sequentially yields `12,345.67` with the caret at the end. Middle insertion `12,345.67 → 129,345.67` preserves caret after inserted digit. Selection replacement, including a range crossing the comma, produces the expected value and caret.
- Backspace immediately after a comma and Delete immediately before it remove the neighboring digit, rather than getting stuck recreating the separator. A second comma boundary and decimal-point deletion were tested. Invalid extra decimal insertion preserves the preceding valid amount.
- Grouped whole-value insertion through browser `insertText('25,000.75')` yields grouped display while draft/request stays raw. This verifies the paste-equivalent input stream, not operating-system clipboard permission.
- Empty, zero, lone dot and `0.` disable creation. Letters, negative values, scientific notation and more than two cents digits are rejected without changing the preceding valid amount. No request occurs during edits. Each final intercepted body carries raw `starting_balance: "25000.75"` and workspace `tenant-a`, never grouped display text.
- Focus retains one neutral outer contour (#FFFFFF dark / #111111 light); input has zero border and no outline/shadow. Wallet divider remains the only internal line. Unit and amount stay inside the field with no page horizontal overflow. Representative dark/mobile and light/desktop screenshots were inspected.
- Strategy action keeps the exact same orange at rest and hover with transparent background.

The input now uses text/decimal-keyboard semantics so arrows navigate text rather than increment money. Digit/cents filtering plus the existing finite-positive state guard replaces native number min/step validation. No material numeric or caret regression was found in the focused cases.

Evidence: `targeted-review.mjs`, `targeted-computed-states.json`, `wallet-rest-{theme}-{width}-{unit}.png`, `wallet-edit-{theme}-{width}-{unit}.png`. Errors and unexpected requests are empty. Only local 5180/8010 GET/HEAD/OPTIONS reached servers; WebSockets closed. This proves scoped display/edit/guard and request-body behavior, not backend creation durability or whole-product acceptance.

Source hashes stayed identical before and after the final run:

| File | SHA-256 |
|---|---|
| web/src/QuickSessionDialog.jsx | 9cb82f0f21f114fc88b1df8fa057386045b4cf64c8e36c806a9530a25386bb2c |
| web/src/quick-session.css | af36a67d7910d25eef13b9b2e05fc87dfc708d461c8e14a3c17c927e0ad1a11e |
