# Sub-header, Trades columns và Analytics filters — 05/10/2026

Scope: các browser comments mới về Show demo data, badge dữ liệu một phần, chọn cột và Analytics filter row. Tiếp nối checkpoint fx-trades-demo-layout-20261005; không thay chart engine, data feed hoặc mở product/broker gates.

## Hành vi và state

- Show demo data / Show real data chuyển vào góc phải sub-header qua action prop của shell. Bỏ hàng demo trong content. Primary navigation cuộn độc lập và vẫn reveal nguồn Analytics đang chọn; các route không có primary tabs vẫn có demo action khi được hỗ trợ.
- Trades bỏ visible partial-data badge. API payload, excluded scope, source provenance và CSV vẫn giữ thông tin nguồn. Nút bút chọn cột nằm cùng hàng filter, menu có số cột chọn, search, select-all và các checkbox; số cột thực tế/sort/paging/selection vẫn thuộc ledger state.
- Analytics dùng hàng pill Type, Assets, Side, Outcome, Tags, Session, Strategy, Day, Time, Timezone, Backtesting Date và Apply. Chips thể hiện scope đã áp dụng; Clear filters giữ session hiện hành. Side/outcome/date cập nhật server filter, các extra filters cập nhật normalized ledger trong browser. Ngày là ngày đóng UTC; Day/Time theo timezone đã chọn.
- Mọi lựa chọn nằm trong draft tới Apply. Khi đổi session thật, serialize applied filters vào URL trước callback chọn session/remount, đồng thời bỏ legacy date params; owner session handler xóa cutoff/event/trade context cũ. Demo không ghi các filter/session mẫu vào URL, không mount data readers thật.
- Xuất CSV bị khóa khi báo cáo chưa có trạng thái ready/partial/stale/empty. Session cũ chưa initialize vẫn báo blocked; không initialize nó để tạo screenshot đầy số liệu.

## Quyết định và giới hạn

Reuse FxSelect và SessionFilter thay vì thêm package hoặc dựng menu khác. Ledger dùng renderFilters callback để đặt control cột đúng hàng mà không portal/absolute-position DOM hack. Type chỉ là nguồn hiện hành (Backtesting/Prop firm/Research); không giả scope khác chưa có. Strategy chỉ dùng playbook_id thực trên từng row; thiếu ownership không tự gán strategy. Filters giữ single-value asset/day/hour hiện có, search/select-all nhiều lựa chọn được dùng cho cột. Không thêm nút Share không có backend.

## Kiểm chứng

- Build final PASS (Vite còn warning bundle size đã có).
- 26 Node tests focused PASS: tradingAnalytics, demoMode, sessionPicker; mới thêm oracle strategy/asset, unknown ownership, filtered curve và URL key.
- Primary browser: column search/select-all thay đúng table headers, menu Escape; demo draft Side/Session không thay báo cáo tới Apply, chips/Clear/date validation, owner URL nguyên vẹn; desktop/mobile dark/light 360/1440/1710, action far-right same-row, source được reveal, Session popup bounded, document không overflow; real session remount/reload giữ applied filter và xóa cursor cũ; real aggregate Trades không còn partial badge. Không pageerror, API write hoặc demo API read.
- Existing demo preview roundtrip browser test PASS trên implementation mới.
- Primary attempt đầu lỗi test harness (catalog name nằm ở item.name, theme key thực là tw-theme); đã sửa harness và chạy lại. Raw failure/report giữ trong .artifacts/fx-filter-toolbar-20261005/primary.
- Independent review nằm trong independent-review/; raw attempts và screenshots bổ sung giữ tại .artifacts/fx-filter-toolbar-20261005/independent-review. Đây là nghiệm thu UI slice, không hoàn tất toàn bộ product plan.
- Independent SCOPED_PASS: 30 comprehensive + 20 final focused browser checks; 12 + 18 layout/axe cases trên dark/light 360/1440/1710. 14 source hashes ổn định ở hai final runs. Nút CSV blocked được reviewer phát hiện và root sửa; raw failed attempt không đổi thành pass. Final report xác nhận zero runtime error/write/download/external/demo API read, payload replay trước/sau giống hệt. Chi tiết trong independent-review/REVIEW.md.
