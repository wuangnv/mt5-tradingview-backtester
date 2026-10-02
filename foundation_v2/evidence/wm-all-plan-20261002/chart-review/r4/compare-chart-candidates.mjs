import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const out = path.dirname(fileURLToPath(import.meta.url))
const foundation = path.resolve(out, '../../../..')
const workspace = path.resolve(foundation, '../../..')
const require = createRequire(path.join(workspace, 'tooling/ui-qa/package.json'))
const { PNG } = require(path.join(workspace, 'tooling/ui-qa/node_modules/playwright-core/lib/utilsBundle.js'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const readJson = file => JSON.parse(readFileSync(file, 'utf8'))
const expectedSource = '8205c89b2d79a832cb853ccad28b08ca13e1d9da67b2c185a517742752a180f1'
const sourceRoot = path.join(foundation, 'web/src')
const sourceDigest = createHash('sha256')
for (const name of readdirSync(sourceRoot, { recursive: true }).filter(name => /\.(jsx?|css)$/.test(name)).sort()) sourceDigest.update(name).update(readFileSync(path.join(sourceRoot, name)))
const sourceHash = sourceDigest.digest('hex')
assert.equal(sourceHash, expectedSource)
const oldApprovalPath = path.resolve(out, '../chart-visual-approval.json')
const oldApprovalBytes = readFileSync(oldApprovalPath)
assert.equal(hash(oldApprovalBytes), 'aa368b3ad24409054d4663e6514b4da58b9c83c4f2c1c08595461b51acf52f49')
const oldApproval = JSON.parse(oldApprovalBytes)
const candidateRoot = path.join(workspace, '.artifacts/wm-all-plan-20261002/chart-candidate-r4')
const baselineRoot = path.join(foundation, 'web/tests/visual/chart-baselines')
const fixturePath = path.join(foundation, 'web/tests/visual/chart-fixture.json')
const fixtureSha256 = hash(readFileSync(fixturePath))
assert.equal(fixtureSha256, oldApproval.fixtureSha256)
const captureReportPath = path.join(workspace, '.artifacts/wm-all-plan-20261002/chart-capture-r4/report.json')
const captureReport = readJson(captureReportPath)
assert.equal(captureReport.stats.expected, 8)
for (const key of ['skipped', 'unexpected', 'flaky']) assert.equal(captureReport.stats[key], 0)
assert.equal(captureReport.errors.length, 0)
const comparisons = [], receipts = []
for (const project of readdirSync(candidateRoot).sort()) {
  const receiptPath = path.join(candidateRoot, project, 'chart.json')
  const receiptBytes = readFileSync(receiptPath), receipt = JSON.parse(receiptBytes)
  assert.equal(receipt.sourceHash, sourceHash)
  assert.equal(receipt.fixtureSha256, fixtureSha256)
  assert.deepEqual(receipt.errors, [])
  assert.deepEqual(receipt.unexpected, [])
  assert.equal(receipt.geometry.pageOverflow, 0)
  assert.equal(receipt.geometry.contentOverflow, 0)
  assert.equal(receipt.assertions.length, 2)
  assert.deepEqual(receipt.assertions.map(item => [item.cursor, item.count, item.objects]), [[60, 61, 4], [20, 21, 0]])
  assert.deepEqual(receipt.assertions.map(item => item.renderedCrosshairSample.index), [30, 10])
  receipts.push({ project, path: receiptPath, sha256: hash(receiptBytes), assertions: receipt.assertions, geometry: receipt.geometry })
  for (const name of ['chart-top.png', 'chart-pane.png', 'chart-history-pane.png']) {
    const candidatePath = path.join(candidateRoot, project, name), baselinePath = path.join(baselineRoot, project, name)
    const candidateBytes = readFileSync(candidatePath), baselineBytes = readFileSync(baselinePath)
    const candidateHash = hash(candidateBytes), baselineHash = hash(baselineBytes)
    assert.equal(baselineHash, oldApproval.images.find(item => item.project === project && item.name === name).sha256)
    assert.equal(candidateHash, receipt.captures.find(item => item.name === name).sha256)
    assert.equal(candidateHash, hash(readFileSync(path.join(candidateRoot, project, name.replace('.png', '-repeat.png')))))
    const candidate = PNG.sync.read(candidateBytes), baseline = PNG.sync.read(baselineBytes)
    assert.equal(candidate.width, baseline.width)
    assert.equal(candidate.height, baseline.height)
    let changedPixels = 0, minX = candidate.width, minY = candidate.height, maxX = -1, maxY = -1
    let outsideFooterChangedPixels = 0, outsideMinX = candidate.width, outsideMinY = candidate.height, outsideMaxX = -1, outsideMaxY = -1
    const nonFooterColorPairs = new Map()
    let nonFooterMaxChannelDelta = 0
    const diff = new PNG({ width: candidate.width, height: candidate.height })
    for (let y = 0; y < candidate.height; y++) for (let x = 0; x < candidate.width; x++) {
      const index = (y * candidate.width + x) * 4
      if ([0, 1, 2, 3].some(channel => candidate.data[index + channel] !== baseline.data[index + channel])) {
        changedPixels++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
        diff.data[index] = 255; diff.data[index + 3] = 255
        if (y < candidate.height - 110) {
          outsideFooterChangedPixels++; outsideMinX = Math.min(outsideMinX, x); outsideMinY = Math.min(outsideMinY, y); outsideMaxX = Math.max(outsideMaxX, x); outsideMaxY = Math.max(outsideMaxY, y)
          const oldColor = [...baseline.data.subarray(index, index + 4)], newColor = [...candidate.data.subarray(index, index + 4)]
          const pairKey = `${oldColor.join(',')} -> ${newColor.join(',')}`
          nonFooterColorPairs.set(pairKey, (nonFooterColorPairs.get(pairKey) || 0) + 1)
          nonFooterMaxChannelDelta = Math.max(nonFooterMaxChannelDelta, ...oldColor.map((value, channel) => Math.abs(value - newColor[channel])))
        }
      }
    }
    const changedBounds = changedPixels ? { minX, minY, maxX, maxY } : null
    if (name === 'chart-top.png') {
      assert.ok(changedPixels > 0)
      writeFileSync(path.join(out, `${project}-top-diff.png`), PNG.sync.write(diff))
    } else if (changedPixels) writeFileSync(path.join(out, `${project}-${name.replace('.png', '')}-diff.png`), PNG.sync.write(diff))
    const outsideFooterBounds = outsideFooterChangedPixels ? { minX: outsideMinX, minY: outsideMinY, maxX: outsideMaxX, maxY: outsideMaxY } : null
    comparisons.push({ project, name, candidatePath, candidateSha256: candidateHash, baselinePath, baselineSha256: baselineHash, width: candidate.width, height: candidate.height, changedPixels, changedBounds, outsideFooterChangedPixels, outsideFooterBounds, nonFooterMaxChannelDelta, nonFooterColorPairs: [...nonFooterColorPairs].map(([pair, count]) => ({ pair, count })), repeatIdentical: true })
  }
}
assert.equal(comparisons.length, 24)
assert.equal(receipts.length, 8)
const report = { status: 'EXACT_PIXEL_COMPARISON_MEASURED_PENDING_REVIEWER_CLASSIFICATION', sourceHash, fixtureSha256, oldApproval: { path: oldApprovalPath, sha256: hash(oldApprovalBytes) }, captureReport: { path: captureReportPath, sha256: hash(readFileSync(captureReportPath)), stats: captureReport.stats }, comparisons, receipts, summary: { candidateImages: 24, repeatIdentical: 24, changedTopImages: comparisons.filter(item => item.name === 'chart-top.png' && item.changedPixels).length, unchangedChartFrames: comparisons.filter(item => item.name !== 'chart-top.png' && !item.changedPixels).length, changedChartFrames: comparisons.filter(item => item.name !== 'chart-top.png' && item.changedPixels).length, topImagesWithNonFooterDeltas: comparisons.filter(item => item.name === 'chart-top.png' && item.outsideFooterChangedPixels).length } }
writeFileSync(path.join(out, 'candidate-comparison.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ status: report.status, summary: report.summary, deltas: comparisons.filter(item => item.changedPixels).map(({ project, changedPixels, changedBounds, outsideFooterChangedPixels, outsideFooterBounds }) => ({ project, changedPixels, changedBounds, outsideFooterChangedPixels, outsideFooterBounds })) }, null, 2))
