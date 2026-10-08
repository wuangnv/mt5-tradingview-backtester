# Independent review: Library status progress

Result: PASS for the final left-aligned, fixed-slot implementation. Run `node foundation_v2/evidence/library-status-progress-20261008/independent/qa.mjs` from the product root; machine results are in `results.json`.

## Scope and actual versus fixture evidence

Seven Chromium cases passed: Vietnamese labeled presentation fixtures in dark/light at 1710 and 360 px; actual local GET-only dark desktop and light mobile; English dark desktop fixture. The isolated contexts block external origins, live routes, WebSockets, and non-read requests. No data download/update/pause/resume/cancel/delete, catalog refresh, provider call, broker action, or service restart occurred. Zero attempted writes and zero browser page errors were observed.

Fixtures contain seven explicit states: paused with cooldown, running, update of a saved dataset, failed, queued, pausing, and processing. Twenty additional labeled catalog assets ensure actual vertical scrolling within the first page. Transfer bytes and speed are deliberately extreme layout stress values; they do not measure the provider's actual performance. Actual cases use local catalog data and do not assume a saved dataset or active job exists.

## Accepted behavior and geometry

- Ten columns remain. Progress occupies the ninth `Trạng thái` column; the tenth `Thao tác` column contains only the compact transfer action and cancel icon for job rows.
- State and percentage share the first line; a neutral 3 px full-width track follows; bytes and speed occupy the final line. Track fill matches 0/30/40/50/70/100 percent. Large GiB and MiB/s values remain inside the progress width.
- Action/header content aligns left. The first action slot is always 116 px, followed by an 8 px gap and the circular Cancel/More slot. Ordinary download/more and all transfer/cancel states have identical horizontal slots. Cancel icon center deltas are zero; the circular control measures 32 px desktop and 44 px mobile and stays inside its cell.
- Transfer action has a filled secondary surface. Hover differs from rest after the shared transition settles, with no width/height shift. Keyboard focus is visible. Paused cooldown and pausing state disable the corresponding action. English `Resume` fits the same slot while the accessible name remains `Resume download`.
- The progress control exposes state, percentage, bytes, and speed in its accessible label. It opens the local seven-job detail dialog. Escape closes it and restores focus to the invoking progress control; keyboard focus remains visible.
- Sticky header was verified with a real `scrollTop` of 250 px, not a no-op scroll. Header Y and inset divider remain unchanged in both themes and all cases. Header bottom border and first-row top border are zero, preventing a duplicate initial separator. Before/after header crops accompany the results.
- Native table horizontal scrolling remains contained at 360 px; document width never overflows the viewport. This intentionally preserves the wide table rather than turning it into nested mobile cards.

## Visual inspection

Inspected final `fixture-dark-1710.png`, `fixture-light-360.png`, `actual-dark-1710.png`, and `header-fixture-light-1710-vi-after.png`, plus the English stress-state screenshot. Status hierarchy is readable, percentage aligns consistently, buttons are separated from progress, and actions/header share their left edge. The focused progress screenshot intentionally contains the shared keyboard focus outline. Before/after header crops confirm one persistent header divider on scroll.

Acceptance is scoped to this Library presentation/state layout. Existing mutation handlers and backend resume semantics were not exercised, and this is not whole-product, download performance, or broker acceptance.
