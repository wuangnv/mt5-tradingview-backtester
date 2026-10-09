# Frontend System Design: nghiên cứu video và audit TradingWorkspace

Ngày đánh giá: **09/10/2026**. Phạm vi: `foundation_v2`, source tại commit sản phẩm **680c900** và working tree khi kiểm tra. Đây là **báo cáo nghiên cứu và đề xuất**, không phải biên bản hoàn tất tối ưu. Không sửa source ứng dụng, đổi stack, chạy migration hay tải dữ liệu provider trong lượt này.

## 1. Quyết định đề xuất

**Giữ React + Vite với CSR, hệ thống chart hiện có và kiến trúc backend đã chọn.** Nâng chất lượng luồng đọc dữ liệu, server state, vòng đời trang, CSS và đo hiệu suất trước. Không có bằng chứng từ video hoặc audit cho thấy chuyển cả ứng dụng sang Next.js/SSR/ISR sẽ giải quyết những điểm nghẽn tìm thấy.

Ưu tiên lớn nhất là: **dashboard đọc đúng metadata → Trades/Analytics có read model theo phạm vi → chart có cửa sổ lịch sử bị ràng buộc bởi cutoff → cache được quản lý bằng scope/revision → bundle và render được đo trên production build**. SSR không làm truy vấn PostgreSQL hoặc tính ledger rẻ hơn; CDN không giảm công tính backtest; Service Worker không thay Web Worker xử lý CPU.

Luồng dữ liệu đề xuất vẫn là:

```text
React shell giữ mounted
  └─ trang được mở → tải code của trang → đọc dữ liệu đúng scope
       ├─ HTTP JSON/OpenAPI → Axum → PostgreSQL/read model
       ├─ SSE → snapshot/revision mới → đối chiếu/invalidate đúng query
       └─ tác vụ dài → job bền vững → Python worker → kết quả có provenance

Parquet/Arrow + DuckDB nằm ở tầng xử lý lịch sử; browser nhận cửa sổ nến,
summary hoặc trang kết quả cần hiển thị, không nhận toàn bộ kho để tự tính lại.
```

Lợi ích dự kiến là giảm request, payload, CPU/RAM và trạng thái chờ không cần thiết. **Chưa có benchmark A/B cho những đề xuất này, nên không gán phần trăm tăng tốc.** Chi phí chính nằm ở contract read model và invalidation đúng; làm từng lát sẽ dễ kiểm chứng và rollback hơn một lần viết lại.

## 2. Nguồn và mức độ xác minh

### Video

