# MT5 TradingView Backtester

Workspace local để nghiên cứu, backtest, luyện replay và quản lý bằng chứng giao dịch.
**Hướng phát triển hiện tại là PATH-2 trong [`foundation_v2/`](foundation_v2/README.md).**
Flask/EA cũ được giữ để đối chiếu và tái sử dụng logic, xem [tài liệu legacy](docs/legacy-flask-reference.md).

## Bắt đầu ở đâu

| Phần | Nơi làm việc hiện tại |
| --- | --- |
| Backend | [`foundation_v2/trading_workspace_v2/`](foundation_v2/trading_workspace_v2/): FastAPI, PostgreSQL, API theo workspace, dataset/result bất biến |
| UI | [`foundation_v2/web/`](foundation_v2/web/): React, Vite, Lightweight Charts và shell WMReplay |
| Engine research | [`foundation_v2/engine_runtime/`](foundation_v2/engine_runtime/pyproject.toml): runtime Nautilus tách riêng |
| Test và bằng chứng | [`foundation_v2/tests/`](foundation_v2/tests/), [`foundation_v2/evidence/`](foundation_v2/evidence/) |
| Logic được dùng lại | [`retained.py`](foundation_v2/trading_workspace_v2/retained.py) khai báo các module Python gốc mà PATH-2 vẫn cần |
| Runtime cũ | `workspace_app.py`, `app.py`, `templates/`, `static/`, launcher Windows/macOS; xem [tham chiếu Flask](docs/legacy-flask-reference.md) |

Luồng dữ liệu chính: dataset đã kiểm tra → manifest bất biến → research job → worker
có giới hạn → result bất biến → API theo workspace → UI. Replay chỉ được thấy dữ liệu
đến vị trí hiện tại; màn hình và kết quả mô phỏng không cấp quyền gửi lệnh broker.

## Trạng thái hiện tại

Tại ngày **01/10/2026**, các lát chức năng và UI local đã có kiểm chứng, nhưng
**sản phẩm chưa hoàn tất** (`SAFE_SLICES_EXECUTED / FULL_PRODUCT_NOT_COMPLETE`).

- Shell vẫn bật `SHELL_SKELETON_MODE = true` trong [`FxReplayShell.jsx`](foundation_v2/web/src/FxReplayShell.jsx); chưa quảng bá giao diện replay full-bleed thành bản hoàn tất.
- Các gate UI còn mở gồm native zoom, axe/WCAG, bộ ảnh chuẩn được duyệt và nghiệm thu bộ nhớ chạy dài. Test/build hoặc một bộ ảnh pass không tự đóng các gate này.
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
TradingView Advanced Charts để build UI PATH-2.

```powershell
uv sync --project foundation_v2 --python 3.12
Push-Location .\foundation_v2\web
npm ci
node --test tests/*.test.mjs
npm run build
Pop-Location
```

Dependency Python và web được khóa riêng trong [`foundation_v2/uv.lock`](foundation_v2/uv.lock)
và [`foundation_v2/web/package-lock.json`](foundation_v2/web/package-lock.json).
Build output `foundation_v2/web/dist/` là file sinh lại được.

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

Repo chưa có launcher một nút cho toàn bộ PATH-2. `Start-Windows.bat`,
`Start-macOS.command` và `python workspace_app.py` vẫn chạy **Flask legacy**.
Chi tiết contract/runtime nằm trong [Foundation README](foundation_v2/README.md).

## Trước khi dọn legacy

Không xóa đồng loạt file Python ở gốc. `foundation_v2` đang tái sử dụng
`ai_provider.py`, `ai_service.py`, `data_contracts.py`, `data_costs.py`,
`data_news.py`, `evidence_metrics.py`, `prop_profile.py` và phụ thuộc gián tiếp
`risk_lab.py`. Runtime, test, launcher và tài liệu legacy cần được rà thành từng nhóm
trước khi loại bỏ; `.runtime/` chỉ dành cho state kiểm thử local, không đặt dữ liệu người dùng ở đó.

## License

Mã nguồn theo [MIT License](LICENSE). TradingView Advanced Charts thuộc runtime
legacy, không được vendored vào repo và có điều kiện cấp phép riêng.
