# U5b — đề xuất optional research margin cho replay

**Trạng thái: IMPLEMENTATION_AUTHORIZED_OFFLINE, version design đã được root review; chưa có acceptance.** Bằng chứng thuộc U5b của Product Completion Plan và nối vào receipt `U5B-manual-sequence-parity-r1.json`; file này không tạo ledger hay quyền execution mới.

Root yêu cầu ngày02/10: explicit opt-in snapshot `replay-execution-v2` và event `replay-execution-event-v2`; giữ EXACT legacy omitted-field serialization/behavior. Implementation chỉ synthetic/offline, affected readers/tests cùng slice, commit sau independent root review. Không sửa frontend, mutate active QA, migrate/rewrite record cũ hoặc restart service.

Đề xuất thêm lựa chọn `research_margin` khi khởi tạo replay execution. Khi được khai báo, replay dùng đúng giả định `fixed-starting-balance-leverage-v1` của reference/Nautilus: kiểm tra ở next-bar open và lưu rejection nếu không đủ margin. Request/snapshot cũ không có lựa chọn này vẫn khớp lệnh như hiện tại. Đây là mô hình nghiên cứu offline; không mô phỏng margin của broker, free margin, liquidation hay margin-call.

## Vấn đề đã có bằng chứng

Test `test_missing_replay_margin_contract_is_exposed_as_a_real_divergence` đã chạy ở checkpoint `c98fef6`: cùng fixture, starting balance1 khiến reference/Nautilus tăng `skipped_margin` và không tạo trade; manual replay hiện vẫn có `market_fill`. Comparator từ chối vì số closed trades khác nhau. Receipt chứng minh divergence, không chứng minh margin parity.

Source đã kiểm tra:

| Owner hiện có | Hành vi liên quan |
| --- | --- |
| `research_engine.py:134,227-230` | Freeze version/leverage từ protocol; so required margin với original starting balance |
| `engine_runtime/adapter.py:41-48,69-75` | Cùng công thức và rule `required > starting_balance` thì skip |
| `contracts.py:390`, `replay_execution.py:58,281` | Request/snapshot/init chưa có margin assumption |
| `replay_execution.py:329,470` | Queue tại cursor đang thấy; next-open fill trong advance; ledger có contiguous sequence |
| `research_validation.py:80-155` | Hiện comparator chỉ đối chiếu completed protective trades; margin vẫn ở `not_compared` |
| `replay_analytics.py`, checkpoint/fork trong `replay_execution.py` | Parse từng event bằng enum; cần cập nhật reader khi thêm rejection |
| `replay.py:480-536`, `prop_replay.py:298` | Prop chỉ consume canonical `price_mark`; sequence không đồng nghĩa số nến |

## Contract đề xuất

Thêm typed `ReplayResearchMargin` ở tầng domain đang sở hữu replay contract; tránh import từ module orchestration/API ngược vào execution core. Optional init field chọn snapshot subclass v2 có required assumption; v1 model/serialization giữ nguyên:

```json
{
  "research_margin": {
    "version": "fixed-starting-balance-leverage-v1",
    "leverage": "30"
  }
}
```

- Default là `None`; không có default leverage. Omitted hoặc explicit null đều là legacy behavior.
- `version` là Literal duy nhất đã biết; `leverage` là finite Decimal trong1..1000, đồng nhất public research request hiện tại. Không nhận bool, zero, âm, NaN/Infinity, unknown version hoặc extra keys. Canonical snapshot serialize leverage thành decimal string.
- Freeze assumption khi initialize, cùng instrument/cost/spread/timeframe/starting balance và dataset lineage. Không cho thay leverage giữa session hoặc cập nhật bằng metadata patch. Queue không nhận thêm margin override.
- Original `snapshot.starting_balance` là available budget cố định. Không dùng current balance, equity hoặc `phase_initial_balance`; không trừ margin của position khác vì core hiện chỉ hỗ trợ một active/queued position. Phase transition/fork/checkpoint giữ nguyên assumption và original basis.
- Snapshot v1 không thêm optional field/null và giữ nguyên `.model_dump` bytes/keys. V2 dùng `schema_version="replay-execution-v2"` và required `research_margin`. Event legacy giữ nguyên enum/serialization không thêm version; mọi event trong v2 snapshot khai báo `schema_version="replay-execution-event-v2"`, enum v2 có rejection. Parser chọn model theo explicit version; không nhận rejection dưới legacy hoặc mixed-version ledger.
- New readers đọc v1/v2 qua version dispatcher rồi kiểm version/assumption với snapshot. Không migrate/rewrite persisted records cũ hoặc claim old-binary forward compatibility. Request omitted/null không serialize field mới ở legacy path; actual old snapshots/events được freeze trong fail-before fixture để regression kiểm EXACT bytes.

