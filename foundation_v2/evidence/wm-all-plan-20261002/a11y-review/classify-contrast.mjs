import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'

const out = path.dirname(fileURLToPath(import.meta.url))
const foundation = path.resolve(out, '../../..')
const expectedSource = '71373c3a4a02e1d3cd68ff3e6bffbd92a8dfdb153a5f3c8d39aa3ac5cc8030fa'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const sourceHash = () => {
  const root = path.join(foundation, 'web/src'), hash = createHash('sha256')
  for (const name of readdirSync(root, { recursive: true }).filter(name => /\.(jsx?|css)$/.test(name)).sort()) hash.update(name).update(readFileSync(path.join(root, name)))
  return hash.digest('hex')
}
const sourceBefore = sourceHash()
assert.equal(sourceBefore, expectedSource)
const files = ['contrast-measurements.json', 'layout-context-measurements.json', '../review/keyboard-readonly-report.json', '../ui/a11y-full.json']
const inputs = await Promise.all(files.map(async file => {
  const bytes = await readFile(path.join(out, file))
  return { path: file.replaceAll('\\', '/'), sha256: sha(bytes), receipt: JSON.parse(bytes) }
}))
const [measurements, layout, keyboard, automated] = inputs.map(input => input.receipt)
for (const receipt of [measurements, layout, keyboard, automated]) {
  assert.equal(receipt.sourceBefore, expectedSource)
  assert.equal(receipt.sourceAfter, expectedSource)
}
assert.equal(measurements.status, 'MEASURED_REQUIRES_INDEPENDENT_CLASSIFICATION')
assert.equal(layout.status, 'MEASURED_REQUIRES_CLASSIFICATION')
assert.equal(keyboard.status, 'PASS')
assert.equal(keyboard.cases.length, 2)
assert.equal(measurements.results.length, 48)
assert.equal(measurements.reducedMotion.length, 14)
for (const check of measurements.reducedMotion) {
  assert.equal(check.preferenceMatches, true)
  assert.deepEqual(check.nonReducedComputedStyles, [])
}
for (const receipt of [measurements, layout, keyboard]) {
  assert.deepEqual(receipt.pageErrors, [])
  assert.deepEqual(receipt.blockedRequests, [])
}

function ratio(foreground, background) {
  const luminance = rgb => rgb.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0)
  const l1 = luminance(foreground), l2 = luminance(background)
  return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05)
}

