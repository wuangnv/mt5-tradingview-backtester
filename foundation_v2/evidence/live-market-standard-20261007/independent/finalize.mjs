import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const out = 'foundation_v2/evidence/live-market-standard-20261007/independent/'
const read = async file => JSON.parse(await readFile(out + file, 'utf8'))
const [matrix, states, model, initialJourneys, marketJourneys, delta] = await Promise.all(['matrix-report.json', 'states-report.json', 'model-oracle.json', 'journeys-r1-label-oracle-source-crossed.json', 'journeys-report.json', 'locale-delta-report.json'].map(read))
const [r7Mixed, r7Desktop, layout] = await Promise.all(['layout-r2-compact-size-oracle.json', 'layout-r3-r7-accepted-desktop.json', 'layout-delta-report.json'].map(read))
for (const result of [matrix, states, model, marketJourneys, delta]) { assert.equal(result.pass, true); assert.equal(result.sourceUnchanged, true) }
assert.equal(initialJourneys.sourceUnchanged, true)
assert.equal(initialJourneys.cases.length, 6); assert.equal(marketJourneys.cases.length, 2)
const expectedR5 = new Map(matrix.before.map(pin => [pin.file, pin.sha256]))
for (const result of [states, initialJourneys, marketJourneys]) for (const pin of result.before) if (expectedR5.has(pin.file)) assert.equal(pin.sha256, expectedR5.get(pin.file), 'retained accepted case source revision drift: ' + pin.file)
assert.equal(layout.pass, true); assert.equal(layout.sourceUnchanged, true)
const currentNames = [...new Set([...matrix.before, ...layout.before].map(pin => pin.file))].sort()
const current = await Promise.all(currentNames.map(async file => ({ file, sha256: createHash('sha256').update(await readFile('foundation_v2/web/src/' + file)).digest('hex') })))
const currentMap = new Map(current.map(pin => [pin.file, pin.sha256]))
const changed = current.filter(pin => expectedR5.has(pin.file) && pin.sha256 !== expectedR5.get(pin.file))
assert.deepEqual(changed.map(pin => pin.file), ['market-sync.css', 'testing-copy.json', 'testing-standard.css'])
assert.equal(currentMap.get('testing-copy.json'), delta.after)
for (const pin of layout.after) assert.equal(pin.sha256, currentMap.get(pin.file))
for (const result of [r7Mixed, r7Desktop]) {
  assert.equal(result.sourceUnchanged, true)
  const changed = result.after.filter(pin => pin.sha256 !== currentMap.get(pin.file))
  assert.deepEqual(changed.map(pin => pin.file), ['market-sync.css'])
}
const retainedLayout = [...r7Mixed.cases, ...r7Desktop.cases].filter(item => !item.id.includes('market-data') && !item.id.includes('data-desk'))
assert.equal(retainedLayout.length, 10); assert.equal(layout.cases.length, 6)
const layoutAccepted = { pass: true, cases: [...retainedLayout.map(item => ({ ...item, revision: 'r7 unaffected by component-scoped market CSS delta' })), ...layout.cases.map(item => ({ ...item, revision: 'r8 Market and natural DataDesk route' }))], finalPins: layout.after, note: 'R7 DataDesk cases with area=testing were rejected as noncanonical; r8 uses view=data without area/section.' }
await writeFile(out + 'layout-accepted.json', JSON.stringify(layoutAccepted, null, 2))
assert.equal(model.after, current.find(pin => pin.file === 'liveWorkspaceModel.js').sha256)
const journeys = { pass: true, cases: [...initialJourneys.cases.map(item => ({ ...item, evidence: 'journeys-r1-label-oracle-source-crossed.json' })), ...marketJourneys.cases.map(item => ({ ...item, evidence: 'journeys-report.json' }))], before: initialJourneys.before, after: marketJourneys.after, sourceUnchanged: true, errors: [], blocked: [], note: 'Retained 6 successful r5 cases from an 8-case run; Search assets label oracle corrected and only affected 2 Market cases rerun.' }
await writeFile(out + 'journeys-accepted.json', JSON.stringify(journeys, null, 2))
const svg = matrix.cases.flatMap(item => item.inventory.controls.filter(control => control.icon.width <= 24))
const receipt = {
  status: 'PASS', scope: 'Canonical Testing Market Data and all Live presentation/read-only surfaces',
  acceptance: { source: true, UI: true, actualLocalReadRoutes: true, demoJourneys: true, syntheticStates: true, fullBrokerFinancialAcceptance: 'NOT_EVALUATED', brokerExecution: 'NOT_AUTHORIZED_OR_ATTEMPTED', integrationsOrPersistence: 'PREVIEW_ONLY' },
  counts: { actualRoutes: matrix.cases.filter(item => item.name.startsWith('actual')).length, demoRoutes: matrix.cases.filter(item => item.name.startsWith('demo')).length, totalRouteCases: matrix.cases.length, axeScans: matrix.cases.filter(item => item.axe).length, axeViolations: matrix.cases.flatMap(item => item.axe?.violations || []).length, syntheticStateCases: states.cases.length, independentModelOracles: model.cases.length, demoInteractionJourneys: journeys.cases.length, localeDeltaCases: delta.cases.length, layoutDeltaCases: layoutAccepted.cases.length, inlineSvgSamples: svg.length, maximumInlineSvgVerticalDelta: Math.max(...svg.map(item => Math.abs(item.dy))) },
  errors: [...matrix.errors, ...states.errors, ...initialJourneys.errors, ...marketJourneys.errors, ...delta.errors, ...r7Mixed.errors, ...r7Desktop.errors, ...layout.errors], blockedRequests: [...matrix.blocked, ...states.blocked, ...initialJourneys.blocked, ...marketJourneys.blocked, ...delta.blocked, ...r7Mixed.blocked, ...r7Desktop.blocked, ...layout.blocked], actualWrites: 0,
  versionBoundary: { baseline: 'r5 64-case frozen matrix plus states/model/journeys', localeDelta: 'r6 testing-copy.json only: localized Close and count wording; 4 focused EN/VI cases', layoutDelta: 'r7 testing-standard.css shared pager/action base; r8 market-sync.css scoped eager catalog ownership; 16 focused layout cases with natural DataDesk route', changedAfterBaseline: changed.map(pin => pin.file), extraPinnedForLayout: currentNames.filter(name => !expectedR5.has(name)) },
  beforeBaseline: matrix.before, afterBaseline: matrix.after, finalPins: current, localeDelta: { before: delta.before, after: delta.after },
  visualReview: ['demo-calendar-dark-vi-1440.png', 'demo-trading-accounts-dark-vi-1440.png', 'demo-market-data-dark-vi-1440.png', 'demo-trades-light-vi-360.png', 'demo-calendar-dark-en-360-landing.png', 'demo-trading-accounts-light-vi-360-landing.png', 'demo-notes-light-en-360-journey-dialog.png', 'actual-calendar-light-en-1440.png', 'r6-one-calendar-en-light-1440-dialog.png', 'r7-fixture-market-data-dark-vi-1440.png', 'r7-demo-market-data-dark-vi-1440.png', 'r7-fixture-market-data-light-en-360.png', 'r7-fixture-data-desk-dark-vi-1440.png'],
  repairedFindings: ['Apply click event mistaken for filter override', 'same-count filter change retained pagination', 'unknown calendar day displayed no-deals assertion', 'preview Escape did not return focus', 'nested main/complementary landmarks and missing Market h1', 'EN Close translation absent', 'positive actual Market and natural DataDesk pager depended on lazy Analytics CSS'],
  retainedDiagnostics: ['matrix-r1-oracles-and-source-crossed.json', 'matrix-r2-demo-axe-diagnostic.json', 'matrix-r3-aside-axe-diagnostic.json', 'matrix-r4-64-pass-source-crossed.json', 'journeys-r1-label-oracle-source-crossed.json', 'layout-r1-shell-font-oracle.json', 'layout-r2-compact-size-oracle.json', 'layout-r3-r7-accepted-desktop.json', 'final-receipt-r6-before-layout-delta.json'],
  limitations: ['Actual local account endpoint was unavailable during route verification; positive account/deal arithmetic remains labeled synthetic/demo evidence.', 'Calendar aggregates filled broker deals with costs, not paired trades. Return percent is unknown without opening capital.', 'Notes/import/manual-account/provider-connect/new-trade actions are presentation previews; no persistence or integrations are asserted.', 'No market download/update/practice action, account mutation, provider call, broker send, or service restart was performed.'],
}
assert.equal(receipt.errors.length, 0); assert.equal(receipt.blockedRequests.length, 0)
await writeFile(out + 'final-receipt.json', JSON.stringify(receipt, null, 2))
console.log(JSON.stringify({ status: receipt.status, counts: receipt.counts, finalPins: current.length, changedAfterBaseline: receipt.versionBoundary.changedAfterBaseline, errors: 0, writes: 0 }))
