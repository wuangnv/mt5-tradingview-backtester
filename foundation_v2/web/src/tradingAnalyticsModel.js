import { closeTime } from './sessionPerformanceModel.js'

export const known = value => value !== null && value !== undefined && value !== '' && typeof value !== 'boolean' && Number.isFinite(Number(value))
export const number = value => known(value) ? Number(value) : null
export const outcomeOf = value => !known(value) ? 'unknown' : Number(value) > 1e-12 ? 'win' : Number(value) < -1e-12 ? 'loss' : 'breakeven'
export const DEFAULT_EXTRA_FILTERS = { asset: 'all', tag: 'all', source: 'all', weekday: 'all', hour: 'all', timezone: 'UTC', search: '' }
export const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const calendarFormatters = new Map()

export function calendarParts(value, timezone = 'UTC') {
  const date = closeTime(value)
  if (!date) return null
  if (!calendarFormatters.has(timezone)) calendarFormatters.set(timezone, new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }))
  const parts = calendarFormatters.get(timezone).formatToParts(date)
  const at = type => parts.find(part => part.type === type)?.value
  const key = `${at('year')}-${at('month')}-${at('day')}`
  return { key, month: key.slice(0, 7), hour: Number(at('hour')), weekday: new Date(`${key}T00:00:00Z`).getUTCDay() }
}

export function filterAnalyticsRows(rows, filters = DEFAULT_EXTRA_FILTERS) {
  const search = filters.search.trim().toLowerCase()
  return rows.filter(row => {
    const time = calendarParts(row.close_time_utc, filters.timezone)
    return (filters.asset === 'all' || row.symbol === filters.asset)
      && (filters.tag === 'all' || (row.tags || []).includes(filters.tag))
      && (filters.source === 'all' || row.source_id === filters.source || (typeof row.source === 'string' ? row.source : row.source?.session_id) === filters.source)
      && (filters.weekday === 'all' || time?.weekday === Number(filters.weekday))
      && (filters.hour === 'all' || time?.hour === Number(filters.hour))
      && (!search || [row.tradeId, row.trade_id, row.symbol, row.side, ...(row.tags || [])].join(' ').toLowerCase().includes(search))
  })
}

function stats(rows) {
  const complete = rows.every(row => known(row.net_pnl))
  const pnl = complete ? rows.map(row => Number(row.net_pnl)) : []
  const wins = pnl.filter(value => outcomeOf(value) === 'win'), losses = pnl.filter(value => outcomeOf(value) === 'loss')
  const total = values => values.reduce((sum, value) => sum + value, 0)
  const average = values => values.length ? total(values) / values.length : null
  let winStreak = 0, lossStreak = 0, maxWinStreak = 0, maxLossStreak = 0
  for (const value of pnl) {
    winStreak = outcomeOf(value) === 'win' ? winStreak + 1 : 0
    lossStreak = outcomeOf(value) === 'loss' ? lossStreak + 1 : 0
    maxWinStreak = Math.max(maxWinStreak, winStreak); maxLossStreak = Math.max(maxLossStreak, lossStreak)
  }
  const duration = kind => rows.filter(row => outcomeOf(row.net_pnl) === kind).map(row => {
    const start = closeTime(row.open_time_utc), end = closeTime(row.close_time_utc)
    return start && end && end >= start ? (end - start) / 60000 : null
  })
  const durationAverage = kind => { const values = duration(kind); return values.length && values.every(known) ? average(values) : null }
  const r = rows.map(row => number(row.realized_r)).filter(value => value !== null)
  return { count: rows.length, complete, net: complete ? total(pnl) : null, wins: complete ? wins.length : null, losses: complete ? losses.length : null,
    breakeven: complete ? pnl.length - wins.length - losses.length : null, winRate: complete && pnl.length ? wins.length / pnl.length * 100 : null,
    expectancy: average(pnl), profitFactor: losses.length ? total(wins) / Math.abs(total(losses)) : null,
    averageWin: average(wins), averageLoss: average(losses), bestWin: wins.length ? Math.max(...wins) : null, worstLoss: losses.length ? Math.min(...losses) : null,
    maxWinStreak: complete ? maxWinStreak : null, maxLossStreak: complete ? maxLossStreak : null, winDuration: durationAverage('win'), lossDuration: durationAverage('loss'),
    averageR: average(r), maxR: r.length ? Math.max(...r) : null, rCount: r.length,
  }
}

