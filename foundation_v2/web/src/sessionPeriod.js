export function sessionDateValue(timestamp) {
  return new Date(timestamp * 1000).toISOString().slice(0, 16)
}

export function sessionDateTimestamp(value) {
  if (!value) return null
  const timestamp = Date.parse(value.endsWith('Z') ? value : `${value}Z`) / 1000
  return Number.isInteger(timestamp) ? timestamp : null
}

export function commonSessionRange(assets) {
  if (!assets.length || assets.some(asset => !Number.isFinite(asset.first_timestamp) || !Number.isFinite(asset.last_timestamp))) return null
  const min = Math.ceil(Math.max(...assets.map(asset => asset.first_timestamp)) / 60) * 60
  const max = Math.floor(Math.min(...assets.map(asset => asset.last_timestamp)) / 60) * 60
  return { min, max, step: Math.max(...assets.map(asset => asset.timeframe_seconds || 60)), valid: min < max }
}

export function sessionPeriodState(period, range) {
  const start = sessionDateTimestamp(period.start), end = period.endMode === 'custom' ? sessionDateTimestamp(period.end) : null
  const validStart = Boolean(range?.valid) && start !== null && start >= range.min && start < range.max
  const validEnd = period.endMode !== 'custom' || (end !== null && end > start && end <= range?.max)
  return { start, end, valid: validStart && validEnd }
}

export function sessionEndShortcut(start, unit) {
  if (start === null) return null
  if (unit !== 'month') return start + (unit === 'week' ? 7 : 1) * 86400
  const date = new Date(start * 1000), day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + 1)
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, last))
  return date.getTime() / 1000
}

export function randomSessionDate(range, period, random = Math.random) {
  const customEnd = period.endMode === 'custom' ? sessionDateTimestamp(period.end) : null
  const upper = Math.floor((Math.min(range.max, customEnd ?? range.max) - range.step) / 60) * 60
  if (upper < range.min) return null
  return sessionDateValue(range.min + Math.floor(random() * ((upper - range.min) / 60 + 1)) * 60)
}
