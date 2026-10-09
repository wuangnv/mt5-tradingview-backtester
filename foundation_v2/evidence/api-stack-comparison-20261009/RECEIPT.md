# So sánh nền API — 09/10/2026

## Quyết định

Chọn **Rust + Axum + Tokio làm nền API đích**, giữ Python cho worker
research/backtest và adapter QDM, PostgreSQL cho metadata, Parquet/Arrow + DuckDB
cho dữ liệu lịch sử/phân tích, React/Vite và chart integration hiện tại cho UI.
Browser dùng HTTP JSON/OpenAPI; tiến độ một chiều dùng SSE. WebSocket dành cho
luồng hai chiều thật. Không thêm GraphQL hoặc gRPC-Web vào browser; gRPC nội bộ
chỉ cần được đánh giá khi có worker/service mạng độc lập.

Lý do chọn Axum là cân bằng giữa throughput bài CPU và working set thấp trong
phép đo local này. Axum không thắng mọi bài: Go dẫn bài DB/JSON ở lượt xác nhận,
Spring khá sát ở bài CPU, .NET mạnh ở DB. Không suy diễn thứ hạng này thành
"Rust nhanh nhất mọi trường hợp" hoặc mức tăng tốc toàn ứng dụng.

Xem [quyết định và ranh giới chuyển API](../../docs/API-STACK-DECISION-20261009.md).
**Chưa chuyển runtime sản phẩm**; 98 routes hiện tại được kiểm kê, không bị rewrite
bởi benchmark. Không sửa DB/dataset/service đang dùng, broker, holdout hoặc UI.
Luồng SSE được gác lại khi owner yêu cầu chọn nền API qua kiểm tải trước.

## Kết quả xác nhận

Máy Windows 11, i5-9400F sáu core, khoảng 34.3 GB RAM. API + DB dùng bốn core;
load generator dùng hai core khác. Các ứng dụng khác vẫn chạy và có tải CPU nền,
nên con số là diagnostic local, **không phải capacity của một máy production sạch**.

Mỗi ô throughput dưới là median của hai lượt, 6 giây/lượt, HTTP/1.1 keepalive,
128 kết nối tổng, không pipelining. Có warm-up và đổi thứ tự ứng viên/bài.
Các server có tổng tám kết nối DB, dùng chung SQL/index và dữ liệu tổng hợp.

| Công nghệ | JSON nhỏ, req/s | Lọc/sort trades, req/s | CPU so FastAPI | DB count + page, req/s | Peak working set bài CPU, MB |
| --- | ---: | ---: | ---: | ---: | ---: |
| FastAPI/Uvicorn | 3,131 | 152 | 1.00x | 566 | 389.08 |
| Rust/Axum | 33,316 | 1,765 | 11.64x | 976 | 19.23 |
| Go/Gin | 37,317 | 723 | 4.77x | 1,303 | 50.20 |
| Go/Fiber | 32,725 | 905 | 5.97x | 1,193 | 53.13 |
| Node/Fastify | 29,151 | 546 | 3.60x | 934 | 504.98 |
| C#/ASP.NET Core | 33,232 | 1,007 | 6.64x | 1,050 | 139.51 |
| Java/Spring | 23,481 | 1,702 | 11.23x | 834 | 325.14 |

Nguồn trực tiếp: [summary](confirmation/summary.json), [samples và resource trace](confirmation/results.json),
[raw autocannon](confirmation/raw-timings.json), [hash nguồn/binary](confirmation/provenance.json),
[runtime/dependency versions](confirmation/runtime-versions.json).

Bài CPU dùng nguồn 100,000 dòng chia hai workspace; server giữ 50,000 dòng của
tenant-a, chọn 16,667 dòng EURUSD, sort theo PnL giảm dần/ID tăng dần và trả 25 dòng
kèm tổng. PnL dùng integer cents. Scope guard của fixture là hằng số tenant-a,
không đại diện cho trusted identity/membership, revision, lineage hoặc cutoff của
sản phẩm. Bài DB đọc table 100,000 dòng cùng phạm vi qua một SQL count + page.
Đây là contract thử có tính đúng được đối chiếu, không phải port toàn bộ report
engine hiện tại.

Qua hai lượt xác nhận, CPU throughput dao động: FastAPI 144–159, Axum 1,591–1,938,
Gin 635–812, Fiber 824–985, Fastify 501–591, .NET 811–1,203, Spring 1,644–1,759.
Axum và Spring gần nhau; không có cơ sở thống kê để khẳng định Axum luôn nhanh
hơn Spring. Mức working set là điểm phân biệt rõ trong fixture này. JSON nhẹ có
thể tiến gần giới hạn generator/localhost; không dùng để công bố trần framework.

Working set là đơn vị MB thập phân (1,000,000 bytes), lấy peak mẫu 150 ms; tổng
qua nhiều process có thể đếm shared pages nhiều lần. Không phải retained heap
hay dự báo RAM của toàn app. Percentile có độ phân giải ms; giá trị 0 ở các bài
nhẹ trong raw data có nghĩa dưới độ phân giải, không phải request mất 0 thời gian.

## Tải liên tục và validation

