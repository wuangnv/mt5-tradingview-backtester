# Frontend metrics và production probe

Phạm vi P0/P2-c: đo cục bộ có bật chủ động, dùng lại Performance API của browser; không thêm telemetry hoặc framework. `web/src/frontendPerformance.js` mặc định tắt, không đọc account/workspace/session ID, không giữ URL/path, nội dung response, token hoặc lỗi nghiệp vụ; không ghi local/session storage, không upload. Chỉ giữ tối đa 200 mẫu/timer (mặc định 100), tổng resource/bytes và thời gian. Dừng hoặc bật lại sẽ disconnect observer và bỏ timer cũ.

API cho caller:

```js
import { startFrontendPerformance, frontendPerformance } from '../../../web/src/frontendPerformance.js'
const perf = startFrontendPerformance({ enabled: true })
const ready = perf.beginNavigation('overview')
// Gọi sau khi dữ liệu hợp lệ đã render, không ngay khi mount loading skeleton.
ready('ready')
const finished = frontendPerformance().beginDomain('api-read')
finished('ready', 1024) // Byte response nếu caller biết; không truyền nội dung.
const localSnapshot = perf.snapshot()
perf.stop()
```

Route/domain/status có allowlist. Domain gồm `api-read`, `dashboard-read`, `analytics-project`, `chart-history`, `history-decode`, `worker-progress`; route lạ chỉ được ghi `other`, domain lạ bỏ qua. `measure(domain, asyncTask)` giữ nguyên kết quả/lỗi của công việc, ghi thời gian và outcome đã chuẩn hóa. Người dùng bật qua UI/query chỉ nên bật cờ boolean; đừng dùng URL hiện tại làm nhãn metric. Caller phải gọi end khi thành công/lỗi/hủy; buffer timer vẫn có giới hạn nếu caller bỏ sót. HMR/unmount phải gọi `stop()`.

`maxInteractionMs` là maximum của native event entries, không phải thuật toán INP; `layoutShiftSum` là tổng shift không có recent input, không phải CLS theo session window. LCP/navigation là metric của document; navigation-content-ready đo route do caller xác định. Resource bytes có thể bằng 0 do cache/TAO; decoded bytes không phải lượng truyền mạng. Các field có giá trị 0 không tự chứng minh browser hỗ trợ observer loại đó; snapshot ghi `supportedEntryTypes` đã observe thành công để diễn giải kết quả.

## Kiểm chứng

Từ `foundation_v2/web`:

```powershell
node --test tests/frontendPerformance.test.mjs tests/frontendProductionProbe.test.mjs
node frontendProductionProbe.mjs --dist ../.runtime/frontend-research-20261009/dist --samples 30 --output ../evidence/frontend-implementation-20261009/metrics/production-fixture.json
```

6 test collector và 1 test phân biệt static/dynamic import pass. Bao phủ disabled, privacy/allowlist, buffer/timer bounds, immutable snapshot, cleanup, kết quả/lỗi không đổi, byte bất hợp lệ, distinction INP/CLS. [browser-collector.json](browser-collector.json) còn ghi smoke test module thật với native PerformanceObserver trên Chromium disposable: ghi 2 phase, các observer type hỗ trợ thành công, stop tắt collection; không API/telemetry. Lần phát triển đầu có lỗi selector `session-grid` thay vì `session-list`; đã sửa theo DOM thật. Test static import ban đầu không nhận `}from` trong JS minify; đã sửa và test pass. Không dùng hai lần lỗi đó làm bằng chứng performance.

Production probe phục vụ đúng build nghiên cứu bằng server HTTP loopback port ngẫu nhiên, gzip và immutable cache cho hashed assets; mọi API request bị từ chối. Browser/headless mới, 1440×900, service worker tắt, 30 cold fresh context và 30 warm retained context sau một warmup, xen kẽ để giảm drift. Built-in **demo dashboard có dữ liệu**, không đọc DB/provider/broker. Content-ready được đánh dấu trong browser khi danh sách có session card và đã qua 2 animation frame; không tính thời gian polling/IPC Playwright vào chỉ số đó. Lưu mọi mẫu raw, SHA-256 critical assets, cấu hình máy/browser và summary sample p95. Mỗi sample xác nhận không lỗi console, có card, không gọi API, không tải Replay/vendor. `finally` đóng chính browser/server đã tạo, không đụng server của người dùng.

Kết quả baseline `production-fixture.json` (build nghiên cứu trước implementation):

| Chỉ số | Cold median / sample p95 | Warm median / sample p95 |
| --- | --- | --- |
| Dashboard content-ready | 438.15 / 459 ms | 370.55 / 382.80 ms |
| DOMContentLoaded | 76.00 / 92.40 ms | 27.95 / 42.50 ms |
| Resource count | 47 / 47 | 47 / 47 |
| Transfer bytes | 337,752 / 337,752 | 1,694 / 1,694 |
| Long-task duration | 67 / 79 ms | 0 / 57 ms |

Critical entry graph: 622,675 bytes raw / 155,424 bytes gzip (JS 435,919 / 127,174; CSS 186,756 / 28,250). Replay chunk là lazy, không nằm trong static startup graph, và không được yêu cầu ở 60 journey. Vendor chart nằm ngoài Vite build; việc không thấy asset ở build đơn thuần không đủ, nên probe còn kiểm tra actual requests. DemoPreview vẫn nhập nhiều workspace dùng chung nên resource count 47; đây là fixture preview, chưa có số cho dashboard real-data đã tối ưu. File name/hash build là asset công khai, không có URL có query hoặc ID nghiệp vụ trong evidence.

Giới hạn: đây là baseline frontend fixture, **không phải tốc độ Axum/Python/DB, không phải % cải thiện toàn app, không phải capacity test hoặc field Core Web Vitals**. Không có throttling CPU/network; long task xảy ra sau checkpoint có thể không nằm trong sample. Chưa xác nhận retention/heap leak qua soak. Candidate phải build mới vào thư mục riêng rồi chạy cùng fixture trên cùng máy/browser; actual domain API phải thêm integration fixture riêng giữ financial/provenance parity. Không bật gRPC/SSR/service worker từ kết quả này.
