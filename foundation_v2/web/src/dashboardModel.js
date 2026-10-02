const numberFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 })

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
