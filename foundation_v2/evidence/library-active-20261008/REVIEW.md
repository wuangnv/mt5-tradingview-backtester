# Independent active-download UI review

Scoped acceptance: **12/12 browser journeys PASS**, zero page errors and zero unexpected mutations. Actual frontend at `http://127.0.0.1:5180`; all API requests, including reads and pause/resume/cancel writes, were intercepted with explicit controlled fixtures. No user download was paused/cancelled, no real dataset was written/deleted, and no backend/provider/broker operation or restart occurred.

Run from product root: `node foundation_v2/evidence/library-active-20261008/review.mjs`. Final report: `results.json`; source revision fingerprints: `source-hashes.json`. The script also emits source hashes on subsequent runs. Independent reviewer owned only this evidence directory, not application source.

## Behavior verified

- Dark/light at 1710 VI, 768 EN, and 360 EN: running row has progress plus named pause/cancel controls, no ellipsis menu. `Đang tải` filter selects the active job. Existing saved dataset update retains saved candle count/size while using the same progress and controls.
- Clear filters resets category, provider, download status, search and page; preserves Name Z–A sort and selected page size. Composed category/source/download/search has a known one-row oracle. Page 2 resets to page 1 after clearing. The button is disabled when no filters/search are applied; sort alone does not enable it. No collapse toggle exists.
- Download metadata history is available before downloading (`2003-05-04` through latest closed UTC day, labeled M1/Bid). Exact candle count is `After download`; running unsaved size shows received bytes. Unknown metadata remains labeled unknown in fixture rows rather than becoming zero. No invented total bytes/count.
- Keyboard Space activates pause. Running → pausing disables pause, keeps cancel enabled → paused exposes resume/cancel. Paused status is visibly `Đã tạm dừng`/`Paused`; filter Downloading excludes paused jobs. Reload restores the mocked paused job and resume control. Resume returns to running. Cancel removes progress/controls, restoring the regular ellipsis action menu without deleting an existing saved dataset.
- Old API `supports_pause:false`: pause disabled, cancel usable. Empty library: zero rows, stable table/pager. Pause error: error text visible, job remains running, pause enabled again; no false success state.
- Queued jobs are included in Downloading filter and can pause, reload, resume and cancel. Progress dialog opened while pausing exposes usable Cancel; cancelling closes the dialog when no visible jobs remain.

## Visual review

Inspected final screenshots: desktop dark running/error/pausing dialog, tablet light running, mobile dark running and mobile light paused. Flat controls reuse existing button/pager styling. Wrapped toolbar is visible; fixed table scrolls horizontally on smaller viewports. Progress, pause/resume and cancel remain inside the action cell and their text is not clipped. Geometry checks cover every nonempty case, and document-level horizontal overflow is absent. At 360px the two icon controls are 44px targets and progress remains 148px; at desktop/tablet they use the existing 32px compact button pattern. The paused screenshot shows an unambiguous state and play/stop actions. No blocking visual findings remain in the changed controls.

## Finding history and limitations

`attempt-1.json` and the original `*-FAIL.png` files preserve the first run: 6/10 passed, four English cases found paused state rendered as the command `Pause`. Root repaired this by adding distinct `Đã tạm dừng`/`Paused` copy. The reviewer also reported missing Cancel in the pausing progress dialog; root included that state and the final dedicated browser journey passed. Neither issue remains open.

These are product-fixture UI checks, not backend end-to-end pause/resume acceptance, network performance benchmarks, actual provider coverage validation, or a claim that downloading a full history completed. Root owns separate backend/performance evidence. No full-product, broker, or external-provider gate is closed by this receipt.
