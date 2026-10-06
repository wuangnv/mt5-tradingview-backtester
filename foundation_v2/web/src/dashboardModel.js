import { recentSessions } from './sessionCatalog.js'

const numberFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 })
const moneyFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 })

export function dashboardMoney(value, currency) {
  if (dashboardNumber(value) === '—') return '—'
  return `${moneyFormatter.format(Number(value))} ${currency || 'đơn vị tài khoản'}`
}

export function dashboardNumber(value, suffix = '') {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value))) return '—'
  return `${numberFormatter.format(Number(value))}${suffix}`
}

export function dashboardFilters(query) {
  const date = (key) => /^\d{4}-\d{2}-\d{2}$/.test(query.get(key) || '') ? query.get(key) : ''
  return { session: query.get('dashboard_session') || '', from: date('dashboard_from'), to: date('dashboard_to') }
}

export function dashboardRequestUrl(filters) {
  const params = new URLSearchParams()
  if (filters.session) params.set('session_id', filters.session)
  if (filters.from) params.set('from_close_utc', `${filters.from}T00:00:00.000Z`)
  if (filters.to) params.set('to_close_utc', `${filters.to}T23:59:59.999Z`)
  return `/api/v2/overview${params.size ? `?${params}` : ''}`
}

export function dashboardFilterError(filters) {
  return filters.from && filters.to && filters.from > filters.to ? 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.' : ''
}

export function dashboardPeriodRange(period, now = new Date()) {
  if (period === 'lifetime') return { from: '', to: '' }
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  if (period === 'last-week' || period === 'last-month') {
    const start = new Date(today), end = new Date(today)
    if (period === 'last-week') {
      start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7 - 7)
      end.setTime(start.getTime())
      end.setUTCDate(end.getUTCDate() + 6)
    } else {
      start.setUTCDate(1)
      start.setUTCMonth(start.getUTCMonth() - 1)
      end.setUTCDate(0)
    }
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) }
  }
  const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 0
  if (!days) return { from: '', to: '' }
  const end = today
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - days + 1)
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) }
}

export function dashboardPeriod(filters, now = new Date()) {
  if (!filters.from && !filters.to) return 'lifetime'
  return ['last-week', 'last-month', '7d', '30d', '90d'].find(period => {
    const range = dashboardPeriodRange(period, now)
    return range.from === filters.from && range.to === filters.to
  }) || 'custom'
}

export function dashboardRecentSessions(items, { search = '', status = 'active', sort = 'newest', asset = '', strategy = '', details = {} } = {}) {
  const filtered = recentSessions(items, { search, archived: status === 'all' || status === 'archived', sort })
    .filter(item => status === 'all' || status === 'active' || (status === 'archived' ? item.archived : item.status === status))
    .filter(item => (!asset || item.instrument_id === asset) && (!strategy || (strategy === 'unassigned' ? details[item.record_id]?.strategy === null : details[item.record_id]?.strategy === strategy)))
  const stamp = (item, key) => Date.parse(item[key] || item.updated_at_utc) || 0
  const knownProfits = filtered.map(item => details[item.record_id]).filter(value => value?.pnl != null)
  const comparable = knownProfits.every(value => typeof value.currency === 'string' && value.currency.trim()) && new Set(knownProfits.map(value => value.currency)).size <= 1
  return filtered.sort((a, b) => {
    if (sort === 'profit' && comparable) {
      const left = details[a.record_id]?.pnl, right = details[b.record_id]?.pnl
      if (left != null || right != null) return left == null ? 1 : right == null ? -1 : right - left || a.record_id.localeCompare(b.record_id)
    }
    return (sort === 'oldest' ? 1 : -1) * (stamp(a, sort === 'last' ? 'updated_at_utc' : 'created_at_utc') - stamp(b, sort === 'last' ? 'updated_at_utc' : 'created_at_utc')) || a.record_id.localeCompare(b.record_id)
  })
}

export function updateDashboardQuery(values) {
  const url = new URL(window.location.href)
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value)
    else url.searchParams.delete(key)
  }
  window.history.replaceState(null, '', url)
}

