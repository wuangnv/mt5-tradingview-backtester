export function closeTime(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  const numeric = typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value))
  const date = new Date(numeric ? Number(value) * (Number(value) < 1e11 ? 1000 : 1) : value)
  return Number.isNaN(date.getTime()) ? null : date
}

// Calendar summaries are anchored to the last historical close, never today's clock.
export function sessionPeriods(ledger) {
  if (!ledger.length) return { months: [], weekdays: [], anchor: null, month: null, week: null, day: null, incomplete: false }
  const rows = ledger.map(trade => ({ date: closeTime(trade.close_time_utc), pnl: trade.net_pnl }))
  if (rows.some(row => !row.date || typeof row.pnl !== 'number' || !Number.isFinite(row.pnl))) return { months: [], weekdays: [], anchor: null, month: null, week: null, day: null, incomplete: true }
  const anchor = new Date(Math.max(...rows.map(row => row.date.getTime())))
  const dayStart = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()))
  const weekStart = new Date(dayStart)
  weekStart.setUTCDate(weekStart.getUTCDate() - (weekStart.getUTCDay() + 6) % 7)
  const monthKey = anchor.toISOString().slice(0, 7)
  const grouped = new Map()
  const weekdays = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(label => ({ label, value: 0 }))
  let month = 0, week = 0, day = 0
  for (const row of rows) {
    const key = row.date.toISOString().slice(0, 7)
    grouped.set(key, (grouped.get(key) || 0) + row.pnl)
    weekdays[(row.date.getUTCDay() + 6) % 7].value += row.pnl
    if (key === monthKey) month += row.pnl
    if (row.date >= weekStart) week += row.pnl
    if (row.date >= dayStart) day += row.pnl
  }
  return { months: [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value })), weekdays, anchor, month, week, day, incomplete: false }
}
