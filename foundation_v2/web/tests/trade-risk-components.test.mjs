import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = (name) => fs.readFileSync(path.join(root, 'src', name), 'utf8')

test('trade workspace keeps draft on replay context and simulator boundary', () => {
  const code = source('TradeWorkspace.jsx')
  for (const marker of [
    '/api/v2/replay/sessions/',
    '/execution',
    '/orders/market',
    'SIMULATOR / PAPER ONLY',
    'broker action',
    'trade-risk-preview',
    'validateDraft',
  ]) assert.ok(code.includes(marker), `missing ${marker}`)
})

test('trade workspace exposes fail-closed side and risk calculations', () => {
  const code = source('TradeWorkspace.jsx')
  assert.ok(code.includes("draft.side === 'BUY'"))
  assert.ok(code.includes("draft.side === 'SELL'"))
  assert.ok(code.includes('commission_per_side_account'))
  assert.ok(code.includes('Planned R'))
  assert.match(code, /function optionalNumber\(value\)/)
  assert.match(code, /value === null \|\| value === undefined \|\| value === ''/)
  assert.match(code, /Spread và starting balance phải được nhập đầy đủ/)
})

test('trade workspace exposes recoverable read-only loading states and selected side semantics', () => {
  const code = source('TradeWorkspace.jsx')
  assert.match(code, /const MAX_GET_RETRIES = 3/)
  assert.match(code, /new AbortController\(\)/)
  assert.match(code, /requestId !== replayRequestRef\.current/)
  assert.match(code, /requestId !== datasetRequestRef\.current/)
  assert.match(code, /Không đọc được catalog dataset/)
  assert.match(code, /data-testid="trade-dataset-retry"/)
  assert.match(code, /data-testid="trade-replay-retry"/)
  assert.match(code, /retryDatasets/)
  assert.match(code, /retryReplay/)
  assert.match(code, /trade-context-unknown/)
  assert.match(code, /datasetState\.status === 'ready'/)
  assert.match(code, /aria-pressed=\{draft\.side === 'BUY'\}/)
  assert.match(code, /aria-pressed=\{draft\.side === 'SELL'\}/)
})

test('async replay hydration derives risk defaults from the loaded cutoff', () => {
  const code = source('TradeWorkspace.jsx')
  // The initial state has no rows and therefore keeps draft values unknown.
  // Once the GET resolves, defaults must come from the replay bars so the
  // first queue attempt is validated against the actual session price.
  assert.match(code, /setDraft\(initialDraft\(next\)\)/)
  assert.match(code, /if \(replay\) setDraft\(initialDraft\(replay\)\)/)
  assert.match(code, /const price = execution \? marketQuotes\(replay\).ask : optionalNumber\(current\?\.close\)/)
  assert.doesNotMatch(code, /numberOr\(current\?\.close, 1\.1\)/)
  assert.doesNotMatch(code, /\.\.\.initialDraft\(next\), \.\.\.current/)
})

test('risk workspace uses the existing prop evaluator and surfaces blocked data', () => {
  const code = source('RiskWorkspace.jsx')
  for (const marker of [
    '/api/v2/analytics/prop/evaluate',
    'blocked_by_data',
    'SIMULATION ONLY',
    'breach_at_boundary',
    'risk-result',
  ]) assert.ok(code.includes(marker), `missing ${marker}`)
  assert.match(code, /function optionalNumber\(value\)/)
  assert.match(code, /missing_total_drawdown_amount/)
  assert.match(code, /status: 'blocked_by_data'/)
})
