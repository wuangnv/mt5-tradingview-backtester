# Frontend implementation — 09/10/2026

Áp dụng các đề xuất phù hợp của [research 10 khái niệm](FRONTEND-SYSTEM-DESIGN-20261009.md). Giữ React/Vite CSR và chart engine hiện tại. Public HTTP do Axum phục vụ; Python worker vẫn là owner của financial oracle. Không thay công thức tài chính bằng phép tính trên một trang hoặc đường biểu đồ rút gọn.

## Hành vi và luồng dữ liệu

| Phần | Thay đổi được triển khai | Giới hạn còn lại |
|---|---|---|
| Navigation | URL là nguồn filter/tab; scope reader theo workspace/page/resource. Giữ shell, bộ lọc và scroll cùng trang; Back/Forward không ghi đè URL. | Chưa khôi phục scroll riêng cho từng history entry giữa hai trang khác nhau. |
| Analytics line | Căn nested navigation theo cùng baseline, giữ control compact. | Không đổi palette hoặc layout khác. |
| Dashboard | API `/dashboard/sessions` trả tối đa 25 summary; mặc định 6 phiên. Metadata endpoint không đọc nến. KPI dùng canonical ledger; curve tối đa 128 điểm có nhãn sampled. | Store vẫn đọc catalog replay; cold profit sort phải tính các summary khớp. Summary không phải SQL paging execution JSON. |
| Trades | Revision heads → canonical report khi cold → projection có thứ tự/facets → đúng trang. Cache process tối đa 64 MiB/24 entry, key gồm workspace, revision, lineage, journal, filter/sort. | Full ledger trên 20.000 trade bypass admission sâu; giữ compact page. Trang lớn chưa có cache vẫn tính full oracle, không phải source SQL pagination. Giới hạn cache retained không giới hạn peak RAM của cold compute. |
| Journal | Chỉ lấy tags/count theo session; join bằng Map, không tải note/body toàn bộ workspace. Retry/focus refresh riêng; unknown khác zero. | Tag filter không hiện kết quả đã xác minh khi journal context lỗi/chưa sẵn sàng. |
| Chart | View tối đa 2.000 native bars; backfill qua `/chart-window`, aggregation đúng UTC/resolution/countBack. Full SHA, workspace, asset, cursor/cutoff được kiểm ở backend. | Full SHA vẫn tỷ lệ với kích thước file; monthly history có thể scan rộng; historical financial checkpoint/interval vẫn dùng oracle. Lightweight/custom annotation dùng native window giới hạn. |
| Replay navigation | GoTo UTC giải quyết cursor bằng timestamp Parquet; self-step không GET thừa. Navigation trong pending command được hoãn rồi xử lý, không mất URL. | Reader-ready timing không được gọi là vendor first-bar timing. |
| Metadata | TanStack Query 5.104.1, cache riêng workspace/authority, stale 15s, GC 120s, giới hạn 16 inactive queries và catalog 5.000 item/5 MiB. Huỷ request theo từng consumer. | Chỉ cache catalog/metadata; không optimistic update finance. Hosted multi-principal auth chưa thuộc scope này. |
| SSE | Một stream/workspace; heartbeat watchdog, jitter/backoff, hidden pause, return reconcile, terminal 401/403. Success mutation và thay đổi download identity/status invalidate đúng scope. | Command read counts không dùng làm catalog revision vì gây feedback loop. Demo/reference thật không kết nối SSE. |
| Diagnostics | Opt-in `perf=1`; durations/API bytes/chart history/long tasks. Capped records, không lưu URL, ID, tài khoản, body, lỗi riêng tư, không upload/storage. | Các chỉ số interaction/layout shift là diagnostics, không phải chứng nhận field INP/CLS. Reader timer bắt đầu sau mount effect, không gồm toàn bộ lazy download. |

## 10 khái niệm: quyết định sau triển khai

| Khái niệm video | Áp dụng trong project |
|---|---|
| SSG | Không thêm cho authenticated trading workspace; có thể dùng cho nội dung public khi có nhu cầu. |
| ISR | Không thêm; không làm mới dữ liệu tài chính bằng cache trang theo lịch. |
| CSR | Giữ, chuẩn hoá navigation giữ shell. |
| SSR | Không thêm; chưa có bằng chứng SEO/first HTML bù độ phức tạp. |
| Hybrid rendering | Ranh giới public/workspace đã ghi nhận; chưa cần framework mới. |
| CDN | Chưa deploy ngoài máy local. Production probe dùng hashed assets immutable + HTML no-store; khi hosted phải retention asset/version và private API no-store. |
| Lazy loading | Giữ workspace chunks; chart không trong critical static graph. Không thêm worker/virtualisation khi chưa có profiling chứng minh. |
| State management | URL filter/tab; component state interaction; server metadata cache riêng scope. Không đưa mọi state vào global store. |
| Service Worker/caching | Cache metadata và immutable build assets; không thêm offline financial response/service worker/PWA. |
| Web performance metrics | Collector và production probe có fixture/evidence; INP thay FID trong target CWV. |

