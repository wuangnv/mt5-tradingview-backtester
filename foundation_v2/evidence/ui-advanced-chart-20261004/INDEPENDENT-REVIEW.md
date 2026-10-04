# Independent Advanced Charts review — 2026-10-04

Accepted for the requested local native replay engine migration, with the vendor accessibility limitation below. This is not whole-product, full U4, broker, real-data/OOS, deployment or complete WCAG acceptance.

Frozen six-file source composite SHA256: `67c495e19d807e4b83994a32f7f722b18ec8c90d67de550eb6a8a6732dd3fb83`. Exact files and individual hashes are in `final-review.json`; before/after hashes match. The independent reviewer edited only scripts/reports in this artifact directory, used isolated test browsers, and made no API writes, vendor/product edits or commits.

## Source and actual runtime evidence

- Reviewed the local v23.040 public API contracts, causal adapter, scoped local storage, native order-line fencing, imported annotation behavior, current-theme restoration, rollback URL and bounded local vendor middleware. Found and returned issues for parent repair: rewind/forward stale emission, unknown aggregated volume, symbol metadata, hidden TP, toolbar/legend collision, saved palette restoration and custom-header keyboard semantics.
- Final actual GET-only QA session `39b1d068edd64e75864f692f27237852`, UI5180/API8020: six dark/light cases at1440/768/360 pass native61-bar history and cutoff assertions, exact pane palette, zero page overflow, all three simulated lines within visible price scale, noncancellable lines and Escape dock close. No page errors, external requests or API writes.
- Native5-minute aggregation produces13 causal buckets from61 one-minute rows, with the correct partial final bucket. Native drawing/layout/resolution persists locally and restores after reload. Saving dark and reloading into light retains a white pane/current theme. At cursor20, later-cutoff drawings are absent and all native history remains at/before1704068400; the historical order form is disabled and no draft lines render.
- Aborting the local library in an isolated context produces an explicit error; the fallback link replaces `chart_engine` exactly once and renders the actual existing Lightweight engine.
- Final native keyboard delta passes in dark and light: focus+Enter on Lưu chart saves locally; focus+Space on Vừa lệnh restores a range including SL/TP. `keyboard-delta.json` matches the same frozen hash.
- Five independent focused adapter/storage tests pass on the final source. Earlier labeled isolated5-second native fixture passes exact5S timestamps, native position/execution primitives and rewind then one-bar forward emission (`seconds.json`), without API writes. Synthetic fixture evidence is distinct from the actual QA dataset.
- Reviewed representative rendered desktop, tablet, mobile, light order-line fit, historical readonly and working fallback screenshots. Canvas correctness is supported by price/history assertions, not canvas existence alone.
- Reviewed parent disposable integration receipt/test source: real simulator initialization, queue/next-bar fill, native pointer SL amendment, actual protection200, stale409 and readonly history; all eight API annotation types remain readonly and excluded from local native serialization. This write journey belongs to the parent's unique temporary database, not the persistent QA8020 session.

## Accessibility and limits

Final axe scans include both outer page and actual native iframe for WCAG2A/AA,2.1AA,2.2AA tags. All light cases and dark360 report zero violations. Frame/document titles and mobile focusable scroll content are fixed by the final semantic changes. Dark1440/768 retain one vendor-native auto-scale text contrast failure: `#2962ff` on `#131722`, ratio3.65 versus required4.5. The outer-page scan reports that same iframe finding. Do not claim complete WCAG conformance; no vendor source was patched.

Native drawings/layouts remain browser-local, not synchronized API annotations. The ignored authorized library is not part of the build output; a standalone host must mount it separately. No long-duration/memory/large-data performance certification, broker/order-flow/depth feature acceptance, manual screen-reader certification or public deployment was performed.

## Receipts

`final-review.json`, `keyboard-delta.json`, `seconds.json`, `constraints.md`, and `final-*.png` are scoped independent evidence. The earlier harness path/settle/draft-fit failures remain separately named and are not counted as product failures or passing receipts. `pre-keyboard-final-review.json` preserves the previous source run; final acceptance uses the final hash above.
