import test from 'node:test'
import assert from 'node:assert/strict'
import { DEMO_LEDGER, DEMO_SESSIONS, demoResult, demoFilterRows, demoOverview } from '../src/demoFixtures.js'
import { canPreviewDemo, demoToggleHref } from '../src/demoMode.js'
import { buildWorkspaceHref, readWorkspaceContext } from '../src/workspaceContext.js'

test('demo curve, money, fee and R values reconcile to the same ledger', () => {
  assert.equal(DEMO_LEDGER.length, 60)
  assert.equal(new Set(DEMO_LEDGER.map(row => row.trade_id)).size, 60)
  for (const session of DEMO_SESSIONS) {
    const rows = demoFilterRows([session.record_id]), { metrics } = demoResult(rows, session)
    assert.equal(rows.length, 20)
    const net = rows.reduce((sum, row) => sum + row.net_pnl, 0)
    assert.equal(metrics.net_pnl, net)
    assert.equal(metrics.ending_closed_trade_balance, 10000 + net)
    assert.equal(metrics.closed_trade_balance_curve.at(-1).closed_trade_balance, 10000 + net)
    assert.equal(metrics.wins + metrics.losses + metrics.breakeven, rows.length)
    for (const row of rows) {
      assert.equal(row.gross_pnl - row.fees, row.net_pnl)
      assert.equal(row.realized_r, row.net_pnl / row.planned_risk_budget)
      const gross = (row.price_close - row.price_open) * (row.side === 'buy' ? 1 : -1) * row.quantity * (row.symbol === 'XAUUSD' ? 100 : 100000)
      assert.ok(Math.abs(gross - row.gross_pnl) < 1e-7)
    }
  }
  const { performance } = demoOverview()
  assert.equal(performance.months.reduce((n, item) => n + item.closed_trade_count, 0), 60)
  assert.equal(performance.symbols.reduce((n, item) => n + item.closed_trade_count, 0), 60)
})

test('demo selection and UTC date filters have an independent numeric oracle', () => {
  assert.equal(demoFilterRows(null, { side: 'buy' }).length, 30)
  assert.equal(demoFilterRows(null, { outcome: 'win' }).length, 30)
  assert.equal(demoFilterRows(null, { outcome: 'loss' }).length, 24)
  assert.equal(demoFilterRows(null, { outcome: 'breakeven' }).length, 6)
  assert.equal(demoFilterRows([]).length, 0)
  assert.ok(demoFilterRows(null, { from: '2026-09-01', to: '2026-09-30' }).every(row => row.close_time_utc.startsWith('2026-09')))
})

test('demo toggle roundtrip retains every real context/filter query value', () => {
  const original = 'http://127.0.0.1:5180/?workspace=tenant-a&view=analytics&session=real-owner&dataset=real-bars&cursor=500&sessions=a&sessions=b&analytics_asset=EURUSD&cutoff=bar-500'
  const enabled = demoToggleHref(original, true)
  assert.equal(enabled.searchParams.get('demo'), '1')
  assert.equal(demoToggleHref(enabled, false).href, original)
  const destination = new URL(buildWorkspaceHref('analytics', 'tenant-a', enabled.searchParams, { analytics_source: 'prop' }), enabled)
  assert.equal(destination.searchParams.get('demo'), '1')
  assert.deepEqual(readWorkspaceContext(destination), readWorkspaceContext(enabled))
  assert.equal(new URL(buildWorkspaceHref('overview', 'tenant-a', enabled.searchParams, { demo: null }), enabled).searchParams.has('demo'), false)
})

test('demo does not replace chart or order-entry surfaces', () => {
  assert.equal(canPreviewDemo('replay', new URLSearchParams('surface=workspace')), false)
  assert.equal(canPreviewDemo('replay', new URLSearchParams('select=1')), true)
  assert.equal(canPreviewDemo('trade', new URLSearchParams('intent=order')), false)
  assert.equal(canPreviewDemo('settings', new URLSearchParams()), false)
})
