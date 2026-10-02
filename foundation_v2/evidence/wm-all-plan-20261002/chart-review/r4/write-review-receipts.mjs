import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const out = path.dirname(fileURLToPath(import.meta.url)), foundation = path.resolve(out, '../../../..')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const digest = file => sha(readFileSync(file))
const json = file => JSON.parse(readFileSync(file, 'utf8'))
const normalized = file => file.replaceAll('\\', '/')
const evidence = file => ({ path: normalized(file), sha256: digest(file) })
const sourceRoot = path.join(foundation, 'web/src'), sourceDigest = createHash('sha256')
for (const name of readdirSync(sourceRoot, { recursive: true }).filter(name => /\.(jsx?|css)$/.test(name)).sort()) sourceDigest.update(name).update(readFileSync(path.join(sourceRoot, name)))
const sourceHash = sourceDigest.digest('hex')
assert.equal(sourceHash, '8205c89b2d79a832cb853ccad28b08ca13e1d9da67b2c185a517742752a180f1')
const reviewedAt = new Date().toISOString()
const warningOut = path.resolve(out, '../../a11y-review/warning-repair-r1')
const warningPath = path.join(warningOut, 'warning-measurements.json'), warning = json(warningPath)
assert.equal(digest(warningPath), 'ee52260e4bb858c875b25f79923806ca4d1827cb89a90638daab6aaf8a0865dc')
assert.equal(warning.sourceBefore, sourceHash); assert.equal(warning.sourceAfter, sourceHash)
assert.equal(warning.cases.length, 8); assert.equal(warning.screenshots.length, 8)
for (const key of ['pageErrors', 'blockedRequests', 'failures']) assert.deepEqual(warning[key], [])
for (const item of warning.cases) {
  assert.equal(item.texts.length, 4)
  for (const text of item.texts) { assert.ok(text.contrastRatio >= 4.5); assert.equal(text.contrastPass, true); assert.equal(text.inViewport, true) }
}
for (const item of warning.screenshots) assert.equal(digest(item.path), item.sha256)
const triagePath = path.resolve(warningOut, '../warning-triage-r1/warning-measurements.json')
assert.equal(digest(triagePath), '3758296aa18bdd49a8f5228fbc97d695ca1eba60ab8e84e4420ae9a4d8667ea8')
const r2Path = path.resolve(warningOut, '../repair-r2/repair-review.json')
assert.equal(digest(r2Path), '65720dfc18c31930ef34228c98fb045b773b289c2549431b2b0c782da0254040')
const warningReview = {
  schemaVersion: 1, status: 'SCOPED_WARNING_REPAIR_REVIEWER_PASS', reviewer: '/root/mt5_independent_review', reviewedAt, sourceHash,
  scope: 'Data Provider capabilities safety-warning title and three list items; actual isolated GET-only QA; dark/light × 1440/1280/768/390; measured contrast and directly inspected layout',
  selector: warning.selector, measuredEvidence: evidence(warningPath), caseCount: 8, textObservations: 32,
  results: warning.cases.map(item => ({ theme: item.theme, width: item.width, titleContrast: item.texts[0].contrastRatio, listContrast: item.texts.slice(1).map(text => text.contrastRatio), allInViewport: item.texts.every(text => text.inViewport), renderReview: 'Directly inspected full crop; title/list readable, mobile natural wrapping, no observed clipping or overlap' })),
  images: warning.screenshots.map(item => ({ ...item, path: normalized(item.path), directlyInspected: true })),
  preservedEvidence: [evidence(triagePath), evidence(r2Path)],
  resolvedFinding: 'Historical light-theme list contrast 2.019333456 < 4.5 is repaired to 6.225245; dark list 9.618761768; source final 8205, not the old e993 receipt',
  exclusions: ['Not full WCAG certification, canvas contrast or assistive-technology acceptance', 'No provider/broker/account authority, product completion or owner acceptance', 'Earlier historical failure and earlier scoped receipts remain unchanged']
}
const warningReviewPath = path.join(warningOut, 'warning-repair-review.json')
writeFileSync(warningReviewPath, JSON.stringify(warningReview, null, 2) + '\n')
writeFileSync(path.join(warningOut, 'WARNING-REVIEW.md'), `# Data safety warning — final repair review\n\n**SCOPED_WARNING_REPAIR_REVIEWER_PASS**, source \`${sourceHash}\`.\n\n8 case dark/light × 1440/1280/768/390, 32 text observations; 8 crop đã được xem trực tiếp. Tiêu đề và ba dòng quy tắc an toàn đều vượt 4.5:1. List theme sáng đạt 6.225245, theme tối đạt 9.618762; title theme sáng 7.197266, theme tối 9.120941. Text nằm trong viewport sau scroll, mobile wrap tự nhiên; không quan sát clipping/overlap. Không có page error, request ghi hoặc request ngoài loopback.\n\nMàu title/list đi qua token warn/muted theo theme; đây là sửa presentation, không thay provider state hay quyền broker. Lượt triage cũ đã phát hiện list theme sáng 2.019333456 và vẫn được giữ nguyên. Receipt repair-r2 tại source e993 cũng không bị sửa để tự nhận kết quả của source mới.\n\nRaw measurement: \`warning-measurements.json\`, SHA256 \`${digest(warningPath)}\`. Phân loại cuối và 8 image hash: \`warning-repair-review.json\`, SHA256 \`${digest(warningReviewPath)}\`.\n\nChỉ xác nhận block warning được chỉ định; không phải full WCAG, toàn W8, product hay broker acceptance.\n`)

