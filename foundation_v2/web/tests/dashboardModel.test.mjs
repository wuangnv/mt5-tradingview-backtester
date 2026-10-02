import test from 'node:test'
import assert from 'node:assert/strict'
import { dashboardFilters, dashboardFilterError, dashboardNumber, dashboardRequestUrl, readDashboardOverview } from '../src/dashboardModel.js'

test('dashboard keeps unknown distinct from measured zero', () => {
  for (const unknown of [null, undefined, '', false, NaN, Infinity, 'not-a-number']) assert.equal(dashboardNumber(unknown), '—')
  assert.equal(dashboardNumber(0), '0')
  assert.equal(dashboardNumber(50, '%'), '50%')
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
