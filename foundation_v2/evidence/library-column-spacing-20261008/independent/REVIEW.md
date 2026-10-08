# Independent review: Library column spacing

Result: PASS 12/12 for the fixed 180 px Status / 196 px Actions columns. Run `node foundation_v2/evidence/library-column-spacing-20261008/independent/qa.mjs` from the product root; `results.json` contains measured results.

## Scope

Cases: dark Vietnamese fixtures at 1505/1710/1920/360 px; light Vietnamese fixtures at 1710/360; actual local GET-only dark at 1505/1710/1920 and light at 360; English desktop fixture; one extra extreme metadata-wrap fixture. The fixtures explicitly represent paused cooldown, running, update, failed, queued, pausing, and processing jobs. Twenty additional labeled assets provide real vertical table scroll.

Isolated browser contexts block external origins, live routes, WebSockets, and non-read requests. No source edit, commit, provider call, data operation, broker action, or service restart occurred. All twelve cases had zero attempted writes, zero browser errors, and no document overflow. Actual screenshots contain local catalog data; transfer-state screenshots are labeled presentation fixtures and do not prove network performance or mutation semantics.

## Findings

- Status measured exactly 180 px, Actions 196 px, and their header content-edge distance 180 px at all four viewport widths and in both themes. The action group's first control shares the Actions header's left content edge. These tail widths no longer grow with viewport width.
- Ordinary Download/More and all transfer/Cancel states retained identical slots: first action 116 px, gap 8 px, circular icon 32 px desktop / 44 px mobile. Controls stayed inside their action cells, and Cancel icon center deltas were zero.
- Progress stayed inside Status, with neutral 3 px full-width track, correct fill/percentage, accessible state/percentage label, bytes, and optional speed. Normal stress labels fit the narrower column. Extreme billion-GiB/billion-MiB/s labels wrap into two 16 px metadata lines without overflow or smaller typography; the progress control grows vertically and actions remain centered in their own cell.
- Transfer hover remained distinct from rest after the shared transition settled, without geometry shift. Keyboard focus, paused cooldown disabling, pausing disabling, English Resume, local progress dialog opening, and Escape focus restoration passed.
- Real `scrollTop=250` checks preserved sticky header position and inset divider. Header bottom border and first-row top border were zero, retaining one initial separator. Both-theme before/after header crops were saved.

## Visual review and limits

Inspected actual desktop screenshots at 1505, 1710, and 1920 px; standard transfer fixture at 1710; light mobile; actual 1505 initial-left view; and extreme-wrap fixture. The Status/Actions tail reads as a compact group at desktop widths, while extra width goes to asset names. It no longer gains a large empty inter-column gap at 1920. Wrapped transfer metadata remains readable and contained.

At 1505 px with the existing expanded sidebar, the preserved 1390 px table minimum exceeds available content width. This intentionally requires contained native horizontal table scrolling; both initial-left and action-tail screenshots are saved. The same containment applies at 360 px. This review accepts the requested spacing fix and does not claim the whole table fits those widths without scrolling.

Acceptance is scoped to Library column spacing and presentation states. Existing download/update/resume/cancel callbacks were not exercised, and no whole-product or broker acceptance is implied.