const comparePath = path.join(out, 'candidate-comparison.json'), comparison = json(comparePath)
assert.equal(comparison.sourceHash, sourceHash); assert.equal(comparison.comparisons.length, 24)
assert.equal(comparison.receipts.length, 8)
const learnPath = path.join(out, 'learn-link-verification.json'), learn = json(learnPath)
assert.equal(learn.sourceBefore, sourceHash); assert.equal(learn.sourceAfter, sourceHash)
assert.equal(learn.cases.length, 8); assert.equal(learn.screenshots.length, 8)
for (const key of ['pageErrors', 'blockedRequests', 'failures']) assert.deepEqual(learn[key], [])
for (const item of learn.cases) {
  assert.equal(item.cutoffs.length, 2)
  for (const cutoff of item.cutoffs) {
    assert.equal(cutoff.keyboardTabEnteredLink, true); assert.equal(cutoff.enterNavigated, true); assert.equal(cutoff.returnPrefixUnchanged, true)
    assert.equal(cutoff.geometry.focusVisible, true); assert.equal(cutoff.geometry.hitOwn, true)
    assert.equal(cutoff.geometry.overflow.document, 0); assert.equal(cutoff.geometry.overflow.content, 0); assert.equal(cutoff.geometry.groupOverflow, 0)
    assert.ok(cutoff.geometry.outline.includes('solid 2px')); assert.equal(cutoff.count, cutoff.cursor + 1)
  }
}
for (const item of learn.screenshots) assert.equal(digest(item.path), item.sha256)
for (const item of comparison.comparisons) {
  assert.equal(digest(item.candidatePath), item.candidateSha256); assert.equal(digest(item.baselinePath), item.baselineSha256)
  assert.equal(item.repeatIdentical, true)
  assert.ok(item.nonFooterMaxChannelDelta <= 4)
  if (item.name === 'chart-history-pane.png') assert.equal(item.changedPixels, 0)
}
const approval = {
  schemaVersion: 1, status: 'SCOPED_REVIEWER_APPROVED_FOR_CHART_BASELINE_PROMOTION', reviewer: '/root/mt5_independent_review', reviewedAt,
  scope: 'Exactly 24 r4 current/history chart images at 8 theme/viewports; existing canonical synthetic chart fixture, plus actual isolated QA Learn CTA keyboard/layout/cutoff delta',
  sourceHash, fixtureSha256: comparison.fixtureSha256, origin: 'http://127.0.0.1:5180', browser: learn.browser, locale: 'vi-VN', timezone: 'UTC',
  images: comparison.comparisons.map(item => ({ project: item.project, name: item.name, path: normalized(item.candidatePath), sha256: item.candidateSha256, reviewMethod: 'Direct visual inspection of this r4 image; old top images viewed, exact RGBA/pixel comparison and measured delta classification', scope: item.name === 'chart-history-pane.png' ? 'Historical cursor20 / 21 candles / 0 fixture objects' : 'Canonical cursor60 / 61 candles / 4 fixture objects' })),
  receipts: comparison.receipts.map(item => ({ ...item, path: normalized(item.path) })),
  evidence: [evidence(comparePath), evidence(learnPath), comparison.captureReport, comparison.oldApproval],
  measuredDelta: {
    summary: comparison.summary,
    footer: 'New Learn CTA adds 404 pixels in six desktop/mobile top images; tablet centered range group shifts/adds 1369 pixels in two top images; no clipping/overlap observed',
    nonFooter: comparison.comparisons.filter(item => item.outsideFooterChangedPixels).map(({ project, name, outsideFooterChangedPixels, outsideFooterBounds, nonFooterMaxChannelDelta, nonFooterColorPairs }) => ({ project, name, outsideFooterChangedPixels, outsideFooterBounds, nonFooterMaxChannelDelta, nonFooterColorPairs })),
    classification: 'Acceptable tiny raster/color deltas: 21 and 34 pixels on one-row last-price line in two current chart panes; 12/9 rounded button edge pixels in light top screenshots. Max channel delta4/255; no geometry/content/OHLC/cutoff shift. Exact renderer cause is not established; do not claim every chart-frame pixel matches old baseline.',
    repeatability: 'All 24 candidate/repeat PNG hashes identical in this capture; all 8 historical panes byte-identical to prior approved images;14/16 chart-frame images byte-identical',
    comparatorContract: 'Existing config sets maxDiffPixels=0 with default Playwright perceptual threshold; this is not byte/hash equality. Root must run comparison after exact-hash promotion.'
  },
  learn: { status: 'SCOPED_KEYBOARD_LAYOUT_CUTOFF_REVIEWER_PASS', caseCount: 8, cutoffCount: 16, cursors: [60, 20], result: 'Tab from Tới cutoff reaches one CTA; visible 2px focus; Enter opens Learn carrying workspace/session/dataset/cursor/cutoff/from=replay; returning leaves61/21 prefix and exact accessible OHLC unchanged; history forward/play remain disabled; no overflow/error/write requests', screenshots: learn.screenshots.map(item => ({ ...item, path: normalized(item.path), directlyInspected: true })), screenshotLimit: 'Crops use group bounds and omit outer top/bottom focus-outline pixels; full viewport geometry keeps outline margin visible' },
  rubric: [
    { criterion: 'Workflow and next action', score: 4, evidence: 'Loaded replay shows existing range controls plus underlined Learn CTA at every viewport; broker-locked/fixture/cutoff context preserved' },
    { criterion: 'Numbers, units, time, precision and source', score: 4, evidence: '8 project receipts retain exact UTC/OHLC/crosshair samples30/10 and61/21 causal prefixes; no numeric delta' },
    { criterion: 'Chart/table density', score: 4, evidence: 'All 24r4 images inspected; unchanged geometry, candles/wicks/volume/scales and4/0 fixture objects; CTA fits footer' },
    { criterion: 'Component/token reuse', score: 4, evidence: 'Existing context-link and routeHref flow reused; harness/config/fixture unchanged; source CSS change scoped to CTA' },
    { criterion: 'State/error/permission clarity', score: 4, evidence: 'Fixture/broker-locked/history states retained; history forward/play disabled; no API writes or external requests' },
    { criterion: 'Keyboard/focus/contrast/responsive', score: 4, evidence: 'Actual QA16 cutoffs, Tab/Enter/focus/hit-test/overflow pass;8 focus crops inspected; dark plotting footer under both themes remains existing palette' },
    { criterion: 'Hierarchy/alignment/spacing/typography/flat-first', score: 4, evidence: '24 images and8 prior top images directly compared; no new wrapper or observed overlap/clipping; tablet range group remains centered' },
    { criterion: 'Short interactions and retained context', score: 4, evidence: 'Actual Learn roundtrip retains all context keys and prefix; existing fixture fit/crosshair/details/historyreload checks 8/8 PASS' }
  ],
  authority: 'Root may promote only these exact 24 hashes from chart-candidate-r4 into chart-baselines, record promotion, and run 8 comparators. Reviewer edits no baseline/source/ledger/commit.',
  exclusions: ['Canonical synthetic all-rising Candles/fixed volume100 only; no alternate chart types/down candles/SMA/state goldens', 'No actual annotation persistence/write lifecycle or real market data acceptance', 'No full Learn content acceptance, manual full WCAG/canvas contrast/AT/gesture/touch certification', 'Mobile visual OHLC strip remains omitted; accessible chart summary retains exact OHLC', 'Shared dark plotting palette under both shell themes is current behavior', 'No whole W8/product/broker/owner completion; long-duration heap acceptance belongs to its separate root owned receipt'],
  diagnostics: ['Initial local comparison tried an unexported package subpath; repaired to existing pinned absolute helper path, no package/config changes', 'Initial footer-only/16 unchanged-frame assumptions failed at 21 pixels; full measurement replaced those assumptions, exact tiny deltas disclosed and directly inspected', 'Original r3 approval and earlier warning failures/receipts remain unchanged']
}
assert.equal(approval.images.length, 24)
const approvalPath = path.join(out, 'chart-visual-approval.json')
writeFileSync(approvalPath, JSON.stringify(approval, null, 2) + '\n')
const deltaRows = approval.measuredDelta.nonFooter.map(item => `| ${item.project} | ${item.name} | ${item.outsideFooterChangedPixels} | ${item.nonFooterMaxChannelDelta} |`).join('\n')
writeFileSync(path.join(out, 'CHART-VISUAL-REVIEW.md'), `# Chart r4 — Learn CTA independent review\n\n**SCOPED_REVIEWER_APPROVED_FOR_CHART_BASELINE_PROMOTION** cho đúng 24 image hash trong \`chart-visual-approval.json\`. Source \`${sourceHash}\`; fixture \`${approval.fixtureSha256}\`.\n\n24 ảnh r4, 8 ảnh top baseline cũ và 8 crop focus đã được xem trực tiếp. Harness chart hiện có pass 8/8, không skip/flaky/error. Candle prefix 61/21, UTC/OHLC, crosshair index 30/10, fixture objects 4/0, fit range và lịch sử reload giữ đúng contract.\n\nCTA nằm trong range footer, dẫn qua routeHref/learnHref với workspace/session/dataset/cursor/cutoff và from=replay. Trên actual isolated QA, 8 theme/viewport × 2 cutoff pass: Tab đi từ Tới cutoff tới CTA, focus 2px rõ, Enter mở Learn; quay lại giữ prefix/summary. Các action tiến nến/phát ở history vẫn disabled. Không có overflow, page error, request ghi hoặc ngoài loopback. Crop group cắt phần outline ngoài bounds ở trên/dưới; geometry viewport vẫn có đủ margin.\n\nDelta chính là CTA (404 pixel) ở desktop/mobile và group range căn giữa (1369 pixel) tại tablet. 24 cặp candidate/repeat giống byte; 8 history pane và tổng 14/16 chart-frame ảnh giống byte baseline cũ. Hai chart-pane còn lại có delta raster rất nhỏ trên một hàng đường last-price. Top theme sáng còn có mép nút vài pixel.\n\n| Project | Image | Nonfooter pixels | Max channel delta /255 |\n|---|---|---:|---:|\n${deltaRows}\n\nCác delta ngoài footer không dịch chuyển geometry/nội dung/nến/OHLC/cutoff; đã xem ảnh diff và so sánh màu cụ thể. Nguyên nhân renderer chính xác chưa được chứng minh; không gọi kết quả này là mọi pixel chart giống hệt. Config comparator hiện hành có maxDiffPixels=0 nhưng giữ default perceptual threshold của Playwright, nên cũng không đồng nghĩa hash equality. Root phải chạy lại 8 comparator sau promotion.\n\nRoot được copy đúng 24 hash r4, ghi promotion, chạy comparator; reviewer không sửa source/baseline/ledger hay commit. Tất cả failure/receipt trước giữ nguyên. Phạm vi không bao gồm full Learn, full WCAG, annotation persistence, toàn W8/product/broker hoặc owner acceptance.\n\nReceipt SHA256: \`${digest(approvalPath)}\`. Pixel measurements: \`candidate-comparison.json\` SHA256 \`${digest(comparePath)}\`. Actual QA keyboard/cutoff: \`learn-link-verification.json\` SHA256 \`${digest(learnPath)}\`.\n`)
console.log(JSON.stringify({ sourceHash, warningReview: evidence(warningReviewPath), warningMarkdown: evidence(path.join(warningOut, 'WARNING-REVIEW.md')), chartApproval: evidence(approvalPath), chartMarkdown: evidence(path.join(out, 'CHART-VISUAL-REVIEW.md')), comparison: evidence(comparePath), learn: evidence(learnPath), approvedImages: approval.images.length }, null, 2))
