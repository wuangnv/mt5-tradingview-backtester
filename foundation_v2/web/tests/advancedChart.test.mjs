import test from 'node:test'
import assert from 'node:assert/strict'
import { createAdvancedReplayDatafeed, replayBars, replayResolution } from '../src/advancedReplayDatafeed.js'
import { readChartSnapshot, writeChartSnapshot } from '../src/advancedChartStorage.js'

const rows = Array.from({ length: 12 }, (_, index) => ({ timestamp: 1704067200 + index * 60, open: 1 + index / 100, high: 1.1 + index / 100, low: .9 + index / 100, close: 1.01 + index / 100, volume: index + 1 }))
const adapter = (prefix = rows.slice(0, 6)) => createAdvancedReplayDatafeed({ symbol: 'EURUSD', seconds: 60, tickSize: .00001, rows: prefix, cutoff: prefix.at(-1).timestamp })
const getBars = (feed, period, resolution = '1') => new Promise((resolve, reject) => feed.getBars({ ticker: 'EURUSD' }, resolution, period, (bars, meta) => resolve({ bars, meta }), reject))

test('aggregation includes only the causal prefix, including incomplete buckets', () => {
  const bars = replayBars(rows, rows[5].timestamp, 300)
  assert.deepEqual(bars.map(bar => bar.time), [1704067200000, 1704067500000])
  assert.equal(bars[0].open, rows[0].open)
  assert.equal(bars[0].close, rows[4].close)
  assert.equal(bars[0].volume, 15)
  assert.equal(bars[1].close, rows[5].close)
  assert.equal(bars[1].high, rows[5].high)
  assert.equal(replayBars([{ ...rows[0], volume: 5 }, { ...rows[1], volume: undefined }], rows[1].timestamp, 300)[0].volume, undefined, 'Unknown constituent volume must not appear as a complete sum')
})
test('history countBack fills from older visible bars and never leaks future rows', async () => {
  const item = adapter()
  const result = await getBars(item.datafeed, { from: rows[4].timestamp, to: rows[11].timestamp + 60, countBack: 5 })
  assert.equal(result.bars.length, 5)
  assert.equal(result.bars[0].time, rows[1].timestamp * 1000)
  assert.equal(result.bars.at(-1).time, rows[5].timestamp * 1000)
  result.bars[0].close = 999
  const again = await getBars(item.datafeed, { from: 0, to: rows[11].timestamp + 60, countBack: 100 })
  assert.equal(again.bars[1].close, rows[1].close)
  const empty = await getBars(item.datafeed, { from: 0, to: rows[0].timestamp, countBack: 5 })
  assert.equal(empty.meta.noData, true)
  item.dispose()
})
test('forward updates emit every missed bar, cloned; rewind invalidates callbacks and resets cache', async () => {
  const item = adapter(rows.slice(0, 2)), received = []
  let resets = 0, obsolete = false
  item.datafeed.subscribeBars({ ticker: 'EURUSD' }, '1', bar => { received.push(bar.time); bar.close = 999 }, 'one', () => resets++)
  item.update(rows.slice(0, 6), rows[5].timestamp)
  assert.deepEqual(received, rows.slice(2, 6).map(row => row.timestamp * 1000))
  item.update(rows.slice(0, 6), rows[5].timestamp)
  assert.equal(received.length, 4)
  item.datafeed.getBars({ ticker: 'EURUSD' }, '1', { from: 0, to: Infinity, countBack: 50 }, () => { obsolete = true }, () => {})
  assert.equal(item.update(rows.slice(0, 2), rows[1].timestamp), false)
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(resets, 1); assert.equal(obsolete, false)
  received.length = 0
  item.update(rows.slice(0, 4), rows[3].timestamp)
  assert.deepEqual(received, rows.slice(2, 4).map(row => row.timestamp * 1000), 'Rewind followed by forward never emits older realtime bars')
  item.dispose()
})
test('metadata precision and resolutions reflect dataset; unsupported intervals rejected', async () => {
  const item = adapter()
  const info = await new Promise(resolve => item.datafeed.resolveSymbol('EURUSD', resolve, assert.fail))
  assert.equal(info.pricescale, 100000); assert.equal(info.minmov, 1)
  assert.deepEqual(item.supported, ['1', '3', '5', '15', '30', '60', '120', '240', '1D', '1W', '1M'])
  assert.equal(replayResolution(5), '5S'); assert.throws(() => replayResolution(90))
  await assert.rejects(getBars(item.datafeed, { from: 0, to: Infinity, countBack: 50 }, '10S'))
  item.dispose()
})
test('calendar candles use UTC day, Monday week and real month boundaries without future OHLC', async () => {
  const dates = ['2024-01-28T23:59:00Z', '2024-01-29T00:00:00Z', '2024-01-31T23:59:00Z', '2024-02-01T00:00:00Z', '2024-02-29T23:59:00Z', '2024-03-01T00:00:00Z']
  const history = dates.map((date, i) => ({ ...rows[i], timestamp: Date.parse(date) / 1000 }))
  const month = replayBars(history, history[4].timestamp, '1M')
  assert.deepEqual(month.map(bar => bar.time), [Date.parse('2024-01-01Z'), Date.parse('2024-02-01Z')])
  assert.equal(month[1].close, history[4].close)
  assert.equal(month[1].volume, history[3].volume + history[4].volume)
  assert.deepEqual(replayBars(history.slice(0, 3), history[2].timestamp, '1W').map(bar => bar.time), [Date.parse('2024-01-22Z'), Date.parse('2024-01-29Z')])
  assert.equal(replayBars(history, history[0].timestamp, '1D')[0].time, Date.parse('2024-01-28Z'))
  const item = createAdvancedReplayDatafeed({ symbol: 'EURUSD', seconds: 60, rows: history, cutoff: history[4].timestamp })
  const result = await getBars(item.datafeed, { from: 0, to: Infinity, countBack: 50 }, '1M')
  assert.deepEqual(result.bars, month)
  item.dispose()
  const daily = createAdvancedReplayDatafeed({ symbol: 'EURUSD', seconds: 86400, rows: history, cutoff: history[4].timestamp })
  assert.equal(daily.interval, '1D'); assert.deepEqual(daily.supported, ['1D', '1W', '1M']); daily.dispose()
  const coarse = createAdvancedReplayDatafeed({ symbol: 'EURUSD', seconds: 172800, rows: history, cutoff: history[4].timestamp })
  assert.deepEqual(coarse.supported, ['2D'], 'Do not aggregate coarse bars across calendar boundaries they straddle'); coarse.dispose()
})
test('calendar realtime updates partial months and rewind invalidates pending history', async () => {
  const dates = ['2023-12-31T23:59:00Z', '2024-01-01T00:00:00Z', '2024-01-31T23:59:00Z', '2024-02-01T00:00:00Z']
  const history = dates.map((date, i) => ({ ...rows[i], timestamp: Date.parse(date) / 1000 }))
  const item = createAdvancedReplayDatafeed({ symbol: 'EURUSD', seconds: 60, rows: history.slice(0, 2), cutoff: history[1].timestamp })
  const emitted = []; let resets = 0, obsolete = false
  item.datafeed.subscribeBars({ ticker: 'EURUSD' }, '1M', bar => emitted.push({ ...bar }), 'month', () => resets++)
  item.update(history, history[3].timestamp)
  assert.deepEqual(emitted.map(bar => bar.time), [Date.parse('2024-01-01T00:00:00Z'), Date.parse('2024-02-01T00:00:00Z')])
  assert.equal(emitted[0].close, history[2].close)
  assert.equal(emitted[0].volume, history[1].volume + history[2].volume)
  item.datafeed.getBars({ ticker: 'EURUSD' }, '1M', { from: 0, to: Infinity, countBack: 50 }, () => { obsolete = true }, assert.fail)
  assert.equal(item.update(history.slice(0, 2), history[1].timestamp), false)
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(resets, 1); assert.equal(obsolete, false)
  emitted.length = 0
  item.update(history.slice(0, 3), history[2].timestamp)
  assert.equal(emitted.length, 1); assert.equal(emitted[0].time, Date.parse('2024-01-01T00:00:00Z'))
  item.dispose()
})
test('saved drawings/layouts stay scoped and snapshots from later cutoffs cannot restore in history', () => {
  const map = new Map(), storage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) }
  writeChartSnapshot(storage, 'session-a', 60, { drawing: 'earlier' })
  writeChartSnapshot(storage, 'session-a', 90, { drawing: 'later' })
  assert.equal(readChartSnapshot(storage, 'session-a', 59), undefined)
  assert.deepEqual(readChartSnapshot(storage, 'session-a', 70), { drawing: 'earlier' })
  assert.deepEqual(readChartSnapshot(storage, 'session-a', 90), { drawing: 'later' })
  assert.equal(readChartSnapshot(storage, 'session-b', 100), undefined)
  writeChartSnapshot(storage, 'session-a', 60, { drawing: 'revised' })
  assert.deepEqual(readChartSnapshot(storage, 'session-a', 60), { drawing: 'revised' })
})
