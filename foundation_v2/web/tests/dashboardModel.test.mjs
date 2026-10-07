import test from 'node:test'
import assert from 'node:assert/strict'
import { dashboardDurationParts, dashboardFilters, dashboardFilterError, dashboardNumber, dashboardMoney, dashboardRequestUrl, readDashboardOverview, readDashboardAnalytics, readDashboardReplayContext, dashboardCurve, dashboardPeriod, dashboardPeriodRange, dashboardRecentSessions } from '../src/dashboardModel.js'

test('duration retains unknown, measured zero and whole elapsed days without calendar-month guesses', () => {
  for (const value of [null, undefined, '', false, '60', NaN, Infinity, -1]) assert.equal(dashboardDurationParts(value), null)
  assert.deepEqual(dashboardDurationParts(0), [[0, 'minute']])
  assert.deepEqual(dashboardDurationParts(59), [[0, 'minute']])
  assert.deepEqual(dashboardDurationParts(67200), [[18, 'hour'], [40, 'minute']])
  assert.deepEqual(dashboardDurationParts(3135600), [[36, 'day'], [7, 'hour']])
  assert.deepEqual(dashboardDurationParts(86460), [[1, 'day'], [1, 'minute']])
})

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
  assert.deepEqual(dashboardPeriodRange('7d', now), { from: '2026-09-27', to: '2026-10-03' })
  assert.equal(dashboardPeriod(dashboardPeriodRange('7d', now), now), '7d')
  assert.deepEqual(dashboardPeriodRange('90d', now), { from: '2026-07-06', to: '2026-10-03' })
  assert.equal(dashboardPeriod(dashboardPeriodRange('30d', now), now), '30d')
  assert.equal(dashboardPeriod({ from: '2024-01-01', to: '' }, now), 'custom')
  assert.deepEqual(dashboardPeriodRange('lifetime', now), { from: '', to: '' })
})

test('last week and month cover completed UTC calendar periods, preserving saved rolling scopes', () => {
  for (const date of ['2026-10-05T00:00:00Z', '2026-10-11T23:59:59Z']) {
    const now = new Date(date)
    const week = { from: '2026-09-28', to: '2026-10-04' }
    assert.deepEqual(dashboardPeriodRange('last-week', now), week)
    assert.equal(dashboardPeriod(week, now), 'last-week')
    assert.deepEqual(dashboardPeriodRange('last-month', now), { from: '2026-09-01', to: '2026-09-30' })
  }
  const january = new Date('2027-01-01T01:00:00Z')
  assert.deepEqual(dashboardPeriodRange('last-week', january), { from: '2026-12-21', to: '2026-12-27' })
  assert.deepEqual(dashboardPeriodRange('last-month', january), { from: '2026-12-01', to: '2026-12-31' })
  const leap = new Date('2024-03-31T23:59:59Z')
  const february = { from: '2024-02-01', to: '2024-02-29' }
  assert.deepEqual(dashboardPeriodRange('last-month', leap), february)
  assert.equal(dashboardPeriod(february, leap), 'last-month')
  assert.equal(dashboardPeriod({ from: '2026-09-27', to: '2026-10-03' }, new Date('2026-10-07T12:00:00Z')), 'custom')
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

test('Assets and strategy intersect; unavailable strategy is not unassigned', () => {
  const items = ['a', 'b', 'c', 'd'].map((record_id, i) => ({ record_id, instrument_id: i === 2 ? 'GBPUSD' : 'EURUSD', created_at_utc: `2026-10-0${i + 1}` }))
  const details = { a: { strategy: 'breakout' }, b: { strategy: null }, c: { strategy: 'breakout' } }
  assert.deepEqual(dashboardRecentSessions(items, { asset: 'EURUSD', strategy: 'breakout', details }).map(x => x.record_id), ['a'])
  assert.deepEqual(dashboardRecentSessions(items, { asset: 'EURUSD', strategy: 'unassigned', details }).map(x => x.record_id), ['b'])
})

test('profit sorting keeps unknown last and refuses mixed or missing currencies', () => {
  const items = ['a', 'b', 'c'].map((record_id, i) => ({ record_id, created_at_utc: `2026-10-0${i + 1}`, updated_at_utc: `2026-10-0${3 - i}` }))
  const details = { a: { pnl: 20, currency: 'USD' }, b: { pnl: 0, currency: 'USD' }, c: { pnl: null, currency: 'USD' } }
  const ids = options => dashboardRecentSessions(items, options).map(x => x.record_id)
  assert.deepEqual(ids({ sort: 'profit', details }), ['a', 'b', 'c'])
  assert.deepEqual(ids({ sort: 'profit', details: { ...details, b: { pnl: 1000, currency: 'JPY' } } }), ['c', 'b', 'a'])
  assert.deepEqual(ids({ sort: 'profit', details: { ...details, b: { pnl: 1000, currency: '' } } }), ['c', 'b', 'a'])
  assert.deepEqual(ids({ sort: 'newest' }), ['c', 'b', 'a'])
  assert.deepEqual(ids({ sort: 'last' }), ['a', 'b', 'c'])
})

test('replay context verifies the catalog revision and drops candle arrays before retaining metadata', async context => {
  const payload = { record_id: 's/a', revision: 2, cutoff_timestamp: 1783315500, payload: { execution: null }, visible_rows: [{ time: 1 }] }
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/v2/replay/sessions/s%2Fa')
    assert.equal(options.headers['X-Workspace-Id'], 'w')
    return { ok: true, json: async () => payload }
  })
  const item = { record_id: 's/a', revision: 2 }
  assert.deepEqual(await readDashboardReplayContext('w', item), { record_id: 's/a', revision: 2, cutoff_timestamp: 1783315500, payload: { execution: null } })
  payload.revision = 3
  await assert.rejects(readDashboardReplayContext('w', item), /revision_mismatch/)
  payload.revision = 2; payload.record_id = 'foreign'
  await assert.rejects(readDashboardReplayContext('w', item), /revision_mismatch/)
})
