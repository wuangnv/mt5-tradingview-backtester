import test from 'node:test'
import assert from 'node:assert/strict'
import { dashboardFilters, dashboardFilterError, dashboardNumber, dashboardMoney, dashboardRequestUrl, readDashboardOverview, readDashboardAnalytics, dashboardCurve, dashboardPeriod, dashboardPeriodRange, dashboardRecentSessions } from '../src/dashboardModel.js'

test('dashboard keeps unknown distinct from measured zero', () => {
  for (const unknown of [null, undefined, '', false, NaN, Infinity, 'not-a-number']) assert.equal(dashboardNumber(unknown), '—')
  assert.equal(dashboardNumber(0), '0')
  assert.equal(dashboardNumber(50, '%'), '50%')
  assert.equal(dashboardMoney(0.01, 'USD'), '0,01 USD', 'Do not round measured cents into zero P/L')
  assert.equal(dashboardMoney(0, 'USD'), '0 USD')
  assert.equal(dashboardMoney(null, 'USD'), '—')
})

test('recent period ranges use inclusive UTC calendar days across month boundaries', () => {
  const now = new Date('2026-10-03T23:30:00Z')
  assert.deepEqual(dashboardPeriodRange('30d', now), { from: '2026-09-04', to: '2026-10-03' })
  assert.deepEqual(dashboardPeriodRange('90d', now), { from: '2026-07-06', to: '2026-10-03' })
  assert.equal(dashboardPeriod(dashboardPeriodRange('30d', now), now), '30d')
  assert.equal(dashboardPeriod({ from: '2024-01-01', to: '' }, now), 'custom')
  assert.deepEqual(dashboardPeriodRange('lifetime', now), { from: '', to: '' })
})

test('Dashboard combines search/status/sort without mixing archived and active status', () => {
  const items = [
    { record_id: 'a', instrument_id: 'EURUSD', status: 'paused', updated_at_utc: '2026-10-01' },
    { record_id: 'b', instrument_id: 'GBPUSD', status: 'completed', updated_at_utc: '2026-10-02' },
    { record_id: 'c', instrument_id: 'EURUSD', status: 'paused', archived: true, updated_at_utc: '2026-10-03' },
  ]
  assert.deepEqual(dashboardRecentSessions(items, { status: 'paused' }).map(item => item.record_id), ['a'])
  assert.deepEqual(dashboardRecentSessions(items, { status: 'archived', search: 'eurusd' }).map(item => item.record_id), ['c'])
  assert.deepEqual(dashboardRecentSessions(items, { status: 'all', search: 'EURUSD', sort: 'oldest' }).map(item => item.record_id), ['a', 'c'])
  assert.deepEqual(dashboardRecentSessions(items).map(item => item.record_id), ['b', 'a'])
  assert.equal(dashboardRecentSessions(items, { search: 'missing' }).length, 0)
})

test('dashboard filters encode the selected session and complete UTC close dates', () => {
  const filters = dashboardFilters(new URLSearchParams('dashboard_session=s/a&dashboard_from=2023-11-14&dashboard_to=2023-11-15&session=unrelated-context'))
  const url = new URL(dashboardRequestUrl(filters), 'http://localhost')
  assert.equal(url.searchParams.get('session_id'), 's/a')
  assert.equal(url.searchParams.get('from_close_utc'), '2023-11-14T00:00:00.000Z')
  assert.equal(url.searchParams.get('to_close_utc'), '2023-11-15T23:59:59.999Z')
  assert.equal(dashboardFilterError(filters), '')
  assert.ok(dashboardFilterError({ from: '2023-12-01', to: '2023-11-01' }))
  assert.deepEqual(dashboardFilters(new URLSearchParams('dashboard_from=bad')), { session: '', from: '', to: '' })
})

test('overview request sends workspace and abort signal; rejects old inventory-only payload', async (context) => {
  const controller = new AbortController()
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/v2/overview')
    assert.equal(options.headers['X-Workspace-Id'], 'tenant-test')
    assert.equal(options.signal, controller.signal)
    return { ok: true, json: async () => ({ counts: { datasets: 2 } }) }
  })
  await assert.rejects(readDashboardOverview('tenant-test', {}, controller.signal), /dashboard_performance_unavailable/)
})

test('malformed performance payload becomes a recoverable load error', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ performance: { schema_version: 'dashboard-replay-performance-v1' } }) }))
  await assert.rejects(readDashboardOverview('tenant-test', {}), /dashboard_performance_unavailable/)
})

test('dashboard chart uses original balance and preserves every loss and recovery', () => {
  const metrics = { starting_balance: 1000, closed_trade_balance_curve: [1000, 1100, 950, 1010].map((value, sequence) => ({ sequence, closed_trade_balance: value })) }
  const curve = dashboardCurve(metrics)
  assert.equal(curve.count, 3)
  assert.equal(curve.first, 0)
  assert.equal(curve.last, 10)
  assert.equal(curve.path.split(' ').length, 4)
  assert.equal(dashboardCurve({ ...metrics, closed_trade_count: 4 }), null, 'Truncated sequence must not imply full coverage')
  assert.equal(dashboardCurve({ ...metrics, net_pnl: 20 }), null, 'Curve endpoint and net P/L must share a scope')
  assert.ok(curve.zeroY > 24 && curve.zeroY < 228)
  for (const bad of [null, false, '', undefined, NaN]) assert.equal(dashboardCurve({ ...metrics, starting_balance: bad }), null)
  assert.equal(dashboardCurve({ ...metrics, closed_trade_balance_curve: metrics.closed_trade_balance_curve.map((point, index) => index === 2 ? { ...point, closed_trade_balance: null } : point) }), null, 'Never bridge a missing balance')
  assert.equal(dashboardCurve({ ...metrics, starting_balance: 900 }), null, 'Do not invent the original balance')
  assert.equal(dashboardCurve({ ...metrics, closed_trade_balance_curve: metrics.closed_trade_balance_curve.slice(1) }), null, 'Missing initial sequence must remain unknown')
  const flat = dashboardCurve({ starting_balance: 0, closed_trade_balance_curve: [0, 0].map((value, sequence) => ({ sequence, closed_trade_balance: value })) })
  assert.equal(flat.last, 0)
  assert.doesNotMatch(flat.path, /NaN|Infinity/)
})

test('session result API fences workspace, provenance and ledger count', async context => {
  const controller = new AbortController()
  const payload = { schema_version: 'analytics-read-model-v1', analytics_available: true, scope: { selected_trade_count: 1, total_trade_count: 1 }, provenance: { workspace_id: 'w', session_id: 's/a' }, ledger: [{ net_pnl: 5 }], metrics: { closed_trade_count: 1 } }
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/v2/replay/sessions/s%2Fa/analytics')
    assert.equal(options.headers['X-Workspace-Id'], 'w')
    assert.equal(options.signal, controller.signal)
    return { ok: true, json: async () => payload }
  })
  assert.equal(await readDashboardAnalytics('w', 's/a', controller.signal), payload)
  payload.provenance.session_id = 'foreign'
  await assert.rejects(readDashboardAnalytics('w', 's/a', controller.signal), /analytics_read_model_invalid/)
  payload.provenance.session_id = 's/a'; payload.scope.selected_trade_count = 2
  await assert.rejects(readDashboardAnalytics('w', 's/a', controller.signal), /analytics_read_model_invalid/)
})
