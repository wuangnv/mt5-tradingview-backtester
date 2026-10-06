// Synthetic, independent broker snapshot; never a source for actual UI data.
export const ready = {
  status: 'ready', stale: false, source: 'Independent QA fixture', mode: 'demo',
  account_key: 'qa-only', captured_at_utc: '2026-10-07T12:00:00Z',
  history_from_utc: '2026-10-01T00:00:00Z', poll_seconds: 5, execution_capability: false,
  account: { account_ref: 'QA READ-ONLY', currency: 'USD', balance: 1041, equity: 1050, profit: 9, margin: 12, margin_free: 1038 },
  positions: [], orders: [], quotes: [],
  deals: [
    { ticket: 'qa-utc-before', position_id: 1, symbol: 'EURUSD', type: 0, entry: 1, volume: 0.1, price: 1.1, profit: 100, commission: -2, swap: -1, fee: -2, time_msc: Date.parse('2026-10-04T23:59:59.999Z') },
    { ticket: 'qa-utc-after', position_id: 2, symbol: 'XAUUSD', type: 1, entry: 1, volume: 0.2, price: 2300, profit: -50, commission: -2, swap: 0, fee: -2, time_msc: Date.parse('2026-10-05T00:00:00Z') },
    { ticket: 'qa-entry-cost', position_id: 3, symbol: 'EURUSD', type: 0, entry: 0, volume: 0.1, price: 1.12, profit: 0, commission: -3, swap: 0, fee: 0, time_msc: Date.parse('2026-10-05T10:00:00Z') },
  ],
  deal_count: 3,
  cashflows: [{ ticket: 'qa-deposit', type: 2, profit: 1000, time_msc: Date.parse('2026-10-05T09:00:00Z') }],
}
export const expected = {
  net: 38,
  daily: { '2026-10-04': { net: 95, count: 1 }, '2026-10-05': { net: -57, count: 2 } },
  cashflow: 1000,
  currency: 'USD',
  percent: null,
}
export const empty = { ...ready, deals: [], deal_count: 0, cashflows: [] }
export const missingCost = { ...ready, deals: [{ ...ready.deals[0], fee: undefined }], deal_count: 1, cashflows: [] }
export const invalidProfit = { ...ready, deals: [{ ...ready.deals[0], profit: '100' }], deal_count: 1, cashflows: [] }
export const invalidTime = { ...ready, deals: [{ ...ready.deals[0], time_msc: null }], deal_count: 1, cashflows: [] }
export const unavailable = { status: 'unavailable', execution_capability: false }
export const locked = { status: 'locked', execution_capability: false }
