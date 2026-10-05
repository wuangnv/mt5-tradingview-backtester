import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_EXTRA_FILTERS, filterAnalyticsRows, filterValues, readAnalyticsExtraFilters } from '../src/tradingAnalyticsModel.js'

const rows = [
  { tradeId: 'a', symbol: 'EURUSD', side: 'buy', net_pnl: 10, close_time_utc: '2026-10-05T23:30:00Z', tags: ['planned', 'review, later'], entry_type: 'market', notes: 'Waited for retest' },
  { tradeId: 'b', symbol: 'GBPUSD', side: 'sell', net_pnl: -10, close_time_utc: '2026-09-04T07:00:00Z', tags: ['planned'], entry_type: 'limit', note: 'No retest' },
  { tradeId: 'c', symbol: 'XAUUSD', side: 'buy', net_pnl: null, close_time_utc: null, tags: ['review, later'] },
  { tradeId: 'd', symbol: 'EURUSD', side: 'sell', net_pnl: 0, close_time_utc: '2026-10-06T00:10:00Z', tags: [] },
]
const matching = patch => filterAnalyticsRows(rows, { ...DEFAULT_EXTRA_FILTERS, ...patch }).map(row => row.tradeId)

test('empty/default filter leaves unknown source fields and all trades visible', () => {
  assert.deepEqual(matching({}), ['a', 'b', 'c', 'd'])
  assert.deepEqual(filterAnalyticsRows(rows, {}).map(row => row.tradeId), ['a', 'b', 'c', 'd'])
})
test('AND inside include group requires every tag; OR requires one', () => {
  const tagInclude = JSON.stringify(['planned', 'review, later'])
  assert.deepEqual(matching({ tagInclude }), ['a'])
  assert.deepEqual(matching({ tagInclude, tagIncludeMode: 'OR' }), ['a', 'b', 'c'])
})
test('exclude matches are negated and intersect inclusion scope', () => {
  const tagExclude = JSON.stringify(['planned', 'review, later'])
  assert.deepEqual(matching({ tagExclude }), ['b', 'c', 'd'])
  assert.deepEqual(matching({ tagExclude, tagExcludeMode: 'OR' }), ['d'])
  assert.deepEqual(matching({ tagInclude: JSON.stringify(['planned']), tagExclude: JSON.stringify(['review, later']) }), ['b'])
})
test('multi values OR within a category and AND across different categories', () => {
  assert.deepEqual(matching({ assets: JSON.stringify(['EURUSD', 'GBPUSD']), sides: JSON.stringify(['sell']), outcomes: JSON.stringify(['loss', 'breakeven']) }), ['b', 'd'])
  assert.deepEqual(matching({ types: JSON.stringify(['market', 'limit']) }), ['a', 'b'])
  assert.deepEqual(matching({ outcomes: JSON.stringify(['unknown']) }), ['c'])
})
test('missing notes/type/date do not become invented matching values', () => {
  assert.deepEqual(matching({ notes: 'RETEST' }), ['a', 'b'])
  assert.deepEqual(matching({ types: JSON.stringify(['market']) }), ['a'])
  assert.deepEqual(matching({ years: JSON.stringify(['2026']), months: JSON.stringify(['10']), days: JSON.stringify(['1']), hours: JSON.stringify(['23']) }), ['a'])
  assert.deepEqual(matching({ years: JSON.stringify(['2026']), months: JSON.stringify(['10']), days: JSON.stringify(['2']), hours: JSON.stringify(['6']), timezone: 'Asia/Ho_Chi_Minh' }), ['a'])
})
test('filter URL roundtrip preserves tag commas, unknown fields and mode', () => {
  const query = new URLSearchParams({ analytics_tagInclude: JSON.stringify(['planned', 'review, later']), analytics_tagIncludeMode: 'OR', analytics_assets: JSON.stringify(['EURUSD']), analytics_types: JSON.stringify(['market']), analytics_notes: 'retest' })
  const filters = readAnalyticsExtraFilters(query)
  assert.deepEqual(filterValues(filters.tagInclude), ['planned', 'review, later'])
  assert.deepEqual(filterAnalyticsRows(rows, filters).map(row => row.tradeId), ['a'])
  assert.deepEqual(filterValues('bad'), [])
  assert.deepEqual(filterValues('{"not":"array"}'), [])
})
