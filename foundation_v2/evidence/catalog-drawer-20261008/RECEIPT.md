# Catalog drawer — final scope, 08/10/2026

The owner deferred category CRUD. The shipped change keeps toolbar filters separate,
uses an underlined-on-hover **Danh mục tài sản** action, and opens the same right
drawer surface as Session Settings. It shows cached source/count/UTC timestamp and
the explicit update action. CSV uses existing orange action tokens; row ellipsis
buttons have equal width and height at 36px (44px for coarse pointers).

Catalog refresh uses the existing POST and cache/cooldown state. While pending,
native dialog modality blocks the background, drawer content is inert, close/Escape/
backdrop are locked, and an indeterminate progress indicator shows elapsed seconds.
Completion or failure releases the lock. A 45-second AbortController timeout also
releases it. The last cached data remains available after failure; no percentages
are fabricated. The drawer opener never issues a POST.

Validation:

- `npm run build`: PASS.
- `final-qa.mjs`: 12/12 PASS, zero page errors. Actual cached library GET at
  dark/light 360/768/1440, Vietnamese/English and coarse touch; separate delayed
  mocked refresh fixtures for success/error/rate-limit/cooldown. Also covers filters,
  CSV modal, hover/keyboard/focus restoration, overlay locking and circle dimensions.
- `timeout-qa.mjs`: PASS. A delayed mocked request remains locked at 44 seconds and
  unlocks after 45 seconds using the browser's virtual clock.
- Independent review: 15/15 PASS; `independent/FINAL-REVIEW.md` and final-results.
- No real catalog POST, historical download, broker call or user-data deletion.

Only final-* evidence and timeout-results reflect this accepted scope. Earlier
management/drawer experiments are superseded and are not acceptance evidence.
Deferred category CRUD source is preserved locally under `.artifacts/` and is not
part of the shipped diff. The final implementation needs no API restart.