[10 Khái Niệm System Design Quan Trọng Dành Cho Frontend Developer — sydexa](https://www.youtube.com/watch?v=MOSAvwZir8c), đăng 27/02/2026, dài 11:50. Đã truy xuất transcript tiếng Việt qua giao diện transcript của YouTube. Transcript là **phụ đề tự động**, có lỗi nhận dạng thuật ngữ English. Tên chuẩn dưới đây được chuẩn hóa theo ngữ cảnh rõ ràng, không lấy lỗi ASR làm thuật ngữ mới. Không phát hành lại toàn bộ transcript.

### Code và phép kiểm tra trong lượt này

- Đọc entry, navigation/shell, dashboard, analytics, catalog, chart adapter, shared read/mutation, SSE, API/domain read và artifact reader. Bằng chứng cụ thể ở mục 5.
- Build production độc lập bằng `npm exec vite -- build --outDir ../.runtime/frontend-research-20261009/dist`: **pass**, Vite 7.3.6, 179 module được transform. Không ghi đè `web/dist` hoặc sửa source. Working tree có CSS WIP ngoài phạm vi lúc bắt đầu; không stage chúng.
- Khi thử trang thật, `127.0.0.1:5180` trả **ERR_CONNECTION_REFUSED**. Vì vậy chưa đo network/backend hoặc hành trình thực trên service đang chạy trong lượt này.
- Đo line navigation bằng Chromium riêng, phục vụ file của production build qua request interception, chặn API và request ngoài origin. Đây là **bằng chứng hình học CSS của build**, không phải API integration, load test hoặc đo tốc độ trang. Đo ở 1710/1440/768 × 987 px.
- [bundle-audit.json](../evidence/frontend-system-design-20261009/bundle-audit.json) lưu kích thước và SHA-256; [runtime-audit.json](../evidence/frontend-system-design-20261009/runtime-audit.json) lưu hình học; [ảnh navigation](../evidence/frontend-system-design-20261009/analytics-navigation.png) cho thấy line lệch.

Kết quả source, build, phép kiểm CSS và whole-product acceptance được phân biệt. Báo cáo không xác nhận mọi luồng runtime, tính đúng tài chính hoặc khả năng chịu tải toàn sản phẩm.

## 3. Đúng 10 khái niệm trong video

Cột “Video” chỉ tóm tắt chủ đề đã xác minh. Các cột còn lại là audit và nhận định áp dụng cho project.

| # | Khái niệm / mốc video | Video | Hiện tại trong project | Phân loại và quyết định |
|---|---|---|---|---|
| 1 | [SSG — 1:55](https://www.youtube.com/watch?v=MOSAvwZir8c&t=115s) | Tạo HTML trước khi phục vụ | Vite tạo static assets; nội dung dashboard vẫn CSR | **Áp dụng khi cần** cho docs/landing công khai; không dùng cho phiên riêng |
| 2 | [ISR — 3:17](https://www.youtube.com/watch?v=MOSAvwZir8c&t=197s) | Tái tạo trang tĩnh khi cần cập nhật | Không có ISR | **Không cần thiết** cho dashboard/backtest hiện tại |
| 3 | [CSR — 4:17](https://www.youtube.com/watch?v=MOSAvwZir8c&t=257s) | Dựng giao diện bằng JavaScript trong browser | React + Vite, shell và History navigation | **Nên áp dụng ngay** các cải thiện CSR; giữ kiến trúc hiện có |
| 4 | [SSR — 5:02](https://www.youtube.com/watch?v=MOSAvwZir8c&t=302s) | Dựng HTML trên server khi truy cập | Không có SSR React | **Không cần thiết** cho workspace hiện tại; xét lại khi có trang public cần index |
| 5 | [Hybrid Rendering — 6:08](https://www.youtube.com/watch?v=MOSAvwZir8c&t=368s) | Kết hợp các cách render | Chưa kết hợp nhiều cách render | **Áp dụng khi cần** nếu có docs/public content và app riêng |
| 6 | [CDN — 7:00](https://www.youtube.com/watch?v=MOSAvwZir8c&t=420s) | Phân phối file từ nhiều vị trí | App chạy local; chưa chứng minh cấu hình CDN production | **Áp dụng khi cần** khi triển khai cho người dùng ở xa |
| 7 | [Lazy Loading — 7:53](https://www.youtube.com/watch?v=MOSAvwZir8c&t=473s) | Chỉ tải tài nguyên cần dùng | 18 khai báo `React.lazy`; CSS/code có chunk riêng | **Nên áp dụng ngay** việc audit entry, waterfall, tải có chủ đích |
| 8 | [State Management — 8:21](https://www.youtube.com/watch?v=MOSAvwZir8c&t=501s) | Phân biệt local/global/server state | Có local state, context, scoped inflight reads; cache chưa thống nhất | **Nên áp dụng ngay** chuẩn scope/revision/lifecycle và query policy |
| 9 | [Service Worker & Caching — 9:36](https://www.youtube.com/watch?v=MOSAvwZir8c&t=576s) | Cache/offline và quản lý phiên bản | Không tìm thấy SW registration trong source audit; API đặt `no-store` | **Áp dụng khi cần** cho PWA/docs; HTTP/server-state caching nên chuẩn hóa ngay |
| 10 | [Web Performance Metrics — 10:32](https://www.youtube.com/watch?v=MOSAvwZir8c&t=632s) | Đo hiệu suất trải nghiệm | Có evidence/fixture tests; chưa thấy RUM web-vitals/Profiler trong source audit | **Nên áp dụng ngay** baseline, product timings, budgets và regression checks |

### Những chỗ cần cập nhật khi đọc video

- Video nêu **FID**; Core Web Vitals hiện dùng **INP**, cùng LCP và CLS. TTFB là chỉ số hỗ trợ, không thuộc bộ ba này. Ngưỡng tốt: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1, xét percentile 75 trên dữ liệu người dùng và tách desktop/mobile. Không coi một lượt Lighthouse là field INP. [Web Vitals](https://web.dev/articles/vitals).
- Định nghĩa “byte đầu tiên của phản hồi” ở 11:00 khớp TTFB; transcript nhận dạng thành “TTFP”. Không đưa “TTFP” vào bộ chuẩn của project.
- CSR không tự đảm bảo realtime, không tự giữ shell và không quyết định số lần gọi API. Những việc đó phụ thuộc router, effect, cache và subscription.
- SSG không có nghĩa mọi thay đổi luôn phải rebuild toàn bộ website; khả năng rebuild chọn lọc phụ thuộc công cụ. ISR cũng không đảm bảo dữ liệu tức thời.

## 4. Phân tích từng khái niệm và trade-off

### 4.1 SSG

**Cơ chế/mục đích:** tạo HTML tại build để request chủ yếu đọc file; hợp nội dung ổn định, công khai. Ví dụ thực tế cho workspace: tài liệu thao tác backtest, giải thích schema hoặc landing giới thiệu sản phẩm.

**Lợi ích:** HTML sẵn, hạ tầng phục vụ đơn giản, cache dễ, giảm xử lý tại request. **Hạn chế:** độ mới gắn với build/revalidation; không phù hợp cá nhân hóa theo quyền, workspace hay revision phiên. Không nên đưa dữ liệu riêng vào output tĩnh.

`web/index.html` có root React và Vite assets; build tĩnh này **không đồng nghĩa đã pre-render nội dung tài chính bằng SSG**. Có thể tách docs khi nhu cầu xuất hiện, giữ app CSR. Không thêm framework render chỉ để thay một trang nội bộ. Khác biệt SSG/SSR tham chiếu [tài liệu rendering chính thức](https://nextjs.org/docs/pages/building-your-application/rendering).

### 4.2 ISR

**Cơ chế/mục đích:** tái tạo output tĩnh theo thời gian hoặc tín hiệu invalidation. Ví dụ phù hợp: trang public giới thiệu instrument được cập nhật theo lịch.

**Lợi ích:** giảm rebuild và công render request. **Hạn chế:** có cửa sổ dữ liệu cũ, quản lý invalidation và đồng bộ nhiều instance; framework/runtime support bổ sung. Hành vi revalidation cụ thể tùy implementation. [ISR chính thức](https://nextjs.org/docs/app/guides/incremental-static-regeneration).

Không dùng cho cursor replay, số dư, kết quả đang chạy, quyền truy cập hoặc giá theo thời điểm. Cache JSON theo revision cho app là việc khác với ISR HTML. Hiện chưa có nhu cầu đủ mạnh để áp dụng.

### 4.3 CSR

**Cơ chế/mục đích:** React chạy trong browser, đọc API và cập nhật UI. Phù hợp ứng dụng tương tác như bộ lọc, chọn phiên, chart và điều khiển job.

**Lợi ích:** dùng được browser chart hiện tại, trạng thái tương tác linh hoạt, chuyển nội dung không cần reload document. **Hạn chế:** chi phí tải/parse JS ban đầu, main-thread computation, request waterfall và khả năng truy cập nội dung trước khi JS chạy.

Project đã có shell giữ mounted và client navigation. Nâng cấp cần tập trung vào request theo scope, route identity, payload, loading và CPU. Không cần viết lại router chỉ vì xuất hiện một query-sync gap. Error Boundary/Suspense xử lý lỗi render/code loading; chúng không tự giải quyết mọi lỗi fetch. [React lazy](https://react.dev/reference/react/lazy), [React useEffect](https://react.dev/reference/react/useEffect).

### 4.4 SSR

**Cơ chế/mục đích:** tạo HTML khi request rồi hydrate phần tương tác trên client. Hữu ích trang public cần HTML ban đầu và nội dung có thể index.

**Lợi ích:** có thể hiển thị nội dung trước khi client JS sẵn sàng. **Hạn chế:** thêm rendering runtime, chi phí server, hydration, nguy cơ đọc API hai lần và mismatch. Chart cần browser/canvas vẫn phải khởi tạo ở client; SSR không tự giảm thời gian chart-ready.

Ứng dụng hiện là workspace nội bộ, data có scope và thời điểm. Chưa có yêu cầu SEO/public content hoặc phép đo chứng minh SSR thắng. Giữ CSR; xem xét riêng một route public khi phát sinh yêu cầu cụ thể.

### 4.5 Hybrid Rendering

**Cơ chế/mục đích:** chọn render theo loại nội dung thay vì một cách cho tất cả. Ví dụ: docs dùng SSG, trang public thay đổi dùng SSR/ISR nếu cần, app phân tích dùng CSR.

**Lợi ích:** tối ưu theo workload. **Hạn chế:** nhiều vòng đời, cache, deployment và ranh giới server/client; maintenance cao hơn. Có thể dùng site docs riêng mà không chuyển app sang framework mới. Không áp dụng ngay vì hiện chưa có consumer public đủ rõ.

### 4.6 CDN

**Cơ chế/mục đích:** cache/phân phối asset ở hạ tầng gần người dùng, giảm phụ thuộc origin. Hợp JS/CSS/font/ảnh có tên chứa hash. **Lợi ích:** giảm đường truyền tới origin và latency tải asset cho người ở xa. **Hạn chế:** invalidation, chi phí lưu/egress, sai cấu hình cache, release cũ còn mở tab.

Localhost không có lợi ích địa lý từ CDN. Khi deploy: hashed assets có thể `public, max-age=31536000, immutable`; HTML và file không có hash như `project-palette.css` phải có chính sách version/revalidation riêng. Giữ asset của release trước trong thời gian chuyển tiếp để tab đang mở không mất lazy chunk. [HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching), [Vite build/deployment](https://vite.dev/guide/build).

API private và SSE không đưa vào shared CDN cache. Chỉ cân nhắc file lịch sử bất biến có quyền truy cập phù hợp, URL/version riêng và license cho phép. Không tự upload bộ chart vendor ra CDN; middleware Vite hiện phục vụ bản được cấp quyền ở local ngoài Git.

### 4.7 Lazy Loading

**Cơ chế/mục đích:** dynamic import và tải tài nguyên khi mở luồng tương ứng. React lazy cache module đã load; fallback/error boundary cần có. Vite hỗ trợ tách CSS của async chunk. [React lazy](https://react.dev/reference/react/lazy), [Vite CSS splitting](https://vite.dev/guide/features#css-code-splitting).

**Lợi ích:** giảm startup cost. **Hạn chế:** lần mở đầu có thêm round trip; chia quá vụn gây waterfall; preload mọi thứ làm mất lợi ích. Lazy code khác với lazy data: route tách code vẫn có thể fetch cả ledger.

Đã có 18 lazy entry, chart/replay có chunk riêng. Nên đo critical import graph và entry CSS trước khi chia tiếp. Prefetch chỉ route có xác suất cao, theo hover/focus hoặc idle và ngân sách; không prefetch ledger hoặc nến tương lai. Skeleton giữ kích thước để tránh giật layout. Không lazy từng icon/nút nhỏ.

### 4.8 State Management

**Mục đích:** xác định ai sở hữu state và khi nào nó hợp lệ. Local state cho input/menu/dialog; shared UI context cho theme/locale; URL cho phạm vi cần deep link; server state cho records/results có revision.

**Lợi ích:** giảm đọc trùng, race và state lệch. **Hạn chế:** cache sai key/invalidation có thể hiển thị số dư/phiên không đúng. Store toàn cục cho mọi thứ tạo coupling và dễ giữ dữ liệu quá lâu.

Đã có nhiều cơ chế đúng: AbortController, request sequence, scope check, inflight dedup, stale state, idempotent mutation receipts. Chưa có chính sách query cache xuyên trang. Đề xuất trước hết chuẩn contract; sau đó pilot **TanStack Query trên catalog/metadata read-only**, so với việc mở rộng helper hiện có. Không tự thêm Redux/Zustand nếu context/local state đang đủ.

Query key tối thiểu gồm workspace, resource, bộ lọc/sort/page và nguồn phiên/revision; chart thêm dataset hash, symbol, resolution và cutoff. Quyền/auth identity phải tham gia ranh giới cache nếu hệ thống có nhiều principal; đổi workspace/logout/403 phải xóa dữ liệu không còn được phép đọc. In-memory query cache khác HTTP cache; không nới `no-store` toàn API chỉ để bật cache client.

Đặt `staleTime`, giới hạn giữ cache và retry rõ cho từng nhóm. TanStack mặc định coi data stale, có background refetch và retry; dùng nguyên mặc định có thể tăng request. Không retry mutation tài chính tự động; kết quả chưa biết phải đối chiếu receipt/revision trước. [TanStack Query defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults).

### 4.9 Service Worker và Caching

**Cơ chế/mục đích:** Service Worker có vòng đời riêng, có thể chặn request và phục vụ cache/offline. Hợp PWA/docs hoặc dataset offline được thiết kế rõ. **Lợi ích:** shell offline và tải lại static resource. **Hạn chế:** phiên bản cũ, cache không còn quyền đọc, quota, lifecycle và đồng bộ khi reconnect. [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API).

Chưa tìm thấy SW registration trong source audit; không coi đây là lỗi. Browser HTTP cache và server-state cache đã giải quyết phần lớn nhu cầu hiện tại mà không thêm một tầng offline. Nếu làm PWA: ưu tiên shell/docs, ghi rõ offline/stale, cache theo build và dọn bản cũ; không cache tùy tiện API private, số dư hoặc tự phát lại lệnh khi có mạng.

**Web Worker khác Service Worker:** Web Worker dùng cho CPU ở nền, không trực tiếp thao tác DOM. Chỉ cân nhắc cho analytics transforms/aggregation khi trace cho thấy main-thread bị chặn; tính cả chi phí copy/transfer và lifecycle. Đây là đề xuất bổ sung, không phải mục thứ 11 của video. [Using Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers).

### 4.10 Web Performance Metrics

**Mục đích:** đo trải nghiệm thay vì đoán từ framework hoặc số dòng code. LCP/INP/CLS hỗ trợ đánh giá tải/tương tác/layout; TTFB và trace giúp tìm tầng gây chậm. Xem ngưỡng hiện hành ở mục 3.

**Lợi ích:** so sánh trước/sau, phát hiện regression. **Hạn chế:** LCP không đảm bảo chart đã có data, job đã nhận lệnh hay số liệu đúng; tổng API time không chỉ rõ DB/worker/browser. React Profiler cần bản profiling hoặc phép đo dev có nhãn, không lấy dev render duration làm production latency. [React Profiler](https://react.dev/reference/react/Profiler).

Bổ sung product timings: navigation→content-ready, chart→first-visible-bars/usable, filter→rows đúng scope, submit→job accepted, event→UI reconciled, reconnect→fresh snapshot. Đo payload, request count, long tasks, memory và backend/DB/worker time cùng fixture. RUM không thu nội dung ledger, journal, account hoặc dữ liệu cá nhân trong payload metric.

## 5. Bằng chứng codebase và các vấn đề hiện tại

Các file dưới đây là source ở snapshot audit; line có thể dịch chuyển khi commit mới xuất hiện.

| ID | Bằng chứng | Kết quả và ý nghĩa |
|---|---|---|
| E01 | `web/src/main.jsx:3–21, 58–64, 135`; `clientNavigation.js:23–84` | 18 lazy entry; shell bao ngoài keyed content boundary; click cùng app dùng History, back/forward có subscription. **Đã có** giữ shell, không đề xuất làm lại từ đầu |
| E02 | `main.jsx:25–31`; bundle JSON | Entry import nhiều CSS chung; JS/CSS entry vẫn đáng đo. Chưa có bằng chứng “tất cả workspace đều load ban đầu” |
| E03 | `DashboardSessions.jsx:60–65, 111–123`; `dashboardModel.js:110–137` | Mở filters hoặc sort profit/Strategy có thể đọc mọi phiên; mỗi phiên cần Analytics và Replay GET. `Promise.all` không có giới hạn concurrency ở đây. Replay payload có nến, browser parse xong mới bỏ `visible_rows` để giữ metadata |
| E04 | `trading_workspace_v2/api.py:371–393`; `dashboard_read_model.py` | Trades page gọi full performance/ledger rồi mới `build_trades_page`; chia trang output chưa làm công xử lý tỷ lệ với page. Đây là Python domain handler cần đối chiếu qua public Axum dispatcher trong runtime benchmark, không bằng chứng browser dùng Python HTTP |
| E05 | `AnalyticsWorkspace.jsx:289–308, 319–331, 352–381` | Có sequence/abort và chỉ đọc experiments ở tab cần. Nhưng yêu cầu full selected ledger; đọc toàn journal theo workspace rồi lọc client; enrichment `ledger.map → journalItems.flatMap` có số lượt xét tăng theo trades × journals |
| E06 | `scopedRead.js:1–39`; `dashboardModel.js:97,111,124,132`; `scopedMutation.js` | Dedup request đang chạy theo workspace/path, abort khi consumer cuối rời đi; không có cache kết quả xuyên lần đọc. Buffer body rồi mỗi consumer parse riêng là chi phí cần đo với payload lớn. Mutation có cơ chế receipts; giữ lại khi đổi query tooling |
| E07 | `MarketAssetCatalog.jsx:25–43,67–71`; `workspaceEvents.js:31–84` | Catalog tự refresh mỗi 5 s khi component mounted; phân trang 25 dòng trên catalog đã tải. SSE có stream dùng chung theo workspace, watchdog, capped backoff/snapshot reconnect; chưa có jitter ở đoạn reconnect. Không coi SSE là missing feature |
| E08 | `replay.py:42–47,404–446`; `artifacts.py:247–253,278–301` | Replay view đọc full dataset qua `read_dataset`; single-asset trả prefix tới cursor, multi-asset giới hạn tối đa 2.000 dòng. Có range reader dùng Parquet row groups nhưng luồng view này chưa dùng nó. Full checksum/read không thể gọi là miễn phí |
| E09 | `advancedReplayDatafeed.js:31–48,59–61,76–109` | Adapter chỉ sử dụng visible rows và cutoff, không gọi provider. `history()` aggregate/sort lại rows, rồi `getBars` mới lọc/countBack; update mỗi subscription cũng gọi history. Đây là candidate CPU benchmark, không lý do thay chart library |
| E10 | `main.jsx:58–64,135`; `clientNavigation.js:23–49`; `AnalyticsWorkspace.jsx:340,350`; `dashboardModel.js:94` | Content key chứa mọi revision navigation/search, nên có thể remount khi query thay đổi dù cùng page. Nhiều component gọi `history.replaceState` trực tiếp nhưng không notify snapshot của router. Rủi ro URL/state lifecycle cần tái hiện, chưa tuyên bố mọi back/forward đều lỗi |
| E11 | `DashboardPerformance.jsx:82–122`; `TestingReadState.jsx`; `useReadRefresh.js` | Performance đã có group loading/empty/blocked/error/partial/stale, không render hàng loạt empty chart khi chưa có phiên. Cần mở rộng và audit theo dependency flow, không khẳng định thiếu toàn bộ chuẩn trạng thái |
| E12 | `fx-shell-story.css:1328–1406`; `page-layout.css:14–15`; geometry JSON | **Line lệch xác nhận:** parent tab cao 52 px, nested group cao 48 px căn giữa. Bottom tương ứng y=116 và y=114; hai `::after` cao 2 px nên lệch 2 px ở cả ba viewport |
| E13 | `api-rust/src/middleware.rs:163–169`; `web/vite.config.js` | API boundary đặt `Cache-Control: no-store`; vendor chart phục vụ local riêng. Chưa chứng minh header/compression/CDN production. Không gỡ chính sách cache an toàn trên toàn API |

### Các vấn đề nên xử lý, theo tác động

1. **P1 — Dashboard fan-out và payload thừa (E03).** Có thể đạt gần 2×N detail requests khi filter/sort yêu cầu mọi phiên chưa có detail cache; con số thực tế phụ thuộc cache/revision và phiên đọc được. Giải pháp: list/card summary gồm strategy, P/L, currency, revision; metadata endpoint không có nến. Cho sorting/filtering ở đúng read model; request scheduler có giới hạn. Mục tiêu: mở bộ lọc rỗng không trigger đọc N detail, một page không truyền nến. Chưa đo phần trăm latency/RAM giảm.
2. **P1 — Pagination và Analytics còn tính/đọc rộng (E04–E05).** Tạo summary/projection có version, provenance và page query; journal filter theo session/trade ở server, hoặc summary count/tag map. Dùng Map theo session/trade để ghép tag thay vì quét mọi journal cho từng trade. Không lấy vài trade bằng SQL rồi dùng chúng tính P/L/drawdown toàn lịch sử: running balance, fee, dedup, facets và aggregate cần cùng oracle tài chính.
3. **P1 — Chart history chưa bounded nhất quán (E08–E09).** Tách chart-window API theo range/countBack/cutoff, giữ backend authority. Multi-asset đã giới hạn payload nhưng thiếu lịch sử xa có thể cần cửa sổ bổ sung; single-asset prefix tăng theo cursor. Incremental aggregation/cache có giới hạn theo hash/resolution/cutoff; reset khi rewind/switch asset. Không prefetch hoặc lộ tương lai vì tối ưu.
4. **P1 — Query/route ownership (E06,E10).** Phân biệt navigation đổi page/workspace với chỉnh filter cùng page. Có một hàm cập nhật URL/snapshot nhất quán nhưng không remount cả page cho mọi filter. Xem xét giữ scroll đúng ngữ cảnh. Hủy và bỏ response cũ ngay khi scope đổi; không dùng cached data khác workspace làm placeholder.
5. **P1 nhỏ — Line navigation và CSS ownership (E12).** Chốt một baseline/height cho tab group và một owner vẽ line; tránh nối hai pseudo-element nằm trên hai trục khác nhau. Tạo kiểm tra hình học dark/light, focus, scroll và viewport. Chưa sửa theo yêu cầu research-only.
6. **P2 — Poll/SSE lifecycle (E07).** Catalog tách phần danh mục ổn định và trạng thái job; invalidate theo revision/event, giữ polling làm fallback có cadence và pause khi hidden. Thêm jitter reconnect và chính sách denied/auth; không retry vô hạn 401/403. Kết nối lại lấy snapshot, không giả định từng progress event luôn đến đủ.
7. **P2 — Entry bundle/CSS và metric coverage (E02).** Đo startup critical graph, phần CSS của route không dùng và main-thread parse. Giảm duplication/cascade theo owner component rồi mới chia chunk. Token spacing/height phải có một nguồn; sửa từng pattern trong UI reference trước khi áp rộng.

Không phải mọi catalog đều cần server pagination ngay: vài trăm metadata nhẹ có thể tải/cache một lần hợp lý. Bảng trade lớn, lịch sử nến và analytics payload là workload khác; không dùng cùng một chính sách cho tất cả.

## 6. Số liệu đã đo — và những số chưa có

| Artifact build hiện tại | Bytes gốc | Gzip tính cục bộ | Ý nghĩa |
|---|---:|---:|---|
| Entry JS `index-B36X08xx.js` | 435.919 | 127.174 | JS entry, chưa gồm toàn bộ route/runtime vendor |
| Entry CSS `index-IPE6dnBA.css` | 186.756 | 28.250 | CSS entry cần tải trước giao diện |
| Replay JS `ReplayWorkspace-DuserIRT.js` | 331.258 | 105.095 | Chunk route, không phải tất cả load ở dashboard |
| Replay CSS `ReplayWorkspace-TerrmIt7.css` | 96.043 | 15.515 | CSS chunk route |

Dấu chấm trong bảng là phân cách hàng nghìn. Tổng **hai file entry** là 622.675 bytes gốc, 155.424 bytes gzip (~155,4 kB). Đây là kích thước nén tham khảo, **không phải transfer size đã đo**, không gồm fonts/vendor/API và không đại diện tổng initial route. Một deployment có thể dùng Brotli hoặc không nén; cần kiểm headers/network thật.

Không có số hiện tại cho p95 page load, field INP, frame drops, memory leak, capacity, API/database latency hoặc % tăng tốc từ roadmap. Không tái sử dụng benchmark backend fixture trước đây để gán tốc độ frontend. Đo baseline trước, rồi tính `(before − after) / before × 100%` cho từng chỉ số giảm là tốt; throughput phải có công thức tăng riêng. Báo cả phân bố và correctness, không chỉ một lượt đẹp nhất.

## 7. So sánh các phương án

| Quyết định | Hiện tại | Phương án phù hợp hơn | Performance / scale | Độ phức tạp và maintenance |
|---|---|---|---|---|
| Rendering | CSR + lazy routes + persistent shell | Cải thiện từng luồng CSR | Giảm startup/waterfall/remount nếu đo đúng | Thấp–vừa, reuse nhiều code |
| Đổi toàn app sang SSR/ISR | Chưa có | Không làm hiện tại | Chưa chứng minh lợi ích; không chữa full-ledger/payload | Cao, thêm rendering/hydration/cache runtime |
| Server state | Hand fetch + scoped inflight + local copies | Contract trước; query cache pilot read-only | Bớt duplicate/read lại; memory phải bounded | Vừa; một policy chung tốt hơn nhiều cache tự tạo |
| List/card data | Whole catalog, details fan-out | Summary list có facets/sort/page | Giảm fan-out và nến thừa | Vừa; cần projection/revision correctness |
| Historical analytics | Full selected ledger và client transforms | Summary + page/drill-down + worker result | Payload/CPU theo scope, không theo cả kho | Vừa–cao; tài chính cần oracle regression |
| Chart | Current vendor/adapter, visible prefix | Giữ chart, window API + incremental transforms | Bounded payload/CPU khi lịch sử tăng | Vừa; cutoff/reset là constraint quan trọng |
| Realtime | Shared SSE + local polling | Snapshot reconciliation và targeted invalidation | Ít polling, reconnect không tạo herd | Vừa; cần metric/fallback; không cần WS cho progress |
| Static delivery | Local Vite | Versioned deploy + compression/cache; CDN khi remote | Lợi ích phụ thuộc RTT/geography | Thấp–vừa; chart license riêng |
| Long lists | Paging/render hiện tại | Server paging trước; virtualize khi DOM còn lớn | Virtualization giảm DOM, không giảm DB/JSON tự động | Vừa; keyboard/a11y/sticky row phức tạp hơn |
| CPU transform | Main thread | Map/incremental trước; Web Worker nếu trace chứng minh | Worker giúp phản hồi UI; copy overhead có thể thắng hoặc thua | Vừa; cần cancel/generation/transfer ownership |

GraphQL không tự giảm công dựng ledger; HTTP JSON summary endpoint đã giải quyết đúng bài toán. gRPC nội bộ không làm browser render nhanh hơn. WebSocket chỉ bổ sung khi có giao tiếp hai chiều thực sự cần, không thay SSE progress. DuckDB-WASM/WebAssembly trong browser chỉ xét cho nghiên cứu offline có workload rõ; không mặc định chuyển cả analytics vào client.

## 8. Chuẩn trạng thái theo luồng dữ liệu

Đây là khuyến nghị bổ sung cho câu hỏi trước về loading/empty/error; E11 cho thấy một phần đã tồn tại.

**Không ép mọi component có cùng một enum dài.** Tách tình trạng đọc, tình trạng data và tình trạng command:

| Nhóm | Trạng thái có ích | Cách thể hiện |
|---|---|---|
| Đọc | idle/disabled, loading, ready, refreshing, stale, error | Skeleton chỉ khi chưa có data; refresh cùng scope giữ nội dung và báo đang cập nhật |
| Dữ liệu | empty collection, no match, partial, unavailable/blocked, denied, invalid scope, not found | Phân biệt chưa có phiên, lọc không khớp, chưa có trade, thiếu nguồn và không có quyền |
| Command/job | submitting, accepted/queued, running, paused, retryable failure, cancelled, completed, unknown outcome | Theo authority backend; timeout không đồng nghĩa command thất bại; đối chiếu khi outcome chưa biết |

**Theo cụm khi cùng dependency:** catalog xác nhận chưa có phiên → một empty state cho cụm Performance/KPI/charts với hành động tạo phiên. Không dựng nhiều “không có dữ liệu” lặp lại. Có phiên nhưng chưa có trade → cho xem session metadata, đồng thời một trạng thái no-trades cho các chart phụ thuộc giao dịch.

**Riêng lẻ khi dependency độc lập:** dataset availability, job progress, journal và performance có thể tải/lỗi khác nhau. Một job lỗi không được che toàn dashboard. Partial chỉ tổng hợp nguồn đọc được và phải ghi phạm vi; không giả số 0 cho dữ liệu chưa đọc được. 403 xóa data bị thu quyền; stale chỉ giữ dữ liệu cùng scope còn được phép xem, ghi thời điểm/revision.

Skeleton/code loading, empty theo nghiệp vụ và refreshing phải giữ kích thước hợp lý, keyboard/focus và reduced motion. Suspense cho code chunk không thay state machine fetch. UI reference cần các ví dụ dependency flow này và test cả trường hợp đổi scope trong lúc request cũ chưa kết thúc.

## 9. Roadmap đề xuất và benchmark

Đây là thứ tự công việc để đưa vào PLAN/ledger owner hiện hành nếu được giao triển khai; không tạo một bảng tiến độ cạnh tranh. Mức tác động là dự kiến, không phải kết quả A/B đã đo.

| Ưu tiên | Lát triển khai | Tác động dự kiến | Rủi ro / phụ thuộc | Benchmark và điều kiện chấp nhận |
|---|---|---|---|---|
| P0 | Baseline production: timings, network, payload, long tasks, resource memory, correlated backend trace | Biết bottleneck và có điểm so sánh | Metric overhead/privacy; service phải chạy, test fixture riêng | ≥30 lượt cold/warm trên cùng máy/browser; báo median/p95; không đổi data giữa A/B |
| P1-a | Line/tab baseline + URL/route identity nhất quán | Fix lệch trực tiếp, bớt reset/nhấp nháy khi filter | Back/forward/deep links/focus/scroll regression | 1710/1440/768 + dark/light/reduced motion; line cùng trục; chuyển filter không remount shell hoặc trang ngoài ý định |
| P1-b | Dashboard summary/list/metadata, bỏ fetch nến thừa; bounded reads | Giảm request và bytes khi nhiều phiên | Read model mới; strategy/P&L/sort phải đúng revision | 5/100/1.000 phiên: mở filter rỗng không N detail reads; page có request budget cố định, không có `visible_rows` trong card payload |
| P1-c | Trades/Analytics projection, filtered journal, tag index | Giảm full-ledger work và T×J scan | Oracle tài chính, facets/sort/paging snapshot | 10k/100k trades × 1k/10k journals: page content/totals/provenance đúng; đo DB reads, CPU, JSON parse, heap và p95 |
| P1-d | Chart-window/range contract; reuse range reader đúng nơi | Bounded history payload, ít aggregate lại | Không lộ tương lai; rewind/switch/multiasset correctness | 20k/100k/1M nến: pan/zoom/timeframe/advance/rewind; timestamp không vượt cutoff; dữ liệu/bucket khớp oracle; đo first-bars và frame time |
| P2-a | Server-state policy/pilot query cache + SSE invalidation | Bớt reload/read trùng, đồng nhất stale/retry | Double cache, sai key, payload retained | A→B→A, đổi workspace, mutation revision, 403, offline/reconnect; cache không lẫn scope và heap không tăng vô hạn |
| P2-b | Poll fallback, jitter/backoff/visibility, snapshot reconcile | Ít request nền và reconnect herd | Bỏ sót event, hidden job resume | SSE disconnect/timeout/401/403, 10–50 tab fixture; số connection theo tab/workspace bounded, không mất terminal state |
| P2-c | Entry/CSS ownership và critical route load | Giảm startup/cascade, tránh UI drift | Splitting quá vụn; deploy mất chunk | Network cold/warm + CSS coverage + screenshots; không tải Replay/vendor trên dashboard nếu không sử dụng; code load fail có recovery |
| P3 | Web Worker/virtualization/selective prefetch khi profiler chứng minh | UI đáp ứng hơn khi CPU/DOM lớn | Copy overhead, a11y, stale compute | A/B main-thread/incremental/worker; test generation cancel; keyboard/screen-reader table; không thêm nếu workload nhỏ chậm hơn |
| Khi deploy | Static compression/hash/cache, release retention, CDN, RUM | Giảm remote asset latency; nhìn được field performance | Cache auth/asset licensing/release mismatch | RTT profile + regional cold/warm; stale tab mở route sau deploy vẫn hoạt động; private API không vào shared cache |

### Cách tổ chức benchmark để kết quả có giá trị

- **Correctness trước tốc độ:** frozen fixture/oracle, workspace, revision, dataset hash, cutoff, fee/currency và ledger dedup giống nhau. Dữ liệu synthetic chỉ chứng minh fixture đó.
- **Tách cold/warm:** cache browser, query cache, DB cache và worker queue cần được mô tả. Development server không dùng để công bố production performance.
- **Đo cả journey:** dashboard/filter, Trades page, chọn Analytics, chart-ready, job-progress/reconnect. Ghi request count, bytes gốc/encoded, parse+compute+render, long tasks, heap, backend/DB/queue timings và error rate.
- **Budget đề xuất để thảo luận, chưa phải SLA:** ngưỡng CWV chuẩn ở mục 3; phản hồi thị giác thao tác nhẹ p95 ≤100 ms; content-ready cho navigation warm/local ≤500 ms trong profile fixture được chốt; chart nhắm nhịp 60 Hz với ngân sách frame ~16,7 ms. Mỗi target phải ghi cấu hình máy, data và network; không bảo đảm cùng số trên mọi thiết bị.
- **Load lớn ở môi trường riêng:** 1/10/50 client, request concurrency có giới hạn; thử soak sau khi functional A/B ổn. Không tạo tải nặng lên dữ liệu thật hoặc kích hoạt provider download để benchmark frontend.
- **Chốt promotion:** cùng correctness, p95/heap/request tốt hơn ở workload mục tiêu, không regression materially ở workload nhỏ, cleanup/cancel/retry/denied/deploy được kiểm chứng. Report trade-off và confidence; framework benchmark Hello World không thay benchmark sản phẩm.

## 10. Phần có thể chưa bao phủ và quyết định giữ lại

Audit lần này chưa đo field người dùng, backend runtime lúc service hoạt động, mobile thật, memory soak, authenticated multi-principal deployment, CDN/S3 và vendor chart distribution. Đây là phạm vi cần kiểm chứng trong các lát roadmap, không phải bằng chứng những phần đó đang lỗi.

Những điều nên giữ: React/Vite CSR; shell persistent; chart engine hiện tại; HTTP JSON/OpenAPI; SSE tiến độ; Rust/Axum admission và PostgreSQL authority; Python worker tách tác vụ dài; Parquet/Arrow/DuckDB ở tầng xử lý. Cần bảo toàn revision/cutoff/provenance, command idempotency và fail-closed permissions trong mọi tối ưu.

Phần bổ sung ngoài 10 mục video gồm read-model pagination, bounded requests, cutoff-aware chart windows, generated API types/runtime validation, CSS ownership, observability và deployment retention. Có thể sinh client types từ OpenAPI để giảm drift, nhưng trước hết giữ validation runtime quan trọng; types không kiểm tra được payload thật. Không mặc định thêm microservices, SSR, GraphQL, WebSocket, global state library, PWA hoặc WebAssembly để làm stack trông đầy đủ.

**Đề xuất triển khai kế tiếp:** P0 và P1-a/P1-b trước; sau đó P1-c/P1-d theo số đo. Cache pilot theo sau contract đúng. CDN, offline và worker browser chỉ thêm khi nhu cầu hoặc profiling chứng minh giá trị.
