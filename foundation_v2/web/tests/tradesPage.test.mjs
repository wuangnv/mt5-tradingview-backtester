import test from 'node:test'
import assert from 'node:assert/strict'
import { validateTradesPagePayload, advancedAnalytics } from '../src/tradingAnalyticsModel.js'

const payload = () => ({
  schema_version: 'replay-trades-page-v1', status: 'ready', snapshot_key: 'source-revision-2',
  ledger: [{ session_id: 'session-a', trade_id: 'trade-a', net_pnl: 0, source_provenance: { session_id: 'session-a', revision: 2 } }],
  pagination: { page: 2, page_size: 10, returned_count: 1, filtered_count: 11, page_count: 2 },
  scope: { session_ids: ['session-a'] }, sources: [], excluded: [],
  facets: { assets: ['EURUSD', 'XAUUSD'], tags: ['off-page-tag'], strategies: [], years: [2026], types: ['app'] },
})

test('page contract keeps the full count/facets and known zero independent of visible rows', () => {
  const page = payload()
  assert.equal(validateTradesPagePayload(page), page)
  assert.equal(page.pagination.filtered_count, 11)
  assert.equal(page.ledger.length, 1)
  assert.deepEqual(page.facets.tags, ['off-page-tag'])
  assert.equal(page.ledger[0].net_pnl, 0)
})

test('unknown count requires partial unavailable sources; it is distinct from empty', () => {
  const page = payload()
  Object.assign(page, { status: 'partial', ledger: [], excluded: [{ session_id: 'session-a', reason: 'unavailable' }] })
  Object.assign(page.pagination, { page: 1, returned_count: 0, filtered_count: null, page_count: null })
  assert.equal(validateTradesPagePayload(page), page)
  const empty = payload()
  empty.ledger = []
  Object.assign(empty.pagination, { page: 1, returned_count: 0, filtered_count: 0, page_count: 0 })
  assert.equal(validateTradesPagePayload(empty), empty)
  page.status = 'ready'
  assert.throws(() => validateTradesPagePayload(page), /trade_page_read_model_invalid/)
})

test('page contract rejects count, page, provenance and facet corruption', () => {
  const corruptions = [
    page => { page.pagination.filtered_count = 0 },
    page => { page.pagination.page = 3 },
    page => { page.pagination.page_count = 1 },
    page => { page.pagination.returned_count = 2 },
    page => { page.pagination.page_size = 101 },
    page => { page.ledger[0].source_provenance.session_id = 'another-session' },
    page => { page.ledger[0].source_provenance.revision = 0 },
    page => { page.ledger[0].net_pnl = null },
    page => { page.facets.tags = null },
    page => { page.snapshot_key = null },
  ]
  for (const corrupt of corruptions) {
    const page = payload()
    corrupt(page)
    assert.throws(() => validateTradesPagePayload(page), /trade_page_read_model_invalid/)
  }
})

test('a visible page cannot be mistaken for complete analytics', () => {
  assert.throws(() => advancedAnalytics({ result: { paged: true }, ledger: payload().ledger }), /paged_ledger_cannot_compute_full_analytics/)
})
