# MT5 TradingView Backtester

Workspace local để nghiên cứu, backtest, luyện replay và quản lý bằng chứng giao dịch.
**Hướng phát triển hiện tại là PATH-2 trong [`foundation_v2/`](foundation_v2/README.md).**
Flask/EA cũ được giữ để đối chiếu và tái sử dụng logic, xem [tài liệu legacy](docs/legacy-flask-reference.md).

## Bắt đầu ở đâu

| Phần | Nơi làm việc hiện tại |
| --- | --- |
| Backend | [`foundation_v2/trading_workspace_v2/`](foundation_v2/trading_workspace_v2/): FastAPI, PostgreSQL, API theo workspace, dataset/result bất biến |
| UI | [`foundation_v2/web/`](foundation_v2/web/): React, Vite, TradingView Advanced Charts và shell WMReplay; Lightweight Charts giữ làm rollback |
| Engine research | [`foundation_v2/engine_runtime/`](foundation_v2/engine_runtime/pyproject.toml): runtime Nautilus tách riêng |
| Test và bằng chứng | [`foundation_v2/tests/`](foundation_v2/tests/), [`foundation_v2/evidence/`](foundation_v2/evidence/) |
| Logic được dùng lại | [`retained.py`](foundation_v2/trading_workspace_v2/retained.py) khai báo các module Python gốc mà PATH-2 vẫn cần |
| Runtime cũ | `workspace_app.py`, `app.py`, `templates/`, `static/`, launcher Windows/macOS; xem [tham chiếu Flask](docs/legacy-flask-reference.md) |

Luồng dữ liệu chính: dataset đã kiểm tra → manifest bất biến → research job → worker
có giới hạn → result bất biến → API theo workspace → UI. Replay chỉ được thấy dữ liệu
đến vị trí hiện tại; màn hình và kết quả mô phỏng không cấp quyền gửi lệnh broker.

## Trạng thái hiện tại

Tại ngày **02/10/2026**, các lát chức năng và UI local đã có kiểm chứng, nhưng
**sản phẩm chưa hoàn tất** (`SAFE_SLICES_EXECUTED / FULL_PRODUCT_NOT_COMPLETE`).

- Shell mở chart workspace khi chọn session/dataset hoặc `surface=workspace`; scaffold `SHELL_SKELETON_MODE` đã được bỏ. Chart full-bleed có scoped visual evidence, còn các workflow/performance gates trước khi nhận toàn U4/W8.
- Native zoom, automated axe/reflow, ảnh chuẩn Dashboard/Sessions/Trades/Analytics/chart và lượt đo heap Analytics một giờ đã có bằng chứng theo scope. Manual WCAG, các chart states còn thiếu và hiệu năng chart chạy dài vẫn mở; xem [checkpoint UI](foundation_v2/evidence/wm-all-plan-20261002/ui/CHECKPOINT.md).
- Nghiệm thu dữ liệu thực, provider/AI, broker demo/live, holdout và deploy là các phạm vi riêng. UI local không phải bằng chứng sẵn sàng giao dịch thật.

Dùng các tài liệu trong repo **TradingWorkspace** làm nguồn tiến độ; README này
chỉ là điểm vào, không tạo thêm PLAN:

