# Independent library-sort review

PASS: source review plus8/8 browser cases. Actual loaded library and separate mixed-state GET fixtures at dark/light ×1710VI/360EN. No blocking findings.

Run: `node foundation_v2/evidence/library-sort-20261008/independent/qa.mjs`.

Exact menu order verified in both languages: Tên A–Z, Tên Z–A, Đã tải, Chưa tải, Mới cập nhật. Popup measured176px minimum, anchored to trigger right edge, fully within mobile/desktop viewport without internal horizontal overflow. Escape restores trigger focus; keyboard Home/Enter selects ascending. Actual screenshots were captured after the table loaded, not during initial loading.

Controlled4-row oracle verified all5 sorts: ascendingAAA/BBB/CCC/DDD; descendingDDD/CCC/BBB/AAA; downloadedBBB/DDD beforeAAA/CCC; not-downloadedAAA/CCC beforeBBB/DDD; newestDDD/BBB thenAAA/CCC. All rows remain present, demonstrating these choices reorder rather than filter. New comparator follows existing downloaded comparator in reverse direction, with deterministic asset ordering as tiebreaker. Source diff whitespace check passes; no API/action logic changes belong to this slice.

Scope: dataset/catalog/download GET fixtures were used for ordering. Actual library cases only read local GETs. Every nonGET mutation and provider/live/category API was blocked; no restart/stop, actual download/delete/upstream call or user-data mutation occurred.

Disabled-state distinction: Details/Update/Delete on undownloaded catalog rows are intentionally unavailable because no saved dataset exists. The current source independently requires `download_state.supports_full===true` for direct downloads and `update_available===true` for saved-row updates. Parent verified running8010 still omits both new fields; that old runtime contract explains disabled Tải về/Cập nhật and is outside this small sort patch. This review does not claim full-download runtime acceptance.

Evidence: results.json and sort-actual/fixture screenshots. No implementation edits or commits made by reviewer.
