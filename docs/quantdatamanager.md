# QuantDataManager trong Trading Workspace

Adapter dùng QDM **125.2692**, M1, UTC. UI ghi **Nguồn dữ liệu: Dukascopy** và
**Công cụ tải: QuantDataManager (QDM) · CLI**. CLI là giao diện dòng lệnh mà backend
gọi. API của Workspace điều phối job; không gọi QDM là một nguồn giá hoặc một
API HTTP. Danh mục đọc trực tiếp định nghĩa Dukascopy
trong bộ cài QDM: hiện có **725 tài sản**, gồm 64 Forex (có vàng/bạc), 13 hàng hoá,
19 chỉ số, 625 cổ phiếu, 1 crypto và 3 trái phiếu. Đây là danh mục của nguồn
Dukascopy trong QDM, chưa bao gồm mọi nguồn bên ngoài mà QDM có thể kết nối.

**Backtest và Prop firm là hai mode riêng, dùng chung danh mục và dataset giá.**
Backtest giữ cấu hình mô phỏng/chi phí; Prop firm bổ sung bộ quy tắc quỹ và phase.
Mỗi phiên pin dataset/version và cấu hình riêng. Đổi mode hoặc chọn FTMO 1-Step/
2-Step không tạo bản sao danh mục, không bắt tải lại lịch sử.

Giữ transport identity `provider=QuantDataManager` bên trong adapter/job và các
manifest đã lưu để update/resume không nhầm sang dukascopy-node. Catalog/download
API bổ sung `data_source=Dukascopy`, `download_engine=QuantDataManager`; export
provenance giữ upstream và engine. UI lọc theo nguồn giá, ghép job/khả năng tải
theo engine. Dataset QDM cũ vẫn hiển thị Dukascopy, không viết lại manifest/hash.

## Cài trên máy sau khi clone GitHub

