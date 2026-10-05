# Trades, demo preview và page layout — 05/10/2026

Scope: browser comments về Trades theo FX, tab nguồn Analytics trên cùng hàng và preview dữ liệu đầy đủ; một gutter chung cho các page. Tiếp nối slice Dashboard/Sessions, không mở lại UI exploration hay thay chart engine.

## Hành vi và state

- Điều hướng: Dashboard → Sessions → Trades → Analytics → [Sessions / Prop firm] → Market Data. Hai tab nguồn nằm trong cùng hàng, ngay sau Analytics. Màn hẹp cuộn ngang và tự đưa nguồn đang chọn vào vùng thấy được khi load/resize.
- Trades: selector phiên trái, search có thể mở/đóng, icon clear/export, Basic/Tags và bảng rộng. Default columns thêm source, realtime/chart dates, entry type, return %, rating; unknown vẫn là `—`. Cột tùy chọn, chọn dòng, drilldown, sort, pagination và CSV giữ hành vi thật. Bỏ trade ID lặp dưới tên phiên, footer giải thích, foldout source toàn bảng; dữ liệu một phần vẫn có badge và provenance của từng trade trong inspector.
- Page width: một gutter tại `.fx-content`, 32 px desktop / 16 px mobile; bỏ max-width và horizontal padding của page wrapper. Giữ chiều rộng hợp lý của field/nội dung bên trong. Chart workspace giữ layout riêng.
- `Show demo data` / `Show real data`: URL chỉ thêm/xóa `demo=1`. Component dữ liệu thật được unmount khi preview bật. Fixtures không được đưa vào API, broker, replay engine, local session storage hoặc URL owner context. Navigation giữ flag preview; tắt preview phục hồi session/dataset/cursor/filter thật.
- Demo dùng lại widget hiện có: DashboardPerformance, SessionPerformance, FxAnalyticsFilters/Report, FxTradeLedger, MarketAssetCatalog, LiveBrokerSnapshot, PlaybookList/Summary và JournalRow/StoryRail. Fixtures: 3 phiên, 60 closed trades, 12 assets, account/deals/positions/calendar mẫu. Net/gross/fees/R/curve khớp cùng ledger; thời gian luyện tập chỉ là số minh họa được gắn nhãn demo.
- Demo có trên Dashboard, Sessions picker, Trades, Analytics Sessions/Prop, Prop practice report preview, Market Data, Live Calendar/Trades/Notes/Tags/Accounts, Strategies và Journal. Learn/Settings/Research/Risk/DataDesk và chart/order-entry giữ luồng hiện hành. Prop practice preview trình bày phần báo cáo/objectives, không giả chạy flow tạo challenge/evaluator.

## Trade-off và giới hạn

Preview được tách khỏi data readers để tránh trộn số liệu thật và mẫu. Các thao tác tạo/sửa phiên, tải lịch sử, mở chart thật và SL/RR cần price-path bị khóa trong preview. Monte Carlo và lọc/sort/paging/CSV của mẫu chạy local. Demo không phải bằng chứng trading/backtest/prop evaluator; unknown price-path vẫn unknown.

Root wrapper cho demo Journal phải có `journal-page ja-story-page` giống page thật để nhận đúng semantic theme; lỗi contrast ở attempt đầu đã được sửa bằng class gốc, không thêm bảng màu riêng. Không thêm dependency. Build vẫn có cảnh báo bundle >500 kB đã tồn tại.

## Kiểm chứng

- Production build PASS, 114 modules.
- 35 focused Node tests PASS: ledger arithmetic/curve consistency, demo scope/date filters, URL roundtrip, exclude chart/order surfaces, actual session/default/cutoff/contracts, unknown/period/mixed-currency dashboard semantics.
- Primary `web/tests/demoPreview.browser.mjs`: chọn demo session và Drawdown không sửa owner URL; tắt demo giữ nguyên từng query value; nav đúng thứ tự/cùng hàng, Prop nguồn visible ở 360 px; no runtime errors/API reads during demo/mutation requests.
- Primary screenshot review: Trades/Dashboard/Sessions/Analytics/Market Data/Strategies/Journal ở 1710 px, gutters 32/32 và document overflow 0.
- Independent acceptance, actual API oracle, responsive/theme/accessibility matrix và source fingerprints: xem `independent-review/REVIEW.md`. Raw attempts được giữ riêng; không đổi nhãn lỗi cũ thành PASS.

Không restart MT5, tải history, gửi order hoặc sửa session trong QA. API 8010 và Vite 5180 tiếp tục chạy. Receipt này chỉ nghiệm thu slice UI, không đánh dấu toàn Product Plan hoàn thành.

Harness reviewer được giữ nguyên từ `.artifacts/fx-trades-demo-layout-20261005/independent-review/`; để chạy lại, chép về cùng thư mục `.artifacts/` tại product root và dùng commands trong review receipt. Primary browser test chạy từ `foundation_v2/web` bằng `node tests/demoPreview.browser.mjs`.