Data flow: init request → frozen execution snapshot → queued order tại closed cursor → advance một nến → next-open admission → fill hoặc rejection → bar-close price mark → persisted ledger/snapshot → analytics/checkpoint/Prop/comparator. Không đọc tương lai ở queue hoặc suy margin từ kết quả P/L.

## Admission và rejection

Trong `advance_replay_execution`, lấy bid/ask bằng `quote_from_mid(bar["open"], spread_price, tick_size)`. BUY dùng rounded ask, SELL dùng rounded bid. Trước khi tạo position/fill:

```text
units = quantity × instrument.contract_size
required_account = entry_fill × units × cost.quote_to_account_rate / leverage
available_account = original starting_balance
admit iff required_account <= available_account
```

Tính/so bằng Decimal, không làm tròn required margin theo `rounding_decimals`. Commission, slippage và financing vẫn thuộc cost/P&L contract; không cộng chúng vào công thức margin version này. Tick/spread/conversion có ảnh hưởng thông qua executable side fill và conversion rate. Reuse `InstrumentSpec`, `CostModel`, `quote_from_mid`; không thêm framework hoặc clone quote logic.

Giữ validation giá/quantity/SL/TP hiện hành. Invalid bracket vẫn là invalid-order error, không được che bằng margin rejection. Trên order hợp lệ:

| Kết quả | State/event |
| --- | --- |
| Admit | `market_fill` như hiện tại, thêm admission evidence trong details; position/protective processing tiếp tục |
| Reject | Consume pending order, không tạo position hoặc fill, không charge cost/P&L, emit `order_rejected` với reason `insufficient_research_margin` tại timestamp next open |
| Cả hai | Sau đó vẫn tạo canonical `price_mark` cuối nến, advance cursor và contiguous event sequence |

Đề xuất rejection details có `operation_id`, `reason`, `side`, quantity/fill decimal strings, `submitted_cursor_index`, `margin_required_account`, `margin_available_account`, `margin_version`, `leverage`. Common event envelope đã giữ lineage/cursor/time/account state. Admit `market_fill` thêm cùng margin calculation fields để reader/comparator không suy ngược từ closed trade. Typed/conditional validation phải từ chối missing/tampered calculation hoặc disagreement với frozen assumption; legacy fill không bị buộc có margin fields.

Rejection event không có `position_id`, pending/open counts bằng0; balance/equity giữ nguyên và floating bằng0. Bar không có exposure phải giữ `intrabar_equity_coverage=complete`. `operation_id` đã rejected là consumed, không được resubmit để tạo thêm outcome. Store revision transaction vẫn sở hữu atomicity/retry: cùng advance input tạo cùng kết quả; failure không được lưu half-event/half-snapshot. Snapshot ledger là owner outcome; không tạo bảng hoặc audit ledger thứ hai.

## Reader và parity phải cập nhật cùng nhau

- Analytics validate rejection lineage, decimal inputs, reason, account/count invariants và frozen assumption; không tạo closed trade. Có thể expose rejection count/reason như read-model metadata, không coi rejection là financial fill. Reader/UI dùng metadata để giải thích order đã bị từ chối, không để pending tự biến mất không lý do.
- Checkpoint giữ rejection trong prefix tới cutoff rồi chọn canonical price mark làm state; fork remap session/branch cho cả rejection và preserve assumption. Tampered/discontinuous event vẫn fail closed.
- Prop feed chỉ chọn `price_mark`, nhận original sequence sau rejection và không đòi mark sequence tăng đúng1. Exact retry/order/cursor/binding vẫn kiểm như hiện tại. Không feed rejection thành Prop event hoặc mở broker authority. Phase resets không đổi fixed original margin basis; comparator vẫn giới hạn single-phase.
- Comparator chỉ đối chiếu margin khi replay **opt-in** và version/leverage/instrument/cost/spread/starting balance/cutoff trùng protocol. Mismatch phải reject trước khi công nhận parity. Legacy comparator giữ protective-trade scope và `margin_admission` chưa so.
- Với opted-in declared manual order decisions, đối chiếu admit/reject, side, next-open cursor/time và independent required-margin oracle; so rejection count với engine `skipped_margin` trên cùng declared candidate set. Engine hiện chỉ có counter skip, nên count bằng nhau chưa chứng minh timing. Reuse/mở rộng source oracle để tạo expected admission records theo causal signal/overlap rule; không dùng implementation replay làm oracle.
- Chỉ thêm scope `margin_admission_for_declared_orders` sau khi có đủ records/evidence. Không bỏ toàn bộ `margin_admission` khỏi `not_compared` cho undeclared manual decisions, không suy no-signal/overlap decisions. Horizon closes, persisted no-signal/skip audit, floating-equity path và full U5b vẫn mở.