- [Quyết định PATH-2](https://github.com/Miikey24s/mk-trading-workspace/blob/main/planning/mt5-tradingview-backtester/FOUNDATION-ADR-0001-PATH2.md)
- [Product Completion Plan](https://github.com/Miikey24s/mk-trading-workspace/blob/main/planning/mt5-tradingview-backtester/PRODUCT-COMPLETION-PLAN.md)
- [WMReplay UI Master Plan](https://github.com/Miikey24s/mk-trading-workspace/blob/main/planning/mt5-tradingview-backtester/WMREPLAY-UI-MASTER-PLAN.md)
- [Context workspace](https://github.com/Miikey24s/mk-trading-workspace/blob/main/planning/CURRENT-CONTEXT.md)

Các link trên mở repo workspace trên GitHub và cần quyền truy cập repo đó. Khi làm
local trong TradingWorkspace, các file tương ứng ở `../../planning/` tính từ repo
này. Clone riêng repo MT5 không kèm PLAN; đường dẫn tương đối ra ngoài repo không
được dùng làm link GitHub.

## Chuẩn bị môi trường và kiểm tra UI

Dùng PowerShell tại **gốc repo này**. Cần `uv`, Python 3.12 và Node.js tương thích
Vite trong lockfile; môi trường local hiện dùng Node 24. Không cần cài MT5 hoặc
TradingView Advanced Charts để build UI PATH-2. Để chạy chart mặc định, cần bộ Advanced
Charts được cấp quyền; xem cấu hình asset ở dưới.

```powershell
uv sync --locked --project foundation_v2 --python 3.12
Push-Location .\foundation_v2\web
npm ci
node --test tests/*.test.mjs
npm run build
Pop-Location
```

Dependency Python và web được khóa riêng trong [`foundation_v2/uv.lock`](foundation_v2/uv.lock)
và [`foundation_v2/web/package-lock.json`](foundation_v2/web/package-lock.json).
Build output `foundation_v2/web/dist/` là file sinh lại được.

Để dùng engine Nautilus local, cài runtime tách riêng:

```powershell
uv sync --locked --project foundation_v2/engine_runtime --python 3.12
```

[Clean setup rehearsal](foundation_v2/evidence/wm-all-plan-20261002/clean-setup/CHECKPOINT.md)
đã kiểm trên Windows từ Git-tracked source, Python 3.12.10, Node 24.19.0 và
cache dependency local. Đây là warm-cache setup; chưa xác nhận máy mới không có cache.

Để xem UI bằng dev server, sau khi cài dependency, chạy trong `foundation_v2/web/`:

```powershell
.\node_modules\.bin\vite.cmd --host 127.0.0.1 --port 5173
```

Lệnh này chỉ mở UI. Theo [`vite.config.js`](foundation_v2/web/vite.config.js), các
request `/api` chuyển tới `http://127.0.0.1:8010`, hoặc `TW_V2_API_TARGET` nếu đã đặt.
API cần PostgreSQL local, `TW_V2_DATABASE_URL`, `TW_V2_ARTIFACT_ROOT` và cấu hình
workspace phù hợp với [`create_app`](foundation_v2/trading_workspace_v2/api.py) /
[`authorization`](foundation_v2/trading_workspace_v2/auth.py). Tạo app có thể khởi tạo
schema database; dùng database phát triển riêng. Khi thiếu API/dữ liệu, UI có thể
hiển thị trạng thái trống hoặc lỗi; đó không phải một bản demo hoàn chỉnh.

Advanced Charts mặc định dùng bản local v23.040 đã được owner xác nhận quyền sử dụng
ngày 04/10/2026. Vite dev/preview phục vụ `static/charting_library/` tại
`/charting_library/`; có thể đổi thư mục bằng `TW_V2_CHARTING_LIBRARY_DIR` (đường dẫn
tuyệt đối). Asset phải giữ nguyên cấu trúc bundle/locale của distribution. Không
commit hoặc copy vendor vào build. Khi phục vụ `dist/` bằng server khác, cần mount
distribution được cấp quyền tại cùng URL. Thiếu asset sẽ hiện lỗi và link rollback;
`chart_engine=lightweight` chọn engine cũ rõ ràng.

Chart dùng `visible_rows` của API, không tải giá từ TradingView. Timeframe lớn hơn
được gộp từ prefix này; không tạo nến ở timeframe nhỏ hơn dataset. Layout, indicator
và hình vẽ native lưu trên trình duyệt theo workspace/session/dataset/cutoff;
ghi chú workspace vẫn thuộc API và được hiển thị riêng trên chart. Xem
[checkpoint Advanced Charts](foundation_v2/evidence/ui-advanced-chart-20261004/CHECKPOINT.md).
Chart workspace dùng bố cục Legacy với một header native, thanh replay nổi và
Buy/Sell phía dưới; xem [checkpoint Legacy](foundation_v2/evidence/ui-legacy-chart-20261005/CHECKPOINT.md).

Kho Testing/Prop luyện tập hiện dùng lịch sử Exness demo đã lưu local, tách khỏi QA.
35 assets mặc định đã tải M1 (28 Forex, 2 metals CFD, 3 indices CFD, 2 crypto CFD);
Tab **Market Data** ở cuối sub-header Testing cho tìm trong 356 symbols broker,
lọc nhóm, xem lịch sử đã lưu và mở phiên luyện tập M1/tick. Data Desk vẫn giữ
luồng CSV/provenance; xem [kiểm chứng điều hướng Market Data](foundation_v2/evidence/market-data-nav-20261005/CHECKPOINT.md).
Khi bật collector và MT5
kết nối, API tự tải bù mỗi ngày UTC; session cũ giữ nguyên dataset. Live đọc snapshot
tài khoản/deals khoảng 5 giây, không gửi lệnh. Không cần MT5 để replay dữ liệu đã lưu.
EURUSDm và XAUUSDm đã tải tick Bid/Ask cho khoảng 90 ngày, khoảng 472,6 MiB gồm bản gốc
và kho nén. “Luyện tick” mô phỏng bằng Bid/Ask lịch sử, SL/TP theo tick chạm trước; chart vẫn
hiển thị M1 và khung lớn hơn. Thêm `--ticks` vào launcher đồng bộ để tự tải bù
các ngày UTC đã đóng. Phí lịch sử/gaps và equity Prop trong từng phút chưa được
chứng nhận đầy đủ; xem [tick replay và kiểm chứng](foundation_v2/evidence/tick-replay-20261005/CHECKPOINT.md).
Xem [đồng bộ Testing/Live và cách chạy](foundation_v2/evidence/market-sync-20261005/CHECKPOINT.md)
và [phiên EURUSD ban đầu](foundation_v2/evidence/real-history-20261005/CHECKPOINT.md).
Lệnh replay vẫn mô phỏng; historical costs và gaps còn cần xác minh. Advanced Charts
đã chạy trong Chromium; Codex in-app browser hiện hủy iframe blob, có thông báo lỗi
và link chart dự phòng thay vì tải mãi.

Learn đọc course local khi API được khởi động với cả hai biến sau, bên cạnh cấu
hình database, artifacts và authorization đã có:

```powershell
$env:TW_V2_LEARN_WORKSPACE_ID = 'tenant-a'
$env:TW_V2_EDUCATION_ROOT = 'D:/ANNAM/TradingWorkspace/education'
```

Thay workspace/root theo môi trường của bạn; thiếu một trong hai biến sẽ bị từ
chối. Bridge chỉ đọc course/resources/glossary và progress, không mở answer key
hoặc ghi tiến độ. [Learn ready-flow receipt](foundation_v2/evidence/wm-all-plan-20261002/learn-ready/CHECKPOINT.md)
kiểm course thật qua một API tạm riêng; API đang mở ở8020 vẫn chưa được đổi binding
hoặc restart bởi lượt QA này.

Repo chưa có launcher một nút cho toàn bộ PATH-2. `Start-Windows.bat`,
`Start-macOS.command` và `python workspace_app.py` vẫn chạy **Flask legacy**.
Chi tiết contract/runtime nằm trong [Foundation README](foundation_v2/README.md).

## Trước khi dọn legacy

Không xóa đồng loạt file Python ở gốc. `foundation_v2` đang tái sử dụng
`ai_provider.py`, `ai_service.py`, `data_contracts.py`, `data_costs.py`,
`data_news.py`, `evidence_metrics.py`, `prop_profile.py` và phụ thuộc gián tiếp
`risk_lab.py`. Runtime, test, launcher và tài liệu legacy cần được rà thành từng nhóm
trước khi loại bỏ. `foundation_v2/.runtime/exness-market-data/` hiện chứa dữ liệu
người dùng bền vững; không xóa như artifact kiểm thử.

## License

Mã nguồn ứng dụng theo [MIT License](LICENSE). TradingView Advanced Charts có điều
kiện cấp phép riêng, dùng distribution local được cấp quyền và không được vendored
vào repo. Quyền sử dụng local không là quyền công bố vendor assets.
