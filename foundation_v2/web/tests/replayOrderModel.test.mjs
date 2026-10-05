import test from 'node:test'
import assert from 'node:assert/strict'
import { orderDraft, protectionReference, replayAtCutoff, orderLevels, marketQuotes, money } from '../src/replayOrderModel.js'
import { projectOrder, ReplayOrderPrimitive } from '../src/replayOrderPrimitive.js'

const replay = { view_cursor_index: 1, visible_rows: [{ timestamp: 120, close: 1.102 }], payload: { cursor_index: 1, execution: {
  cursor_index: 1, spread_price: '.0002', instrument_spec: { tick_size: '.0001' }, position: { side: 'BUY', quantity: '.1', entry_fill: '1.1001', stop_loss: '1.09', take_profit: '1.12', opened_time_utc: 60 },
} } }
test('historical UI never reads canonical future account or position state', () => {
  const history = { ...replay, view_cursor_index: 0 }
  assert.equal(replayAtCutoff(history).payload.execution, null)
  assert.equal(orderDraft(history, {}).quantity, '')
  assert.equal(orderLevels(history, {}), null)
  assert.equal(replayAtCutoff(replay), replay)
})
test('quote reference includes the closeable side of the spread', () => {
  assert.equal(protectionReference(replay), 1.1019)
  const sell = structuredClone(replay); sell.payload.execution.position.side = 'SELL'
  assert.equal(protectionReference(sell), 1.1021)
  sell.payload.execution.spread_price = null
  assert.equal(protectionReference(sell), null)
  assert.deepEqual(marketQuotes(replay), { bid: 1.1019, ask: 1.1021 })
  assert.deepEqual(marketQuotes(sell), { bid: null, ask: null })
  const fractional = structuredClone(replay); fractional.visible_rows[0].close = 1.10249
  assert.deepEqual(marketQuotes(fractional), { bid: 1.1023, ask: 1.1026 })
  assert.equal(protectionReference(fractional), 1.1023)
})
test('tick quote and draft use pinned historical Bid/Ask without OHLC fallback', () => {
  const tick = structuredClone(replay)
  Object.assign(tick.payload.execution, { quote_source: 'broker_bid_ask', last_bid: '1.1017', last_ask: '1.1024', spread_price: '0', position: null })
  assert.deepEqual(marketQuotes(tick), { bid: 1.1017, ask: 1.1024 })
  assert.equal(orderDraft(tick, { pip_size: '.0001', quantity_min: '.01' }).stopLoss, '1.1004')
  assert.equal(orderLevels(tick, { side: 'SELL', stopLoss: '1.11', takeProfit: '1.09' }).entry, 1.1017)
  assert.deepEqual(marketQuotes({ ...tick, view_cursor_index: 0 }), { bid: null, ask: null })
  tick.payload.execution.last_ask = null
  assert.deepEqual(marketQuotes(tick), { bid: null, ask: null })
  tick.payload.execution.last_ask = '1.1'
  assert.deepEqual(marketQuotes(tick), { bid: null, ask: null })
})
test('draft prices use declared pip and quantity assumptions without inventing missing values', () => {
  const plain = { visible_rows: [{ close: 1.1 }], payload: {} }
  assert.deepEqual(orderDraft(plain, { pip_size: '.0001', quantity_min: '.01' }), { side: 'BUY', quantity: '.01', stopLoss: '1.098', takeProfit: '1.104' })
  assert.equal(orderDraft(plain, {}, 'SELL').stopLoss, '')
  assert.equal(orderLevels(replay, { stopLoss: '', takeProfit: '1.12' }), null)
  assert.equal(money(null, 'USD'), 'N/A')
  assert.equal(money(0, null), 'N/A')
  assert.notEqual(money(0, 'USD'), 'N/A')
})
test('order projection changes with price scale and keeps unmappable anchors out', () => {
  const levels = orderLevels(replay, orderDraft(replay))
  let offset = 0
  const chart = { timeScale: () => ({ width: () => 600, timeToCoordinate: () => 400 }), panes: () => [{ getHeight: () => 300 }] }
  const series = { priceToCoordinate: p => (1.13 - p) * 10000 + offset }
  const first = projectOrder(levels, chart, series)
  assert.ok(first.target < first.entry && first.entry < first.stop)
  offset = 20
  assert.equal(projectOrder(levels, chart, series).entry, first.entry + 20)
  assert.equal(projectOrder({ ...levels, stop: NaN }, chart, series), null)
  assert.equal(projectOrder(levels, chart, { priceToCoordinate: () => null }), null)
})
test('order primitive releases references and redraws through native engine lifecycle', () => {
  let updates = 0
  const primitive = new ReplayOrderPrimitive(() => {})
  primitive.attached({ requestUpdate: () => updates++ })
  primitive.setLevels(null)
  assert.equal(primitive.autoscaleInfo(), null)
  assert.equal(updates, 2)
  primitive.detached()
  assert.equal(primitive.attachment, null)
  primitive.setLevels({ entry: 1.1, stop: 1.09, target: 1.12 })
  assert.deepEqual(primitive.autoscaleInfo(), { priceRange: { minValue: 1.09, maxValue: 1.12 } })
})
