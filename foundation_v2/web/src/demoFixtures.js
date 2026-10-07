// Deterministic UI fixtures. Never passed to a broker, replay engine or API.
export const DEMO_SESSIONS = [
  { record_id: 'demo-london', name: 'London Breakout', instrument_id: 'EURUSD', timeframe: 'M1', status: 'paused', created_at_utc: '2026-07-06T08:00:00Z' },
  { record_id: 'demo-newyork', name: 'New York Reversal', instrument_id: 'GBPUSD', timeframe: 'M1', status: 'paused', created_at_utc: '2026-08-03T13:00:00Z' },
  { record_id: 'demo-gold', name: 'Gold Swing', instrument_id: 'XAUUSD', timeframe: 'M5', status: 'completed', created_at_utc: '2026-09-07T07:00:00Z' },
].map((item, i) => ({ ...item, dataset_id: `demo-dataset-${item.instrument_id}`, timeframe_seconds: item.timeframe === 'M5' ? 300 : 60, revision: 1, row_count: 30000, cursor_index: item.status === 'completed' ? 29999 : 1400 + i * 500, updated_at_utc: '2026-10-05T08:00:00Z', dataset_available: true, archived: false }))

export const DEMO_LEDGER = Array.from({ length: 60 }, (_, i) => {
  const session = DEMO_SESSIONS[i % 3], side = i % 2 ? 'sell' : 'buy'
  const net = [160, -90, 220, -120, 0, 85, -65, 140, 260, -110][i % 10]
  const symbol = session.instrument_id, price = symbol === 'XAUUSD' ? 2550 + i * .4 : symbol === 'GBPUSD' ? 1.29 + i * .0001 : 1.08 + i * .0001
  const quantity = symbol === 'XAUUSD' ? 1 : .2, multiplier = symbol === 'XAUUSD' ? 100 : 100000, direction = side === 'buy' ? 1 : -1
  const time = Date.UTC(2026, 6, 6 + i * 1.4, 7 + i % 15)
  return { trade_id: `demo-trade-${String(i + 1).padStart(3, '0')}`, session_id: session.record_id, session_name: session.name, source: 'UI demo', symbol, side,
    open_time_utc: new Date(time).toISOString(), close_time_utc: new Date(time + (20 + i % 8 * 15) * 60000).toISOString(), recorded_at_utc: '2026-10-05T08:00:00Z',
    entry_type: 'market', price_open: price, price_close: price + direction * (net + 3) / (quantity * multiplier), quantity, stop_loss: price - direction * 100 / (quantity * multiplier), take_profit: price + direction * 200 / (quantity * multiplier),
    net_pnl: net, gross_pnl: net + 3, fees: 3, planned_risk_budget: 100, realized_r: net / 100, account_currency: 'USD', starting_balance: 10000, rating: 1 + i % 5, tags: [i % 2 ? 'reversal' : 'breakout', i % 3 ? 'planned' : 'review'] }
})

export function demoResult(rows = DEMO_LEDGER, session = DEMO_SESSIONS[0]) {
  let balance = 10000
  const curve = [{ sequence: 0, closed_trade_balance: balance }]
  for (const row of rows) { balance += row.net_pnl; curve.push({ sequence: curve.length, trade_id: row.trade_id, closed_trade_balance: balance }) }
  const wins = rows.filter(row => row.net_pnl > 0).length, losses = rows.filter(row => row.net_pnl < 0).length
  const profit = rows.reduce((sum, row) => sum + Math.max(0, row.net_pnl), 0), loss = -rows.reduce((sum, row) => sum + Math.min(0, row.net_pnl), 0)
  return { preview: true, account_currency: 'USD', session_id: session.record_id, ledger: rows, metrics: { starting_balance: 10000, ending_closed_trade_balance: balance,
    closed_trade_count: rows.length, net_pnl: balance - 10000, wins, losses, breakeven: rows.length - wins - losses, win_rate_pct: rows.length ? wins / rows.length * 100 : null,
    profit_factor_after_cost: loss ? profit / loss : null, payoff_ratio_after_cost: wins && losses ? (profit / wins) / (loss / losses) : null, closed_trade_balance_curve: curve } }
}

export function demoOverview(rows = DEMO_LEDGER) {
  const metrics = demoResult(rows).metrics
  const months = [...new Set(rows.map(row => row.close_time_utc.slice(0, 7)))].map(month => {
    const group = rows.filter(row => row.close_time_utc.startsWith(month))
    return { month, closed_trade_count: group.length, win_rate_pct: group.filter(row => row.net_pnl > 0).length / group.length * 100 }
  })
  return { performance: { schema_version: 'dashboard-replay-performance-v1', status: 'ready', scope: { session_count: 3, readable_session_count: 3 }, metrics, months,
    time_invested_seconds: 67200, historical_time_replayed_seconds: 3135600,
    symbols: DEMO_SESSIONS.map(session => ({ symbol: session.instrument_id, closed_trade_count: rows.filter(row => row.symbol === session.instrument_id).length })), sessions: [], sources: [], excluded: [] } }
}