1. Tải QDM từ [StrategyQuant](https://strategyquant.com/quantdatamanager/), giải
   nén toàn bộ distribution vào `foundation_v2/.runtime/quantdatamanager/`.
   Thư mục này phải chứa `qdmcli.exe` và `QuantDataManager.exe`.
2. Mở `open-qdm.bat`, kích hoạt bằng license của bạn nếu ứng dụng yêu cầu, rồi
   đóng GUI trước khi tải trên web. QDM chỉ chạy một instance trong cùng bộ cài.
3. Chuẩn bị Python/PostgreSQL theo README. `restart-offline-api.bat` nạp engine
   QDM mặc định. Không chạy restart khi đang có lượt tải; helper sẽ từ chối.

Bộ cài đang dùng được chuyển từ `D:/ANNAM/Tools/QuantDataManager` vào đường dẫn
runtime trên. Code adapter, test, launcher và hướng dẫn được quản lý bằng Git.
`.runtime/` được ignore: executable, license, cookies, log và dữ liệu giá không
được upload. Clone repo cần cài QDM riêng, không chứa bản phân phối của hãng.
Xem [điều khoản license](https://strategyquant.com/wp-content/uploads/2025/11/SQ_License_and_Service_Terms.pdf).

Có thể dùng bộ cài tại vị trí khác qua `--qdm-home <absolute-path>`. Adapter không
đọc file license, không thay đổi activation, không cần Trading Tools API key.

## Luồng tải và cập nhật

Các lớp cấu hình dành cho backtest/prop firm cần giữ rõ:

| Phần | Cấu hình nhập giá | Khi mô phỏng broker/prop |
| --- | --- | --- |
| Công cụ tải | QuantDataManager | Giữ provenance công cụ và upstream |
| Data source | Dukascopy | Là nguồn giá; Broker Profile không biến giá này thành giá của quỹ |
| Instrument | Mã từ danh mục QDM; Forex hiển thị EUR/USD, mã khác giữ mã nguồn; symbol riêng `<code>_TW` | Tick/pip, contract size, lot step/min, tiền tệ phải theo tài khoản mục tiêu |
| Timeframe/timezone | M1, UTC; symbol mới tạo với startofbar | Nến lớn hơn có thể gộp; timezone/DST/session của broker được áp rõ ở mô phỏng |
| Broker Profile | Symbol mới dùng SQ Default nội bộ QDM; chỉ nhập OHLC/volume | Spread, commission, swap, slippage, leverage và session cần cấu hình riêng |
| Prop rules | Chưa gán | Theo quỹ/gói: daily reset timezone, daily/max drawdown, target và hạn chế giao dịch |

Adapter nhập `metadata_kind=price_only`, không lấy contract size hoặc spread mặc
định của QDM làm quy cách broker. Export CSV không mang toàn bộ Broker Profile.
Chọn Broker Profile trong QDM/SQ cũng không tự truyền các quy tắc drawdown/target
vào Trading Workspace. M1 không chứa đường đi tick/Bid–Ask đầy đủ nên không thể
khẳng định thứ tự SL/TP trong cùng nến; chỉ áp mô hình execution đã khai báo.

Để tải giá và nghiên cứu backtest chung, dùng SQ Default cùng Instrument mặc định
**của từng tài sản** (EURUSD, XAUUSD, USATECHIDXUSD…), không dùng một bộ thông số
Forex chung cho tất cả. Đây là default ở bước QDM download. Workspace hiện chỉ
nhập price-only; bộ replay execution nhận InstrumentSpec/cost_model từ cấu hình
phiên, chưa tự nhập default QDM. Khi mô phỏng broker/FTMO cần profile và quy cách
của tài khoản mục tiêu; tên SQ Default không chứng nhận kết quả sát broker.

[Broker Profiles của StrategyQuant](https://strategyquant.com/doc/strategyquant/broker-profiles/)
mô tả khác biệt timezone, instrument và trading session, cùng giới hạn rằng
profile không sửa khác biệt giá giữa nguồn và broker. Một dataset giá có thể
được nghiên cứu với nhiều profile, nhưng mỗi kết quả phải pin profile/cost/rules
riêng; chưa có UI cấu hình profile QDM/prop trong lát tích hợp này.

Owner chọn mục tiêu **FTMO, MT5, cả 1-Step và 2-Step**. Giữ cache giá Dukascopy/QDM ở UTC,
gắn profile FTMO ở session/backtest; không tải lại cùng lịch sử chỉ để đổi quỹ.
Thông số cần đối chiếu với tài khoản MT5 mục tiêu: contract size, tick size/value,
lot min/step, margin/leverage, commission/swap, spread/slippage và trading session.
[FTMO Symbol Specifications](https://ftmo.com/en/symbols/) là nguồn tham khảo;
thông số tài khoản thực tế trong terminal cần được xác minh riêng, chưa đọc tại đây.

Theo [FTMO account specifications](https://ftmo.com/en/faq/what-are-the-account-specifications/),
MT5 dùng GMT+2 + DST. Theo [Trading Objectives](https://ftmo.com/en/trading-objectives/),
daily loss reset theo 00:00 CE(S)T (Prague); không gộp hai đồng hồ này thành UTC
hoặc cùng một midnight của server. Hiển thị dd/mm/yyyy, HH:mm vẫn giữ nhãn timezone.
Hai cấu hình mục tiêu theo tài liệu được kiểm tra ngày 08/10/2026:

| Rule đánh giá | FTMO 1-Step | FTMO 2-Step |
| --- | --- | --- |
| Các phase | Challenge | Challenge → Verification |
| Profit target | 10% | 10% → 5% |
| Daily loss | 3% vốn ban đầu | 5% vốn ban đầu |
| Max loss | 10%, trailing theo balance cuối ngày | 10%, ngưỡng cố định |
| Minimum trading days | Không đặt minimum | 4 ngày mỗi phase |
| Best Day | Tối đa 50% tổng lợi nhuận của các ngày lãi | Không có rule này |
| Reset ngày | 00:00 Europe/Prague | 00:00 Europe/Prague |

Best Day vượt 50% ngăn kết luận pass, không phải breach khiến fail. Daily floor
được neo theo balance đầu ngày, còn kiểm vi phạm theo equity có chi phí/floating.
Không lấy cùng một công thức tổng drawdown cho hai gói. Snapshot rule phải pin
phiên bản/ngày kiểm tra; không tự đổi rule của attempt đang chạy nếu hãng cập nhật.

Đây là cấu hình mục tiêu, **chưa là hai preset FTMO chạy trong evaluator**.
Review code hiện tại thấy daily reset anchor đi theo basis balance/equity của
LossRule, trong khi FTMO cần anchor balance và đánh giá equity riêng. Chưa có
Best Day evaluator. Không đổi tên Generic practice thành FTMO hoặc coi chọn
Broker Profile QDM là đã đánh giá đủ FTMO. Việc nối rule vào session/evaluator
cần lát triển khai và kiểm chứng riêng; adapter QDM đã hoàn thành scope tải giá.
Account Standard/Swing, size/currency và server cụ thể vẫn chưa chọn; chi phí
và quy cách broker không được lấy mặc định để tuyên bố backtest FTMO chính xác.

Nút tải → job lưu trên đĩa → CLI quản lý symbol `<code>_TW` → QDM cập nhật lịch sử
→ xuất CSV UTC tự động → chuẩn hoá → kiểm tra → đăng ký dataset bất biến trong
workspace. CSV là bước nội bộ, người dùng không phải export/import bằng tay.
Adapter chỉ gọi lệnh cho symbol của integration, không cập nhật toàn bộ kho QDM.

QDM `action=update` thực tế tải lịch sử đầy đủ dù truyền giới hạn ngày. Adapter
để QDM quản lý cache và chỉ giới hạn ngày ở bước export. Lần tải đầu có thể lâu;
thời gian còn gồm bước ghi dữ liệu vào QDM, không chỉ tốc độ Internet. Trong lượt
kiểm chứng local, log chỉ ra transport qua `cdn.strategyquantcdn.com`; không suy
ra mọi license/phiên bản đều dùng cùng route hoặc có cùng tốc độ.

Cập nhật dataset chỉ xuất phần ngày mới và nối với bản nguồn đã kiểm hash; dataset
cũ/phiên replay đang dùng nó được giữ nguyên. Ngày hiện tại UTC không được nhập.
Các kiểm tra không tự chứng nhận dữ liệu không có gap: cờ `review` vẫn được giữ.

QDM báo phần trăm theo **bước hiện tại**, không phải tổng tiến độ. Dung lượng tải,
tốc độ mạng và ETA chưa có dữ liệu đáng tin nên hiển thị `—`. Chưa xác minh API
tạm dừng/huỷ an toàn giữa lúc QDM ghi file; hai nút này bị vô hiệu trong adapter.

Nếu API/mạng bị ngắt, job không được công nhận hoàn thành khi chưa qua import.
Thử lại sẽ gọi QDM update từ cache của hãng rồi export lại; adapter không hứa
resume chính xác từng byte hoặc tự retry vô hạn. Nếu child CLI còn chạy, QDM
trả busy: chờ nó xong trước khi thử lại. Không kill QDM giữa lúc ghi database.
Giá QDM được ghi `provider_default`, chưa gán Bid/Ask khi chưa có bằng chứng.

Refresh đọc lại `internal/plugins/DataSourceDukascopy/dukascopy.csv` trong bộ cài
QDM (Windows-1252 hoặc UTF-8). Không gọi CLI, không cần Internet và không tự
download bản danh mục mới từ hãng; cập nhật bộ cài QDM rồi refresh để nhận thay
đổi của hãng. Có thể xem danh mục khi GUI QDM đang mở; tải cần CLI rảnh và license
hợp lệ. CLI/version được kiểm tra khi tải. Ngày bắt đầu M1/tick và nhóm tài sản
theo metadata của QDM, chưa chứng minh mọi asset có dữ liệu đầy đủ đến hôm qua.

Danh sách/metadata tải được thay cùng một snapshot sau khi kiểm tra toàn bộ file;
không giữ mapping EUR/USD hard-code. Refresh lỗi giữ danh sách tốt cuối cùng để
xem và báo stale; tạm khoá tải mới đến khi refresh thành công. Restart đọc lại
định nghĩa trên đĩa; không tạo nguồn danh mục thứ hai hoặc commit CSV của hãng.
Job pin mã nguồn và hash danh mục để một lượt tải không đổi mapping khi refresh.

QDM CLI 125.2692 có thể báo exit thành công nhưng không tạo symbol nếu truyền
`broker=SQ Default` có dấu cách. Adapter bỏ tham số này, dùng mặc định SQ Default,
để QDM tạo instrument đúng theo mã nguồn và kiểm tra lại symbol sau lệnh add.
Symbol mới chưa có records có timezone trống; chỉ chấp nhận trống khi records=0,
kiểm tra lại sau update và export UTC rõ ràng. Không sửa symbol sai cấu hình.
Đã kiểm CLI tạo/nhận diện `USATECHIDXUSD_TW` và `AAPLUSUSD_TW`; chưa tải/kiểm chứng
lịch sử của tất cả 725 tài sản. Lượt import thật EUR/USD và import chỉ số bằng
fixture là bằng chứng riêng, không gọi toàn bộ danh mục đã xác minh dữ liệu.

## Kiểm tra và rollback

```powershell
.\foundation_v2\.venv\Scripts\python.exe -m unittest discover -s foundation_v2/tests -p test_qdm_downloads.py
# Opt-in: có thể tải full history vào cache QDM; DB thử được tạo/xoá riêng.
$env:TW_V2_QDM_HOME = (Resolve-Path foundation_v2/.runtime/quantdatamanager).Path
.\foundation_v2\.venv\Scripts\python.exe -m unittest discover -s foundation_v2/tests -p test_qdm_cli_integration.py
```

Test CLI thật cần `TW_V2_DATABASE_URL` loopback với quyền tạo database thử.
Không chạy SQL truncate trên database người dùng. Receipt:
[QDM pilot](../foundation_v2/evidence/qdm-integration-20261008/RECEIPT.md).
Catalog mở rộng: [receipt](../foundation_v2/evidence/qdm-catalog-20261008/RECEIPT.md).

Rollback engine: dừng API offline khi không có job active, chạy launcher với
`--download-engine dukascopy`. Không xoá dữ liệu/cache của engine còn lại:

```powershell
Push-Location foundation_v2
.\.venv\Scripts\python.exe scripts/serve_exness_history.py --port 8010 --download-engine dukascopy
Pop-Location
```

CLI là giao diện chính thức cho script/external program:
[Introduction](https://strategyquant.com/doc/cli-command-line/introduction-to-cli/),
[Data commands](https://strategyquant.com/doc/cli-command-line/data-manage-data/).
Tài liệu dùng `sqcli.exe`; với QDM dùng `qdmcli.exe` và kiểm tra `-h` của bản cài.
