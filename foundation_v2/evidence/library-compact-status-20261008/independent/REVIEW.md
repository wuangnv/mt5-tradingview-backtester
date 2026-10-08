# Independent review: compact Library status/actions

Result: PASS 12/12. This review checks the visible blank strip between ordinary Status text and the first action icon, as well as the column boxes. Run `node foundation_v2/evidence/library-compact-status-20261008/independent/qa.mjs` from the product root; measurements and state geometry are in `results.json`.

## Actual versus fixture coverage

Actual local GET-only cases: dark at 1505/1710/1920 px and light at 360. Presentation fixtures: dark at 1505/1710/1920/360, light at 1710/360, English dark desktop, and one extreme-number stress case. Fixtures include paused cooldown, running, update, failed, queued, pausing, and processing jobs. Additional labeled catalog assets ensure real vertical scrolling.

All contexts block external origins, live routes, WebSockets, and non-read requests. No source edit, commit, data operation, provider call, broker action, or service restart occurred. Zero attempted writes, zero browser errors, and zero document overflow were observed. Fixture speeds/bytes are deliberately fabricated layout stress values, not provider performance measurements.

## Measured acceptance

- Status is exactly 112 px and Actions 196 px; their header content-edge distance is 112 px in every case.
- The visible ordinary Vietnamese Status text-end to first action SVG gap is **77.59375 px** in actual and fixture cases at all tested widths, satisfying the requested maximum 85 px. English fixture gap is 53.484375 px. This directly measures the highlighted strip rather than inferring its appearance from column width.
- Primary actions retain a 116 px slot but their content starts on the left. Download/More and all transfer/Cancel groups share the same slots: first at x8, next at x132 relative to the cell. Cancel remains circular, 32 px desktop / 44 px mobile, centered with zero icon delta, and inside the action column.
- Progress has a standalone full state label; a separate bar row contains track, 6 px gap, and percentage; bytes and speed are stacked below. Track + gap + percentage fit the 90 px inner content width, with no overlap. Fill matches 0/30/40/50/70/100 percent.
- All state labels, including wrapped processing text, stay inside the control and above the bar. Metadata stays below the bar, fits the column, and wraps extreme long speed values. Existing label/meta font rules remain 13/12 px; the compact layout uses vertical space instead of smaller typography.
- Transfer hover differs from rest after the shared transition, with unchanged control geometry. Keyboard focus, paused cooldown disabling, pausing disabling, English Resume, local detail dialog opening, and Escape focus restoration pass.
- Real scrollTop250 checks preserve sticky header Y and divider in both themes. Header bottom border and first-row top border are zero, retaining a single initial separator.

## Visual decision and limits

Inspected actual dark 1710/1920 screenshots, dark transfer fixture, light mobile, and extreme metadata screenshot. The ordinary Status/Actions group now has a compact visible gap; its spacing does not inflate on the wider viewport. Transfer progress reads vertically, with state above the short track/percentage and network figures below. The longer processing label wraps normally, and extreme speed wraps without entering the neighboring action cell. Actions remain centered vertically within taller job rows.

The preserved 1390 px table minimum still requires contained native horizontal scrolling at 1505 with an expanded sidebar and at 360. Initial-left and action-tail actual screenshots distinguish those views. Acceptance is scoped to this compact presentation and existing state controls; backend mutation/resume semantics, real download performance, and whole-product acceptance were not exercised.
