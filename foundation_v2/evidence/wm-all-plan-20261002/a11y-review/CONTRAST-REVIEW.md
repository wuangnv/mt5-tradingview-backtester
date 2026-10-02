# Partial WCAG contrast triage

Hai finding còn mở: placeholder Journal dark không đạt4.5:1 và cột provider Data Desk rộng0px ở desktop1440/1280. Review không sửa source, baseline hay ledger.

Source trước/sau: `71373c3a4a02e1d3cd68ff3e6bffbd92a8dfdb153a5f3c8d39aa3ac5cc8030fa`. Original axe receipt: `../ui/a11y-full.json` (144cases). Manual triage18 target,48 observations dark/light ở1440; focused Data thêm8 observations trên1440/1280/768/390.

## Finding đã xác minh

- **A11Y-01 — Journal dark**: placeholder thực tế `#757575` trên `#0c1113`, **4.1239:1 <4.5:1**, font12px. Text đã nhập16.1083:1; light placeholder4.6075:1. Field enabled, visible sau scroll. Screenshot: `journal-dark-contrast.png`; không điền/lưu data. Đề xuất dùng muted token hiện có sau khi root thả source freeze, rồi kiểm tra lại cả hai theme và tạo receipt cho source hash mới.
- **UI-01 — Data desktop**: cả hai theme, grid ở1440 là `0px 150px 244.5px`, ở1280 là `0px 150px 184.5px`. First column0px, row1223px; `Có: read_metadata` thành16 dòng, entitlement47 dòng. Contrast6.66:1 dark/6.23:1 light vẫn đạt; không thể vì vậy công nhận readability. 768 first column194.7px/row95px,390 first column308px/row137px. Document không overflow ở cả8 case, nên overflow-only check bỏ sót lỗi. Đây là finding layout xác minh, không tự gán full WCAG reflow failure. Nên xếp metadata/status/capabilities thành hàng trong aside hẹp hoặc giới hạn auto tracks; kiểm tra lại đủ4 widths và2 themes sau patch.

## Phân loại18 target

16 target có ratio đạt ngưỡng đo; Data nằm trong16 nhưng layout vẫn mở. Một target là graphic trang trí dư nghĩa; một target chứa placeholder fail. Các ratio chart dùng nền canvas thực tế `#030303`, không lấy nhầm ancestor `#050607`.

| Target | Dark ratio | Light ratio | Classification |
| --- | ---: | ---: | --- |
| `.fx-theme-icon` | 16.82 | 13.84 | CONTRAST_RESOLVED |
| `.fxr-select-chevron` | 9.91 | 9.91 | CONTRAST_RESOLVED |
| `.fx-chart-icon-button` | 11.06 | 13.84 | CONTRAST_RESOLVED |
| `button[aria-label="Vẽ đường xu hướng"]` | 9.31 | 9.31 | CONTRAST_RESOLVED |
| `button[aria-label="Vẽ vùng giá"]` | 9.31 | 9.31 | CONTRAST_RESOLVED |
| `button[aria-label="Mở danh sách đối tượng"]` | 9.31 | 9.31 | CONTRAST_RESOLVED |
| `button[aria-label="Vừa toàn bộ nến đã mở"]` | 9.31 | 9.31 | CONTRAST_RESOLVED |
| `.chart-symbol-strip > strong` | 20.62 | 15.13 | CONTRAST_RESOLVED |
| `.chart-symbol-strip > span:nth-child(2)` | 9.62 | 9.62 | CONTRAST_RESOLVED |
| `.chart-symbol-ohlc` | 5.92 | 5.92 | CONTRAST_RESOLVED |
| `a[aria-label="Journal tại cutoff này"]` | 10.84 | 10.84 | CONTRAST_RESOLVED |
| `a[aria-label="Analytics của session"]` | 10.84 | 10.84 | CONTRAST_RESOLVED |
| `.live-secondary-button > span[aria-hidden="true"]` | 20.62 | 13.84 | CONTRAST_RESOLVED |
| `div:nth-child(1) > small:nth-child(2)` | 6.66 | 6.23 | CONTRAST_RESOLVED_LAYOUT_OPEN |
| `li[data-step="context"] > .rs-step-index` | 10.22 | 10.22 | CONTRAST_RESOLVED |
| `li[data-step="quality"] > .rs-step-index` | 10.22 | 10.22 | CONTRAST_RESOLVED |
| `.rs-state-mark` | 9.82 | 2.10 | DECORATIVE_REDUNDANT_GRAPHIC |
| `textarea[rows="8"]` | 4.12 | 4.61 | FINDING_OPEN |

Research `○` light chỉ2.10:1. Nó không interactive và không mang thông tin bắt buộc: adjacent text đã ghi rõ “Chưa có result” và hướng dẫn bước tiếp theo. Vì vậy scope hiện tại là decorative redundant graphic; không biến2.10 thành PASS numeric và không mở rộng exemption sang glyph/state khác. Rendered context được xem trực tiếp ở `research-result-status-dark.png` / `research-result-status-light.png`.

Select chevron và chart symbol strip có `pointer-events:none`. Hit-test trả SELECT/canvas bên dưới vì CSS đó, không phải text bị che. Screenshot đã kiểm tra trực tiếp. Journal obscured axe incomplete được kiểm tra sau scroll; placeholder contrast failure vẫn giữ nguyên.

## Bằng chứng bổ sung và giới hạn

Computed reduced-motion14 initial route/theme observations: media query matches, không có animation/transition/smooth scroll còn hoạt động (kể cả pseudo styles). Reuse keyboard receipt hash `0b715896aae13681484700baae38ff0aa4040887d901e0b9d98749d206530ba0`, PASS2 dark/light390: ledger native arrow scrolling, số canh phải/hiện được, focus outline, menu loop/Escape/focus restoration. Các bằng chứng này chỉ scoped coverage; không nhận every-state keyboard/screen-reader hay toàn bộ WCAG2.2 AA.

Toàn bộ12 crop được kiểm tra trực tiếp; hashes nằm trong `contrast-review.json`. Read-only loopback GET/HEAD/OPTIONS, WebSocket đóng;0page errors/blocked requests/writes. Không phải full W4/W7/W8/product/heap/broker acceptance. Root giữ quyền patch, promotion, commit và ledger.