const targets = [...new Set(measurements.results.map(result => result.selector))].map(selector => {
  const observations = measurements.results.filter(result => result.selector === selector).map(result => {
    assert.equal(result.opacityNeedsManual, false)
    assert.equal(result.backgroundImageNeedsManual, false)
    const observation = {
      theme: result.theme, route: result.routeId, text: result.text, fontSize: result.fontSize, fontWeight: result.fontWeight,
      threshold: result.threshold, foreground: result.renderedForeground, background: result.resolvedBackground,
      computedAncestorRatio: result.contrastRatio, applicableContrastRatio: result.contrastRatio,
      placeholderRatio: result.placeholderContrastRatio ?? null, classification: 'PASS_MEASURED_CONTRAST',
      notes: [], supplementalScreenshots: measurements.supplementalScreenshots.filter(item => item.theme === result.theme && item.routeId === result.routeId).map(item => path.basename(item.path))
    }
    if (selector.startsWith('.chart-symbol')) {
      const screenshot = measurements.supplementalScreenshots.find(item => item.theme === result.theme && item.routeId === 'replay')
      assert.deepEqual(screenshot.dominantBackground.rgba, [3, 3, 3, 255])
      observation.background = [3, 3, 3, 1]
      observation.applicableContrastRatio = ratio(result.renderedForeground, observation.background)
      observation.notes.push('Canvas paints #030303 behind this visible text. The DOM ancestor #050607 does not describe the actual canvas pixels. The screenshot dominant solid background and direct review establish the rendered background for this state.')
    }
    if (selector.startsWith('.chart-symbol') || selector === '.fxr-select-chevron') {
      observation.notes.push('Hit testing returns the underlying canvas/select because this label has pointer-events:none; this is not evidence of visual occlusion. Rendered screenshot inspected.')
    }
    if (selector === 'textarea[rows="8"]') {
      observation.notes.push('Entered text and placeholder are assessed separately. The enabled empty field visibly presents the placeholder after scrolling; no persisted content or API write was made.')
      observation.placeholderForeground = result.renderedPlaceholder
      observation.placeholderText = result.placeholder
      if (result.placeholderContrastRatio < result.threshold) observation.classification = 'FAIL_PLACEHOLDER_TEXT_CONTRAST'
    }
    if (selector === '.rs-state-mark') {
      const context = layout.research.find(item => item.theme === result.theme)
      assert.equal(context.explicitStatus, 'Chưa có result')
      assert.equal(context.instructions, 'Hoàn tất context và run config ở cột bên trái trước.')
      observation.classification = 'DECORATIVE_REDUNDANT_GRAPHIC'
      observation.requiredThreshold = null
      observation.notes.push('Current ○ is a noninteractive redundant graphic. Explicit adjacent text supplies both the state and instruction; its shape/color is not required to understand them. Light measured2.10:1 is recorded, not relabelled as a numeric pass. This exception does not cover other rs-state-mark glyphs or states.')
      observation.supplementalScreenshots.push(`research-result-status-${result.theme}.png`)
    }
    if (selector === 'div:nth-child(1) > small:nth-child(2)') {
      observation.classification = 'PASS_CONTRAST_WITH_OPEN_LAYOUT_DEFECT'
      observation.notes.push('Exact automated target disambiguated by text Có: read_metadata. Contrast passes, but the provider first column is0px at1440/1280 in both themes; readability is not accepted.')
    }
    if (!['FAIL_PLACEHOLDER_TEXT_CONTRAST', 'DECORATIVE_REDUNDANT_GRAPHIC'].includes(observation.classification)) assert.ok(observation.applicableContrastRatio >= observation.threshold)
    return observation
  })
  assert.ok(observations.some(item => item.theme === 'dark'))
  assert.ok(observations.some(item => item.theme === 'light'))
  const classification = observations.some(item => item.classification === 'FAIL_PLACEHOLDER_TEXT_CONTRAST') ? 'FINDING_OPEN' : selector === '.rs-state-mark' ? 'DECORATIVE_REDUNDANT_GRAPHIC' : selector === 'div:nth-child(1) > small:nth-child(2)' ? 'CONTRAST_RESOLVED_LAYOUT_OPEN' : 'CONTRAST_RESOLVED'
  return { selector, classification, observations }
})
assert.equal(targets.length, 18)
assert.equal(targets.filter(item => item.classification === 'FINDING_OPEN').length, 1)
assert.equal(targets.filter(item => item.classification.startsWith('CONTRAST_RESOLVED')).length, 16)
assert.equal(targets.filter(item => item.classification === 'DECORATIVE_REDUNDANT_GRAPHIC').length, 1)
for (const item of layout.data) {
  assert.equal(item.rows.length, 1)
  assert.equal(item.rows[0].providerId, 'local-catalog')
  if (item.width >= 1280) assert.equal(item.rows[0].columns[0].bounds.width, 0)
  else assert.ok(item.rows[0].columns[0].bounds.width > 190)
}
const screenshots = [...measurements.supplementalScreenshots, ...layout.screenshots]
for (const screenshot of screenshots) assert.equal(sha(await readFile(screenshot.path)), screenshot.sha256)
const sourceAfter = sourceHash()
assert.equal(sourceAfter, expectedSource)