export function demoFilterRows(ids, filters = {}) {
  return DEMO_LEDGER.filter(row => (ids === null || ids.includes(row.session_id)) && (!filters.side || filters.side === 'all' || row.side === filters.side)
    && (!filters.outcome || filters.outcome === 'all' || (row.net_pnl > 0 ? 'win' : row.net_pnl < 0 ? 'loss' : 'breakeven') === filters.outcome)
    && (!filters.from || row.close_time_utc.slice(0, 10) >= filters.from) && (!filters.to || row.close_time_utc.slice(0, 10) <= filters.to))
}

export function demoDashboardAnalytics(item, workspace) {
  const rows = demoFilterRows([item.source_record_id || item.record_id]).map(row => ({ ...row, session_id: item.record_id, session_name: item.name }))
  const result = demoResult(rows, item)
  return { schema_version: 'analytics-read-model-v1', analytics_available: true, metrics: result.metrics, ledger: rows,
    scope: { selected_trade_count: rows.length, total_trade_count: rows.length },
    provenance: { preview: true, workspace_id: workspace, session_id: item.record_id, account_currency: 'USD', instrument_id: item.instrument_id,
      playbook_id: item.source_record_id || item.record_id, cutoff_timestamp: rows.length ? Date.parse(rows.at(-1).close_time_utc) / 1000 : null } }
}

export const DEMO_DATASETS = DEMO_SESSIONS.map(item => ({ dataset_id: item.dataset_id, first_timestamp: Date.UTC(2026, 6, 6) / 1000, last_timestamp: Date.UTC(2026, 9, 5) / 1000 }))

export function demoReplayContext(item) {
  const source = item.source_record_id || item.record_id
  const index = Math.max(0, DEMO_SESSIONS.findIndex(entry => entry.record_id === source))
  const dataset = DEMO_DATASETS.find(entry => entry.dataset_id === item.dataset_id)
  return { record_id: item.record_id, revision: item.revision, cutoff_timestamp: dataset.last_timestamp - [7, 3, 0][index] * 86400,
    payload: { execution: { balance: demoDashboardAnalytics(item, 'demo').metrics.ending_closed_trade_balance, starting_balance: 10000 } } }
}

export const DEMO_ASSETS = { status: 'ready', source: 'UI demo', items: ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCHF', 'USDCAD', 'NZDUSD', 'XAUUSD', 'XAGUSD', 'US500', 'NAS100', 'BTCUSD'].map((symbol, i) => ({
  symbol, metadata: { group: i < 7 ? 'Forex' : i < 9 ? 'Metals' : i < 11 ? 'Indices' : 'Crypto', description: `${symbol} · Demo` }, enabled: true, status: i < 10 ? 'ready' : 'not_downloaded',
  dataset_id: i < 10 ? `demo-dataset-${symbol}` : null, first_timestamp: 1783296000, last_timestamp: 1791158400, row_count: 93600, quality: 'basic',
})) }

export const DEMO_LIVE = { source: 'UI demo', captured_at_utc: '2026-10-05T08:00:00Z', account: { account_ref: 'DEMO PREVIEW', balance: 12380, equity: 12512, profit: 132, margin: 250, margin_free: 12262, currency: 'USD' },
  positions: DEMO_LEDGER.slice(0, 3).map((row, i) => ({ ticket: `demo-${i + 1}`, symbol: row.symbol, type: row.side === 'buy' ? 0 : 1, volume: row.quantity, price_open: row.price_open, sl: row.stop_loss, tp: row.take_profit, profit: [84, -36, 84][i] })), orders: [], quotes: [],
  deals: DEMO_LEDGER.map((row, i) => ({ ticket: `demo-${i + 1}`, symbol: row.symbol, position_id: row.trade_id, type: row.side === 'buy' ? 0 : 1, entry: 1, volume: row.quantity, price: row.price_close, profit: row.gross_pnl, commission: -row.fees, swap: 0, fee: 0, time_msc: i >= DEMO_LEDGER.length - 8 ? Date.parse('2026-10-03T08:00:00Z') + (i - DEMO_LEDGER.length + 8) * 3 * 3600000 : Date.parse(row.close_time_utc) })), deal_count: DEMO_LEDGER.length, cashflows: [{ ticket: 'demo-deposit', type: 2, profit: 10000, time_msc: Date.parse('2026-07-06T08:00:00Z'), comment: 'Demo deposit' }], history_from_utc: '2026-07-06T00:00:00Z' }
