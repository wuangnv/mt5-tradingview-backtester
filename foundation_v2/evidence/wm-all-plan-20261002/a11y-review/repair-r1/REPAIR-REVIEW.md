# Independent focused repair review — r1

**ORIGINAL_FINDINGS_RESOLVED / ADDITIONAL_CONTRAST_FINDING_OPEN.**

Reviewer `/root/mt5_independent_review`. Actual read-only local API/browser at
`http://127.0.0.1:5180`, workspace `tenant-a`, synthetic session
`39b1d068edd64e75864f692f27237852`. Source before/after both
`476d20e4862abf1bfc69060aa978bf09fb7bc002b25a54e84980c74d1fed7901`.
This is partial WCAG repair verification. It does not approve all WCAG states,
whole W8/product, root route matrix, golden comparator or broker scope.

## Resolved original findings

- **A11Y-01 — Journal placeholder: resolved at this source.** New rule uses the
  existing muted token and opacity1. Nine actual enabled empty Journal fields
  were measured on each of8theme/viewport pairs:72placeholder observations.
  Dark `#8c979f` on `#0c1113` is **6.3719:1**; light `#53636d` on white is
  **6.2252:1**. Each assertion requires at least4.5:1 and no ancestor opacity or
  background-image ambiguity. The actual content textarea is enabled, empty and
  visible after scroll; screenshots confirm it, including natural wrapping at390.
- **UI-01 — Data provider collapse: resolved at this source.** Metadata, readiness
  and blocked capabilities stack in one usable track; no extra visual wrapper.
  First-cell widths at1440/1280/768/390 are **418.5/358.5/646/308px** in both
  themes. Row height is137px, compared with1223px at old desktop widths. Provider
  name and `Có: read_metadata` each fit one line; the `read_metadata` word stays
  whole. Entitlement has at most3Range rectangles and is visibly readable in the
  crops; its wrapping is no longer one character per line. All tracks remain
  inside the row, have width>100px, and do not overlap. Source status now has
  min-width0 and left alignment. Provider identity/capability/entitlement strings
  remain the same. Data document/body/fx-content have no horizontal overflow on
  all8theme/viewport pairs.

`verify-repairs.mjs` completed **16/16route cases,312assertions**. It asserts
placeholder>=4.5, first-cell>100px, row<=200px and actual word flow, rather than
only measuring and always returning PASS. All16Journal/Data screenshots were
directly inspected. No API write, fill/submit, worker or source change was made.

## New finding exposed by rendered review

**A11Y-02 — Data light entitlement/readiness text: OPEN.**

The `.rd-provider-readiness` text
`offline_local · entitlement: dataset_metadata_only` still uses the older fixed
`#d5b46a !important`. At1440light it is visible, font11px, opacity1, on white:
**1.987535:1 <4.5:1**. This is meaningful mode/entitlement information, not a
decorative or disabled control exemption. Screenshot `data-light-1440.png` shows
the actual text. The same selector in dark measures10.3769:1 and passes.

Focused supplemental2theme/1440 measurement covers all6provider text groups:

| Text | Dark ratio | Light ratio | Result |
|---|---:|---:|---|
| local-catalog |15.0264|14.8715|Pass|
| Có: read_metadata |6.6584|6.2252|Pass|
| offline_local / entitlement |10.3769|1.9875|**Light fail**|
| Chưa đủ điều kiện production |9.1209|5.0412|Pass|
| Offline / no network |5.9092|6.2252|Pass|
| Khóa: blocked capabilities |9.1209|5.0412|Pass|

`measure-provider-text.mjs` returned exit1 with
`CONFIRMED_CONTRAST_FINDING`; this failure is retained. The layout patch did not
change this color rule. It made the previously collapsed content readable enough
for the low contrast to become clear during visual review. Root was notified
before additional patching. Use a theme-aware warning or muted token, then verify
both themes under a new source hash/evidence revision. Do not overwrite r1.

## Reuse and remaining gates

The prior18target classification is preserved at `../contrast-review.json`.
Journal and read_metadata are freshly checked here. The other16original targets
can reuse prior measurements only within this delta: Journal placeholder CSS is
scoped to `.ja-page .ja-field`, provider track changes do not affect their color,
and the shell change is a comment. This reuse is not a new runtime verification of
every selector/state. The Research decorative-circle exception remains limited to
the inspected no-result state. Old keyboard/reduced-motion checks retain their
original source and scope; full route/axe/reflow and canonical comparisons belong
to root's follow-up on final repaired source.

Acceptance for the two original findings is confirmed. Broader accessibility
approval remains open for A11Y-02, as do the prior chart types/down-candle/full
gestures, manual WCAG and product gates. No source, baseline, promotion manifest,
ledger, routing or commit was modified by the reviewer.

## Evidence integrity

| Receipt | SHA256 / result |
|---|---|
| `../contrast-review.json` | `2bc316aadd106dd854166fc1a4551d7d567deb9cb1c4ada9d170e663c70396f1` — preserved old finding |
| `measurements.json` | `eee834a1755a479c6d57170de332e9bcb3632f5ebc7dc5b96ae75efb47678fa4` — focused assertions pass |
| `provider-text-contrast.json` | `6d648dfe5d091a9a24d5a3605164c040a9c232dd8afba3dbd62a1aec5518de14` — confirmed additional finding |

Screenshot hashes are stored in `measurements.json` (16exact crops). Both scripts
require expected source hash476d20e… before opening a browser and verify the same
hash after. GET/HEAD/OPTIONS loopback only, WebSocket closed;0page errors,
0blocked requests/API writes. Previous receipt hash was asserted unchanged.
