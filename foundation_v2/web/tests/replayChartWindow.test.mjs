import test from 'node:test'
import assert from 'node:assert/strict'
import { createReplayChartWindowReader } from '../src/replayChartWindow.js'
import { createAdvancedReplayDatafeed, replayBars } from '../src/advancedReplayDatafeed.js'
import { startFrontendPerformance } from '../src/frontendPerformance.js'

const bar = { time: 60000, open: 1, high: 2, low: .5, close: 1.5 }
const options = { workspace: 'w', sessionId: 'session', datasetId: 'dataset', datasetSha256: 'sha' }
const request = { resolution: '1', countBack: 5, cursorIndex: 9, cutoff: 60, to: 120 }
const payload = { schema_version: 'replay-chart-window-v1', workspace_id: 'w', session_id: 'session', dataset_id: 'dataset',
  dataset_sha256: 'sha', cursor_index: 9, cutoff_timestamp: 60, resolution: '1', bars: [bar] }

test('window cache deduplicates, returns independent candles, binds query and stays bounded', async () => {
  let calls = 0
  const reader = createReplayChartWindowReader({ ...options, fetchImpl: async (url, init) => {
    calls++
    assert.equal(init.headers['X-Workspace-Id'], 'w')
    assert.match(url, /dataset_sha256=sha/)
    assert.match(url, /count_back=5/)
    return { ok: true, json: async () => payload }
  } })
  const [first, second] = await Promise.all([reader.read(request), reader.read(request)])
  assert.equal(calls, 1)
  first[0].close = 999
  assert.equal(second[0].close, 1.5)
  for (let index = 0; index < 9; index++) await reader.read({ ...request, to: 200 + index })
  await reader.read(request)
  assert.equal(calls, 11, 'Eight cached windows should evict the oldest')
  reader.dispose()
})

test('reader rejects scope, future, duplicate and unbounded data', async () => {
  for (const invalid of [ { workspace_id: 'other' }, { dataset_sha256: 'another' }, { cursor_index: 10 },
    { cutoff_timestamp: 120 }, { bars: [{ ...bar, time: 61000 }] }, { bars: [bar, bar] },
    { bars: [{ ...bar, high: null }] }, { bars: Array(6).fill(bar) } ]) {
    const reader = createReplayChartWindowReader({ ...options, fetchImpl: async () => ({ ok: true, json: async () => ({ ...payload, ...invalid }) }) })
    await assert.rejects(reader.read(request))
    reader.dispose()
  }
})

test('rewind/dispose aborts old requests and does not cache late bodies', async () => {
  let finish, signal
  const reader = createReplayChartWindowReader({ ...options, fetchImpl: async (url, init) => {
    signal = init.signal
    return { ok: true, json: () => new Promise(resolve => { finish = resolve }) }
  } })
  const pending = reader.read(request)
  await new Promise(resolve => setImmediate(resolve))
  reader.reset()
  assert.equal(signal.aborted, true)
  finish(payload)
  await assert.rejects(pending, { name: 'AbortError' })
  reader.dispose()
  await assert.rejects(reader.read(request))
})

test('datafeed backfills remote candles beyond the local window, keeps monthly buckets whole, cancels rewind', async () => {
  const rows = Array.from({ length: 3000 }, (_, index) => ({ timestamp: 1704067200 + index * 60,
    open: index, high: index + 2, low: index - 1, close: index + 1, volume: 1 }))
  let cursor = 2999, release, stale = false
  const item = createAdvancedReplayDatafeed({ symbol: 'EURUSD', seconds: 60, rows: rows.slice(-2000), cutoff: rows[cursor].timestamp,
    readHistory: (resolution, period) => {
      const full = replayBars(rows, rows[cursor].timestamp, resolution === '1M' ? '1M' : 60)
      return full.filter(bar => !period.to || bar.time < period.to * 1000).slice(-(period.countBack || 300))
    } })
  const get = (resolution, period) => new Promise((resolve, reject) => item.datafeed.getBars({ ticker: 'EURUSD' }, resolution, period, resolve, reject))
  assert.equal((await get('1', { to: rows[100].timestamp, countBack: 20 }))[0].open, 80)
  const month = await get('1M', { countBack: 20 })
  assert.equal(month[0].open, 0, 'Monthly OHLC must not start at the local window boundary')
  assert.equal(month[0].volume, 3000)
  item.dispose()
  const waiting = createAdvancedReplayDatafeed({ symbol: 'EURUSD', seconds: 60, rows, cutoff: rows[cursor].timestamp,
    readHistory: () => new Promise(resolve => { release = resolve }) })
  waiting.datafeed.getBars({ ticker: 'EURUSD' }, '1', {}, () => { stale = true }, assert.fail)
  await new Promise(resolve => setImmediate(resolve))
  cursor = 1
  assert.equal(waiting.update(rows.slice(0, 2), rows[1].timestamp), false)
  release([bar])
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(stale, false)
  waiting.dispose()
})

test('remote realtime starts at last visible candle and never replays older bars during initial request race', async () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ timestamp: 1704067200 + index * 60,
    open: index, high: index + 2, low: index - 1, close: index + 1, volume: 1 }))
  let cursor = 5
  const item = createAdvancedReplayDatafeed({ symbol: 'EURUSD', seconds: 60, rows: rows.slice(0, 6), cutoff: rows[cursor].timestamp,
    readHistory: async () => replayBars(rows, rows[cursor].timestamp, 60) })
  const seen = []
  item.datafeed.subscribeBars({ ticker: 'EURUSD' }, '1', bar => seen.push(bar.time), 'first', assert.fail)
  cursor = 8
  item.update(rows.slice(0, 9), rows[cursor].timestamp)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(seen, rows.slice(6, 9).map(row => row.timestamp * 1000))
  item.dispose()
})

test('history timings are opt-in and deduplicated; cache hit records no request or business context', async () => {
  const metrics = startFrontendPerformance({ enabled: true })
  const reader = createReplayChartWindowReader({ ...options, fetchImpl: async () => ({ ok: true, json: async () => payload }) })
  await Promise.all([reader.read(request), reader.read(request)])
  await reader.read(request)
  const records = metrics.snapshot().records
  assert.equal(records.length, 1)
  assert.equal(records[0].label, 'chart-history')
  assert.equal(records[0].status, 'ready')
  assert.equal(records[0].payloadBytes, undefined)
  assert.equal(JSON.stringify(records).includes('session'), false)
  reader.dispose(); metrics.stop()
})
