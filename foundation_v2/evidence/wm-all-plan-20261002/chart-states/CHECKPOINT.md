# W8 — mixed OHLC, five chart types and mouse gestures

02/10/2026 · **SCOPED_RENDERER_PASS / ROOT_REVIEWED / FULL_W8_OPEN**.

Run completed23:58+07 on02/10; receipt/teardown finalized just after00:00+07
on03/10. Folder name retains the parent execution date.

Existing renderer được kiểm với independent bounded OHLC variant:61rows gồm nến
tăng/giảm xen kẽ, giá đóng qua initial baseline ở cả hai phía; history20 chỉ21rows.
Variant chỉ tồn tại trong route fixture của browser. Canonical chart fixture,
approved golden images và application source không đổi.

## Kết quả và data/state

Final [r3 report](r3-matrix/report.json):8/8cases,0skip/flaky/unexpected,54.274ms.
Light/dark ×1440×900/1280×800/768×1024/390×844 có40chart-type states,
40wheel/pan journeys và48captures. Renderer dùng server-visible prefix →
Lightweight Charts series; selector thay series và giữ viewport, không thay session
cursor hoặc cấp dữ liệu tương lai.

Kiểm Candles/Bars/Line/Area/Baseline bằng actual canvas colors, distinct captures,
crosshair #31/OHLC oracle, wheel giảm logical span, pan đổi range, switch type giữ
range trong0.01logical units, và fit trở về toàn bộ prefix. Candles/Bars/Baseline
có cả red/green; Line gold, Area green. Volume/SMA có actual overlay pixels.
History/reload giữ21rows, selected20/canonical60,0objects,play/stepdisabled.
Không application pageerror, unexpected request hoặc horizontal overflow>1px.

Source hash ở cả8receipts:
`8205c89b2d79a832cb853ccad28b08ca13e1d9da67b2c185a517742752a180f1`.
[Manifest](MANIFEST.json) giữ hashes/raw bytes của186copiedfiles,6.567.674bytes,
bao gồm prior attempts. Không cần build/regression product lại vì không sửa source;
test/config mới là reusable coverage cho renderer hiện tại.

## Failure và repair của harness

- [r1 matrix](r1-matrix/report.json):8pass trước khi thêm viewport-switch/overlay
  assertions; không coi đó là proof cho assertions mới.
- [r2 matrix](r2-matrix/report.json):8fail ở exact-RGB SMA pixel threshold.
  Đường SMA một pixel có antialias, chỉ8/2/0pixels giữ exact gold ở các widths;
  failed screenshot/error-context được giữ. Large traces vẫn tại original
  `.artifacts/wm-all-plan-20261002/chart-states-r2-matrix/results` trong workspace.
- Harness dùng distinct gold hue cho antialiased SMA, vẫn đòi>10renderedpixels,
  và bounded poll tới canvas paint. [Probe](r3-probe/report.json):2pass ở desktop
  dark/mobile light, sau đó final matrix8pass. Không đổi application source hoặc
  giảm margin/data/cutoff oracle để làm green.

Root directly viewed five desktop-dark type images và mobile-light
`candles-volume-sma.png`/`baseline.png` của r1. Tất cả7 ảnh đó byte-equal với final
r3 captures theo SHA256: readable wave/candles, both baseline directions, visible
volume/SMA, fixed dark plot consistent với current contract. Không claim independent
visual approval; `SCOPED_BEHAVIOR_PASS_VISUAL_REVIEW_PENDING` trong machine receipt
là pending independent/golden review, root inspection được ghi riêng ở đây.

## Runtime, lệnh và giới hạn

Fresh listeners5180/8020/8030 absent trước run. Root khởi scoped Vite tại5186,
PID18572/tool session34774, rồi kiểm exact process command trước teardown.
Final check không còn listeners5180/5186/8020/8030. Không API/DB/service reseed.
Browser chỉ cho loopback origin và GET/HEAD, mọi `/api` được fulfill bằng labeled
synthetic fixture, websockets bị đóng; đây không là backend persistence acceptance.

Tại `foundation_v2/web`:

```powershell
$env:TW_CHART_STATES_ORIGIN='http://127.0.0.1:5186'
$env:TW_CHART_STATES_OUTPUT='<owned attempt directory>'
node D:/ANNAM/TradingWorkspace/tooling/ui-qa/node_modules/@playwright/test/cli.js test --config tests/visual/playwright.chart-states.config.mjs
```

Khởi Vite5186 riêng trước lệnh theo README; script không tự start product/backend.
Không auto-update golden. Touch/pinch, keyboard-only chart pan, independent visual
approval, manualWCAG, chartlong-session/60Hz, fullW8/U4/product và broker remain
open. Snapshot/golden mutation, provider/raw/holdout và ledger acceptance không
thuộc slice. Existing ledger/STATE vẫn r389/37accepted tại recorded scope.
