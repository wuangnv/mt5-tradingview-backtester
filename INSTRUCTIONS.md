# HƯỚNG DẪN CÀI ĐẶT VÀ SỬ DỤNG MT5 TRADINGVIEW BACKTESTER
*(Dành cho cả Windows và macOS)*

---

## 📌 MỤC LỤC
1. [Giới Thiệu Tổng Quan](#1-giới-thiệu-tổng-quan)
2. [Yêu Cầu Hệ Thống](#2-yêu-cầu-hệ-thống)
3. [Cài Đặt & Khởi Chạy 1-Click](#3-cài-đặt--khởi-chạy-1-click)
   - [Trên macOS](#31-trên-macos)
   - [Trên Windows](#32-trên-windows)
4. [Cấu Hình MetaTrader 5 (MT5)](#4-cấu-hình-metatrader-5-mt5)
   - [Cài đặt MT5Gateway EA (Khuyên dùng cho cả Win & Mac)](#41-cài-đặt-mt5gateway-ea-khuyên-dùng-cho-cả-win--mac)
   - [Dùng Native MT5 trên Windows (Tùy chọn)](#42-dùng-native-mt5-trên-windows-tùy-chọn)
5. [Hướng Dẫn Tính Năng Giao Diện TradingView Web](#5-hướng-dẫn-tính-năng-giao-diện-tradingview-web)
   - [Top Header Bar](#51-top-header-bar-thanh-công-cụ-trên-cùng)
   - [Quick Trading Widget (Kéo thả & Thu gọn)](#52-quick-trading-widget-kéo-thả--thu-gọn)
   - [Right Dock & Order Ticket Drawer](#53-right-dock--order-ticket-drawer)
   - [Bottom Dashboard 2 Tầng](#54-bottom-dashboard-2-tầng)
   - [Bar Replay (Tua Nến Luyện Tập)](#55-bar-replay-tua-nến-luyện-tập)
   - [Tải & Lưu Trữ Dữ Liệu Nến Lịch Sử](#56-tải--lưu-trữ-dữ-liệu-nến-lịch-sử)
6. [Xử Lý Lỗi Thường Gặp (Troubleshooting)](#6-xử-lý-lỗi-thường-gặp-troubleshooting)

---

## 1. GIỚI THIỆU TỔNG QUAN

**MT5 TradingView Backtester** là công cụ backtest thủ công (manual backtest) và luyện tập giao dịch (bar replay) chuyên nghiệp với giao diện chuẩn **TradingView Web 1:1**, kết nối dữ liệu trực tiếp với **MetaTrader 5 (MT5)**.

### Điểm nổi bật:
- **Chuẩn TradingView Web 100%**: Top Bar tinh tế, Quick Trade Widget góc trái, Right Dock gọn gàng, Bottom Dashboard 2 tầng.
- **Cross-Platform**: Chạy mượt mà trên cả **macOS** (Apple Silicon M1/M2/M3/M4 & Intel) và **Windows 10/11**.
- **Chuyển Khung Thời Gian Siêu Tốc**: Bộ đệm nến thông minh kết hợp chia nhỏ chunks, chuyển giữa `1m, 5m, 15m, 30m, 1h, 4h, D, W` tức thì không độ trễ.
- **Bar Replay Đỉnh Cao**: Nhảy đến ngày bất kỳ, phát/dừng, tua từng nến, điều chỉnh tốc độ, phím tắt trực quan.
- **Quản Lý Vị Thế & Rủi Ro**: Đặt lệnh Market/Pending, Stop Loss, Take Profit theo Pips, USD, R:R Calculator.

---

## 2. YÊU CẦU HỆ THỐNG

- **Hệ điều hành**: macOS 11+ hoặc Windows 10/11.
- **Python**: Python 3.8 đến 3.12 (khuyên dùng Python 3.10 hoặc 3.11).
- **MetaTrader 5**: Bản cài đặt bất kỳ của sàn giao dịch (Exness, IC Markets, XM, FTMO...).
- **Trình duyệt**: Google Chrome, Microsoft Edge, Safari, Firefox, Brave...

---

## 3. CÀI ĐẶT & KHỞI CHẠY 1-CLICK

### 3.1. Trên macOS

1. Mở thư mục dự án trên Mac.
2. Nhấp đúp (Double-click) vào file:
   ```bash
   Start-macOS.command
   ```
3. Script sẽ tự động:
   - Tạo môi trường ảo Python (`.venv`).
   - Cài đặt thư viện cần thiết (`Flask`).
   - Khởi động server backend và tự động mở trình duyệt tại `http://localhost:5000` (hoặc `5001` nếu cổng 5000 đang bận).
4. Để tắt ứng dụng: Nhấn nút Power trên góc phải giao diện web hoặc nhấn `Ctrl + C` trong cửa sổ Terminal.

> **Mẹo**: Nếu hệ điều hành báo file chưa được cấp quyền, mở Terminal và gõ:
> ```bash
> chmod +x Start-macOS.command scripts/macos_start.sh
> ```

---

### 3.2. Trên Windows

1. Mở thư mục dự án trên Windows.
2. Nhấp đúp (Double-click) vào file:
   ```cmd
   Start-Windows.bat
   ```
3. Script sẽ tự động chạy qua PowerShell, kiểm tra Python, tạo virtualenv, cài dependencies và mở trình duyệt.
4. Hoặc bạn có thể mở `cmd` / `PowerShell` tại thư mục và gõ:
   ```cmd
   python app.py
   ```

---

## 4. CẤU HÌNH METATRADER 5 (MT5)

### 4.1. Cài đặt MT5Gateway EA (Khuyên dùng cho cả Win & Mac)

EA `MT5Gateway.mq5` (hoặc `MacGateway.mq5`) là cầu nối Socket TCP tốc độ cao (`127.0.0.1:9000`), tương thích 100% trên mọi nền tảng.

#### Các bước thiết lập:
1. Mở phần mềm **MetaTrader 5**.
2. Trên menu MT5, chọn **File** -> **Open Data Folder** (Mở thư mục dữ liệu).
3. Vào thư mục: `MQL5` -> `Experts`.
4. Copy file `MT5Gateway.mq5` (hoặc `MacGateway.mq5`) từ thư mục dự án vào đây.
5. Mở **Tools** -> **Options** (hoặc phím tắt `Ctrl + O`), chọn tab **Expert Advisors**:
   - Tích chọn: **Allow algorithmic trading** (Cho phép giao dịch tự động).
   - Tích chọn: **Allow WebRequest for listed URL**.
   - Bấm **Add new URL** và thêm:
     ```text
     http://127.0.0.1
     http://localhost
     ```
   - Bấm **OK**.
6. Trong cửa sổ **Navigator** của MT5 (`Ctrl + N`), tìm mục **Expert Advisors**, click chuột phải chọn **Refresh**.
7. Kéo thả `MT5Gateway` vào bất kỳ biểu đồ nến nào đang mở.
8. Trong hộp thoại hiện ra, kiểm tra tab **Common** -> tích chọn **Allow Algo Trading** -> bấm **OK**.
9. Khi kết nối thành công, terminal MT5 sẽ in dòng chữ:
   ```text
   [SocketServer] MT5 EA connected successfully!
   ```
   Đồng thời đèn trạng thái trên Web UI sẽ chuyển sang **MT5 Connected** màu xanh lá.

---

### 4.2. Dùng Native MT5 trên Windows (Tùy chọn)

Nếu bạn đang dùng Windows và muốn kết nối trực tiếp không cần kéo thả EA:
1. Mở Terminal / PowerShell và cài đặt thư viện MT5 chính thức:
   ```cmd
   pip install MetaTrader5
   ```
2. Chỉ cần mở MetaTrader 5 và đăng nhập tài khoản.
3. Khi khởi chạy `app.py`, ứng dụng sẽ tự động nhận diện và kết nối trực tiếp với tài khoản MT5 đang mở!

---

## 5. HƯỚNG DẪN TÍNH NĂNG GIAO DIỆN TRADINGVIEW WEB

### 5.1. Top Header Bar (Thanh công cụ trên cùng)
- **Symbol Pill**: Hiển thị Ticker (VD: `EURUSD`), sàn (`MT5`), Timeframe (`H1`). Bấm vào để mở bảng tìm kiếm nhanh biểu đồ.
- **Cụm Timeframe chuẩn**: `1m, 5m, 15m, 30m, 1h, 4h, D, W`. Click đổi khung giờ trong tích tắc.
- **Chỉ báo (fx)**: Mở bảng thêm các chỉ báo kỹ thuật (RSI, MACD, Bollinger Bands, Moving Average...).
- **Bar Replay**: Bật/tắt thanh công cụ tua nến.
- **Layout**: Chia lưới 1 biểu đồ, 2 biểu đồ hoặc 4 biểu đồ cùng lúc.
- **Data Mode**: Chuyển đổi giữa chế độ `Backtest` (sử dụng dữ liệu offline đã tải) và `Live` (truyền dữ liệu trực tiếp từ MT5).
- **Header Actions Phía Phải**:
  - Tìm kiếm symbol nhanh.
  - Bật/tắt toàn màn hình.
  - Chụp ảnh biểu đồ (Snapshot).
  - Thoát ứng dụng và tắt server an toàn.

---

### 5.2. Quick Trading Widget (Kéo thả & Thu gọn)
- Nằm ở góc trên bên trái vùng biểu đồ, hiển thị giá **SELL** (đỏ) và **BUY** (xanh) nhảy theo thời gian thực.
- **Kéo thả tự do (Draggable)**: Giữ chuột vào biểu tượng tay nắm ở đầu widget để kéo đến bất kỳ vị trí nào trên màn hình. Vị trí kéo sẽ được trình duyệt tự động ghi nhớ!
- **Thu gọn (Minimize)**: Click nút mũi tên nhỏ để thu gọn thành thanh mini khi muốn mở rộng tối đa tầm nhìn biểu đồ.
- **Ô nhập Volume**: Nhập số Lots (VD: `0.10`), tự động đồng bộ hai chiều với bảng Order Ticket.

---

### 5.3. Right Dock & Order Ticket Drawer
Thanh Dock dọc 45px sát mép phải màn hình gồm 3 chức năng chính:
1. **Order Ticket**: Bấm để trượt mở bảng đặt lệnh chi tiết:
   - Chọn loại lệnh: **Market** (Thị trường) hoặc **Pending** (Limit / Stop).
   - Tùy chỉnh **Stop Loss (SL)** và **Take Profit (TP)** theo Giá (Price), Số pips, hoặc Số tiền rủi ro ($ USD).
   - Tự động tính toán tỷ lệ R:R (Risk/Reward) trước khi vào lệnh.
   - Bấm nút to **CONFIRM BUY / SELL** để thực thi lệnh.
2. **Playbook**: Quản lý chiến lược, kịch bản giao dịch và ghi chú nhật ký.
3. **Tải Lịch Sử**: Mở cửa sổ tải dữ liệu nến MT5 nhiều khung thời gian để luyện tập backtest offline.

---

### 5.4. Bottom Dashboard 2 Tầng
Bảng điều khiển đáy màn hình được thiết kế 2 tầng phân tách theo chuẩn TradingView:
- **Tầng Trên (Tabs Strip)**:
  - Tab `Trading Panel` (kèm badge hiển thị số lệnh đang mở).
  - Tab `Strategy Tester` và `Pine Editor / Notes`.
  - Thông số tài khoản thời gian thực: **Balance**, **Equity**, **Margin**, **Free Margin**.
  - Nút mũi tên Chevron để thu gọn bảng dữ liệu về 60px, giải phóng không gian cho nến.
- **Khu Vực Bảng Dữ Liệu**:
  - Xem chi tiết danh sách vị thế đang mở (**Positions**), lệnh chờ (**Orders**), và lịch sử giao dịch (**History**).
  - Đóng lệnh từng phần hoặc đóng toàn bộ chỉ với 1 click.
- **Tầng Dưới (Status Strip)**:
  - Dải chọn thời gian: `1D`, `5D`, `1M`, `3M`, `6M`, `YTD`, `1Y`, `ALL`.
  - Bộ chuyển thang đo giá: `%` (Percentage), `log` (Logarithmic), `auto` (Auto Scale).
  - Đồng hồ thời gian thực: Giờ GMT+7 đếm giây chính xác (`UTC+7`).
  - Đèn trạng thái thị trường: `Market Open`.

---

### 5.5. Bar Replay (Tua Nến Luyện Tập)
- Bấm biểu tượng Replay trên Top Bar để mở thanh công cụ tua nến nổi.
- **Jump**: Click nút Jump rồi click vào một cây nến bất kỳ trong quá khứ để bắt đầu backtest từ thời điểm đó.
- **Play / Pause (Phím Space)**: Chạy hoặc tạm dừng tua nến tự động.
- **Step Forward (Phím mũi tên phải)**: Tua từng cây nến về phía trước.
- **Speed Slider**: Điều chỉnh tốc độ tua nến từ 0.1s đến 2.0s mỗi cây nến.
- **Date Jump**: Nhập ngày giờ cụ thể để nhảy tức thì đến mốc thời gian mong muốn.

---

### 5.6. Tải & Lưu Trữ Dữ Liệu Nến Lịch Sử
- Bấm icon Tải Lịch Sử trên Right Dock để mở hộp thoại **Tải Dữ Liệu Nến**.
- Chọn cặp tiền (VD: `EURUSD`, `XAUUSD`, `BTCUSD`...) và số lượng nến (VD: 5,000 đến 100,000 nến).
- Bấm **Download**. Hệ thống tự động chia nhỏ thành các chunks và lưu vào thư mục `data/` trong máy tính của bạn.
- Sau khi tải, bạn có thể backtest hoàn toàn offline không cần mạng Internet hay kết nối MT5!

---

## 6. XỬ LÝ LỖI THƯỜNG GẶP (TROUBLESHOOTING)

### Lỗi 1: Cổng 5000 bị chiếm (Port 5000 already in use)
- **Trên macOS**: macOS Monterey trở lên mặc định bật tính năng **AirPlay Receiver** trên cổng 5000.
  - *Cách 1*: Ứng dụng đã tự động phát hiện và chuyển sang cổng **5001** (truy cập `http://localhost:5001`).
  - *Cách 2*: Vào **System Settings** -> **General** -> **AirDrop & AirPlay** -> Tắt **AirPlay Receiver**.
- **Trên Windows**: Ứng dụng sẽ tự động chọn cổng 5001 nếu cổng 5000 bận.

### Lỗi 2: Web báo "No connection from MT5 EA"
- Kiểm tra xem MT5 đã được bật chưa.
- Kiểm tra xem EA `MT5Gateway` đã được kéo thả vào chart và có biểu tượng mặt cười (hoặc nút Algo Trading màu xanh) chưa.
- Kiểm tra phần Options của MT5 đã cho phép WebRequest cho `http://127.0.0.1` chưa.

### Lỗi 3: Biểu đồ không tải được nến TradingView
- Đảm bảo thư mục `static/charting_library/` chứa đầy đủ các file của thư viện TradingView Charting Library (đặc biệt là file `charting_library.standalone.js`).

---
*Chúc bạn có những trải nghiệm backtest và luyện tập giao dịch hiệu quả nhất!*
