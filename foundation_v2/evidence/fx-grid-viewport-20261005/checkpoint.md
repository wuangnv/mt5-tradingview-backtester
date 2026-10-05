# Trades viewport và filter separators — 05/10/2026

Scope: bảy browser comments về grid Trades, separators Trades/Analytics và toolbar Market Data. Tiếp nối fx-filter-toolbar-20261005, không thay chart, data feed hoặc product/broker gates.

## Hành vi và state

- Trades chiếm phần còn lại của viewport. Filter và pagination đứng yên; vùng bảng cuộn dọc/ngang, các th sticky giữ alignment với cột. Đổi trang, số dòng, sort, filter hoặc report reset cuộn dọc về đầu. Empty state nằm trong vùng bảng; loading/error/blocked giữ hành vi hiện có.
- Chi tiết giao dịch của Trades mở bằng native dialog thay vì đẩy bảng/footer xuống. Escape, nút đóng, backdrop và Tab/Shift+Tab được kiểm; đóng trả focus về nút mở. Analytics vẫn dùng detail section hiện có.
- Basic/Tags chia sẻ một vùng cuộn khi mở trên màn hình thấp; toolbar nằm ngoài vùng đó. Giới hạn chiều cao giữ chỗ cho header/body/footer bảng. Đây là trade-off cho mobile/short-height, không cuộn toàn page Trades.
- Filter Trades và cả hai Analytics source có separator cùng màu với sub-header, dùng gutter hiện có.
- Market Data bỏ intro paragraph/count summary, chuyển Cập nhật dữ liệu vào filter/search row. Loading, lỗi kết nối/ticks và trạng thái tải thật vẫn hiện. Handler, validation/disabled state và row actions không đổi; demo update vẫn disabled.

Nguồn dữ liệu và financial calculations không đổi: real routes đọc API/ledger hiện có; demo fixture chỉ ở client. Grid vẫn giữ table semantics, selection, sort, columns và paging state hiện có. Không thêm dependency hoặc cập nhật lịch sử/phiên thật để tạo screenshot.

## Kiểm chứng

- Final Vite build PASS; warning bundle lớn đã có vẫn còn. git diff --check PASS.
- Primary gridViewport.browser.mjs PASS: 8 dark/light viewport cases 1710×987, 1440×900, 360×844, 360×600; 100-row setting/60 demo trades, header/filter/footer đứng yên khi body scroll; Basic+Tags; no document overflow. 25-row paging đổi dữ liệu/reset scroll, empty state, dialog focus/Escape/backdrop, cả hai Analytics separators, Market search/action placement và disabled demo update. Zero pageerror, API write hoặc demo API read.
- Existing filterToolbar.browser.mjs và demoPreview.browser.mjs regression PASS. Reports đi kèm.
- Primary attempt đầu phát hiện footer bị đẩy khỏi viewport ở 360×600 khi mở Basic+Tags; đã sửa shared scroll panel và rerun. Independent full attempt phát hiện native dialog Tab rời khỏi content sau control cuối; đã thêm explicit wrap theo pattern shell và kiểm lại. Raw failed attempts giữ nguyên trong .artifacts/fx-grid-viewport-20261005.
- Independent review: 25 checks trong full attempt đạt, hai dialog cases ban đầu fail; final focused rerun PASS 10 checks trên source cuối. Bao gồm panel scroll tới control cuối, short-height dark/light, page-size/sort/page/search reset, real aggregate/single và initialized-empty/blocked, actual Market action placement không click update, labeled GET-only error fixtures, dialog keyboard/focus/backdrop. Old session full payload không đổi, zero runtime/network-write violations. Receipt trong independent-review/.
- Root đã xem screenshots desktop Trades, mobile expanded, Analytics Prop và Market Data. Đây là nghiệm thu UI slice, không chứng minh toàn bộ product plan hoàn tất.

## Resume

Runtime đang chạy tại http://127.0.0.1:5180, proxy API8010. QA không restart MT5 hoặc gửi lệnh broker. Harness: từ foundation_v2/web chạy `node tests/gridViewport.browser.mjs`. Raw primary/regression/reviewer reports và screenshots bổ sung: .artifacts/fx-grid-viewport-20261005/.
