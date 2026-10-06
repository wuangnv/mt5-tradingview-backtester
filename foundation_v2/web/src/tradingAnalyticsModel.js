import { closeTime } from './sessionPerformanceModel.js'

export const known = value => value !== null && value !== undefined && value !== '' && typeof value !== 'boolean' && Number.isFinite(Number(value))
export const number = value => known(value) ? Number(value) : null
export const outcomeOf = value => !known(value) ? 'unknown' : Number(value) > 1e-12 ? 'win' : Number(value) < -1e-12 ? 'loss' : 'breakeven'
export const DEFAULT_EXTRA_FILTERS = { asset: 'all', tag: 'all', strategy: 'all', source: 'all', weekday: 'all', hour: 'all', timeStart: '', timeEnd: '', reportKinds: '', timezone: 'UTC', search: '', notes: '', assets: '', sides: '', outcomes: '', types: '', years: '', months: '', days: '', hours: '', tagInclude: '', tagExclude: '', tagIncludeMode: 'AND', tagExcludeMode: 'AND' }
// JSON preserves commas in journal tags and survives the existing string URL contract.
export function filterValues(value) {
  if (Array.isArray(value)) return value.map(String)
  if (!value) return []
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : [] } catch { return [] }
}
export function readAnalyticsExtraFilters(query) {
  const values = { ...DEFAULT_EXTRA_FILTERS }
  for (const key of Object.keys(values)) {
    const param = key === 'source' ? 'analytics_trade_source' : `analytics_${key}`
    if (query.get(param)) values[key] = query.get(param)
  }
  try { new Intl.DateTimeFormat('en', { timeZone: values.timezone }) } catch { values.timezone = 'UTC' }
  for (const key of ['timeStart', 'timeEnd']) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(values[key])) values[key] = ''
  return values
}

export function validateTradesPayload(payload) {
  const count = payload?.metrics?.closed_trade_count
  if (payload?.schema_version !== 'dashboard-replay-performance-v1' || !Array.isArray(payload.ledger)
    || !Array.isArray(payload.sources) || !Array.isArray(payload.excluded) || !Array.isArray(payload.scope?.session_ids)
    || !['ready', 'partial'].includes(payload.status)
    || !(count === payload.ledger.length || count === null && !payload.ledger.length && payload.excluded.length)
    || payload.ledger.some(row => !row || typeof row.session_id !== 'string' || !row.session_id || typeof row.trade_id !== 'string' || !row.trade_id
      || !known(row.net_pnl) || !row.source_provenance || !Number.isSafeInteger(row.source_provenance.revision) || row.source_provenance.revision < 1
      || row.source_provenance.session_id !== row.session_id)) throw new Error('trade_ledger_read_model_invalid')
  return payload
}
export const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const calendarFormatters = new Map()

export function calendarParts(value, timezone = 'UTC') {
  const date = closeTime(value)
  if (!date) return null
  if (!calendarFormatters.has(timezone)) calendarFormatters.set(timezone, new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }))
  const parts = calendarFormatters.get(timezone).formatToParts(date)
  const at = type => parts.find(part => part.type === type)?.value
  const key = `${at('year')}-${at('month')}-${at('day')}`
  return { key, month: key.slice(0, 7), hour: Number(at('hour')), minute: Number(at('minute')), weekday: new Date(`${key}T00:00:00Z`).getUTCDay() }
}

export function filterAnalyticsRows(rows, filters = DEFAULT_EXTRA_FILTERS) {
  filters = { ...DEFAULT_EXTRA_FILTERS, ...filters }
  const search = filters.search.trim().toLowerCase()
  const notes = filters.notes.trim().toLowerCase()
  const lists = Object.fromEntries(['assets', 'sides', 'outcomes', 'types', 'years', 'months', 'days', 'hours', 'tagInclude', 'tagExclude'].map(key => [key, filterValues(filters[key])]))
  const matches = (key, value) => !lists[key].length || value !== null && value !== undefined && lists[key].includes(String(value))
  const reportKinds = filterValues(filters.reportKinds)
  const minuteOf = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '') ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null
  const start = minuteOf(filters.timeStart), end = minuteOf(filters.timeEnd)
  const inTime = time => {
    if (start === null && end === null) return true
    if (!time) return false
    const minute = time.hour * 60 + time.minute
    return start !== null && end !== null && start > end ? minute >= start || minute <= end : (start === null || minute >= start) && (end === null || minute <= end)
  }
  const tagsMatch = (values, tags, mode) => mode === 'OR' ? values.some(value => tags.includes(value)) : values.every(value => tags.includes(value))
  return rows.filter(row => {
    const time = calendarParts(row.close_time_utc, filters.timezone)
    const tags = Array.isArray(row.tags) ? row.tags : []
    return inTime(time)
      && (filters.reportKinds === '' || reportKinds.includes(row.report_kind || 'app'))
      && (filters.asset === 'all' || row.symbol === filters.asset)
      && (filters.tag === 'all' || (row.tags || []).includes(filters.tag))
      && (!filters.strategy || filters.strategy === 'all' || row.playbook_id === filters.strategy)
      && (filters.source === 'all' || row.source_id === filters.source || (typeof row.source === 'string' ? row.source : row.source?.session_id) === filters.source)
      && (filters.weekday === 'all' || time?.weekday === Number(filters.weekday))
      && (filters.hour === 'all' || time?.hour === Number(filters.hour))
      && matches('assets', row.symbol)
      && matches('sides', row.side?.toLowerCase())
      && matches('outcomes', outcomeOf(row.net_pnl))
      && matches('types', row.entry_type)
      && matches('years', time?.key.slice(0, 4))
      && matches('months', time ? Number(time.key.slice(5, 7)) : null)
      && matches('days', time?.weekday)
      && matches('hours', time?.hour)
      && (!notes || typeof row.notes === 'string' && row.notes.toLowerCase().includes(notes) || typeof row.note === 'string' && row.note.toLowerCase().includes(notes))
      && (!lists.tagInclude.length || tagsMatch(lists.tagInclude, tags, filters.tagIncludeMode))
      && (!lists.tagExclude.length || !tagsMatch(lists.tagExclude, tags, filters.tagExcludeMode))
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
  const localFiltered = Object.keys(DEFAULT_EXTRA_FILTERS).filter(key => key !== 'timezone').some(key => (filters[key] ?? DEFAULT_EXTRA_FILTERS[key]) !== DEFAULT_EXTRA_FILTERS[key])
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
  if (rows.some(row => row.source_provenance)) columns.push('origin_session_id', 'source_provenance')
  const metaKeys = Object.keys(metadata).map(key => `report_${key}`)
  return '\uFEFF' + [...[columns.concat('account_currency', metaKeys).map(safe).join(',')], ...rows.map(row => columns.map(key => safe(key === 'tags' ? (row.tags || []).join('|') : key === 'source_provenance' ? JSON.stringify(row[key]) : row[key])).concat(safe(row.account_currency ?? currency), Object.values(metadata).map(safe)).join(','))].join('\r\n')
}