## Fixture và validation bắt buộc khi được giao implementation

Oracle hiện có: mid-open10.03, spread0.02, tick0.05 → bid10.00/ask10.05; quantity0.03, contract size1000, rate1.2345, leverage30. Long required=`12.406725`, short required=`12.345` account units. Starting1 reject; long balance đúng12.406725 admit; thấp hơn dù chỉ một decimal increment reject. Không được money-round thành12.41 trước so sánh.

| Nhóm | Bằng chứng cần đạt |
| --- | --- |
| Threshold độc lập | BUY/SELL; dưới/bằng/trên boundary; conversion, quantity/contract size và ticks; fees/slippage thay đổi P/L nhưng không đổi margin version này |
| Causality | Queue giống nhau khi mutate future next-open; outcome chỉ đổi khi advance nhìn thấy open. Mutate suffix sau completed admission giữ semantic prefix |
| Legacy | Omitted/null contract đọc snapshot cũ và giữ current fill/trade/event semantics, gồm fixture insufficient balance trước đây vẫn fill |
| Persistence | Rejection + mark được lưu atomically; consumed operation ID; revision conflict/exact retry; reconstruct/fork giữ outcome/assumption, không resurrect pending |
| Consumers | Analytics0trades khi reject; mark balance/equity đúng; Prop ordered-mark feed và retry qua sequence gap; phase carry/reset không đổi margin basis |
| Parity | Reference và actual pinned Nautilus trên synthetic same-segment; rejection/admit/calculation cùng independent oracle; wrong version/leverage/rate/basis/cutoff và tampered event bị reject |

Focused execution-core/analytics/Prop/comparator tests trước; mở regression quanh reader/snapshot chỉ khi liên quan. DB integration chỉ trên disposable test DB được xác minh hoặc memory store hiện có; không sử dụng inherited DSN để né gate. Native run offline theo runtime đã pin. Không đọc raw/holdout, mutate active QA sessions, chạy provider/broker, đổi active service/config/global environment hoặc migration trong slice này.

## Trade-off và bước tiếp theo

Giữ fixed original budget giúp so replay với engine hiện có; đây chưa phải free-margin risk model thực tế và lợi nhuận/thua lỗ không làm tăng/giảm admission budget. Opt-in giữ compatibility hành vi cũ nhưng có thêm event/reader contract cần kiểm đồng bộ. Phạm vi implementation nhỏ nhất là typed optional assumption + next-open outcome + toàn bộ affected readers + declared-order parity tests; UI trading/order-management rộng hơn không được kéo vào chỉ để đóng U5b.

Root đã review version design và giao source slice theo phạm vi trên. Các validation ở bảng là **planned** cho đến khi receipt runtime được ghi; proposal không tự công nhận margin/fullU5b đã đạt.

Source SHA256 tại lúc audit (để phát hiện drift trước implementation):

| File trong `foundation_v2/` | SHA256 |
| --- | --- |
| `trading_workspace_v2/contracts.py` | `0831651eb7d78ed74bcab14c8db9c076674f752601f85811d1a57446c5cfcc64` |
| `trading_workspace_v2/replay_execution.py` | `b9638541c5c35347cf223a4a337b15a5896449ad6b65fb6b515c30294c842cd2` |
| `trading_workspace_v2/replay.py` | `a4f361154d1b556011b228026c933ebd7db9a9dc1f1466565887f382588eb3cf` |
| `trading_workspace_v2/replay_analytics.py` | `91fafa4bbf06d38240645eccf3ae845892d16494a32ba57d1c93bc560c8b4214` |
| `trading_workspace_v2/prop_replay.py` | `62690b38fb43e033718436bc584be5c3794886ae81f70111da4b0eef077209d5` |
| `trading_workspace_v2/research_engine.py` | `8d4354f9d8042f36885c3976d69e5e7ebfaf20474fe459c0c234f38fdd118f05` |
| `trading_workspace_v2/research_validation.py` | `dba1fa87a4174b2c0c8ac29b5d4ae457ca85117fbe1351dd2eecede394dd48b2` |
| `engine_runtime/adapter.py` | `fadd7d63f80e6736ce85c9d32a016cf41159844875a360c8e49c795c8945d386` |