| Lượt CPU 60 giây, 128 kết nối | Axum | .NET |
| --- | ---: | ---: |
| Successful req/s | 1,798 | 1,276 |
| p99 latency | 200 ms | 240 ms |
| Peak working set | 19.36 MB | 147.23 MB |
| Working set trung bình giây 10–20 | 18.08 MB | 113.20 MB |
| Working set trung bình sau giây 50 | 17.80 MB | 101.73 MB |
| Errors / timeouts / non-2xx | 0 / 0 / 0 | 0 / 0 / 0 |

Không thấy working set tăng trong cửa sổ một phút này; không coi đó là chứng nhận
không memory leak/chạy ổn nhiều ngày. Không có bằng chứng concurrency 128 tương
đương 128 người dùng hoặc sức chứa của 98 routes thực.

- Vòng đầu: 126 timed cases, hai lần cho bảy ứng viên × chín case; 868 kiểm tra
  contract trước/sau tải, 3,149,049 successful responses.
- Vòng xác nhận: 56 timed cases và hai lượt 60 giây; 868 kiểm tra contract,
  2,703,138 successful responses, không error/timeout/non-2xx ở tải đo.
- Tổng 1,736 kiểm tra HTTP contract: scope sai/thiếu bị từ chối, tham số số ngoài
  giới hạn, total, toàn bộ nội dung/order của page, page rỗng vẫn giữ tổng.
- Bốn unit tests bổ sung cho fixture: tenant/order/ties, page rỗng, page không
  trùng và không mutate dữ liệu, command không nhận DB sản phẩm/public bind.
- Release builds thành công cho Rust/Go/.NET; Java package thành công. Python
  compile và Node syntax checks đã chạy. Confirmation source/binary hashes
  được so lại sau chạy, không drift.
- [Cleanup receipt](cleanup.json): không còn API port thử đang nghe, không còn
  postmaster.pid của các cluster do experiment tạo. Không dừng PostgreSQL khác.

## Các lỗi và điều chỉnh được giữ lại

Lượt đầu tiên bắt lỗi total của page vượt quá dữ liệu trong SQL thử; đổi mọi ứng
viên sang `query.sql` chung trước khi đo. Lượt kế tiếp lỗi khi gán affinity cho
PostgreSQL child có quyền giảm trên Windows; runner kiểm affinity đã kế thừa
trước khi thay đổi và vẫn xác nhận core thực tế. Hai attempt này không có matrix
được nghiệm thu; ghi lại trong main-r3 provenance.

Vòng đầu main-r3 có 2,870 connection errors ở Spring, không có non-2xx. Tomcat
mặc định đóng keepalive sau 100 request. Vòng xác nhận cấu hình unlimited keepalive
cho fixture, lỗi biến mất; không gọi lỗi benchmark client này là lỗi domain của
Spring. Python pool được đổi sang autocommit cho single-statement read, phù hợp
với các driver khác. Các khác biệt ghi trong provenance/README; bảng chính chỉ
dùng confirmation. [Vòng đầu](main-r3/results.json),
[raw vòng đầu](main-r3/raw-timings.json),
[tài liệu keepalive Spring](https://docs.spring.io/spring-boot/4.0/appendix/application-properties/index.html).

Portable Go/Java/Maven được tải từ upstream và kiểm checksum; không đăng ký PATH
hoặc service. Node install tắt package scripts. Rust/NuGet/Maven dùng toolchain
hiện có và cache/dependency theo cơ chế của chúng; benchmark có lockfiles và hash.
Lần gọi .NET SDK đầu khởi tạo development HTTPS certificate local; không gọi lệnh
trust hoặc dùng nó cho API thử (API dùng loopback HTTP).

[npm audit](npm-audit.json) có ba mục moderate trên cùng chuỗi
autocannon → hyperid → uuid (thiếu buffer bound check ở một số hàm UUID với buf).
Đây là load tool của experiment, không đưa vào dependency sản phẩm; không thay
dependency giữa các lượt để làm mất tính so sánh. Trước reuse với dữ liệu/target
không tin cậy, cần cập nhật/review tool và chạy lại benchmark. Các fixture package
không được coi là dependency set đã audit đầy đủ để deploy production.

## Reproduce và giới hạn còn lại

[README experiment](../../experiments/api-stack/README.md) có lệnh build/run.
Lượt confirmation dùng:

```powershell
.runtime/python/Scripts/python.exe run.py --pg-bin '<portable PostgreSQL bin>' --output '<confirmation evidence>' --seconds 6 --repeats 2 --headline --soak-seconds 60 --soak-only axum,dotnet
```

Đã kiểm tải bảy implementation trong scope này, không "toàn bộ công nghệ trên
thế giới", không so giao thức REST/gRPC/GraphQL bằng phần trăm. HTTP/2, TLS,
distributed event delivery, writes/transactions, real auth/domain outputs,
production browser journeys và soak nhiều giờ còn cần kiểm trong migration.
Không cộng % của các phase hoặc lấy 11.64x làm tốc độ toàn project.

Hướng nền API đã chọn; phần triển khai cần thay read endpoint thật, giữ contract
và đo lại end-to-end trước khi mở rộng theo route families. Điều này khác với
chờ có lỗi mới quyết định công nghệ, và không biến fixture thành product acceptance.
