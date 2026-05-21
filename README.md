# 📊 Premium Trading Chart & Bar Replay Tool

A professional, high-performance, and feature-rich **TradingView Clone** designed for manual backtesting, bar replay, and strategy analysis. This application runs **natively on both macOS and Windows**, connecting to **MetaTrader 5** via a custom ultra-fast TCP Socket Gateway.

Ứng dụng **giả lập TradingView chuyên nghiệp**, hỗ trợ **Bar Replay (tua nến)** và phân tích kỹ thuật thủ công. Chạy native mượt mà trên **cả macOS và Windows**, kết nối trực tiếp với **MetaTrader 5** thông qua đường truyền mạng cục bộ TCP Socket Gateway tốc độ cao.

---

## ✨ Features / Các tính năng nổi bật

### 1. 🎛️ Multi-Chart Layouts (Hệ thống Đa Biểu đồ)
*   Supports **1, 2 Vertical, 2 Horizontal, and 4 Grid layouts** (TradingView Premium Style).
*   Active chart focusing with unified symbol and timeframe toolbars.
*   **Sync Time & Scroll:** Fully synchronized scrolling and zooming across all charts at 60 FPS.
*   **Sync Crosshair:** Dead-simple crosshair companion lines matching cursor coordinates in real-time.
*   *Hỗ trợ chia lưới 1, 2 cột, 2 dòng, và 4 ô lưới chuyên nghiệp.*
*   *Đồng bộ hóa cuộn, thu phóng (Sync Time/Scroll) và đồng bộ con trỏ chữ thập (Sync Crosshair) tức thời.*

### 2. ⏪ Bar Replay Engine (Bộ tua nến Backtest thủ công)
*   Play, pause, step forward, and adjust playback speed dynamically.
*   Independent bar replay sessions running concurrently on different chart panels.
*   *Tua nến thủ công: Chạy, tạm dừng, tiến từng nến, và chỉnh tốc độ tua nến linh hoạt.*
*   *Chạy tua nến độc lập trên từng biểu đồ con trong chế độ Multi-chart.*

### 3. 🎨 Elite Drawing Tools (Công cụ vẽ Kỹ thuật cao cấp)
*   **Complete Toolset:** Cursor, Trend Line, Ray, Arrow, Extended Line, Horizontal Line, Horizontal Ray, and Rectangle.
*   **Interactive Controls:** Instant select, drag-and-drop entire drawings with zero geometry warping, and quick delete via `Delete`/`Backspace` keys.
*   **Geometric Object Labels:** Double-click any drawing to write annotations, change border width, color, and toggle label visibility (Retina-crisp, screen-aware sticky labels).
*   **Long/Short Position (1-Click Placement):** Place risk/reward boxes instantly. Automatically calculates Stop Loss (100 pips) and Take Profit (200 pips) customized to asset types (FX, Gold, JPY pairs, Crypto). Drag anchors to dynamically update PnL and risk ratio.
*   *Đầy đủ bộ công cụ vẽ: Trendline, Ray, Arrow, Horizontal Ray, Rectangle...*
*   *Tương tác mượt mà: Di chuyển hình vẽ không méo tỷ lệ, xóa nhanh bằng phím tắt Delete.*
*   *Viết chữ lên vật thể vẽ (Double-click hiện Sleek Settings Modal), bám biên màn hình thông minh.*
*   *Công cụ đặt vị thế Long/Short (1-Click): Tự động tính SL/TP theo pipSize riêng biệt của Vàng, FX, JPY, Crypto.*

### 4. 🍏 macOS & Windows Native Support (Hỗ trợ Đa nền tảng Native)
*   **TCP Socket Gateway:** Cross-platform socket architecture allows the Flask server to communicate natively on macOS (with MT5 running inside official Wine wrapper) and Windows without heavy VMs.
*   **Zero CPU Overheating:** Designed using 100% native Python standard libraries (No compiled dependencies, no pandas/numpy required in requirements). Extremely lightweight for older laptops (e.g. Macbook Pro 2017).
*   *Giao tiếp TCP Socket Gateway giúp chạy mượt mà native trên macOS (MT5 chạy qua Wine) và Windows.*
*   *Không gây nóng máy, dung lượng siêu nhẹ (chỉ cần thư viện Flask).*

---

## 🚀 Installation & Setup / Hướng dẫn cài đặt

### Prerequisite / Điều kiện tiên quyết
*   **Python 3.8+** installed on your system.
*   **MetaTrader 5** terminal installed and logged into a demo/live broker account.

---

### 🍏 For macOS Users / Dành cho người dùng Mac

#### 1. Configure WebRequest in MT5 Mac
1.  Open **MetaTrader 5** on macOS.
2.  Go to **Tools** > **Options** (or press `Cmd + O` / `Ctrl + O`).
3.  Navigate to the **Expert Advisors** tab.
4.  Check **"Allow WebRequest for listed URL"**.
5.  Double-click the **"+"** sign and add: `127.0.0.1`. Click **OK**.

#### 2. Install the Expert Advisor (EA)
1.  In MT5, click **File** > **Open Data Folder**.
2.  Navigate to `MQL5/Experts/`.
3.  Copy [MacGateway.mq5](./MacGateway.mq5) from this project and paste it into the `Experts` directory.
4.  Back in MT5, right-click **Expert Advisors** in the *Navigator* side panel and click **Refresh**.
5.  Drag and drop **MacGateway** onto any open chart.
6.  In the EA settings panel, check **"Allow Algo Trading"** and click **OK**.
7.  Click the **Algo Trading** button in the top toolbar to turn the EA's hat icon **green** (Active).

#### 3. Run the Web Application
1.  Open Terminal, navigate to the project directory, and install requirements:
    ```bash
    pip install -r requirements.txt
    ```
2.  Start the Flask server:
    ```bash
    python app.py
    ```
3.  Open your browser and navigate to `http://localhost:5000`.

---

### 💻 For Windows Users / Dành cho người dùng Windows

You can set it up **exactly like the macOS guide** using the TCP Socket Gateway (Recommended, lightweight), or run it natively if you have the `MetaTrader5` package.

#### Method A: TCP Socket Gateway (Same as macOS - Recommended)
1.  Open **MetaTrader 5** on Windows.
2.  Go to **Tools** > **Options** > **Expert Advisors** > Enable **WebRequest** for `127.0.0.1`.
3.  Copy [MacGateway.mq5](./MacGateway.mq5) into your MT5's `MQL5/Experts/` folder, refresh and drag it onto a chart (Enable **Algo Trading**).
4.  Run `pip install -r requirements.txt` and `python app.py`.

---

## 🛠️ Technology Stack / Công nghệ sử dụng

*   **Frontend:** HTML5, Vanilla CSS3 (Glassmorphism design system), JavaScript (ES6+), [TradingView Lightweight Charts v5.2.0](https://github.com/tradingview/lightweight-charts), Custom Label Overlay Renderers.
*   **Backend:** Python 3 (Flask), Standard Socket and Threading libraries.
*   **MetaTrader 5 Bridge:** MQL5 Network Sockets (Non-blocking high-frequency timers).

---

## 📝 License / Bản quyền

This project is licensed under the **MIT License** - see the [LICENSE](./LICENSE) file for details.

*Dự án được phân phối tự do dưới giấy phép MIT License.*
