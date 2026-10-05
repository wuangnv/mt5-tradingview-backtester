# Dashboard và Sessions theo tham chiếu FX — 05/10/2026

Scope: 10 browser comments của owner về Dashboard Performance, Recent Sessions và Sessions. Giữ shell đã duyệt và tab Market Data; không đổi engine, broker, lịch sử giá hay quyền execution.

## Thay đổi

- Performance dùng pill/menu Backtesting, Prop Firm, All; Battles bị disabled vì chưa có nguồn. Thời gian có Last week (7 ngày UTC bao gồm hôm nay), Last month (30 ngày), Lifetime; giữ khoảng tùy chọn và URL cũ.
- Recent Sessions có search, nút mở bộ lọc, Assets/Strategy có search, trạng thái và sort. Newest/Oldest dùng ngày tạo; Last updated dùng ngày cập nhật vì nguồn chưa có last_backtested riêng. Most profit chỉ so sánh kết quả biết được có cùng tiền tệ; kết quả unknown xếp sau. Khác/thiếu currency giữ thứ tự ngày tạo.
- Bỏ footer giải thích, foldout Chi tiết dữ liệu, View all và count/pagination khi chỉ một trang. Trang dài vẫn giữ điều hướng trang.
- Sessions có searchable rich selector, nhóm actions căn hàng, summary/description, ba biểu đồ từ dữ liệu giao dịch đóng, sáu chỉ số và Recent Trades. Bỏ Market Data action, archive checkbox và count danh mục. Phiên lưu trữ vẫn chọn được trong selector.
- Empty phiên chưa khởi tạo execution giữ `—`, không đặt số dư hoặc kết quả giả. Initialized-empty giữ số dư/zero đã đo. Tháng/tuần/ngày của phiên bám ngày đóng lịch sử cuối. Balance curve không đại diện floating equity; payoff ratio không bị đổi nhãn thành Risk/Reward.
- Menu có hover/selected/search/keyboard/Escape/outside close, nằm trong clip bounds của content, tự mở lên khi dưới không đủ chỗ. Sửa CSS mobile tránh khoảng trống toolbar và tên phiên bị ép thành cột.

## Data/state

Dashboard đọc `/api/v2/overview` theo workspace + session/date scope. Recent đọc catalog; chỉ tải analytics metadata khi mở filter/cần Strategy hoặc profit. Đổi Strategy không refetch cùng metadata. Filter/sort/date/source lưu URL để reload giữ phạm vi. Session selection giữ workspace và loại stale execution context theo helper hiện có.

Prop Firm dùng `/api/v2/prop/reports` và replay binding đã có; All trình bày hai nguồn riêng, không cộng challenge snapshot vào thống kê Backtesting. Playbook thiếu trường giữ unknown, khác với explicit null = chưa gắn strategy.

## Kiểm chứng

- Production build PASS (110 modules); cảnh báo bundle >500 kB đã có, không thêm dependency.
- 25 focused Node tests PASS, gồm 7 ngày UTC, asset/strategy intersection, unknown strategy, profit/unknown/mixed currency, deep link/cutoff/workspace và empty/period calculations.
- Root Playwright GET-only desktop/mobile: no horizontal overflow ở 360 px; kiểm ảnh menu, recent filters, empty/populated session và light theme. Scripts trong `root/` chạy từ product root; output ở `.artifacts/fx-dashboard-sessions-20261005/root/`.
- Lượt review độc lập và bằng chứng: xem `independent-review/` (kết luận riêng, ảnh và source hashes).

Runtime tiếp tục dùng API 8010 PID 10724, Vite 5180 PID 14640. Không restart terminal, tạo/xóa/sửa session hay gửi broker order trong QA. Lát UI này không nghiệm thu toàn Product Plan.

Review độc lập kết luận **SCOPED_PASS**, không blocker: 12 cases (hai page × dark/light × 360/768/1440), axe 0 lỗi và overflow 0. Các menu, keyboard, filter/API oracle và ba trạng thái session thật đã kiểm. Final focused rerun xác nhận thay đổi cuối và 10 source hashes ổn định. Raw attempt có source-freeze failure được giữ nguyên và giải thích trong receipt, không đổi nhãn thành PASS.

Các harness reviewer lưu nguyên bản từ `.artifacts/`. Để rerun trên checkout mới, chép thư mục `independent-review/` sang `.artifacts/fx-dashboard-sessions-20261005/independent-review/`, rồi dùng hai command trong receipt; cần runtime/API và node_modules như môi trường đã kiểm. Screenshot root là evidence bổ sung, acceptance độc lập có source hashes riêng.
