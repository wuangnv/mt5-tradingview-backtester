import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
const out = path.dirname(fileURLToPath(import.meta.url)), foundation = path.resolve(out, '../../../..')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const sourceHash = () => {
  const root = path.join(foundation, 'web/src'), hash = createHash('sha256')
  for (const name of readdirSync(root, { recursive: true }).filter(name => /\.(jsx?|css)$/.test(name)).sort()) hash.update(name).update(readFileSync(path.join(root, name)))
  return hash.digest('hex')
}
const measuredSource = 'e993bb4910fc42f3faf8c7852ca6807f392deaa6d331f279f843ea8c9d21e6dd'
const laterSource = 'fba555162da33d740c254ebf79ba2670df1c0e29e7c80221d649df8dca27ebad'
const bytes = await readFile(path.join(out, 'measurements.json')), measurements = JSON.parse(bytes)
assert.equal(measurements.sourceBefore, measuredSource)
assert.equal(measurements.sourceAfter, measuredSource)
assert.equal(measurements.status, 'FOCUSED_ASSERTIONS_PASS_PENDING_RENDERED_REVIEW')
assert.equal(measurements.cases.length, 16)
assert.equal(measurements.assertions.length, 416)
assert.equal(measurements.screenshots.length, 16)
assert.deepEqual(measurements.failures, [])
assert.deepEqual(measurements.pageErrors, [])
assert.deepEqual(measurements.blockedRequests, [])
for (const prior of measurements.retainedR1) assert.equal(sha(await readFile(path.join(out, prior.path))), prior.sha256)
for (const screenshot of measurements.screenshots) assert.equal(sha(await readFile(screenshot.path)), screenshot.sha256)
const journal = measurements.cases.filter(item => item.route === 'journal'), data = measurements.cases.filter(item => item.route === 'data')
assert.equal(journal.flatMap(item => item.fields).length, 72)
assert.equal(data.flatMap(item => item.row.textGroups).length, 48)
const currentSource = sourceHash()
assert.equal(currentSource, laterSource)
const review = {
  status: 'SCOPED_REPAIR_REVIEW_PASS', reviewer: '/root/mt5_independent_review', sourceBefore: measuredSource, sourceAfter: measuredSource,
  scope: 'Actual GET-only isolated QA API on Journal/Data,16route cases/8theme-viewport pairs,72Journal placeholder and48Data provider text observations;16exact rendered crops independently viewed. Original and r1failures preserved. No fullWCAG claim.',
  measurements: { path: 'measurements.json', sha256: sha(bytes), assertions: 416 },
  summary: { routeCases: 16, viewportThemePairs: 8, journalPlaceholderObservations: 72, providerTextObservations: 48, screenshotCount: 16, originalAndAdditionalFindingsResolved: 3, newFindings: 0, fullWcagConformance: 'NOT_EVALUATED', productAcceptance: 'NOT_EVALUATED', broker: 'NOT_CONTACTED' },
  findings: [
    { id: 'A11Y-01', status: 'RESOLVED_VERIFIED_SCOPED', scope: '9actual enabled empty Journal fields at4widths/2themes', threshold: 4.5, darkRatio: 6.371946456275576, lightRatio: 6.225244635758334, observationCount: 72, placeholderOpacity: 1, meaningfulControl: 'Actual content textarea is enabled, empty, visible after scroll and directly inspected in all8crops.' },
    { id: 'UI-01', status: 'RESOLVED_VERIFIED_SCOPED', scope: 'Provider local-catalog metadata/status/capability at4widths/2themes', widths: data.map(item => ({ theme: item.theme, viewport: item.width, cellWidth: item.row.columns[0].bounds.width, rowHeight: item.row.bounds.height, nameRectCount: item.row.firstColumnText[0].rects.length, readMetadataRectCount: item.row.firstColumnText[1].rects.length, wordRectCount: item.row.readMetadataWordRects.length })), assertions: ['cell>100px', 'row<=200px', 'name and read_metadata single line', 'read_metadata word whole', 'entitlement<=3Range rectangles', 'tracks inside row, stack without overlap', 'state min-width0 and left alignment', 'document/body/content no horizontal overflow'], tradeOff: 'Stacked provider presentation uses more vertical space than a wide3column arrangement, but remains137px and removes the zero-width track without adding wrappers or changing API meaning.' },
    { id: 'A11Y-02', status: 'RESOLVED_VERIFIED_SCOPED', scope: 'Mode/entitlement readiness text at4widths/2themes', threshold: 4.5, beforeLightRatio: 1.9875350170707042, newDarkRatio: 9.120940542183826, newLightRatio: 5.041243463797098, foregroundDark: '#d5a45a', foregroundLight: '#9a630f', backgroundDark: '#030303', backgroundLight: '#ffffff', text: 'offline_local · entitlement: dataset_metadata_only', all6ProviderGroupsChecked: true }
  ],
  providerContrast: data.map(item => ({ theme: item.theme, width: item.width, text: item.row.textGroups.map(group => ({ text: group.text, fontSize: group.fontSize, ratio: group.contrastRatio, threshold: group.threshold, foreground: group.renderedForeground, background: group.resolvedBackground })) })),
  renderedReview: { status: 'SCOPED_PASS', screenshots: measurements.screenshots.map(item => ({ path: path.basename(item.path), theme: item.theme, route: item.route, viewport: { width: item.width, height: item.height }, sha256: item.sha256, inspectedDirectly: true })), observations: ['Journal placeholder readable in both themes;390wrap remains natural.', 'Provider identity/read_metadata/entitlement/status/blocked capability all visible and readable.', 'Stacked provider metadata has no collapsed letters, clipped words or overlap.'] },
  retainedHistory: [measurements.previousReceipt, ...measurements.retainedR1],
  reuse: { previous18TargetTriage: '../contrast-review.json', freshlyVerifiedOriginalTargets: ['textarea[rows="8"]', 'div:nth-child(1) > small:nth-child(2)'], unaffectedOriginalTargets: 16, rationale: 'Other targets retain scoped prior evidence: placeholder selector is Journal-field scoped, provider layout/text color rules are Data-row scoped, shell change is comment; Learn changes apply to another workspace. This is delta reuse, not fresh execution of the other16selectors.', keyboardAndMotion: 'Prior exact-source receipts remain historical scoped evidence; no fresh all-state keyboard/reduced-motion conformance claimed.' },
  laterSource: { fingerprintAtPublication: currentSource, sequence: 'Root reported a later Learn tablet selector-specificity fix after this run completed. e993sourceBefore/sourceAfter matched and script had exited0 before the change.', runtimeVerifiedByThisReceipt: false, requiredFollowup: 'Root final144route/axe/reflow matrix and golden comparisons on fba555; this receipt has no Learn acceptance authority.' },
  safety: { methods: ['GET', 'HEAD', 'OPTIONS'], origin: measurements.origin, webSocketsClosed: true, pageErrors: 0, blockedRequests: 0, writes: 0, sourceEdits: 0, baselinePromotions: 0, ledgerChanges: 0, commits: 0 },
  exclusions: ['No complete WCAG2.2AA or every-state keyboard/screen-reader claim.', 'No Learn/sourcefba555browser verification by this lane.', 'No chart-types/down-candle/fullgesture/wholeW8/UY/M7/product/broker acceptance.']
}
await writeFile(path.join(out, 'repair-review.json'), JSON.stringify(review, null, 2) + '\n')
console.log(JSON.stringify({ status: review.status, measuredSource, laterSource: currentSource, summary: review.summary, measurementSha256: review.measurements.sha256, reviewSha256: sha(await readFile(path.join(out, 'repair-review.json'))) }, null, 2))