Global CSS vẫn sở hữu foundations/interaction rules; route CSS đi cùng lazy imports đã có. Chưa di chuyển các override có quan hệ cascade giữa nhiều trang chỉ để giảm số KB, và không sửa bốn CSS đang có thay đổi ngoài task.

## Số đo và phạm vi

| Workload | Kết quả | Ý nghĩa |
|---|---|---|
| Parquet chart 20k/100k/1M bars, 30 mẫu/candidate, warm FS, full SHA cả hai | 81,82→13,25 / 422,52→20,12 / 4.409,96→77,07 ms; giảm 83,8% / 95,2% / 98,3% | Reader phase, không phải toàn app/HTTP. |
| 10k trades, 30 mẫu, financial oracle memory-store, warm ordered projection | 1.037,34→0,36 ms | Cache tránh tính lại, chưa gồm DB/HTTP; cold candidate 1.456,83 ms. |
| 100k trades | Repeat cùng trang: median 0,27 ms, 30 mẫu. Trang chưa cache: baseline 15.203→candidate 15.355 ms, 3 mẫu diagnostic | Cold chưa nhanh hơn (khoảng +1% trong phép đo ít mẫu). Compact page cache giữ khoảng 128 KiB; không phải giới hạn peak RAM. |
| Production demo UI, 30 cold + 30 warm | Candidate khoảng 430/371 ms content-ready; baseline khoảng 438/371 ms | Chưa có cải thiện startup đủ chắc để công bố %. Critical gzip tăng 155.424→173.177 byte; cold wire 337.752→349.717 byte do cache library. Không tải replay/vendor chart. |
| Real Axum + PG + workers + production UI | Dashboard warm median 93,43 ms, sample p95 186,92 ms, payload 5.109 byte. Mixed 80 request/concurrency 8, zero errors | Fixture 2×40 bars/1 session, không phải benchmark capacity hay baseline/candidate. |

Nguồn: `evidence/frontend-implementation-20261009/{charts,metrics,trades,integrated-final}`. Giữ `frontend-optimization-20261010/trade-projection.json` như diagnostic phát hiện cache admission regression, không coi là candidate được promote. `trades/projection-final.json` có 10k hợp lệ; 100k ở file đó trộn page hit/miss nên chỉ dùng raw diagnostic. Receipt `large-new-pages.json` tách rõ hai trường hợp.

## Kiểm chứng và vận hành

- Focused Python contracts/finance/history/dashboard: 110 pass; oversize-page regression: 8 projection tests pass. Chart lane: 117 Python + 13 JS pass.
- Focused JS cache/SSE/navigation/metadata/journal/metrics/demo: 63 pass. Broad Node scan: 242 pass, 2 fail đã có ở HEAD — palette contrast light-hover và assertion cũ yêu cầu native speed select dù UI đã dùng FxSelect. Không sửa shared palette hoặc test ngoài phạm vi để tạo pass giả.
- Production navigation: 6/6 (1710/1440/768, dark/light, reduced motion); final lifecycle: 9/9 (scope/back/abort/journal retry/refocus/denial/self-step/pending navigation/unsupported demo). API được intercept trong các fixture này; ghi rõ trong receipts. Bản release được build tại `.runtime/frontend-release-20261009/dist`; `lifecycle-release/receipt.json` là bằng chứng cuối của case bổ sung.
- Real integration: 9 nhóm case pass qua Axum/disposable PostgreSQL/Python workers; real React tạo phiên nhiều tài sản, native vendor chart ready nhận bounded first window, SSE, command receipt/idempotency/CAS và teardown exact-owned. Không đọc provider/broker/user DB để chạy load test.
- OpenAPI và 102 command contracts được freeze/check; Rust release build và Vite production build pass. Không thêm SQL migration.
- Local runtime được restart sau idle/schema/exact-owner gates; API 8010 và frontend 5180 trả 200. Không bật live broker execution hoặc migrate dữ liệu người dùng.

## Điều kiện cho đợt tối ưu sâu

Khi closed-trade history lớn hơn ngân sách projection hoặc new-page cold là workload thường xuyên: ưu tiên durable read model/async materialization và source pagination. Cần typed projection/revision contract, retention, crash/rebuild, lineage/journal invalidation và benchmark cold/warm/peak RAM trước migration. Không tăng cache RAM vô hạn để che giới hạn.

Virtualisation khi DOM thật quá lớn; Web Worker khi parse/compute tạo long task đáng kể; prefetch khi đo được xác suất chuyển trang và không tải nến/ledger không cần; CDN khi hosted. Long-duration memory, nhiều worker/principal và capacity vẫn cần soak/load trên dữ liệu đại diện. Những mục này là điều kiện promotion tiếp theo, không phải tuyên bố đã scale không giới hạn.