export function advancedAnalytics(model, filters = DEFAULT_EXTRA_FILTERS) {
  const rows = filterAnalyticsRows(model.ledger, filters)
  const summary = stats(rows)
  const localFiltered = ['asset', 'tag', 'source', 'weekday', 'hour', 'search'].some(key => filters[key] !== DEFAULT_EXTRA_FILTERS[key])
  // A filtered balance is a hypothetical sequence from the original starting capital.
  let balance = number(model.startBalance), peak = balance, drawdown = [], curve = []
  if (balance !== null && summary.complete) {
    curve = [{ index: 0, value: balance }]
    for (const [index, row] of rows.entries()) {
      balance += Number(row.net_pnl); peak = Math.max(peak, balance)
      curve.push({ index: index + 1, value: balance, tradeId: row.tradeId })
      drawdown.push({ index: index + 1, drawdown: peak - balance, drawdownPct: peak > 0 ? (peak - balance) / peak * 100 : null })
    }
  }
  if (!localFiltered) { curve = model.curve; drawdown = model.drawdown; balance = model.endingBalance }
  const dd = drawdown.map(point => number(point.drawdown)).filter(value => value !== null)
  const positiveDD = dd.filter(value => value > 1e-12)
  let episodes = 0, current = 0, longest = 0, recoverySum = 0, recovered = 0
  for (const value of dd) {
    if (value > 1e-12) { if (!current) episodes++; current++; longest = Math.max(longest, current) }
    else if (current) { recoverySum += current; recovered++; current = 0 }
  }
  const datesComplete = rows.length > 0 && rows.every(row => calendarParts(row.close_time_utc, filters.timezone) && known(row.net_pnl))
  const group = (keys, keyOf) => keys.map(label => ({ label, ...stats(rows.filter(row => keyOf(row) === label)) }))
  const timeParts = new Map(rows.map(row => [row, calendarParts(row.close_time_utc, filters.timezone)]))
  const parts = row => timeParts.get(row)
  const months = datesComplete ? [...new Set(rows.map(row => parts(row).month))].sort() : []
  const days = datesComplete ? [...new Set(rows.map(row => parts(row).key))].sort() : []
  const side = ['BUY', 'SELL'].map(label => ({ label, ...stats(rows.filter(row => String(row.side).toUpperCase() === label)) }))
  const unknownSide = rows.filter(row => !['BUY', 'SELL'].includes(String(row.side).toUpperCase())).length
  const hours = datesComplete ? group(Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0')), row => String(parts(row).hour).padStart(2, '0')) : []
  const weekdays = datesComplete ? group(['1', '2', '3', '4', '5', '6', '0'], row => String(parts(row).weekday)).map(item => ({ ...item, label: WEEKDAYS[Number(item.label)] })) : []
  const calendar = datesComplete ? group(days, row => parts(row).key) : []
  const monthGroups = datesComplete ? group(months, row => parts(row).month) : []
  const sessions = datesComplete ? group(['00–08', '08–13', '13–21', '21–24'], row => { const h = calendarParts(row.close_time_utc, 'UTC').hour; return h < 8 ? '00–08' : h < 13 ? '08–13' : h < 21 ? '13–21' : '21–24' }) : []
  const frequencyGroups = datesComplete ? [
    { label: 'Ngày', count: days.length ? rows.length / (Math.round((new Date(days.at(-1)) - new Date(days[0])) / 86400000) + 1) : null },
    { label: 'Tuần', count: (() => { const weeks = rows.map(row => { const date = new Date(`${parts(row).key}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7); return date.getTime() }); return rows.length / (Math.round((Math.max(...weeks) - Math.min(...weeks)) / 604800000) + 1) })() },
    { label: 'Tháng', count: (() => { const index = key => Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)); return rows.length / (index(months.at(-1)) - index(months[0]) + 1) })() },
  ] : []
  return { ...summary, rows, curve, drawdown, endingBalance: balance, localFiltered, maxDrawdown: dd.length ? Math.max(...dd) : null,
    maxDrawdownPct: drawdown.some(point => known(point.drawdownPct)) ? Math.max(...drawdown.map(point => number(point.drawdownPct) ?? 0)) : null,
    averageDrawdown: positiveDD.length ? positiveDD.reduce((sum, value) => sum + value, 0) / positiveDD.length : dd.length ? 0 : null,
    episodes: dd.length ? episodes : null, recoveryTrades: recovered ? recoverySum / recovered : null, unrecovered: current, longest,
    side, unknownSide, hours, weekdays, months: monthGroups, calendar, sessions, frequency: frequencyGroups, datesComplete,
  }
}

function seededRandom(seed) {
  let value = Number(seed) >>> 0
  return () => { value += 0x6D2B79F5; let n = value; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296 }
}

export function monteCarlo(config, ledger = []) {
  const simulations = Number(config.simulations), trades = Number(config.trades), capital = Number(config.capital), seed = Number(config.seed)
  if (!Number.isInteger(simulations) || simulations < 1 || simulations > 1000 || !Number.isInteger(trades) || trades < 1 || trades > 1000 || simulations * trades > 250000 || !known(capital) || capital <= 0 || !Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('Giới hạn: 1–1.000 lượt, 1–1.000 lệnh, tối đa 250.000 bước; vốn > 0 và seed 0–4.294.967.295.')
  const samples = ledger.map(row => number(row.net_pnl))
  const bootstrap = config.method === 'ledger'
  if (bootstrap && (!samples.length || samples.some(value => value === null))) throw new Error('Ledger phải có Net P/L đầy đủ để lấy mẫu.')
  const win = Number(config.averageWin), loss = Number(config.averageLoss), rate = Number(config.winRate)
  if (!bootstrap && (![win, loss, rate].every(Number.isFinite) || win < 0 || loss < 0 || rate < 0 || rate > 100)) throw new Error('Lãi/lỗ trung bình phải ≥ 0; win rate từ 0 đến 100%.')
  const random = seededRandom(seed), paths = [], endings = [], drawdowns = []
  let ruined = 0
  for (let run = 0; run < simulations; run++) {
    let balance = capital, peak = capital, maxDD = 0
    const path = [balance]
    for (let index = 0; index < trades; index++) {
      if (balance > 0) balance += bootstrap ? samples[Math.floor(random() * samples.length)] : random() < rate / 100 ? win : -loss
      balance = Math.max(0, balance); peak = Math.max(peak, balance); maxDD = Math.max(maxDD, peak - balance)
      path.push(balance)
    }
    if (balance === 0) ruined++
    endings.push(balance); drawdowns.push(maxDD)
    if (run < 30) paths.push(path)
  }
  const sorted = [...endings].sort((a, b) => a - b)
  const percentile = p => { const at = (sorted.length - 1) * p; return sorted[Math.floor(at)] + (sorted[Math.ceil(at)] - sorted[Math.floor(at)]) * (at % 1) }
  return { paths, average: endings.reduce((sum, value) => sum + value, 0) / simulations, p05: percentile(.05), median: percentile(.5), p95: percentile(.95), min: sorted[0], max: sorted.at(-1), maxDD: Math.max(...drawdowns), ruinRate: ruined / simulations * 100, probabilityProfit: endings.filter(value => value > capital).length / simulations * 100, config: { ...config }, sampleCount: samples.length }
}

export function tradesCsv(rows, currency, metadata = {}) {
  const safe = value => { const text = String(value ?? ''); const numeric = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) && Number.isFinite(Number(text)); const formula = /^[\t\r\n]/.test(text) || /^\s*[=+@-]/.test(text) && !numeric; return `"${(formula ? `'${text}` : text).replaceAll('"', '""')}"` }
  const columns = ['trade_id', 'session_id', 'symbol', 'side', 'open_time_utc', 'close_time_utc', 'price_open', 'price_close', 'quantity', 'net_pnl', 'gross_pnl', 'fees', 'realized_r', 'tags']
  const metaKeys = Object.keys(metadata).map(key => `report_${key}`)
  return '\uFEFF' + [...[columns.concat('account_currency', metaKeys).map(safe).join(',')], ...rows.map(row => columns.map(key => safe(key === 'tags' ? (row.tags || []).join('|') : row[key])).concat(safe(currency), Object.values(metadata).map(safe)).join(','))].join('\r\n')
}
