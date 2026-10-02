# Chart r4 — Learn CTA independent review

**SCOPED_REVIEWER_APPROVED_FOR_CHART_BASELINE_PROMOTION** cho đúng 24 image hash trong `chart-visual-approval.json`. Source `8205c89b2d79a832cb853ccad28b08ca13e1d9da67b2c185a517742752a180f1`; fixture `c48bd42eebdfcf57ca9cf707d2d3230439d81f9aff05d2b61c92dfe4adc52591`.

24 ảnh r4, 8 ảnh top baseline cũ và 8 crop focus đã được xem trực tiếp. Harness chart hiện có pass 8/8, không skip/flaky/error. Candle prefix 61/21, UTC/OHLC, crosshair index 30/10, fixture objects 4/0, fit range và lịch sử reload giữ đúng contract.

CTA nằm trong range footer, dẫn qua routeHref/learnHref với workspace/session/dataset/cursor/cutoff và from=replay. Trên actual isolated QA, 8 theme/viewport × 2 cutoff pass: Tab đi từ Tới cutoff tới CTA, focus 2px rõ, Enter mở Learn; quay lại giữ prefix/summary. Các action tiến nến/phát ở history vẫn disabled. Không có overflow, page error, request ghi hoặc ngoài loopback. Crop group cắt phần outline ngoài bounds ở trên/dưới; geometry viewport vẫn có đủ margin.

Delta chính là CTA (404 pixel) ở desktop/mobile và group range căn giữa (1369 pixel) tại tablet. 24 cặp candidate/repeat giống byte; 8 history pane và tổng 14/16 chart-frame ảnh giống byte baseline cũ. Hai chart-pane còn lại có delta raster rất nhỏ trên một hàng đường last-price. Top theme sáng còn có mép nút vài pixel.

| Project | Image | Nonfooter pixels | Max channel delta /255 |
|---|---|---:|---:|
| dark-1280x800 | chart-top.png | 21 | 3 |
| dark-1280x800 | chart-pane.png | 21 | 3 |
| light-1440x900 | chart-top.png | 46 | 4 |
| light-1440x900 | chart-pane.png | 34 | 3 |
| light-390x844 | chart-top.png | 9 | 1 |

Các delta ngoài footer không dịch chuyển geometry/nội dung/nến/OHLC/cutoff; đã xem ảnh diff và so sánh màu cụ thể. Nguyên nhân renderer chính xác chưa được chứng minh; không gọi kết quả này là mọi pixel chart giống hệt. Config comparator hiện hành có maxDiffPixels=0 nhưng giữ default perceptual threshold của Playwright, nên cũng không đồng nghĩa hash equality. Root phải chạy lại 8 comparator sau promotion.

Root được copy đúng 24 hash r4, ghi promotion, chạy comparator; reviewer không sửa source/baseline/ledger hay commit. Tất cả failure/receipt trước giữ nguyên. Phạm vi không bao gồm full Learn, full WCAG, annotation persistence, toàn W8/product/broker hoặc owner acceptance.

Receipt SHA256: `d162fd19c8881f0d837bf2981ae363db569677f9bf4f551ccc63acdb0bf24e4b`. Pixel measurements: `candidate-comparison.json` SHA256 `06c878c789b3a2681cfbff04ffc524c34aee958259bfa9546b2b3e91468f1ee9`. Actual QA keyboard/cutoff: `learn-link-verification.json` SHA256 `9b0d520f11ec085d6d5419fc418f265ff9e1667c68b8d6c4c5aeba385a4948fb`.
