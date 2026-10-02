# Journal, Data và Learn runtime repair — 02/10/2026

**SCOPED_REPAIR_VALIDATED — source, functional flow and reviewed chart promotion pass.**

Journal placeholders nay dùng muted token với opacity1. Data provider metadata,
status và capabilities xếp một cột để không ép tên provider về0px ở desktop;
entitlement và warning text dùng màu theo theme. Learn context có named group,
lesson text dùng semantic colors, summary/progress/course reader xếp lại tại
tablet width có rail248px. Link `Học & thuật ngữ` ở bottom chart vẫn dùng
`learnHref` hiện có và hiện sau khi chart mount, kể cả viewport hẹp.

Workspace/session/cursor vẫn chọn persisted read model. Historical view20 có
21nến; canonical/payloadcursor60 không bị advance hoặc ghi lại. Learn chỉ đọc
course/resources/glossary/progress; browser GETs cho Learn được chuyển tới
API8030 tạm với root thật, Replay vẫn đọc API8020 qua Vite5180. Unknown/denied/
unconfigured vẫn có trạng thái thật, không trả fixture thành công.

Trade-off: Data provider rows cao137px, đổi lấy chữ nguyên vẹn trong panel hẹp;
Learn ưu tiên đọc tuần tự một cột ởtablet. Reuse components/tokens, không thêm
framework, wrapper hoặc financial evaluator. Existing API8020/course binding
không bị restart/thay đổi; README dẫn hai biến cấu hình Learn đã có trong API.

## Bằng chứng và các lượt lỗi giữ lại

Final raw UI source fingerprint:
`8205c89b2d79a832cb853ccad28b08ca13e1d9da67b2c185a517742752a180f1`.

- Build77modules và76web tests pass; outputs `../web-build-ui-repair-final.txt`
  và `../web-tests-ui-repair-final.txt`. Existing740kB JavaScript warning còn.
- `a11y-final.json`:144actual local route/theme/width cases pass, zero violations,
  unresolvedARIA, errors, unexpectedrequests hoặc document/content overflow;
  sourcebefore/after bằng nhau. Learn ở active8020 là unavailable state trong scan
  này; real-ready Learn dùng receipt riêng bên dưới. Automated pass không là WCAG
  certification; manual contrast incompletes được review theo target cụ thể.
- `visual-final.json`:32/32 four-route comparisons match approved images với
  maxDiffPixels0/default perceptual threshold. Bốn route golden files không được sửa.
- Independent Journal/Data review `../a11y-review/repair-r2/` có16cases,
  416assertions/16crops: placeholders6.37:1dark/6.23:1light, entitlement9.12:1dark/
  5.04:1light; provider width418.5/358.5/646/308px. Receipt pin e993bb… trước
  Learn-only delta. Final-source warning review và chart review nằm ở owner riêng.
- [Learn real-ready](../learn-ready/CHECKPOINT.md):10actual API checks,
  6readyUIcases và6fullyloadedchart roundtrips pass trên finalsource. Course/progress
  hashes unchanged; noanswerkeys/writes. Root xem trực tiếp light768 screenshot;
  course text/summary/progress có đủ width và readable. Actual8030worker12572 và
  Windowslauncher10888 đều gone, listenerabsent; rawlifecycle label được giải
  thích bằng receipt, không overwrite.

`a11y-after-css-r1-fail.json` giữ entitlement failure. R2scan và comparator bị
source drift được giữ là diagnostic, không dùng làm finalaccept. Warning list
light2.019:1 được phát hiện sau provider row hếtcollapse và được sửa. Learnr1
roundtrip là loading-state race; r3 chứng minh CTA mất khi chart fullyloaded.
R4 sai oracle vì expectedhistorical20 trong canonicalpayload60; r5 kiểm đúng
view20/canonical60/21rows. Failedreports và screenshots vẫn ở từng attempt.

Chart CTA đã qua [independent review](../chart-review/r4/CHART-VISUAL-REVIEW.md):
24candidate images/8focus crops xem trực tiếp,8viewport/theme ×2cutoff keyboard
journeys pass. Root copy đúng24approved hashes, giữ previousmanifest ở
`previous-chart-PROMOTION.json`; `chart-final.json` comparator8/8pass sau promotion.
24repeat image hashes bằng nhau.14/16chart-frame images giữ byteidentity với
baseline cũ; các tiny nonfooter raster deltas≤4/255 được đo và công khai, không
được gọi là mọi chart pixel giống hệt. Playwright maxDiffPixels0 vẫn dùng default
perceptual threshold; exactbytes là guarantee của promotion copy, không của comparator.

First post-promotion comparator fail8/8 vì hai service5180/8020 đã gone,
không chạy tới chart assertions (`chart-service-down-fail.json`). Background
Start-Process launch bị policy review reject với lý do chung blocked by policy.
Root dùng tool-owned exec sessions hẹp hơn, API GET/HEAD/OPTIONS only và no reload,
Vite proxy8020; verifiedsameQA revision123/canonical60/view20/21rows. Không reseed,
reset, migrate hoặc đổi learner binding. Scope/PID/session ở `services-resume-r1/`;
new comparator8/8pass. Các service này thay các process đã absent, không kill
service khác. Future schema/backend edits không auto-reload service read-only này.

Alt chart types/down candles/fullgesture/manualWCAG/wholechart performance và
full U/Y/W acceptance còn mở. Precise one-hour Analytics fixture heap PASS ở
`../heap-long/`; không suy whole-chart performance từ receipt đó.

Rollback revert coherent source/evidence/baseline change của slice; giữ unrelated
WIP, old receipts và dữ liệu. Broker/provider/holdout/OAuth/learner authority không
đổi.
