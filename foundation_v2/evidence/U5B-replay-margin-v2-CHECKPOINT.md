# U5b — opt-in replay margin v2

02/10/2026 · **SCOPED_OFFLINE_PASS / FULL_U5B_OPEN**.

## Hành vi và luồng dữ liệu

`research_margin` chỉ bật khi request cung cấp version
`fixed-starting-balance-leverage-v1` và finite leverage từ 1 đến 1000.
Omitted/null giữ v1, bao gồm canonical serialized snapshot/event bytes đã freeze
trong [legacy baseline](U5B-replay-margin-v2-legacy-baseline-r1.json).

Request → frozen v2 snapshot → queue tại closed cursor → advance next open →
rounded BUY ask/SELL bid → margin admission → fill hoặc rejection → canonical
bar-close price mark → existing persistence/readers/analytics/Prop/checkpoint/fork.
Queue không đọc future quote. Rejection consume operation ID, giữ balance/equity,
không tạo trade hoặc P/L; analytics expose count và reason. V2 events phải khai
báo version riêng, mixed ledgers và calculation/assumption tamper bị từ chối.

Margin dùng Decimal không money-round trước so sánh:
`fill × quantity × contract_size × conversion_rate / leverage <= starting_balance`.
Independent boundary: open10.03/spread0.02/tick0.05 cho BUY12.406725,
SELL12.345 ở quantity0.03/contract1000/rate1.2345/leverage30; equality được nhận,
dưới ngưỡng bị từ chối.

## Quyết định và giới hạn

Original starting balance là budget cố định để so với research engine hiện có;
đây chưa là free-margin/equity model broker. Phase reset không thay margin basis.
Không thêm DB schema, migration, dependency hoặc runtime service. Store chỉ đổi
readers sang version dispatcher; PostgreSQL integration không chạy trong slice.

New readers đọc v1/v2; binary cũ không đọc v2. Rollback source chỉ an toàn cho
session v1: giữ snapshot/artifacts v2 cùng reader mới hoặc restore source commit
này trước khi tiếp session đó. Không rewrite/relabel v2 thành v1 và không migrate
dữ liệu cũ. Frontend init chưa có control bật margin; API contract là entrypoint
của opt-in này, không phải nghiệm thu order UI trọn vẹn.

## Kiểm chứng và review

- [Fail-before](U5B-replay-margin-v2-fail-before-r1.txt): 7 failures/1 legacy pass.
- [Frozen validation](U5B-replay-margin-v2-validation-r1.json) và
  [test log](U5B-replay-margin-v2-tests-r1.txt): 166 passed, 14 deselected,
  23 subtests; reference và actual pinned Nautilus parity có trong scope.
- [Root replay](U5B-replay-margin-v2-root-check.py) của core/service: 35 passed,
  2 upstream deprecation warnings; root chạy lại cùng source hashes, 35 passed
  trong0.94s, source_drift=[] và application network blocks2/self-pipe exemption1.
  [Lần chạy trước](U5B-replay-margin-v2-root-check.txt) giữ nguyên để đối chiếu.
- [Lint receipt](U5B-replay-margin-v2-lint-r1.json): không thêm E9/F/B diagnostic;
  41 diagnostics có sẵn được giữ, test formatting pass.
- Root đọc source diff và tìm consumers: production snapshot/event direct
  validation chỉ còn trong dispatcher; API/service/analytics/Prop/store dùng nó.
  Diff không thêm SQL/migration, secret hoặc quyền broker/provider/holdout.

Core/service dùng memory store + in-process ASGI và clear inherited DB env.
Socket guard chỉ miễn đúng stdlib socketpair caller cho Windows asyncio;
parent monkeypatch không là OS firewall cho native subprocess. Không mutate QA,
ledger/STATE, learner progress, raw/holdout hoặc broker.

Declared-order comparator so outcome/reason/side/cursor/time/quantity/fill/margin
với independent source oracle. Horizon closes, manual no-signal/undeclared
decisions, canonical floating path, U5a durable native restore và full U5/product
vẫn mở. Receipt này không tự ledger-accept task.