export async function readDashboardOverview(workspace, filters, signal) {
  const response = await fetch(dashboardRequestUrl(filters), { headers: { 'X-Workspace-Id': workspace }, signal })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(String(payload?.detail || `HTTP ${response.status}`))
  const performance = payload?.performance
  if (performance?.schema_version !== 'dashboard-replay-performance-v1'
      || !performance.scope || !performance.metrics
      || !['months', 'symbols', 'sessions', 'sources', 'excluded'].every((key) => Array.isArray(performance[key]))) {
    throw new Error('dashboard_performance_unavailable')
  }
  return payload
}

export async function readDashboardAnalytics(workspace, session, signal) {
  const response = await fetch(`/api/v2/replay/sessions/${encodeURIComponent(session)}/analytics`, { headers: { 'X-Workspace-Id': workspace }, signal })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : `HTTP ${response.status}`)
  const count = payload.scope?.selected_trade_count
  const total = payload.scope?.total_trade_count
  const readyShape = payload.analytics_available === false || (payload.provenance?.session_id === session && payload.provenance?.workspace_id === workspace
    && payload.metrics && Array.isArray(payload.ledger) && Number.isSafeInteger(count) && count >= 0 && count === payload.ledger.length
    && Number.isSafeInteger(total) && total >= count && (payload.metrics.closed_trade_count === undefined || payload.metrics.closed_trade_count === count))
  if (payload.schema_version !== 'analytics-read-model-v1' || typeof payload.analytics_available !== 'boolean' || !payload.scope || !readyShape) throw new Error('analytics_read_model_invalid')
  return payload
}

export async function readDashboardDatasets(workspace, signal) {
  const response = await fetch('/api/v2/data/datasets', { headers: { 'X-Workspace-Id': workspace }, signal })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !Array.isArray(payload.items)) throw new Error('dashboard_dataset_catalog_unavailable')
  return payload.items
}

export async function readDashboardReplayContext(workspace, item, signal) {
  const response = await fetch(`/api/v2/replay/sessions/${encodeURIComponent(item.record_id)}`, { headers: { 'X-Workspace-Id': workspace }, signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const record = await response.json()
  if (record.record_id !== item.record_id || record.revision !== item.revision) throw new Error('replay_context_revision_mismatch')
  const { visible_rows, ...metadata } = record
  return metadata
}

export function dashboardCurve(metrics) {
  const raw = metrics?.closed_trade_balance_curve
  const known = value => value !== null && value !== undefined && value !== '' && typeof value !== 'boolean' && Number.isFinite(Number(value))
  if (!Array.isArray(raw) || raw.length < 2 || !known(metrics.starting_balance)) return null
  if (raw.some((point, index) => !known(point?.closed_trade_balance) || point.sequence !== index)) return null
  const start = Number(metrics.starting_balance)
  // P/L and the balance curve share the session's original starting balance.
  if (Number(raw[0].closed_trade_balance) !== start) return null
  const values = raw.map(point => Number(point.closed_trade_balance) - start)
  if (metrics.closed_trade_count !== undefined && metrics.closed_trade_count !== values.length - 1) return null
  if (known(metrics.net_pnl) && Math.abs(values.at(-1) - Number(metrics.net_pnl)) > 1e-7 * Math.max(1, Math.abs(Number(metrics.net_pnl)))) return null
  let low = 0, high = 0
  for (const value of values) { low = Math.min(low, value); high = Math.max(high, value) }
  const padding = (high - low || 1) * .12
  low -= padding; high += padding
  const y = value => 228 - (value - low) / (high - low) * 204
  const count = values.length - 1
  return { count, first: values[0], last: values[count], zeroY: y(0), lastX: 974, lastY: y(values[count]),
    path: values.map((value, index) => `${index ? 'L' : 'M'}${(80 + index / count * 894).toFixed(2)},${y(value).toFixed(2)}`).join(' '),
    ticks: [low + padding, (low + high) / 2, high - padding].map(value => ({ value, y: y(value) })) }
}
