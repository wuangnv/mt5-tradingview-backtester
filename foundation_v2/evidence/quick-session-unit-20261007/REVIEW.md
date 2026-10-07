# Independent currency/strategy-hover review — 2026-10-07

PASS eight targeted browser cases: dark/light × 360/1710 px × USD/EUR. Four use the actual local USD catalog; four isolate EUR by changing only the currency in a fetched catalog response. No product source edited, full suite rerun, persistent test added, or backend write performed.

Latest accepted behavior supersedes the intermediate suffix-only/brightened-hover proposal: retain the left `$` money glyph, put USD/EUR immediately after the editable number, and keep `+ Tạo chiến lược mới` the exact same orange on hover.

- Strategy computed rest and hover colors are exactly equal: dark `#FFAD7C`, light `#A44715`. Background stays transparent.
- Balance label is `Số dư tài khoản *`; group order is money glyph → number input → currency suffix. The suffix comes from the selected dataset account currency, with USD fallback. `aria-describedby` resolves to that exact suffix; the decorative money glyph is `aria-hidden`.
- Short `1`, decimal `25000.75`, and 33-character long decimal values remain editable and unchanged. The suffix starts at the input's right edge and remains inside the group at both widths. The short/decimal input fits its content. At 360 px, the extreme long value uses native input scrolling (roughly 10–12 px of overflow within the input), while the suffix remains visible and the page does not overflow. Keyboard ArrowUp still changes `1` to `1.01` despite hidden spinners.
- Focus has one neutral outer border (#FFFFFF dark / #111111 light); input border is zero with no outline/shadow. Amount and suffix heights match. Representative desktop/mobile screenshots were inspected.

The literal `$` plus EUR suffix gives a mixed visual currency signal even though `$` is decorative and the selected currency remains correctly EUR. This follows the owner's explicit latest request; it does not affect state or payload. A generic money icon would remove that ambiguity if multi-currency clarity is revisited. No source change was made for this concern.

Evidence: `targeted-computed-states.json`, `strategy-hover-{theme}-{width}-{unit}.png`, and `currency-focus-{theme}-{width}-{unit}.png`. Errors and unexpected requests are empty. Only local 5180/8010 GET/HEAD/OPTIONS were allowed; WebSockets closed. This receipt covers UI/state display, not creation persistence or whole-product acceptance.

Source hashes were identical before and after the final run:

| File | SHA-256 |
|---|---|
| web/src/QuickSessionDialog.jsx | d23b343d9ab430abc608cfcddbb04ad541d7640bba3707781114f673b7a8179a |
| web/src/quick-session.css | a4d073bb6b546fd7b8b4dfa6984c5a20e8c5715253ccda8f9598ab169a497d02 |
