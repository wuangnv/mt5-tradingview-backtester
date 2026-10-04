import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
const root = path.resolve(process.cwd(), 'src')
const reader = fs.readFileSync(path.join(root, 'AnalyticsWorkspace.jsx'), 'utf8')
const reports = fs.readFileSync(path.join(root, 'FxAnalytics.jsx'), 'utf8')
const ledger = fs.readFileSync(path.join(root, 'FxTradeLedger.jsx'), 'utf8')
const prop = fs.readFileSync(path.join(root, 'propAnalyticsModel.js'), 'utf8')
const source = [reader, reports, ledger, prop].join('\n')

test('Analytics reads remain workspace scoped and have no execution capability', () => {
  assert.match(reader, /X-Workspace-Id/)
  assert.match(reader, /analytics-read-model-v1/)
  assert.match(reader, /selectedCount === payload.ledger.length/)
  assert.doesNotMatch(source, /OrderSend|sendOrder|submitLive|method:\s*['"](?:POST|PUT|DELETE|PATCH)/i)
})
test('drilldown and export retain resource identity and financial provenance', () => {
  for (const field of ['dataset_sha256', 'cursor_index', 'revision', 'execution_event_sequence']) assert.ok(reader.includes(field))
  assert.ok(reader.includes('tradesCsv(advancedAnalytics(model, extra).rows'))
  assert.match(reader, /Mở Journal/)
  assert.match(reader, /selectedTradeId/)
  assert.match(prop, /prop_replay_scope_mismatch/)
})
test('price experiments are read-only and fenced to the visible result provenance', () => {
  assert.match(reader, /payload.read_only !== true/)
  assert.match(reader, /experimentScopeMatches/)
  assert.match(reader, /requestId !== requestSequence.current/)
  assert.match(reader, /controller.abort/)
})
