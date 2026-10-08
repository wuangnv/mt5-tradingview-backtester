# Independent status-filter review

PASS: two focused browser journeys, actual dark desktop 1710px and controlled light mobile 360px. Source review and screenshot inspection completed. No production mutations, provider calls, or user-job resume/cancel actions occurred; all non-read requests and WebSockets were blocked.

- Status menu order: Tất cả trạng thái / Đã tải / Đang tải / Chưa tải.
- Removed toolbar progress launcher; catalog action remains. Row progress button still opens the progress dialog; Escape closes and restores focus.
- Actual cached API: EUR/USD paused after 624 / 8,558 days, source_rate_limited. It now remains visible under Đang tải and retains its true Đã tạm dừng row label and 7% progress.
- Fixture covers running/queued/pausing/paused/failed together under unfinished-download filter, excluding completed/cancelled. Row status remains exact; Chưa tải contains no unfinished jobs. Clear filters restores all fixture rows.
- Mobile dialog remains bounded and scrollable; no document horizontal overflow or page errors.

Semantic note: Đang tải is a recovery grouping for unfinished jobs, including paused/failed, rather than literal active network traffic. Actual status is explicit in each row. Completed fixture without an imported dataset correctly stays Chưa tải; saved dataset state determines downloaded status, not completed-job history.

First run failed only because test expected Xoá whereas canonical UI copy is Xóa; the failed report is preserved in attempt-1-oracle-error.json. Corrected final results.json passes 2/2. No product code edits were made by this reviewer.
