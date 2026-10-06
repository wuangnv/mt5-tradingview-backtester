export const LIVE_FILTERS = Object.freeze({ asset: 'all', side: 'all', outcome: 'all', account: 'all', day: 'all', timezone: 'UTC', from: '', to: '' })

export function dealNet(deal) {
  const values = [deal.profit, deal.commission, deal.swap, deal.fee]
  return values.every(value => typeof value === 'number' && Number.isFinite(value)) ? values.reduce((sum, value) => sum + value, 0) : null
}

export function dayKey(timestamp, timezone = 'UTC') {
  if (!Number.isFinite(timestamp)) return ''
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp))
  const part = type => parts.find(part => part.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function filterLiveDeals(payload, filters = LIVE_FILTERS) {
  if (!payload?.account || filters.account !== 'all' && filters.account !== payload.account.account_ref) return []
  return (payload.deals || []).filter(deal => {
    if (![0, 1].includes(deal.type)) return false
    const day = dayKey(deal.time_msc, filters.timezone), net = dealNet(deal)
    return (filters.asset === 'all' || deal.symbol === filters.asset)
      && (filters.side === 'all' || deal.type === Number(filters.side))
      && (filters.outcome === 'all' || net !== null && (filters.outcome === 'gain' ? net > 0 : filters.outcome === 'loss' ? net < 0 : net === 0))
      && (filters.day === 'all' || day && new Date(`${day}T00:00:00Z`).getUTCDay() === Number(filters.day))
      && (!filters.from || day >= filters.from) && (!filters.to || day <= filters.to)
  })
}

export function summarizeDeals(deals, available = true) {
  return { count: available ? deals.length : null, net: available && deals.every(deal => dealNet(deal) !== null) ? deals.reduce((sum, deal) => sum + dealNet(deal), 0) : null }
}

export function calendarWeeks(month, payload, deals, filters = LIVE_FILTERS) {
  const first = new Date(`${month}-01T00:00:00Z`), days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const offset = (first.getUTCDay() + 6) % 7
  const history = Date.parse(payload?.history_from_utc), cutoff = Date.parse(payload?.captured_at_utc)
  const firstCovered = dayKey(history, filters.timezone), lastCovered = dayKey(cutoff, filters.timezone)
  const buckets = new Map()
  deals.forEach(deal => { const key = dayKey(deal.time_msc, filters.timezone); if (key) buckets.set(key, [...(buckets.get(key) || []), deal]) })
  return Array.from({ length: Math.ceil((offset + days) / 7) }, (_, week) => Array.from({ length: 7 }, (_, weekday) => {
    const date = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), week * 7 + weekday - offset + 1)), key = date.toISOString().slice(0, 10)
    const inMonth = key.startsWith(month), rows = buckets.get(key) || []
    // Edge days may be partial; no rows there cannot prove zero P/L.
    const covered = Boolean(payload?.account && Array.isArray(payload.deals) && Number.isFinite(history) && Number.isFinite(cutoff) && history < cutoff && key > firstCovered && key < lastCovered
      && (filters.account === 'all' || filters.account === payload.account.account_ref)
      && (!filters.from || key >= filters.from) && (!filters.to || key <= filters.to)
      && (filters.day === 'all' || date.getUTCDay() === Number(filters.day)))
    return { key, date, inMonth, covered, ...summarizeDeals(rows, inMonth && (covered || rows.length > 0)) }
  }))
}

export function cumulativeDealSeries(deals) {
  let total = 0, unknown = false
  return [...deals].filter(deal => Number.isFinite(deal.time_msc)).sort((a, b) => a.time_msc - b.time_msc).map(deal => {
    const net = dealNet(deal)
    if (net === null) unknown = true
    else total += net
    return { time: deal.time_msc, value: unknown ? null : total }
  })
}
