import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const here = path.dirname(fileURLToPath(import.meta.url))
const workspace = path.resolve(here, '../../../../../..')
const seed = JSON.parse(await readFile(path.join(workspace, '.artifacts/wm-integration-20261001/seed.json'), 'utf8'))
assert.equal(seed.database, 'trading_workspace_v2_ui_20261001')
assert.equal(seed.scope, 'synthetic-data-real-API-Postgres-local-UI-only')
assert.equal(new URL(seed.api).hostname, '127.0.0.1')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const evidence = path.resolve(process.env.TW_CHART_SOURCE_EVIDENCE || path.join(here, '../../../evidence/wm-all-plan-20261002/chart-review'))
await mkdir(evidence, { recursive: true })
const requests = []
async function get(suffix) {
  const response = await fetch(seed.api + '/api/v2' + suffix, { headers: { 'X-Workspace-Id': 'tenant-a' } })
  assert.equal(response.status, 200, suffix)
  const bytes = Buffer.from(await response.arrayBuffer())
  requests.push({ method: 'GET', path: suffix, status: response.status, responseSha256: sha(bytes) })
  return JSON.parse(bytes)
}
const session = await get('/replay/sessions/' + seed.session_id)
const history = await get('/replay/sessions/' + seed.session_id + '?cursor_index=20')
const catalog = await get('/data/datasets')
const annotations = await get('/chart/annotations')
assert.equal(session.revision, 123)
assert.equal(session.view_cursor_index, 60)
assert.equal(session.visible_rows.length, 61)
assert.equal(history.visible_rows.length, 21)
assert.deepEqual(history.visible_rows, session.visible_rows.slice(0, 21))
for (const view of [session, history]) {
  assert.equal(view.visible_rows.at(-1).timestamp, view.cutoff_timestamp)
  assert.ok(view.visible_rows.every((row, index, rows) => row.timestamp <= view.cutoff_timestamp && (!index || row.timestamp > rows[index - 1].timestamp)))
}
const dataset = catalog.items.find(item => item.dataset_id === seed.dataset_id)
assert.ok(dataset)
const fixtureSession = 'fixture-chart-ui'
const fixtureDataset = 'fixture-chart-synthetic'
function projectView(view) {
  const copy = structuredClone(view)
  copy.record_id = fixtureSession
  copy.created_at_utc = copy.updated_at_utc = '2024-01-01T00:00:00Z'
  copy.payload = { ...copy.payload, name: 'Fixture chart — dữ liệu mô phỏng', description: 'Explicit isolated synthetic QA chart fixture', dataset_id: fixtureDataset, branch_id: 'fixture-chart-branch' }
  delete copy.payload.execution
  return copy
}
const types = ['horizontal-line', 'trendline', 'zone', 'text']
const labels = ['Fixture · đường giá', 'Fixture · xu hướng', 'Fixture · vùng giá', 'Fixture · ghi chú']
const timestamps = new Set(session.visible_rows.map(row => row.timestamp))
const templates = types.map(type => annotations.items.filter(item => !item.deleted && item.payload.annotation_type === type && item.payload.anchors.every(anchor => timestamps.has(anchor.timestamp))).sort((a, b) => a.record_id.localeCompare(b.record_id))[0])
assert.ok(templates.every(Boolean), 'Need actual API annotation contracts with anchors inside the canonical prefix')
const drawings = templates.map((template, index) => ({
  ...structuredClone(template), record_id: 'fixture-chart-' + types[index], revision: 1,
  created_at_utc: '2024-01-01T01:00:00Z', updated_at_utc: '2024-01-01T01:00:00Z',
  payload: { ...structuredClone(template.payload), run_id: fixtureSession, cutoff_timestamp: session.cutoff_timestamp, label: labels[index] },
}))
const snapshot = {
  scope: 'Explicit synthetic chart visual fixture from read-only isolated QA session; transformed drawing identity/cutoff only; no API writes',
  session: fixtureSession, workspace: 'visual-chart-fixture',
  latest: projectView(session), history: projectView(history),
  datasets: { items: [{ ...dataset, dataset_id: fixtureDataset, workspace_id: 'visual-chart-fixture' }], holdout_access: false },
  annotations: { items: drawings },
  oracle: { canonicalCursor: 60, historyCursor: 20, latestRows: 61, historyRows: 21, latestVisibleObjects: 4, historyVisibleObjects: 0 },
}
const after = await get('/replay/sessions/' + seed.session_id)
assert.deepEqual(after, session, 'Canonical session must not change during read-only capture')
const bytes = Buffer.from(JSON.stringify(snapshot, null, 2) + '\n')
await writeFile(path.join(here, 'chart-fixture.json'), bytes)
await writeFile(path.join(evidence, 'fixture-source.json'), JSON.stringify({
  status: 'READ_ONLY_CAPTURE_VERIFIED', scope: snapshot.scope, capturedAt: new Date().toISOString(), requests,
  canonicalSession: seed.session_id, revision: session.revision, sourceDataset: seed.dataset_id, sourceDatasetSha256: session.dataset_sha256,
  canonicalUnchanged: true, templates, fixtureSha256: sha(bytes),
  transformations: ['Stable fixture session/dataset/branch identities and timestamps; explicit synthetic names', 'Execution ledger omitted because this chart-only fixture makes no financial claims', 'OHLC/volume/timestamps/prefix/cutoff/dataset SHA preserved', 'Four real annotation API templates retain exact time/price anchors; run_id and creation cutoff remapped to the synthetic canonical prefix, labels explicitly Fixture'],
}, null, 2) + '\n')
console.log(JSON.stringify({ status: 'READ_ONLY_CAPTURE_VERIFIED', fixtureSha256: sha(bytes), rows: [61, 21], drawingTypes: types, evidence }))
