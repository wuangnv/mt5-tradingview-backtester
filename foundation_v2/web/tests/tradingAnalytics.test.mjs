import test from 'node:test'
import assert from 'node:assert/strict'
import { advancedAnalytics, calendarParts, DEFAULT_EXTRA_FILTERS, readAnalyticsExtraFilters, validateTradesPayload, filterAnalyticsRows, monteCarlo, outcomeOf, tradesCsv } from '../src/tradingAnalyticsModel.js'
import { buildPropAnalyticsView, propReplayQuery } from '../src/propAnalyticsModel.js'

const rows = [100, -50, 0, 150, -100].map((value, index) => ({ trade_id: `trade-${index}`, tradeId: `trade-${index}`, rowIndex: index, net_pnl: value, pnl: value, side: index % 2 ? 'SELL' : 'BUY', symbol: index % 2 ? 'EURUSD' : 'GBPUSD', realized_r: null, open_time_utc: `2024-01-0${index + 1}T12:00:00Z`, close_time_utc: `2024-01-0${index + 1}T13:00:00Z`, tags: index === 3 ? ['breakout'] : [] }))
const model = { ledger: rows, startBalance: 1000, endingBalance: 1100, curve: [1000, 1100, 1050, 1050, 1200, 1100].map((value, index) => ({ value, index })), drawdown: [0, 50, 50, 0, 100].map((drawdown, index) => ({ drawdown, drawdownPct: drawdown / (index < 3 ? 1100 : 1200) * 100 })) }
const almost = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} !== ${expected}`)
test('known numeric oracle: metrics, partial risk, closed DD, durations and calendar', () => {
  const data = advancedAnalytics(model)
  assert.equal(data.net, 100); assert.equal(data.count, 5); assert.equal(data.winRate, 40)
  assert.equal(data.averageWin, 125); assert.equal(data.averageLoss, -75); assert.equal(data.expectancy, 20)
  almost(data.profitFactor, 250 / 150)
  assert.equal(data.maxDrawdown, 100); almost(data.maxDrawdownPct, 100 / 1200 * 100)
  assert.equal(data.maxWinStreak, 1); assert.equal(data.maxLossStreak, 1); assert.equal(data.winDuration, 60)
  assert.equal(data.averageR, null); assert.equal(data.rCount, 0)
  assert.equal(data.calendar.reduce((sum, day) => sum + day.net, 0), 100)
  assert.equal(data.frequency[0].count, 1)
})
test('all winning or losing distributions keep undefined denominators unknown', () => {
  const wins = advancedAnalytics({ ...model, ledger: rows.filter(row => row.pnl > 0) })
  assert.equal(wins.winRate, 100); assert.equal(wins.profitFactor, null); assert.equal(wins.averageLoss, null)
  const losses = advancedAnalytics({ ...model, ledger: rows.filter(row => row.pnl < 0) })
  assert.equal(losses.winRate, 0); assert.equal(losses.profitFactor, 0); assert.equal(losses.averageWin, null)
  const missing = advancedAnalytics({ ...model, ledger: [{ ...rows[0], net_pnl: null }] })
  assert.equal(missing.net, null); assert.equal(missing.winRate, null); assert.equal(missing.expectancy, null)
  assert.equal(advancedAnalytics({ ...model, ledger: [] }).averageR, null)
})
test('local filter recomputes every metric and hypothetical balance from original capital', () => {
  const extra = { ...DEFAULT_EXTRA_FILTERS, asset: 'EURUSD' }
  const data = advancedAnalytics(model, extra)
  assert.equal(data.count, 2); assert.equal(data.net, 100); assert.equal(data.endingBalance, 1100)
  assert.equal(data.curve.length, 3); assert.equal(data.curve[0].value, 1000)
  assert.equal(filterAnalyticsRows(rows, { ...DEFAULT_EXTRA_FILTERS, tag: 'breakout' })[0].tradeId, 'trade-3')
  assert.equal(filterAnalyticsRows(rows, { ...DEFAULT_EXTRA_FILTERS, search: 'trade-2' }).length, 1)
  assert.equal(outcomeOf(1e-13), 'breakeven')
})
test('strategy filter excludes unknown ownership and intersects assets without retaining an unfiltered curve', () => {
  const strategyRows = rows.map((row, index) => ({ ...row, playbook_id: index === 1 || index === 3 ? 'breakout' : index === 0 ? 'reversal' : null }))
  const filters = { ...DEFAULT_EXTRA_FILTERS, strategy: 'breakout', asset: 'EURUSD' }
  const data = advancedAnalytics({ ...model, ledger: strategyRows }, filters)
  assert.equal(data.count, 2); assert.equal(data.net, 100)
  assert.deepEqual(data.curve.map(point => point.value), [1000, 950, 1100])
  assert.equal(filterAnalyticsRows(strategyRows, { ...filters, strategy: 'missing' }).length, 0)
  assert.equal(filterAnalyticsRows(strategyRows, DEFAULT_EXTRA_FILTERS).length, 5)
  assert.equal(readAnalyticsExtraFilters(new URLSearchParams('analytics_strategy=breakout')).strategy, 'breakout')
})
test('timezone and calendar zero periods use actual dates rather than local machine date', () => {
  const utc = calendarParts('2024-01-01T23:59:00Z', 'UTC'), vn = calendarParts('2024-01-01T23:59:00Z', 'Asia/Ho_Chi_Minh')
  assert.equal(utc.key, '2024-01-01'); assert.equal(vn.key, '2024-01-02'); assert.equal(vn.hour, 6)
  assert.equal(calendarParts(null), null)
  const sparse = advancedAnalytics({ ...model, ledger: [rows[0], rows[4]] })
  almost(sparse.frequency[0].count, .4)
})
test('Monte Carlo deterministic bootstrap with a one-value oracle and bounded configuration', () => {
  const config = { method: 'ledger', simulations: 10, trades: 3, capital: 100, seed: 42 }
  const result = monteCarlo(config, [{ net_pnl: 10 }])
  assert.equal(result.average, 130); assert.equal(result.p05, 130); assert.equal(result.maxDD, 0); assert.equal(result.probabilityProfit, 100)
  assert.deepEqual(result, monteCarlo(config, [{ net_pnl: 10 }]))
  assert.throws(() => monteCarlo({ ...config, simulations: 1000, trades: 1000 }, rows), /250.000/)
  assert.throws(() => monteCarlo(config, [{ net_pnl: null }]), /đầy đủ/)
  const lost = monteCarlo({ ...config, method: 'configured', averageWin: 10, averageLoss: 60, winRate: 0 }, [])
  assert.equal(lost.ruinRate, 100); assert.equal(lost.min, 0); assert.equal(lost.maxDD, 100)
})
test('CSV retains unknown blanks, exports exact filtered rows, escapes spreadsheet formulas', () => {
  const csv = tradesCsv([{ ...rows[0], symbol: '=NOW()', fees: null }], 'USD')
  assert.ok(csv.includes("'" + '=NOW()')); assert.ok(csv.includes('"USD"')); assert.ok(!csv.includes('trade-1'))
})
test('Prop adapter takes report replay cutoff and clears unrelated route context', () => {
  const report = { schema_version: 'prop-attempt-report-v1', mode: 'simulation', broker_execution_capability: false, provenance: { replay_binding: { replay_session_id: 'challenge-replay', dataset_id: 'original', last_replay_event_sequence: 30 }, replay_cursor: { bar_index: 17 } } }
  const query = propReplayQuery(report, new URLSearchParams('session=later&job=wrong&cursor=999&cutoff=999&trade=later'))
  assert.equal(query.get('event_sequence'), '30'); assert.equal(query.get('session'), 'challenge-replay'); assert.equal(query.get('cursor'), '17'); assert.equal(query.get('dataset'), 'original'); assert.equal(query.has('job'), false); assert.equal(query.has('trade'), false)
  assert.equal(propReplayQuery({ ...report, broker_execution_capability: true }), null)
  assert.equal(propReplayQuery({ ...report, provenance: {} }), null)
})

test('CSV prefix protection rejects formulas including negative expressions but retains numeric negatives', () => {
  const csv = tradesCsv([{ trade_id: '-1+1', symbol: '  =NOW()', net_pnl: -123 }], 'USD')
  assert.ok(csv.includes("'-1+1")); assert.ok(csv.includes("'  =NOW()")); assert.ok(csv.includes('"-123"'))
})
test('Prop same-cursor event and phase fence; subset uses report phase initial balance', () => {
  const report = { phase: { phase_index: 2, currency: 'USD', initial_balance: '50000' }, attempt: { virtual_start_utc: '2024-01-01T00:00:00Z' }, provenance: { replay_binding: { replay_session_id: 'bound', dataset_id: 'data', dataset_sha256: 'hash', branch_id: null, last_replay_event_sequence: 40 } } }
  const view = { analytics_available: true, provenance: { session_id: 'bound', dataset_id: 'data', dataset_sha256: 'hash', branch_id: null, execution_event_sequence: 40, phase_index: 2, account_currency: 'USD' }, ledger: [{ ...rows[0], close_phase_index: 1 }, { ...rows[1], close_phase_index: 2 }], scope: {} }
  const result = buildPropAnalyticsView(view, report)
  assert.equal(result.ledger.length, 1); assert.equal(result.metrics.starting_balance, 50000); assert.equal(result.metrics.ending_closed_trade_balance, 49950)
  assert.throws(() => buildPropAnalyticsView({ ...view, provenance: { ...view.provenance, execution_event_sequence: 41 } }, report), /scope_mismatch/)
  assert.throws(() => buildPropAnalyticsView({ ...view, provenance: { ...view.provenance, dataset_sha256: 'other' } }, report), /scope_mismatch/)
})


test('report filter URL preserves source navigation and validates timezone', () => {
  const values = readAnalyticsExtraFilters(new URLSearchParams('analytics_source=sessions&analytics_trade_source=trade-source&analytics_timezone=broken'));
  assert.equal(values.source, 'trade-source'); assert.equal(values.timezone, 'UTC');
  assert.equal(readAnalyticsExtraFilters(new URLSearchParams('analytics_source=prop')).source, 'all');
});

test('multi-session CSV keeps each currency and source checkpoint without summing money', () => {
  const csv = tradesCsv([{ trade_id: 'same', session_id: 'usd', account_currency: 'USD', net_pnl: 5, source_provenance: { revision: 2, execution_event_sequence: 6 } }, { trade_id: 'same', session_id: 'eur', account_currency: 'EUR', net_pnl: 10, source_provenance: { revision: 3 } }], '');
  assert.match(csv, /source_provenance/); assert.match(csv, /USD/); assert.match(csv, /EUR/); assert.match(csv, /execution_event_sequence/);
});


test('aggregate ledger rejects malformed or mismatched source instead of fabricating rows', () => {
  const payload = { schema_version: 'dashboard-replay-performance-v1', status: 'ready', ledger: [{ session_id: 'a', trade_id: 'x', net_pnl: 5, source_provenance: { session_id: 'a', revision: 1 } }], sources: [], excluded: [], scope: { session_ids: ['a'] }, metrics: { closed_trade_count: 1 } };
  assert.equal(validateTradesPayload(payload), payload);
  for (const ledger of [[null], [{ ...payload.ledger[0], source_provenance: { session_id: 'wrong', revision: 1 } }], [{ ...payload.ledger[0], net_pnl: null }]]) assert.throws(() => validateTradesPayload({ ...payload, ledger }));
  assert.throws(() => validateTradesPayload({ ...payload, metrics: { closed_trade_count: 0 } }));
});