const report = {
  status: 'PARTIAL_WCAG_REVIEW_FINDINGS_OPEN', reviewer: '/root/mt5_independent_review', sourceBefore, sourceAfter,
  scope: 'Manual rendered triage of18 unique axe color-contrast incompletes,48 route/theme observations at1440, plus8 focused Data layouts and2 Research status contexts; preserved original failures. No source/baseline/ledger edits.',
  automatedReceipt: { status: automated.status, caseCount: automated.results.length, claim: 'No reported automated violations in this scoped matrix; manual incompletes required classification.' },
  inputs: inputs.map(({ path, sha256 }) => ({ path, sha256 })),
  summary: { uniqueTargets: 18, observations: 48, measuredContrastResolved: 16, decorativeException: 1, contrastFindingOpen: 1, additionalLayoutFindingOpen: 1, sourceUnchanged: true, fullWcagConformance: 'NOT_EVALUATED', productAcceptance: 'NOT_EVALUATED', broker: 'NOT_CONTACTED' },
  targets,
  findings: [
    { id: 'A11Y-01', status: 'OPEN', criterion: 'WCAG1.4.3 Contrast (Minimum)', route: 'journal', theme: 'dark', selector: 'textarea[rows="8"]::placeholder', foreground: '#757575', background: '#0c1113', measuredRatio: 4.123873001012635, requiredRatio: 4.5, enteredTextRatio: 16.10825217679702, lightPlaceholderRatio: 4.607518093747377, recommendation: 'After the root releases source freeze, use the existing muted text token for the Journal placeholder, then recheck empty/enabled input in both themes. Preserve original evidence; new hash needs new receipt.' },
    { id: 'UI-01', status: 'OPEN', criterion: 'Rendered readability/layout defect; no unverified WCAG reflow claim', route: 'data', themes: ['dark', 'light'], selector: '.rd-provider-row > div:first-child', dataCases: layout.data.map(item => ({ theme: item.theme, viewportWidth: item.width, rowWidth: item.rows[0].bounds.width, grid: item.rows[0].gridTemplateColumns, firstColumnWidth: item.rows[0].columns[0].bounds.width, rowHeight: item.rows[0].bounds.height, textLineCounts: item.rows[0].columns[0].children.map(child => ({ text: child.text, lines: child.rects.length })) })), rootCause: 'Desktop Data aside is358.5/418.5px wide. minmax(0,1fr) auto auto with150px status minimum and capability content consumes the available width and leaves the provider track0px. overflow-wrap:anywhere turns words into individual characters. Tablet/main-layout and mobile one-column rule have enough space.', recommendation: 'After source freeze, stack provider metadata/status/capabilities in the narrow desktop aside, or bound the other tracks while retaining a usable first-column width. Recheck1440/1280/768/390 dark/light with line counts, rendered reading and overflow; no-wrapper style fits flat-first UI.' }
  ],
  supplementalEvidence: {
    reducedMotion: { status: 'SCOPED_PASS', observations: 14, routes: [...new Set(measurements.reducedMotion.map(item => item.routeId))], themes: ['dark', 'light'], preferenceMatches: true, nonReducedComputedStyles: 0, scope: 'Initial rendered route states under prefers-reduced-motion:reduce, including before/after pseudo styles; not every later animation/state.' },
    keyboard: { status: 'SCOPED_PASS_REUSED', receipt: '../review/keyboard-readonly-report.json', sha256: inputs[2].sha256, cases: 2, viewport: '390x844', themes: ['dark', 'light'], scope: 'Native arrow-key horizontal ledger scrolling, numeric-cell right alignment and visibility, visible focus outline, menu focus loop, Escape and restored focus. Not every keyboard workflow.' }
  },
  screenshotHashes: screenshots.map(item => ({ path: path.basename(item.path), sha256: item.sha256, theme: item.theme, route: item.routeId || item.view, viewportWidth: item.width ?? 1440 })),
  exclusions: ['No full WCAG2.2 AA conformance declaration.', 'Other control states, hover/active/disabled, validation/error states, charts/annotations/down-candle semantic colors and complete keyboard/screen-reader coverage not accepted by this receipt.', 'No full W4/W7/W8/product/heap/broker acceptance; no source change or promotion authority.'],
  safety: { methods: ['GET', 'HEAD', 'OPTIONS'], origin: measurements.origin, pageErrors: 0, blockedRequests: 0, writes: 0, webSocketsClosed: true }
}
const rowText = targets.map(target => {
  const ratios = ['dark', 'light'].map(theme => {
    const observation = target.observations.find(item => item.theme === theme)
    return (target.selector === 'textarea[rows="8"]' ? observation.placeholderRatio : observation.applicableContrastRatio).toFixed(2)
  })
  return `| \`${target.selector.replaceAll('|', '\\|')}\` | ${ratios.join(' | ')} | ${target.classification} |`
}).join('\n')
const markdown = `# Partial WCAG contrast triage\n\nHai finding còn mở: placeholder Journal dark không đạt4.5:1 và cột provider Data Desk rộng0px ở desktop1440/1280. Review không sửa source, baseline hay ledger.\n\nSource trước/sau: \`${sourceBefore}\`. Original axe receipt: \`../ui/a11y-full.json\` (${automated.results.length}cases). Manual triage18 target,48 observations dark/light ở1440; focused Data thêm8 observations trên1440/1280/768/390.\n\n## Finding đã xác minh\n\n- **A11Y-01 — Journal dark**: placeholder thực tế \`#757575\` trên \`#0c1113\`, **4.1239:1 <4.5:1**, font12px. Text đã nhập16.1083:1; light placeholder4.6075:1. Field enabled, visible sau scroll. Screenshot: \`journal-dark-contrast.png\`; không điền/lưu data. Đề xuất dùng muted token hiện có sau khi root thả source freeze, rồi kiểm tra lại cả hai theme và tạo receipt cho source hash mới.\n- **UI-01 — Data desktop**: cả hai theme, grid ở1440 là \`0px 150px 244.5px\`, ở1280 là \`0px 150px 184.5px\`. First column0px, row1223px; \`Có: read_metadata\` thành16 dòng, entitlement47 dòng. Contrast6.66:1 dark/6.23:1 light vẫn đạt; không thể vì vậy công nhận readability. 768 first column194.7px/row95px,390 first column308px/row137px. Document không overflow ở cả8 case, nên overflow-only check bỏ sót lỗi. Đây là finding layout xác minh, không tự gán full WCAG reflow failure. Nên xếp metadata/status/capabilities thành hàng trong aside hẹp hoặc giới hạn auto tracks; kiểm tra lại đủ4 widths và2 themes sau patch.\n\n## Phân loại18 target\n\n16 target có ratio đạt ngưỡng đo; Data nằm trong16 nhưng layout vẫn mở. Một target là graphic trang trí dư nghĩa; một target chứa placeholder fail. Các ratio chart dùng nền canvas thực tế \`#030303\`, không lấy nhầm ancestor \`#050607\`.\n\n| Target | Dark ratio | Light ratio | Classification |\n| --- | ---: | ---: | --- |\n${rowText}\n\nResearch \`○\` light chỉ2.10:1. Nó không interactive và không mang thông tin bắt buộc: adjacent text đã ghi rõ “Chưa có result” và hướng dẫn bước tiếp theo. Vì vậy scope hiện tại là decorative redundant graphic; không biến2.10 thành PASS numeric và không mở rộng exemption sang glyph/state khác. Rendered context được xem trực tiếp ở \`research-result-status-dark.png\` / \`research-result-status-light.png\`.\n\nSelect chevron và chart symbol strip có \`pointer-events:none\`. Hit-test trả SELECT/canvas bên dưới vì CSS đó, không phải text bị che. Screenshot đã kiểm tra trực tiếp. Journal obscured axe incomplete được kiểm tra sau scroll; placeholder contrast failure vẫn giữ nguyên.\n\n## Bằng chứng bổ sung và giới hạn\n\nComputed reduced-motion14 initial route/theme observations: media query matches, không có animation/transition/smooth scroll còn hoạt động (kể cả pseudo styles). Reuse keyboard receipt hash \`${inputs[2].sha256}\`, PASS2 dark/light390: ledger native arrow scrolling, số canh phải/hiện được, focus outline, menu loop/Escape/focus restoration. Các bằng chứng này chỉ scoped coverage; không nhận every-state keyboard/screen-reader hay toàn bộ WCAG2.2 AA.\n\nToàn bộ12 crop được kiểm tra trực tiếp; hashes nằm trong \`contrast-review.json\`. Read-only loopback GET/HEAD/OPTIONS, WebSocket đóng;0page errors/blocked requests/writes. Không phải full W4/W7/W8/product/heap/broker acceptance. Root giữ quyền patch, promotion, commit và ledger.\n`
await writeFile(path.join(out, 'contrast-review.json'), JSON.stringify(report, null, 2) + '\n')
await writeFile(path.join(out, 'CONTRAST-REVIEW.md'), markdown)
console.log(JSON.stringify({ status: report.status, summary: report.summary, jsonSha256: sha(await readFile(path.join(out, 'contrast-review.json'))), markdownSha256: sha(await readFile(path.join(out, 'CONTRAST-REVIEW.md'))) }, null, 2))
